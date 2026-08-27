import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createPGliteDatabase, type Database } from './database';
import { migrationDirectory, runMigrations } from './migrations';

const migration = '0038_run3_1_member_learning_feed.sql';

describe('member learning migration', () => {
  let database: Database | undefined;
  let temporaryDirectory: string | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
    if (temporaryDirectory !== undefined) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = undefined;
    }
  });

  it('applies after 0037 and records only curated in-app guidance', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-member-learning-'));
    const previous = (await readdir(sourceDirectory))
      .filter((file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file) && file < migration)
      .sort((left, right) => left.localeCompare(right));
    for (const file of previous) {
      await copyFile(join(sourceDirectory, file), join(temporaryDirectory, file));
    }
    database = await createPGliteDatabase();
    await expect(runMigrations(database, temporaryDirectory)).resolves.toHaveLength(37);
    await copyFile(join(sourceDirectory, migration), join(temporaryDirectory, migration));
    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual([migration]);
    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual([]);

    const briefs = await database.query<{
      readonly brief_key: string;
      readonly region_code: string;
      readonly source_kind: string;
      readonly review_state: string;
      readonly publication_state: string;
      readonly automation_generated: boolean;
      readonly external_delivery_permitted: boolean;
      readonly source_published_at: unknown;
      readonly reviewed_at: unknown;
      readonly expires_at: unknown;
    }>(
      `SELECT brief_key, region_code, source_kind, review_state, publication_state,
              automation_generated, external_delivery_permitted, source_published_at,
              reviewed_at, expires_at
       FROM member_scam_guidance_briefs ORDER BY region_code, brief_key`,
    );
    expect(briefs.rows).toHaveLength(2);
    expect(briefs.rows.map((row) => row.region_code)).toEqual(['US', 'US-CA']);
    expect(
      briefs.rows.every(
        (row) =>
          row.source_kind === 'public_official' &&
          row.review_state === 'approved' &&
          row.publication_state === 'in_app_only' &&
          row.automation_generated === false &&
          row.external_delivery_permitted === false &&
          new Date(String(row.source_published_at)) <= new Date(String(row.reviewed_at)) &&
          new Date(String(row.reviewed_at)) < new Date(String(row.expires_at)),
      ),
    ).toBe(true);
  }, 60_000);

  it('enforces household membership and immutable published guidance', async () => {
    database = await createPGliteDatabase();
    await runMigrations(database);
    const now = '2026-08-27T12:00:00.000Z';
    await database.query(
      `INSERT INTO persons(id, display_name, created_at)
       VALUES ('person-learning-synthetic','Synthetic learner',$1)`,
      [now],
    );
    await database.query(
      `INSERT INTO households(id, name, created_at)
       VALUES ('household-learning-synthetic','Synthetic household',$1)`,
      [now],
    );
    await database.query(
      `INSERT INTO household_memberships(
         household_id, id, person_id, membership_kind, status, created_at
       ) VALUES (
         'household-learning-synthetic','membership-learning-synthetic',
         'person-learning-synthetic','member','active',$1
       )`,
      [now],
    );
    await expect(
      database.query(
        `INSERT INTO member_learning_progress(
           household_id, person_id, lesson_key, lesson_version, state,
           attempt_count, review_count, started_at, updated_at
         ) VALUES (
           'household-learning-synthetic','person-learning-synthetic',
           'pause_under_pressure',1,'in_progress',0,0,$1,$1
         )`,
        [now],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });

    await expect(
      database.query(
        `INSERT INTO member_learning_preferences(
           household_id, person_id, coarse_region, weekly_rehearsal_enabled,
           weekly_rehearsal_enabled_at, updated_at
         ) VALUES (
           'household-learning-synthetic','person-learning-synthetic',
           'US-ZZ',false,NULL,$1
         )`,
        [now],
      ),
    ).rejects.toThrow();

    await database.query(
      `UPDATE household_memberships SET status = 'revoked', revoked_at = $1
       WHERE household_id = 'household-learning-synthetic'
         AND person_id = 'person-learning-synthetic'`,
      [now],
    );
    await expect(
      database.query(
        `UPDATE member_learning_progress SET attempt_count = 1
         WHERE household_id = 'household-learning-synthetic'
           AND person_id = 'person-learning-synthetic'`,
      ),
    ).rejects.toThrow('active household membership');
    await expect(
      database.query(
        `UPDATE member_scam_guidance_briefs SET title = 'forbidden'
         WHERE brief_key = 'us-imposter-scam-trends' AND version = 1`,
      ),
    ).rejects.toThrow('immutable');
  }, 60_000);
});

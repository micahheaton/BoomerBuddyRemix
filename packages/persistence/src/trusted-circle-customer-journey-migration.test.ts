import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testArtifactProtection } from '@boomerbuddy/testkit';
import { afterEach, describe, expect, it } from 'vitest';

import { createPGliteDatabase, type Database } from './database';
import { migrationDirectory, runMigrations } from './migrations';
import { seedDemoData } from './seed';

const migration = '0039_trusted_circle_customer_journey.sql';

describe('Trusted Circle customer journey migration', () => {
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

  it('backfills exact shared events and rejects direct lifecycle evidence mutation', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-trusted-circle-'));
    const previous = (await readdir(sourceDirectory))
      .filter((file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file) && file < migration)
      .sort((left, right) => left.localeCompare(right));
    for (const file of previous) {
      await copyFile(join(sourceDirectory, file), join(temporaryDirectory, file));
    }
    database = await createPGliteDatabase();
    await expect(runMigrations(database, temporaryDirectory)).resolves.toHaveLength(38);
    const now = new Date('2026-08-27T12:00:00.000Z');
    await database.query(
      `CREATE TABLE check_share_lifecycle_events (
         id text PRIMARY KEY,
         household_id text NOT NULL,
         analysis_id text NOT NULL,
         shared_with_person_id text NOT NULL,
         actor_person_id text NOT NULL,
         event_kind text NOT NULL,
         state_after text NOT NULL,
         closure_reason text,
         created_at timestamptz NOT NULL
       )`,
    );
    await database.query(
      `ALTER TABLE check_shares
         ADD COLUMN lifecycle_state text NOT NULL DEFAULT 'shared',
         ADD COLUMN acknowledged_by_person_id text,
         ADD COLUMN acknowledged_at timestamptz,
         ADD COLUMN closed_by_person_id text,
         ADD COLUMN closed_at timestamptz,
         ADD COLUMN closure_reason text`,
    );
    await expect(seedDemoData(database, testArtifactProtection(), 'test', now)).resolves.toBe(
      'seeded',
    );
    await database.query('DROP TABLE check_share_lifecycle_events');
    await database.query(
      `ALTER TABLE check_shares
         DROP COLUMN lifecycle_state,
         DROP COLUMN acknowledged_by_person_id,
         DROP COLUMN acknowledged_at,
         DROP COLUMN closed_by_person_id,
         DROP COLUMN closed_at,
         DROP COLUMN closure_reason`,
    );
    const sharesBefore = await database.query<{
      household_id: string;
      analysis_id: string;
      shared_with_person_id: string;
    }>(
      `SELECT household_id, analysis_id, shared_with_person_id
       FROM check_shares ORDER BY household_id, analysis_id, shared_with_person_id`,
    );
    expect(sharesBefore.rows.length).toBeGreaterThan(0);

    await copyFile(join(sourceDirectory, migration), join(temporaryDirectory, migration));
    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual([migration]);
    const sharedEvents = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM check_share_lifecycle_events
       WHERE event_kind = 'shared'`,
    );
    expect(sharedEvents.rows[0]?.count).toBe(sharesBefore.rows.length);
    const share = sharesBefore.rows[0];
    if (share === undefined) throw new Error('Synthetic pre-migration share is unavailable');

    await expect(
      database.query(
        `UPDATE check_share_lifecycle_events SET created_at = $4
         WHERE household_id = $1 AND analysis_id = $2 AND shared_with_person_id = $3`,
        [share.household_id, share.analysis_id, share.shared_with_person_id, now.toISOString()],
      ),
    ).rejects.toThrow('append-only');
    await expect(
      database.query(
        `DELETE FROM check_share_lifecycle_events
         WHERE household_id = $1 AND analysis_id = $2 AND shared_with_person_id = $3`,
        [share.household_id, share.analysis_id, share.shared_with_person_id],
      ),
    ).rejects.toThrow('append-only');
    await expect(
      database.query(
        `UPDATE check_shares
         SET lifecycle_state = 'acknowledged', acknowledged_by_person_id = shared_by_person_id,
             acknowledged_at = $4
         WHERE household_id = $1 AND analysis_id = $2 AND shared_with_person_id = $3`,
        [share.household_id, share.analysis_id, share.shared_with_person_id, now.toISOString()],
      ),
    ).rejects.toThrow();

    await expect(
      database.query(
        `DELETE FROM check_shares
         WHERE household_id = $1 AND analysis_id = $2 AND shared_with_person_id = $3`,
        [share.household_id, share.analysis_id, share.shared_with_person_id],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    const retainedAfterParentDelete = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM check_share_lifecycle_events
       WHERE household_id = $1 AND analysis_id = $2 AND shared_with_person_id = $3`,
      [share.household_id, share.analysis_id, share.shared_with_person_id],
    );
    expect(retainedAfterParentDelete.rows[0]?.count).toBe(0);
  }, 60_000);
});

import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createPGliteDatabase, type Database } from './database';
import { migrationDirectory, runMigrations } from './migrations';

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
    await database.exec(`
      INSERT INTO persons(id, display_name, created_at) VALUES
        ('person-migration-protected','Migration protected fixture','${now.toISOString()}'),
        ('person-migration-trusted','Migration trusted fixture','${now.toISOString()}');
      INSERT INTO households(id, name, created_at)
      VALUES ('household-migration-share','Migration share fixture','${now.toISOString()}');
      INSERT INTO household_memberships(
        household_id, id, person_id, membership_kind, status, created_at
      ) VALUES
        ('household-migration-share','membership-migration-protected',
          'person-migration-protected','member','active','${now.toISOString()}'),
        ('household-migration-share','membership-migration-trusted',
          'person-migration-trusted','member','active','${now.toISOString()}');
      INSERT INTO consents(
        household_id, id, protected_person_id, granted_by_person_id, purpose,
        consent_version, state, granted_at
      ) VALUES (
        'household-migration-share','consent-migration-share','person-migration-protected',
        'person-migration-protected','trusted_circle_relationship','migration-v1','active',
        '${now.toISOString()}'
      );
      INSERT INTO consent_evidence(
        household_id, id, consent_id, actor_person_id, subject_person_id,
        recipient_person_id, purpose, scope, action, disclosure_version,
        disclosure_digest, policy_version, policy_digest, source_interaction,
        assurance, effective_at, recorded_at
      ) VALUES (
        'household-migration-share','evidence-migration-share','consent-migration-share',
        'person-migration-protected','person-migration-protected','person-migration-trusted',
        'trusted_circle_relationship','{"permissions":["check:read"]}'::jsonb,'accept',
        'migration-disclosure-v1',repeat('1',64),'migration-policy-v1',repeat('2',64),
        'migration_test','legacy_unverified','${now.toISOString()}','${now.toISOString()}'
      );
      INSERT INTO consent_current_projections(
        household_id, consent_id, latest_evidence_id, actor_person_id,
        subject_person_id, recipient_person_id, purpose, scope, state,
        effective_at, updated_at
      ) VALUES (
        'household-migration-share','consent-migration-share','evidence-migration-share',
        'person-migration-protected','person-migration-protected','person-migration-trusted',
        'trusted_circle_relationship','{"permissions":["check:read"]}'::jsonb,'active',
        '${now.toISOString()}','${now.toISOString()}'
      );
      INSERT INTO trusted_circle_relationships(
        household_id, id, protected_person_id, trusted_person_id, permissions,
        consent_id, consent_version, state, created_at, latest_consent_evidence_id
      ) VALUES (
        'household-migration-share','relationship-migration-share','person-migration-protected',
        'person-migration-trusted','["check:read"]'::jsonb,'consent-migration-share',
        'migration-v1','active','${now.toISOString()}','evidence-migration-share'
      );
      INSERT INTO artifacts(
        household_id, id, owner_person_id, kind, encryption_key_version,
        fingerprint_key_version, state, delete_after, created_at
      ) VALUES (
        'household-migration-share','artifact-migration-share','person-migration-protected',
        'text',1,1,'active','2026-09-27T12:00:00.000Z','${now.toISOString()}'
      );
      INSERT INTO analyses(
        household_id, id, artifact_id, requested_by, risk, evidence_sufficiency,
        calibration, summary, evidence, actions, provider_name, provider_state,
        provider_version, ruleset_version, state, created_at
      ) VALUES (
        'household-migration-share','analysis-migration-share','artifact-migration-share',
        'person-migration-protected','caution','limited','not_calibrated',
        'Synthetic migration fixture','[]'::jsonb,'[]'::jsonb,'fixture','mock','v1','v1',
        'completed','${now.toISOString()}'
      );
      INSERT INTO check_shares(
        household_id, analysis_id, relationship_id, shared_with_person_id,
        shared_by_person_id, created_at
      ) VALUES (
        'household-migration-share','analysis-migration-share','relationship-migration-share',
        'person-migration-trusted','person-migration-protected','${now.toISOString()}'
      );
    `);
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

import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPGliteDatabase, type Database } from './database';
import { migrationDirectory, runMigrations } from './migrations';

describe('feedback learning forward migration', () => {
  let database: Database | undefined;
  let temporaryDirectory: string | undefined;

  afterEach(async () => {
    await database?.close();
    if (temporaryDirectory !== undefined) {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  it('applies 0020 on the complete available chain and preserves forward-only upgrade', async () => {
    const source = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-feedback-migration-'));
    const files = (await readdir(source))
      .filter(
        (file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file) && file <= '0020_run3_feedback_learning.sql',
      )
      .sort((left, right) => left.localeCompare(right));
    for (const file of files.filter((file) => file !== '0020_run3_feedback_learning.sql')) {
      await copyFile(join(source, file), join(temporaryDirectory, file));
    }
    database = await createPGliteDatabase();
    await runMigrations(database, temporaryDirectory);
    await copyFile(
      join(source, '0020_run3_feedback_learning.sql'),
      join(temporaryDirectory, '0020_run3_feedback_learning.sql'),
    );
    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual([
      '0020_run3_feedback_learning.sql',
    ]);
    const tables = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM information_schema.tables
       WHERE table_name LIKE 'feedback_%'`,
    );
    expect(tables.rows[0]?.count).toBeGreaterThanOrEqual(10);
  });

  it('enforces fresh-install retention and same-transaction erasure evidence at commit', async () => {
    database = await createPGliteDatabase();
    await runMigrations(database);
    const current = database;
    const now = new Date('2026-08-17T12:00:00.000Z');

    await expect(
      current.transaction(async (transaction) => {
        await transaction.query(
          `INSERT INTO feedback_records(
             id, schema_version, identity_mode, source_surface, device_class, feedback_type,
             correlation_id, evidence_tier, created_at
           ) VALUES ('feedback-direct-overlong',1,'anonymous','web_feedback_form','unknown',
             'product_feedback','feedback-direct-overlong','local_simulation',$1)`,
          [now.toISOString()],
        );
        await transaction.query(
          `INSERT INTO feedback_payloads(
             feedback_id, payload_state, encrypted_text, encryption_key_version,
             redaction_status, detected_classes, redaction_counts, retention_deadline, created_at
           ) VALUES ('feedback-direct-overlong','encrypted_minimized','cipher',1,
             'minimized_clean','[]'::jsonb,'{}'::jsonb,$2,$1)`,
          [now.toISOString(), new Date(now.getTime() + 24 * 60 * 60_000 + 1).toISOString()],
        );
      }),
    ).rejects.toThrow();

    await expect(
      current.transaction(async (transaction) => {
        await transaction.query(
          `INSERT INTO feedback_records(
             id, schema_version, identity_mode, source_surface, device_class, feedback_type,
             correlation_id, evidence_tier, created_at
           ) VALUES ('feedback-direct-declined-mismatch',1,'anonymous','web_feedback_form','unknown',
             'product_feedback','feedback-declined-mismatch','local_simulation',$1)`,
          [now.toISOString()],
        );
        await transaction.query(
          `INSERT INTO feedback_payloads(
             feedback_id, payload_state, encrypted_text, encryption_key_version,
             redaction_status, detected_classes, redaction_counts, retention_deadline, created_at
           ) VALUES ('feedback-direct-declined-mismatch','encrypted_minimized','cipher',1,
             'minimized_clean','[]'::jsonb,'{}'::jsonb,$2,$1)`,
          [now.toISOString(), new Date(now.getTime() + 2 * 60 * 60_000).toISOString()],
        );
        await transaction.query(
          `INSERT INTO feedback_consent_events(
             id, feedback_id, purpose, sequence, state, actor_kind, reason_code, occurred_at
           ) VALUES ('feedback-consent-declined-mismatch','feedback-direct-declined-mismatch',
             'research_retention',1,'declined','anonymous_participant','participant_declined',$1)`,
          [now.toISOString()],
        );
      }),
    ).rejects.toThrow(/exactly one hour/iu);

    await expect(
      current.transaction(async (transaction) => {
        await transaction.query(
          `INSERT INTO feedback_records(
             id, schema_version, identity_mode, source_surface, device_class, feedback_type,
             correlation_id, evidence_tier, created_at
           ) VALUES ('feedback-direct-grant-mismatch',1,'anonymous','web_feedback_form','unknown',
             'product_feedback','feedback-grant-mismatch','local_simulation',$1)`,
          [now.toISOString()],
        );
        await transaction.query(
          `INSERT INTO feedback_payloads(
             feedback_id, payload_state, encrypted_text, encryption_key_version,
             redaction_status, detected_classes, redaction_counts, retention_deadline, created_at
           ) VALUES ('feedback-direct-grant-mismatch','encrypted_minimized','cipher',1,
             'minimized_clean','[]'::jsonb,'{}'::jsonb,$2,$1)`,
          [now.toISOString(), new Date(now.getTime() + 60 * 60_000).toISOString()],
        );
        await transaction.query(
          `INSERT INTO feedback_consent_events(
             id, feedback_id, purpose, sequence, state, purpose_code, consent_version,
             retain_until, actor_kind, reason_code, occurred_at
           ) VALUES ('feedback-consent-grant-mismatch','feedback-direct-grant-mismatch',
             'research_retention',1,'granted','product_feedback_research','feedback-research-v1',
             $2,'anonymous_participant','participant_granted',$1)`,
          [now.toISOString(), new Date(now.getTime() + 2 * 60 * 60_000).toISOString()],
        );
      }),
    ).rejects.toThrow(/retention|bounded consent/iu);

    const feedbackId = 'feedback-direct-valid-erasure';
    const deadline = new Date(now.getTime() + 60 * 60_000);
    await current.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO feedback_records(
           id, schema_version, identity_mode, source_surface, device_class, feedback_type,
           correlation_id, evidence_tier, created_at
         ) VALUES ($1,1,'anonymous','web_feedback_form','unknown','product_feedback',
           'feedback-valid-erasure','local_simulation',$2)`,
        [feedbackId, now.toISOString()],
      );
      await transaction.query(
        `INSERT INTO feedback_payloads(
           feedback_id, payload_state, encrypted_text, encryption_key_version,
           redaction_status, detected_classes, redaction_counts, retention_deadline, created_at
         ) VALUES ($1,'encrypted_minimized','cipher',1,'minimized_clean','[]'::jsonb,
           '{}'::jsonb,$3,$2)`,
        [feedbackId, now.toISOString(), deadline.toISOString()],
      );
      await transaction.query(
        `INSERT INTO feedback_consent_events(
           id, feedback_id, purpose, sequence, state, actor_kind, reason_code, occurred_at
         ) VALUES ('feedback-consent-valid-erasure',$1,'research_retention',1,'declined',
           'anonymous_participant','participant_declined',$2)`,
        [feedbackId, now.toISOString()],
      );
    });
    await expect(
      current.query(
        `UPDATE feedback_payloads SET payload_state = 'payload_erased', encrypted_text = NULL,
           encryption_key_version = NULL, erased_at = $2 WHERE feedback_id = $1`,
        [feedbackId, deadline.toISOString()],
      ),
    ).rejects.toThrow(/same-transaction durable evidence/iu);
    await current.transaction(async (transaction) => {
      await transaction.query(
        `UPDATE feedback_payloads SET payload_state = 'payload_erased', encrypted_text = NULL,
           encryption_key_version = NULL, erased_at = $2 WHERE feedback_id = $1`,
        [feedbackId, deadline.toISOString()],
      );
      await transaction.query(
        `INSERT INTO feedback_payload_erasure_events(
           id, feedback_id, reason, actor_kind, prior_retention_deadline,
           evidence_tier, occurred_at
         ) VALUES ('feedback-erasure-valid-direct',$1,'retention_expired','system',$2,
           'local_simulation',$2)`,
        [feedbackId, deadline.toISOString()],
      );
    });
    const durable = await current.query<{
      payload_state: string;
      encrypted_text: string | null;
      evidence_count: number;
    }>(
      `SELECT payload.payload_state, payload.encrypted_text,
              (SELECT count(*)::int FROM feedback_payload_erasure_events evidence
               WHERE evidence.feedback_id = payload.feedback_id) AS evidence_count
       FROM feedback_payloads payload WHERE payload.feedback_id = $1`,
      [feedbackId],
    );
    expect(durable.rows[0]).toEqual({
      payload_state: 'payload_erased',
      encrypted_text: null,
      evidence_count: 1,
    });
  });

  it('rejects identity association and mutation at direct SQL boundaries', async () => {
    database = await createPGliteDatabase();
    await runMigrations(database);
    const now = '2026-08-17T12:00:00.000Z';
    await database.query(
      `INSERT INTO persons(id, display_name, created_at) VALUES
       ('person-feedback-direct','Feedback Direct',$1),
       ('person-feedback-founder','Feedback Founder',$1)`,
      [now],
    );
    await database.query(
      `INSERT INTO households(id, name, created_at)
       VALUES ('household-feedback-direct','Feedback Direct',$1)`,
      [now],
    );
    await database.query(
      `INSERT INTO organizations(id, name, kind, verification_state, created_at)
       VALUES ('organization-feedback-direct','Feedback Internal','internal','local_fixture',$1)`,
      [now],
    );
    await database.query(
      `INSERT INTO employee_assignments(id, person_id, organization_id, role, status, created_at)
       VALUES ('employee-feedback-founder','person-feedback-founder',
         'organization-feedback-direct','hq_owner','active',$1)`,
      [now],
    );
    await expect(
      database.query(
        `INSERT INTO feedback_records(
           id, schema_version, identity_mode, household_id, actor_person_id, source_surface,
           device_class, feedback_type, correlation_id, evidence_tier, created_at
         ) VALUES ('feedback-direct-associated',1,'anonymous','household-feedback-direct',
           'person-feedback-direct','web_feedback_form','unknown','product_feedback',
           'feedback-direct-correlation','local_simulation',$1)`,
        [now],
      ),
    ).rejects.toThrow();
    await database.query(
      `INSERT INTO feedback_records(
         id, schema_version, identity_mode, source_surface, device_class, feedback_type,
         correlation_id, evidence_tier, created_at
       ) VALUES ('feedback-direct-anonymous',1,'anonymous','web_feedback_form','unknown',
         'product_feedback','feedback-direct-correlation','local_simulation',$1)`,
      [now],
    );
    await database.query(
      `INSERT INTO feedback_records(
         id, schema_version, identity_mode, source_surface, device_class, feedback_type,
         correlation_id, evidence_tier, created_at
       ) VALUES ('feedback-direct-metadata-attack',1,'anonymous','web_feedback_form','unknown',
         'product_feedback','feedback-direct-metadata-attack','local_simulation',$1)`,
      [now],
    );
    await expect(
      database.query(
        `INSERT INTO feedback_payloads(
           feedback_id, payload_state, redaction_status, detected_classes, redaction_counts,
           created_at
         ) VALUES ('feedback-direct-metadata-attack','discarded_unsafe',
           'quarantined_discarded','["one_time_code"]'::jsonb,
           '{"one_time_code":"covert-content"}'::jsonb,$1)`,
        [now],
      ),
    ).rejects.toThrow();
    await database.query(
      `INSERT INTO feedback_payloads(
         feedback_id, payload_state, redaction_status, detected_classes, redaction_counts,
         created_at
       ) VALUES ('feedback-direct-anonymous','discarded_unsafe','quarantined_discarded',
         '["private_key"]'::jsonb,'{}'::jsonb,$1)`,
      [now],
    );
    await expect(
      database.query(
        `INSERT INTO feedback_consent_events(
           id, feedback_id, purpose, sequence, state, purpose_code, consent_version,
           retain_until, actor_kind, actor_person_id, reason_code, occurred_at
         ) VALUES ('feedback-consent-direct-forged','feedback-direct-anonymous',
           'research_retention',1,'granted','product_feedback_research','feedback-research-v1',
           $2,'participant','person-feedback-direct','forged_participant_grant',$1)`,
        [now, '2026-08-17T13:00:00.000Z'],
      ),
    ).rejects.toThrow(/provenance/iu);
    await expect(
      database.query(
        `INSERT INTO feedback_consent_events(
           id, feedback_id, purpose, sequence, state, purpose_code, consent_version,
           retain_until, actor_kind, actor_person_id, reason_code, occurred_at
         ) VALUES ('feedback-consent-direct-purpose-mismatch','feedback-direct-anonymous',
           'research_retention',1,'granted','feedback_follow_up','feedback-follow-up-v1',
           $2,'anonymous_participant',NULL,'mismatched_purpose_grant',$1)`,
        [now, '2026-08-17T13:00:00.000Z'],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `INSERT INTO feedback_consent_events(
           id, feedback_id, purpose, sequence, state, purpose_code, consent_version,
           retain_until, actor_kind, actor_person_id, reason_code, occurred_at
         ) VALUES ('feedback-consent-direct-over-retention','feedback-direct-anonymous',
           'research_retention',1,'granted','product_feedback_research','feedback-research-v1',
           $2,'anonymous_participant',NULL,'overlong_research_grant',$1)`,
        [now, '2026-08-18T12:00:01.000Z'],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `INSERT INTO feedback_state_events(
           id, feedback_id, version, from_status, to_status, severity, classification,
           close_loop_state, reason_code, actor_kind, evidence_tier, occurred_at
         ) VALUES ('feedback-state-direct-without-payload','feedback-direct-metadata-attack',
           1,NULL,'received','unassessed','unclassified','not_requested',
           'pre_payload_state_attempt','anonymous_participant','local_simulation',$1)`,
        [now],
      ),
    ).rejects.toThrow(/durable payload/iu);
    await database.query(
      `INSERT INTO feedback_state_events(
         id, feedback_id, version, from_status, to_status, severity, classification,
         close_loop_state, reason_code, actor_kind, evidence_tier, occurred_at
       ) VALUES ('feedback-state-direct-one','feedback-direct-anonymous',1,NULL,'received',
         'unassessed','unclassified','not_requested','bounded_text_received',
         'anonymous_participant','local_simulation',$1)`,
      [now],
    );
    await database.query(
      `INSERT INTO feedback_assignment_events(
         id, feedback_id, version, routing_state, queue, employee_assignment_id,
         assigned_by_person_id, service_key, reason_code, occurred_at
       ) VALUES ('feedback-routing-direct-one','feedback-direct-anonymous',1,'unassigned',
         'privacy_security',NULL,NULL,'feedback.local_router','bounded_initial_routing',$1)`,
      [now],
    );
    await expect(
      database.query(
        `INSERT INTO feedback_assignment_events(
           id, feedback_id, version, routing_state, queue, employee_assignment_id,
           assigned_by_person_id, service_key, reason_code, occurred_at
         ) VALUES ('feedback-routing-direct-broaden','feedback-direct-anonymous',2,'assigned',
           'privacy_security','employee-feedback-founder','person-feedback-direct',NULL,
           'direct_visibility_broadening',$1)`,
        [now],
      ),
    ).rejects.toThrow(/authority|owner projection/iu);
    await database.query(
      `UPDATE employee_assignments SET status = 'suspended'
       WHERE id = 'employee-feedback-founder'`,
    );
    await expect(
      database.query(
        `INSERT INTO feedback_state_events(
           id, feedback_id, version, from_status, to_status, severity, classification,
           close_loop_state, reason_code, actor_kind, actor_person_id, evidence_tier, occurred_at
         ) VALUES ('feedback-state-direct-suspended-owner','feedback-direct-anonymous',2,
           'received','restricted','unassessed','unclassified','not_requested',
           'suspended_owner_attempt','hq','person-feedback-founder','local_simulation',$1)`,
        [now],
      ),
    ).rejects.toThrow(/exact assignee|owner projection/iu);
    await expect(
      database.query(
        `INSERT INTO feedback_state_events(
           id, feedback_id, version, from_status, to_status, severity, classification,
           close_loop_state, reason_code, actor_kind, service_key, evidence_tier, occurred_at
         ) VALUES ('feedback-state-direct-skip','feedback-direct-anonymous',3,'received','assigned',
           'unassessed','unclassified','not_requested','skip_attempt','system',
           'feedback.direct_test','local_simulation',$1)`,
        [now],
      ),
    ).rejects.toThrow(/chronology|transition/iu);
    await expect(
      database.query(
        `UPDATE feedback_records SET feedback_type = 'bug_report'
         WHERE id = 'feedback-direct-anonymous'`,
      ),
    ).rejects.toThrow(/linkage erasure/iu);
    await expect(
      database.query(
        `UPDATE feedback_payloads SET encrypted_text = 'invented'
         WHERE feedback_id = 'feedback-direct-anonymous'`,
      ),
    ).rejects.toThrow(/active-store ciphertext erasure/u);
    await expect(
      database.query(`DELETE FROM feedback_state_events WHERE id = 'feedback-state-direct-one'`),
    ).rejects.toThrow('append-only');
    await expect(
      database.query(`DELETE FROM feedback_anonymous_concurrency_mutex WHERE singleton = true`),
    ).rejects.toThrow('append-only');
    await expect(
      database.query(`DELETE FROM feedback_review_concurrency_mutex WHERE singleton = true`),
    ).rejects.toThrow('append-only');
  });
});

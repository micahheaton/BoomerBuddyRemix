import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createPGliteDatabase, type Database } from './database';
import { migrationDirectory, runMigrations } from './migrations';

async function copyMigrationsThrough(
  sourceDirectory: string,
  targetDirectory: string,
  lastFile: string,
): Promise<void> {
  const files = (await readdir(sourceDirectory))
    .filter((file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file) && file <= lastFile)
    .sort((left, right) => left.localeCompare(right));
  for (const file of files) {
    await copyFile(join(sourceDirectory, file), join(targetDirectory, file));
  }
}

describe('Run 3 foundation forward migrations', () => {
  let database: Database | undefined;
  let temporaryDirectory: string | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
    if (temporaryDirectory !== undefined) {
      await rm(temporaryDirectory, { force: true, recursive: true });
      temporaryDirectory = undefined;
    }
  });

  it('upgrades legacy Public Check evidence through 0014 without losing continuity truth', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-public-continuity-'));
    await copyMigrationsThrough(
      sourceDirectory,
      temporaryDirectory,
      '0013_run3_automation_budget_ledger.sql',
    );
    database = await createPGliteDatabase();
    await expect(runMigrations(database, temporaryDirectory)).resolves.toHaveLength(13);

    await database.exec(`
      INSERT INTO persons(id, display_name, created_at)
      VALUES ('person-public-migration','Public Migration Owner','2026-08-16T00:00:00.000Z');
      INSERT INTO households(id, name, created_at)
      VALUES ('household-public-migration','Public Migration Household','2026-08-16T00:00:00.000Z');
      INSERT INTO household_memberships(
        household_id, id, person_id, membership_kind, status, created_at
      ) VALUES (
        'household-public-migration','membership-public-migration','person-public-migration',
        'member','active','2026-08-16T00:00:00.000Z'
      );
      INSERT INTO artifacts(
        household_id, id, owner_person_id, kind, encrypted_content, input_fingerprint,
        encryption_key_version, fingerprint_key_version, state, delete_after, created_at
      ) VALUES (
        'household-public-migration','artifact-public-migration','person-public-migration',
        'text','legacy-ciphertext','legacy-fingerprint',1,1,'active',
        '2099-08-16T00:00:00.000Z','2026-08-16T00:00:00.000Z'
      );
      INSERT INTO analyses(
        household_id, id, artifact_id, requested_by, risk, evidence_sufficiency,
        calibration, summary, evidence, actions, provider_name, provider_state,
        provider_version, ruleset_version, state, created_at
      ) VALUES (
        'household-public-migration','analysis-public-migration','artifact-public-migration',
        'person-public-migration','caution','limited','not_calibrated','Legacy analysis',
        '[]'::jsonb,'[]'::jsonb,'local-unknown','unknown','2','score-v2','completed',
        '2026-08-16T00:01:00.000Z'
      );
      INSERT INTO public_check_contexts(
        id, token_hmac, hmac_key_version, attribution_source, attribution_campaign,
        remaining_checks, state, expires_at, created_at, client_key_hmac
      ) VALUES (
        'context-public-migration','legacy-token-hmac',1,'organic','none',2,'active',
        '2099-08-16T00:00:00.000Z','2026-08-16T00:00:00.000Z','legacy-network-hmac'
      );
      INSERT INTO public_check_results(
        id, conversion_hmac, hmac_key_version, encrypted_payload, encryption_key_version,
        state, expires_at, created_at, context_id, attribution_source, attribution_campaign
      ) VALUES (
        'result-public-migration','legacy-conversion-hmac',1,'legacy-result-ciphertext',1,
        'active','2099-08-16T00:00:00.000Z','2026-08-16T00:02:00.000Z',
        'context-public-migration','organic','none'
      );
      INSERT INTO public_check_conversions(
        result_id, actor_person_id, household_id, context_id, attribution_source,
        attribution_campaign, artifact_id, analysis_id, save_consent, consent_version,
        session_audience, correlation_id, credential_hmac, hmac_key_version, converted_at
      ) VALUES (
        'result-public-migration','person-public-migration','household-public-migration',
        'context-public-migration','organic','none','artifact-public-migration',
        'analysis-public-migration',true,'public-check-save-v1','customer',
        'public-migration-correlation','legacy-credential-hmac',1,
        '2026-08-16T00:03:00.000Z'
      );
      UPDATE public_check_results
      SET state = 'consumed', conversion_hmac = NULL, encrypted_payload = NULL,
          consumed_at = '2026-08-16T00:03:00.000Z'
      WHERE id = 'result-public-migration';
    `);

    await copyFile(
      join(sourceDirectory, '0014_run3_public_check_continuity.sql'),
      join(temporaryDirectory, '0014_run3_public_check_continuity.sql'),
    );
    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual([
      '0014_run3_public_check_continuity.sql',
    ]);

    const migrated = await database.query<
      {
        readonly client_key_hmac: string;
        readonly context_id: string;
        readonly continuity_hmac: string | null;
        readonly continuity_hmac_key_version: number | null;
        readonly result_state: string;
        readonly semantics_version: string;
      } & Record<string, unknown>
    >(
      `SELECT context.id AS context_id, context.client_key_hmac,
              context.continuity_hmac, context.continuity_hmac_key_version,
              conversion.semantics_version, result.state AS result_state
       FROM public_check_contexts context
       JOIN public_check_conversions conversion ON conversion.context_id = context.id
       JOIN public_check_results result ON result.id = conversion.result_id
       WHERE context.id = 'context-public-migration'`,
    );
    expect(migrated.rows).toEqual([
      {
        client_key_hmac: 'legacy-network-hmac',
        context_id: 'context-public-migration',
        continuity_hmac: null,
        continuity_hmac_key_version: null,
        result_state: 'consumed',
        semantics_version: 'single-success-retry-v1',
      },
    ]);

    await expect(
      database.query(
        `UPDATE public_check_conversions
         SET semantics_version = 'single-success-retry-v1'
         WHERE result_id = 'result-public-migration'`,
      ),
    ).rejects.toThrow('append-only');
    await expect(
      database.query(
        `UPDATE public_check_contexts SET continuity_hmac = repeat('a',64),
           continuity_hmac_key_version = NULL WHERE id = 'context-public-migration'`,
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `UPDATE public_check_contexts SET continuity_hmac = NULL,
           continuity_hmac_key_version = 1 WHERE id = 'context-public-migration'`,
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `UPDATE public_check_contexts SET continuity_hmac = repeat('A',43),
           continuity_hmac_key_version = 0 WHERE id = 'context-public-migration'`,
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `UPDATE public_check_contexts SET continuity_hmac = repeat('!',43),
           continuity_hmac_key_version = 1 WHERE id = 'context-public-migration'`,
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `UPDATE public_check_contexts SET continuity_hmac = repeat('A',43),
           continuity_hmac_key_version = 1 WHERE id = 'context-public-migration'`,
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      database.query(
        `UPDATE public_check_contexts SET continuity_hmac = NULL,
           continuity_hmac_key_version = NULL WHERE id = 'context-public-migration'`,
      ),
    ).resolves.toMatchObject({ rowCount: 1 });

    await database.query(
      `INSERT INTO public_check_results(
         id, conversion_hmac, hmac_key_version, encrypted_payload, encryption_key_version,
         state, expires_at, created_at, context_id, attribution_source, attribution_campaign
       ) VALUES (
         'result-public-migration-invalid','legacy-conversion-hmac-invalid',1,
         'legacy-result-ciphertext-invalid',1,'active','2099-08-16T00:00:00.000Z',
         '2026-08-16T00:04:00.000Z','context-public-migration','organic','none'
       )`,
    );
    await expect(
      database.query(
        `INSERT INTO public_check_conversions(
           result_id, actor_person_id, household_id, context_id, attribution_source,
           attribution_campaign, artifact_id, analysis_id, save_consent, consent_version,
           session_audience, correlation_id, credential_hmac, hmac_key_version, converted_at,
           semantics_version
         ) VALUES (
           'result-public-migration-invalid','person-public-migration',
           'household-public-migration','context-public-migration','organic','none',
           'artifact-public-migration','analysis-public-migration',true,
           'public-check-save-v1','customer','public-migration-invalid-correlation',
           'legacy-credential-hmac-invalid',1,'2026-08-16T00:04:00.000Z','invented'
         )`,
      ),
    ).rejects.toThrow();
    const preserved = await database.query<
      { readonly contexts: number; readonly conversions: number } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::int FROM public_check_contexts
          WHERE id = 'context-public-migration' AND continuity_hmac IS NULL
            AND continuity_hmac_key_version IS NULL) AS contexts,
         (SELECT count(*)::int FROM public_check_conversions
          WHERE result_id = 'result-public-migration'
            AND semantics_version = 'single-success-retry-v1') AS conversions`,
    );
    expect(preserved.rows[0]).toEqual({ contexts: 1, conversions: 1 });
  });

  it('adds 0015 external-action boundaries without granting authority or changing prerequisites', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-external-actions-'));
    await copyMigrationsThrough(
      sourceDirectory,
      temporaryDirectory,
      '0014_run3_public_check_continuity.sql',
    );
    database = await createPGliteDatabase();
    await expect(runMigrations(database, temporaryDirectory)).resolves.toHaveLength(14);

    await database.exec(`
      INSERT INTO persons(id, display_name, created_at) VALUES
        ('person-external-migration-owner','External Migration Owner','2026-08-16T00:00:00.000Z'),
        ('person-external-migration-outsider','External Migration Outsider','2026-08-16T00:00:00.000Z');
      INSERT INTO organizations(id, name, kind, verification_state, created_at)
      VALUES (
        'organization-external-migration','External Migration Internal','internal',
        'local_fixture','2026-08-16T00:00:00.000Z'
      );
      INSERT INTO employee_assignments(
        id, person_id, organization_id, role, status, created_at
      ) VALUES (
        'assignment-external-migration-owner','person-external-migration-owner',
        'organization-external-migration','hq_owner','active','2026-08-16T00:00:00.000Z'
      );
      INSERT INTO autonomy_policies(
        id, action_key, autonomy_class, allowed_data_classes, allowed_tools,
        max_cost_per_operation_cents, requires_audit, enabled, approved_by_person_id,
        version, created_at, updated_at
      ) VALUES (
        'policy-external-migration','create_internal_task','auto','["public"]'::jsonb,
        '["hq"]'::jsonb,5,true,true,'person-external-migration-owner',1,
        '2026-08-16T00:00:00.000Z','2026-08-16T00:00:00.000Z'
      );
      INSERT INTO autonomy_policy_versions(
        id, policy_id, action_key, version, autonomy_class, allowed_data_classes,
        allowed_tools, max_cost_per_operation_cents, requires_audit, enabled,
        approved_by_person_id, recorded_at
      ) VALUES (
        'policy-version-external-migration','policy-external-migration',
        'create_internal_task',1,'auto','["public"]'::jsonb,'["hq"]'::jsonb,5,true,true,
        'person-external-migration-owner','2026-08-16T00:00:00.000Z'
      );
      INSERT INTO automation_runs(
        id, policy_id, action_key, tool_key, data_classes, estimated_cost_cents,
        state, audit_reference, created_at
      ) VALUES (
        'run-external-migration','policy-external-migration','create_internal_task','hq',
        '["public"]'::jsonb,5,'approved','automation:run-external-migration',
        '2026-08-16T00:00:00.000Z'
      );
      INSERT INTO automation_budget_reservations(
        id, operation_key, envelope_digest, automation_run_id, policy_id, policy_version,
        agent_key, action_key, tool_key, data_classes, estimated_cost_cents, state,
        reserved_at, expires_at, correlation_id
      ) VALUES (
        'reservation-external-migration','external:migration:operation',repeat('a',64),
        'run-external-migration','policy-external-migration',1,'external_migration_agent',
        'create_internal_task','hq','["public"]'::jsonb,5,'reserved',
        '2026-08-16T00:00:00.000Z','2099-08-16T00:00:00.000Z',
        'external-migration-correlation'
      );
      INSERT INTO outbox_events(
        id, event_type, event_version, aggregate_type, aggregate_id, actor_person_id,
        correlation_id, classification, payload, occurred_at, available_at,
        next_attempt_at, attempts
      ) VALUES (
        'outbox-external-migration','external.action.intent.v1',1,'company','global',
        'person-external-migration-owner','external-migration-origin-correlation',
        'internal','{}'::jsonb,'2026-08-16T00:00:00.000Z','2026-08-16T00:00:00.000Z',
        '2026-08-16T00:00:00.000Z',0
      );
    `);

    await copyFile(
      join(sourceDirectory, '0015_run3_external_actions.sql'),
      join(temporaryDirectory, '0015_run3_external_actions.sql'),
    );
    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual([
      '0015_run3_external_actions.sql',
    ]);

    const tables = await database.query<{ readonly table_name: string } & Record<string, unknown>>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN (
         'external_action_provider_acceptance_rules',
         'external_action_provider_acceptance_rule_versions',
         'external_action_exposure_authorizations',
         'external_actions',
         'external_action_reconciliation_authorizations',
         'external_action_attempts'
       ) ORDER BY table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'external_action_attempts',
      'external_action_exposure_authorizations',
      'external_action_provider_acceptance_rule_versions',
      'external_action_provider_acceptance_rules',
      'external_action_reconciliation_authorizations',
      'external_actions',
    ]);
    const triggers = await database.query<
      { readonly event_object_table: string; readonly trigger_name: string } & Record<
        string,
        unknown
      >
    >(
      `SELECT DISTINCT event_object_table, trigger_name
       FROM information_schema.triggers
       WHERE trigger_name IN (
         'external_action_registration_valid',
         'external_action_acceptance_rules_owner_valid'
       ) ORDER BY event_object_table, trigger_name`,
    );
    expect(triggers.rows).toEqual([
      {
        event_object_table: 'external_action_provider_acceptance_rules',
        trigger_name: 'external_action_acceptance_rules_owner_valid',
      },
      {
        event_object_table: 'external_actions',
        trigger_name: 'external_action_registration_valid',
      },
    ]);

    const afterMigration = await database.query<
      {
        readonly actions: number;
        readonly assignments: number;
        readonly authorizations: number;
        readonly organizations: number;
        readonly origins: number;
        readonly owners: number;
        readonly policies: number;
        readonly policy_versions: number;
        readonly reservations: number;
        readonly rules: number;
        readonly runs: number;
      } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::int FROM persons
          WHERE id = 'person-external-migration-owner') AS owners,
         (SELECT count(*)::int FROM organizations
          WHERE id = 'organization-external-migration' AND kind = 'internal'
            AND verification_state = 'local_fixture') AS organizations,
         (SELECT count(*)::int FROM employee_assignments
          WHERE id = 'assignment-external-migration-owner' AND role = 'hq_owner'
            AND status = 'active') AS assignments,
         (SELECT count(*)::int FROM autonomy_policies
          WHERE id = 'policy-external-migration' AND version = 1
            AND max_cost_per_operation_cents = 5) AS policies,
         (SELECT count(*)::int FROM autonomy_policy_versions
          WHERE id = 'policy-version-external-migration' AND version = 1
            AND max_cost_per_operation_cents = 5) AS policy_versions,
         (SELECT count(*)::int FROM automation_runs
          WHERE id = 'run-external-migration' AND state = 'approved'
            AND estimated_cost_cents = 5) AS runs,
         (SELECT count(*)::int FROM automation_budget_reservations
          WHERE id = 'reservation-external-migration' AND state = 'reserved'
            AND envelope_digest = repeat('a',64)) AS reservations,
         (SELECT count(*)::int FROM outbox_events
          WHERE id = 'outbox-external-migration'
            AND event_type = 'external.action.intent.v1') AS origins,
         (SELECT count(*)::int FROM external_action_provider_acceptance_rules) AS rules,
         (SELECT count(*)::int FROM external_action_exposure_authorizations) AS authorizations,
         (SELECT count(*)::int FROM external_actions) AS actions`,
    );
    expect(afterMigration.rows[0]).toEqual({
      actions: 0,
      assignments: 1,
      authorizations: 0,
      organizations: 1,
      origins: 1,
      owners: 1,
      policies: 1,
      policy_versions: 1,
      reservations: 1,
      rules: 0,
      runs: 1,
    });

    await expect(
      database.query(
        `INSERT INTO external_action_provider_acceptance_rules(
           id, provider_key, provider_account_digest, action_class,
           provider_response_state, normalized_outcome, provider_supports_idempotency,
           idempotency_key_derivation_version, enabled, version,
           reviewed_by_person_id, reviewed_at, updated_at
         ) VALUES (
           'rule-external-migration-bypass','provider-migration',repeat('A',43),'email',
           'accepted','accepted',true,'operation-sha256-v1',true,1,
           'person-external-migration-outsider','2026-08-16T00:00:00.000Z',
           '2026-08-16T00:00:00.000Z'
         )`,
      ),
    ).rejects.toThrow('External action owner authority is unavailable');
    await expect(
      database.query(
        `INSERT INTO external_actions(
           operation_id, budget_reservation_id, exposure_authorization_id,
           budget_envelope_digest, automation_action_key, automation_tool_key,
           financial_exposure_upper_bound_cents, budget_magnitude_kind, cost_currency,
           cost_source_key, cost_source_version, exposure_evidence_level,
           scope_kind, scope_id, origin_kind, origin_id, registered_by_person_id,
           registration_audience, action_class, provider_key, provider_account_digest,
           provider_capability_rule_id, provider_capability_rule_version,
           provider_supports_idempotency, provider_idempotency_key,
           provider_idempotency_key_derivation_version, intent_fingerprint, state,
           effect_state, retry_suppressed, attempts, max_attempts, next_attempt_at,
           correlation_id, created_at, updated_at
         ) VALUES (
           'external:migration:operation','reservation-external-migration',
           'exposure-external-migration-ungranted',repeat('b',64),
           'create_internal_task','hq',5,'provider_cost','USD','fixture_catalog','fixture_v1',
           'local_fixture','company','global','outbox_event','outbox-external-migration',
           'person-external-migration-owner','hq','email','provider-migration',repeat('A',43),
           'rule-external-migration-ungranted',1,true,'external-migration-idempotency-key',
           'operation-sha256-v1',repeat('B',43),'pending','not_dispatched',false,0,3,
           '2026-08-16T00:00:00.000Z','external-migration-action-correlation',
           '2026-08-16T00:00:00.000Z','2026-08-16T00:00:00.000Z'
         )`,
      ),
    ).rejects.toThrow('External action budget envelope is invalid');

    const denied = await database.query<
      {
        readonly actions: number;
        readonly authorizations: number;
        readonly rules: number;
      } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::int FROM external_action_provider_acceptance_rules) AS rules,
         (SELECT count(*)::int FROM external_action_exposure_authorizations) AS authorizations,
         (SELECT count(*)::int FROM external_actions) AS actions`,
    );
    expect(denied.rows[0]).toEqual({ actions: 0, authorizations: 0, rules: 0 });
    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual([]);
  });
});

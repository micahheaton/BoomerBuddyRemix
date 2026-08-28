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

describe('Stripe live control-plane forward migration', () => {
  let database: Database | undefined;
  let temporaryDirectory: string | undefined;

  afterEach(async () => {
    await database?.close();
    if (temporaryDirectory !== undefined) {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  it('applies through 0029 without seeding a live control and requires an approved capped cohort', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-stripe-0029-'));
    await copyMigrationsThrough(
      sourceDirectory,
      temporaryDirectory,
      '0029_run3_1_stripe_live_control_plane.sql',
    );
    database = await createPGliteDatabase(':memory:');
    await expect(runMigrations(database, temporaryDirectory)).resolves.toHaveLength(29);

    const liveControls = await database.query(
      `SELECT 1 FROM commerce_stripe_initiation_controls WHERE environment = 'production'`,
    );
    expect(liveControls.rowCount).toBe(0);
    const provisioningDigests = await database.query<{
      readonly definition_digest: string;
      readonly workstream_key: string;
    }>(
      `SELECT workstream_key, definition_digest FROM founder_provisioning_workstreams
       WHERE workstream_key IN ('replit', 'stripe') ORDER BY workstream_key`,
    );
    expect(provisioningDigests.rows).toEqual([
      {
        definition_digest: '6CZMd6E24L_rcXap_XtuwN0ADAaIAjBs1Ya2BfgkdTM',
        workstream_key: 'replit',
      },
      {
        definition_digest: 'AVzvfMHJ-fpTUBtl_EJAnPqFiN8l5BAYeHuI6r5gyfM',
        workstream_key: 'stripe',
      },
    ]);
    await expect(
      database.exec(
        `UPDATE founder_provisioning_workstreams
         SET definition_digest = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
         WHERE workstream_key = 'stripe'`,
      ),
    ).rejects.toThrow(/immutable/u);

    await database.exec(
      `INSERT INTO persons(id, display_name, created_at)
       VALUES ('person-stripe-control','Stripe Control','2026-08-25T00:00:00.000Z')`,
    );
    await expect(
      database.exec(
        `INSERT INTO commerce_stripe_initiation_controls(
           environment, state, revision, changed_by_person_id, reason_code, changed_at
         ) VALUES (
           'production','enabled',1,'person-stripe-control','founder_live_activation',
           '2026-08-25T00:00:00.000Z'
         )`,
      ),
    ).rejects.toThrow(/active approved bounded cohort/u);

    await database.exec(
      `INSERT INTO commerce_stripe_cohort_policies(
         environment, cohort_key, benefit_key, state, max_active, policy_expires_at,
         live_approved, revision, changed_by_person_id, changed_at
       ) VALUES (
         'production','founding_household_v1','family_v1_monthly_1499','active',1,
         '2099-09-01T00:00:00.000Z',true,1,'person-stripe-control',
         '2026-08-25T00:00:00.000Z'
       );
       INSERT INTO commerce_stripe_initiation_controls(
         environment, state, revision, changed_by_person_id, reason_code, changed_at
       ) VALUES (
         'production','enabled',1,'person-stripe-control','founder_live_activation',
         '2026-08-25T00:00:00.000Z'
       );`,
    );
    await expect(
      database.exec(
        `UPDATE commerce_stripe_cohort_policies
         SET state = 'disabled', revision = 2, changed_at = '2026-08-25T00:01:00.000Z'
         WHERE environment = 'production'`,
      ),
    ).rejects.toThrow(/Disable live Stripe initiation/u);
    await expect(
      database.exec(
        `INSERT INTO commerce_stripe_initiation_controls(
           environment, state, revision, changed_by_person_id, reason_code, changed_at
         ) VALUES (
           'production','disabled',2,'person-stripe-control','incident_stop',
           '2026-08-25T00:02:00.000Z'
         ) ON CONFLICT (environment) DO UPDATE SET
           state = EXCLUDED.state, revision = EXCLUDED.revision,
           changed_by_person_id = EXCLUDED.changed_by_person_id,
           reason_code = EXCLUDED.reason_code, changed_at = EXCLUDED.changed_at`,
      ),
    ).resolves.toBeUndefined();
    const disabled = await database.query<{ readonly state: string; readonly revision: number }>(
      `SELECT state, revision FROM commerce_stripe_initiation_controls
       WHERE environment = 'production'`,
    );
    expect(disabled.rows[0]).toEqual({ state: 'disabled', revision: 2 });
    await expect(
      database.exec(
        `UPDATE commerce_stripe_cohort_policies
         SET state = 'disabled', max_active = 0, live_approved = false,
             revision = 2, changed_at = '2026-08-25T00:03:00.000Z'
         WHERE environment = 'production'`,
      ),
    ).resolves.toBeUndefined();
  });

  it('records complete immutable cohort events and permits bounded live repair schemas', async () => {
    database = await createPGliteDatabase(':memory:');
    await runMigrations(database);
    await database.exec(
      `INSERT INTO persons(id, display_name, created_at)
       VALUES ('person-stripe-event','Stripe Event','2026-08-25T00:00:00.000Z');
       INSERT INTO commerce_stripe_cohort_policy_events_v2(
         id, environment, previous_state, next_state, previous_max_active, next_max_active,
         previous_policy_expires_at, next_policy_expires_at, previous_live_approved,
         next_live_approved, expected_revision, next_revision, actor_person_id, reason_code,
         correlation_id, occurred_at
       ) VALUES (
         'stripe-cohort-event-1','production','absent','active',NULL,1,NULL,
         '2099-09-01T00:00:00.000Z',NULL,true,0,1,'person-stripe-event',
         'cohort_activation','stripe-cohort-correlation-1','2026-08-25T00:00:00.000Z'
       );`,
    );
    await expect(
      database.exec(
        `UPDATE commerce_stripe_cohort_policy_events_v2
         SET next_max_active = 4 WHERE id = 'stripe-cohort-event-1'`,
      ),
    ).rejects.toThrow(/append-only/u);

    const constraints = await database.query<{
      readonly conname: string;
      readonly definition: string;
    }>(
      `SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
       WHERE conname IN (
         'commerce_stripe_preflight_live_account_exact_check',
         'commerce_stripe_session_retry_repair_environment_check',
         'commerce_stripe_reconciliation_repair_environment_check'
       ) ORDER BY conname`,
    );
    expect(constraints.rows).toHaveLength(3);
    for (const constraint of constraints.rows.filter(
      ({ conname }) => !conname.includes('preflight'),
    )) {
      expect(constraint.definition).toContain("'production'::text");
      expect(constraint.definition).toContain("'test'::text");
    }
    const liveAccountConstraint = constraints.rows.find(({ conname }) =>
      conname.includes('preflight'),
    )?.definition;
    expect(liveAccountConstraint).toContain('account_charges_enabled IS TRUE');
    expect(liveAccountConstraint).toContain('account_payouts_enabled IS TRUE');
    expect(liveAccountConstraint).toMatch(
      /(?:account_country IS NOT DISTINCT FROM|NOT \(account_country IS DISTINCT FROM)[^)]*'US'/u,
    );
    expect(liveAccountConstraint).toMatch(
      /(?:account_business_type IS NOT DISTINCT FROM|NOT \(account_business_type IS DISTINCT FROM)[^)]*'company'/u,
    );
  });
});

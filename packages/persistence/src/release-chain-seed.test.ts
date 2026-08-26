import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testArtifactProtection } from '@boomerbuddy/testkit';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createPGliteDatabase,
  type Database,
  type QueryResult,
  type SqlExecutor,
} from './database';
import { migrationDirectory, runMigrations } from './migrations';
import { seedDemoData } from './seed';

const releaseMigrations = [
  '0001_initial.sql',
  '0002_run2_authority_consent.sql',
  '0003_run2_commerce_jobs.sql',
  '0004_run2_intelligence_public.sql',
  '0005_run2_business_os.sql',
  '0006_run2_commerce_runtime.sql',
  '0007_run2_public_check_conversion.sql',
  '0008_run2_public_abuse_privacy.sql',
  '0009_run2_growth_runtime.sql',
  '0010_run2_operational_jobs.sql',
  '0011_run2_outbox_causal_replay.sql',
  '0012_run2_growth_replay_lineage.sql',
  '0013_run3_automation_budget_ledger.sql',
  '0014_run3_public_check_continuity.sql',
  '0015_run3_external_actions.sql',
  '0016_run3_stripe_first_dollar.sql',
  '0017_run3_founder_provisioning.sql',
  '0018_run3_stripe_adversarial_remediation.sql',
  '0019_run3_founding_households.sql',
  '0020_run3_feedback_learning.sql',
  '0021_run3_consent_messaging.sql',
  '0022_run3_editorial_intelligence.sql',
  '0023_run3_referral_credit_engine.sql',
  '0024_run3_1_production_identity.sql',
  '0025_run3_1_authenticated_feedback.sql',
  '0026_run3_1_production_founding_households.sql',
  '0027_run3_1_feedback_founding_quota.sql',
  '0028_run3_1_billing_authority_workflow.sql',
  '0029_run3_1_stripe_live_control_plane.sql',
  '0030_run3_1_billing_reverification_binding.sql',
  '0031_run3_1_mobile_session_retention.sql',
  '0032_run3_1_private_beta_access_intents.sql',
  '0033_run3_1_billing_recovery_evidence.sql',
  '0034_run3_1_support_receipts.sql',
  '0035_run3_1_paid_family_catalog.sql',
] as const;

const now = new Date('2026-08-17T12:00:00.000Z');

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

function withSeedQueryFailure(target: Database, sqlFragment: string): Database {
  return {
    kind: target.kind,
    query: <Row extends Record<string, unknown>>(sql: string, parameters?: readonly unknown[]) =>
      target.query<Row>(sql, parameters),
    exec: (sql: string) => target.exec(sql),
    transaction: <Result>(work: (transaction: SqlExecutor) => Promise<Result>) =>
      target.transaction((transaction) =>
        work({
          exec: (sql: string) => transaction.exec(sql),
          query: <Row extends Record<string, unknown>>(
            sql: string,
            parameters?: readonly unknown[],
          ): Promise<QueryResult<Row>> => {
            if (sql.includes(sqlFragment)) {
              throw new Error('induced seed transaction failure');
            }
            return transaction.query<Row>(sql, parameters);
          },
        }),
      ),
    close: async () => undefined,
  };
}

async function publicTableCounts(database: Database): Promise<Record<string, number>> {
  const tables = await database.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  const counts = await Promise.all(
    tables.rows.map(async ({ tablename }) => {
      if (!/^[a-z0-9_]+$/u.test(tablename)) throw new Error(`Unsafe table name: ${tablename}`);
      const result = await database.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM "${tablename}"`,
      );
      return [tablename, result.rows[0]?.count ?? 0] as const;
    }),
  );
  return Object.fromEntries(counts);
}

describe('frozen release migration and demo seed chain', () => {
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

  it('applies exactly 0001 through 0035 and seeds stable local Stage 7 and support fixtures once', async () => {
    database = await createPGliteDatabase();

    await expect(runMigrations(database)).resolves.toEqual(releaseMigrations);
    await expect(runMigrations(database)).resolves.toEqual([]);
    await expect(seedDemoData(database, testArtifactProtection(), 'test', now)).resolves.toBe(
      'seeded',
    );
    const countsAfterFirstSeed = await publicTableCounts(database);
    await expect(seedDemoData(database, testArtifactProtection(), 'test', now)).resolves.toBe(
      'already_seeded',
    );
    await expect(publicTableCounts(database)).resolves.toEqual(countsAfterFirstSeed);

    const stage7Organizations = await database.query<{
      id: string;
      verification_state: string;
    }>(
      `SELECT id, verification_state FROM organizations
       WHERE id = 'organization-founding-households-local' ORDER BY id`,
    );
    const stage7Sponsorships = await database.query<{
      id: string;
      organization_id: string;
      plan_version_id: string;
    }>(
      `SELECT id, organization_id, plan_version_id FROM commerce_sponsorships
       WHERE id LIKE 'founding-sponsorship-%-local-v1' ORDER BY id`,
    );
    const stage7Backings = await database.query<{
      benefit_key: string;
      sponsorship_id: string;
      plan_version_id: string;
    }>(
      `SELECT benefit_key, sponsorship_id, plan_version_id
       FROM founding_household_sponsor_backings ORDER BY benefit_key`,
    );
    const samFixtures = await database.query<{
      person_id: string;
      identity_id: string;
      employee_assignment_id: string;
      support_case_id: string;
      support_assignment_id: string;
    }>(
      `SELECT person.id AS person_id, identity.id AS identity_id,
              employee.id AS employee_assignment_id, support.id AS support_case_id,
              assignment.employee_assignment_id AS support_assignment_id
       FROM persons person
       JOIN identities identity ON identity.person_id = person.id
       JOIN employee_assignments employee ON employee.person_id = person.id
       JOIN support_case_assignments assignment
         ON assignment.employee_assignment_id = employee.id
       JOIN support_cases support
         ON support.household_id = assignment.household_id AND support.id = assignment.case_id
       WHERE person.id = 'person-hq-sam'`,
    );

    expect(stage7Organizations.rows).toEqual([
      {
        id: 'organization-founding-households-local',
        verification_state: 'local_fixture',
      },
    ]);
    expect(stage7Sponsorships.rows).toEqual([
      {
        id: 'founding-sponsorship-family-local-v1',
        organization_id: 'organization-founding-households-local',
        plan_version_id: 'founding_family_beta_v2',
      },
      {
        id: 'founding-sponsorship-plus-local-v1',
        organization_id: 'organization-founding-households-local',
        plan_version_id: 'founding_plus_beta_v2',
      },
    ]);
    expect(stage7Backings.rows).toEqual([
      {
        benefit_key: 'family_beta_v1',
        sponsorship_id: 'founding-sponsorship-family-local-v1',
        plan_version_id: 'founding_family_beta_v2',
      },
      {
        benefit_key: 'plus_beta_v1',
        sponsorship_id: 'founding-sponsorship-plus-local-v1',
        plan_version_id: 'founding_plus_beta_v2',
      },
    ]);
    expect(samFixtures.rows).toEqual([
      {
        person_id: 'person-hq-sam',
        identity_id: 'identity-hq-sam',
        employee_assignment_id: 'employee-hq-sam',
        support_case_id: 'support-case-seeded-sam',
        support_assignment_id: 'employee-hq-sam',
      },
    ]);
  }, 60_000);

  it('keeps an old marked run1 database untouched while applying 0019 through 0027', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-release-old-seed-'));
    await copyMigrationsThrough(
      sourceDirectory,
      temporaryDirectory,
      '0018_run3_stripe_adversarial_remediation.sql',
    );
    database = await createPGliteDatabase();
    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual(
      releaseMigrations.slice(0, 18),
    );
    await database.query(
      `INSERT INTO persons(id, display_name, created_at)
       VALUES ('person-owner-alice','Alice Owner (pre-0019)',$1)`,
      [now.toISOString()],
    );
    await database.query(
      `INSERT INTO local_demo_bootstraps(bootstrap_key, bootstrap_mode, completed_at)
       VALUES ('run1-v1','empty_database',$1)`,
      [now.toISOString()],
    );

    for (const migration of releaseMigrations.slice(18)) {
      await copyFile(join(sourceDirectory, migration), join(temporaryDirectory, migration));
    }
    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual(
      releaseMigrations.slice(18),
    );
    await expect(seedDemoData(database, testArtifactProtection(), 'test', now)).resolves.toBe(
      'already_seeded',
    );

    const people = await database.query<{ id: string; display_name: string }>(
      'SELECT id, display_name FROM persons ORDER BY id',
    );
    const stage7Fixtures = await database.query<{
      organizations: number;
      sponsorships: number;
      backings: number;
    }>(
      `SELECT
         (SELECT count(*)::integer FROM organizations
          WHERE id = 'organization-founding-households-local') AS organizations,
         (SELECT count(*)::integer FROM commerce_sponsorships
          WHERE id LIKE 'founding-sponsorship-%-local-v1') AS sponsorships,
         (SELECT count(*)::integer FROM founding_household_sponsor_backings) AS backings`,
    );
    const laterStageFixtures = await database.query<{
      messaging_destinations: number;
      editorial_sources: number;
      referral_programs: number;
      production_customers: number;
      production_founders: number;
      production_founding_authorities: number;
      production_founding_policies: number;
      live_feedback: number;
      authenticated_feedback_quota: number;
    }>(
      `SELECT
         (SELECT count(*)::integer FROM messaging_destinations) AS messaging_destinations,
         (SELECT count(*)::integer FROM editorial_source_versions) AS editorial_sources,
         (SELECT count(*)::integer FROM run3_referral_program_versions) AS referral_programs,
         (SELECT count(*)::integer FROM production_customer_bootstraps) AS production_customers,
         (SELECT count(*)::integer FROM production_founder_bootstraps) AS production_founders,
         (SELECT count(*)::integer FROM founding_household_founder_authorities
          WHERE environment = 'production') AS production_founding_authorities,
         (SELECT count(*)::integer FROM founding_household_policy_versions
          WHERE environment = 'production' AND state = 'active') AS production_founding_policies,
         (SELECT count(*)::integer FROM feedback_records
          WHERE evidence_tier = 'live_production') AS live_feedback,
         (SELECT count(*)::integer FROM feedback_authenticated_quota_charges)
           AS authenticated_feedback_quota`,
    );
    expect(people.rows).toEqual([
      { id: 'person-owner-alice', display_name: 'Alice Owner (pre-0019)' },
    ]);
    expect(stage7Fixtures.rows).toEqual([{ organizations: 0, sponsorships: 0, backings: 0 }]);
    expect(laterStageFixtures.rows).toEqual([
      {
        messaging_destinations: 0,
        editorial_sources: 0,
        referral_programs: 0,
        production_customers: 0,
        production_founders: 0,
        production_founding_authorities: 0,
        production_founding_policies: 0,
        live_feedback: 0,
        authenticated_feedback_quota: 0,
      },
    ]);
  }, 60_000);

  it('rolls back a late seed failure completely and permits one successful retry', async () => {
    database = await createPGliteDatabase();
    await runMigrations(database);
    const before = await publicTableCounts(database);
    const failingDatabase = withSeedQueryFailure(database, 'INSERT INTO local_demo_bootstraps');

    await expect(
      seedDemoData(failingDatabase, testArtifactProtection(), 'test', now),
    ).rejects.toThrow('induced seed transaction failure');
    await expect(publicTableCounts(database)).resolves.toEqual(before);

    await expect(seedDemoData(database, testArtifactProtection(), 'test', now)).resolves.toBe(
      'seeded',
    );
    await expect(seedDemoData(database, testArtifactProtection(), 'test', now)).resolves.toBe(
      'already_seeded',
    );
    const marker = await database.query<{ bootstrap_key: string }>(
      'SELECT bootstrap_key FROM local_demo_bootstraps',
    );
    expect(marker.rows).toEqual([{ bootstrap_key: 'run1-v1' }]);
  }, 60_000);
});

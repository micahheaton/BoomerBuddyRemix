import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createPGliteDatabase, type Database } from './database';
import { migrationDirectory, runMigrations } from './migrations';

const previousMigration = '0034_run3_1_support_receipts.sql';
const migration = '0035_run3_1_paid_family_catalog.sql';

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

async function insertFamilyMonthlyPlan(
  database: Database,
  state: 'active' | 'hypothesis',
): Promise<void> {
  await database.exec(`
    INSERT INTO commerce_plan_versions(
      id, product_version_id, plan_key, version, display_name, state,
      capabilities, allowances, prices, available_from, created_at
    ) VALUES (
      'family_v1', 'consumer_household_v1', 'family', 1, 'Family', '${state}',
      '["check:text","check:url","history:read","family:manage","orientation:use"]'::jsonb,
      '[{"kind":"protected_members","limit":3},{"kind":"trusted_circle_participants","limit":6}]'::jsonb,
      '[{"interval":"month","amountMinor":1499,"currency":"USD","kind":"list"}]'::jsonb,
      '2026-08-15T00:00:00.000Z', '2026-08-17T12:00:00.000Z'
    );
  `);
}

async function insertLegacyAnnualFamilyPlan(database: Database): Promise<void> {
  await database.exec(`
    INSERT INTO commerce_plan_versions(
      id, product_version_id, plan_key, version, display_name, state,
      capabilities, allowances, prices, available_from, created_at
    ) VALUES (
      'family_v1', 'consumer_household_v1', 'family', 1, 'Family', 'hypothesis',
      '["check:text","check:url","history:read","family:manage","orientation:use"]'::jsonb,
      '[{"kind":"protected_members","limit":3},{"kind":"trusted_circle_participants","limit":6}]'::jsonb,
      '[{"interval":"month","amountMinor":1499,"currency":"USD","kind":"list"},
        {"interval":"year","amountMinor":14900,"currency":"USD","kind":"list"}]'::jsonb,
      '2026-08-15T00:00:00.000Z', '2026-08-17T12:00:00.000Z'
    );
  `);
}

describe('paid Family catalogue forward migration', () => {
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

  async function migrateThrough0034(): Promise<string> {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-paid-family-catalogue-'));
    await copyMigrationsThrough(sourceDirectory, temporaryDirectory, previousMigration);
    database = await createPGliteDatabase(':memory:');
    await expect(runMigrations(database, temporaryDirectory)).resolves.toHaveLength(34);
    return sourceDirectory;
  }

  async function apply0035(sourceDirectory: string): Promise<void> {
    if (database === undefined || temporaryDirectory === undefined) {
      throw new Error('Paid Family migration fixture is unavailable');
    }
    await copyFile(join(sourceDirectory, migration), join(temporaryDirectory, migration));
    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual([migration]);
  }

  it('adds only the exact Family monthly candidate and binds its Stripe offer', async () => {
    const sourceDirectory = await migrateThrough0034();
    if (database === undefined) throw new Error('Paid Family migration database is unavailable');

    await expect(
      database.query(`SELECT 1 FROM commerce_plan_versions WHERE id = 'family_v1'`),
    ).resolves.toMatchObject({ rows: [] });

    await apply0035(sourceDirectory);

    const catalogue = await database.query<{
      readonly plan_matches: boolean;
      readonly offer_matches: boolean;
    }>(`
      SELECT
        EXISTS (
          SELECT 1 FROM commerce_plan_versions plan
          WHERE plan.id = 'family_v1'
            AND plan.product_version_id = 'consumer_household_v1'
            AND plan.plan_key = 'family'
            AND plan.version = 1
            AND plan.display_name = 'Family'
            AND plan.state = 'hypothesis'
            AND plan.capabilities =
              '["check:text","check:url","history:read","family:manage","orientation:use"]'::jsonb
            AND plan.allowances =
              '[{"kind":"protected_members","limit":3},{"kind":"trusted_circle_participants","limit":6}]'::jsonb
            AND plan.prices =
              '[{"interval":"month","amountMinor":1499,"currency":"USD","kind":"list"}]'::jsonb
            AND plan.available_from = '2026-08-15T00:00:00.000Z'::timestamptz
            AND plan.available_until IS NULL
        ) AS plan_matches,
        EXISTS (
          SELECT 1 FROM commerce_stripe_offer_contracts offer
          WHERE offer.offer_id = 'founding_family_monthly_v1'
            AND offer.plan_version_id = 'family_v1'
            AND offer.billing_interval = 'month'
            AND offer.currency = 'usd'
            AND offer.unit_amount_minor = 1499
            AND offer.quantity = 1
        ) AS offer_matches
    `);
    const foreignKey = await database.query<{
      readonly column_name: string;
      readonly foreign_table_name: string;
      readonly foreign_column_name: string;
    }>(`
      SELECT key_column.column_name,
             foreign_column.table_name AS foreign_table_name,
             foreign_column.column_name AS foreign_column_name
      FROM information_schema.table_constraints constraint_row
      JOIN information_schema.key_column_usage key_column
        ON key_column.constraint_catalog = constraint_row.constraint_catalog
       AND key_column.constraint_schema = constraint_row.constraint_schema
       AND key_column.constraint_name = constraint_row.constraint_name
      JOIN information_schema.constraint_column_usage foreign_column
        ON foreign_column.constraint_catalog = constraint_row.constraint_catalog
       AND foreign_column.constraint_schema = constraint_row.constraint_schema
       AND foreign_column.constraint_name = constraint_row.constraint_name
      WHERE constraint_row.constraint_schema = 'public'
        AND constraint_row.table_name = 'commerce_stripe_offer_contracts'
        AND constraint_row.constraint_name =
          'commerce_stripe_offer_contracts_plan_version_fk'
        AND constraint_row.constraint_type = 'FOREIGN KEY'
    `);

    expect(catalogue.rows).toEqual([{ plan_matches: true, offer_matches: true }]);
    expect(foreignKey.rows).toEqual([
      {
        column_name: 'plan_version_id',
        foreign_table_name: 'commerce_plan_versions',
        foreign_column_name: 'id',
      },
    ]);
  }, 60_000);

  it('accepts an exact pre-existing monthly row with its original created_at', async () => {
    const sourceDirectory = await migrateThrough0034();
    if (database === undefined) throw new Error('Paid Family migration database is unavailable');
    await insertFamilyMonthlyPlan(database, 'hypothesis');

    await apply0035(sourceDirectory);

    const plans = await database.query<{ readonly count: number }>(
      `SELECT count(*)::integer AS count
       FROM commerce_plan_versions WHERE id = 'family_v1'`,
    );
    expect(plans.rows).toEqual([{ count: 1 }]);
  }, 60_000);

  it('fails closed when family_v1 already has conflicting immutable semantics', async () => {
    const sourceDirectory = await migrateThrough0034();
    if (database === undefined || temporaryDirectory === undefined) {
      throw new Error('Paid Family migration fixture is unavailable');
    }
    await insertFamilyMonthlyPlan(database, 'active');
    await copyFile(join(sourceDirectory, migration), join(temporaryDirectory, migration));

    await expect(runMigrations(database, temporaryDirectory)).rejects.toThrow(
      /Paid Family plan catalogue conflict/u,
    );
    const recorded = await database.query<{ readonly count: number }>(
      `SELECT count(*)::integer AS count
       FROM schema_migrations WHERE version = '0035_run3_1_paid_family_catalog.sql'`,
    );
    expect(recorded.rows).toEqual([{ count: 0 }]);
  }, 60_000);

  it('stops before 0035 when an older database contains the deferred annual Family row', async () => {
    const sourceDirectory = await migrateThrough0034();
    if (database === undefined || temporaryDirectory === undefined) {
      throw new Error('Paid Family migration fixture is unavailable');
    }
    await insertLegacyAnnualFamilyPlan(database);
    for (const file of [
      '0035_run3_1_paid_family_catalog.sql',
      '0036_run3_1_protected_self_enrollment.sql',
      '0037_run3_1_paid_family_entitlement_repair.sql',
    ]) {
      await copyFile(join(sourceDirectory, file), join(temporaryDirectory, file));
    }

    await expect(runMigrations(database, temporaryDirectory)).rejects.toThrow(
      /Paid Family plan catalogue conflict/u,
    );
    const recorded = await database.query<
      { readonly migration_count: number; readonly repair_column_count: number } & Record<
        string,
        unknown
      >
    >(
      `SELECT
         (SELECT count(*)::integer FROM schema_migrations
          WHERE version >= '0035_run3_1_paid_family_catalog.sql') AS migration_count,
         (SELECT count(*)::integer FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'commerce_stripe_session_operations'
            AND column_name = 'preflight_record_id') AS repair_column_count`,
    );
    expect(recorded.rows).toEqual([{ migration_count: 0, repair_column_count: 0 }]);
  }, 60_000);
});

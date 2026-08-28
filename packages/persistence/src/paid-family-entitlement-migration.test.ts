import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createPGliteDatabase, type Database } from './database';
import { migrationDirectory, runMigrations } from './migrations';

const previousMigration = '0036_run3_1_protected_self_enrollment.sql';
const migration = '0037_run3_1_paid_family_entitlement_repair.sql';

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

describe('paid Family entitlement forward migration', () => {
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

  it('adds an environment-bound preflight receipt and runtime-aware fail-closed helpers', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-paid-family-entitlement-'));
    await copyMigrationsThrough(sourceDirectory, temporaryDirectory, previousMigration);
    database = await createPGliteDatabase(':memory:');
    await expect(runMigrations(database, temporaryDirectory)).resolves.toHaveLength(36);
    await copyFile(join(sourceDirectory, migration), join(temporaryDirectory, migration));
    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual([migration]);
    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual([]);

    const column = await database.query<
      { readonly column_name: string; readonly is_nullable: string } & Record<string, unknown>
    >(
      `SELECT column_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'commerce_stripe_session_operations'
         AND column_name = 'preflight_record_id'`,
    );
    expect(column.rows).toEqual([{ column_name: 'preflight_record_id', is_nullable: 'YES' }]);

    const constraint = await database.query<
      { readonly definition: string } & Record<string, unknown>
    >(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conname = 'commerce_stripe_operation_preflight_environment_fk'`,
    );
    expect(constraint.rows[0]?.definition).toContain(
      'FOREIGN KEY (preflight_record_id, environment)',
    );
    expect(constraint.rows[0]?.definition).toContain(
      'commerce_stripe_preflight_records(id, environment)',
    );
    const productionConstraint = await database.query<
      { readonly definition: string } & Record<string, unknown>
    >(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conname = 'commerce_stripe_production_operation_preflight_check'`,
    );
    expect(productionConstraint.rows[0]?.definition).toContain("environment <> 'production'");
    expect(productionConstraint.rows[0]?.definition).toContain('preflight_record_id IS NOT NULL');

    const functions = await database.query<
      {
        readonly function_name: string;
        readonly argument_count: number;
        readonly definition: string;
      } & Record<string, unknown>
    >(
      `SELECT routine.proname AS function_name,
              routine.pronargs::integer AS argument_count,
              pg_get_functiondef(routine.oid) AS definition
       FROM pg_proc routine
       WHERE routine.proname IN (
         'commerce_hypothesis_subscription_backing_supports',
         'founding_household_allowance_grant_supports',
         'require_founding_household_enrollment_completion',
         'require_founding_household_allowance_rebinding'
       )
       ORDER BY routine.proname, routine.pronargs`,
    );
    const fiveArgumentHelper = functions.rows.find(
      (row) =>
        row.function_name === 'founding_household_allowance_grant_supports' &&
        row.argument_count === 5,
    );
    const sixArgumentHelper = functions.rows.find(
      (row) =>
        row.function_name === 'founding_household_allowance_grant_supports' &&
        row.argument_count === 6,
    );
    expect(fiveArgumentHelper?.definition).toContain('SELECT false');
    expect(sixArgumentHelper?.definition).toContain(
      'commerce_hypothesis_subscription_backing_supports',
    );
    for (const triggerName of [
      'require_founding_household_enrollment_completion',
      'require_founding_household_allowance_rebinding',
    ]) {
      const definition = functions.rows.find(
        (row) => row.function_name === triggerName,
      )?.definition;
      expect(definition).toContain('founding_household_allowance_grant_supports');
      expect(definition).toContain("environment = 'production'");
    }

    const failClosed = await database.query<
      {
        readonly legacy: boolean;
        readonly null_runtime: boolean;
        readonly invalid_runtime: boolean;
      } & Record<string, unknown>
    >(
      `SELECT
         founding_household_allowance_grant_supports(
           'missing-household','missing-grant','protected_members',CURRENT_TIMESTAMP,true
         ) AS legacy,
         commerce_hypothesis_subscription_backing_supports(
           'missing-household','missing-subscription',NULL,CURRENT_TIMESTAMP
         ) AS null_runtime,
         commerce_hypothesis_subscription_backing_supports(
           'missing-household','missing-subscription','staging',CURRENT_TIMESTAMP
         ) AS invalid_runtime`,
    );
    expect(failClosed.rows).toEqual([
      { legacy: false, null_runtime: false, invalid_runtime: false },
    ]);
  }, 60_000);

  it('stops transactionally when a production operation lacks exact preflight lineage', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-paid-family-entitlement-'));
    await copyMigrationsThrough(sourceDirectory, temporaryDirectory, previousMigration);
    database = await createPGliteDatabase(':memory:');
    await expect(runMigrations(database, temporaryDirectory)).resolves.toHaveLength(36);
    await database.query(
      `INSERT INTO households(id, name) VALUES ('household-production-operation', 'Synthetic')`,
    );
    await database.query(
      `INSERT INTO commerce_stripe_session_operations(
         id, household_id, action, environment, server_operation_id,
         provider_idempotency_key, state, attempt_count, created_at, updated_at
       ) VALUES (
         'operation-without-preflight', 'household-production-operation', 'portal',
         'production', 'server-operation-without-preflight',
         'provider-operation-without-preflight', 'prepared', 0,
         '2026-08-27T00:00:00.000Z', '2026-08-27T00:00:00.000Z'
       )`,
    );
    await copyFile(join(sourceDirectory, migration), join(temporaryDirectory, migration));

    await expect(runMigrations(database, temporaryDirectory)).rejects.toThrow(
      /commerce_stripe_production_operation_preflight_check/u,
    );
    const rollback = await database.query<
      { readonly migration_count: number; readonly column_count: number } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::integer FROM schema_migrations WHERE version = $1) AS migration_count,
         (SELECT count(*)::integer FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'commerce_stripe_session_operations'
            AND column_name = 'preflight_record_id') AS column_count`,
      [migration],
    );
    expect(rollback.rows).toEqual([{ migration_count: 0, column_count: 0 }]);
  }, 60_000);
});

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

describe('Stripe adversarial remediation forward migration', () => {
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

  it('applies the complete 0001 through 0018 chain on PGlite', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-stripe-0018-'));
    await copyMigrationsThrough(
      sourceDirectory,
      temporaryDirectory,
      '0018_run3_stripe_adversarial_remediation.sql',
    );
    database = await createPGliteDatabase();

    await expect(runMigrations(database, temporaryDirectory)).resolves.toHaveLength(18);
    const lineageColumns = await database.query<
      {
        readonly column_name: string;
        readonly is_nullable: string;
        readonly table_name: string;
      } & Record<string, unknown>
    >(
      `SELECT table_name, column_name, is_nullable
       FROM information_schema.columns
       WHERE (table_name = 'commerce_stripe_paid_invoice_evidence'
                AND column_name = 'provider_invoice_payment_id')
          OR (table_name = 'commerce_stripe_failed_invoice_evidence'
                AND column_name = 'provider_invoice_payment_id')
          OR (table_name = 'commerce_stripe_session_operations'
                AND column_name IN ('authorized_attempt_limit','manual_retry_revision'))
          OR (table_name = 'commerce_checkout_intents'
                AND column_name = 'legacy_short_material_expiry')
       ORDER BY table_name, column_name`,
    );
    expect(lineageColumns.rows).toEqual([
      {
        table_name: 'commerce_checkout_intents',
        column_name: 'legacy_short_material_expiry',
        is_nullable: 'NO',
      },
      {
        table_name: 'commerce_stripe_failed_invoice_evidence',
        column_name: 'provider_invoice_payment_id',
        is_nullable: 'YES',
      },
      {
        table_name: 'commerce_stripe_paid_invoice_evidence',
        column_name: 'provider_invoice_payment_id',
        is_nullable: 'YES',
      },
      {
        table_name: 'commerce_stripe_session_operations',
        column_name: 'authorized_attempt_limit',
        is_nullable: 'NO',
      },
      {
        table_name: 'commerce_stripe_session_operations',
        column_name: 'manual_retry_revision',
        is_nullable: 'NO',
      },
    ]);
    const repairLedger = await database.query<
      { readonly table_name: string } & Record<string, unknown>
    >(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'commerce_stripe_session_retry_repair_events'`,
    );
    expect(repairLedger.rows).toEqual([
      { table_name: 'commerce_stripe_session_retry_repair_events' },
    ]);
  });

  it('upgrades an applied 0017 database with only the forward 0018 migration', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-stripe-0018-upgrade-'));
    await copyMigrationsThrough(
      sourceDirectory,
      temporaryDirectory,
      '0017_run3_founder_provisioning.sql',
    );
    database = await createPGliteDatabase();
    await expect(runMigrations(database, temporaryDirectory)).resolves.toHaveLength(17);

    await database.exec(
      `INSERT INTO persons(id, display_name, created_at)
       VALUES ('person-legacy-checkout','Legacy Owner','2026-08-01T00:00:00.000Z');
       INSERT INTO households(id, name, created_at)
       VALUES ('household-legacy-checkout','Legacy Household','2026-08-01T00:00:00.000Z');
       INSERT INTO household_memberships(
         household_id, id, person_id, membership_kind, status, created_at
       ) VALUES (
         'household-legacy-checkout','membership-legacy-checkout','person-legacy-checkout',
         'member','active','2026-08-01T00:00:00.000Z'
       );
       INSERT INTO household_billing_authorities(
         household_id, person_id, status, granted_by_person_id, granted_at
       ) VALUES (
         'household-legacy-checkout','person-legacy-checkout','active',
         'person-legacy-checkout','2026-08-01T00:00:00.000Z'
       );
       INSERT INTO commerce_product_versions(
         id, product_key, version, display_name, available_from, created_at
       ) VALUES (
         'product-legacy-checkout','consumer_household',91,'Legacy fixture',
         '2026-08-01T00:00:00.000Z','2026-08-01T00:00:00.000Z'
       );
       INSERT INTO commerce_plan_versions(
         id, product_version_id, plan_key, version, display_name, state,
         capabilities, allowances, prices, available_from, created_at
       ) VALUES (
         'family_v1','product-legacy-checkout','family',91,'Legacy family','active',
         '{}'::jsonb,'{}'::jsonb,'{}'::jsonb,
         '2026-08-01T00:00:00.000Z','2026-08-01T00:00:00.000Z'
       );
       INSERT INTO commerce_subscriptions(
         household_id, id, payer_person_id, plan_version_id, source, lifecycle,
         source_verified, precedence, current_period_starts_at, reconciliation_state,
         created_at, updated_at
       ) VALUES (
         'household-legacy-checkout','subscription-legacy-checkout','person-legacy-checkout',
         'family_v1','web','pending',false,300,'2026-08-01T00:00:00.000Z',
         'pending','2026-08-01T00:00:00.000Z','2026-08-01T00:00:00.000Z'
       );
       INSERT INTO commerce_checkout_intents(
         household_id, id, subscription_id, requested_by_person_id,
         billing_authority_person_id, plan_version_id, offer_id, billing_interval,
         provider_price_id, provider, environment, idempotency_key, state,
         created_at, updated_at, expires_at
       ) VALUES (
         'household-legacy-checkout','checkout-legacy-30m','subscription-legacy-checkout',
         'person-legacy-checkout','person-legacy-checkout','family_v1',
         'founding_family_monthly_v1','month',
         'price_legacy_fixture','stripe','test','legacy-checkout-key-0001','prepared',
         '2026-08-01T00:00:00.000Z','2026-08-01T00:00:00.000Z',
         '2026-08-01T00:30:00.000Z'
       );`,
    );

    await copyFile(
      join(sourceDirectory, '0018_run3_stripe_adversarial_remediation.sql'),
      join(temporaryDirectory, '0018_run3_stripe_adversarial_remediation.sql'),
    );
    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual([
      '0018_run3_stripe_adversarial_remediation.sql',
    ]);
    const legacy = await database.query<
      {
        readonly expires_at: unknown;
        readonly legacy_short_material_expiry: boolean;
      } & Record<string, unknown>
    >(
      `SELECT expires_at, legacy_short_material_expiry FROM commerce_checkout_intents
       WHERE household_id = 'household-legacy-checkout' AND id = 'checkout-legacy-30m'`,
    );
    expect(new Date(String(legacy.rows[0]?.expires_at)).toISOString()).toBe(
      '2026-08-01T00:30:00.000Z',
    );
    expect(legacy.rows[0]?.legacy_short_material_expiry).toBe(true);

    await expect(
      database.exec(
        `INSERT INTO commerce_checkout_intents(
           household_id, id, subscription_id, requested_by_person_id,
           billing_authority_person_id, plan_version_id, offer_id, billing_interval,
           provider_price_id, provider, environment, idempotency_key, state,
           created_at, updated_at, expires_at
         ) VALUES (
           'household-legacy-checkout','checkout-new-short','subscription-legacy-checkout',
           'person-legacy-checkout','person-legacy-checkout','family_v1',
           'founding_family_monthly_v1','month','price_legacy_fixture','stripe','test',
           'new-short-checkout-key-0001','prepared','2026-08-02T00:00:00.000Z',
           '2026-08-02T00:00:00.000Z','2026-08-02T00:30:00.000Z'
         )`,
      ),
    ).rejects.toThrow(/commerce_checkout_material_expiry_check/u);

    await expect(
      database.exec(
        `INSERT INTO commerce_checkout_intents(
           household_id, id, subscription_id, requested_by_person_id,
           billing_authority_person_id, plan_version_id, offer_id, billing_interval,
           provider_price_id, provider, environment, idempotency_key, state,
           created_at, updated_at, expires_at
         ) VALUES (
           'household-legacy-checkout','checkout-new-four-hours',
           'subscription-legacy-checkout','person-legacy-checkout','person-legacy-checkout',
           'family_v1','founding_family_monthly_v1','month',
           'price_legacy_fixture','stripe','test','new-valid-checkout-key-0001','prepared',
           '2026-08-02T00:00:00.000Z','2026-08-02T00:00:00.000Z',
           '2026-08-02T04:00:00.000Z'
         )`,
      ),
    ).resolves.toBeUndefined();
    const fresh = await database.query<
      { readonly legacy_short_material_expiry: boolean } & Record<string, unknown>
    >(
      `SELECT legacy_short_material_expiry FROM commerce_checkout_intents
       WHERE household_id = 'household-legacy-checkout'
         AND id = 'checkout-new-four-hours'`,
    );
    expect(fresh.rows[0]?.legacy_short_material_expiry).toBe(false);

    await expect(
      database.exec(
        `INSERT INTO commerce_checkout_intents(
           household_id, id, subscription_id, requested_by_person_id,
           billing_authority_person_id, plan_version_id, offer_id, billing_interval,
           provider_price_id, provider, environment, idempotency_key, state,
           created_at, updated_at, expires_at, legacy_short_material_expiry
         ) VALUES (
           'household-legacy-checkout','checkout-forged-legacy','subscription-legacy-checkout',
           'person-legacy-checkout','person-legacy-checkout','family_v1',
           'founding_family_monthly_v1','month','price_legacy_fixture','stripe','test',
           'forged-legacy-checkout-key-0001','prepared','2026-08-02T00:00:00.000Z',
           '2026-08-02T00:00:00.000Z','2026-08-02T00:30:00.000Z',true
         )`,
      ),
    ).rejects.toThrow(/legacy expiry marker is migration-owned/u);

    await expect(
      database.exec(
        `UPDATE commerce_checkout_intents
         SET legacy_short_material_expiry = true
         WHERE household_id = 'household-legacy-checkout'
           AND id = 'checkout-new-four-hours'`,
      ),
    ).rejects.toThrow(/legacy expiry marker is immutable/u);
    await expect(
      database.exec(
        `UPDATE commerce_checkout_intents
         SET legacy_short_material_expiry = false
         WHERE household_id = 'household-legacy-checkout'
           AND id = 'checkout-legacy-30m'`,
      ),
    ).rejects.toThrow(/legacy expiry marker is immutable/u);

    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual([]);
  });
});

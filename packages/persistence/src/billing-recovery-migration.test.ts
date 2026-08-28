import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createPGliteDatabase, type Database } from './database';
import { migrationDirectory, runMigrations } from './migrations';

describe('billing recovery evidence migration', () => {
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

  it('keeps failed attempts append-only per source and defaults historical Portal evidence closed', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-billing-recovery-'));
    const files = (await readdir(sourceDirectory))
      .filter(
        (file) =>
          /^\d+_[a-z0-9_]+\.sql$/u.test(file) &&
          file <= '0033_run3_1_billing_recovery_evidence.sql',
      )
      .sort((left, right) => left.localeCompare(right));
    for (const file of files) {
      await copyFile(join(sourceDirectory, file), join(temporaryDirectory, file));
    }
    database = await createPGliteDatabase(':memory:');
    await expect(runMigrations(database, temporaryDirectory)).resolves.toHaveLength(33);

    const primaryKey = await database.query<{ readonly definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'commerce_stripe_failed_invoice_evidence'::regclass
         AND contype = 'p'`,
    );
    expect(primaryKey.rows[0]?.definition).toContain('source_inbox_id');

    const paymentIndex = await database.query<{ readonly indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = 'commerce_stripe_failed_invoice_payment_id_idx'`,
    );
    expect(paymentIndex.rows[0]?.indexdef).not.toContain('UNIQUE');

    const portalColumn = await database.query<
      { readonly column_default: string; readonly is_nullable: string } & Record<string, unknown>
    >(
      `SELECT column_default, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'commerce_stripe_preflight_records'
         AND column_name = 'portal_invoice_history_enabled'`,
    );
    expect(portalColumn.rows[0]).toEqual({ column_default: 'false', is_nullable: 'NO' });

    const recoveryTrigger = await database.query<{ readonly trigger_name: string }>(
      `SELECT trigger_name FROM information_schema.triggers
       WHERE event_object_schema = 'public'
         AND event_object_table = 'commerce_stripe_invoice_recovery_events'
         AND trigger_name = 'commerce_stripe_invoice_recovery_events_append_only'`,
    );
    expect(recoveryTrigger.rows).toHaveLength(2);
  });
});

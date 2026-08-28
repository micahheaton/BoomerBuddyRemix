import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createPGliteDatabase, type Database } from './database';
import { migrationDirectory, runMigrations } from './migrations';
import { SupportReceiptRepository } from './support-receipts';

const migration = '0034_run3_1_support_receipts.sql';

describe('support receipt forward migration', () => {
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

  it('upgrades 0033 forward-only with content-free append-only evidence and 90-day retention', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-support-receipts-'));
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
    await copyFile(join(sourceDirectory, migration), join(temporaryDirectory, migration));
    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual([migration]);

    const columns = await database.query<{
      readonly table_name: string;
      readonly column_name: string;
    }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name LIKE 'support_receipt%'
       ORDER BY table_name, ordinal_position`,
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).not.toEqual(
      expect.arrayContaining([
        'name',
        'email',
        'phone',
        'message',
        'url',
        'attachment',
        'contact',
        'content',
        'description',
      ]),
    );

    await database.exec(`
      INSERT INTO persons(id, display_name, created_at)
      VALUES ('person-support-owner','Synthetic Owner','2026-01-01T00:00:00.000Z');
      INSERT INTO households(id, name, created_at)
      VALUES ('household-support','Synthetic Household','2026-01-01T00:00:00.000Z');
      INSERT INTO household_memberships(
        household_id, id, person_id, membership_kind, status, created_at
      ) VALUES (
        'household-support','membership-support-owner','person-support-owner',
        'member','active','2026-01-01T00:00:00.000Z'
      );
      INSERT INTO support_receipts(
        receipt_code, household_id, opened_by_person_id, category, impact, created_at
      ) VALUES (
        'support_receipt_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB','household-support',
        'person-support-owner','privacy','question','2026-01-01T00:00:00.000Z'
      );
    `);
    await expect(
      database.query(
        `DELETE FROM support_receipts
         WHERE receipt_code = 'support_receipt_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'`,
      ),
    ).rejects.toThrow(/not due for terminal retention/u);
    await expect(database.query('DELETE FROM support_receipt_gate WHERE id = 1')).rejects.toThrow(
      /serialization gate is immutable/u,
    );

    await database.exec(`
      INSERT INTO support_receipts(
        receipt_code, household_id, opened_by_person_id, category, impact, created_at
      ) VALUES (
        'support_receipt_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA','household-support',
        'person-support-owner','account_access','blocked','2026-01-01T00:00:00.000Z'
      );
      INSERT INTO support_receipt_operations(
        operation_key_hmac, request_digest, operation_kind, actor_kind,
        actor_person_id, household_id, receipt_code, created_at
      ) VALUES (
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB','create','customer',
        'person-support-owner','household-support',
        'support_receipt_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA','2026-01-01T00:00:00.000Z'
      );
      INSERT INTO support_receipt_events(
        receipt_code, household_id, sequence, operation_key_hmac, from_state,
        to_state, action, actor_kind, actor_person_id, resolution_code,
        correlation_id, occurred_at
      ) VALUES (
        'support_receipt_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA','household-support',1,
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',NULL,'open','create','customer',
        'person-support-owner',NULL,'support-retention-create',
        '2026-01-01T00:00:00.000Z'
      );
      INSERT INTO support_receipt_operations(
        operation_key_hmac, request_digest, operation_kind, actor_kind,
        actor_person_id, household_id, receipt_code, created_at
      ) VALUES (
        'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
        'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD','withdraw','customer',
        'person-support-owner','household-support',
        'support_receipt_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA','2026-01-02T00:00:00.000Z'
      );
      INSERT INTO support_receipt_events(
        receipt_code, household_id, sequence, operation_key_hmac, from_state,
        to_state, action, actor_kind, actor_person_id, resolution_code,
        correlation_id, occurred_at
      ) VALUES (
        'support_receipt_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA','household-support',2,
        'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC','open','withdrawn','withdraw',
        'customer','person-support-owner',NULL,'support-retention-withdraw',
        '2026-01-02T00:00:00.000Z'
      );
    `);

    await expect(
      database.query(
        `UPDATE support_receipt_events SET correlation_id = 'forbidden-update'
         WHERE receipt_code = 'support_receipt_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'`,
      ),
    ).rejects.toThrow(/append-only/u);
    await expect(
      database.query(
        `DELETE FROM support_receipt_operations
         WHERE receipt_code = 'support_receipt_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'`,
      ),
    ).rejects.toThrow(/append-only/u);

    const repository = new SupportReceiptRepository(database, Buffer.alloc(32, 19));
    await expect(repository.purgeTerminal()).resolves.toMatchObject({
      receiptsDeleted: 1,
      saturated: false,
    });
    const retained = await database.query<{ readonly count: number }>(
      `SELECT count(*)::integer AS count FROM support_receipts
       WHERE receipt_code = 'support_receipt_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'`,
    );
    const history = await database.query<{ readonly count: number }>(
      `SELECT count(*)::integer AS count FROM support_receipt_events
       WHERE receipt_code = 'support_receipt_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'`,
    );
    expect(retained.rows).toEqual([{ count: 0 }]);
    expect(history.rows).toEqual([{ count: 0 }]);

    await database.exec('TRUNCATE TABLE support_receipt_gate');
    await expect(
      repository.create({
        actorPersonId: 'person-support-owner',
        audience: 'customer',
        householdId: 'household-support',
        category: 'billing',
        impact: 'question',
        operationKey: 'support-receipt:create:00000000-0000-4000-8000-000000000001',
        correlationId: 'support-gate-fail-closed',
      }),
    ).rejects.toThrow(/serialization gate is unavailable/u);
  });
});

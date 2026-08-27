import { createMigratedTestDatabase } from '@boomerbuddy/testkit';
import { afterEach, describe, expect, it } from 'vitest';

import type { Database } from './database';

describe('member learning idempotency migration', () => {
  let database: Database | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  it('keeps receipts immutable while allowing an authorized membership cascade', async () => {
    database = await createMigratedTestDatabase();
    const occurredAt = '2026-08-27T12:00:00.000Z';
    await database.query(
      `INSERT INTO persons(id, display_name, created_at)
       VALUES ('person-learning-receipt-delete','Synthetic learner',$1)`,
      [occurredAt],
    );
    await database.query(
      `INSERT INTO households(id, name, created_at)
       VALUES ('household-learning-receipt-delete','Synthetic household',$1)`,
      [occurredAt],
    );
    await database.query(
      `INSERT INTO household_memberships(
         household_id, id, person_id, membership_kind, status, created_at
       ) VALUES (
         'household-learning-receipt-delete','membership-learning-receipt-delete',
         'person-learning-receipt-delete','member','active',$1
       )`,
      [occurredAt],
    );
    await database.query(
      `INSERT INTO member_learning_operation_receipts(
         household_id, person_id, operation_key_hash, action_kind,
         request_fingerprint, canonical_result, contains_customer_content,
         created_at, completed_at
       ) VALUES ($1,$2,$3,'lesson_start',$4,$5::jsonb,false,$6,$6)`,
      [
        'household-learning-receipt-delete',
        'person-learning-receipt-delete',
        'a'.repeat(64),
        'b'.repeat(64),
        JSON.stringify({ schemaVersion: 1, appliedAt: occurredAt }),
        occurredAt,
      ],
    );

    await expect(
      database.query(
        `UPDATE member_learning_operation_receipts
         SET request_fingerprint = $1 WHERE operation_key_hash = $2`,
        ['c'.repeat(64), 'a'.repeat(64)],
      ),
    ).rejects.toThrow('immutable');
    await expect(
      database.query(
        'DELETE FROM member_learning_operation_receipts WHERE operation_key_hash = $1',
        ['a'.repeat(64)],
      ),
    ).rejects.toThrow('immutable');

    await database.query(
      `DELETE FROM household_memberships
       WHERE household_id = $1 AND person_id = $2`,
      ['household-learning-receipt-delete', 'person-learning-receipt-delete'],
    );
    const remaining = await database.query<{ readonly count: number }>(
      `SELECT count(*)::integer AS count FROM member_learning_operation_receipts
       WHERE operation_key_hash = $1`,
      ['a'.repeat(64)],
    );
    expect(remaining.rows[0]?.count).toBe(0);
  }, 60_000);
});

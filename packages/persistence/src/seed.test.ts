import { describe, expect, it } from 'vitest';

import type { Database, SqlExecutor } from './database';
import { assertDemoSeedingPermitted, seedDemoData } from './seed';

const protection = {
  encryptionKey: Buffer.alloc(32, 7),
  encryptionKeyVersion: 1,
  fingerprintKey: Buffer.alloc(32, 11),
  fingerprintKeyVersion: 1,
} as const;

describe('demo seed production boundary', () => {
  it('allows only explicitly non-production runtime environments', () => {
    expect(() => assertDemoSeedingPermitted('development', 'pglite')).not.toThrow();
    expect(() => assertDemoSeedingPermitted('test', 'pglite')).not.toThrow();
    expect(() => assertDemoSeedingPermitted('production', 'pglite')).toThrow(
      'Production refuses demo data seeding',
    );
  });

  it('rejects production before opening a database transaction', async () => {
    let transactionOpened = false;
    const database: Database = {
      kind: 'postgres',
      async query() {
        throw new Error('query must not be reached');
      },
      async exec() {
        throw new Error('exec must not be reached');
      },
      async transaction<Result>(
        work: (transaction: SqlExecutor) => Promise<Result>,
      ): Promise<Result> {
        void work;
        transactionOpened = true;
        throw new Error('transaction must not be reached');
      },
      async close() {},
    };

    await expect(
      seedDemoData(database, protection, 'production', new Date('2026-08-25T00:00:00.000Z')),
    ).rejects.toThrow('Production refuses demo data seeding');
    expect(transactionOpened).toBe(false);
  });

  it('rejects a PostgreSQL target before opening a database transaction', async () => {
    let transactionOpened = false;
    const database: Database = {
      kind: 'postgres',
      async query() {
        throw new Error('query must not be reached');
      },
      async exec() {
        throw new Error('exec must not be reached');
      },
      async transaction<Result>(
        work: (transaction: SqlExecutor) => Promise<Result>,
      ): Promise<Result> {
        void work;
        transactionOpened = true;
        throw new Error('transaction must not be reached');
      },
      async close() {},
    };

    await expect(
      seedDemoData(database, protection, 'test', new Date('2026-08-25T00:00:00.000Z')),
    ).rejects.toThrow('Demo data seeding requires a local PGlite target');
    expect(transactionOpened).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

const pgPoolState = vi.hoisted(() => ({
  options: [] as unknown[],
}));

vi.mock('pg', () => ({
  default: {
    Pool: class {
      constructor(options: unknown) {
        pgPoolState.options.push(options);
      }

      async query(): Promise<{ readonly rowCount: number; readonly rows: readonly unknown[] }> {
        return { rowCount: 1, rows: [{}] };
      }

      async end(): Promise<void> {}
    },
  },
}));

import { createPostgresDatabase } from './database';

describe('PostgreSQL database pool capacity', () => {
  afterEach(() => {
    pgPoolState.options.length = 0;
  });

  it('preserves the ten-connection default outside explicit production configuration', async () => {
    const database = await createPostgresDatabase('postgresql://example.invalid/boomerbuddy');
    expect(pgPoolState.options).toEqual([
      {
        connectionString: 'postgresql://example.invalid/boomerbuddy',
        max: 10,
      },
    ]);
    await database.close();
  });

  it('threads an explicit bounded pool max to node-postgres', async () => {
    const database = await createPostgresDatabase('postgresql://example.invalid/boomerbuddy', {
      poolMax: 2,
    });
    expect(pgPoolState.options).toEqual([
      {
        connectionString: 'postgresql://example.invalid/boomerbuddy',
        max: 2,
      },
    ]);
    await database.close();
  });

  it.each([0, 1.5, 11, Number.NaN])(
    'rejects invalid pool max %s before opening a pool',
    async (poolMax) => {
      await expect(
        createPostgresDatabase('postgresql://example.invalid/boomerbuddy', { poolMax }),
      ).rejects.toThrow('PostgreSQL pool max must be an integer between 1 and 10');
      expect(pgPoolState.options).toEqual([]);
    },
  );
});

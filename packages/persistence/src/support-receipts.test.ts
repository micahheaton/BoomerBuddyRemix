import { describe, expect, it } from 'vitest';

import type { Database, QueryResult, SqlExecutor } from './database';
import { SupportReceiptRepository } from './support-receipts';

interface QueryCall {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

function queryResult<Row extends Record<string, unknown>>(
  rows: readonly Record<string, unknown>[],
): QueryResult<Row> {
  return { rows: rows as readonly Row[], rowCount: rows.length };
}

class PaginationDatabase implements Database {
  readonly kind = 'pglite' as const;
  readonly calls: QueryCall[] = [];

  constructor(private readonly totalRows: number) {}

  async query<Row extends Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    this.calls.push({ sql, parameters });
    if (sql.includes('FROM household_memberships membership')) {
      return queryResult<Row>([{}]);
    }
    if (sql.includes('FROM support_receipts receipt')) {
      const queryLimit = Number(parameters[2]);
      const offset = Number(parameters[3]);
      const count = Math.min(queryLimit, Math.max(0, this.totalRows - offset));
      return queryResult<Row>(
        Array.from({ length: count }, (_, index) => ({
          receipt_code: `support_receipt_${String(offset + index).padStart(32, '0')}`,
          household_id: 'household-sunrise',
          category: 'billing',
          impact: 'question',
          to_state: 'open',
          resolution_code: null,
          created_at: '2026-08-25T12:00:00.000Z',
          occurred_at: '2026-08-25T12:00:00.000Z',
        })),
      );
    }
    throw new Error(`Unexpected support receipt pagination query: ${sql}`);
  }

  async exec(): Promise<void> {}

  transaction<Result>(work: (transaction: SqlExecutor) => Promise<Result>): Promise<Result> {
    return work(this);
  }

  async close(): Promise<void> {}
}

describe('support receipt repository pagination', () => {
  it.each([
    {
      label: 'advances a full page to the final reachable offset',
      offset: 9_900,
      totalRows: 10_001,
      queryLimit: 101,
      returnedCount: 100,
      truncated: true,
      nextOffset: 10_000,
    },
    {
      label: 'shortens an overlapping page so the final reachable page is not hidden',
      offset: 9_950,
      totalRows: 10_001,
      queryLimit: 51,
      returnedCount: 50,
      truncated: true,
      nextOffset: 10_000,
    },
    {
      label: 'reports terminal truncation without an unrequestable offset',
      offset: 10_000,
      totalRows: 10_101,
      queryLimit: 101,
      returnedCount: 100,
      truncated: true,
      nextOffset: null,
    },
    {
      label: 'reports a complete final page when no additional row exists',
      offset: 10_000,
      totalRows: 10_100,
      queryLimit: 101,
      returnedCount: 100,
      truncated: false,
      nextOffset: null,
    },
  ])('$label', async ({ offset, totalRows, queryLimit, returnedCount, truncated, nextOffset }) => {
    const database = new PaginationDatabase(totalRows);
    const repository = new SupportReceiptRepository(database, Buffer.alloc(32, 7));

    const result = await repository.listForCustomer({
      actorPersonId: 'person-owner-alice',
      householdId: 'household-sunrise',
      limit: 100,
      offset,
    });

    expect(result.receipts).toHaveLength(returnedCount);
    expect(result).toMatchObject({ truncated, nextOffset });
    const listQuery = database.calls.find((call) =>
      call.sql.includes('FROM support_receipts receipt'),
    );
    expect(listQuery?.parameters).toEqual([
      'household-sunrise',
      'person-owner-alice',
      queryLimit,
      offset,
    ]);
  });

  it('rejects an offset beyond the final accepted page', async () => {
    const repository = new SupportReceiptRepository(
      new PaginationDatabase(10_102),
      Buffer.alloc(32, 7),
    );

    await expect(
      repository.listForCustomer({
        actorPersonId: 'person-owner-alice',
        householdId: 'household-sunrise',
        limit: 100,
        offset: 10_001,
      }),
    ).rejects.toThrow('Support receipt page offset must be between 0 and 10000');
  });
});

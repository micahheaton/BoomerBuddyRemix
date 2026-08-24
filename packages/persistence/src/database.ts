import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

export interface QueryResult<Row extends Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number;
}

export interface SqlExecutor {
  query<Row extends Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
  exec(sql: string): Promise<void>;
}

export interface Database extends SqlExecutor {
  readonly kind: 'pglite' | 'postgres';
  transaction<Result>(work: (transaction: SqlExecutor) => Promise<Result>): Promise<Result>;
  close(): Promise<void>;
}

export interface PostgresDatabaseOptions {
  readonly poolMax?: number;
}

const defaultPostgresPoolMax = 10;
const maximumPostgresPoolMax = 10;

function postgresPoolMax(value: number | undefined): number {
  const poolMax = value ?? defaultPostgresPoolMax;
  if (!Number.isSafeInteger(poolMax) || poolMax < 1 || poolMax > maximumPostgresPoolMax) {
    throw new TypeError(
      `PostgreSQL pool max must be an integer between 1 and ${maximumPostgresPoolMax}`,
    );
  }
  return poolMax;
}

function parameterArray(parameters: readonly unknown[] | undefined): unknown[] | undefined {
  return parameters === undefined ? undefined : [...parameters];
}

class PGliteExecutor implements SqlExecutor {
  constructor(private readonly client: Pick<PGlite, 'query' | 'exec'>) {}

  async query<Row extends Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<QueryResult<Row>> {
    const result = await this.client.query<Row>(sql, parameterArray(parameters));
    return { rows: result.rows, rowCount: result.rowCount ?? result.affectedRows ?? 0 };
  }

  async exec(sql: string): Promise<void> {
    await this.client.exec(sql);
  }
}

class PGliteDatabase implements Database {
  readonly kind = 'pglite' as const;
  private readonly executor: PGliteExecutor;

  constructor(private readonly client: PGlite) {
    this.executor = new PGliteExecutor(client);
  }

  query<Row extends Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<QueryResult<Row>> {
    return this.executor.query<Row>(sql, parameters);
  }

  exec(sql: string): Promise<void> {
    return this.executor.exec(sql);
  }

  transaction<Result>(work: (transaction: SqlExecutor) => Promise<Result>): Promise<Result> {
    return this.client.transaction((transaction) => work(new PGliteExecutor(transaction)));
  }

  close(): Promise<void> {
    return this.client.close();
  }
}

class PgExecutor implements SqlExecutor {
  constructor(private readonly client: pg.Pool | pg.PoolClient) {}

  async query<Row extends Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<QueryResult<Row>> {
    const result = await this.client.query<Row>(sql, parameterArray(parameters));
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  }

  async exec(sql: string): Promise<void> {
    await this.client.query(sql);
  }
}

class PostgresDatabase implements Database {
  readonly kind = 'postgres' as const;
  private readonly executor: PgExecutor;

  constructor(private readonly pool: pg.Pool) {
    this.executor = new PgExecutor(pool);
  }

  query<Row extends Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<QueryResult<Row>> {
    return this.executor.query<Row>(sql, parameters);
  }

  exec(sql: string): Promise<void> {
    return this.executor.exec(sql);
  }

  async transaction<Result>(work: (transaction: SqlExecutor) => Promise<Result>): Promise<Result> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(new PgExecutor(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export async function createPGliteDatabase(dataDir = ':memory:'): Promise<Database> {
  const client =
    dataDir === ':memory:' || dataDir === 'memory://' ? new PGlite() : new PGlite(dataDir);
  await client.waitReady;
  return new PGliteDatabase(client);
}

export async function createPostgresDatabase(
  connectionString: string,
  options: PostgresDatabaseOptions = {},
): Promise<Database> {
  const pool = new pg.Pool({ connectionString, max: postgresPoolMax(options.poolMax) });
  await pool.query('SELECT 1');
  return new PostgresDatabase(pool);
}

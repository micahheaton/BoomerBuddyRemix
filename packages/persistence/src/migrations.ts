import { createHash } from 'node:crypto';
import { access, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Database } from './database';

interface MigrationRow extends Record<string, unknown> {
  readonly version: string;
  readonly checksum: string;
}

async function existingDirectory(candidates: readonly string[]): Promise<string> {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next packaged/source location.
    }
  }
  throw new Error('Unable to locate SQL migrations');
}

export async function migrationDirectory(): Promise<string> {
  return existingDirectory([
    fileURLToPath(new URL('../migrations/', import.meta.url)),
    fileURLToPath(new URL('../../../packages/persistence/migrations/', import.meta.url)),
    `${process.cwd()}/packages/persistence/migrations`,
  ]);
}

export async function runMigrations(
  database: Database,
  directory?: string,
): Promise<readonly string[]> {
  const migrationPath = directory ?? (await migrationDirectory());
  const files = (await readdir(migrationPath))
    .filter((file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file))
    .sort((left, right) => left.localeCompare(right));
  const migrations = await Promise.all(
    files.map(async (file) => {
      const sql = await readFile(`${migrationPath}/${file}`, 'utf8');
      return { file, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
  const applied: string[] = [];
  await database.transaction(async (transaction) => {
    if (database.kind === 'postgres') {
      await transaction.query('SELECT pg_advisory_xact_lock($1)', [2_001_608_160]);
    }
    await transaction.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    for (const migration of migrations) {
      const existing = await transaction.query<MigrationRow>(
        'SELECT version, checksum FROM schema_migrations WHERE version = $1',
        [migration.file],
      );
      const row = existing.rows[0];
      if (row !== undefined) {
        if (row.checksum !== migration.checksum) {
          throw new Error(`Migration checksum changed after application: ${migration.file}`);
        }
        continue;
      }
      await transaction.exec(migration.sql);
      await transaction.query('INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)', [
        migration.file,
        migration.checksum,
      ]);
      applied.push(migration.file);
    }
  });
  return applied;
}

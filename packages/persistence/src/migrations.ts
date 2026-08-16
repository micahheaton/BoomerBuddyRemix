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
  await database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const migrationPath = directory ?? (await migrationDirectory());
  const files = (await readdir(migrationPath))
    .filter((file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file))
    .sort((left, right) => left.localeCompare(right));
  const applied: string[] = [];
  for (const file of files) {
    const sql = await readFile(`${migrationPath}/${file}`, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = await database.query<MigrationRow>(
      'SELECT version, checksum FROM schema_migrations WHERE version = $1',
      [file],
    );
    const row = existing.rows[0];
    if (row !== undefined) {
      if (row.checksum !== checksum) {
        throw new Error(`Migration checksum changed after application: ${file}`);
      }
      continue;
    }
    await database.transaction(async (transaction) => {
      await transaction.exec(sql);
      await transaction.query('INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)', [
        file,
        checksum,
      ]);
    });
    applied.push(file);
  }
  return applied;
}

import { createHash } from 'node:crypto';
import { access, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Database } from './database';

interface MigrationRow extends Record<string, unknown> {
  readonly version: string;
  readonly checksum: string;
}

function hashMigrationSql(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

function migrationChecksums(sql: string): {
  readonly canonical: string;
  readonly acceptedLegacy: ReadonlySet<string>;
} {
  const normalized = sql.replace(/\r\n?/gu, '\n');
  return {
    canonical: hashMigrationSql(normalized),
    acceptedLegacy: new Set([
      hashMigrationSql(sql),
      hashMigrationSql(normalized.replace(/\n/gu, '\r\n')),
      hashMigrationSql(normalized.replace(/\n/gu, '\r')),
    ]),
  };
}

function assertUniqueMigrationVersions(files: readonly string[]): void {
  const filesByVersion = new Map<string, string[]>();
  for (const file of files) {
    const separator = file.indexOf('_');
    const numericPrefix = file.slice(0, separator);
    const version = numericPrefix.replace(/^0+(?=\d)/u, '');
    const matchingFiles = filesByVersion.get(version) ?? [];
    matchingFiles.push(file);
    filesByVersion.set(version, matchingFiles);
  }

  for (const [version, matchingFiles] of filesByVersion) {
    if (matchingFiles.length > 1) {
      throw new Error(
        `Duplicate migration numeric version ${version}: ${matchingFiles.join(', ')}`,
      );
    }
  }
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
  assertUniqueMigrationVersions(files);
  const migrations = await Promise.all(
    files.map(async (file) => {
      const sql = await readFile(`${migrationPath}/${file}`, 'utf8');
      const checksums = migrationChecksums(sql);
      return {
        file,
        sql,
        checksum: checksums.canonical,
        acceptedLegacyChecksums: checksums.acceptedLegacy,
      };
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
    const recorded = await transaction.query<MigrationRow>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const appliedRows = [...recorded.rows].sort((left, right) =>
      left.version.localeCompare(right.version),
    );
    const migrationsByFile = new Map(migrations.map((migration) => [migration.file, migration]));
    const missingFromDisk = appliedRows
      .filter((row) => !migrationsByFile.has(row.version))
      .map((row) => row.version);
    if (missingFromDisk.length > 0) {
      throw new Error(`Applied migrations are missing from disk: ${missingFromDisk.join(', ')}`);
    }
    for (const row of appliedRows) {
      const migration = migrationsByFile.get(row.version);
      if (migration === undefined) throw new Error(`Missing migration: ${row.version}`);
      if (row.checksum !== migration.checksum) {
        if (!migration.acceptedLegacyChecksums.has(row.checksum)) {
          throw new Error(`Migration checksum changed after application: ${row.version}`);
        }
        await transaction.query(
          'UPDATE schema_migrations SET checksum = $1 WHERE version = $2 AND checksum = $3',
          [migration.checksum, row.version, row.checksum],
        );
      }
    }
    const expectedPrefix = migrations
      .slice(0, appliedRows.length)
      .map((migration) => migration.file);
    const actualPrefix = appliedRows.map((row) => row.version);
    if (expectedPrefix.some((version, index) => version !== actualPrefix[index])) {
      throw new Error(
        `Applied migration history is not an exact prefix of disk manifest: expected ${expectedPrefix.join(', ')}, found ${actualPrefix.join(', ')}`,
      );
    }
    for (const migration of migrations.slice(appliedRows.length)) {
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

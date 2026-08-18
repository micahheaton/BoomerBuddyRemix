import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPGliteDatabase, type Database } from './database';
import { runMigrations } from './migrations';

interface MigrationRecord extends Record<string, unknown> {
  readonly version: string;
  readonly checksum: string;
}

interface CountRecord extends Record<string, unknown> {
  readonly count: number;
}

const migrationFiles = [
  {
    file: '0001_create_runner_probe.sql',
    sql: 'CREATE TABLE runner_probe (value text NOT NULL);',
  },
  {
    file: '0002_insert_runner_probe.sql',
    sql: "INSERT INTO runner_probe(value) VALUES ('second');",
  },
  {
    file: '0010_append_runner_probe.sql',
    sql: "INSERT INTO runner_probe(value) VALUES ('tenth');",
  },
] as const;

async function writeMigrations(directory: string): Promise<void> {
  await Promise.all(
    migrationFiles.map(({ file, sql }) => writeFile(join(directory, file), sql, 'utf8')),
  );
}

async function tableCount(database: Database, tableName: string): Promise<number> {
  const result = await database.query<CountRecord>(
    `SELECT count(*)::integer AS count
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName],
  );
  return result.rows[0]?.count ?? 0;
}

describe('migration runner', () => {
  let database: Database;
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-migration-runner-'));
    database = await createPGliteDatabase();
  });

  afterEach(async () => {
    await database.close();
    await rm(temporaryDirectory, { force: true, recursive: true });
  });

  it('rejects duplicate numeric versions before any database mutation', async () => {
    await Promise.all([
      writeFile(
        join(temporaryDirectory, '0001_create_duplicate_probe.sql'),
        'CREATE TABLE duplicate_probe (id integer PRIMARY KEY);',
        'utf8',
      ),
      writeFile(
        join(temporaryDirectory, '01_insert_duplicate_probe.sql'),
        'CREATE TABLE later_duplicate_probe (id integer PRIMARY KEY);',
        'utf8',
      ),
    ]);

    await expect(runMigrations(database, temporaryDirectory)).rejects.toThrow(
      'Duplicate migration numeric version 1: 0001_create_duplicate_probe.sql, 01_insert_duplicate_probe.sql',
    );
    await expect(tableCount(database, 'schema_migrations')).resolves.toBe(0);
    await expect(tableCount(database, 'duplicate_probe')).resolves.toBe(0);
    await expect(tableCount(database, 'later_duplicate_probe')).resolves.toBe(0);
  });

  it('applies migrations in exact filename order on the first run', async () => {
    await writeMigrations(temporaryDirectory);

    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual(
      migrationFiles.map(({ file }) => file),
    );

    const values = await database.query<{ readonly value: string }>(
      'SELECT value FROM runner_probe ORDER BY ctid',
    );
    expect(values.rows).toEqual([{ value: 'second' }, { value: 'tenth' }]);
  });

  it('returns no migrations on the second run', async () => {
    await writeMigrations(temporaryDirectory);

    await runMigrations(database, temporaryDirectory);

    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual([]);
  });

  it('records migration versions and checksums exactly as they exist on disk', async () => {
    await writeMigrations(temporaryDirectory);

    await runMigrations(database, temporaryDirectory);

    const recorded = await database.query<MigrationRecord>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version',
    );
    const expected = await Promise.all(
      migrationFiles.map(async ({ file }) => ({
        version: file,
        checksum: createHash('sha256')
          .update(await readFile(join(temporaryDirectory, file), 'utf8'))
          .digest('hex'),
      })),
    );
    expect(recorded.rows).toEqual(expected);
  });

  it('rejects an applied migration whose SQL changes on disk', async () => {
    await writeMigrations(temporaryDirectory);
    await runMigrations(database, temporaryDirectory);
    const changedFile = migrationFiles[1].file;
    await writeFile(
      join(temporaryDirectory, changedFile),
      "INSERT INTO runner_probe(value) VALUES ('changed');",
      'utf8',
    );

    await expect(runMigrations(database, temporaryDirectory)).rejects.toThrow(
      `Migration checksum changed after application: ${changedFile}`,
    );
    const values = await database.query<{ readonly value: string }>(
      'SELECT value FROM runner_probe ORDER BY ctid',
    );
    expect(values.rows).toEqual([{ value: 'second' }, { value: 'tenth' }]);
  });

  it('treats equivalent CRLF and LF migration bytes as one portable checksum', async () => {
    const file = migrationFiles[0].file;
    const lfSql = `${migrationFiles[0].sql}\n`;
    const crlfSql = lfSql.replace(/\n/gu, '\r\n');
    await writeFile(join(temporaryDirectory, file), crlfSql, 'utf8');

    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual([file]);
    await database.query('UPDATE schema_migrations SET checksum = $1 WHERE version = $2', [
      createHash('sha256').update(crlfSql).digest('hex'),
      file,
    ]);
    await writeFile(join(temporaryDirectory, file), lfSql, 'utf8');
    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual([]);

    const recorded = await database.query<MigrationRecord>(
      'SELECT version, checksum FROM schema_migrations',
    );
    expect(recorded.rows).toEqual([
      {
        version: file,
        checksum: createHash('sha256').update(lfSql).digest('hex'),
      },
    ]);
  });

  it('rejects a lower-version migration inserted behind the applied frontier', async () => {
    await Promise.all([
      writeFile(join(temporaryDirectory, migrationFiles[0].file), migrationFiles[0].sql, 'utf8'),
      writeFile(join(temporaryDirectory, migrationFiles[2].file), migrationFiles[2].sql, 'utf8'),
    ]);
    await runMigrations(database, temporaryDirectory);
    await writeFile(
      join(temporaryDirectory, migrationFiles[1].file),
      migrationFiles[1].sql,
      'utf8',
    );

    await expect(runMigrations(database, temporaryDirectory)).rejects.toThrow(
      'Applied migration history is not an exact prefix of disk manifest: expected 0001_create_runner_probe.sql, 0002_insert_runner_probe.sql, found 0001_create_runner_probe.sql, 0010_append_runner_probe.sql',
    );
    const values = await database.query<{ readonly value: string }>(
      'SELECT value FROM runner_probe ORDER BY ctid',
    );
    expect(values.rows).toEqual([{ value: 'tenth' }]);
  });

  it('rejects an applied migration that is no longer present on disk', async () => {
    await writeMigrations(temporaryDirectory);
    await runMigrations(database, temporaryDirectory);
    await unlink(join(temporaryDirectory, migrationFiles[1].file));

    await expect(runMigrations(database, temporaryDirectory)).rejects.toThrow(
      `Applied migrations are missing from disk: ${migrationFiles[1].file}`,
    );
    const values = await database.query<{ readonly value: string }>(
      'SELECT value FROM runner_probe ORDER BY ctid',
    );
    expect(values.rows).toEqual([{ value: 'second' }, { value: 'tenth' }]);
  });
});

import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createPGliteDatabase, type Database } from './database';
import { migrationDirectory, runMigrations } from './migrations';

describe('Check analysis reuse migration', () => {
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

  it('indexes only active fingerprints and completed provenance without making either unique', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-check-reuse-'));
    const files = (await readdir(sourceDirectory))
      .filter(
        (file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file) && file <= '0046_check_analysis_reuse.sql',
      )
      .sort((left, right) => left.localeCompare(right));
    for (const file of files) {
      await copyFile(join(sourceDirectory, file), join(temporaryDirectory, file));
    }

    database = await createPGliteDatabase(':memory:');
    await expect(runMigrations(database, temporaryDirectory)).resolves.toHaveLength(46);

    const indexes = await database.query<{
      readonly indexdef: string;
      readonly indexname: string;
    }>(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname IN (
           'artifacts_active_owner_fingerprint_idx',
           'analyses_completed_artifact_provenance_idx'
         )
       ORDER BY indexname`,
    );

    expect(indexes.rows).toHaveLength(2);
    expect(indexes.rows.every(({ indexdef }) => !indexdef.includes('UNIQUE'))).toBe(true);
    expect(
      indexes.rows.find(({ indexname }) => indexname.startsWith('artifacts_'))?.indexdef,
    ).toContain("WHERE ((state = 'active'::text) AND (input_fingerprint IS NOT NULL))");
    expect(
      indexes.rows.find(({ indexname }) => indexname.startsWith('analyses_'))?.indexdef,
    ).toContain("WHERE ((state = 'completed'::text) AND (reuse_provenance_key IS NOT NULL))");

    const columns = await database.query<{
      readonly column_name: string;
      readonly is_nullable: string;
    }>(
      `SELECT column_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'analyses'
         AND column_name IN ('reuse_provenance_key', 'reuse_until')
       ORDER BY column_name`,
    );
    expect(columns.rows).toEqual([
      { column_name: 'reuse_provenance_key', is_nullable: 'YES' },
      { column_name: 'reuse_until', is_nullable: 'YES' },
    ]);
  });
});

import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createPGliteDatabase, type Database } from './database';
import { migrationDirectory, runMigrations } from './migrations';

async function copyMigrationsThrough(
  sourceDirectory: string,
  targetDirectory: string,
  lastFile: string,
): Promise<void> {
  const files = (await readdir(sourceDirectory))
    .filter((file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file) && file <= lastFile)
    .sort((left, right) => left.localeCompare(right));
  for (const file of files) {
    await copyFile(join(sourceDirectory, file), join(targetDirectory, file));
  }
}

describe('Stripe first-dollar forward migration', () => {
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

  it('applies the complete 0001 through 0016 chain on PGlite', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-stripe-migration-'));
    await copyMigrationsThrough(
      sourceDirectory,
      temporaryDirectory,
      '0016_run3_stripe_first_dollar.sql',
    );
    database = await createPGliteDatabase();

    await expect(runMigrations(database, temporaryDirectory)).resolves.toHaveLength(16);
  });

  it('upgrades an applied 0015 database to 0016 without replaying earlier migrations', async () => {
    const sourceDirectory = await migrationDirectory();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'boomerbuddy-stripe-migration-'));
    await copyMigrationsThrough(
      sourceDirectory,
      temporaryDirectory,
      '0015_run3_external_actions.sql',
    );
    database = await createPGliteDatabase();
    await expect(runMigrations(database, temporaryDirectory)).resolves.toHaveLength(15);

    await copyFile(
      join(sourceDirectory, '0016_run3_stripe_first_dollar.sql'),
      join(temporaryDirectory, '0016_run3_stripe_first_dollar.sql'),
    );
    await expect(runMigrations(database, temporaryDirectory)).resolves.toEqual([
      '0016_run3_stripe_first_dollar.sql',
    ]);
  });
});

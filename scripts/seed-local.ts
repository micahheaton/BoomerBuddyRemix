import { loadConfig, loadEnvironmentFile } from '@boomerbuddy/config';
import { existsSync } from 'node:fs';
import {
  createPGliteDatabase,
  createPostgresDatabase,
  runMigrations,
  seedDemoData,
  type Database,
} from '@boomerbuddy/persistence';

async function connect(): Promise<{
  readonly database: Database;
  readonly config: ReturnType<typeof loadConfig>;
}> {
  const config = loadConfig();
  const database =
    config.database.driver === 'pglite'
      ? await createPGliteDatabase(config.database.path)
      : await createPostgresDatabase(config.database.url);
  return { database, config };
}

async function main(): Promise<void> {
  if (existsSync('.env')) loadEnvironmentFile();
  const { database, config } = await connect();
  try {
    await runMigrations(database);
    await seedDemoData(database, {
      encryptionKey: config.secrets.artifactEncryptionKey,
      encryptionKeyVersion: 1,
      fingerprintKey: config.secrets.fingerprintKey,
      fingerprintKeyVersion: 1,
    });
    process.stdout.write(
      'Seeded synthetic local personas, households, checks, entitlements, and HQ data.\n',
    );
  } finally {
    await database.close();
  }
}

await main();

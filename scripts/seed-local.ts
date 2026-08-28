import { loadConfig, loadEnvironmentFile } from '@boomerbuddy/config';
import { existsSync } from 'node:fs';
import {
  assertDemoSeedingPermitted,
  createPGliteDatabase,
  runMigrations,
  seedDemoData,
} from '@boomerbuddy/persistence';

async function main(): Promise<void> {
  if (existsSync('.env')) loadEnvironmentFile();
  const config = loadConfig();
  assertDemoSeedingPermitted(config.environment, config.database.driver);
  if (config.database.driver !== 'pglite') {
    throw new TypeError('Demo data seeding requires a local PGlite target');
  }
  const database = await createPGliteDatabase(config.database.path);
  try {
    await runMigrations(database);
    await seedDemoData(
      database,
      {
        encryptionKey: config.secrets.artifactEncryptionKey,
        encryptionKeyVersion: 1,
        fingerprintKey: config.secrets.fingerprintKey,
        fingerprintKeyVersion: 1,
      },
      config.environment,
    );
    process.stdout.write(
      'Seeded synthetic local personas, households, checks, entitlements, and HQ data.\n',
    );
  } finally {
    await database.close();
  }
}

await main();

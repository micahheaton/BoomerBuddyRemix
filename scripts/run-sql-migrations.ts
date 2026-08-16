import { loadConfig, loadEnvironmentFile } from '@boomerbuddy/config';
import { existsSync } from 'node:fs';
import {
  createPGliteDatabase,
  createPostgresDatabase,
  runMigrations,
  type Database,
} from '@boomerbuddy/persistence';

async function connect(): Promise<Database> {
  const config = loadConfig();
  return config.database.driver === 'pglite'
    ? createPGliteDatabase(config.database.path)
    : createPostgresDatabase(config.database.url);
}

async function main(): Promise<void> {
  if (existsSync('.env')) loadEnvironmentFile();
  const database = await connect();
  try {
    const applied = await runMigrations(database);
    process.stdout.write(
      `Applied ${applied.length} migration(s): ${applied.join(', ') || 'none'}\n`,
    );
  } finally {
    await database.close();
  }
}

await main();

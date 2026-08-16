import { existsSync } from 'node:fs';
import { loadConfig, loadEnvironmentFile } from '@boomerbuddy/config';
import {
  createPGliteDatabase,
  createPostgresDatabase,
  runMigrations,
} from '@boomerbuddy/persistence';

if (existsSync('.env')) loadEnvironmentFile();
const config = loadConfig();
const database =
  config.database.driver === 'postgres'
    ? await createPostgresDatabase(config.database.url)
    : await createPGliteDatabase(config.database.path);
try {
  const applied = await runMigrations(database);
  process.stdout.write(`Applied ${applied.length} verified migration(s).\n`);
} finally {
  await database.close();
}

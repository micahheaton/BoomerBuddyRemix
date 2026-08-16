import { existsSync } from 'node:fs';
import { loadConfig, loadEnvironmentFile } from '@boomerbuddy/config';
import { buildApp } from './app';

if (existsSync('.env')) loadEnvironmentFile();
const config = loadConfig();
const app = await buildApp({ config });

const close = async (): Promise<void> => {
  await app.close();
  process.exitCode = 0;
};
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());

try {
  await app.listen({ host: config.api.host, port: config.api.port });
} catch (error) {
  process.stderr.write('BoomerBuddy API failed to start.\n');
  await app.close();
  throw error;
}

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  assertStripeOnlineRuntimePermitted,
  loadConfig,
  loadEnvironmentFile,
} from '@boomerbuddy/config';
import {
  createPGliteDatabase,
  createPostgresDatabase,
  DurableJobRepository,
} from '@boomerbuddy/persistence';
import { enqueueStripeInventory } from '../apps/worker/src/stripe-inventory';

async function main(): Promise<void> {
  if (existsSync('.env')) loadEnvironmentFile();
  const config = loadConfig();
  assertStripeOnlineRuntimePermitted(config, 'worker');
  if (config.commerce.stripe.mode !== 'test') {
    throw new TypeError('Manual Stripe inventory enqueue requires the founder-approved test mode');
  }
  const database =
    config.database.driver === 'pglite'
      ? await createPGliteDatabase(config.database.path)
      : await createPostgresDatabase(config.database.url);
  const operationKey = `stripe-inventory-manual:test:${randomUUID()}`;
  try {
    await enqueueStripeInventory({
      jobs: new DurableJobRepository(database),
      environment: config.commerce.stripe.environment,
      accountId: config.commerce.stripe.accountId,
      apiVersion: config.commerce.stripe.apiVersion,
      evidenceTier: 'stripe_test',
      transportKind: 'stripe_https',
      operationKey,
      scheduledAt: new Date(),
    });
    process.stdout.write(`Queued one test-mode Stripe inventory operation ${operationKey}.\n`);
  } finally {
    await database.close();
  }
}

await main();

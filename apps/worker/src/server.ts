import { existsSync } from 'node:fs';
import { loadConfig, loadEnvironmentFile } from '@boomerbuddy/config';
import { createLogger } from '@boomerbuddy/observability';
import { StripeHttpTransport, StripeTestAdapter } from '@boomerbuddy/integrations';
import {
  BusinessOsRepository,
  CheckRepository,
  CommerceOperationsRepository,
  CommerceRuntimeRepository,
  createPGliteDatabase,
  createPostgresDatabase,
  DurableJobRepository,
  OutboxDeliveryRepository,
  PublicCheckRepository,
  runMigrations,
} from '@boomerbuddy/persistence';
import {
  loadWorkerRuntimeConfig,
  nextRetentionSchedule,
  PortableWorker,
  retentionIntervalKey,
  type JobHandler,
} from '@boomerbuddy/platform';
import { createStripeReconciliationHandler } from './commerce-reconciliation';

if (existsSync('.env')) loadEnvironmentFile();
const appConfig = loadConfig();
const workerConfig = loadWorkerRuntimeConfig();
const logger = createLogger({
  level: appConfig.logLevel,
  base: { process: 'worker', workerId: workerConfig.workerId },
});
const database =
  appConfig.database.driver === 'postgres'
    ? await createPostgresDatabase(appConfig.database.url)
    : await createPGliteDatabase(appConfig.database.path);
if (appConfig.database.runMigrations) await runMigrations(database);

const jobs = new DurableJobRepository(database);
const outbox = new OutboxDeliveryRepository(database);
const checks = new CheckRepository(database, {
  encryptionKey: appConfig.secrets.artifactEncryptionKey,
  encryptionKeyVersion: 1,
  fingerprintKey: appConfig.secrets.fingerprintKey,
  fingerprintKeyVersion: 1,
});
const publicChecks = new PublicCheckRepository(database, {
  encryptionKey: appConfig.secrets.artifactEncryptionKey,
  encryptionKeyVersion: 1,
  hmacKey: appConfig.secrets.fingerprintKey,
  hmacKeyVersion: 1,
});
const commerce = new CommerceOperationsRepository(database, appConfig.secrets.fingerprintKey, 1);
const commerceRuntime = new CommerceRuntimeRepository(database);
const businessOs = new BusinessOsRepository(database);
const retentionIntervalMs = 5 * 60_000;

const retentionHandler: JobHandler = async ({ job, heartbeat }) => {
  const requestedBatch = job.payload.batch;
  const batch =
    typeof requestedBatch === 'number' ? Math.max(1, Math.min(requestedBatch, 500)) : 100;
  const now = new Date();
  const deleted = await checks.purgeDue({ now, limit: batch });
  const publicDeleted = await publicChecks.purgeExpired(now);
  await heartbeat();
  const next = nextRetentionSchedule({
    currentJobId: job.id,
    intervalMs: retentionIntervalMs,
    now,
    workWasFound:
      deleted.length === batch || publicDeleted.contexts > 0 || publicDeleted.results > 0,
  });
  await jobs.enqueue({
    type: 'retention.sweep',
    payload: { batch },
    idempotencyKey: next.idempotencyKey,
    scheduledAt: next.scheduledAt,
    maxAttempts: 8,
    correlationId: next.idempotencyKey,
  });
};

const now = new Date();
await jobs.enqueue({
  type: 'retention.sweep',
  payload: { batch: 100 },
  idempotencyKey: retentionIntervalKey(now, retentionIntervalMs),
  scheduledAt: now,
  maxAttempts: 8,
  correlationId: retentionIntervalKey(now, retentionIntervalMs),
});

const handlers: Record<string, JobHandler> = { 'retention.sweep': retentionHandler };
if (appConfig.commerce.stripe.mode === 'test') {
  handlers['commerce.reconcile'] = createStripeReconciliationHandler({
    businessOs,
    commerce,
    commerceRuntime,
    provider: new StripeTestAdapter(
      new StripeHttpTransport(
        appConfig.commerce.stripe.secretKey,
        appConfig.commerce.stripe.apiVersion,
      ),
      { authorize: async () => ({ allowed: false, reason: 'worker_has_no_checkout_authority' }) },
      new Set(),
      appConfig.commerce.stripe.apiVersion,
    ),
  });
}

const worker = new PortableWorker(jobs, outbox, handlers, undefined, workerConfig, logger);

let closing = false;
const close = async (): Promise<void> => {
  if (closing) return;
  closing = true;
  await worker.stop();
};
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());

try {
  await worker.start();
} finally {
  await worker.stop();
  await database.close();
}

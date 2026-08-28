import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  assertStripeOnlineRuntimePermitted,
  loadConfig,
  loadEnvironmentFile,
} from '@boomerbuddy/config';
import { createLogger } from '@boomerbuddy/observability';
import { StripeHttpTransport } from '@boomerbuddy/integrations';
import {
  AccessIntentRepository,
  AutomationBudgetRepository,
  BusinessOsRepository,
  CheckRepository,
  CommerceOperationsRepository,
  CommerceRuntimeRepository,
  createPGliteDatabase,
  createPostgresDatabase,
  DurableJobRepository,
  FeedbackRepository,
  GovernedContentRepository,
  GrowthRuntimeRepository,
  growthProjectionEventTypes,
  MessagingRepository,
  MobileJtiSessionRetentionRepository,
  OperationalWorkRepository,
  OutboxDeliveryRepository,
  PublicCheckRepository,
  ProductionIdentityRepository,
  SupportReceiptRepository,
  runMigrations,
} from '@boomerbuddy/persistence';
import {
  loadWorkerRuntimeConfig,
  nextRetentionSchedule,
  PortableWorker,
  retentionIntervalKey,
  type JobHandler,
} from '@boomerbuddy/platform';
import {
  automationBudgetMaintenanceJobType,
  createAutomationBudgetMaintenanceHandler,
  enqueueAutomationBudgetMaintenance,
} from './automation-budget-maintenance';
import { createStripeReconciliationHandler } from './commerce-reconciliation';
import { composeFeedbackWorker } from './feedback-composition';
import { composeProviderFreeMessagingWorker } from './messaging-composition';
import { runMobileSessionRetentionSweep } from './mobile-session-retention';
import {
  createStripeInventoryHandler,
  enqueueStripeInventory,
  stripeInventoryJobType,
} from './stripe-inventory';
import { createStripeSessionRetryHandler, stripeSessionRetryJobType } from './stripe-session-retry';
import { createWorkerStripeAdapter } from './stripe-adapter';
import { createGrowthRuntimeHandlers, enqueueGrowthRuntimeJobs } from './growth-runtime';
import { runReplitWorkerLifecycle } from './health-server';
import { createOperationalHandlers, seedOperationalSchedules } from './operational-handlers';
import {
  createGovernedContentDailyHandler,
  enqueueGovernedContentDailyJob,
  governedContentDailyJobType,
} from './governed-content';

if (existsSync('.env')) loadEnvironmentFile();
await runReplitWorkerLifecycle(
  process.env,
  async ({ registerDatabaseClose, registerWorkerStop }) => {
    const appConfig = loadConfig();
    assertStripeOnlineRuntimePermitted(appConfig, 'worker');
    const workerConfig = loadWorkerRuntimeConfig();
    const logger = createLogger({
      level: appConfig.logLevel,
      base: { process: 'worker', workerId: workerConfig.workerId },
    });
    const database =
      appConfig.database.driver === 'postgres'
        ? await createPostgresDatabase(appConfig.database.url, {
            poolMax: appConfig.database.poolMax,
          })
        : await createPGliteDatabase(appConfig.database.path);
    registerDatabaseClose(() => database.close());
    if (appConfig.database.runMigrations) await runMigrations(database);
    if (appConfig.environment === 'production') {
      const clerk = appConfig.identity.clerk;
      const founderPersonId = appConfig.identity.founderPersonId;
      if (clerk === undefined || founderPersonId === undefined) {
        throw new TypeError('Production Clerk founder configuration is incomplete');
      }
      await new ProductionIdentityRepository(database).assertFounderBinding({
        issuer: clerk.hq.issuer,
        subject: clerk.founderSubject,
        founderPersonId,
      });
    }
    const entitlementRuntimeEnvironment =
      appConfig.environment === 'production' ? ('production' as const) : ('local' as const);

    const jobs = new DurableJobRepository(database);
    const automationBudget = new AutomationBudgetRepository(
      database,
      undefined,
      appConfig.identity.founderPersonId,
    );
    const outbox = new OutboxDeliveryRepository(database);
    const checks = new CheckRepository(
      database,
      {
        encryptionKey: appConfig.secrets.artifactEncryptionKey,
        encryptionKeyVersion: 1,
        fingerprintKey: appConfig.secrets.fingerprintKey,
        fingerprintKeyVersion: 1,
      },
      undefined,
      entitlementRuntimeEnvironment,
    );
    const publicChecks = new PublicCheckRepository(database, {
      encryptionKey: appConfig.secrets.artifactEncryptionKey,
      encryptionKeyVersion: 1,
      hmacKey: appConfig.secrets.fingerprintKey,
      hmacKeyVersion: 1,
    });
    const accessIntents = new AccessIntentRepository(database, appConfig.secrets.fingerprintKey);
    const supportReceipts = new SupportReceiptRepository(
      database,
      appConfig.secrets.fingerprintKey,
    );
    const feedback = new FeedbackRepository(database, {
      encryptionKey: appConfig.secrets.artifactEncryptionKey,
      encryptionKeyVersion: 1,
      fingerprintKey: appConfig.secrets.fingerprintKey,
      fingerprintKeyVersion: 1,
    });
    const governedContent = new GovernedContentRepository(database, {
      encryptionKey: appConfig.secrets.artifactEncryptionKey,
      encryptionKeyVersion: 1,
    });
    const messaging = new MessagingRepository(
      database,
      {
        encryptionKey: appConfig.secrets.artifactEncryptionKey,
        encryptionKeyVersion: 1,
        fingerprintKey: appConfig.secrets.fingerprintKey,
        fingerprintKeyVersion: 1,
      },
      undefined,
      entitlementRuntimeEnvironment,
    );
    const commerce = new CommerceOperationsRepository(
      database,
      appConfig.secrets.fingerprintKey,
      1,
      undefined,
      entitlementRuntimeEnvironment,
    );
    const commerceRuntime = new CommerceRuntimeRepository(database);
    const businessOs = new BusinessOsRepository(database);
    const growth = new GrowthRuntimeRepository(database);
    const operations = new OperationalWorkRepository(database);
    const mobileSessionRetention = new MobileJtiSessionRetentionRepository(database);
    const retentionIntervalMs = 5 * 60_000;

    const retentionHandler: JobHandler = async ({ job, heartbeat }) => {
      const requestedBatch = job.payload.batch;
      const batch =
        typeof requestedBatch === 'number' ? Math.max(1, Math.min(requestedBatch, 500)) : 100;
      const now = new Date();
      const deleted = await checks.purgeDue({ now, limit: batch });
      const publicDeleted = await publicChecks.purgeExpired(now);
      const accessIntentCleanup = await accessIntents.purgeExpired(now, batch);
      const supportReceiptCleanup = await supportReceipts.purgeTerminal(Math.min(batch, 100));
      const messagingDeleted =
        entitlementRuntimeEnvironment === 'local'
          ? await messaging.purgeExpiredSupportContent({ limit: batch, now })
          : [];
      const mobileRetention = await runMobileSessionRetentionSweep({
        retention: mobileSessionRetention,
        logger,
        now,
        limit: batch,
      });
      await heartbeat();
      const next = nextRetentionSchedule({
        currentJobId: job.id,
        intervalMs: retentionIntervalMs,
        now,
        workWasFound:
          deleted.length === batch ||
          publicDeleted.contexts > 0 ||
          publicDeleted.results > 0 ||
          accessIntentCleanup.saturated ||
          supportReceiptCleanup.saturated ||
          messagingDeleted.length === batch ||
          mobileRetention.cleanupSaturated,
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
    const feedbackComposition = await composeFeedbackWorker({
      environment: appConfig.environment,
      feedback,
      jobs,
      now,
    });
    const messagingComposition = composeProviderFreeMessagingWorker({
      environment: appConfig.environment,
      messaging,
    });
    await jobs.enqueue({
      type: 'retention.sweep',
      payload: { batch: 100 },
      idempotencyKey: retentionIntervalKey(now, retentionIntervalMs),
      scheduledAt: now,
      maxAttempts: 8,
      correlationId: retentionIntervalKey(now, retentionIntervalMs),
    });
    await enqueueAutomationBudgetMaintenance({ jobs, now, batch: 25 });
    await enqueueGrowthRuntimeJobs({ jobs, now, batch: 100 });
    await seedOperationalSchedules({ environment: appConfig.environment, jobs, now });
    if (appConfig.content?.dailyDraftGenerationEnabled === true) {
      await enqueueGovernedContentDailyJob({ jobs, now });
    }

    const handlers: Record<string, JobHandler> = {
      'retention.sweep': retentionHandler,
      ...feedbackComposition.handlers,
      ...messagingComposition.handlers,
      [automationBudgetMaintenanceJobType]: createAutomationBudgetMaintenanceHandler({
        budgets: automationBudget,
        jobs,
      }),
      ...createGrowthRuntimeHandlers({ growth, jobs }),
      ...createOperationalHandlers({
        environment: appConfig.environment,
        jobs,
        operations,
        fingerprintKey: appConfig.secrets.fingerprintKey,
      }),
      ...(appConfig.content?.dailyDraftGenerationEnabled === true
        ? {
            [governedContentDailyJobType]: createGovernedContentDailyHandler({
              content: governedContent,
              jobs,
            }),
          }
        : {}),
    };
    if (
      appConfig.commerce.stripe.mode === 'test' ||
      (appConfig.commerce.stripe.mode === 'live' &&
        appConfig.commerce.stripe.runtimeSurface === 'worker')
    ) {
      const stripe = appConfig.commerce.stripe;
      const restrictedKey = stripe.mode === 'test' ? stripe.apiKey : stripe.workerRestrictedKey;
      const evidenceLevel = stripe.mode === 'test' ? 'stripe_test' : 'live_production';
      const runtimeRunId = `worker-${randomUUID()}`;
      const stripeAdapter = createWorkerStripeAdapter({
        transport: new StripeHttpTransport(restrictedKey, stripe.apiVersion),
        customerOrigins: appConfig.identity.customerOrigins,
        configuration: {
          environment: stripe.environment,
          accountId: stripe.accountId,
          apiVersion: stripe.apiVersion,
          portalConfigurationId: stripe.cancelOnlyPortalConfigurationId,
          defaultOfferId: stripe.defaultOfferId,
          offers: stripe.offers,
        },
      });
      handlers['commerce.reconcile'] = createStripeReconciliationHandler({
        businessOs,
        commerce,
        commerceRuntime,
        jobs,
        provider: stripeAdapter,
      });
      handlers[stripeSessionRetryJobType] = createStripeSessionRetryHandler({
        businessOs,
        commerceRuntime,
        provider: stripeAdapter,
        evidenceLevel,
        transportKind: 'stripe_https',
        runtimeRunId,
        authenticityKind: 'provider_read',
        runtimeInitiationPermitted: stripe.runtimeInitiationPermitted,
      });
      handlers[stripeInventoryJobType] = createStripeInventoryHandler({
        businessOs,
        commerceRuntime,
        jobs,
        provider: stripeAdapter,
        runtimeRunId,
      });
      await enqueueStripeInventory({
        jobs,
        environment: stripe.environment,
        accountId: stripe.accountId,
        apiVersion: stripe.apiVersion,
        evidenceTier: evidenceLevel,
        transportKind: 'stripe_https',
        scheduledAt: now,
      });
    }

    const worker = new PortableWorker(
      jobs,
      outbox,
      handlers,
      {
        eventTypes: growthProjectionEventTypes,
        handle: async ({ event, heartbeat }) => {
          await growth.projectEventById({ eventId: event.id, now: new Date() });
          await heartbeat();
        },
      },
      workerConfig,
      logger,
    );

    let stopPromise: Promise<void> | undefined;
    const stopWorker = (): Promise<void> => {
      stopPromise ??= worker.stop();
      return stopPromise;
    };
    registerWorkerStop(stopWorker);

    const stopOnSignal = (): void => {
      void stopWorker();
    };
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, stopOnSignal);
    }

    try {
      await worker.start();
    } finally {
      for (const signal of ['SIGINT', 'SIGTERM']) {
        process.off(signal, stopOnSignal);
      }
    }
  },
);

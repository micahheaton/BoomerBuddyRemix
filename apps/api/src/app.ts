import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { AppConfig } from '@boomerbuddy/config';
import { publicConfigResponseSchema } from '@boomerbuddy/contracts';
import { DomainError, seededCommercePlanVersions } from '@boomerbuddy/domain';
import { StripeHttpTransport, type StripeTransport } from '@boomerbuddy/integrations';
import { createLogger, createRequestId, type Logger } from '@boomerbuddy/observability';
import {
  createPGliteDatabase,
  createPostgresDatabase,
  runMigrations,
  seedDemoData,
  type Database,
} from '@boomerbuddy/persistence';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { createRepositories, type ApiContext } from './context';
import { registerCheckRoutes } from './routes/checks';
import { registerBusinessOsRoutes } from './routes/business-os';
import { registerCommerceRoutes } from './routes/commerce';
import { registerFamilyRoutes } from './routes/family';
import { registerHqRoutes } from './routes/hq';
import { registerOrientationRoutes } from './routes/orientation';
import { registerPublicCheckRoutes } from './routes/public-checks';
import { registerPrivacyRoutes } from './routes/privacy';
import { registerSessionRoutes } from './routes/sessions';

export interface BuildAppOptions {
  readonly config: AppConfig;
  readonly database?: Database;
  readonly logger?: Logger;
  readonly now?: () => Date;
  readonly initialize?: boolean;
  readonly closeDatabase?: boolean;
  /** Test/local override; production scheduling is deliberately blocked in Build Run 1. */
  readonly retentionSweepIntervalMs?: number;
  /** Deterministic fixture transport for tests; runtime otherwise uses Stripe HTTPS in test mode. */
  readonly stripeTransport?: StripeTransport;
}

const retentionBatchSize = 100;
const retentionMaxBatchesPerSweep = 10;

export async function connectDatabase(config: AppConfig): Promise<Database> {
  return config.database.driver === 'pglite'
    ? createPGliteDatabase(config.database.path)
    : createPostgresDatabase(config.database.url);
}

function statusFor(error: DomainError): number {
  switch (error.code) {
    case 'invalid_input':
    case 'restricted_input':
      return 400;
    case 'not_authenticated':
      return 401;
    case 'not_authorized':
      return 403;
    case 'not_found':
      return 404;
    case 'conflict':
    case 'invalid_transition':
      return 409;
    case 'expired':
      return 410;
  }
}

function installErrors(app: FastifyInstance, logger: Logger): void {
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: { code: 'not_found', message: 'Route is unavailable', requestId: request.id },
    }),
  );
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'invalid_request',
          message: 'Request validation failed',
          requestId: request.id,
          details: { issueCount: error.issues.length },
        },
      });
    }
    if (error instanceof DomainError) {
      return reply.code(statusFor(error)).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
          ...(error.safeDetails === undefined ? {} : { details: error.safeDetails }),
        },
      });
    }
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : undefined;
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({
        error: {
          code: statusCode === 413 ? 'payload_too_large' : 'invalid_request',
          message:
            statusCode === 413 ? 'Request payload is too large' : 'Request could not be parsed',
          requestId: request.id,
        },
      });
    }
    logger.error('api.request_failed', {
      requestId: request.id,
      route: request.routeOptions.url,
      method: request.method,
      error,
    });
    return reply.code(500).send({
      error: {
        code: 'internal_error',
        message: 'The request could not be completed',
        requestId: request.id,
      },
    });
  });
}

function registerBaseRoutes(app: FastifyInstance, context: ApiContext): void {
  app.get('/health/live', () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    try {
      await context.database.query('SELECT 1');
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'not_ready' });
    }
  });
  app.get('/v1/public/config', () =>
    publicConfigResponseSchema.parse({
      productName: 'BoomerBuddy',
      environment: context.config.environment,
      checkKinds: ['text', 'url'],
      nativeSharingImplemented: false,
      liveProvidersEnabled: false,
      pricing: Object.values(seededCommercePlanVersions).map((plan) => {
        const monthly = plan.prices.find(
          (price) => price.kind === 'list' && price.interval === 'month',
        );
        const annual = plan.prices.find(
          (price) => price.kind === 'list' && price.interval === 'year',
        );
        const founding = plan.prices.find((price) => price.kind === 'founding_experiment');
        if (monthly === undefined || annual === undefined) {
          throw new TypeError('Public pricing hypothesis is incomplete');
        }
        return {
          key: plan.key,
          name: plan.displayName,
          monthlyUsd: monthly.amountMinor / 100,
          annualUsd: annual.amountMinor / 100,
          ...(founding === undefined ? {} : { foundingAnnualUsd: founding.amountMinor / 100 }),
          hypothesis: true,
        };
      }),
    }),
  );
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const database = options.database ?? (await connectDatabase(options.config));
  const closeDatabase = options.closeDatabase ?? options.database === undefined;
  const logger = options.logger ?? createLogger({ level: options.config.logLevel });
  const context: ApiContext = {
    config: options.config,
    database,
    repositories: createRepositories(database, options.config),
    logger,
    now: options.now ?? (() => new Date()),
  };
  const drainDueRetention = async (): Promise<boolean> => {
    let moreDue = false;
    for (let batch = 0; batch < retentionMaxBatchesPerSweep; batch += 1) {
      const deleted = await context.repositories.checks.purgeDue({
        now: context.now(),
        limit: retentionBatchSize,
      });
      if (deleted.length < retentionBatchSize) break;
      moreDue = batch === retentionMaxBatchesPerSweep - 1;
    }
    await context.repositories.publicChecks.purgeExpired(context.now());
    return moreDue;
  };
  let retentionNeedsContinuation = false;
  try {
    if (options.initialize !== false && options.config.database.runMigrations) {
      await runMigrations(database);
    }
    if (options.initialize !== false && options.config.database.seedDemo) {
      await seedDemoData(
        database,
        {
          encryptionKey: options.config.secrets.artifactEncryptionKey,
          encryptionKeyVersion: 1,
          fingerprintKey: options.config.secrets.fingerprintKey,
          fingerprintKeyVersion: 1,
        },
        context.now(),
      );
    }
    retentionNeedsContinuation = await drainDueRetention();
  } catch (error) {
    if (closeDatabase) await database.close();
    throw error;
  }

  const allowedOrigins = new Set([
    ...options.config.identity.customerOrigins,
    ...options.config.identity.hqOrigins,
  ]);
  const app = Fastify({
    logger: false,
    bodyLimit: 24 * 1_024,
    genReqId: () => createRequestId(),
    trustProxy: false,
  });
  let retentionContinuation: ReturnType<typeof setTimeout> | undefined;
  let retentionSweep: Promise<void> | undefined;
  let closing = false;
  const scheduleRetentionContinuation = (): void => {
    if (closing || retentionContinuation !== undefined) return;
    retentionContinuation = setTimeout(() => {
      retentionContinuation = undefined;
      runRetentionSweep();
    }, 0);
    retentionContinuation.unref();
  };
  const runRetentionSweep = (): void => {
    if (closing || retentionSweep !== undefined) return;
    retentionSweep = drainDueRetention()
      .then((moreDue) => {
        if (moreDue) scheduleRetentionContinuation();
      })
      .catch((error: unknown) => {
        logger.error('retention.sweep_failed', { error });
      })
      .finally(() => {
        retentionSweep = undefined;
      });
  };
  const retentionInterval =
    options.retentionSweepIntervalMs === undefined
      ? undefined
      : setInterval(runRetentionSweep, options.retentionSweepIntervalMs);
  if (retentionNeedsContinuation) scheduleRetentionContinuation();
  retentionInterval?.unref();
  await app.register(cookie);
  await app.register(cors, {
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-BB-Household-Id', 'Idempotency-Key'],
    origin: (origin, callback) => {
      callback(null, origin === undefined || allowedOrigins.has(origin));
    },
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  app.addHook('onRequest', (request, reply, done) => {
    void reply.header('x-request-id', request.id);
    done();
  });
  app.addHook('onResponse', (request, reply, done) => {
    logger.info('api.request_completed', {
      requestId: request.id,
      route: request.routeOptions.url,
      method: request.method,
      statusCode: reply.statusCode,
    });
    done();
  });
  app.addHook('onClose', async () => {
    closing = true;
    if (retentionInterval !== undefined) clearInterval(retentionInterval);
    if (retentionContinuation !== undefined) clearTimeout(retentionContinuation);
    await retentionSweep;
    if (closeDatabase) {
      await database.close();
    }
  });
  installErrors(app, logger);
  registerBaseRoutes(app, context);
  registerPublicCheckRoutes(app, context, context.repositories.publicChecks);
  registerPrivacyRoutes(app, context);
  registerSessionRoutes(app, context);
  registerCheckRoutes(app, context);
  registerFamilyRoutes(app, context);
  registerOrientationRoutes(app, context);
  registerCommerceRoutes(
    app,
    context,
    options.stripeTransport ??
      (context.config.commerce.stripe.mode === 'test'
        ? new StripeHttpTransport(
            context.config.commerce.stripe.secretKey,
            context.config.commerce.stripe.apiVersion,
          )
        : undefined),
  );
  registerHqRoutes(app, context);
  registerBusinessOsRoutes(app, context);
  return app;
}

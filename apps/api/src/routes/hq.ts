import { assertAuthorized, type Action } from '@boomerbuddy/authorization';
import {
  hqAuditResponseSchema,
  hqChecksResponseSchema,
  hqHouseholdsResponseSchema,
  hqOperationalHealthResponseSchema,
  hqOverviewResponseSchema,
  hqProviderHealthResponseSchema,
  hqReviewQueueResponseSchema,
  hqRevenueResponseSchema,
  hqSupportQueueResponseSchema,
} from '@boomerbuddy/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate, correlationId } from '../auth';
import type { ApiContext } from '../context';

const queuePageSize = 100;

function bounded<T>(items: readonly T[]): {
  readonly items: readonly T[];
  readonly truncated: boolean;
} {
  return { items: items.slice(0, queuePageSize), truncated: items.length > queuePageSize };
}

async function authorizeHq(request: FastifyRequest, context: ApiContext, action: Action) {
  const auth = await authenticate(
    request,
    context.repositories.sessions,
    context.config,
    ['hq'],
    context.now(),
  );
  assertAuthorized({ principal: auth.principal, action, resource: { kind: 'hq' } });
  return auth;
}

export function registerHqRoutes(app: FastifyInstance, context: ApiContext): void {
  const dataState =
    context.config.environment === 'production'
      ? ('live_database' as const)
      : ('local_development' as const);

  app.get('/v1/hq/overview', async (request) => {
    await authorizeHq(request, context, 'hq:overview');
    const value = await context.repositories.hq.overview(context.now());
    return hqOverviewResponseSchema.parse({
      metrics: value.metrics.map((metric) => ({
        ...metric,
        label:
          dataState === 'live_database'
            ? metric.label.replace(/^Local /u, 'Early-access ')
            : metric.label,
        updatedAt: metric.updatedAt.toISOString(),
        source: dataState,
        dataState,
      })),
      alerts:
        dataState === 'live_database'
          ? [
              {
                key: 'private_beta_data',
                severity: 'info' as const,
                message:
                  'Metrics summarize early-access database records. Provider, deployed-observability, human, and efficacy evidence remain separately labeled.',
                dataState,
              },
            ]
          : value.alerts.map((alert) => ({ ...alert, dataState })),
    });
  });

  app.get('/v1/hq/households', async (request) => {
    const auth = await authorizeHq(request, context, 'hq:households:list');
    const page = bounded(
      await context.repositories.hq.ownerHouseholds({
        actorPersonId: auth.principal.personId,
        correlationId: correlationId(request),
        now: context.now(),
      }),
    );
    return hqHouseholdsResponseSchema.parse({
      households: page.items.map((household) => ({
        ...household,
        dataState,
      })),
      truncated: page.truncated,
    });
  });

  app.get('/v1/hq/checks', async (request) => {
    const auth = await authorizeHq(request, context, 'hq:reviews:list');
    const checks = await context.repositories.hq.ownerChecks({
      actorPersonId: auth.principal.personId,
      correlationId: correlationId(request),
      now: context.now(),
    });
    return hqChecksResponseSchema.parse({
      checks: checks.map((check) => ({
        ...check,
        createdAt: check.createdAt.toISOString(),
        dataState,
      })),
    });
  });

  app.get('/v1/hq/support-queue', async (request) => {
    const auth = await authorizeHq(request, context, 'hq:support_queue:list');
    const page = bounded(
      await context.repositories.hq.assignedSupportCases({
        actorPersonId: auth.principal.personId,
        correlationId: correlationId(request),
        now: context.now(),
      }),
    );
    return hqSupportQueueResponseSchema.parse({
      projection: 'assigned_support_queue',
      cases: page.items.map((supportCase) => ({
        ...supportCase,
        assignedAt: supportCase.assignedAt.toISOString(),
        dataState,
      })),
      truncated: page.truncated,
    });
  });

  app.get('/v1/hq/review-queue', async (request) => {
    const auth = await authorizeHq(request, context, 'hq:review_queue:list');
    const page = bounded(
      await context.repositories.hq.assignedReviewCases({
        actorPersonId: auth.principal.personId,
        correlationId: correlationId(request),
        now: context.now(),
      }),
    );
    return hqReviewQueueResponseSchema.parse({
      projection: 'assigned_review_queue',
      cases: page.items.map((reviewCase) => ({
        ...reviewCase,
        ...(reviewCase.dueAt === undefined ? {} : { dueAt: reviewCase.dueAt.toISOString() }),
        updatedAt: reviewCase.updatedAt.toISOString(),
        dataState,
      })),
      truncated: page.truncated,
    });
  });

  app.get('/v1/hq/provider-health', async (request) => {
    await authorizeHq(request, context, 'hq:overview');
    const providers = await context.repositories.hq.providerHealth();
    return hqProviderHealthResponseSchema.parse({
      providers: providers.map((provider) => ({
        ...provider,
        lastCheckedAt: provider.lastCheckedAt.toISOString(),
        dataState,
      })),
    });
  });

  app.get('/v1/hq/operational-health', async (request, reply) => {
    const auth = await authorizeHq(request, context, 'hq:overview');
    const health = await context.repositories.hq.ownerOperationalHealth({
      actorPersonId: auth.principal.personId,
      correlationId: correlationId(request),
      observeNow: () => context.now(),
    });
    void reply.header('Cache-Control', 'private, no-store, max-age=0');
    void reply.header('Pragma', 'no-cache');
    return hqOperationalHealthResponseSchema.parse({
      ...health,
      generatedAt: health.generatedAt.toISOString(),
    });
  });

  app.get('/v1/hq/audit', async (request) => {
    await authorizeHq(request, context, 'hq:audit:list');
    const events = await context.repositories.hq.audit();
    return hqAuditResponseSchema.parse({
      events: events.map((event) => ({ ...event, occurredAt: event.occurredAt.toISOString() })),
    });
  });

  app.get('/v1/hq/revenue', async (request) => {
    await authorizeHq(request, context, 'hq:overview');
    const revenue = await context.repositories.hq.revenue(context.now());
    const truncated =
      revenue.savedSearches.length > queuePageSize ||
      revenue.targetAccounts.length > queuePageSize ||
      revenue.opportunities.length > queuePageSize;
    return hqRevenueResponseSchema.parse({
      savedSearches: revenue.savedSearches.slice(0, queuePageSize).map((search) => ({
        ...search,
        source: 'seeded',
      })),
      targetAccounts: revenue.targetAccounts.slice(0, queuePageSize),
      opportunities: revenue.opportunities.slice(0, queuePageSize).map((opportunity) => ({
        ...opportunity,
        nextActionAt: opportunity.nextActionAt.toISOString(),
        dataState: 'seeded',
      })),
      truncated,
    });
  });
}

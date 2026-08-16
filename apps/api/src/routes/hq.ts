import { assertAuthorized, type Action } from '@boomerbuddy/authorization';
import {
  hqAuditResponseSchema,
  hqChecksResponseSchema,
  hqHouseholdsResponseSchema,
  hqOverviewResponseSchema,
  hqProviderHealthResponseSchema,
  hqRevenueResponseSchema,
} from '@boomerbuddy/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate } from '../auth';
import type { ApiContext } from '../context';

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
  app.get('/v1/hq/overview', async (request) => {
    await authorizeHq(request, context, 'hq:overview');
    const value = await context.repositories.hq.overview(context.now());
    return hqOverviewResponseSchema.parse({
      metrics: value.metrics.map((metric) => ({
        ...metric,
        updatedAt: metric.updatedAt.toISOString(),
        dataState: 'local_development',
      })),
      alerts: value.alerts.map((alert) => ({ ...alert, dataState: 'local_development' })),
    });
  });

  app.get('/v1/hq/households', async (request) => {
    await authorizeHq(request, context, 'hq:households:list');
    const households = await context.repositories.hq.households(context.now());
    return hqHouseholdsResponseSchema.parse({
      households: households.map((household) => ({
        ...household,
        dataState: 'local_development',
      })),
    });
  });

  app.get('/v1/hq/checks', async (request) => {
    await authorizeHq(request, context, 'hq:reviews:list');
    const checks = await context.repositories.hq.checks(context.now());
    return hqChecksResponseSchema.parse({
      checks: checks.map((check) => ({
        ...check,
        createdAt: check.createdAt.toISOString(),
        dataState: 'local_development',
      })),
    });
  });

  app.get('/v1/hq/provider-health', async (request) => {
    await authorizeHq(request, context, 'hq:overview');
    const providers = await context.repositories.hq.providerHealth();
    return hqProviderHealthResponseSchema.parse({
      providers: providers.map((provider) => ({
        ...provider,
        lastCheckedAt: provider.lastCheckedAt.toISOString(),
        dataState: 'local_development',
      })),
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
    return hqRevenueResponseSchema.parse({
      savedSearches: revenue.savedSearches.map((search) => ({
        ...search,
        source: 'seeded',
      })),
      targetAccounts: revenue.targetAccounts,
      opportunities: revenue.opportunities.map((opportunity) => ({
        ...opportunity,
        nextActionAt: opportunity.nextActionAt.toISOString(),
        dataState: 'seeded',
      })),
    });
  });
}

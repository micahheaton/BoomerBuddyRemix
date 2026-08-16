import { assertAuthorized } from '@boomerbuddy/authorization';
import {
  completeOrientationStepRequestSchema,
  entitlementResponseSchema,
  opaqueIdSchema,
  orientationResponseSchema,
  orientationStepSchema,
  safeWordRequestSchema,
} from '@boomerbuddy/contracts';
import { DomainError, ids } from '@boomerbuddy/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  assertMutationOrigin,
  authenticate,
  correlationId,
  selectedHousehold,
  type AuthContext,
} from '../auth';
import type { ApiContext } from '../context';
import { orientationDto } from '../mappers';

const subjectQuerySchema = z.object({ subjectPersonId: opaqueIdSchema.optional() }).strict();
const stepParamsSchema = z.object({ stepKey: orientationStepSchema });

async function orientationScope(request: FastifyRequest, context: ApiContext, auth: AuthContext) {
  const household = selectedHousehold(auth, request);
  const query = subjectQuerySchema.parse(request.query);
  const subjectPersonId = ids.person(query.subjectPersonId ?? auth.principal.personId);
  if (subjectPersonId !== auth.principal.personId) {
    const pairwise = await context.repositories.family.canHelpOrientation(
      household.householdId,
      subjectPersonId,
      auth.principal.personId,
    );
    if (!pairwise) throw new DomainError('not_authorized', 'Orientation help is not permitted');
  }
  return { household, subjectPersonId };
}

async function orientationAuth(request: FastifyRequest, context: ApiContext) {
  const auth = await authenticate(
    request,
    context.repositories.sessions,
    context.config,
    ['customer', 'mobile'],
    context.now(),
  );
  const scope = await orientationScope(request, context, auth);
  return { auth, ...scope };
}

export function registerOrientationRoutes(app: FastifyInstance, context: ApiContext): void {
  app.get('/v1/orientation', async (request) => {
    const { auth, household, subjectPersonId } = await orientationAuth(request, context);
    assertAuthorized({
      principal: auth.principal,
      action: 'orientation:view',
      resource: { kind: 'orientation', householdId: household.householdId, subjectPersonId },
    });
    const orientation = await context.repositories.orientation.get(
      household.householdId,
      subjectPersonId,
      context.now(),
    );
    return orientationResponseSchema.parse({ orientation: orientationDto(orientation) });
  });

  app.post('/v1/orientation/start', async (request, reply) => {
    const { auth, household, subjectPersonId } = await orientationAuth(request, context);
    assertMutationOrigin(request, context.config, auth);
    assertAuthorized({
      principal: auth.principal,
      action: 'orientation:update',
      resource: { kind: 'orientation', householdId: household.householdId, subjectPersonId },
    });
    const now = context.now();
    const orientation = await context.repositories.orientation.start({
      householdId: household.householdId,
      subjectPersonId,
      actorPersonId: auth.principal.personId,
      audience: auth.audience,
      correlationId: correlationId(request),
      now,
    });
    return reply.send(
      orientationResponseSchema.parse({ orientation: orientationDto(orientation) }),
    );
  });

  app.put('/v1/orientation/steps/:stepKey', async (request, reply) => {
    const { auth, household, subjectPersonId } = await orientationAuth(request, context);
    assertMutationOrigin(request, context.config, auth);
    assertAuthorized({
      principal: auth.principal,
      action: 'orientation:update',
      resource: { kind: 'orientation', householdId: household.householdId, subjectPersonId },
    });
    completeOrientationStepRequestSchema.parse(request.body);
    const { stepKey } = stepParamsSchema.parse(request.params);
    const orientation = await context.repositories.orientation.completeStep({
      householdId: household.householdId,
      subjectPersonId,
      actorPersonId: auth.principal.personId,
      step: stepKey,
      audience: auth.audience,
      correlationId: correlationId(request),
      now: context.now(),
    });
    return reply.send(
      orientationResponseSchema.parse({ orientation: orientationDto(orientation) }),
    );
  });

  app.put('/v1/orientation/safe-word', async (request, reply) => {
    const { auth, household, subjectPersonId } = await orientationAuth(request, context);
    assertMutationOrigin(request, context.config, auth);
    assertAuthorized({
      principal: auth.principal,
      action: 'orientation:update',
      resource: { kind: 'orientation', householdId: household.householdId, subjectPersonId },
    });
    const body = safeWordRequestSchema.parse(request.body);
    const now = context.now();
    await context.repositories.orientation.get(household.householdId, subjectPersonId, now);
    const orientation = await context.repositories.orientation.setSafeWord({
      householdId: household.householdId,
      subjectPersonId,
      actorPersonId: auth.principal.personId,
      action: body.action,
      ...(body.action === 'configure' ? { phrase: body.phrase } : {}),
      audience: auth.audience,
      correlationId: correlationId(request),
      now,
    });
    return reply.send(
      orientationResponseSchema.parse({ orientation: orientationDto(orientation) }),
    );
  });

  app.get('/v1/entitlements', async (request) => {
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer', 'mobile'],
      context.now(),
    );
    const household = selectedHousehold(auth, request);
    assertAuthorized({
      principal: auth.principal,
      action: 'entitlement:view',
      resource: { kind: 'entitlement', householdId: household.householdId },
    });
    const entitlements = await context.repositories.entitlements.forHousehold(
      household.householdId,
      context.now(),
    );
    const primarySource = entitlements.portfolio.primarySource;
    const primaryRecord =
      primarySource === null
        ? undefined
        : entitlements.sources.find(
            (source) => source.subscription.id === primarySource.subscriptionId,
          );
    return entitlementResponseSchema.parse({
      subject: { kind: 'household', id: household.householdId },
      capabilities: [...entitlements.capabilities],
      grants: entitlements.grants.map((grant) => {
        if (grant.planVersionId === undefined || grant.subscriptionId === undefined) {
          throw new TypeError('Canonical commerce grant linkage is unavailable');
        }
        return {
          id: grant.id,
          source: grant.source,
          startsAt: grant.startsAt.toISOString(),
          ...(grant.endsAt === undefined ? {} : { endsAt: grant.endsAt.toISOString() }),
          sourceVerified: grant.sourceVerified,
          planVersionId: grant.planVersionId,
          subscriptionId: grant.subscriptionId,
          effective: entitlements.portfolio.contributingGrantIds.includes(grant.id),
        };
      }),
      commerce: {
        accessState: entitlements.portfolio.accessState,
        primary:
          primarySource === null || primaryRecord === undefined
            ? null
            : {
                subscriptionId: primarySource.subscriptionId,
                source: primarySource.source,
                lifecycle: primarySource.lifecycle,
                precedence: primarySource.precedence,
                sourceVerified: primaryRecord.subscription.sourceVerified,
                reconciliationState: primaryRecord.reconciliationState,
                startsAt: primaryRecord.subscription.startsAt.toISOString(),
                ...(primaryRecord.subscription.accessEndsAt === undefined
                  ? {}
                  : { accessEndsAt: primaryRecord.subscription.accessEndsAt.toISOString() }),
                plan: {
                  id: primaryRecord.plan.id,
                  key: primaryRecord.plan.key,
                  version: primaryRecord.plan.version,
                  displayName: primaryRecord.plan.displayName,
                  state: primaryRecord.planState,
                  prices: primaryRecord.plan.prices.map((price) => ({ ...price })),
                },
              },
        sources: entitlements.portfolio.sources.map((source) => ({
          ...source,
          contributingGrantIds: [...source.contributingGrantIds],
        })),
        allowances: entitlements.portfolio.allowances.map((allowance) => ({ ...allowance })),
        mode: 'local_mock',
        hypothesis: true,
      },
      environment: context.config.environment === 'test' ? 'test' : 'development',
    });
  });
}

import { assertAuthorized } from '@boomerbuddy/authorization';
import {
  completeOrientationStepRequestSchema,
  enrollProtectedSelfRequestSchema,
  enrollProtectedSelfResponseSchema,
  entitlementResponseSchema,
  opaqueIdSchema,
  orientationResponseSchema,
  orientationStepSchema,
  protectedSelfEnrollmentOperationKeySchema,
  protectedSelfEnrollmentStatusResponseSchema,
  safeWordRequestSchema,
  withdrawProtectedSelfRequestSchema,
  withdrawProtectedSelfResponseSchema,
} from '@boomerbuddy/contracts';
import { DomainError, ids } from '@boomerbuddy/domain';
import { protectedSelfEnrollmentConsent } from '@boomerbuddy/persistence';
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
import { entitlementResponseDto, entitlementRuntimeDto } from '../entitlement-response';
import { orientationDto } from '../mappers';

const subjectQuerySchema = z.object({ subjectPersonId: opaqueIdSchema.optional() }).strict();
const stepParamsSchema = z.object({ stepKey: orientationStepSchema });
const noProtectedSelfTargetSchema = z.object({}).strict();

function protectedSelfOperationKey(request: FastifyRequest, action: 'enroll' | 'withdraw'): string {
  const raw = request.headers['idempotency-key'];
  const parsed = protectedSelfEnrollmentOperationKeySchema.safeParse(raw);
  if (!parsed.success || !parsed.data.startsWith(`protected-self-${action}:`)) {
    throw new DomainError(
      'invalid_input',
      `One action-bound protected-self ${action} Idempotency-Key header is required`,
    );
  }
  return parsed.data;
}

async function protectedSelfAuth(request: FastifyRequest, context: ApiContext) {
  const auth = await authenticate(
    request,
    context.repositories.sessions,
    context.config,
    ['customer', 'mobile'],
    context.now(),
  );
  if (auth.audience !== 'customer' && auth.audience !== 'mobile') {
    throw new DomainError('not_authenticated', 'A customer or mobile session is required');
  }
  return { auth, audience: auth.audience, household: selectedHousehold(auth, request) };
}

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
  app.get('/v1/protected-enrollment', async (request) => {
    noProtectedSelfTargetSchema.parse(request.query);
    const { auth, household } = await protectedSelfAuth(request, context);
    const status = await context.repositories.entitlements.protectedSelfStatus({
      householdId: household.householdId,
      personId: auth.principal.personId,
      now: context.now(),
    });
    const documents = protectedSelfEnrollmentConsent.documents;
    return protectedSelfEnrollmentStatusResponseSchema.parse({
      householdId: status.householdId,
      personId: status.personId,
      enrollment: {
        state: status.state,
        effectiveAccess: status.effectiveAccess,
        ...(status.consentVersion === undefined ? {} : { consentVersion: status.consentVersion }),
      },
      eligibility: status.eligibility,
      withdrawalAvailable: status.withdrawalAvailable,
      consent: {
        version: protectedSelfEnrollmentConsent.version,
        disclosure: {
          version: documents.disclosureVersion,
          text: protectedSelfEnrollmentConsent.disclosureText,
          digest: documents.disclosureDigest,
        },
        policy: {
          version: documents.policyVersion,
          text: protectedSelfEnrollmentConsent.policyText,
          digest: documents.policyDigest,
        },
      },
    });
  });

  app.post('/v1/protected-enrollment', async (request, reply) => {
    noProtectedSelfTargetSchema.parse(request.query);
    const { auth, audience, household } = await protectedSelfAuth(request, context);
    assertMutationOrigin(request, context.config, auth);
    const body = enrollProtectedSelfRequestSchema.parse(request.body);
    const result = await context.repositories.entitlements.enrollProtectedSelfIdempotent({
      householdId: household.householdId,
      personId: auth.principal.personId,
      actorPersonId: auth.principal.personId,
      consentVersion: body.consentVersion,
      disclosureVersion: body.disclosureVersion,
      disclosureDigest: body.disclosureDigest,
      policyVersion: body.policyVersion,
      policyDigest: body.policyDigest,
      operationKey: protectedSelfOperationKey(request, 'enroll'),
      actorIdentityId: auth.resolved.identityId,
      actorIssuer: auth.resolved.issuer,
      actorIdentitySubject: auth.resolved.identitySubject,
      sessionId: auth.principal.sessionId,
      audience,
      correlationId: correlationId(request),
      now: context.now(),
    });
    return reply.code(result.changed ? 201 : 200).send(
      enrollProtectedSelfResponseSchema.parse({
        state: 'enrolled',
        consentVersion: result.enrollment.consentVersion,
        changed: result.changed,
        reused: result.reused,
      }),
    );
  });

  app.post('/v1/protected-enrollment/withdraw', async (request, reply) => {
    noProtectedSelfTargetSchema.parse(request.query);
    const { auth, audience, household } = await protectedSelfAuth(request, context);
    assertMutationOrigin(request, context.config, auth);
    withdrawProtectedSelfRequestSchema.parse(request.body);
    const result = await context.repositories.entitlements.withdrawProtectedSelfIdempotent({
      householdId: household.householdId,
      personId: auth.principal.personId,
      actorPersonId: auth.principal.personId,
      operationKey: protectedSelfOperationKey(request, 'withdraw'),
      actorIdentityId: auth.resolved.identityId,
      actorIssuer: auth.resolved.issuer,
      actorIdentitySubject: auth.resolved.identitySubject,
      sessionId: auth.principal.sessionId,
      audience,
      correlationId: correlationId(request),
      now: context.now(),
    });
    return reply.send(
      withdrawProtectedSelfResponseSchema.parse({
        state: 'not_enrolled',
        changed: result.changed,
        reused: result.reused,
      }),
    );
  });

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
    const runtime = entitlementRuntimeDto(context.config.environment);
    return entitlementResponseSchema.parse(
      entitlementResponseDto(
        {
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
            mode: runtime.mode,
            hypothesis: runtime.hypothesis,
          },
          environment: runtime.environment,
        },
        context.config.environment,
      ),
    );
  });
}

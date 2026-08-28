import { assertAuthorized, type Action } from '@boomerbuddy/authorization';
import {
  billingAuthorityHouseholdParamsSchema,
  billingAuthorityHouseholdResponseSchema,
  billingAuthorityOperationKeySchema,
  billingAuthoritySelfAcceptRequestSchema,
  billingAuthoritySelfRevokeRequestSchema,
  billingAuthoritySelfStatusResponseSchema,
  billingAuthoritySelfTransitionResponseSchema,
  billingAuthorityTargetParamsSchema,
  billingAuthorityTransitionRequestSchema,
  billingAuthorityTransitionResponseSchema,
} from '@boomerbuddy/contracts';
import { DomainError } from '@boomerbuddy/domain';
import { deriveBillingReverificationBinding } from '@boomerbuddy/persistence';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  assertMutationOrigin,
  assertRecentHqMfa,
  authenticate,
  correlationId,
  customerBillingReverificationEvidence,
  customerBillingReverificationHint,
  selectedHousehold,
} from '../auth';
import type { ApiContext } from '../context';

async function authorizeBillingAuthority(
  request: FastifyRequest,
  context: ApiContext,
  action: Extract<Action, 'hq:billing_authority:read' | 'hq:billing_authority:manage'>,
) {
  const auth = await authenticate(
    request,
    context.repositories.sessions,
    context.config,
    ['hq'],
    context.now(),
  );
  if (action === 'hq:billing_authority:manage') {
    assertRecentHqMfa(auth, context.config);
  }
  assertAuthorized({
    principal: auth.principal,
    action,
    resource: {
      kind: 'billing_authority_workflow',
      ...(context.config.identity.founderPersonId === undefined
        ? {}
        : { configuredFounderPersonId: context.config.identity.founderPersonId }),
    },
  });
  if (action === 'hq:billing_authority:manage') {
    assertMutationOrigin(request, context.config, auth);
  }
  return auth;
}

function idempotencyKey(request: FastifyRequest, action: 'grant' | 'revoke'): string {
  const raw = request.headers['idempotency-key'];
  if (raw === undefined || Array.isArray(raw)) {
    throw new DomainError('invalid_input', 'One action-bound Idempotency-Key header is required');
  }
  const parsed = billingAuthorityOperationKeySchema.safeParse(raw);
  if (!parsed.success || !parsed.data.startsWith(`billing-authority:${action}:`)) {
    throw new DomainError('invalid_input', 'One action-bound Idempotency-Key header is required');
  }
  return parsed.data;
}

function privateNoStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'private, no-store, max-age=0');
  reply.header('Pragma', 'no-cache');
  reply.header('Expires', '0');
}

export function registerBillingAuthorityRoutes(app: FastifyInstance, context: ApiContext): void {
  app.get('/v1/commerce/billing-authority', async (request, reply) => {
    privateNoStore(reply);
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer'],
      context.now(),
    );
    const household = selectedHousehold(auth, request);
    const status = await context.repositories.billingAuthority.selfStatus({
      householdId: household.householdId,
      personId: auth.principal.personId,
      now: context.now(),
    });
    return billingAuthoritySelfStatusResponseSchema.parse({
      ...status,
      externalActionExecuted: false,
    });
  });

  const customerSelfTransition = async (
    request: FastifyRequest,
    reply: FastifyReply,
    action: 'grant' | 'revoke',
  ) => {
    privateNoStore(reply);
    const now = context.now();
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer'],
      now,
    );
    assertMutationOrigin(request, context.config, auth);
    const household = selectedHousehold(auth, request);
    const operationKey = idempotencyKey(request, action);
    const body =
      action === 'grant'
        ? billingAuthoritySelfAcceptRequestSchema.parse(request.body)
        : billingAuthoritySelfRevokeRequestSchema.parse(request.body);
    const reverification = customerBillingReverificationEvidence(auth);
    if (reverification === undefined) {
      return reply.code(403).send(customerBillingReverificationHint());
    }
    const environment: 'test' | 'production' =
      context.config.commerce.stripe.mode === 'live' ? 'production' : 'test';
    const bindingIntent = {
      personId: auth.principal.personId,
      householdId: household.householdId,
      action:
        action === 'grant'
          ? ('billing_authority_grant' as const)
          : ('billing_authority_revoke' as const),
      environment,
      serverOperationId: operationKey,
      offerId: 'billing_authority_self_v1' as const,
      amountMinor: 0 as const,
      currency: 'usd' as const,
      factorLevel: 'multi_factor' as const,
    };
    const reverificationId =
      reverification.kind === 'clerk'
        ? reverification.reverificationId
        : `development:${auth.principal.sessionId}:${operationKey}`;
    const binding = await context.repositories.commerceRuntime.bindBillingReverification({
      ...bindingIntent,
      ...deriveBillingReverificationBinding({
        ...bindingIntent,
        reverificationId,
        key: context.config.secrets.fingerprintKey,
      }),
      effectiveFactorAgeSeconds:
        reverification.kind === 'clerk' ? reverification.effectiveFactorAgeSeconds : 0,
      now,
    });
    if (binding.kind === 'reverification_reused') {
      return reply.code(403).send(customerBillingReverificationHint());
    }
    const transition = await context.repositories.billingAuthority.selfTransition({
      access: {
        actorPersonId: auth.principal.personId,
        correlationId: correlationId(request),
      },
      householdId: household.householdId,
      personId: auth.principal.personId,
      sessionId: auth.principal.sessionId,
      billingReverificationBindingId: binding.bindingId,
      action,
      operationKey,
      documentVersion: body.documentVersion,
      documentDigest: body.documentDigest,
      now,
    });
    return reply.code(200).send(
      billingAuthoritySelfTransitionResponseSchema.parse({
        ...transition,
        occurredAt: transition.occurredAt.toISOString(),
        externalActionExecuted: false,
      }),
    );
  };

  app.post('/v1/commerce/billing-authority/accept', (request, reply) =>
    customerSelfTransition(request, reply, 'grant'),
  );

  app.post('/v1/commerce/billing-authority/revoke', (request, reply) =>
    customerSelfTransition(request, reply, 'revoke'),
  );

  app.get('/v1/hq/billing-authorities/:householdId', async (request, reply) => {
    privateNoStore(reply);
    const auth = await authorizeBillingAuthority(request, context, 'hq:billing_authority:read');
    const { householdId } = billingAuthorityHouseholdParamsSchema.parse(request.params);
    const result = await context.repositories.billingAuthority.household({
      access: {
        actorPersonId: auth.principal.personId,
        correlationId: correlationId(request),
      },
      householdId,
      now: context.now(),
    });
    return billingAuthorityHouseholdResponseSchema.parse({
      authority: 'configured_founder_active_internal_owner',
      household: result.household,
      members: result.members.map((member) => ({
        ...member,
        ...(member.grantedAt === undefined ? {} : { grantedAt: member.grantedAt.toISOString() }),
        ...(member.revokedAt === undefined ? {} : { revokedAt: member.revokedAt.toISOString() }),
      })),
      events: result.events.map((event) => ({
        ...event,
        occurredAt: event.occurredAt.toISOString(),
      })),
      externalActionExecuted: false,
    });
  });

  app.post(
    '/v1/hq/billing-authorities/:householdId/:personId/transitions',
    async (request, reply) => {
      privateNoStore(reply);
      const auth = await authorizeBillingAuthority(request, context, 'hq:billing_authority:manage');
      const { householdId, personId } = billingAuthorityTargetParamsSchema.parse(request.params);
      const body = billingAuthorityTransitionRequestSchema.parse(request.body);
      const result = await context.repositories.billingAuthority.transition({
        access: {
          actorPersonId: auth.principal.personId,
          correlationId: correlationId(request),
        },
        householdId,
        personId,
        action: body.action,
        reasonCode: body.reasonCode,
        operationKey: idempotencyKey(request, body.action),
        now: context.now(),
      });
      return reply.code(200).send(
        billingAuthorityTransitionResponseSchema.parse({
          ...result,
          occurredAt: result.occurredAt.toISOString(),
          externalActionExecuted: false,
        }),
      );
    },
  );
}

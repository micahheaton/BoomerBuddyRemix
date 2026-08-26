import { assertAuthorized, type Action } from '@boomerbuddy/authorization';
import {
  billingAuthorityHouseholdParamsSchema,
  billingAuthorityHouseholdResponseSchema,
  billingAuthorityOperationKeySchema,
  billingAuthorityTargetParamsSchema,
  billingAuthorityTransitionRequestSchema,
  billingAuthorityTransitionResponseSchema,
} from '@boomerbuddy/contracts';
import { DomainError } from '@boomerbuddy/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { assertMutationOrigin, assertRecentHqMfa, authenticate, correlationId } from '../auth';
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

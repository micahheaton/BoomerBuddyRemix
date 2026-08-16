import {
  createPrivacyRequestResponseSchema,
  createSelfPrivacyRequestSchema,
  privacyRequestListResponseSchema,
} from '@boomerbuddy/contracts';
import type { PrivacyRequestRecord } from '@boomerbuddy/persistence';
import { DomainError } from '@boomerbuddy/domain';
import type { FastifyInstance } from 'fastify';
import { assertMutationOrigin, authenticate, correlationId, selectedHousehold } from '../auth';
import type { ApiContext } from '../context';

export function privacyRequestDto(request: PrivacyRequestRecord) {
  return {
    ...request,
    dueAt: request.dueAt.toISOString(),
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    ...(request.completedAt === undefined
      ? {}
      : { completedAt: request.completedAt.toISOString() }),
    ...(request.plan === undefined
      ? {}
      : {
          plan: {
            ...request.plan,
            containsCustomerContent: false as const,
            createdAt: request.plan.createdAt.toISOString(),
          },
        }),
  };
}

export function registerPrivacyRoutes(app: FastifyInstance, context: ApiContext): void {
  app.post('/v1/privacy-requests', async (request, reply) => {
    const now = context.now();
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer', 'mobile'],
      now,
    );
    assertMutationOrigin(request, context.config, auth);
    const household = selectedHousehold(auth, request);
    const body = createSelfPrivacyRequestSchema.parse(request.body);
    const dueAt = new Date(now.getTime() + 30 * 86_400_000);
    let id: string;
    try {
      id = await context.repositories.businessOs.createPrivacyRequest({
        personId: auth.principal.personId,
        householdId: household.householdId,
        requestKind: body.requestKind,
        now,
        dueAt,
        context: {
          householdId: household.householdId,
          actorPersonId: auth.principal.personId,
          audience: auth.audience,
          correlationId: correlationId(request),
          now,
        },
      });
    } catch (error) {
      if (
        error instanceof Error &&
        /privacy_request_open_subject_kind_idx|unique/iu.test(error.message)
      ) {
        throw new DomainError('conflict', 'A matching privacy request is already open');
      }
      throw error;
    }
    return reply.code(202).send(
      createPrivacyRequestResponseSchema.parse({
        id,
        state: 'received',
        identityVerificationState: 'pending',
        dueAt: dueAt.toISOString(),
      }),
    );
  });

  app.get('/v1/privacy-requests', async (request) => {
    const now = context.now();
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer', 'mobile'],
      now,
    );
    return privacyRequestListResponseSchema.parse({
      requests: (
        await context.repositories.businessOs.listPrivacyRequests({
          personId: auth.principal.personId,
        })
      ).map(privacyRequestDto),
      fulfillmentMode: 'evidence_plan_only',
      limitation:
        'Run 2 records identity review and a content-free fulfillment plan; it does not claim completed export or erasure.',
    });
  });
}

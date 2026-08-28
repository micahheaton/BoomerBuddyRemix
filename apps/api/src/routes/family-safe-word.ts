import {
  familySafeWordLifecycleRequestSchema,
  familySafeWordLifecycleResponseSchema,
  familySafeWordStatusResponseSchema,
  familySafeWordTargetParamsSchema,
  familySafeWordVerifyRequestSchema,
  familySafeWordVerifyResponseSchema,
} from '@boomerbuddy/contracts';
import { DomainError } from '@boomerbuddy/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  assertMutationOrigin,
  assertRecentCustomerAuthentication,
  authenticate,
  correlationId,
  selectedHousehold,
} from '../auth';
import type { ApiContext } from '../context';

const privateCacheControl = 'private, no-store, max-age=0';

function privateResponse(reply: FastifyReply): void {
  void reply.header('Cache-Control', privateCacheControl);
}

async function safeWordScope(request: FastifyRequest, context: ApiContext) {
  const now = context.now();
  const auth = await authenticate(
    request,
    context.repositories.sessions,
    context.config,
    ['customer', 'mobile'],
    now,
  );
  const household = selectedHousehold(auth, request);
  const { protectedPersonId } = familySafeWordTargetParamsSchema.parse(request.params);
  return {
    auth,
    protectedPersonId,
    operational: {
      householdId: household.householdId,
      protectedPersonId,
      actorPersonId: auth.principal.personId,
      audience: auth.audience,
      correlationId: correlationId(request),
      now,
    },
  };
}

export function registerFamilySafeWordRoutes(app: FastifyInstance, context: ApiContext): void {
  app.get('/v1/family/safe-word/:protectedPersonId', async (request, reply) => {
    const scope = await safeWordScope(request, context);
    const status = await context.repositories.familySafeWords.getStatus(scope.operational);
    privateResponse(reply);
    return familySafeWordStatusResponseSchema.parse({
      state: status.state,
      ...(status.updatedAt === undefined ? {} : { updatedAt: status.updatedAt.toISOString() }),
    });
  });

  app.post('/v1/family/safe-word/:protectedPersonId/verify', async (request, reply) => {
    const scope = await safeWordScope(request, context);
    assertMutationOrigin(request, context.config, scope.auth);
    const body = familySafeWordVerifyRequestSchema.parse(request.body);
    const result = await context.repositories.familySafeWords.verify({
      ...scope.operational,
      phrase: body.phrase,
    });
    privateResponse(reply);
    if (result.rateLimited) {
      void reply.header('Retry-After', String(result.retryAfterSeconds));
      return reply.code(429).send({
        error: {
          code: 'rate_limited',
          message: 'Family verification attempts are temporarily limited',
          requestId: request.id,
        },
      });
    }
    return familySafeWordVerifyResponseSchema.parse({ result: result.result });
  });

  app.put('/v1/family/safe-word/:protectedPersonId', async (request, reply) => {
    const scope = await safeWordScope(request, context);
    if (scope.auth.principal.personId !== scope.protectedPersonId) {
      throw new DomainError('not_found', 'Family verification aid is unavailable');
    }
    assertMutationOrigin(request, context.config, scope.auth);
    assertRecentCustomerAuthentication(scope.auth);
    const body = familySafeWordLifecycleRequestSchema.parse(request.body);
    const result =
      body.action === 'replace'
        ? await context.repositories.familySafeWords.replace({
            ...scope.operational,
            phrase: body.phrase,
          })
        : await context.repositories.familySafeWords.disable(scope.operational);
    privateResponse(reply);
    return familySafeWordLifecycleResponseSchema.parse({
      state: result.state,
      changed: result.changed,
      ...(result.updatedAt === undefined ? {} : { updatedAt: result.updatedAt.toISOString() }),
    });
  });
}

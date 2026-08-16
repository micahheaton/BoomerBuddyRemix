import {
  createPrivacyRequestResponseSchema,
  createSelfPrivacyRequestSchema,
} from '@boomerbuddy/contracts';
import type { FastifyInstance } from 'fastify';
import { assertMutationOrigin, authenticate, selectedHousehold } from '../auth';
import type { ApiContext } from '../context';

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
    const id = await context.repositories.businessOs.createPrivacyRequest({
      personId: auth.principal.personId,
      householdId: household.householdId,
      requestKind: body.requestKind,
      now,
      dueAt,
    });
    return reply.code(202).send(
      createPrivacyRequestResponseSchema.parse({
        id,
        state: 'received',
        identityVerificationState: 'pending',
        dueAt: dueAt.toISOString(),
      }),
    );
  });
}

import {
  trustedCircleAttentionLimit,
  trustedCircleAttentionResponseSchema,
} from '@boomerbuddy/contracts';
import type { FastifyInstance } from 'fastify';
import { authenticate, selectedHousehold } from '../auth';
import type { ApiContext } from '../context';

const authenticatedAttentionCacheControl = 'private, no-store, max-age=0';

export function registerTrustedCircleAttentionRoutes(
  app: FastifyInstance,
  context: ApiContext,
): void {
  app.get('/v1/trusted-circle/attention', async (request, reply) => {
    const now = context.now();
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['customer', 'mobile'],
      now,
    );
    const household = selectedHousehold(auth, request);
    const attention = await context.repositories.trustedCircleAttention.pendingAcknowledgements({
      householdId: household.householdId,
      recipientPersonId: auth.principal.personId,
      now,
    });
    return reply.header('Cache-Control', authenticatedAttentionCacheControl).send(
      trustedCircleAttentionResponseSchema.parse({
        pendingAcknowledgementCount: attention.pendingAcknowledgementCount,
        pendingAcknowledgements: attention.pendingAcknowledgements.map((item) => ({
          checkId: item.checkId,
          attentionKind: 'shared_check_needs_acknowledgement',
          sharedAt: item.sharedAt.toISOString(),
        })),
        page: {
          limit: trustedCircleAttentionLimit,
          hasMore: attention.hasMore,
        },
      }),
    );
  });
}

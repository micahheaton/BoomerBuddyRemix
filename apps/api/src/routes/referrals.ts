import { referralHqQueueResponseSchema } from '@boomerbuddy/contracts';
import { DomainError } from '@boomerbuddy/domain';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { authenticate, correlationId } from '../auth';
import type { ApiContext } from '../context';

const queueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function assertLocalOnly(context: ApiContext): void {
  if (context.config.environment === 'production') {
    throw new DomainError(
      'not_found',
      'Referral evidence is unavailable until the founder activation gates are complete',
    );
  }
}

function setPrivateNoStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'private, no-store, max-age=0');
  reply.header('Pragma', 'no-cache');
  reply.header('Expires', '0');
  reply.header('Vary', 'Cookie, Authorization');
}

export function registerReferralRoutes(app: FastifyInstance, context: ApiContext): void {
  app.get('/v1/hq/referrals', async (request, reply) => {
    setPrivateNoStore(reply);
    assertLocalOnly(context);
    const now = context.now();
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['hq'],
      now,
    );
    const { limit } = queueQuerySchema.parse(request.query);
    const referrals = await context.repositories.referrals.localHqQueue({
      actorPersonId: auth.principal.personId,
      correlationId: correlationId(request),
      limit,
    });
    return referralHqQueueResponseSchema.parse({
      projection: 'content_free_disabled_referral_evidence',
      referrals: referrals.map((referral) => ({
        ...referral,
        issuedAt: referral.issuedAt.toISOString(),
        expiresAt: referral.expiresAt.toISOString(),
      })),
    });
  });
}

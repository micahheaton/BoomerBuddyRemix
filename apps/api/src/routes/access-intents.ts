import { assertAuthorized } from '@boomerbuddy/authorization';
import {
  accessIntentOperationKeySchema,
  createAccessIntentRequestSchema,
  createAccessIntentResponseSchema,
  hqAccessIntentResponseSchema,
} from '@boomerbuddy/contracts';
import { DomainError } from '@boomerbuddy/domain';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { authenticate, correlationId } from '../auth';
import type { ApiContext } from '../context';

function assertCustomerOrigin(origin: string | undefined, context: ApiContext): void {
  if (origin === undefined || !context.config.identity.customerOrigins.includes(origin)) {
    throw new DomainError('not_authorized', 'The application origin is not trusted');
  }
}

function preventCaching(reply: FastifyReply): void {
  void reply.header('Cache-Control', 'private, no-store, max-age=0');
  void reply.header('Pragma', 'no-cache');
  void reply.header('Expires', '0');
}

const defaultApplicationRequestsPerMinute = 60;

export class AccessIntentApplicationRateLimiter {
  private minuteBucket: number | undefined;
  private used = 0;

  constructor(private readonly maximumRequestsPerMinute = defaultApplicationRequestsPerMinute) {
    if (!Number.isSafeInteger(maximumRequestsPerMinute) || maximumRequestsPerMinute < 1) {
      throw new TypeError('Access-intent application request limit must be a positive integer');
    }
  }

  consume(
    now: Date,
  ): { readonly allowed: true } | { readonly allowed: false; readonly retryAfter: number } {
    const timestamp = now.getTime();
    if (!Number.isFinite(timestamp))
      throw new TypeError('Access-intent rate-limit time is invalid');
    const currentBucket = Math.floor(timestamp / 60_000);
    if (this.minuteBucket !== currentBucket) {
      this.minuteBucket = currentBucket;
      this.used = 0;
    }
    if (this.used >= this.maximumRequestsPerMinute) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil(((currentBucket + 1) * 60_000 - timestamp) / 1_000)),
      };
    }
    this.used += 1;
    return { allowed: true };
  }
}

export function registerAccessIntentRoutes(
  app: FastifyInstance,
  context: ApiContext,
  options: {
    readonly maximumApplicationRequestsPerMinute?: number;
    readonly mutationEnabled?: boolean;
  } = {},
): void {
  if (options.mutationEnabled === true) {
    const applicationLimiter = new AccessIntentApplicationRateLimiter(
      options.maximumApplicationRequestsPerMinute,
    );
    app.post('/v1/public/access-intents', async (request, reply) => {
      assertCustomerOrigin(request.headers.origin, context);
      const limit = applicationLimiter.consume(context.now());
      if (!limit.allowed) {
        preventCaching(reply);
        void reply.header('Retry-After', String(limit.retryAfter));
        return reply.code(429).send({
          error: {
            code: 'rate_limited',
            message: 'Private-beta access requests are temporarily limited',
            requestId: request.id,
          },
        });
      }
      const body = createAccessIntentRequestSchema.parse(request.body);
      const operationKey = accessIntentOperationKeySchema.parse(request.headers['idempotency-key']);
      const intent = await context.repositories.accessIntents.create({
        purpose: body.purpose,
        attribution: body.attribution,
        clientKey: context.repositories.accessIntents.clientKeyForNetworkAddress(request.ip),
        operationKey,
        now: context.now(),
      });
      preventCaching(reply);
      return reply.code(201).send(
        createAccessIntentResponseSchema.parse({
          intent: {
            ...intent,
            createdAt: intent.createdAt.toISOString(),
            expiresAt: intent.expiresAt.toISOString(),
            outboundMessage: 'not_sent',
          },
        }),
      );
    });
  }

  app.get('/v1/hq/access-intents', async (request, reply) => {
    const auth = await authenticate(
      request,
      context.repositories.sessions,
      context.config,
      ['hq'],
      context.now(),
    );
    assertAuthorized({
      principal: auth.principal,
      action: 'hq:overview',
      resource: { kind: 'hq' },
    });
    const projection = await context.repositories.hq.ownerAccessIntents({
      actorPersonId: auth.principal.personId,
      correlationId: correlationId(request),
      now: context.now(),
    });
    preventCaching(reply);
    return hqAccessIntentResponseSchema.parse({
      projection: 'content_free_access_intents',
      intents: projection.intents.map((intent) => ({
        ...intent,
        createdAt: intent.createdAt.toISOString(),
        expiresAt: intent.expiresAt.toISOString(),
      })),
      truncated: projection.truncated,
    });
  });
}

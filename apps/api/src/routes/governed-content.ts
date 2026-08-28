import {
  assignGovernedContentReviewRequestSchema,
  createGovernedContentDraftRequestSchema,
  governedContentBoardResponseSchema,
  governedContentDraftResponseSchema,
  governedContentGenerationResponseSchema,
  governedContentIdSchema,
  governedContentMutationResponseSchema,
  governedContentSlugSchema,
  publicLearnArticleSchema,
  publicLearnIndexResponseSchema,
  publishGovernedContentRequestSchema,
  reviewGovernedContentDraftRequestSchema,
  reviseGovernedContentDraftRequestSchema,
} from '@boomerbuddy/contracts';
import { DomainError } from '@boomerbuddy/domain';
import type {
  GovernedContentDraftMetadata,
  GovernedContentDraftView,
  PublicLearnArticleView,
} from '@boomerbuddy/persistence';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { assertMutationOrigin, assertRecentHqMfa, authenticate, correlationId } from '../auth';
import type { ApiContext } from '../context';

const revisionParamsSchema = z.object({ revisionId: governedContentIdSchema }).strict();
const articleParamsSchema = z.object({ slug: governedContentSlugSchema }).strict();
const actionParamsSchema = revisionParamsSchema.extend({
  action: z.enum(['publish', 'unpublish', 'retract']),
});
const generationRequestSchema = z
  .object({
    scheduleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    limit: z.number().int().min(1).max(25).default(5),
  })
  .strict();
const publicationIdempotencyPattern =
  /^governed-content:(?:publish|unpublish|retract):[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function assertContentRuntime(context: ApiContext): void {
  if (context.config.content?.firstPartyPublishingEnabled !== true) {
    throw new DomainError('not_found', 'First-party content controls are not enabled');
  }
}

async function authorizeHq(request: FastifyRequest, context: ApiContext, mutation: boolean) {
  assertContentRuntime(context);
  const now = context.now();
  const auth = await authenticate(
    request,
    context.repositories.sessions,
    context.config,
    ['hq'],
    now,
  );
  assertRecentHqMfa(auth, context.config);
  if (mutation) assertMutationOrigin(request, context.config, auth);
  return { auth, now };
}

function privateNoStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'private, no-store, max-age=0');
  reply.header('Pragma', 'no-cache');
  reply.header('Expires', '0');
}

function publicationIdempotencyKey(request: FastifyRequest, action: string): string {
  const raw = request.headers['idempotency-key'];
  if (
    raw === undefined ||
    Array.isArray(raw) ||
    !publicationIdempotencyPattern.test(raw) ||
    !raw.startsWith(`governed-content:${action}:`)
  ) {
    throw new DomainError(
      'invalid_input',
      'An action-bound publication Idempotency-Key is required',
    );
  }
  return raw;
}

function metadataDto(draft: GovernedContentDraftMetadata) {
  return {
    revisionId: draft.revisionId,
    contentKey: draft.contentKey,
    version: draft.version,
    ...(draft.previousRevisionId === undefined
      ? {}
      : { previousRevisionId: draft.previousRevisionId }),
    revisionKind: draft.revisionKind,
    sourceId: draft.sourceId,
    sourceDigest: draft.sourceDigest,
    slug: draft.slug,
    documentDigest: draft.documentDigest,
    expiresAt: draft.expiresAt.toISOString(),
    createdAt: draft.createdAt.toISOString(),
    reviews: draft.reviews.map((review) => ({
      role: review.role,
      ...(review.assignedToPersonId === undefined
        ? {}
        : { assignedToPersonId: review.assignedToPersonId }),
      ...(review.decision === undefined ? {} : { decision: review.decision }),
      ...(review.reason === undefined ? {} : { reason: review.reason }),
      ...(review.reviewedAt === undefined ? {} : { reviewedAt: review.reviewedAt.toISOString() }),
    })),
    publication: draft.publication,
    publicationEligible: draft.publicationEligible,
    blockers: [...draft.blockers],
  };
}

function draftDto(draft: GovernedContentDraftView) {
  return governedContentDraftResponseSchema.parse({
    ...metadataDto(draft),
    document: draft.document,
    source: {
      title: draft.source.title,
      url: draft.source.url,
      publishedAt: draft.source.publishedAt.toISOString(),
      reviewedAt: draft.source.reviewedAt.toISOString(),
    },
  });
}

function publicArticleDto(article: PublicLearnArticleView) {
  return {
    slug: article.slug,
    title: article.title,
    summary: article.summary,
    body: article.body,
    documentDigest: article.documentDigest,
    publishedAt: article.publishedAt.toISOString(),
    expiresAt: article.expiresAt.toISOString(),
    source: {
      title: article.source.title,
      url: article.source.url,
      publishedAt: article.source.publishedAt.toISOString(),
      reviewedAt: article.source.reviewedAt.toISOString(),
    },
  };
}

export function registerGovernedContentRoutes(app: FastifyInstance, context: ApiContext): void {
  app.get('/v1/public/learn', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=0, must-revalidate');
    const now = context.now();
    if (context.config.content?.firstPartyPublishingEnabled !== true) {
      return publicLearnIndexResponseSchema.parse({ generatedAt: now.toISOString(), articles: [] });
    }
    const articles = await context.repositories.governedContent.publicArticles(now);
    return publicLearnIndexResponseSchema.parse({
      generatedAt: now.toISOString(),
      articles: articles.map((article) => ({
        slug: article.slug,
        title: article.title,
        summary: article.summary,
        documentDigest: article.documentDigest,
        publishedAt: article.publishedAt.toISOString(),
        expiresAt: article.expiresAt.toISOString(),
        source: {
          title: article.source.title,
          url: article.source.url,
          publishedAt: article.source.publishedAt.toISOString(),
          reviewedAt: article.source.reviewedAt.toISOString(),
        },
      })),
    });
  });

  app.get('/v1/public/learn/:slug', async (request, reply) => {
    reply.header('Cache-Control', 'public, max-age=0, must-revalidate');
    assertContentRuntime(context);
    const { slug } = articleParamsSchema.parse(request.params);
    return publicLearnArticleSchema.parse(
      publicArticleDto(
        await context.repositories.governedContent.publicArticle(slug, context.now()),
      ),
    );
  });

  app.get('/v1/hq/content', async (request, reply) => {
    privateNoStore(reply);
    const { auth, now } = await authorizeHq(request, context, false);
    const board = await context.repositories.governedContent.board({
      actorPersonId: auth.principal.personId,
      correlationId: correlationId(request),
      now,
    });
    return governedContentBoardResponseSchema.parse({
      generatedAt: board.generatedAt.toISOString(),
      facts: board.facts.map((fact) => ({
        sourceId: fact.sourceId,
        sourceDigest: fact.sourceDigest,
        region: fact.region,
        title: fact.title,
        sourceTitle: fact.sourceTitle,
        reviewedAt: fact.reviewedAt.toISOString(),
        expiresAt: fact.expiresAt.toISOString(),
      })),
      drafts: board.drafts.map(metadataDto),
      capabilities: {
        encryptedDrafts: true,
        humanReview: true,
        firstPartyPublication: true,
        deterministicGeneration: true,
        externalFetch: false,
        externalModel: false,
        providerPublication: false,
        outboundMessaging: false,
        autoPublish: false,
        customerDataAccess: false,
      },
    });
  });

  app.get('/v1/hq/content/drafts/:revisionId', async (request, reply) => {
    privateNoStore(reply);
    const { auth, now } = await authorizeHq(request, context, false);
    const { revisionId } = revisionParamsSchema.parse(request.params);
    return draftDto(
      await context.repositories.governedContent.readDraft({
        revisionId,
        actorPersonId: auth.principal.personId,
        correlationId: correlationId(request),
        now,
      }),
    );
  });

  app.get('/v1/hq/content/drafts/:revisionId/preview', async (request, reply) => {
    privateNoStore(reply);
    const { auth, now } = await authorizeHq(request, context, false);
    const { revisionId } = revisionParamsSchema.parse(request.params);
    return draftDto(
      await context.repositories.governedContent.readDraft({
        revisionId,
        actorPersonId: auth.principal.personId,
        correlationId: correlationId(request),
        now,
      }),
    );
  });

  app.post('/v1/hq/content/drafts', async (request, reply) => {
    privateNoStore(reply);
    const { auth, now } = await authorizeHq(request, context, true);
    const body = createGovernedContentDraftRequestSchema.parse(request.body);
    const result = await context.repositories.governedContent.createDraft({
      ...body,
      actorPersonId: auth.principal.personId,
      correlationId: correlationId(request),
      now,
    });
    return reply.code(201).send(
      governedContentMutationResponseSchema.parse({
        ...result,
        result: 'created',
        idempotentReplay: false,
      }),
    );
  });

  app.post('/v1/hq/content/drafts/:revisionId/revisions', async (request, reply) => {
    privateNoStore(reply);
    const { auth, now } = await authorizeHq(request, context, true);
    const { revisionId } = revisionParamsSchema.parse(request.params);
    const body = reviseGovernedContentDraftRequestSchema.parse(request.body);
    const result = await context.repositories.governedContent.reviseDraft({
      revisionId,
      ...body,
      actorPersonId: auth.principal.personId,
      correlationId: correlationId(request),
      now,
    });
    return reply.code(201).send(
      governedContentMutationResponseSchema.parse({
        ...result,
        result: 'created',
        idempotentReplay: false,
      }),
    );
  });

  app.post('/v1/hq/content/drafts/:revisionId/assignments', async (request, reply) => {
    privateNoStore(reply);
    const { auth, now } = await authorizeHq(request, context, true);
    const { revisionId } = revisionParamsSchema.parse(request.params);
    const body = assignGovernedContentReviewRequestSchema.parse(request.body);
    await context.repositories.governedContent.assignReview({
      revisionId,
      reviewRole: body.role,
      expectedDocumentDigest: body.expectedDocumentDigest,
      actorPersonId: auth.principal.personId,
      correlationId: correlationId(request),
      now,
    });
    return governedContentMutationResponseSchema.parse({
      revisionId,
      documentDigest: body.expectedDocumentDigest,
      result: 'assigned',
      idempotentReplay: false,
    });
  });

  app.post('/v1/hq/content/drafts/:revisionId/reviews', async (request, reply) => {
    privateNoStore(reply);
    const { auth, now } = await authorizeHq(request, context, true);
    const { revisionId } = revisionParamsSchema.parse(request.params);
    const body = reviewGovernedContentDraftRequestSchema.parse(request.body);
    await context.repositories.governedContent.review({
      revisionId,
      reviewRole: body.role,
      decision: body.decision,
      reason: body.reason,
      expectedDocumentDigest: body.expectedDocumentDigest,
      actorPersonId: auth.principal.personId,
      correlationId: correlationId(request),
      now,
    });
    return governedContentMutationResponseSchema.parse({
      revisionId,
      documentDigest: body.expectedDocumentDigest,
      result: 'reviewed',
      idempotentReplay: false,
    });
  });

  app.post('/v1/hq/content/generate', async (request, reply) => {
    privateNoStore(reply);
    const { auth, now } = await authorizeHq(request, context, true);
    if (context.config.content?.dailyDraftGenerationEnabled !== true) {
      throw new DomainError('not_found', 'Daily first-party draft generation is not enabled');
    }
    const body = generationRequestSchema.parse(request.body);
    const generatedRevisionIds = await context.repositories.governedContent.generateDailyDrafts({
      scheduleDate: body.scheduleDate,
      limit: body.limit,
      requestedByPersonId: auth.principal.personId,
      correlationId: correlationId(request),
      now,
    });
    return governedContentGenerationResponseSchema.parse({
      generatedRevisionIds,
      externalFetch: false,
      providerAction: false,
      publication: false,
      customerDataAccess: false,
    });
  });

  app.post('/v1/hq/content/drafts/:revisionId/:action', async (request, reply) => {
    privateNoStore(reply);
    const { auth, now } = await authorizeHq(request, context, true);
    const { revisionId, action } = actionParamsSchema.parse(request.params);
    const body = publishGovernedContentRequestSchema.parse(request.body);
    const authorization = await context.repositories.governedContent.authorizePublication({
      revisionId,
      action,
      expectedDocumentDigest: body.expectedDocumentDigest,
      idempotencyKey: publicationIdempotencyKey(request, action),
      actorPersonId: auth.principal.personId,
      correlationId: correlationId(request),
      now,
    });
    const reconciled = await context.repositories.governedContent.reconcilePublicationIntent({
      intentId: authorization.intentId,
      now,
    });
    return governedContentMutationResponseSchema.parse({
      revisionId: reconciled.revisionId,
      documentDigest: reconciled.documentDigest,
      result:
        reconciled.action === 'publish'
          ? 'published'
          : reconciled.action === 'unpublish'
            ? 'unpublished'
            : 'retracted',
      idempotentReplay: authorization.replay || reconciled.replay,
    });
  });
}

import { governedContentReviewRoles } from '@boomerbuddy/domain';
import { z } from 'zod';
import { isoDateTimeSchema } from './common';

export const governedContentIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u);
export const governedContentDigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const governedContentSlugSchema = z
  .string()
  .min(3)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
export const governedContentReviewRoleSchema = z.enum(governedContentReviewRoles);
export type GovernedContentReviewRole = z.infer<typeof governedContentReviewRoleSchema>;
export const governedContentReviewDecisionSchema = z.enum([
  'approve',
  'changes_requested',
  'reject',
]);

export const governedContentDocumentSchema = z
  .object({
    slug: governedContentSlugSchema,
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(500),
    body: z.string().trim().min(1).max(16_000),
    platformDrafts: z
      .object({
        youtubeScript: z.string().min(1).max(4_000),
        tiktokCaption: z.string().min(1).max(2_200),
        linkedinPost: z.string().min(1).max(3_000),
      })
      .strict(),
  })
  .strict();

export const governedContentFactSchema = z
  .object({
    sourceId: z.string().regex(/^[a-z][a-z0-9_-]{2,79}:v[1-9][0-9]*$/u),
    sourceDigest: governedContentDigestSchema,
    region: z.string().regex(/^US(?:-[A-Z]{2})?$/u),
    title: z.string().min(1).max(160),
    sourceTitle: z.string().min(1).max(160),
    reviewedAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
  })
  .strict();

export const governedContentReviewSchema = z
  .object({
    role: governedContentReviewRoleSchema,
    assignedToPersonId: governedContentIdSchema.optional(),
    decision: governedContentReviewDecisionSchema.optional(),
    reason: z.string().min(3).max(500).optional(),
    reviewedAt: isoDateTimeSchema.optional(),
  })
  .strict();

export const governedContentDraftMetadataSchema = z
  .object({
    revisionId: governedContentIdSchema,
    contentKey: z.string().regex(/^content_[a-z0-9_]{2,110}$/u),
    version: z.number().int().positive(),
    previousRevisionId: governedContentIdSchema.optional(),
    revisionKind: z.enum(['deterministic', 'human', 'correction']),
    sourceId: governedContentFactSchema.shape.sourceId,
    sourceDigest: governedContentDigestSchema,
    slug: governedContentSlugSchema,
    documentDigest: governedContentDigestSchema,
    expiresAt: isoDateTimeSchema,
    createdAt: isoDateTimeSchema,
    reviews: z.array(governedContentReviewSchema).max(4),
    publication: z.enum(['draft', 'published', 'unpublished', 'retracted', 'expired']),
    publicationEligible: z.boolean(),
    blockers: z.array(z.string().regex(/^[a-z0-9_]+$/u)).max(12),
  })
  .strict();

export const governedContentBoardResponseSchema = z
  .object({
    generatedAt: isoDateTimeSchema,
    facts: z.array(governedContentFactSchema).max(100),
    drafts: z.array(governedContentDraftMetadataSchema).max(200),
    capabilities: z
      .object({
        encryptedDrafts: z.literal(true),
        humanReview: z.literal(true),
        firstPartyPublication: z.literal(true),
        deterministicGeneration: z.literal(true),
        externalFetch: z.literal(false),
        externalModel: z.literal(false),
        providerPublication: z.literal(false),
        outboundMessaging: z.literal(false),
        autoPublish: z.literal(false),
        customerDataAccess: z.literal(false),
      })
      .strict(),
  })
  .strict();

export const governedContentDraftResponseSchema = governedContentDraftMetadataSchema.extend({
  document: governedContentDocumentSchema,
  source: z
    .object({
      title: z.string().min(1).max(160),
      url: z.string().url().startsWith('https://'),
      publishedAt: isoDateTimeSchema,
      reviewedAt: isoDateTimeSchema,
    })
    .strict(),
});

export const createGovernedContentDraftRequestSchema = z
  .object({
    sourceId: governedContentFactSchema.shape.sourceId,
    slug: governedContentSlugSchema,
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(500),
    body: z.string().trim().min(1).max(16_000),
  })
  .strict();

export const reviseGovernedContentDraftRequestSchema = createGovernedContentDraftRequestSchema
  .omit({ sourceId: true })
  .extend({
    expectedDocumentDigest: governedContentDigestSchema,
    correction: z.boolean().default(false),
  })
  .strict();

export const assignGovernedContentReviewRequestSchema = z
  .object({
    role: governedContentReviewRoleSchema,
    expectedDocumentDigest: governedContentDigestSchema,
  })
  .strict();

export const reviewGovernedContentDraftRequestSchema = z
  .object({
    role: governedContentReviewRoleSchema,
    decision: governedContentReviewDecisionSchema,
    reason: z.string().trim().min(3).max(500),
    expectedDocumentDigest: governedContentDigestSchema,
  })
  .strict();

export const publishGovernedContentRequestSchema = z
  .object({ expectedDocumentDigest: governedContentDigestSchema })
  .strict();

export const governedContentMutationResponseSchema = z
  .object({
    revisionId: governedContentIdSchema,
    documentDigest: governedContentDigestSchema,
    result: z.enum(['created', 'assigned', 'reviewed', 'published', 'unpublished', 'retracted']),
    idempotentReplay: z.boolean(),
  })
  .strict();

export const governedContentGenerationResponseSchema = z
  .object({
    generatedRevisionIds: z.array(governedContentIdSchema).max(25),
    externalFetch: z.literal(false),
    providerAction: z.literal(false),
    publication: z.literal(false),
    customerDataAccess: z.literal(false),
  })
  .strict();

export const publicLearnArticleSchema = z
  .object({
    slug: governedContentSlugSchema,
    title: z.string().min(1).max(160),
    summary: z.string().min(1).max(500),
    body: z.string().min(1).max(16_000),
    documentDigest: governedContentDigestSchema,
    publishedAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
    source: z
      .object({
        title: z.string().min(1).max(160),
        url: z.string().url().startsWith('https://'),
        publishedAt: isoDateTimeSchema,
        reviewedAt: isoDateTimeSchema,
      })
      .strict(),
  })
  .strict();

export const publicLearnIndexResponseSchema = z
  .object({
    generatedAt: isoDateTimeSchema,
    articles: z.array(publicLearnArticleSchema.omit({ body: true })).max(200),
  })
  .strict();

export type GovernedContentBoardResponse = z.infer<typeof governedContentBoardResponseSchema>;
export type GovernedContentDraftResponse = z.infer<typeof governedContentDraftResponseSchema>;
export type PublicLearnArticle = z.infer<typeof publicLearnArticleSchema>;

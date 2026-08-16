import { z } from 'zod';

export const knowledgeLifecycleSchema = z.enum(['draft', 'active', 'retired']);
export const knowledgeReviewStateSchema = z.enum([
  'authored',
  'source_verified',
  'independently_reviewed',
]);
export const knowledgeAssetSchema = z.object({
  assetKey: z.string().regex(/^knowledge_[a-z0-9_]+$/u),
  version: z.number().int().positive(),
  locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/u),
  jurisdiction: z.string().min(2).max(32),
  lifecycle: knowledgeLifecycleSchema,
  reviewState: knowledgeReviewStateSchema,
  source: z.object({
    publisher: z.string().min(1).max(120),
    url: z.string().url().max(1_024),
    retrievedAt: z.string().datetime(),
    rightsBasis: z.string().min(1).max(160),
  }),
  provenance: z.object({
    collection: z.literal('independently_curated_2_0'),
    authoringVersion: z.string().min(1).max(80),
    v1RuntimeImport: z.literal(false),
  }),
  content: z.object({
    title: z.string().min(1).max(160),
    summary: z.string().min(1).max(1_000),
    defensiveActions: z.array(z.string().min(1).max(300)).min(1).max(10),
  }),
});

export type KnowledgeAsset = z.infer<typeof knowledgeAssetSchema>;

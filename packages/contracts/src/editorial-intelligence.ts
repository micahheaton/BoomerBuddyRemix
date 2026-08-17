import { z } from 'zod';
import {
  editorialContentStates,
  editorialProducts,
  editorialReviewRoles,
} from '../../domain/src/editorial-intelligence';

const editorialIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u);
const editorialCodeSchema = z.string().regex(/^[a-z][a-z0-9_.:-]{1,119}$/u);
const editorialDateTimeSchema = z.string().datetime({ offset: true });

export const editorialEvidenceTierSchema = z.literal('local_simulation');
export const editorialProductSchema = z.enum(editorialProducts);
export const editorialReviewRoleSchema = z.enum(editorialReviewRoles);
export const editorialContentStateSchema = z.enum(editorialContentStates);

export const editorialRuntimeCapabilitiesSchema = z
  .object({
    externalFetch: z.literal(false),
    externalModel: z.literal(false),
    generation: z.literal(false),
    providerProcessing: z.literal(false),
    publication: z.literal(false),
    outboundDelivery: z.literal(false),
    transcription: z.literal(false),
  })
  .strict();

export const editorialSourceQueueItemSchema = z
  .object({
    sourceVersionId: editorialIdSchema,
    sourceKey: editorialCodeSchema,
    version: z.number().int().positive(),
    sourceClass: z.enum([
      'government',
      'regulator',
      'law_enforcement',
      'court',
      'standards_body',
      'provider_advisory',
      'financial_institution',
      'research_publisher',
      'other_reviewed',
    ]),
    state: z.enum(['proposed', 'approved_local', 'blocked', 'stale', 'retired']),
    reviewDueAt: editorialDateTimeSchema,
    evidenceTier: editorialEvidenceTierSchema,
    externalFetchPerformed: z.literal(false),
  })
  .strict();

export const editorialStoryQueueItemSchema = z
  .object({
    relationshipId: editorialIdSchema,
    leftArtifactId: editorialIdSchema,
    rightArtifactId: editorialIdSchema,
    relationship: z.enum([
      'identical_update',
      'syndication',
      'same_incident',
      'similar_mechanism',
      'corroborates',
      'contradicts',
      'supersedes',
      'not_related',
    ]),
    decision: z.enum(['candidate', 'confirmed', 'rejected', 'split']),
    confidence: z.enum(['limited', 'moderate', 'strong']),
    evidenceTier: editorialEvidenceTierSchema,
  })
  .strict();

export const editorialContentQueueItemSchema = z
  .object({
    contentVersionId: editorialIdSchema,
    contentKey: editorialCodeSchema,
    version: z.number().int().positive(),
    product: editorialProductSchema,
    state: editorialContentStateSchema,
    assignedRole: editorialReviewRoleSchema.optional(),
    contentReadable: z.boolean(),
    expiresAt: editorialDateTimeSchema,
    unsupportedStatistics: z.boolean(),
    unverifiedUrgency: z.boolean(),
    evidenceTier: editorialEvidenceTierSchema,
  })
  .strict();

export const editorialCorrectionQueueItemSchema = z
  .object({
    correctionId: editorialIdSchema,
    originalContentVersionId: editorialIdSchema,
    replacementContentVersionId: editorialIdSchema.optional(),
    disposition: z.enum(['correction', 'retraction']),
    reasonCode: editorialCodeSchema,
    recordedAt: editorialDateTimeSchema,
    evidenceTier: editorialEvidenceTierSchema,
  })
  .strict();

export const editorialCalendarItemSchema = z
  .object({
    calendarEventId: editorialIdSchema,
    contentVersionId: editorialIdSchema,
    state: z.enum(['internal_review_planned', 'blocked', 'cancelled']),
    plannedFor: editorialDateTimeSchema,
    evidenceTier: editorialEvidenceTierSchema,
    externalActionEnabled: z.literal(false),
  })
  .strict();

export const editorialBoardResponseSchema = z
  .object({
    projection: z.literal('owner_global_or_exact_assigned_editorial_metadata'),
    contentIncluded: z.literal(false),
    generatedAt: editorialDateTimeSchema,
    evidenceTier: editorialEvidenceTierSchema,
    capabilities: editorialRuntimeCapabilitiesSchema,
    sources: z.array(editorialSourceQueueItemSchema).max(100),
    stories: z.array(editorialStoryQueueItemSchema).max(100),
    content: z.array(editorialContentQueueItemSchema).max(100),
    corrections: z.array(editorialCorrectionQueueItemSchema).max(100),
    calendar: z.array(editorialCalendarItemSchema).max(100),
    preferences: z
      .object({
        grantedLocalFixtures: z.number().int().nonnegative(),
        withdrawnLocalFixtures: z.number().int().nonnegative(),
        externalDeliveryEnabled: z.literal(false),
      })
      .strict(),
  })
  .strict();

export const assignedEditorialDraftResponseSchema = z
  .object({
    contentVersionId: editorialIdSchema,
    assignedRole: editorialReviewRoleSchema,
    draftText: z.string().min(1).max(16_384),
    evidenceTier: editorialEvidenceTierSchema,
    providerProcessed: z.literal(false),
    publicationEligible: z.literal(false),
    externalActionExecuted: z.literal(false),
  })
  .strict();

export type EditorialBoardResponse = z.infer<typeof editorialBoardResponseSchema>;
export type EditorialContentQueueItem = z.infer<typeof editorialContentQueueItemSchema>;
export type AssignedEditorialDraftResponse = z.infer<typeof assignedEditorialDraftResponseSchema>;

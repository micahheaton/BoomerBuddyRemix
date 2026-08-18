import {
  feedbackChannelClasses,
  feedbackClassifications,
  feedbackCloseLoopStates,
  feedbackEvidenceTiers,
  feedbackQueues,
  feedbackRoutingStates,
  feedbackSeverities,
  feedbackSourceSurfaces,
  feedbackStatuses,
  feedbackTypes,
} from '@boomerbuddy/domain';
import { z } from 'zod';
import { isoDateTimeSchema, opaqueIdSchema } from './common';

const boundedFeedbackTextSchema = z
  .string()
  .trim()
  .min(4)
  .max(10_000)
  .refine((value) => new TextEncoder().encode(value).byteLength <= 8_192, {
    message: 'Feedback text must be at most 8192 UTF-8 bytes',
  });

export const feedbackOperationKeySchema = z
  .string()
  .regex(
    /^feedback:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    'Expected a feedback-scoped UUID idempotency key',
  );
export const feedbackTypeSchema = z.enum(feedbackTypes);
export const feedbackSourceSurfaceSchema = z.enum(feedbackSourceSurfaces);
export const feedbackStatusSchema = z.enum(feedbackStatuses);
export const feedbackSeveritySchema = z.enum(feedbackSeverities);
export const feedbackClassificationSchema = z.enum(feedbackClassifications);
export const feedbackQueueSchema = z.enum(feedbackQueues);
export const feedbackRoutingStateSchema = z.enum(feedbackRoutingStates);
export const feedbackCloseLoopStateSchema = z.enum(feedbackCloseLoopStates);
export const feedbackEvidenceTierSchema = z.enum(feedbackEvidenceTiers);

const sourceMetadataSchema = z
  .object({
    surface: feedbackSourceSurfaceSchema,
    appVersion: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u)
      .optional(),
    buildVersion: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u)
      .optional(),
    locale: z
      .string()
      .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/u)
      .optional(),
    deviceClass: z.enum(['desktop', 'tablet', 'phone', 'unknown']),
  })
  .strict();

const followUpConsentSchema = z.discriminatedUnion('granted', [
  z.object({ granted: z.literal(false) }).strict(),
  z
    .object({
      granted: z.literal(true),
      purpose: z.literal('feedback_follow_up'),
      consentVersion: z.literal('feedback-follow-up-v1'),
      channelClass: z.enum(feedbackChannelClasses),
    })
    .strict(),
]);

const researchRetentionConsentSchema = z.discriminatedUnion('granted', [
  z.object({ granted: z.literal(false) }).strict(),
  z
    .object({
      granted: z.literal(true),
      purpose: z.literal('product_feedback_research'),
      consentVersion: z.literal('feedback-research-v1'),
      retainUntil: isoDateTimeSchema,
    })
    .strict(),
]);

const feedbackLinkSchema = z.discriminatedUnion('permitted', [
  z.object({ permitted: z.literal(false) }).strict(),
  z
    .object({
      permitted: z.literal(true),
      consentVersion: z.literal('feedback-linkage-v1'),
      objectType: z.enum(['check', 'orientation', 'subscription']),
      objectId: opaqueIdSchema,
    })
    .strict(),
]);

export const createAuthenticatedFeedbackRequestSchema = z
  .object({
    operationKey: feedbackOperationKeySchema,
    text: boundedFeedbackTextSchema,
    feedbackType: feedbackTypeSchema,
    source: sourceMetadataSchema,
    link: feedbackLinkSchema,
    followUp: followUpConsentSchema,
    researchRetention: researchRetentionConsentSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const requiredLinks: Partial<Record<(typeof feedbackSourceSurfaces)[number], string>> = {
      post_check: 'check',
      orientation: 'orientation',
      cancellation: 'subscription',
      refund: 'subscription',
    };
    const expected = requiredLinks[value.source.surface];
    if (expected !== undefined && (!value.link.permitted || value.link.objectType !== expected)) {
      context.addIssue({
        code: 'custom',
        path: ['link'],
        message: `${value.source.surface} requires an exact ${expected} link`,
      });
    }
    if (value.source.surface === 'support_conversion') {
      context.addIssue({
        code: 'custom',
        path: ['source', 'surface'],
        message: 'Support conversion uses its assigned HQ-only endpoint',
      });
    }
  });

export const createAnonymousFeedbackRequestSchema = z
  .object({
    operationKey: feedbackOperationKeySchema,
    text: boundedFeedbackTextSchema,
    feedbackType: feedbackTypeSchema,
    source: sourceMetadataSchema.extend({ surface: z.literal('web_feedback_form') }).strict(),
    link: z.object({ permitted: z.literal(false) }).strict(),
    followUp: z.object({ granted: z.literal(false) }).strict(),
    researchRetention: researchRetentionConsentSchema,
  })
  .strict();

export const supportFeedbackConversionParamsSchema = z
  .object({ householdId: opaqueIdSchema, supportCaseId: opaqueIdSchema })
  .strict();
export const supportFeedbackConversionRequestSchema = z
  .object({
    operationKey: feedbackOperationKeySchema,
    text: boundedFeedbackTextSchema,
    feedbackType: feedbackTypeSchema,
    source: sourceMetadataSchema.extend({ surface: z.literal('support_conversion') }).strict(),
  })
  .strict();

export const feedbackIntakeResponseSchema = z
  .object({
    feedback: z
      .object({
        id: opaqueIdSchema,
        status: z.enum(['queued_unassigned', 'assigned', 'unsafe_unprocessable']),
        redactionStatus: z.enum(['minimized_clean', 'minimized_redacted', 'quarantined_discarded']),
        queue: feedbackQueueSchema,
        evidenceTier: feedbackEvidenceTierSchema,
        retainedUntil: isoDateTimeSchema.optional(),
        reused: z.boolean(),
      })
      .strict(),
    mediaAccepted: z.literal(false),
    providerProcessed: z.literal(false),
    externalActionExecuted: z.literal(false),
  })
  .strict();

export const feedbackConsentWithdrawalParamsSchema = z
  .object({
    feedbackId: opaqueIdSchema,
    purpose: z.enum(['follow_up', 'research_retention', 'object_linkage']),
  })
  .strict();
export const feedbackConsentWithdrawalResponseSchema = z
  .object({
    feedbackId: opaqueIdSchema,
    purpose: z.enum(['follow_up', 'research_retention', 'object_linkage']),
    withdrawn: z.boolean(),
    activeStoreCiphertextErased: z.boolean(),
    externalActionExecuted: z.literal(false),
  })
  .strict();

export const feedbackReviewParamsSchema = z.object({ feedbackId: opaqueIdSchema }).strict();
export const feedbackReviewClaimResponseSchema = z
  .object({
    feedbackId: opaqueIdSchema,
    queue: feedbackQueueSchema,
    routingState: feedbackRoutingStateSchema,
    assignmentVersion: z.number().int().positive(),
    humanReviewRequired: z.boolean(),
    reused: z.boolean(),
    evidenceTier: feedbackEvidenceTierSchema,
    externalActionExecuted: z.literal(false),
  })
  .strict();
export const assignedFeedbackContentResponseSchema = z
  .object({
    feedbackId: opaqueIdSchema,
    minimizedText: boundedFeedbackTextSchema,
    redactionStatus: z.enum(['minimized_clean', 'minimized_redacted']),
    evidenceTier: feedbackEvidenceTierSchema,
    contentBoundary: z.literal('assigned_minimized_text'),
    externalActionExecuted: z.literal(false),
  })
  .strict();

export const feedbackAdapterResponseSchema = z
  .object({
    adapters: z.array(
      z
        .object({
          key: z.enum([
            'authenticated_text',
            'anonymous_text',
            'support_conversion',
            'attachment',
            'audio',
            'image',
            'video',
            'screen_recording',
            'inbound_email',
            'transcription',
            'external_model',
          ]),
          state: z.enum(['production_enabled', 'local_only_enabled', 'structurally_disabled']),
          externalEffect: z.literal(false),
          reason: z.string().min(1).max(300),
        })
        .strict(),
    ),
    evidenceTier: feedbackEvidenceTierSchema,
  })
  .strict();

export const hqFeedbackQueueResponseSchema = z
  .object({
    projection: z.literal('owner_global_or_exact_assigned_feedback_metadata'),
    contentIncluded: z.literal(false),
    externalActionExecuted: z.literal(false),
    feedback: z
      .array(
        z
          .object({
            id: opaqueIdSchema,
            identityMode: z.enum(['authenticated', 'anonymous', 'support_conversion']),
            householdId: opaqueIdSchema.optional(),
            sourceSurface: feedbackSourceSurfaceSchema,
            feedbackType: feedbackTypeSchema,
            status: feedbackStatusSchema,
            severity: feedbackSeveritySchema,
            classification: feedbackClassificationSchema,
            queue: feedbackQueueSchema,
            routingState: feedbackRoutingStateSchema,
            redactionStatus: z.enum([
              'minimized_clean',
              'minimized_redacted',
              'quarantined_discarded',
            ]),
            duplicateOfFeedbackId: opaqueIdSchema.optional(),
            clusterId: opaqueIdSchema.optional(),
            resultingActionType: z
              .enum(['issue', 'experiment', 'content', 'support_action'])
              .optional(),
            resultingActionId: opaqueIdSchema.optional(),
            closeLoopState: feedbackCloseLoopStateSchema,
            followUpConsented: z.boolean(),
            researchRetentionConsented: z.boolean(),
            evidenceTier: feedbackEvidenceTierSchema,
            version: z.number().int().positive(),
            createdAt: isoDateTimeSchema,
            routedAt: isoDateTimeSchema,
            assignedAt: isoDateTimeSchema.optional(),
            contentReadAuthorized: z.boolean(),
            selfClaimAvailable: z.boolean(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export type CreateAuthenticatedFeedbackRequest = z.infer<
  typeof createAuthenticatedFeedbackRequestSchema
>;
export type CreateAnonymousFeedbackRequest = z.infer<typeof createAnonymousFeedbackRequestSchema>;
export type SupportFeedbackConversionRequest = z.infer<
  typeof supportFeedbackConversionRequestSchema
>;
export type FeedbackIntakeResponse = z.infer<typeof feedbackIntakeResponseSchema>;
export type FeedbackConsentWithdrawalResponse = z.infer<
  typeof feedbackConsentWithdrawalResponseSchema
>;
export type HqFeedbackQueueResponse = z.infer<typeof hqFeedbackQueueResponseSchema>;
export type FeedbackReviewClaimResponse = z.infer<typeof feedbackReviewClaimResponseSchema>;
export type AssignedFeedbackContentResponse = z.infer<typeof assignedFeedbackContentResponseSchema>;

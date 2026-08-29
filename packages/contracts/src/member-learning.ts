import {
  memberLearningCoarseRegionCodes,
  memberLearningCoarseRegionLabels,
  memberLearningLessonKeys,
  memberWeeklyRehearsalKeys,
} from '@boomerbuddy/domain';
import { z } from 'zod';
import { isoDateTimeSchema } from './common';

export const memberLearningLessonKeySchema = z.enum(memberLearningLessonKeys);
export const memberWeeklyRehearsalKeySchema = z.enum(memberWeeklyRehearsalKeys);
export const memberLearningOptionKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,63}$/u, 'Expected a lesson option key');
export { memberLearningCoarseRegionCodes, memberLearningCoarseRegionLabels };
export const memberLearningCoarseRegionSchema = z.enum(memberLearningCoarseRegionCodes, {
  error: 'Choose the United States or one supported coarse state region',
});
export const memberLearningFeedItemKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9:_-]{2,190}$/u, 'Expected an in-app feed item key');

export const memberLearningMutationActions = [
  'lesson-start',
  'lesson-answer',
  'preferences-update',
  'weekly-rehearsal-complete',
  'feed-item-update',
] as const;
export type MemberLearningMutationAction = (typeof memberLearningMutationActions)[number];
const memberLearningOperationUuid =
  '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
export const memberLearningOperationKeySchema = z
  .string()
  .regex(
    new RegExp(
      `^member-learning:(?:${memberLearningMutationActions.join('|')}):${memberLearningOperationUuid}$`,
      'u',
    ),
    'Expected an action-bound member-learning UUID Idempotency-Key',
  );

export const memberLearningSourceSchema = z.object({
  title: z.string().min(1).max(160),
  url: z.string().url().startsWith('https://'),
});

export const memberLearningProgressSchema = z.object({
  state: z.enum(['not_started', 'in_progress', 'completed', 'review_due']),
  attemptCount: z.number().int().nonnegative(),
  reviewCount: z.number().int().nonnegative(),
  priorVersionCompleted: z.boolean(),
  startedAt: isoDateTimeSchema.optional(),
  completedAt: isoDateTimeSchema.optional(),
  lastReviewedAt: isoDateTimeSchema.optional(),
  reviewDueAt: isoDateTimeSchema.optional(),
  updatedAt: isoDateTimeSchema.optional(),
});

export const memberLearningLessonSchema = z.object({
  key: memberLearningLessonKeySchema,
  version: z.number().int().positive(),
  order: z.number().int().positive(),
  title: z.string().min(1).max(120),
  objective: z.string().min(1).max(240),
  estimatedMinutes: z.number().int().min(1).max(15),
  scenario: z.string().min(1).max(600),
  options: z
    .array(
      z.object({
        key: memberLearningOptionKeySchema,
        label: z.string().min(1).max(240),
      }),
    )
    .min(2)
    .max(4),
  takeaway: z.string().min(1).max(300),
  sources: z.array(memberLearningSourceSchema).min(1).max(4),
  progress: memberLearningProgressSchema,
});

export const memberLearningResumeSchema = z
  .object({
    lessonKey: memberLearningLessonKeySchema,
    lessonVersion: z.number().int().positive(),
    reason: z.enum(['continue', 'next', 'review']),
  })
  .nullable();

export const memberScamGuidanceBriefSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]{2,79}$/u),
  version: z.number().int().positive(),
  region: memberLearningCoarseRegionSchema,
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(800),
  safeActions: z.array(z.string().min(1).max(300)).min(1).max(8),
  source: memberLearningSourceSchema.extend({ publishedAt: isoDateTimeSchema }),
  publishedAt: isoDateTimeSchema,
  reviewedAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
  freshness: z.enum(['current', 'stale']),
});

export const memberScamGuidanceSchema = z.object({
  requestedRegion: memberLearningCoarseRegionSchema,
  resolvedRegion: memberLearningCoarseRegionSchema.nullable(),
  state: z.enum(['current', 'fallback_national', 'stale', 'none']),
  briefs: z.array(memberScamGuidanceBriefSchema).max(5),
  curated: z.literal(true),
  liveMonitoring: z.literal(false),
  exhaustive: z.literal(false),
  externalFetch: z.literal(false),
  staleMessage: z.string().min(1).max(300).optional(),
});

export const memberLearningPreferencesSchema = z.object({
  coarseRegion: memberLearningCoarseRegionSchema,
  weeklyRehearsalEnabled: z.boolean(),
  weeklyRehearsalEnabledAt: isoDateTimeSchema.optional(),
  lastRehearsedAt: isoDateTimeSchema.optional(),
  nextRehearsalAt: isoDateTimeSchema.optional(),
  updatedAt: isoDateTimeSchema.optional(),
});

export const memberLearningFeedItemSchema = z.object({
  key: memberLearningFeedItemKeySchema,
  version: z.number().int().positive(),
  kind: z.enum(['lesson', 'guidance', 'weekly_rehearsal']),
  state: z.enum(['unread', 'read']),
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(400),
  action: z.enum(['resume_lesson', 'review_lesson', 'read_guidance', 'weekly_rehearsal']),
  lessonKey: memberLearningLessonKeySchema.optional(),
  dueAt: isoDateTimeSchema.optional(),
  createdAt: isoDateTimeSchema,
});

export const memberWeeklyRehearsalSchema = z.object({
  key: memberWeeklyRehearsalKeySchema,
  version: z.number().int().positive(),
  occurrenceVersion: z.number().int().positive(),
  title: z.string().min(1).max(160),
  estimatedMinutes: z.literal(2),
  scenario: z.string().min(1).max(600),
  prompt: z.string().min(1).max(200),
  options: z
    .array(
      z.object({
        key: memberLearningOptionKeySchema,
        label: z.string().min(1).max(240),
      }),
    )
    .min(2)
    .max(4),
  takeaway: z.string().min(1).max(300),
  source: memberLearningSourceSchema,
  reviewedAt: isoDateTimeSchema,
  dueAt: isoDateTimeSchema,
});

export const memberLearningResponseSchema = z.object({
  curriculum: z.object({
    version: z.literal('beta-1'),
    completedCount: z.number().int().nonnegative(),
    totalCount: z.number().int().positive(),
    resume: memberLearningResumeSchema,
    lessons: z.array(memberLearningLessonSchema).length(memberLearningLessonKeys.length),
  }),
  guidance: memberScamGuidanceSchema,
  preferences: memberLearningPreferencesSchema,
  weeklyRehearsal: memberWeeklyRehearsalSchema.nullable(),
  feed: z.object({
    items: z.array(memberLearningFeedItemSchema).max(20),
    unreadCount: z.number().int().nonnegative(),
    delivery: z.literal('in_app_only'),
    externalDelivery: z.literal('disabled'),
  }),
  contentBoundary: z.literal('repository_curated_in_app_only'),
});

export const startMemberLearningLessonRequestSchema = z
  .object({ lessonVersion: z.number().int().positive() })
  .strict();

export const answerMemberLearningLessonRequestSchema = z
  .object({
    lessonVersion: z.number().int().positive(),
    optionKey: memberLearningOptionKeySchema,
  })
  .strict();

export const answerMemberLearningLessonResponseSchema = z.object({
  correct: z.boolean(),
  feedback: z.string().min(1).max(500),
  learning: memberLearningResponseSchema,
});

export const updateMemberLearningPreferencesRequestSchema = z
  .object({
    coarseRegion: memberLearningCoarseRegionSchema,
    weeklyRehearsalEnabled: z.boolean(),
  })
  .strict();

export const answerWeeklyRehearsalRequestSchema = z
  .object({
    rehearsalKey: memberWeeklyRehearsalKeySchema,
    rehearsalVersion: z.number().int().positive(),
    occurrenceVersion: z.number().int().positive(),
    optionKey: memberLearningOptionKeySchema,
  })
  .strict();

export const completeWeeklyRehearsalRequestSchema = z
  .object({ complete: z.literal(true) })
  .strict();

export const answerWeeklyRehearsalResponseSchema = z.object({
  saferChoice: z.boolean(),
  feedback: z.string().min(1).max(500),
  learning: memberLearningResponseSchema,
});

export const updateMemberLearningFeedItemRequestSchema = z
  .object({
    itemVersion: z.number().int().positive(),
    state: z.enum(['read', 'dismissed']),
  })
  .strict();

export type MemberLearningResponse = z.infer<typeof memberLearningResponseSchema>;
export type MemberLearningLessonDto = z.infer<typeof memberLearningLessonSchema>;
export type MemberLearningProgressDto = z.infer<typeof memberLearningProgressSchema>;
export type MemberScamGuidanceDto = z.infer<typeof memberScamGuidanceSchema>;
export type MemberLearningPreferencesDto = z.infer<typeof memberLearningPreferencesSchema>;
export type MemberLearningFeedItemDto = z.infer<typeof memberLearningFeedItemSchema>;
export type MemberWeeklyRehearsalDto = z.infer<typeof memberWeeklyRehearsalSchema>;
export type StartMemberLearningLessonRequest = z.infer<
  typeof startMemberLearningLessonRequestSchema
>;
export type AnswerMemberLearningLessonRequest = z.infer<
  typeof answerMemberLearningLessonRequestSchema
>;
export type AnswerMemberLearningLessonResponse = z.infer<
  typeof answerMemberLearningLessonResponseSchema
>;
export type UpdateMemberLearningPreferencesRequest = z.infer<
  typeof updateMemberLearningPreferencesRequestSchema
>;
export type AnswerWeeklyRehearsalRequest = z.infer<typeof answerWeeklyRehearsalRequestSchema>;
export type AnswerWeeklyRehearsalResponse = z.infer<typeof answerWeeklyRehearsalResponseSchema>;
export type CompleteWeeklyRehearsalRequest = z.infer<typeof completeWeeklyRehearsalRequestSchema>;
export type UpdateMemberLearningFeedItemRequest = z.infer<
  typeof updateMemberLearningFeedItemRequestSchema
>;

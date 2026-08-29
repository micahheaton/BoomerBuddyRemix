import { z } from 'zod';
import { isoDateTimeSchema, opaqueIdSchema, providerStateSchema } from './common';

export const checkKindSchema = z.enum(['text', 'url']);
export const riskSchema = z.enum(['unknown', 'caution', 'high_concern']);
export const reservedRiskSchema = z.literal('lower_concern');
export const evidenceSufficiencySchema = z.enum(['limited', 'moderate', 'strong']);

function boundedContent(maxCharacters: number, maxBytes: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(maxCharacters)
    .refine((value) => new TextEncoder().encode(value).byteLength <= maxBytes, {
      message: `Content must be at most ${maxBytes} UTF-8 bytes`,
    });
}

const refreshCheckField = { refresh: z.boolean().default(false) } as const;

export const createCheckRequestSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('text'),
      content: boundedContent(20_000, 16_384),
      ...refreshCheckField,
    })
    .strict(),
  z
    .object({
      kind: z.literal('url'),
      content: boundedContent(2_048, 4_096),
      ...refreshCheckField,
    })
    .strict(),
]);

export const checkListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .strict();

export const checkEvidenceSchema = z.object({
  kind: z.enum(['artifact', 'reputation', 'model', 'missing']),
  label: z.string().min(1).max(120),
  observation: z.string().min(1).max(500),
  limitations: z.string().max(500),
});

export const safeActionSchema = z.object({
  key: z.string().min(1).max(80),
  priority: z.number().int().min(1).max(10),
  title: z.string().min(1).max(160),
  detail: z.string().min(1).max(800),
  officialChannelOnly: z.boolean(),
});

export const checkResultSchema = z.object({
  id: opaqueIdSchema,
  householdId: opaqueIdSchema,
  kind: checkKindSchema,
  risk: riskSchema,
  evidenceSufficiency: evidenceSufficiencySchema,
  calibration: z.literal('not_calibrated'),
  summary: z.string().min(1).max(1_000),
  evidence: z.array(checkEvidenceSchema).max(50),
  actions: z.array(safeActionSchema).max(20),
  provider: z.object({
    name: z.string().min(1).max(100),
    state: providerStateSchema,
    version: z.string().min(1).max(100),
  }),
  rulesetVersion: z.string().min(1).max(100),
  createdAt: isoDateTimeSchema,
  retention: z.object({
    state: z.enum(['active', 'deleted']),
    deleteAfter: isoDateTimeSchema,
  }),
  access: z.object({
    kind: z.enum(['owned', 'shared']),
    canDelete: z.boolean(),
    canShare: z.boolean(),
  }),
});

const checkAnalysisTimingShape = {
  analyzedAt: isoDateTimeSchema,
} as const;

export const checkAnalysisDispositionSchema = z
  .discriminatedUnion('source', [
    z
      .object({
        source: z.literal('new'),
        reused: z.literal(false),
        ...checkAnalysisTimingShape,
        refreshAfter: isoDateTimeSchema.nullable(),
      })
      .strict(),
    z
      .object({
        source: z.literal('recent_owned'),
        reused: z.literal(true),
        ...checkAnalysisTimingShape,
        refreshAfter: isoDateTimeSchema,
      })
      .strict(),
    z
      .object({
        source: z.literal('public_conversion'),
        reused: z.literal(true),
        ...checkAnalysisTimingShape,
        refreshAfter: isoDateTimeSchema.nullable(),
      })
      .strict(),
  ])
  .refine(
    (value) =>
      value.refreshAfter === null ||
      new Date(value.refreshAfter).getTime() > new Date(value.analyzedAt).getTime(),
    {
      message: 'Check refresh deadline must follow analysis time',
      path: ['refreshAfter'],
    },
  );

export const createCheckResponseSchema = z
  .object({
    check: checkResultSchema,
    analysis: checkAnalysisDispositionSchema,
  })
  .strict();
export const checkListResponseSchema = z.object({
  checks: z.array(checkResultSchema),
  total: z.number().int().nonnegative(),
  page: z.object({
    limit: z.number().int().min(1).max(100),
    offset: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }),
});
export const checkDetailResponseSchema = z.object({ check: checkResultSchema });
export const deleteCheckResponseSchema = z.object({
  id: opaqueIdSchema,
  state: z.literal('deleted'),
  deletedAt: isoDateTimeSchema,
});

export const shareCheckRequestSchema = z.object({ sharedWithPersonId: opaqueIdSchema }).strict();
export const checkShareLifecycleStateSchema = z.enum(['shared', 'acknowledged', 'closed']);
export const checkShareClosureReasonSchema = z.enum([
  'safer_action_completed',
  'no_longer_needs_help',
]);
export const checkShareLifecycleSchema = z
  .object({
    checkId: opaqueIdSchema,
    sharedWithPersonId: opaqueIdSchema,
    sharedWithDisplayName: z.string().min(1).max(120),
    state: checkShareLifecycleStateSchema,
    sharedAt: isoDateTimeSchema,
    acknowledgedAt: isoDateTimeSchema.optional(),
    closedAt: isoDateTimeSchema.optional(),
    closureReason: checkShareClosureReasonSchema.optional(),
  })
  .superRefine((value, context) => {
    const valid =
      (value.state === 'shared' &&
        value.acknowledgedAt === undefined &&
        value.closedAt === undefined &&
        value.closureReason === undefined) ||
      (value.state === 'acknowledged' &&
        value.acknowledgedAt !== undefined &&
        value.closedAt === undefined &&
        value.closureReason === undefined) ||
      (value.state === 'closed' &&
        value.acknowledgedAt !== undefined &&
        value.closedAt !== undefined &&
        value.closureReason !== undefined);
    if (!valid) {
      context.addIssue({
        code: 'custom',
        message: 'Check share lifecycle evidence does not match its state',
      });
    }
  });
export const shareCheckResponseSchema = z.object({
  checkId: opaqueIdSchema,
  sharedWithPersonId: opaqueIdSchema,
  state: z.literal('active'),
  lifecycle: checkShareLifecycleSchema,
});
export const checkShareListResponseSchema = z.object({
  shares: z.array(checkShareLifecycleSchema),
});
export const acknowledgeCheckShareResponseSchema = z.object({
  share: checkShareLifecycleSchema,
});
export const closeCheckShareRequestSchema = z
  .object({ resolution: checkShareClosureReasonSchema })
  .strict();
export const closeCheckShareResponseSchema = z.object({
  share: checkShareLifecycleSchema,
});

export type CheckKind = z.infer<typeof checkKindSchema>;
export type Risk = z.infer<typeof riskSchema>;
export type EvidenceSufficiency = z.infer<typeof evidenceSufficiencySchema>;
export type CreateCheckRequest = z.input<typeof createCheckRequestSchema>;
export type CheckListQuery = z.infer<typeof checkListQuerySchema>;
export type CheckResult = z.infer<typeof checkResultSchema>;
export type CreateCheckResponse = z.infer<typeof createCheckResponseSchema>;
export type CheckListResponse = z.infer<typeof checkListResponseSchema>;
export type ShareCheckRequest = z.infer<typeof shareCheckRequestSchema>;
export type CheckShareLifecycle = z.infer<typeof checkShareLifecycleSchema>;
export type CheckShareClosureReason = z.infer<typeof checkShareClosureReasonSchema>;
export type CheckShareListResponse = z.infer<typeof checkShareListResponseSchema>;

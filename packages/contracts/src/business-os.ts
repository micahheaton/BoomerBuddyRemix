import { z } from 'zod';

import { isoDateTimeSchema, opaqueIdSchema } from './common';

export const attributionChannelSchema = z.enum([
  'organic_search',
  'paid_search',
  'paid_social',
  'referral',
  'partner',
  'affiliate',
  'direct',
  'content',
  'campaign',
  'newsletter',
]);

export const acquisitionMilestoneSchema = z.enum([
  'landing',
  'first_check',
  'signup',
  'activation',
  'orientation',
  'trial',
  'paid',
  'retention',
  'referral',
]);

const attributionTokenSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]*$/iu)
  .max(100);

export const recordAttributionRequestSchema = z.object({
  channel: attributionChannelSchema.optional(),
  milestone: acquisitionMilestoneSchema,
  source: attributionTokenSchema.optional(),
  medium: attributionTokenSchema.optional(),
  campaign: attributionTokenSchema.optional(),
  content: attributionTokenSchema.optional(),
  partner: attributionTokenSchema.optional(),
  referrerHost: z.string().max(253).optional(),
});

export const memberSegmentSchema = z.enum(['under_10k', '10k_50k', '50k_250k', '250k_plus']);

export const creditUnionTargetSchema = z.object({
  charterNumber: z.number().int().positive(),
  internalJoinNumber: z.number().int().positive(),
  name: z.string(),
  city: z.string(),
  state: z.string(),
  charterState: z.string(),
  zipCode: z.string(),
  ncuaRegion: z.string(),
  sourceTypeCode: z.string(),
  lowIncomeDesignation: z.boolean(),
  peerGroup: z.number().int().nonnegative(),
  members: z.number().int().nonnegative(),
  assets: z.number().int().nonnegative(),
  loans: z.number().int().nonnegative(),
  deposits: z.number().int().nonnegative(),
  memberSegment: memberSegmentSchema,
  fitScore: z.number().int().min(0).max(100),
  fitReasons: z.array(z.string()),
  evidenceState: z.literal('official_fixed_snapshot'),
  intentClaimed: z.literal(false),
});

export const creditUnionTargetsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  minimumFitScore: z.coerce.number().int().min(0).max(100).default(0),
  memberSegment: memberSegmentSchema.optional(),
});

export const creditUnionTargetsResponseSchema = z.object({
  targets: z.array(creditUnionTargetSchema),
  dataState: z.enum(['official_fixed_snapshot', 'unavailable']),
  limitation: z.literal('Fit is explainable segmentation, not buyer intent.'),
});

export const opportunityStageSchema = z.enum([
  'target',
  'prospecting',
  'engaged',
  'discovery',
  'qualified',
  'pilot',
  'business_case',
  'contracting',
  'closed_won',
  'closed_lost',
  'implementation',
  'active_partner',
  'expansion',
]);

export const createOpportunityRequestSchema = z.object({
  organizationId: opaqueIdSchema,
  name: z.string().trim().min(1).max(240),
  ownerPersonId: opaqueIdSchema.optional(),
  amountMinor: z.number().int().nonnegative().optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/u)
    .optional(),
  useCase: z.string().trim().min(1).max(1000).optional(),
});

export const transitionOpportunityRequestSchema = z.object({
  nextStage: opportunityStageSchema,
  reason: z.string().trim().min(1).max(1000),
});

export const setOpportunityNextActionRequestSchema = z.object({
  nextAction: z.string().trim().min(1).max(1000),
  nextActionAt: isoDateTimeSchema,
});

export const opportunityQueueItemSchema = z.object({
  id: opaqueIdSchema,
  organizationId: opaqueIdSchema,
  organizationName: z.string(),
  name: z.string(),
  stage: opportunityStageSchema,
  ownerPersonId: opaqueIdSchema.optional(),
  stale: z.boolean(),
  reasons: z.array(z.string()),
  recommendedAction: z.string().optional(),
});

export const opportunityQueueResponseSchema = z.object({
  opportunities: z.array(opportunityQueueItemSchema),
  consequentialOutreachAutomatic: z.literal(false),
});

export const ownerAttentionItemSchema = z.object({
  id: opaqueIdSchema,
  attentionKind: z.string(),
  sourceType: z.string(),
  sourceId: z.string(),
  whyFounderRequired: z.string(),
  recommendedAction: z.string(),
  consequenceOfInaction: z.string(),
  deadline: isoDateTimeSchema.optional(),
  state: z.enum(['open', 'snoozed', 'resolved', 'dismissed']),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const ownerAttentionResponseSchema = z.object({
  items: z.array(ownerAttentionItemSchema),
});

export const ownerBriefResponseSchema = z.object({
  generatedAt: isoDateTimeSchema,
  metrics: z.object({
    attention: z.number().int().nonnegative(),
    atRiskHouseholds: z.number().int().nonnegative(),
    creditUnionUniverse: z.number().int().nonnegative(),
    openOpportunities: z.number().int().nonnegative(),
    staleOpportunities: z.number().int().nonnegative(),
  }),
  dataState: z.literal('local_or_imported_evidence'),
});

export const autonomyClassSchema = z.enum(['auto', 'approval', 'human', 'professional']);

export const putAutonomyPolicyRequestSchema = z.object({
  action: attributionTokenSchema,
  allowedDataClasses: z.array(attributionTokenSchema).max(20),
  allowedTools: z.array(attributionTokenSchema).max(20),
  autonomy: autonomyClassSchema,
  budgetCents: z.number().int().nonnegative().max(1_000_000),
  enabled: z.boolean(),
  requiresAudit: z.literal(true),
});

export const evaluateAutomationRequestSchema = z.object({
  action: attributionTokenSchema,
  dataClasses: z.array(attributionTokenSchema).max(20),
  estimatedCostCents: z.number().int().nonnegative().max(1_000_000),
  tool: attributionTokenSchema,
});

export const evaluateAutomationResponseSchema = z.object({
  allowed: z.boolean(),
  disposition: z.enum(['auto', 'approval', 'human', 'professional', 'blocked']),
  reasons: z.array(z.string()),
  runId: opaqueIdSchema,
});

export const automationGlobalControlResponseSchema = z.object({
  killSwitch: z.boolean(),
  updatedAt: isoDateTimeSchema,
  updatedByPersonId: opaqueIdSchema.optional(),
});

export const putAutomationGlobalControlRequestSchema = z
  .object({
    killSwitch: z.boolean(),
    confirmation: z.enum(['ENGAGE', 'DISENGAGE']),
  })
  .superRefine((value, context) => {
    if (
      (value.killSwitch && value.confirmation !== 'ENGAGE') ||
      (!value.killSwitch && value.confirmation !== 'DISENGAGE')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Confirmation does not match kill-switch state',
      });
    }
  });

export const createPrivacyRequestSchema = z
  .object({
    householdId: opaqueIdSchema.optional(),
    personId: opaqueIdSchema.optional(),
    requestKind: z.enum(['access', 'export', 'delete', 'correct', 'restrict']),
  })
  .refine((value) => value.householdId !== undefined || value.personId !== undefined, {
    message: 'A person or household subject is required.',
  });

export const createSelfPrivacyRequestSchema = z.object({
  requestKind: z.enum(['access', 'export', 'delete', 'correct', 'restrict']),
});

export const createPrivacyRequestResponseSchema = z.object({
  id: opaqueIdSchema,
  state: z.literal('received'),
  identityVerificationState: z.literal('pending'),
  dueAt: isoDateTimeSchema,
});

export type CreditUnionTargetsResponse = z.infer<typeof creditUnionTargetsResponseSchema>;
export type OpportunityQueueResponse = z.infer<typeof opportunityQueueResponseSchema>;
export type OwnerBriefResponse = z.infer<typeof ownerBriefResponseSchema>;

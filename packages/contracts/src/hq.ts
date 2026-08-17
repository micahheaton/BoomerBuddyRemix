import { z } from 'zod';
import { isoDateTimeSchema, opaqueIdSchema, providerStateSchema } from './common';
import { riskSchema } from './checks';

export const metricCardSchema = z.object({
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(160),
  value: z.number(),
  source: z.string().min(1).max(160),
  updatedAt: isoDateTimeSchema,
  dataState: z.literal('local_development'),
});

export const hqOverviewResponseSchema = z.object({
  metrics: z.array(metricCardSchema),
  alerts: z.array(
    z.object({
      key: z.string(),
      severity: z.enum(['info', 'warning', 'critical']),
      message: z.string(),
      dataState: z.literal('local_development'),
    }),
  ),
});

export const hqHouseholdsResponseSchema = z.object({
  households: z.array(
    z.object({
      id: opaqueIdSchema,
      name: z.string(),
      memberCount: z.number().int().nonnegative(),
      orientationReadyCount: z.number().int().nonnegative(),
      entitlementState: z.enum(['active', 'inactive']),
      dataState: z.literal('local_development'),
    }),
  ),
  truncated: z.boolean(),
});

export const hqChecksResponseSchema = z.object({
  checks: z.array(
    z.object({
      id: opaqueIdSchema,
      householdId: opaqueIdSchema,
      kind: z.enum(['text', 'url']),
      risk: riskSchema,
      providerState: providerStateSchema,
      createdAt: isoDateTimeSchema,
      dataState: z.literal('local_development'),
    }),
  ),
});

export const hqSupportQueueResponseSchema = z
  .object({
    projection: z.literal('assigned_support_queue'),
    cases: z.array(
      z
        .object({
          id: opaqueIdSchema,
          householdId: opaqueIdSchema,
          householdName: z.string().min(1).max(160),
          purposeCode: z.enum(['customer_support']),
          status: z.literal('open'),
          assignedAt: isoDateTimeSchema,
          dataState: z.literal('local_development'),
        })
        .strict(),
    ),
    truncated: z.boolean(),
  })
  .strict();

export const hqReviewQueueResponseSchema = z
  .object({
    projection: z.literal('assigned_review_queue'),
    cases: z.array(
      z
        .object({
          id: opaqueIdSchema,
          severity: z.enum(['low', 'medium', 'high', 'critical']),
          state: z.enum(['open', 'triaged', 'in_progress']),
          routingClass: z.enum([
            'self_service',
            'ai_assisted',
            'l1_human',
            'trust_safety',
            'billing',
            'security_privacy',
            'founder',
          ]),
          dueAt: isoDateTimeSchema.optional(),
          updatedAt: isoDateTimeSchema,
          dataState: z.literal('local_development'),
        })
        .strict(),
    ),
    truncated: z.boolean(),
  })
  .strict();

export const hqProviderHealthResponseSchema = z.object({
  providers: z.array(
    z.object({
      key: z.string(),
      state: providerStateSchema,
      lastCheckedAt: isoDateTimeSchema,
      detail: z.string(),
      dataState: z.literal('local_development'),
    }),
  ),
});

export const hqAuditResponseSchema = z.object({
  events: z.array(
    z.object({
      id: opaqueIdSchema,
      action: z.string(),
      resourceType: z.string(),
      resourceId: opaqueIdSchema.optional(),
      outcome: z.enum(['allowed', 'denied', 'completed']),
      actorPersonId: opaqueIdSchema.optional(),
      occurredAt: isoDateTimeSchema,
    }),
  ),
});

export const hqRevenueResponseSchema = z.object({
  savedSearches: z.array(
    z.object({
      id: opaqueIdSchema,
      name: z.string(),
      source: z.literal('seeded'),
      resultCount: z.number(),
    }),
  ),
  targetAccounts: z.array(
    z.object({
      id: opaqueIdSchema,
      name: z.string(),
      segment: z.string(),
      verificationState: z.string(),
    }),
  ),
  opportunities: z.array(
    z.object({
      id: opaqueIdSchema,
      accountId: opaqueIdSchema,
      stage: z.string(),
      owner: z.string(),
      nextAction: z.string(),
      nextActionAt: isoDateTimeSchema,
      stale: z.boolean(),
      dataState: z.literal('seeded'),
    }),
  ),
  truncated: z.boolean(),
});

export const publicConfigResponseSchema = z.object({
  productName: z.literal('BoomerBuddy'),
  environment: z.enum(['development', 'test', 'production']),
  checkKinds: z.array(z.enum(['text', 'url'])),
  nativeSharingImplemented: z.literal(false),
  liveProvidersEnabled: z.literal(false),
  pricing: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      monthlyUsd: z.number().nullable(),
      annualUsd: z.number().nullable(),
      foundingAnnualUsd: z.number().optional(),
      hypothesis: z.literal(true),
    }),
  ),
});

export type HqOverviewResponse = z.infer<typeof hqOverviewResponseSchema>;
export type HqSupportQueueResponse = z.infer<typeof hqSupportQueueResponseSchema>;
export type HqReviewQueueResponse = z.infer<typeof hqReviewQueueResponseSchema>;
export type HqRevenueResponse = z.infer<typeof hqRevenueResponseSchema>;
export type PublicConfigResponse = z.infer<typeof publicConfigResponseSchema>;

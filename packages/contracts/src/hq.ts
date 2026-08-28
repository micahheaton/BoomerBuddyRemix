import { z } from 'zod';
import { isoDateTimeSchema, opaqueIdSchema, providerStateSchema } from './common';
import { riskSchema } from './checks';
import { stripePublicCatalogSchema } from './commerce';

const hqDataStateSchema = z.enum(['local_development', 'live_database']);

export const metricCardSchema = z.object({
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(160),
  value: z.number(),
  source: z.string().min(1).max(160),
  updatedAt: isoDateTimeSchema,
  dataState: hqDataStateSchema,
});

export const hqOverviewResponseSchema = z.object({
  metrics: z.array(metricCardSchema),
  alerts: z.array(
    z.object({
      key: z.string(),
      severity: z.enum(['info', 'warning', 'critical']),
      message: z.string(),
      dataState: hqDataStateSchema,
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
      dataState: hqDataStateSchema,
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
      dataState: hqDataStateSchema,
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
          dataState: hqDataStateSchema,
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
          dataState: hqDataStateSchema,
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
      dataState: hqDataStateSchema,
    }),
  ),
});

const operationalHealthStatusSchema = z.enum(['healthy', 'warning', 'critical']);
const operationalHealthCountSchema = z.number().int().nonnegative().max(1_000_000);
const operationalHealthAgeSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const operationalHealthAttentionCodeSchema = z.enum([
  'worker_missing',
  'worker_stale',
  'worker_stopped',
  'worker_draining',
  'worker_clock_skew',
  'worker_count_saturated',
  'job_backlog_stale',
  'job_running_stale',
  'job_exhausted',
  'job_dead_letter',
  'job_clock_skew',
  'job_count_saturated',
  'outbox_backlog_stale',
  'outbox_exhausted',
  'outbox_causally_blocked',
  'outbox_dead_letter',
  'outbox_clock_skew',
  'outbox_count_saturated',
]);

export const hqOperationalHealthResponseSchema = z
  .object({
    projection: z.literal('content_free_operational_health'),
    generatedAt: isoDateTimeSchema,
    status: operationalHealthStatusSchema,
    thresholds: z
      .object({
        workerStaleAfterSeconds: z.number().int().min(10).max(3_600),
        backlogStaleAfterSeconds: z.number().int().min(30).max(86_400),
        clockSkewToleranceSeconds: z.number().int().min(1).max(30),
        aggregateCountCeiling: z.number().int().min(1_000).max(1_000_000),
      })
      .strict(),
    workers: z
      .object({
        status: operationalHealthStatusSchema,
        observedCount: operationalHealthCountSchema,
        runningCount: operationalHealthCountSchema,
        drainingCount: operationalHealthCountSchema,
        stoppedCount: operationalHealthCountSchema,
        staleCount: operationalHealthCountSchema,
        clockSkewCount: operationalHealthCountSchema,
        oldestActiveHeartbeatAgeSeconds: operationalHealthAgeSchema.nullable(),
        freshestActiveHeartbeatAgeSeconds: operationalHealthAgeSchema.nullable(),
        countSaturated: z.boolean(),
      })
      .strict(),
    durableJobs: z
      .object({
        status: operationalHealthStatusSchema,
        queuedCount: operationalHealthCountSchema,
        retryCount: operationalHealthCountSchema,
        runningCount: operationalHealthCountSchema,
        staleRunningCount: operationalHealthCountSchema,
        exhaustedCount: operationalHealthCountSchema,
        deadLetterCount: operationalHealthCountSchema,
        actionableCount: operationalHealthCountSchema,
        oldestActionableAgeSeconds: operationalHealthAgeSchema.nullable(),
        oldestStaleRunningAgeSeconds: operationalHealthAgeSchema.nullable(),
        oldestExhaustedAgeSeconds: operationalHealthAgeSchema.nullable(),
        oldestDeadLetterAgeSeconds: operationalHealthAgeSchema.nullable(),
        countSaturated: z.boolean(),
      })
      .strict(),
    outbox: z
      .object({
        status: operationalHealthStatusSchema,
        unprocessedCount: operationalHealthCountSchema,
        exhaustedCount: operationalHealthCountSchema,
        causallyBlockedCount: operationalHealthCountSchema,
        deadLetterCount: operationalHealthCountSchema,
        actionableCount: operationalHealthCountSchema,
        oldestActionableAgeSeconds: operationalHealthAgeSchema.nullable(),
        oldestExhaustedAgeSeconds: operationalHealthAgeSchema.nullable(),
        oldestCausallyBlockedAgeSeconds: operationalHealthAgeSchema.nullable(),
        oldestDeadLetterAgeSeconds: operationalHealthAgeSchema.nullable(),
        countSaturated: z.boolean(),
      })
      .strict(),
    attentionCodes: z.array(operationalHealthAttentionCodeSchema).max(18),
  })
  .strict();

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
  liveProvidersEnabled: z.boolean(),
  pricing: z
    .array(
      z.object({
        key: z.literal('family'),
        name: z.literal('Family'),
        monthlyUsd: z.literal(14.99),
        annualUsd: z.literal(149.9),
        hypothesis: z.literal(false),
      }),
    )
    .length(1),
  commerceCatalog: stripePublicCatalogSchema,
});

export type HqOverviewResponse = z.infer<typeof hqOverviewResponseSchema>;
export type HqOperationalHealthResponse = z.infer<typeof hqOperationalHealthResponseSchema>;
export type HqSupportQueueResponse = z.infer<typeof hqSupportQueueResponseSchema>;
export type HqReviewQueueResponse = z.infer<typeof hqReviewQueueResponseSchema>;
export type HqRevenueResponse = z.infer<typeof hqRevenueResponseSchema>;
export type PublicConfigResponse = z.infer<typeof publicConfigResponseSchema>;

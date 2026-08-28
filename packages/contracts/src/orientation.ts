import { z } from 'zod';
import { capabilitySchema, isoDateTimeSchema, opaqueIdSchema } from './common';

export const orientationStepSchema = z.enum([
  'protection_subject',
  'trusted_circle',
  'safe_word',
  'practice_check',
  'capabilities_and_limits',
  'review',
]);

export const orientationStateSchema = z.object({
  householdId: opaqueIdSchema,
  personId: opaqueIdSchema,
  status: z.enum(['not_started', 'in_progress', 'ready']),
  completedSteps: z.array(orientationStepSchema),
  safeWordDisposition: z.enum(['unanswered', 'configured', 'informed_deferral']),
  needsAttention: z.boolean(),
  updatedAt: isoDateTimeSchema,
});

export const orientationResponseSchema = z.object({ orientation: orientationStateSchema });

export const completeOrientationStepRequestSchema = z
  .object({ complete: z.literal(true) })
  .strict();

export const safeWordRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('configure'), phrase: z.string().min(8).max(128) }).strict(),
  z.object({ action: z.literal('defer') }).strict(),
]);

export const entitlementResponseSchema = z.object({
  subject: z.object({ kind: z.enum(['person', 'household']), id: opaqueIdSchema }),
  capabilities: z.array(capabilitySchema),
  grants: z.array(
    z.object({
      id: opaqueIdSchema,
      source: z.enum(['local', 'web', 'apple', 'google', 'sponsor', 'support']),
      startsAt: isoDateTimeSchema,
      endsAt: isoDateTimeSchema.optional(),
      sourceVerified: z.boolean(),
      planVersionId: opaqueIdSchema,
      subscriptionId: opaqueIdSchema,
      effective: z.boolean(),
    }),
  ),
  commerce: z.object({
    accessState: z.enum(['effective', 'no_effective_context']),
    primary: z
      .object({
        subscriptionId: opaqueIdSchema,
        source: z.enum(['local', 'web', 'apple', 'google', 'sponsor', 'support']),
        lifecycle: z.enum([
          'pending',
          'trialing',
          'active',
          'grace',
          'delinquent',
          'paused',
          'hold',
          'cancel_at_period_end',
          'canceled',
          'expired',
          'refunded',
          'disputed',
          'restored',
        ]),
        precedence: z.number().int().nonnegative(),
        sourceVerified: z.boolean(),
        reconciliationState: z.enum(['not_required', 'pending', 'reconciled', 'attention']),
        startsAt: isoDateTimeSchema,
        accessEndsAt: isoDateTimeSchema.optional(),
        plan: z.object({
          id: opaqueIdSchema,
          key: z.enum(['free', 'plus', 'family']),
          version: z.number().int().positive(),
          displayName: z.string().min(1).max(80),
          state: z.enum(['hypothesis', 'active', 'retired']),
          prices: z.array(
            z.object({
              interval: z.enum(['month', 'year']),
              amountMinor: z.number().int().nonnegative(),
              currency: z.literal('USD'),
              kind: z.enum(['list', 'founding_experiment']),
            }),
          ),
        }),
      })
      .nullable(),
    sources: z.array(
      z.object({
        subscriptionId: opaqueIdSchema,
        planVersionId: opaqueIdSchema,
        planKey: z.enum(['free', 'plus', 'family']),
        planVersion: z.number().int().positive(),
        source: z.enum(['local', 'web', 'apple', 'google', 'sponsor', 'support']),
        lifecycle: z.enum([
          'pending',
          'trialing',
          'active',
          'grace',
          'delinquent',
          'paused',
          'hold',
          'cancel_at_period_end',
          'canceled',
          'expired',
          'refunded',
          'disputed',
          'restored',
        ]),
        precedence: z.number().int().nonnegative(),
        accessState: z.enum([
          'effective',
          'invalid_linkage',
          'unverified_source',
          'not_started',
          'expired',
          'inactive_lifecycle',
          'no_effective_grant',
        ]),
        contributingGrantIds: z.array(opaqueIdSchema),
      }),
    ),
    allowances: z.array(
      z.object({
        kind: z.enum(['protected_members', 'trusted_circle_participants']),
        limit: z.number().int().nonnegative(),
        used: z.number().int().nonnegative().nullable(),
        remaining: z.number().int().nonnegative(),
        state: z.enum(['available', 'exhausted', 'usage_unknown', 'entitlement_inactive']),
        sourceSubscriptionId: opaqueIdSchema,
        sourcePlanVersionId: opaqueIdSchema,
      }),
    ),
    mode: z.enum(['local_mock', 'canonical']),
    hypothesis: z.boolean(),
  }),
  environment: z.enum(['development', 'test', 'production']),
});

export type OrientationStateDto = z.infer<typeof orientationStateSchema>;
export type CompleteOrientationStepRequest = z.infer<typeof completeOrientationStepRequestSchema>;
export type SafeWordRequest = z.infer<typeof safeWordRequestSchema>;
export type EntitlementResponse = z.infer<typeof entitlementResponseSchema>;

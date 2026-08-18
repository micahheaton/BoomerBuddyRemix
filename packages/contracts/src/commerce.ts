import { z } from 'zod';
import { isoDateTimeSchema, opaqueIdSchema } from './common';

export const stripeCheckoutRequestSchema = z.object({
  offerId: z.literal('founding_family_monthly_v1'),
});

export const stripeCheckoutResponseSchema = z.object({
  checkout: z.object({
    provider: z.literal('stripe'),
    environment: z.enum(['test', 'production']),
    sessionId: z.string().regex(/^cs_(?:test|live)_[A-Za-z0-9_]+$/u),
    url: z.string().url().startsWith('https://'),
    canonicalSubscriptionId: opaqueIdSchema,
    expiresAt: isoDateTimeSchema.optional(),
  }),
  limitation: z.literal(
    'A Checkout redirect is not access. Access remains pending exact completed-session and paid-invoice evidence.',
  ),
});

export const stripePortalResponseSchema = z.object({
  portal: z.object({
    provider: z.literal('stripe'),
    environment: z.enum(['test', 'production']),
    sessionId: z.string(),
    url: z.string().url().startsWith('https://'),
    expiresAt: isoDateTimeSchema.optional(),
  }),
  limitation: z.literal(
    'The portal changes provider state only; canonical access reconciles separately.',
  ),
});

export const stripeBillingStatusResponseSchema = z.object({
  billing: z.object({
    householdId: opaqueIdSchema,
    offerId: z.literal('founding_family_monthly_v1'),
    checkoutState: z.enum([
      'unavailable',
      'eligible_disabled',
      'ready',
      'pending_provider',
      'awaiting_payment_evidence',
      'active',
      'restricted',
    ]),
    canonicalAccessActive: z.boolean(),
    portalAvailable: z.boolean(),
    runtimeInitiationEnabled: z.boolean(),
    pendingOperation: z
      .object({
        serverOperationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{15,159}$/u),
        state: z.enum(['dispatching', 'outcome_unknown']),
        attemptCount: z.number().int().positive(),
        nextRetryAt: isoDateTimeSchema.optional(),
        expiresAt: isoDateTimeSchema.optional(),
      })
      .optional(),
  }),
  evidenceNotice: z.literal(
    'Success redirects and provider status snapshots do not grant BoomerBuddy access.',
  ),
});

export const stripeInitiationControlRequestSchema = z.object({
  environment: z.enum(['test', 'production']),
  nextState: z.enum(['enabled', 'disabled']),
  reasonCode: z.enum([
    'founder_test_activation',
    'founder_live_activation',
    'founder_disable',
    'incident_stop',
    'configuration_change',
  ]),
  expectedRevision: z.number().int().min(0),
  correlationId: opaqueIdSchema,
});

export const stripeInitiationControlQuerySchema = z.object({
  environment: z.enum(['test', 'production']),
});

export const stripeInitiationControlProjectionSchema = z.object({
  environment: z.enum(['test', 'production']),
  state: z.enum(['absent', 'enabled', 'disabled']),
  revision: z.number().int().min(0),
  changedAt: isoDateTimeSchema.optional(),
  reasonCode: z
    .enum([
      'founder_test_activation',
      'founder_live_activation',
      'founder_disable',
      'incident_stop',
      'configuration_change',
    ])
    .optional(),
  liveEnableAvailable: z.literal(false),
});

export const stripeHouseholdEligibilityRequestSchema = z.object({
  householdId: opaqueIdSchema,
  environment: z.enum(['test', 'production']),
  nextState: z.enum(['eligible', 'revoked']),
  correlationId: opaqueIdSchema,
});

export const stripeControlResponseSchema = z.object({
  environment: z.enum(['test', 'production']).optional(),
  householdId: opaqueIdSchema.optional(),
  state: z.enum(['enabled', 'disabled', 'eligible', 'revoked']),
  revision: z.number().int().positive().optional(),
  recordedAt: isoDateTimeSchema,
});

export const stripeReconciliationRepairQuerySchema = z.object({
  reconciliationRunId: opaqueIdSchema,
});

export const stripeReconciliationRepairRequestSchema = z.object({
  reconciliationRunId: opaqueIdSchema,
  expectedRevision: z.literal(0),
  reasonCode: z.literal('founder_bounded_provider_repair'),
  correlationId: opaqueIdSchema,
});

export const stripeReconciliationRepairProjectionSchema = z.object({
  reconciliationRunId: opaqueIdSchema,
  inboxId: opaqueIdSchema,
  environment: z.literal('test'),
  state: z.enum(['queued', 'running', 'completed', 'attention', 'failed']),
  failureCode: z.string().min(1).max(160).optional(),
  automaticAttemptCount: z.number().int().min(0).max(16),
  authorizedAttemptLimit: z.number().int().min(12).max(16),
  revision: z.number().int().min(0).max(1),
  repairAvailable: z.boolean(),
});

export const stripeReconciliationRepairResponseSchema = z.object({
  reconciliationRunId: opaqueIdSchema,
  inboxId: opaqueIdSchema,
  environment: z.literal('test'),
  revision: z.literal(1),
  authorizedAttemptLimit: z.literal(16),
  repairJobId: opaqueIdSchema,
  duplicate: z.boolean(),
  recordedAt: isoDateTimeSchema,
});

const stripeServerOperationIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{15,159}$/u);

export const stripeSessionRetryRepairQuerySchema = z.object({
  householdId: opaqueIdSchema,
  serverOperationId: stripeServerOperationIdSchema,
});

export const stripeSessionRetryRepairRequestSchema = z.object({
  householdId: opaqueIdSchema,
  serverOperationId: stripeServerOperationIdSchema,
  expectedRevision: z.literal(0),
  reasonCode: z.literal('founder_bounded_same_key_retry'),
  correlationId: opaqueIdSchema,
});

export const stripeSessionRetryRepairProjectionSchema = z.object({
  operationId: opaqueIdSchema,
  householdId: opaqueIdSchema,
  serverOperationId: stripeServerOperationIdSchema,
  environment: z.literal('test'),
  action: z.literal('checkout'),
  state: z.enum(['prepared', 'dispatching', 'outcome_unknown', 'succeeded', 'failed_no_effect']),
  attemptCount: z.number().int().min(0).max(7),
  authorizedAttemptLimit: z.number().int().min(6).max(7),
  revision: z.number().int().min(0).max(1),
  providerDeadline: isoDateTimeSchema,
  attentionState: z.enum(['open', 'snoozed', 'absent']),
  repairAvailable: z.boolean(),
});

export const stripeSessionRetryRepairResponseSchema = z.object({
  operationId: opaqueIdSchema,
  householdId: opaqueIdSchema,
  serverOperationId: stripeServerOperationIdSchema,
  environment: z.literal('test'),
  action: z.literal('checkout'),
  revision: z.literal(1),
  authorizedAttemptLimit: z.literal(7),
  repairJobId: opaqueIdSchema,
  duplicate: z.boolean(),
  recordedAt: isoDateTimeSchema,
});

export const stripeWebhookResponseSchema = z.object({
  received: z.literal(true),
  duplicate: z.boolean(),
  application: z.enum(['applied', 'superseded', 'quarantined', 'reconciliation_queued']),
});

export type StripeCheckoutRequest = z.infer<typeof stripeCheckoutRequestSchema>;
export type StripeCheckoutResponse = z.infer<typeof stripeCheckoutResponseSchema>;
export type StripePortalResponse = z.infer<typeof stripePortalResponseSchema>;
export type StripeBillingStatusResponse = z.infer<typeof stripeBillingStatusResponseSchema>;

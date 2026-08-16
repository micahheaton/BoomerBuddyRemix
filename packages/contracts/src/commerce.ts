import { z } from 'zod';
import { isoDateTimeSchema, opaqueIdSchema } from './common';

export const stripeCheckoutRequestSchema = z.object({
  planVersionId: z.enum(['plus_v1', 'family_v1']),
  billingInterval: z.enum(['month', 'year']),
});

export const stripeCheckoutResponseSchema = z.object({
  checkout: z.object({
    provider: z.literal('stripe'),
    environment: z.literal('test'),
    sessionId: z.string().regex(/^cs_test_[A-Za-z0-9_]+$/u),
    url: z.string().url().startsWith('https://'),
    canonicalSubscriptionId: opaqueIdSchema,
    expiresAt: isoDateTimeSchema.optional(),
  }),
  limitation: z.literal('Stripe test mode only; no real charge occurred.'),
});

export const stripePortalResponseSchema = z.object({
  portal: z.object({
    provider: z.literal('stripe'),
    environment: z.literal('test'),
    sessionId: z.string(),
    url: z.string().url().startsWith('https://'),
    expiresAt: isoDateTimeSchema.optional(),
  }),
  limitation: z.literal('Stripe test mode only; no production billing is enabled.'),
});

export const stripeWebhookResponseSchema = z.object({
  received: z.literal(true),
  duplicate: z.boolean(),
  application: z.enum(['applied', 'superseded', 'quarantined', 'reconciliation_queued']),
});

export type StripeCheckoutRequest = z.infer<typeof stripeCheckoutRequestSchema>;

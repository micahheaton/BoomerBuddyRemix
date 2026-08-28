import { z } from 'zod';
import { isoDateTimeSchema } from './common';

export const accessIntentPurposeSchema = z.literal('private_beta_access_request');
export const accessIntentAttributionSourceSchema = z.enum([
  'direct',
  'organic',
  'partner',
  'campaign',
]);
export const accessIntentAttributionCampaignSchema = z.enum([
  'none',
  'launch_2026',
  'trusted_partner',
]);

export const accessIntentAttributionSchema = z
  .object({
    source: accessIntentAttributionSourceSchema,
    campaign: accessIntentAttributionCampaignSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const allowed =
      (value.source === 'direct' && value.campaign === 'none') ||
      (value.source === 'organic' && value.campaign === 'none') ||
      (value.source === 'partner' && value.campaign === 'trusted_partner') ||
      (value.source === 'campaign' && value.campaign === 'launch_2026');
    if (!allowed) {
      context.addIssue({
        code: 'custom',
        message: 'Access-intent attribution is not recognized',
      });
    }
  });

export const accessIntentReceiptCodeSchema = z
  .string()
  .regex(/^access_intent_[A-Za-z0-9_-]{32}$/u)
  .max(64);

export const accessIntentOperationKeySchema = z
  .string()
  .regex(
    /^access-intent:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    'Expected an access-intent-scoped UUID idempotency key',
  );

export const createAccessIntentRequestSchema = z
  .object({
    purpose: accessIntentPurposeSchema,
    attribution: accessIntentAttributionSchema,
  })
  .strict();

export const accessIntentLifecycleSchema = z.enum(['intent_created', 'expired']);

export const createAccessIntentResponseSchema = z
  .object({
    intent: z
      .object({
        receiptCode: accessIntentReceiptCodeSchema,
        purpose: accessIntentPurposeSchema,
        attribution: accessIntentAttributionSchema,
        lifecycle: z.literal('intent_created'),
        outboundMessage: z.literal('not_sent'),
        createdAt: isoDateTimeSchema,
        expiresAt: isoDateTimeSchema,
      })
      .strict(),
  })
  .strict();

export const hqAccessIntentResponseSchema = z
  .object({
    projection: z.literal('content_free_access_intents'),
    intents: z.array(
      z
        .object({
          receiptCode: accessIntentReceiptCodeSchema,
          purpose: accessIntentPurposeSchema,
          attribution: accessIntentAttributionSchema,
          lifecycle: accessIntentLifecycleSchema,
          createdAt: isoDateTimeSchema,
          expiresAt: isoDateTimeSchema,
        })
        .strict(),
    ),
    truncated: z.boolean(),
  })
  .strict();

export type AccessIntentAttribution = z.infer<typeof accessIntentAttributionSchema>;
export type CreateAccessIntentRequest = z.infer<typeof createAccessIntentRequestSchema>;
export type CreateAccessIntentResponse = z.infer<typeof createAccessIntentResponseSchema>;
export type HqAccessIntentResponse = z.infer<typeof hqAccessIntentResponseSchema>;

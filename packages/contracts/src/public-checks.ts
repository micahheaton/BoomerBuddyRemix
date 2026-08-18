import { z } from 'zod';
import { checkKindSchema, evidenceSufficiencySchema, riskSchema, safeActionSchema } from './checks';
import { isoDateTimeSchema, opaqueIdSchema } from './common';

const boundedContent = (maximumCharacters: number, maximumBytes: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximumCharacters)
    .refine((value) => new TextEncoder().encode(value).byteLength <= maximumBytes, {
      message: `Content must be at most ${maximumBytes} UTF-8 bytes`,
    });

export const publicAttributionSourceSchema = z.enum(['direct', 'organic', 'partner', 'campaign']);
export const publicAttributionCampaignSchema = z.enum(['none', 'launch_2026', 'trusted_partner']);
export const publicCheckContextTokenSchema = z
  .string()
  .regex(/^public_context_[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{32,}$/u)
  .max(256);
export const publicCheckContinuityProofSchema = z
  .string()
  .regex(/^public_continuity_[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{32,}$/u)
  .max(256);
export const publicCheckConversionTokenSchema = z
  .string()
  .regex(/^public_result_[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{32,}$/u)
  .max(256);

export const createPublicCheckContextRequestSchema = z
  .object({
    attribution: z
      .object({
        source: publicAttributionSourceSchema,
        campaign: publicAttributionCampaignSchema.default('none'),
      })
      .strict()
      .default({ source: 'direct', campaign: 'none' }),
  })
  .strict();

export const createPublicCheckContextResponseSchema = z.object({
  context: z.object({
    token: publicCheckContextTokenSchema,
    continuityProof: publicCheckContinuityProofSchema,
    expiresAt: isoDateTimeSchema,
    remainingChecks: z.number().int().min(1).max(3),
  }),
});

export const createPublicCheckRequestSchema = z.discriminatedUnion('kind', [
  z
    .object({
      contextToken: publicCheckContextTokenSchema,
      continuityProof: publicCheckContinuityProofSchema.optional(),
      kind: z.literal('text'),
      content: boundedContent(20_000, 16_384),
    })
    .strict(),
  z
    .object({
      contextToken: publicCheckContextTokenSchema,
      continuityProof: publicCheckContinuityProofSchema.optional(),
      kind: z.literal('url'),
      content: boundedContent(2_048, 4_096),
    })
    .strict(),
]);

export const publicInputSafetySchema = z.object({
  redactions: z
    .array(
      z.object({
        class: z.enum(['payment_card', 'authorization_credential', 'one_time_code']),
        placeholder: z.enum(['[PAYMENT_CARD]', '[AUTH_CREDENTIAL]', '[ONE_TIME_CODE]']),
        count: z.number().int().positive().max(100),
      }),
    )
    .max(10),
  flags: z
    .array(
      z.enum([
        'contained_payment_card',
        'contained_authorization_credential',
        'contained_one_time_code',
      ]),
    )
    .max(3),
});

export const createPublicCheckResponseSchema = z.object({
  result: z.object({
    id: opaqueIdSchema,
    kind: checkKindSchema,
    risk: riskSchema,
    evidenceSufficiency: evidenceSufficiencySchema,
    calibration: z.literal('not_calibrated'),
    summary: z.string().min(1).max(1_000),
    actions: z.array(safeActionSchema).max(20),
    inputSafety: publicInputSafetySchema,
    expiresAt: isoDateTimeSchema,
    conversionGrant: z.object({
      token: publicCheckConversionTokenSchema,
      expiresAt: isoDateTimeSchema,
      semanticsVersion: z.literal('single-success-retry-v1'),
      singleSuccessfulConversion: z.literal(true),
      retryableWithSameCredentialOwnerAndConsent: z.literal(true),
      // Compatibility alias: this means one owned Check, not one HTTP attempt.
      oneTime: z.literal(true),
    }),
  }),
});

export const publicCheckResultParamsSchema = z.object({ resultId: opaqueIdSchema }).strict();
export const savePublicCheckRequestSchema = z
  .object({
    conversionToken: publicCheckConversionTokenSchema,
    saveConsent: z.literal(true),
    consentVersion: z.literal('public-check-save-v1'),
  })
  .strict();

export type CreatePublicCheckContextRequest = z.infer<typeof createPublicCheckContextRequestSchema>;
export type CreatePublicCheckRequest = z.infer<typeof createPublicCheckRequestSchema>;
export type SavePublicCheckRequest = z.infer<typeof savePublicCheckRequestSchema>;

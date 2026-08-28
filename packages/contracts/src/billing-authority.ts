import { z } from 'zod';

import { isoDateTimeSchema, opaqueIdSchema } from './common';

export const billingAuthorityActionSchema = z.enum(['grant', 'revoke']);
export const billingAuthorityStatusSchema = z.enum(['absent', 'active', 'suspended', 'revoked']);
export const billingAuthorityReasonCodeSchema = z.enum([
  'customer_billing_consent_verified',
  'customer_billing_consent_withdrawn',
  'operator_correction',
  'security_response',
]);

export const billingAuthorityOperationKeySchema = z
  .string()
  .regex(/^billing-authority:(grant|revoke):[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/u);

export const billingAuthorityHouseholdParamsSchema = z
  .object({ householdId: opaqueIdSchema })
  .strict();

export const billingAuthorityTargetParamsSchema = z
  .object({ householdId: opaqueIdSchema, personId: opaqueIdSchema })
  .strict();

export const billingAuthorityTransitionRequestSchema = z
  .object({
    action: billingAuthorityActionSchema,
    reasonCode: billingAuthorityReasonCodeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const valid =
      value.action === 'grant'
        ? ['customer_billing_consent_verified', 'operator_correction'].includes(value.reasonCode)
        : [
            'customer_billing_consent_withdrawn',
            'operator_correction',
            'security_response',
          ].includes(value.reasonCode);
    if (!valid) {
      context.addIssue({
        code: 'custom',
        path: ['reasonCode'],
        message: 'Reason code is not valid for the requested transition',
      });
    }
  });

const billingAuthorityEventSchema = z
  .object({
    id: opaqueIdSchema,
    operationKey: billingAuthorityOperationKeySchema,
    householdId: opaqueIdSchema,
    personId: opaqueIdSchema,
    action: billingAuthorityActionSchema,
    previousStatus: billingAuthorityStatusSchema,
    nextStatus: z.enum(['active', 'revoked']),
    actorPersonId: opaqueIdSchema,
    reasonCode: billingAuthorityReasonCodeSchema,
    occurredAt: isoDateTimeSchema,
  })
  .strict();

export const billingAuthorityHouseholdResponseSchema = z
  .object({
    authority: z.literal('configured_founder_active_internal_owner'),
    household: z.object({ id: opaqueIdSchema, name: z.string().min(1).max(160) }).strict(),
    members: z.array(
      z
        .object({
          personId: opaqueIdSchema,
          displayName: z.string().min(1).max(120),
          membershipStatus: z.enum(['active', 'revoked']),
          authorityStatus: billingAuthorityStatusSchema,
          grantedAt: isoDateTimeSchema.optional(),
          revokedAt: isoDateTimeSchema.optional(),
        })
        .strict(),
    ),
    events: z.array(billingAuthorityEventSchema).max(100),
    externalActionExecuted: z.literal(false),
  })
  .strict();

export const billingAuthorityTransitionResponseSchema = billingAuthorityEventSchema
  .extend({ reused: z.boolean(), externalActionExecuted: z.literal(false) })
  .strict();

export const billingAuthoritySelfConsentVersion = 'billing-authority-self-consent-v1' as const;
export const billingAuthoritySelfWithdrawalVersion =
  'billing-authority-self-withdrawal-v1' as const;

export const billingAuthoritySelfStatusResponseSchema = z
  .object({
    householdId: opaqueIdSchema,
    personId: opaqueIdSchema,
    administratorEligible: z.boolean(),
    authorityStatus: billingAuthorityStatusSchema,
    canAccept: z.boolean(),
    canRevoke: z.boolean(),
    revokeBlockedReason: z.literal('billing_operation_unsettled').optional(),
    documents: z
      .object({
        accept: z
          .object({
            version: z.literal(billingAuthoritySelfConsentVersion),
            digest: z.string().regex(/^[0-9a-f]{64}$/u),
            disclosure: z.string().min(1).max(2_000),
          })
          .strict(),
        revoke: z
          .object({
            version: z.literal(billingAuthoritySelfWithdrawalVersion),
            digest: z.string().regex(/^[0-9a-f]{64}$/u),
            disclosure: z.string().min(1).max(2_000),
          })
          .strict(),
      })
      .strict(),
    externalActionExecuted: z.literal(false),
  })
  .strict();

export const billingAuthoritySelfAcceptRequestSchema = z
  .object({
    documentVersion: z.literal(billingAuthoritySelfConsentVersion),
    documentDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    consentAccepted: z.literal(true),
  })
  .strict();

export const billingAuthoritySelfRevokeRequestSchema = z
  .object({
    documentVersion: z.literal(billingAuthoritySelfWithdrawalVersion),
    documentDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    withdrawalAcknowledged: z.literal(true),
  })
  .strict();

export const billingAuthoritySelfTransitionResponseSchema = billingAuthorityEventSchema
  .extend({ reused: z.boolean(), externalActionExecuted: z.literal(false) })
  .strict();

export type BillingAuthorityTransitionRequest = z.infer<
  typeof billingAuthorityTransitionRequestSchema
>;
export type BillingAuthorityHouseholdResponse = z.infer<
  typeof billingAuthorityHouseholdResponseSchema
>;
export type BillingAuthorityTransitionResponse = z.infer<
  typeof billingAuthorityTransitionResponseSchema
>;
export type BillingAuthoritySelfStatusResponse = z.infer<
  typeof billingAuthoritySelfStatusResponseSchema
>;

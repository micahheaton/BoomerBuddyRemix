import { z } from 'zod';
import {
  referralLedgerEntryKinds,
  referralProgramStates,
  referralProgramVariants,
  referralQualificationMilestones,
  referralRecipientEventKinds,
} from '../../domain/src/referral-credits';
import { isoDateTimeSchema, opaqueIdSchema } from './common';

const hmacSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/u, 'Expected a purpose-specific SHA-256 HMAC');
const stableKeySchema = z.string().regex(/^[a-z][a-z0-9_.-]{2,79}$/u);
const versionKeySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/u);
const positiveMinorUnitsSchema = z.number().int().safe().positive();
const nonnegativeMinorUnitsSchema = z.number().int().safe().nonnegative();

export const referralOperationKeySchema = z
  .string()
  .regex(
    /^referral:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    'Expected a referral-scoped UUID idempotency key',
  );

export const referralProgramDefinitionSchema = z
  .object({
    programKey: stableKeySchema,
    version: z.number().int().safe().positive(),
    state: z.enum(referralProgramStates),
    variant: z.enum(referralProgramVariants),
    effectiveAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
    qualificationMilestone: z.enum(referralQualificationMilestones),
    qualifiedCreditMinor: nonnegativeMinorUnitsSchema,
    paidCreditTotalMinor: nonnegativeMinorUnitsSchema,
    currency: z.literal('USD'),
    eligibleOfferKey: stableKeySchema,
    maximumParticipants: z.number().int().positive().max(10_000),
    maximumReferralsPerReferrer: z.number().int().positive().max(100),
    maximumCreditPerReferralMinor: positiveMinorUnitsSchema,
    maximumCreditPerReferrerMinor: positiveMinorUnitsSchema,
    maximumCreditPerHouseholdMinor: positiveMinorUnitsSchema,
    maximumProgramLiabilityMinor: positiveMinorUnitsSchema,
    attributionTtlSeconds: z
      .number()
      .int()
      .positive()
      .max(30 * 24 * 60 * 60),
    settlementHoldSeconds: z
      .number()
      .int()
      .nonnegative()
      .max(180 * 24 * 60 * 60),
    creditExpirySeconds: z
      .number()
      .int()
      .positive()
      .max(2 * 365 * 24 * 60 * 60),
    termsVersion: versionKeySchema,
    privacyVersion: versionKeySchema,
    externalActionEnabled: z.literal(false),
  })
  .strict()
  .superRefine((definition, context) => {
    const effectiveAt = new Date(definition.effectiveAt);
    const expiresAt = new Date(definition.expiresAt);
    if (expiresAt <= effectiveAt) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Program expiration must follow its effective instant',
      });
    }
    if (
      definition.paidCreditTotalMinor < definition.qualifiedCreditMinor ||
      definition.maximumCreditPerReferralMinor < definition.paidCreditTotalMinor ||
      definition.maximumCreditPerReferrerMinor < definition.maximumCreditPerReferralMinor ||
      definition.maximumCreditPerHouseholdMinor < definition.maximumCreditPerReferralMinor ||
      definition.maximumProgramLiabilityMinor < definition.maximumCreditPerHouseholdMinor
    ) {
      context.addIssue({
        code: 'custom',
        path: ['maximumProgramLiabilityMinor'],
        message: 'Referral credit caps must be cumulatively bounded',
      });
    }
  });

export const issueReferralSimulationRequestSchema = z
  .object({
    operationKey: referralOperationKeySchema,
    programKey: stableKeySchema,
    programVersion: z.number().int().positive(),
    simulation: z.literal(true),
  })
  .strict();

export const issueReferralServerCommandSchema = z
  .object({
    operationKey: referralOperationKeySchema,
    programKey: stableKeySchema,
    programVersion: z.number().int().positive(),
    referrerPersonId: opaqueIdSchema,
    referrerHouseholdId: opaqueIdSchema,
    canonicalPaymentIdentityHmac: hmacSchema.optional(),
    serverGenerated: z.literal(true),
    simulation: z.literal(true),
  })
  .strict();

const referralIssuanceResponseBase = {
  attributionId: opaqueIdSchema,
  expiresAt: isoDateTimeSchema,
  evidenceTier: z.literal('local_simulation'),
  programActive: z.literal(false),
  creditPromised: z.literal(false),
  messageSent: z.literal(false),
  providerCreditApplied: z.literal(false),
  externalActionExecuted: z.literal(false),
} as const;

export const issueReferralSimulationResponseSchema = z.discriminatedUnion('reused', [
  z
    .object({
      ...referralIssuanceResponseBase,
      attributionToken: hmacSchema,
      reused: z.literal(false),
    })
    .strict(),
  z.object({ ...referralIssuanceResponseBase, reused: z.literal(true) }).strict(),
]);

export const openReferralSimulationRequestSchema = z
  .object({
    operationKey: referralOperationKeySchema,
    attributionToken: hmacSchema,
    simulation: z.literal(true),
  })
  .strict();

export const openReferralServerCommandSchema = z
  .object({
    operationKey: referralOperationKeySchema,
    attributionToken: hmacSchema,
    serverEvidenceReference: opaqueIdSchema,
    serverEvidenceDigest: hmacSchema,
    serverGenerated: z.literal(true),
    simulation: z.literal(true),
  })
  .strict();

export const bindReferralSimulationRequestSchema = z
  .object({
    operationKey: referralOperationKeySchema,
    attributionToken: hmacSchema,
    termsVersion: versionKeySchema,
    privacyVersion: versionKeySchema,
    simulation: z.literal(true),
  })
  .strict();

export const bindReferralServerCommandSchema = z
  .object({
    operationKey: referralOperationKeySchema,
    attributionToken: hmacSchema,
    recipientPersonId: opaqueIdSchema,
    recipientHouseholdId: opaqueIdSchema,
    canonicalPaymentIdentityHmac: hmacSchema.optional(),
    termsVersion: versionKeySchema,
    privacyVersion: versionKeySchema,
    serverEvidenceReference: opaqueIdSchema,
    serverEvidenceDigest: hmacSchema,
    serverGenerated: z.literal(true),
    simulation: z.literal(true),
  })
  .strict();

export const referralRecipientEvidenceSchema = z
  .object({
    operationKey: referralOperationKeySchema,
    attributionId: opaqueIdSchema,
    eventKind: z.enum(referralRecipientEventKinds),
    serverEventReference: opaqueIdSchema,
    serverEventDigest: hmacSchema,
    serverGenerated: z.literal(true),
    occurredAt: isoDateTimeSchema,
    evidenceTier: z.literal('local_simulation'),
  })
  .strict();

export const referralFinancialEvidenceSchema = z
  .object({
    operationKey: referralOperationKeySchema,
    attributionId: opaqueIdSchema,
    eventKind: z.enum(['settlement', 'refund', 'dispute', 'cancellation', 'failed_payment']),
    parentFinancialEventId: opaqueIdSchema.optional(),
    subscriptionReferenceHmac: hmacSchema,
    invoiceReferenceHmac: hmacSchema,
    lineReferenceHmac: hmacSchema,
    canonicalOfferKey: stableKeySchema,
    currency: z.literal('USD'),
    principalMinor: positiveMinorUnitsSchema,
    sourceAuthenticated: z.literal(true),
    occurredAt: isoDateTimeSchema,
    evidenceTier: z.literal('local_simulation'),
    providerExecutionRequested: z.literal(false),
  })
  .strict()
  .superRefine((evidence, context) => {
    if ((evidence.eventKind === 'settlement') === (evidence.parentFinancialEventId !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['parentFinancialEventId'],
        message: 'Only post-settlement financial events require a settlement parent',
      });
    }
  });

export const referralLedgerEntrySchema = z
  .object({
    id: opaqueIdSchema,
    attributionId: opaqueIdSchema,
    programKey: stableKeySchema,
    programVersion: z.number().int().positive(),
    receivingPersonId: opaqueIdSchema,
    receivingHouseholdId: opaqueIdSchema,
    sequence: z.number().int().positive(),
    kind: z.enum(referralLedgerEntryKinds),
    amountMinor: positiveMinorUnitsSchema,
    currency: z.literal('USD'),
    canonicalOfferKey: stableKeySchema,
    reasonCode: stableKeySchema,
    sourceReference: opaqueIdSchema,
    sourceEvidenceDigest: hmacSchema,
    idempotencyKey: referralOperationKeySchema,
    availableAt: isoDateTimeSchema.optional(),
    expiresAt: isoDateTimeSchema.optional(),
    evidenceTier: z.literal('local_simulation'),
    providerCreditApplied: z.literal(false),
    externalActionExecuted: z.literal(false),
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const referralMutationResponseSchema = z
  .object({
    attributionId: opaqueIdSchema,
    state: z.enum(['opened', 'identity_bound', 'qualified', 'denied', 'financial_recorded']),
    ledgerEntries: z.array(referralLedgerEntrySchema).max(4),
    evidenceTier: z.literal('local_simulation'),
    programActive: z.literal(false),
    providerCreditApplied: z.literal(false),
    messageSent: z.literal(false),
    externalActionExecuted: z.literal(false),
    reused: z.boolean(),
  })
  .strict();

export const referralShareCapabilityResponseSchema = z
  .object({
    capabilities: z
      .array(
        z
          .object({
            mode: z.enum(['native_share_sheet', 'copy_link']),
            state: z.literal('integration_not_registered'),
            userInitiatedOnly: z.literal(true),
            contactPermissionRequested: z.literal(false),
            contactDataAccepted: z.literal(false),
            automaticSend: z.literal(false),
            shareEventRewardsCredit: z.literal(false),
            externalActionExecuted: z.literal(false),
          })
          .strict(),
      )
      .length(2),
    evidenceTier: z.literal('local_simulation'),
  })
  .strict();

export const referralHqQueueResponseSchema = z
  .object({
    projection: z.literal('content_free_disabled_referral_evidence'),
    referrals: z
      .array(
        z
          .object({
            attributionId: opaqueIdSchema,
            programKey: stableKeySchema,
            programVersion: z.number().int().positive(),
            programState: z.enum(referralProgramStates),
            attributionState: z.enum([
              'share_created',
              'opened',
              'identity_bound',
              'stopped',
              'expired',
            ]),
            qualificationState: z.enum(['not_evaluated', 'qualified', 'denied', 'held']),
            balanceMinor: z.number().int().nonnegative(),
            reservedGrossMinor: z.number().int().nonnegative(),
            earnedGrossMinor: z.number().int().nonnegative(),
            reversedGrossMinor: z.number().int().nonnegative(),
            issuedAt: isoDateTimeSchema,
            expiresAt: isoDateTimeSchema,
            evidenceTier: z.literal('local_simulation'),
            contentIncluded: z.literal(false),
            contactIncluded: z.literal(false),
            recipientIdentityIncluded: z.literal(false),
            paymentIdentityIncluded: z.literal(false),
            providerCreditApplied: z.literal(false),
            externalActionExecuted: z.literal(false),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export type ReferralProgramDefinitionRequest = z.infer<typeof referralProgramDefinitionSchema>;
export type IssueReferralSimulationRequest = z.infer<typeof issueReferralSimulationRequestSchema>;
export type IssueReferralServerCommand = z.infer<typeof issueReferralServerCommandSchema>;
export type BindReferralSimulationRequest = z.infer<typeof bindReferralSimulationRequestSchema>;
export type BindReferralServerCommand = z.infer<typeof bindReferralServerCommandSchema>;
export type OpenReferralServerCommand = z.infer<typeof openReferralServerCommandSchema>;
export type ReferralRecipientEvidence = z.infer<typeof referralRecipientEvidenceSchema>;
export type ReferralFinancialEvidence = z.infer<typeof referralFinancialEvidenceSchema>;
export type ReferralLedgerEntryDto = z.infer<typeof referralLedgerEntrySchema>;
export type ReferralHqQueueResponse = z.infer<typeof referralHqQueueResponseSchema>;

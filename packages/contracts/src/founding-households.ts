import {
  foundingHouseholdAccessAttentionCodes,
  foundingHouseholdBenefitKeys,
  foundingHouseholdEnrollmentStates,
  foundingHouseholdEnvironmentEvidenceTiers,
  foundingHouseholdEnvironments,
  foundingHouseholdFunnelEvidenceSources,
  foundingHouseholdFunnelStages,
  foundingHouseholdInvitationStates,
  foundingHouseholdPolicyStates,
  foundingHouseholdProtectedEnrollmentConsentVersion,
  foundingHouseholdServiceConsentVersions,
} from '@boomerbuddy/domain';
import { z } from 'zod';

import { isoDateTimeSchema, opaqueIdSchema } from './common';

export const foundingHouseholdBenefitKeySchema = z.enum(foundingHouseholdBenefitKeys);
export const foundingHouseholdEnvironmentSchema = z.enum(foundingHouseholdEnvironments);
export const foundingHouseholdEvidenceTierSchema = z.enum(
  Object.values(foundingHouseholdEnvironmentEvidenceTiers),
);
export const foundingHouseholdServiceConsentVersionSchema = z.enum(
  foundingHouseholdServiceConsentVersions,
);
export const foundingHouseholdPolicyStateSchema = z.enum(foundingHouseholdPolicyStates);
export const foundingHouseholdInvitationStateSchema = z.enum(foundingHouseholdInvitationStates);
export const foundingHouseholdEnrollmentStateSchema = z.enum(foundingHouseholdEnrollmentStates);
export const foundingHouseholdAccessAttentionCodeSchema = z.enum(
  foundingHouseholdAccessAttentionCodes,
);
export const foundingHouseholdFunnelStageSchema = z.enum(foundingHouseholdFunnelStages);
export const foundingHouseholdFunnelEvidenceSourceSchema = z.enum(
  foundingHouseholdFunnelEvidenceSources,
);

const uuidSuffix = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
export const foundingHouseholdOperationKeySchema = z
  .string()
  .regex(
    new RegExp(`^founding-(?:policy|invite|accept|invite-revoke|offboard):${uuidSuffix}$`, 'u'),
    'Expected an action-bound Founding Household UUID idempotency key',
  );

export const foundingHouseholdInvitationCredentialSchema = z
  .string()
  .min(48)
  .max(180)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}\.[A-Za-z0-9_-]{32,80}$/u);

const activePolicyConfigurationSchema = z
  .object({
    state: z.literal('active'),
    expectedRevision: z.number().int().positive(),
    benefitKey: foundingHouseholdBenefitKeySchema,
    maxHouseholds: z.number().int().min(1).max(25),
    invitationTtlDays: z.number().int().min(1).max(14),
    accessDurationDays: z.number().int().min(1).max(180),
    programEndsAt: isoDateTimeSchema,
  })
  .strict();

const disabledPolicyConfigurationSchema = z
  .object({
    state: z.literal('disabled'),
    expectedRevision: z.number().int().positive(),
  })
  .strict();

export const configureFoundingHouseholdPolicyRequestSchema = z.discriminatedUnion('state', [
  activePolicyConfigurationSchema,
  disabledPolicyConfigurationSchema,
]);

export const foundingHouseholdPolicySchema = z
  .object({
    revision: z.number().int().positive(),
    state: foundingHouseholdPolicyStateSchema,
    benefitKey: foundingHouseholdBenefitKeySchema.optional(),
    maxHouseholds: z.number().int().min(1).max(25).optional(),
    invitationTtlDays: z.number().int().min(1).max(14).optional(),
    accessDurationDays: z.number().int().min(1).max(180).optional(),
    programEndsAt: isoDateTimeSchema.optional(),
    changedAt: isoDateTimeSchema,
  })
  .strict();

export const foundingHouseholdCapacitySchema = z
  .object({
    maxHouseholds: z.number().int().nonnegative(),
    activeHouseholds: z.number().int().nonnegative(),
    attentionHouseholds: z.number().int().nonnegative(),
    committedHouseholds: z.number().int().nonnegative(),
    reservedInvitations: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
  })
  .strict();

export const foundingHouseholdInvitationSchema = z
  .object({
    id: opaqueIdSchema,
    environment: foundingHouseholdEnvironmentSchema,
    policyRevision: z.number().int().positive(),
    benefitKey: foundingHouseholdBenefitKeySchema,
    state: foundingHouseholdInvitationStateSchema,
    createdAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
    identityBindingState: z.enum(['development_unbound', 'verified_identity']),
    intendedCustomerSubject: z.string().min(1).max(200).optional(),
    householdId: opaqueIdSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const bound = value.identityBindingState === 'verified_identity';
    if (
      bound !== (value.intendedCustomerSubject !== undefined && value.householdId !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Verified invitations require an exact customer subject and household binding',
        path: ['identityBindingState'],
      });
    }
    if (value.environment === 'production' && !bound) {
      context.addIssue({
        code: 'custom',
        message: 'Production invitations require verified identity binding',
        path: ['identityBindingState'],
      });
    }
  });

export const foundingHouseholdFunnelMilestoneSchema = z
  .object({
    stage: foundingHouseholdFunnelStageSchema,
    state: z.enum(['observed', 'not_observed']),
    evidenceSource: foundingHouseholdFunnelEvidenceSourceSchema,
  })
  .strict();

export const foundingHouseholdEnrollmentSchema = z
  .object({
    id: opaqueIdSchema,
    environment: foundingHouseholdEnvironmentSchema,
    householdId: opaqueIdSchema,
    invitationId: opaqueIdSchema,
    benefitKey: foundingHouseholdBenefitKeySchema,
    state: foundingHouseholdEnrollmentStateSchema,
    ledgerState: z.enum(['active', 'revoked']),
    accessAttentionCode: foundingHouseholdAccessAttentionCodeSchema.optional(),
    serviceConsentState: z.enum([
      'proposed',
      'active',
      'deferred',
      'withdrawn',
      'relinquished',
      'suspended',
      'revoked',
      'expired',
      'missing',
    ]),
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema,
    effectiveEndsAt: isoDateTimeSchema,
    paymentState: z.literal('not_paid_sponsored_beta'),
    evidenceTier: foundingHouseholdEvidenceTierSchema,
    researchConsent: z.literal(false),
    marketingConsent: z.literal(false),
    followUpConsent: z.literal(false),
    funnel: z.array(foundingHouseholdFunnelMilestoneSchema).length(10),
  })
  .strict();

export const foundingHouseholdFounderConsoleResponseSchema = z
  .object({
    authority: z.literal('configured_founder_active_internal_owner'),
    environment: foundingHouseholdEnvironmentSchema,
    evidenceTier: foundingHouseholdEvidenceTierSchema,
    productionIdentityReady: z.boolean(),
    paymentCollected: z.literal(false),
    externalActionExecuted: z.literal(false),
    policy: foundingHouseholdPolicySchema,
    capacity: foundingHouseholdCapacitySchema,
    invitations: z.array(foundingHouseholdInvitationSchema),
    enrollments: z.array(foundingHouseholdEnrollmentSchema),
  })
  .strict();

export const configureFoundingHouseholdPolicyResponseSchema = z
  .object({
    policy: foundingHouseholdPolicySchema,
    reused: z.boolean(),
    invalidatedInvitationCount: z.number().int().nonnegative(),
    externalActionExecuted: z.literal(false),
  })
  .strict();

export const createFoundingHouseholdInvitationRequestSchema = z
  .object({
    intendedCustomerSubject: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9_-]+$/u)
      .optional(),
  })
  .strict();

export const createFoundingHouseholdInvitationResponseSchema = z
  .object({
    invitation: foundingHouseholdInvitationSchema,
    invitationCredential: foundingHouseholdInvitationCredentialSchema.optional(),
    credentialState: z.enum(['created_credential_returned', 'created_credential_unavailable']),
    reused: z.boolean(),
    credentialRecoverable: z.literal(false),
    delivery: z.literal('founder_manual_only'),
    externalActionExecuted: z.literal(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.credentialState === 'created_credential_returned' &&
      (value.invitationCredential === undefined || value.reused)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A newly returned invitation must include its one-time credential',
        path: ['invitationCredential'],
      });
    }
    if (
      value.credentialState === 'created_credential_unavailable' &&
      (value.invitationCredential !== undefined || !value.reused)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'An idempotent replay cannot recover the one-time credential',
        path: ['credentialState'],
      });
    }
  });

export const foundingHouseholdInvitationParamsSchema = z
  .object({ invitationId: opaqueIdSchema })
  .strict();

export const foundingHouseholdEnrollmentParamsSchema = z
  .object({ householdId: opaqueIdSchema })
  .strict();

export const foundingHouseholdInvitationPreviewRequestSchema = z
  .object({
    invitationCredential: foundingHouseholdInvitationCredentialSchema,
  })
  .strict();

export const foundingHouseholdInvitationPreviewResponseSchema = z
  .object({
    invitationId: opaqueIdSchema,
    householdId: opaqueIdSchema,
    benefit: z
      .object({
        key: foundingHouseholdBenefitKeySchema,
        displayName: z.string().min(1).max(80),
        protectedMemberLimit: z.number().int().min(1).max(3),
        trustedCircleLimit: z.number().int().min(2).max(6),
      })
      .strict(),
    invitationExpiresAt: isoDateTimeSchema,
    accessEndsAtIfAcceptedNow: isoDateTimeSchema,
    serviceConsentVersion: foundingHouseholdServiceConsentVersionSchema,
    serviceDisclosureText: z.string().min(1).max(4_000),
    serviceDisclosureDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    servicePolicyText: z.string().min(1).max(4_000),
    servicePolicyDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    protectedEnrollmentConsentVersion: z.literal(
      foundingHouseholdProtectedEnrollmentConsentVersion,
    ),
    protectedEnrollmentDisclosureText: z.string().min(1).max(2_000),
    protectedEnrollmentDisclosureDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    protectedEnrollmentPolicyText: z.string().min(1).max(2_000),
    protectedEnrollmentPolicyDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    researchConsentRequested: z.literal(false),
    marketingConsentRequested: z.literal(false),
    followUpConsentRequested: z.literal(false),
    paymentRequired: z.literal(false),
    evidenceTier: foundingHouseholdEvidenceTierSchema,
  })
  .strict();

export const acceptFoundingHouseholdInvitationRequestSchema = z
  .object({
    invitationCredential: foundingHouseholdInvitationCredentialSchema,
    serviceConsentVersion: foundingHouseholdServiceConsentVersionSchema,
    serviceDisclosureDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    servicePolicyDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    serviceConsentAccepted: z.literal(true),
    protectedEnrollmentConsentVersion: z.literal(
      foundingHouseholdProtectedEnrollmentConsentVersion,
    ),
    protectedEnrollmentDisclosureDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    protectedEnrollmentPolicyDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    protectedEnrollmentConsentAccepted: z.literal(true),
  })
  .strict();

export const acceptFoundingHouseholdInvitationResponseSchema = z
  .object({
    enrollment: foundingHouseholdEnrollmentSchema,
    protectedEnrollment: z.enum(['created', 'already_active']),
    reused: z.boolean(),
    paymentCollected: z.literal(false),
    externalActionExecuted: z.literal(false),
  })
  .strict();

export const revokeFoundingHouseholdInvitationResponseSchema = z
  .object({
    invitation: foundingHouseholdInvitationSchema,
    reused: z.boolean(),
    externalActionExecuted: z.literal(false),
  })
  .strict();

export const offboardFoundingHouseholdResponseSchema = z
  .object({
    enrollment: foundingHouseholdEnrollmentSchema,
    reason: z.enum(['founder_revoked', 'household_withdrew']),
    reused: z.boolean(),
    unrelatedGrantsChanged: z.literal(false),
    reboundProtectedAllocations: z.number().int().nonnegative(),
    reboundTrustedCircleAllocations: z.number().int().nonnegative(),
    externalActionExecuted: z.literal(false),
  })
  .strict();

export const foundingHouseholdMemberStatusResponseSchema = z
  .object({
    enrollment: foundingHouseholdEnrollmentSchema.nullable(),
    environment: foundingHouseholdEnvironmentSchema,
    productionIdentityReady: z.boolean(),
    evidenceTier: foundingHouseholdEvidenceTierSchema,
  })
  .strict();

export type ConfigureFoundingHouseholdPolicyRequest = z.infer<
  typeof configureFoundingHouseholdPolicyRequestSchema
>;
export type CreateFoundingHouseholdInvitationRequest = z.infer<
  typeof createFoundingHouseholdInvitationRequestSchema
>;
export type FoundingHouseholdFounderConsoleResponse = z.infer<
  typeof foundingHouseholdFounderConsoleResponseSchema
>;
export type FoundingHouseholdEnrollmentDto = z.infer<typeof foundingHouseholdEnrollmentSchema>;
export type FoundingHouseholdPolicyDto = z.infer<typeof foundingHouseholdPolicySchema>;
export type FoundingHouseholdInvitationDto = z.infer<typeof foundingHouseholdInvitationSchema>;
export type ConfigureFoundingHouseholdPolicyResponse = z.infer<
  typeof configureFoundingHouseholdPolicyResponseSchema
>;
export type CreateFoundingHouseholdInvitationResponse = z.infer<
  typeof createFoundingHouseholdInvitationResponseSchema
>;
export type FoundingHouseholdInvitationPreviewResponse = z.infer<
  typeof foundingHouseholdInvitationPreviewResponseSchema
>;
export type AcceptFoundingHouseholdInvitationResponse = z.infer<
  typeof acceptFoundingHouseholdInvitationResponseSchema
>;
export type RevokeFoundingHouseholdInvitationResponse = z.infer<
  typeof revokeFoundingHouseholdInvitationResponseSchema
>;
export type OffboardFoundingHouseholdResponse = z.infer<
  typeof offboardFoundingHouseholdResponseSchema
>;
export type FoundingHouseholdMemberStatusResponse = z.infer<
  typeof foundingHouseholdMemberStatusResponseSchema
>;

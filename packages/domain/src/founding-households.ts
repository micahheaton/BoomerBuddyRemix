import { DomainError } from './errors';

export const foundingHouseholdCohortKey = 'run3_sponsored_founding_household_v1' as const;

/** Legacy alias retained for local Run 3 evidence. */
export const foundingHouseholdEvidenceTier = 'local_simulation' as const;

export const foundingHouseholdEnvironments = ['local', 'staging', 'production'] as const;
export type FoundingHouseholdEnvironment = (typeof foundingHouseholdEnvironments)[number];

export const foundingHouseholdEnvironmentEvidenceTiers = Object.freeze({
  local: 'local_simulation',
  staging: 'deployed_staging',
  production: 'live_production',
} as const);
export type FoundingHouseholdEvidenceTier =
  (typeof foundingHouseholdEnvironmentEvidenceTiers)[FoundingHouseholdEnvironment];

export function foundingHouseholdEvidenceTierForEnvironment(
  environment: FoundingHouseholdEnvironment,
): FoundingHouseholdEvidenceTier {
  return foundingHouseholdEnvironmentEvidenceTiers[environment];
}

/** The v1 wording remains immutable evidence for local Run 3 enrollments. */
export const foundingHouseholdServiceConsentVersion = 'founding-household-service-beta-v1' as const;
export const foundingHouseholdProductionServiceConsentVersion =
  'founding-household-service-beta-v2' as const;
export const foundingHouseholdServiceConsentVersions = [
  foundingHouseholdServiceConsentVersion,
  foundingHouseholdProductionServiceConsentVersion,
] as const;
export type FoundingHouseholdServiceConsentVersion =
  (typeof foundingHouseholdServiceConsentVersions)[number];
export const foundingHouseholdProtectedEnrollmentConsentVersion =
  'founding-household-protected-self-v1' as const;

export const foundingHouseholdBenefitKeys = ['plus_beta_v1', 'family_beta_v1'] as const;
export type FoundingHouseholdBenefitKey = (typeof foundingHouseholdBenefitKeys)[number];

export interface FoundingHouseholdBenefitProfile {
  readonly key: FoundingHouseholdBenefitKey;
  readonly displayName: string;
  readonly planVersionId: 'founding_plus_beta_v2' | 'founding_family_beta_v2';
  readonly protectedMemberLimit: 1 | 3;
  readonly trustedCircleLimit: 2 | 6;
  readonly capabilities: readonly [
    'check:text',
    'check:url',
    'history:read',
    'family:manage',
    'orientation:use',
  ];
  readonly price: {
    readonly interval: 'month';
    readonly amountMinor: 0;
    readonly currency: 'USD';
    readonly kind: 'founding_experiment';
  };
}

const foundingCapabilities = Object.freeze([
  'check:text',
  'check:url',
  'history:read',
  'family:manage',
  'orientation:use',
] as const);

const foundingExperimentPrice = Object.freeze({
  interval: 'month',
  amountMinor: 0,
  currency: 'USD',
  kind: 'founding_experiment',
} as const);

export const foundingHouseholdBenefitProfiles = Object.freeze({
  plus_beta_v1: Object.freeze({
    key: 'plus_beta_v1',
    displayName: 'Founding Plus beta',
    planVersionId: 'founding_plus_beta_v2',
    protectedMemberLimit: 1,
    trustedCircleLimit: 2,
    capabilities: foundingCapabilities,
    price: foundingExperimentPrice,
  }),
  family_beta_v1: Object.freeze({
    key: 'family_beta_v1',
    displayName: 'Founding Family beta',
    planVersionId: 'founding_family_beta_v2',
    protectedMemberLimit: 3,
    trustedCircleLimit: 6,
    capabilities: foundingCapabilities,
    price: foundingExperimentPrice,
  }),
} satisfies Record<FoundingHouseholdBenefitKey, FoundingHouseholdBenefitProfile>);

export const foundingHouseholdPolicyStates = ['disabled', 'active'] as const;
export type FoundingHouseholdPolicyState = (typeof foundingHouseholdPolicyStates)[number];

export const foundingHouseholdInvitationStates = [
  'pending',
  'accepted',
  'expired',
  'revoked',
  'superseded',
] as const;
export type FoundingHouseholdInvitationState = (typeof foundingHouseholdInvitationStates)[number];

export const foundingHouseholdEnrollmentStates = [
  'active',
  'attention',
  'expired',
  'revoked',
] as const;
export type FoundingHouseholdEnrollmentState = (typeof foundingHouseholdEnrollmentStates)[number];

export const foundingHouseholdAccessAttentionCodes = [
  'sponsor_backing_invalid',
  'subscription_invalid',
  'allocation_invalid',
  'grant_invalid',
  'service_consent_invalid',
] as const;
export type FoundingHouseholdAccessAttentionCode =
  (typeof foundingHouseholdAccessAttentionCodes)[number];

export const foundingHouseholdFunnelStages = [
  'account_ready',
  'founding_household_accepted',
  'orientation_ready',
  'first_check_completed',
  'result_comprehension_confirmed',
  'safe_next_action_confirmed',
  'trusted_circle_established',
  'service_value_confirmed',
  'feedback_submitted',
  'returned_later',
] as const;
export type FoundingHouseholdFunnelStage = (typeof foundingHouseholdFunnelStages)[number];

export const foundingHouseholdFunnelEvidenceSources = [
  'active_identity',
  'cohort_enrollment',
  'orientation_state',
  'completed_analysis',
  'trusted_circle_relationship',
  'feedback_record',
  'later_session',
  'not_implemented',
] as const;
export type FoundingHouseholdFunnelEvidenceSource =
  (typeof foundingHouseholdFunnelEvidenceSources)[number];

export interface ActiveFoundingHouseholdPolicyInput {
  readonly benefitKey: FoundingHouseholdBenefitKey;
  readonly maxHouseholds: number;
  readonly invitationTtlDays: number;
  readonly accessDurationDays: number;
  readonly programEndsAt: Date;
}

export const foundingHouseholdPolicyBounds = Object.freeze({
  maxHouseholds: Object.freeze({ min: 1, max: 25 }),
  invitationTtlDays: Object.freeze({ min: 1, max: 14 }),
  accessDurationDays: Object.freeze({ min: 1, max: 180 }),
  programHorizonDays: 180,
  returnAfterHours: 24,
});

/** A production policy may never reserve more than the deliberately tiny first cohort. */
export const foundingHouseholdProductionMaxHouseholds = 5 as const;

function boundedInteger(value: number, min: number, max: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new DomainError(
      'invalid_input',
      `${label} is outside the bounded Founding Household policy`,
    );
  }
}

export function assertActiveFoundingHouseholdPolicy(
  policy: ActiveFoundingHouseholdPolicyInput,
  now: Date,
  environment: FoundingHouseholdEnvironment = 'local',
): void {
  if (!foundingHouseholdBenefitKeys.includes(policy.benefitKey)) {
    throw new DomainError('invalid_input', 'Unknown Founding Household benefit profile');
  }
  boundedInteger(
    policy.maxHouseholds,
    foundingHouseholdPolicyBounds.maxHouseholds.min,
    foundingHouseholdPolicyBounds.maxHouseholds.max,
    'Cohort limit',
  );
  if (
    environment === 'production' &&
    policy.maxHouseholds > foundingHouseholdProductionMaxHouseholds
  ) {
    throw new DomainError(
      'invalid_input',
      `Production Founding Household cohort limit cannot exceed ${foundingHouseholdProductionMaxHouseholds}`,
    );
  }
  boundedInteger(
    policy.invitationTtlDays,
    foundingHouseholdPolicyBounds.invitationTtlDays.min,
    foundingHouseholdPolicyBounds.invitationTtlDays.max,
    'Invitation lifetime',
  );
  boundedInteger(
    policy.accessDurationDays,
    foundingHouseholdPolicyBounds.accessDurationDays.min,
    foundingHouseholdPolicyBounds.accessDurationDays.max,
    'Access duration',
  );
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(policy.programEndsAt.getTime())) {
    throw new DomainError('invalid_input', 'Founding Household policy timestamps are invalid');
  }
  const maximumEnd = new Date(
    now.getTime() + foundingHouseholdPolicyBounds.programHorizonDays * 24 * 60 * 60_000,
  );
  if (policy.programEndsAt <= now || policy.programEndsAt > maximumEnd) {
    throw new DomainError(
      'invalid_input',
      'Founding Household program end must be within the next 180 days',
    );
  }
}

export function foundingHouseholdInvitationEndsAt(
  now: Date,
  invitationTtlDays: number,
  programEndsAt: Date,
): Date {
  boundedInteger(
    invitationTtlDays,
    foundingHouseholdPolicyBounds.invitationTtlDays.min,
    foundingHouseholdPolicyBounds.invitationTtlDays.max,
    'Invitation lifetime',
  );
  return new Date(
    Math.min(now.getTime() + invitationTtlDays * 24 * 60 * 60_000, programEndsAt.getTime()),
  );
}

export function foundingHouseholdAccessEndsAt(
  acceptedAt: Date,
  accessDurationDays: number,
  programEndsAt: Date,
): Date {
  boundedInteger(
    accessDurationDays,
    foundingHouseholdPolicyBounds.accessDurationDays.min,
    foundingHouseholdPolicyBounds.accessDurationDays.max,
    'Access duration',
  );
  return new Date(
    Math.min(acceptedAt.getTime() + accessDurationDays * 24 * 60 * 60_000, programEndsAt.getTime()),
  );
}

export function effectiveFoundingHouseholdInvitationState(
  storedState: FoundingHouseholdInvitationState,
  expiresAt: Date,
  now: Date,
): FoundingHouseholdInvitationState {
  return storedState === 'pending' && expiresAt <= now ? 'expired' : storedState;
}

export function effectiveFoundingHouseholdEnrollmentState(
  storedState: Exclude<FoundingHouseholdEnrollmentState, 'expired'>,
  endsAt: Date,
  now: Date,
): FoundingHouseholdEnrollmentState {
  return storedState === 'active' && endsAt <= now ? 'expired' : storedState;
}

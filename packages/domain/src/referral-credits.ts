export const referralProgramStates = [
  'draft',
  'review_required',
  'approved_disabled',
  'stopped',
  'expired',
] as const;
export type ReferralProgramState = (typeof referralProgramStates)[number];

export const referralProgramVariants = [
  'one_then_three_total',
  'one_plus_three_incremental',
  'paid_only_three_total',
  'bounded_founding_benefit',
  'share_only_no_credit',
] as const;
export type ReferralProgramVariant = (typeof referralProgramVariants)[number];

export const referralQualificationMilestones = [
  'qualified_account',
  'trusted_circle_acceptance',
  'orientation_ready',
  'none',
] as const;
export type ReferralQualificationMilestone = (typeof referralQualificationMilestones)[number];

export const referralRecipientEventKinds = [
  'account_eligible',
  'trusted_circle_accepted',
  'orientation_ready',
] as const;
export type ReferralRecipientEventKind = (typeof referralRecipientEventKinds)[number];

export const referralLedgerEntryKinds = [
  'reserved',
  'earned',
  'expired',
  'reversed',
  'correction_debit',
  'correction_credit',
] as const;
export type ReferralLedgerEntryKind = (typeof referralLedgerEntryKinds)[number];

export interface ReferralShareCapabilityDefinition {
  readonly mode: 'native_share_sheet' | 'copy_link';
  readonly state: 'integration_not_registered';
  readonly userInitiatedOnly: true;
  readonly contactPermissionRequested: false;
  readonly contactDataAccepted: false;
  readonly automaticSend: false;
  readonly shareEventRewardsCredit: false;
  readonly externalActionExecuted: false;
}

export const referralShareCapabilityRegistry: readonly ReferralShareCapabilityDefinition[] = [
  {
    mode: 'native_share_sheet',
    state: 'integration_not_registered',
    userInitiatedOnly: true,
    contactPermissionRequested: false,
    contactDataAccepted: false,
    automaticSend: false,
    shareEventRewardsCredit: false,
    externalActionExecuted: false,
  },
  {
    mode: 'copy_link',
    state: 'integration_not_registered',
    userInitiatedOnly: true,
    contactPermissionRequested: false,
    contactDataAccepted: false,
    automaticSend: false,
    shareEventRewardsCredit: false,
    externalActionExecuted: false,
  },
] as const;

export interface ReferralProgramDefinition {
  readonly programKey: string;
  readonly version: number;
  readonly state: ReferralProgramState;
  readonly variant: ReferralProgramVariant;
  readonly effectiveAt: Date;
  readonly expiresAt: Date;
  readonly qualificationMilestone: ReferralQualificationMilestone;
  readonly qualifiedCreditMinor: number;
  readonly paidCreditTotalMinor: number;
  readonly currency: 'USD';
  readonly eligibleOfferKey: string;
  readonly maximumParticipants: number;
  readonly maximumReferralsPerReferrer: number;
  readonly maximumCreditPerReferralMinor: number;
  readonly maximumCreditPerReferrerMinor: number;
  readonly maximumCreditPerHouseholdMinor: number;
  readonly maximumProgramLiabilityMinor: number;
  readonly attributionTtlSeconds: number;
  readonly settlementHoldSeconds: number;
  readonly creditExpirySeconds: number;
  readonly termsVersion: string;
  readonly privacyVersion: string;
  readonly externalActionEnabled: false;
}

export type ReferralIdentityConflict =
  'same_person' | 'same_household' | 'same_payment_identity' | 'recipient_already_attributed';

const stableKey = /^[a-z][a-z0-9_.-]{2,79}$/u;
const versionKey = /^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/u;

function positiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function nonnegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function assertReferralProgramDefinition(definition: ReferralProgramDefinition): void {
  if (
    !stableKey.test(definition.programKey) ||
    !positiveSafeInteger(definition.version) ||
    !referralProgramStates.includes(definition.state) ||
    !referralProgramVariants.includes(definition.variant) ||
    !referralQualificationMilestones.includes(definition.qualificationMilestone) ||
    !Number.isFinite(definition.effectiveAt.getTime()) ||
    !Number.isFinite(definition.expiresAt.getTime()) ||
    definition.expiresAt <= definition.effectiveAt ||
    definition.currency !== 'USD' ||
    !stableKey.test(definition.eligibleOfferKey) ||
    !versionKey.test(definition.termsVersion) ||
    !versionKey.test(definition.privacyVersion) ||
    definition.externalActionEnabled !== false
  ) {
    throw new TypeError('Referral program definition is invalid or externally enabled');
  }

  const nonnegativeAmounts = [definition.qualifiedCreditMinor, definition.paidCreditTotalMinor];
  const positiveCaps = [
    definition.maximumParticipants,
    definition.maximumReferralsPerReferrer,
    definition.maximumCreditPerReferralMinor,
    definition.maximumCreditPerReferrerMinor,
    definition.maximumCreditPerHouseholdMinor,
    definition.maximumProgramLiabilityMinor,
    definition.attributionTtlSeconds,
    definition.creditExpirySeconds,
  ];
  if (
    nonnegativeAmounts.some((value) => !nonnegativeSafeInteger(value)) ||
    positiveCaps.some((value) => !positiveSafeInteger(value)) ||
    !nonnegativeSafeInteger(definition.settlementHoldSeconds) ||
    definition.attributionTtlSeconds > 30 * 24 * 60 * 60 ||
    definition.creditExpirySeconds > 2 * 365 * 24 * 60 * 60 ||
    definition.maximumReferralsPerReferrer > definition.maximumParticipants ||
    definition.paidCreditTotalMinor < definition.qualifiedCreditMinor ||
    definition.maximumCreditPerReferralMinor < definition.paidCreditTotalMinor ||
    definition.maximumCreditPerReferrerMinor < definition.maximumCreditPerReferralMinor ||
    definition.maximumCreditPerHouseholdMinor < definition.maximumCreditPerReferralMinor ||
    definition.maximumProgramLiabilityMinor < definition.maximumCreditPerHouseholdMinor
  ) {
    throw new TypeError('Referral program amounts, durations, or cumulative caps are invalid');
  }

  if (
    definition.variant === 'share_only_no_credit' &&
    (definition.qualificationMilestone !== 'none' ||
      definition.qualifiedCreditMinor !== 0 ||
      definition.paidCreditTotalMinor !== 0)
  ) {
    throw new TypeError('Share-only programs cannot promise referral credit');
  }
  if (
    definition.variant === 'paid_only_three_total' &&
    (definition.qualificationMilestone !== 'none' ||
      definition.qualifiedCreditMinor !== 0 ||
      definition.paidCreditTotalMinor === 0)
  ) {
    throw new TypeError('Paid-only programs cannot reserve qualification credit');
  }
  if (
    definition.variant === 'bounded_founding_benefit' &&
    definition.paidCreditTotalMinor !== definition.qualifiedCreditMinor
  ) {
    throw new TypeError('Founding benefits cannot automatically add paid credit');
  }
  if (
    ['one_then_three_total', 'one_plus_three_incremental'].includes(definition.variant) &&
    (definition.qualificationMilestone === 'none' ||
      definition.qualifiedCreditMinor === 0 ||
      definition.paidCreditTotalMinor <= definition.qualifiedCreditMinor)
  ) {
    throw new TypeError('Milestone-plus-paid variants require bounded increasing credit');
  }
}

export function referralIdentityConflict(input: {
  readonly referrerPersonId: string;
  readonly referrerHouseholdId: string;
  readonly referrerPaymentIdentityHmac?: string;
  readonly recipientPersonId: string;
  readonly recipientHouseholdId: string;
  readonly recipientPaymentIdentityHmac?: string;
  readonly recipientAlreadyAttributed: boolean;
}): ReferralIdentityConflict | undefined {
  if (input.referrerPersonId === input.recipientPersonId) return 'same_person';
  if (input.referrerHouseholdId === input.recipientHouseholdId) return 'same_household';
  if (
    input.referrerPaymentIdentityHmac !== undefined &&
    input.recipientPaymentIdentityHmac !== undefined &&
    input.referrerPaymentIdentityHmac === input.recipientPaymentIdentityHmac
  ) {
    return 'same_payment_identity';
  }
  if (input.recipientAlreadyAttributed) return 'recipient_already_attributed';
  return undefined;
}

const expectedRecipientEvent: Readonly<
  Record<Exclude<ReferralQualificationMilestone, 'none'>, ReferralRecipientEventKind>
> = {
  qualified_account: 'account_eligible',
  trusted_circle_acceptance: 'trusted_circle_accepted',
  orientation_ready: 'orientation_ready',
};

export interface ReferralQualificationDecision {
  readonly decision: 'qualified' | 'denied';
  readonly reasonCode:
    | 'exact_server_milestone'
    | 'program_has_no_qualification_credit'
    | 'identity_conflict'
    | 'wrong_server_milestone'
    | 'program_not_current';
}

export function decideReferralQualification(input: {
  readonly definition: ReferralProgramDefinition;
  readonly recipientEventKind: ReferralRecipientEventKind;
  readonly identityConflict?: ReferralIdentityConflict;
  readonly occurredAt: Date;
}): ReferralQualificationDecision {
  assertReferralProgramDefinition(input.definition);
  if (input.identityConflict !== undefined) {
    return { decision: 'denied', reasonCode: 'identity_conflict' };
  }
  if (
    input.occurredAt < input.definition.effectiveAt ||
    input.occurredAt >= input.definition.expiresAt ||
    input.definition.state === 'stopped' ||
    input.definition.state === 'expired'
  ) {
    return { decision: 'denied', reasonCode: 'program_not_current' };
  }
  if (input.definition.qualificationMilestone === 'none') {
    return { decision: 'denied', reasonCode: 'program_has_no_qualification_credit' };
  }
  if (
    expectedRecipientEvent[input.definition.qualificationMilestone] !== input.recipientEventKind
  ) {
    return { decision: 'denied', reasonCode: 'wrong_server_milestone' };
  }
  return { decision: 'qualified', reasonCode: 'exact_server_milestone' };
}

export function signedReferralLedgerAmount(
  kind: ReferralLedgerEntryKind,
  amountMinor: number,
): number {
  if (!positiveSafeInteger(amountMinor)) {
    throw new TypeError('Referral ledger amounts must be positive integer minor units');
  }
  return ['expired', 'reversed', 'correction_debit'].includes(kind) ? -amountMinor : amountMinor;
}

export function boundedSettlementCredit(input: {
  readonly paidCreditTotalMinor: number;
  readonly currentNetCreditMinor: number;
  readonly canonicalSettledPrincipalMinor: number;
}): number {
  if (
    !nonnegativeSafeInteger(input.paidCreditTotalMinor) ||
    !nonnegativeSafeInteger(input.currentNetCreditMinor) ||
    !nonnegativeSafeInteger(input.canonicalSettledPrincipalMinor)
  ) {
    throw new TypeError('Referral settlement arithmetic requires nonnegative minor units');
  }
  return Math.max(
    0,
    Math.min(
      input.paidCreditTotalMinor - input.currentNetCreditMinor,
      input.canonicalSettledPrincipalMinor,
    ),
  );
}

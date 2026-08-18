import { describe, expect, it } from 'vitest';
import {
  assertReferralProgramDefinition,
  boundedSettlementCredit,
  decideReferralQualification,
  referralIdentityConflict,
  referralShareCapabilityRegistry,
  signedReferralLedgerAmount,
  type ReferralProgramDefinition,
} from './referral-credits';

const definition = (
  overrides: Partial<ReferralProgramDefinition> = {},
): ReferralProgramDefinition => ({
  programKey: 'run3_referral_research',
  version: 1,
  state: 'approved_disabled',
  variant: 'one_then_three_total',
  effectiveAt: new Date('2026-08-01T00:00:00.000Z'),
  expiresAt: new Date('2026-09-01T00:00:00.000Z'),
  qualificationMilestone: 'qualified_account',
  qualifiedCreditMinor: 1_242,
  paidCreditTotalMinor: 3_725,
  currency: 'USD',
  eligibleOfferKey: 'family_annual',
  maximumParticipants: 25,
  maximumReferralsPerReferrer: 3,
  maximumCreditPerReferralMinor: 3_725,
  maximumCreditPerReferrerMinor: 11_175,
  maximumCreditPerHouseholdMinor: 11_175,
  maximumProgramLiabilityMinor: 93_125,
  attributionTtlSeconds: 7 * 24 * 60 * 60,
  settlementHoldSeconds: 14 * 24 * 60 * 60,
  creditExpirySeconds: 365 * 24 * 60 * 60,
  termsVersion: 'referral-terms-v1',
  privacyVersion: 'referral-privacy-v1',
  externalActionEnabled: false,
  ...overrides,
});

describe('disabled referral-credit domain', () => {
  it('accepts a bounded immutable candidate program and rejects external enablement or cap drift', () => {
    expect(() => assertReferralProgramDefinition(definition())).not.toThrow();
    expect(() =>
      assertReferralProgramDefinition({
        ...definition(),
        externalActionEnabled: true,
      } as unknown as ReferralProgramDefinition),
    ).toThrow(/externally enabled/iu);
    expect(() =>
      assertReferralProgramDefinition(definition({ maximumCreditPerReferralMinor: 1_000 })),
    ).toThrow(/cumulative caps/iu);
    expect(() =>
      assertReferralProgramDefinition(
        definition({
          variant: 'share_only_no_credit',
          qualificationMilestone: 'qualified_account',
        }),
      ),
    ).toThrow(/cannot promise/iu);
  });

  it('fails self, household, payment, and already-attributed identities deterministically', () => {
    const base = {
      referrerPersonId: 'person-a',
      referrerHouseholdId: 'household-a',
      referrerPaymentIdentityHmac: 'payment-a',
      recipientPersonId: 'person-b',
      recipientHouseholdId: 'household-b',
      recipientPaymentIdentityHmac: 'payment-b',
      recipientAlreadyAttributed: false,
    };
    expect(referralIdentityConflict(base)).toBeUndefined();
    expect(referralIdentityConflict({ ...base, recipientPersonId: 'person-a' })).toBe(
      'same_person',
    );
    expect(referralIdentityConflict({ ...base, recipientHouseholdId: 'household-a' })).toBe(
      'same_household',
    );
    expect(referralIdentityConflict({ ...base, recipientPaymentIdentityHmac: 'payment-a' })).toBe(
      'same_payment_identity',
    );
    expect(referralIdentityConflict({ ...base, recipientAlreadyAttributed: true })).toBe(
      'recipient_already_attributed',
    );
  });

  it('qualifies only the exact server milestone inside the frozen program window', () => {
    expect(
      decideReferralQualification({
        definition: definition(),
        recipientEventKind: 'account_eligible',
        occurredAt: new Date('2026-08-15T00:00:00.000Z'),
      }),
    ).toEqual({ decision: 'qualified', reasonCode: 'exact_server_milestone' });
    expect(
      decideReferralQualification({
        definition: definition(),
        recipientEventKind: 'orientation_ready',
        occurredAt: new Date('2026-08-15T00:00:00.000Z'),
      }),
    ).toEqual({ decision: 'denied', reasonCode: 'wrong_server_milestone' });
    expect(
      decideReferralQualification({
        definition: definition(),
        recipientEventKind: 'account_eligible',
        identityConflict: 'same_household',
        occurredAt: new Date('2026-08-15T00:00:00.000Z'),
      }),
    ).toEqual({ decision: 'denied', reasonCode: 'identity_conflict' });
  });

  it('keeps signed append-only arithmetic bounded by settled principal', () => {
    expect(signedReferralLedgerAmount('earned', 3_725)).toBe(3_725);
    expect(signedReferralLedgerAmount('reversed', 1_200)).toBe(-1_200);
    expect(
      boundedSettlementCredit({
        paidCreditTotalMinor: 3_725,
        currentNetCreditMinor: 1_242,
        canonicalSettledPrincipalMinor: 14_900,
      }),
    ).toBe(2_483);
    expect(
      boundedSettlementCredit({
        paidCreditTotalMinor: 3_725,
        currentNetCreditMinor: 0,
        canonicalSettledPrincipalMinor: 1_000,
      }),
    ).toBe(1_000);
  });

  it('keeps sharing user-initiated, contact-free, non-rewarding, and unregistered', () => {
    expect(referralShareCapabilityRegistry.map((capability) => capability.mode)).toEqual([
      'native_share_sheet',
      'copy_link',
    ]);
    expect(
      referralShareCapabilityRegistry.every(
        (capability) =>
          capability.state === 'integration_not_registered' &&
          capability.userInitiatedOnly &&
          !capability.contactPermissionRequested &&
          !capability.contactDataAccepted &&
          !capability.automaticSend &&
          !capability.shareEventRewardsCredit &&
          !capability.externalActionExecuted,
      ),
    ).toBe(true);
  });
});

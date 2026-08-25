import { describe, expect, it } from 'vitest';
import { seededCommercePlanVersions } from './commerce';
import {
  referralRevenueHypothesisRegistry,
  revenueHypothesisScopes,
  revenueOfferHypothesisRegistry,
  revenueOfferHypothesisRegistryVersion,
} from './revenue-hypotheses';

describe('isolated revenue hypotheses', () => {
  it('records the exact versioned subscription values without a live scope', () => {
    expect(revenueOfferHypothesisRegistryVersion).toBe(1);
    expect(revenueHypothesisScopes).toEqual(['synthetic', 'stripe_sandbox']);
    expect(
      revenueOfferHypothesisRegistry.map((hypothesis) => ({
        hypothesisKey: hypothesis.hypothesisKey,
        version: hypothesis.version,
        displayName: hypothesis.displayName,
        audience: hypothesis.audience,
        billingInterval: hypothesis.billingInterval,
        currency: hypothesis.currency,
        amountMinor: hypothesis.amountMinor,
        comparisonRole: hypothesis.comparisonRole,
        scopes: hypothesis.scopes,
      })),
    ).toEqual([
      {
        hypothesisKey: 'offer-hypothesis-family-monthly-v1',
        version: 1,
        displayName: 'Family monthly USD 14.99',
        audience: 'family',
        billingInterval: 'month',
        currency: 'USD',
        amountMinor: 1_499,
        comparisonRole: 'synthetic_control',
        scopes: ['synthetic', 'stripe_sandbox'],
      },
      {
        hypothesisKey: 'offer-hypothesis-family-annual-v1',
        version: 1,
        displayName: 'Family annual USD 149',
        audience: 'family',
        billingInterval: 'year',
        currency: 'USD',
        amountMinor: 14_900,
        comparisonRole: 'synthetic_candidate',
        scopes: ['synthetic', 'stripe_sandbox'],
      },
      {
        hypothesisKey: 'offer-hypothesis-individual-monthly-v1',
        version: 1,
        displayName: 'Individual monthly USD 8.99',
        audience: 'individual',
        billingInterval: 'month',
        currency: 'USD',
        amountMinor: 899,
        comparisonRole: 'synthetic_candidate',
        scopes: ['synthetic', 'stripe_sandbox'],
      },
      {
        hypothesisKey: 'offer-hypothesis-individual-annual-v1',
        version: 1,
        displayName: 'Individual annual USD 89',
        audience: 'individual',
        billingInterval: 'year',
        currency: 'USD',
        amountMinor: 8_900,
        comparisonRole: 'synthetic_candidate',
        scopes: ['synthetic', 'stripe_sandbox'],
      },
    ]);

    for (const hypothesis of revenueOfferHypothesisRegistry) {
      expect(hypothesis.publicRouteEnabled).toBe(false);
      expect(hypothesis.productionActivationEnabled).toBe(false);
      expect(hypothesis.liveProviderWriteEnabled).toBe(false);
      expect(Object.isFrozen(hypothesis)).toBe(true);
      expect(Object.isFrozen(hypothesis.scopes)).toBe(true);
    }
    expect(Object.isFrozen(revenueOfferHypothesisRegistry)).toBe(true);
  });

  it('retires the USD 119 founding experiment from active domain hypotheses', () => {
    const activeAmounts = revenueOfferHypothesisRegistry.map(
      (hypothesis) => hypothesis.amountMinor,
    );
    const seededFamilyAmounts = seededCommercePlanVersions.family.prices.map(
      (price) => price.amountMinor,
    );

    expect(activeAmounts).not.toContain(11_900);
    expect(seededFamilyAmounts).toEqual([1_499, 14_900]);
  });

  it('caps non-cash referral hypotheses and denies self-referral identities', () => {
    expect(
      referralRevenueHypothesisRegistry.map((hypothesis) => ({
        hypothesisKey: hypothesis.hypothesisKey,
        version: hypothesis.version,
        eligibleOfferHypothesisKey: hypothesis.eligibleOfferHypothesisKey,
        creditMinor: hypothesis.creditMinor,
        maximumQualifyingReferralsPerReferrer: hypothesis.maximumQualifyingReferralsPerReferrer,
        maximumCreditPerReferrerMinor: hypothesis.maximumCreditPerReferrerMinor,
        maximumCreditPerHouseholdMinor: hypothesis.maximumCreditPerHouseholdMinor,
        maximumProgramLiabilityMinor: hypothesis.maximumProgramLiabilityMinor,
        scopes: hypothesis.scopes,
      })),
    ).toEqual([
      {
        hypothesisKey: 'referral-hypothesis-family-service-credit-v1',
        version: 1,
        eligibleOfferHypothesisKey: 'offer-hypothesis-family-monthly-v1',
        creditMinor: 1_499,
        maximumQualifyingReferralsPerReferrer: 3,
        maximumCreditPerReferrerMinor: 4_497,
        maximumCreditPerHouseholdMinor: 4_497,
        maximumProgramLiabilityMinor: 149_900,
        scopes: ['synthetic', 'stripe_sandbox'],
      },
      {
        hypothesisKey: 'referral-hypothesis-individual-service-credit-v1',
        version: 1,
        eligibleOfferHypothesisKey: 'offer-hypothesis-individual-monthly-v1',
        creditMinor: 899,
        maximumQualifyingReferralsPerReferrer: 3,
        maximumCreditPerReferrerMinor: 2_697,
        maximumCreditPerHouseholdMinor: 2_697,
        maximumProgramLiabilityMinor: 89_900,
        scopes: ['synthetic', 'stripe_sandbox'],
      },
    ]);

    for (const hypothesis of referralRevenueHypothesisRegistry) {
      expect(hypothesis.rewardKind).toBe('non_cash_subscription_service_credit');
      expect(hypothesis.qualificationEvent).toBe('first_settled_subscription_payment');
      expect(hypothesis.antiSelfReferral).toEqual({
        samePersonDenied: true,
        sameHouseholdDenied: true,
        samePaymentIdentityDenied: true,
        recipientAlreadyAttributedDenied: true,
      });
      expect(hypothesis.cashPayoutEnabled).toBe(false);
      expect(hypothesis.creditTransferEnabled).toBe(false);
      expect(hypothesis.externalActionEnabled).toBe(false);
      expect(hypothesis.publicRouteEnabled).toBe(false);
      expect(hypothesis.productionActivationEnabled).toBe(false);
      expect(hypothesis.liveProviderWriteEnabled).toBe(false);
      expect(Object.isFrozen(hypothesis)).toBe(true);
      expect(Object.isFrozen(hypothesis.antiSelfReferral)).toBe(true);
    }
    expect(Object.isFrozen(referralRevenueHypothesisRegistry)).toBe(true);
  });
});

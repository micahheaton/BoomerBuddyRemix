export const revenueHypothesisScopes = ['synthetic', 'stripe_sandbox'] as const;
export type RevenueHypothesisScope = (typeof revenueHypothesisScopes)[number];

export const revenueOfferHypothesisRegistryVersion = 1 as const;

export const revenueOfferHypothesisKeys = [
  'offer-hypothesis-family-monthly-v1',
  'offer-hypothesis-family-annual-v1',
  'offer-hypothesis-individual-monthly-v1',
  'offer-hypothesis-individual-annual-v1',
] as const;
export type RevenueOfferHypothesisKey = (typeof revenueOfferHypothesisKeys)[number];

export interface RevenueOfferHypothesis {
  readonly hypothesisKey: RevenueOfferHypothesisKey;
  readonly version: number;
  readonly displayName:
    | 'Family monthly USD 14.99'
    | 'Family annual USD 149'
    | 'Individual monthly USD 8.99'
    | 'Individual annual USD 89';
  readonly audience: 'family' | 'individual';
  readonly billingInterval: 'month' | 'year';
  readonly currency: 'USD';
  readonly amountMinor: number;
  readonly comparisonRole: 'synthetic_control' | 'synthetic_candidate';
  readonly scopes: readonly RevenueHypothesisScope[];
  readonly publicRouteEnabled: false;
  readonly productionActivationEnabled: false;
  readonly liveProviderWriteEnabled: false;
}

const isolatedScopes = Object.freeze([...revenueHypothesisScopes]);
const productionIsolation = Object.freeze({
  publicRouteEnabled: false as const,
  productionActivationEnabled: false as const,
  liveProviderWriteEnabled: false as const,
});

export const revenueOfferHypothesisRegistry = Object.freeze([
  Object.freeze({
    hypothesisKey: 'offer-hypothesis-family-monthly-v1',
    version: 1,
    displayName: 'Family monthly USD 14.99',
    audience: 'family',
    billingInterval: 'month',
    currency: 'USD',
    amountMinor: 1_499,
    comparisonRole: 'synthetic_control',
    scopes: isolatedScopes,
    ...productionIsolation,
  }),
  Object.freeze({
    hypothesisKey: 'offer-hypothesis-family-annual-v1',
    version: 1,
    displayName: 'Family annual USD 149',
    audience: 'family',
    billingInterval: 'year',
    currency: 'USD',
    amountMinor: 14_900,
    comparisonRole: 'synthetic_candidate',
    scopes: isolatedScopes,
    ...productionIsolation,
  }),
  Object.freeze({
    hypothesisKey: 'offer-hypothesis-individual-monthly-v1',
    version: 1,
    displayName: 'Individual monthly USD 8.99',
    audience: 'individual',
    billingInterval: 'month',
    currency: 'USD',
    amountMinor: 899,
    comparisonRole: 'synthetic_candidate',
    scopes: isolatedScopes,
    ...productionIsolation,
  }),
  Object.freeze({
    hypothesisKey: 'offer-hypothesis-individual-annual-v1',
    version: 1,
    displayName: 'Individual annual USD 89',
    audience: 'individual',
    billingInterval: 'year',
    currency: 'USD',
    amountMinor: 8_900,
    comparisonRole: 'synthetic_candidate',
    scopes: isolatedScopes,
    ...productionIsolation,
  }),
]) satisfies readonly RevenueOfferHypothesis[];

export const referralRevenueHypothesisKeys = [
  'referral-hypothesis-family-service-credit-v1',
  'referral-hypothesis-individual-service-credit-v1',
] as const;
export type ReferralRevenueHypothesisKey = (typeof referralRevenueHypothesisKeys)[number];

export interface ReferralRevenueHypothesis {
  readonly hypothesisKey: ReferralRevenueHypothesisKey;
  readonly version: number;
  readonly displayName: 'Family one-month service credit' | 'Individual one-month service credit';
  readonly eligibleOfferHypothesisKey: RevenueOfferHypothesisKey;
  readonly qualificationEvent: 'first_settled_subscription_payment';
  readonly rewardKind: 'non_cash_subscription_service_credit';
  readonly currency: 'USD';
  readonly creditMinor: number;
  readonly maximumQualifyingReferralsPerReferrer: number;
  readonly maximumCreditPerReferrerMinor: number;
  readonly maximumCreditPerHouseholdMinor: number;
  readonly maximumProgramLiabilityMinor: number;
  readonly scopes: readonly RevenueHypothesisScope[];
  readonly antiSelfReferral: {
    readonly samePersonDenied: true;
    readonly sameHouseholdDenied: true;
    readonly samePaymentIdentityDenied: true;
    readonly recipientAlreadyAttributedDenied: true;
  };
  readonly cashPayoutEnabled: false;
  readonly creditTransferEnabled: false;
  readonly externalActionEnabled: false;
  readonly publicRouteEnabled: false;
  readonly productionActivationEnabled: false;
  readonly liveProviderWriteEnabled: false;
}

const antiSelfReferral = Object.freeze({
  samePersonDenied: true as const,
  sameHouseholdDenied: true as const,
  samePaymentIdentityDenied: true as const,
  recipientAlreadyAttributedDenied: true as const,
});
const referralIsolation = Object.freeze({
  cashPayoutEnabled: false as const,
  creditTransferEnabled: false as const,
  externalActionEnabled: false as const,
  ...productionIsolation,
});

export const referralRevenueHypothesisRegistry = Object.freeze([
  Object.freeze({
    hypothesisKey: 'referral-hypothesis-family-service-credit-v1',
    version: 1,
    displayName: 'Family one-month service credit',
    eligibleOfferHypothesisKey: 'offer-hypothesis-family-monthly-v1',
    qualificationEvent: 'first_settled_subscription_payment',
    rewardKind: 'non_cash_subscription_service_credit',
    currency: 'USD',
    creditMinor: 1_499,
    maximumQualifyingReferralsPerReferrer: 3,
    maximumCreditPerReferrerMinor: 4_497,
    maximumCreditPerHouseholdMinor: 4_497,
    maximumProgramLiabilityMinor: 149_900,
    scopes: isolatedScopes,
    antiSelfReferral,
    ...referralIsolation,
  }),
  Object.freeze({
    hypothesisKey: 'referral-hypothesis-individual-service-credit-v1',
    version: 1,
    displayName: 'Individual one-month service credit',
    eligibleOfferHypothesisKey: 'offer-hypothesis-individual-monthly-v1',
    qualificationEvent: 'first_settled_subscription_payment',
    rewardKind: 'non_cash_subscription_service_credit',
    currency: 'USD',
    creditMinor: 899,
    maximumQualifyingReferralsPerReferrer: 3,
    maximumCreditPerReferrerMinor: 2_697,
    maximumCreditPerHouseholdMinor: 2_697,
    maximumProgramLiabilityMinor: 89_900,
    scopes: isolatedScopes,
    antiSelfReferral,
    ...referralIsolation,
  }),
]) satisfies readonly ReferralRevenueHypothesis[];

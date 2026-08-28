export type RevenueResearchAudience = 'family' | 'individual';
export type RevenueResearchPresentationOrder = 'monthly_first' | 'yearly_first';
export type RevenueResearchResponseValue = 'monthly' | 'yearly' | 'neither' | 'unsure';

export interface RevenueResearchPreviewEnvironment {
  readonly NODE_ENV?: string;
  readonly BB_LOCAL_REVENUE_RESEARCH_PREVIEW_ENABLED?: string;
  readonly BB_LOCAL_REVENUE_RESEARCH_PREVIEW_SECOND_GUARD_CONFIRMED?: string;
}

export interface RevenueResearchAudienceDefinition {
  readonly label: 'Family - one household group' | 'Individual - one person';
  readonly monthlyAmountMinor: number;
  readonly yearlyAmountMinor: number;
  readonly twelveMonthlyPaymentsMinor: number;
  readonly savingsMinor: number;
  readonly monthlyCopy: string;
  readonly yearlyCopy: string;
  readonly referral: {
    readonly creditMinor: number;
    readonly maximumQualifyingReferrals: number;
    readonly referrerAndHouseholdCapMinor: number;
    readonly programLiabilityCapMinor: number;
    readonly maximumWholeCredits: number;
    readonly creditCopy: string;
    readonly referrerAndHouseholdCapCopy: string;
    readonly programLiabilityCapCopy: string;
  };
}

export const revenueResearchPreviewStatusCopy =
  'Research preview only. These choices do not start Checkout, reserve a price, or change the production catalog. Family annual at USD 149.90 after a 7-day trial is the default production offer, and Family monthly at USD 14.99 remains available. Individual offers and every referral choice shown here remain unavailable and are evaluated only as hypotheses.';

const familyDefinition = Object.freeze({
  label: 'Family - one household group',
  monthlyAmountMinor: 1_499,
  yearlyAmountMinor: 14_990,
  twelveMonthlyPaymentsMinor: 17_988,
  savingsMinor: 2_998,
  monthlyCopy: 'USD 14.99 each month',
  yearlyCopy: 'USD 149.90 each year; exactly two monthly payments less',
  referral: Object.freeze({
    creditMinor: 1_499,
    maximumQualifyingReferrals: 3,
    referrerAndHouseholdCapMinor: 4_497,
    programLiabilityCapMinor: 149_900,
    maximumWholeCredits: 100,
    creditCopy: 'USD 14.99 in non-cash subscription service credit',
    referrerAndHouseholdCapCopy: '3 credits, capped at USD 44.97 per referrer and household',
    programLiabilityCapCopy: 'USD 1,499.00 program cap, or 100 whole credits',
  }),
}) satisfies RevenueResearchAudienceDefinition;

const individualDefinition = Object.freeze({
  label: 'Individual - one person',
  monthlyAmountMinor: 899,
  yearlyAmountMinor: 8_990,
  twelveMonthlyPaymentsMinor: 10_788,
  savingsMinor: 1_798,
  monthlyCopy: 'USD 8.99 each month',
  yearlyCopy: 'USD 89.90 each year; exactly two monthly payments less',
  referral: Object.freeze({
    creditMinor: 899,
    maximumQualifyingReferrals: 3,
    referrerAndHouseholdCapMinor: 2_697,
    programLiabilityCapMinor: 89_900,
    maximumWholeCredits: 100,
    creditCopy: 'USD 8.99 in non-cash subscription service credit',
    referrerAndHouseholdCapCopy: '3 credits, capped at USD 26.97 per referrer and household',
    programLiabilityCapCopy: 'USD 899.00 program cap, or 100 whole credits',
  }),
}) satisfies RevenueResearchAudienceDefinition;

export const revenueResearchAudienceDefinitions = Object.freeze({
  family: familyDefinition,
  individual: individualDefinition,
}) satisfies Readonly<Record<RevenueResearchAudience, RevenueResearchAudienceDefinition>>;

export const revenueResearchResponseChoices = Object.freeze([
  Object.freeze({ value: 'monthly', label: 'Monthly' }),
  Object.freeze({ value: 'yearly', label: 'Yearly' }),
  Object.freeze({ value: 'neither', label: 'Neither' }),
  Object.freeze({ value: 'unsure', label: 'Unsure' }),
]) satisfies readonly Readonly<{
  value: RevenueResearchResponseValue;
  label: string;
}>[];

export function isLocalRevenueResearchPreviewEnabled(
  environment: RevenueResearchPreviewEnvironment,
): boolean {
  const safeLocalRuntime =
    environment.NODE_ENV === 'development' || environment.NODE_ENV === 'test';
  return (
    safeLocalRuntime &&
    environment.BB_LOCAL_REVENUE_RESEARCH_PREVIEW_ENABLED === 'true' &&
    environment.BB_LOCAL_REVENUE_RESEARCH_PREVIEW_SECOND_GUARD_CONFIRMED === 'true'
  );
}

export function revenueResearchPresentationOrderFromSelector(
  selector: number,
): RevenueResearchPresentationOrder {
  if (selector === 0) return 'monthly_first';
  if (selector === 1) return 'yearly_first';
  throw new TypeError('Revenue research presentation selector must be exactly 0 or 1');
}

export function orderedRevenueResearchIntervalOptions(
  audience: RevenueResearchAudience,
  order: RevenueResearchPresentationOrder,
): readonly Readonly<{
  responseValue: 'monthly' | 'yearly';
  copy: string;
}>[] {
  const definition = revenueResearchAudienceDefinitions[audience];
  const monthly = Object.freeze({
    responseValue: 'monthly' as const,
    copy: definition.monthlyCopy,
  });
  const yearly = Object.freeze({ responseValue: 'yearly' as const, copy: definition.yearlyCopy });
  return Object.freeze(order === 'monthly_first' ? [monthly, yearly] : [yearly, monthly]);
}

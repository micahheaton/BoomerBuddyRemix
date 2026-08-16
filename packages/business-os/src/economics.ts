export interface SubscriberEconomicsInput {
  annualPlanShare: number;
  annualPrice: number;
  appStoreShare: number;
  appStoreTakeRate: number;
  badDebtRate: number;
  monthlyChurnRate: number;
  monthlyPrice: number;
  paidHouseholds: number;
  paymentFeeRate: number;
  refundRate: number;
  variableFraudCostPerHousehold: number;
  variableHostingCostPerHousehold: number;
  variableInferenceCostPerHousehold: number;
  variableSupportCostPerHousehold: number;
  annualFixedCosts: {
    legalSecurityPrivacy: number;
    marketing: number;
    payrollContractors: number;
    softwareHosting: number;
    taxAdministration: number;
  };
}

export interface SubscriberEconomicsResult {
  annualContribution: number;
  annualOperatingProfit: number;
  annualRevenue: number;
  contributionMargin: number;
  monthlyBlendedRevenuePerHousehold: number;
  monthlyChurnedHouseholds: number;
  profitTargetGap: number;
}

function boundedRate(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function modelSubscriberEconomics(
  input: SubscriberEconomicsInput,
): SubscriberEconomicsResult {
  const annualShare = boundedRate(input.annualPlanShare);
  const blendedMonthlyRevenue =
    input.monthlyPrice * (1 - annualShare) + (input.annualPrice / 12) * annualShare;
  const annualRevenue = blendedMonthlyRevenue * input.paidHouseholds * 12;
  const processing = annualRevenue * boundedRate(input.paymentFeeRate);
  const storeFees =
    annualRevenue * boundedRate(input.appStoreShare) * boundedRate(input.appStoreTakeRate);
  const lossCosts =
    annualRevenue * (boundedRate(input.refundRate) + boundedRate(input.badDebtRate));
  const perHouseholdMonthly =
    input.variableFraudCostPerHousehold +
    input.variableHostingCostPerHousehold +
    input.variableInferenceCostPerHousehold +
    input.variableSupportCostPerHousehold;
  const annualVariableCosts =
    processing + storeFees + lossCosts + perHouseholdMonthly * input.paidHouseholds * 12;
  const annualContribution = annualRevenue - annualVariableCosts;
  const fixedCosts = Object.values(input.annualFixedCosts).reduce((sum, value) => sum + value, 0);
  const annualOperatingProfit = annualContribution - fixedCosts;
  return {
    annualContribution,
    annualOperatingProfit,
    annualRevenue,
    contributionMargin: annualRevenue === 0 ? 0 : annualContribution / annualRevenue,
    monthlyBlendedRevenuePerHousehold: blendedMonthlyRevenue,
    monthlyChurnedHouseholds: input.paidHouseholds * boundedRate(input.monthlyChurnRate),
    profitTargetGap: 1_000_000 - annualOperatingProfit,
  };
}

export interface StaffingWorkloadInput {
  billingCasesPerMonth: number;
  b2bAccountsWithDueActions: number;
  customerSuccessInterventionsPerMonth: number;
  fraudReviewsPerMonth: number;
  orientationSessionsPerMonth: number;
  supportCasesPerMonth: number;
}

export interface StaffingTrigger {
  monthlyHours: number;
  reason: string;
  role: string;
  triggered: boolean;
}

export function evaluateStaffingTriggers(input: StaffingWorkloadInput): StaffingTrigger[] {
  const capacity = 120;
  const rows = [
    {
      role: 'Customer Safety and Support Specialist',
      hours: (input.supportCasesPerMonth * 20 + input.billingCasesPerMonth * 15) / 60,
      reason: 'Support and billing case handling exceeds a sustainable fractional workload.',
    },
    {
      role: 'Orientation Specialist',
      hours: (input.orientationSessionsPerMonth * 30) / 60,
      reason: 'Human orientation demand exceeds a sustainable fractional workload.',
    },
    {
      role: 'Trust and Safety Analyst',
      hours: (input.fraudReviewsPerMonth * 25) / 60,
      reason: 'Bounded fraud-review demand requires dedicated supervised capacity.',
    },
    {
      role: 'Customer Success',
      hours: (input.customerSuccessInterventionsPerMonth * 25) / 60,
      reason: 'Explainable health interventions require dedicated follow-through.',
    },
    {
      role: 'Partnerships and RevOps',
      hours: (input.b2bAccountsWithDueActions * 35) / 60,
      reason: 'Partner pipeline hygiene and relationship work require dedicated ownership.',
    },
  ];
  return rows.map((row) => ({
    monthlyHours: row.hours,
    reason: row.reason,
    role: row.role,
    triggered: row.hours >= capacity,
  }));
}

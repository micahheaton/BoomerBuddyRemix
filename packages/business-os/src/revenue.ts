export const opportunityStages = [
  'target',
  'prospecting',
  'engaged',
  'discovery',
  'qualified',
  'pilot',
  'business_case',
  'contracting',
  'closed_won',
  'closed_lost',
  'implementation',
  'active_partner',
  'expansion',
] as const;

export type OpportunityStage = (typeof opportunityStages)[number];

const allowedStageTransitions: Readonly<Record<OpportunityStage, readonly OpportunityStage[]>> = {
  target: ['prospecting', 'closed_lost'],
  prospecting: ['engaged', 'closed_lost'],
  engaged: ['discovery', 'closed_lost'],
  discovery: ['qualified', 'closed_lost'],
  qualified: ['pilot', 'business_case', 'closed_lost'],
  pilot: ['business_case', 'closed_lost'],
  business_case: ['contracting', 'closed_lost'],
  contracting: ['closed_won', 'closed_lost'],
  closed_won: ['implementation'],
  closed_lost: ['target'],
  implementation: ['active_partner'],
  active_partner: ['expansion', 'closed_lost'],
  expansion: ['active_partner', 'closed_lost'],
};

export function canTransitionOpportunity(
  current: OpportunityStage,
  next: OpportunityStage,
): boolean {
  return allowedStageTransitions[current].includes(next);
}

const inactivityDays: Readonly<Partial<Record<OpportunityStage, number>>> = {
  target: 30,
  prospecting: 14,
  engaged: 10,
  discovery: 10,
  qualified: 10,
  pilot: 7,
  business_case: 7,
  contracting: 7,
  implementation: 14,
  active_partner: 30,
  expansion: 14,
};

export interface OpportunityHygieneInput {
  stage: OpportunityStage;
  lastMeaningfulActivityAt: Date;
  nextAction?: string;
  nextActionAt?: Date;
  suppressionReason?: string;
  snoozedUntil?: Date;
}

export interface OpportunityHygieneResult {
  stale: boolean;
  reasons: string[];
  recommendedAction?: string;
}

export function evaluateOpportunityHygiene(
  input: OpportunityHygieneInput,
  now = new Date(),
): OpportunityHygieneResult {
  if (input.stage === 'closed_lost' || input.stage === 'closed_won') {
    return { stale: false, reasons: [] };
  }
  if (
    input.suppressionReason !== undefined ||
    (input.snoozedUntil?.getTime() ?? 0) > now.getTime()
  ) {
    return { stale: false, reasons: [] };
  }

  const reasons: string[] = [];
  const allowedDays = inactivityDays[input.stage] ?? 14;
  const ageMs = now.getTime() - input.lastMeaningfulActivityAt.getTime();
  if (ageMs >= allowedDays * 86_400_000)
    reasons.push(`No meaningful activity for ${allowedDays} days.`);
  if (input.nextAction === undefined || input.nextActionAt === undefined) {
    reasons.push('No dated next action is recorded.');
  } else if (input.nextActionAt.getTime() < now.getTime()) {
    reasons.push('The recorded next action is overdue.');
  }
  return {
    stale: reasons.length > 0,
    reasons,
    ...(reasons.length === 0
      ? {}
      : {
          recommendedAction:
            'Review the account and record, snooze, suppress, or close a next action.',
        }),
  };
}

export interface ReferralRewardPolicy {
  approvedBy?: string;
  enabled: boolean;
  maximumAwardsPerReferrer: number;
  rewardCode?: string;
}

export interface ReferralRewardDecision {
  award: boolean;
  reason: string;
}

export const referralStates = [
  'created',
  'accepted',
  'activated',
  'paid',
  'revoked',
  'abuse_review',
] as const;

export type ReferralState = (typeof referralStates)[number];

const referralTransitions: Readonly<Record<ReferralState, readonly ReferralState[]>> = {
  created: ['accepted', 'revoked', 'abuse_review'],
  accepted: ['activated', 'revoked', 'abuse_review'],
  activated: ['paid', 'revoked', 'abuse_review'],
  paid: ['abuse_review'],
  revoked: [],
  abuse_review: ['revoked', 'accepted', 'activated', 'paid'],
};

export function canTransitionReferral(current: ReferralState, next: ReferralState): boolean {
  return referralTransitions[current].includes(next);
}

export function evaluateReferralReward(
  policy: ReferralRewardPolicy,
  priorAwards: number,
  referredHouseholdActivated: boolean,
): ReferralRewardDecision {
  if (!policy.enabled) return { award: false, reason: 'Rewards are disabled.' };
  if (policy.approvedBy === undefined || policy.rewardCode === undefined) {
    return { award: false, reason: 'Reward policy lacks explicit approval or a reward code.' };
  }
  if (!referredHouseholdActivated) {
    return { award: false, reason: 'The referred household has not activated.' };
  }
  if (priorAwards >= policy.maximumAwardsPerReferrer) {
    return { award: false, reason: 'The referrer has reached the approved award limit.' };
  }
  return { award: true, reason: 'Approved activation reward is eligible for ledger entry.' };
}

export type CommunicationKind = 'transactional' | 'lifecycle' | 'b2b' | 'consumer_sms';

export interface CommunicationPolicyInput {
  kind: CommunicationKind;
  consented: boolean;
  suppressed: boolean;
  templateApproved: boolean;
  includesNovelSafetyAdvice: boolean;
  campaignApproved: boolean;
}

export type CommunicationDisposition =
  'automatic' | 'approval_required' | 'professional_review' | 'blocked';

export function decideCommunication(input: CommunicationPolicyInput): CommunicationDisposition {
  if (input.suppressed) return 'blocked';
  if (input.includesNovelSafetyAdvice) return 'approval_required';
  if (input.kind === 'consumer_sms') return 'professional_review';
  if (input.kind === 'lifecycle' && !input.consented) return 'blocked';
  if (!input.templateApproved) return 'approval_required';
  if (input.kind === 'b2b' && !input.campaignApproved) return 'approval_required';
  return 'automatic';
}

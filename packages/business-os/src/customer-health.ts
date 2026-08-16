export interface CustomerHealthSignals {
  cancellationIntent: boolean;
  checkCompleted: boolean;
  familyParticipation: boolean;
  mobileInstalled: boolean;
  orientationComplete: boolean;
  paymentFailed: boolean;
  productInactiveDays: number;
  supportCasesOpen: number;
  trustedCircleEstablished: boolean;
  unresolvedIncident: boolean;
}

export interface CustomerHealthComponent {
  code: string;
  explanation: string;
  points: number;
}

export interface CustomerHealthResult {
  components: CustomerHealthComponent[];
  score: number;
  state: 'healthy' | 'needs_attention' | 'at_risk';
}

export function evaluateCustomerHealth(input: CustomerHealthSignals): CustomerHealthResult {
  const components: CustomerHealthComponent[] = [];
  const add = (code: string, explanation: string, points: number): void => {
    components.push({ code, explanation, points });
  };

  if (input.orientationComplete) add('orientation_complete', 'Orientation is complete.', 12);
  else add('orientation_incomplete', 'Orientation is incomplete.', -12);
  if (input.checkCompleted) add('check_completed', 'At least one Check is complete.', 10);
  else add('check_missing', 'No Check has been completed.', -10);
  if (input.trustedCircleEstablished) add('trusted_circle', 'A Trusted Circle is established.', 10);
  else add('trusted_circle_missing', 'No Trusted Circle is established.', -8);
  if (input.familyParticipation)
    add('family_participation', 'Another family participant is active.', 6);
  if (input.mobileInstalled) add('mobile_installed', 'The mobile app is installed.', 4);
  if (input.paymentFailed) add('payment_failed', 'A payment failure is unresolved.', -20);
  if (input.cancellationIntent) add('cancellation_intent', 'Cancellation intent is recorded.', -25);
  if (input.unresolvedIncident) add('unresolved_incident', 'A safety incident is unresolved.', -25);
  if (input.supportCasesOpen > 0) {
    add('support_open', `${input.supportCasesOpen} support case(s) remain open.`, -5);
  }
  if (input.productInactiveDays >= 30) {
    add('inactive_30d', `No product activity for ${input.productInactiveDays} days.`, -15);
  } else if (input.productInactiveDays >= 14) {
    add('inactive_14d', `No product activity for ${input.productInactiveDays} days.`, -7);
  }

  const score = Math.max(
    0,
    Math.min(100, 60 + components.reduce((sum, item) => sum + item.points, 0)),
  );
  return {
    components,
    score,
    state: score < 40 ? 'at_risk' : score < 65 ? 'needs_attention' : 'healthy',
  };
}

export const lifecycleTriggers = [
  'signup',
  'incomplete_signup',
  'first_check',
  'orientation_started',
  'orientation_abandoned',
  'trusted_circle_missing',
  'practice_check_missing',
  'trial_started',
  'trial_ending',
  'converted',
  'failed_payment',
  'payment_recovered',
  'renewal',
  'cancellation_intent',
  'cancelled',
  'win_back_eligible',
  'referral_success',
] as const;

export type LifecycleTrigger = (typeof lifecycleTriggers)[number];

export type LifecycleActionKind = 'internal_task' | 'approved_message' | 'wait' | 'decision';

export interface LifecycleStepPlan {
  actionKind: LifecycleActionKind;
  key: string;
  requiresMarketingConsent: boolean;
}

const triggerPlans: Readonly<Record<LifecycleTrigger, readonly LifecycleStepPlan[]>> = {
  signup: [
    { actionKind: 'internal_task', key: 'activation_observation', requiresMarketingConsent: false },
  ],
  incomplete_signup: [
    { actionKind: 'approved_message', key: 'signup_help', requiresMarketingConsent: false },
  ],
  first_check: [
    { actionKind: 'internal_task', key: 'first_check_recorded', requiresMarketingConsent: false },
  ],
  orientation_started: [
    { actionKind: 'internal_task', key: 'orientation_progress', requiresMarketingConsent: false },
  ],
  orientation_abandoned: [
    { actionKind: 'approved_message', key: 'orientation_help', requiresMarketingConsent: false },
  ],
  trusted_circle_missing: [
    {
      actionKind: 'approved_message',
      key: 'trusted_circle_education',
      requiresMarketingConsent: false,
    },
  ],
  practice_check_missing: [
    {
      actionKind: 'approved_message',
      key: 'practice_check_education',
      requiresMarketingConsent: false,
    },
  ],
  trial_started: [{ actionKind: 'wait', key: 'trial_monitor', requiresMarketingConsent: false }],
  trial_ending: [
    { actionKind: 'approved_message', key: 'trial_ending_notice', requiresMarketingConsent: false },
  ],
  converted: [
    { actionKind: 'internal_task', key: 'conversion_recorded', requiresMarketingConsent: false },
  ],
  failed_payment: [
    { actionKind: 'approved_message', key: 'payment_recovery', requiresMarketingConsent: false },
  ],
  payment_recovered: [
    {
      actionKind: 'internal_task',
      key: 'payment_recovery_recorded',
      requiresMarketingConsent: false,
    },
  ],
  renewal: [
    { actionKind: 'internal_task', key: 'renewal_recorded', requiresMarketingConsent: false },
  ],
  cancellation_intent: [
    { actionKind: 'decision', key: 'cancellation_support', requiresMarketingConsent: false },
  ],
  cancelled: [
    { actionKind: 'internal_task', key: 'cancellation_recorded', requiresMarketingConsent: false },
  ],
  win_back_eligible: [
    { actionKind: 'approved_message', key: 'win_back', requiresMarketingConsent: true },
  ],
  referral_success: [
    {
      actionKind: 'internal_task',
      key: 'referral_success_recorded',
      requiresMarketingConsent: false,
    },
  ],
};

export function lifecyclePlan(
  trigger: LifecycleTrigger,
  marketingConsented: boolean,
): LifecycleStepPlan[] {
  return triggerPlans[trigger].filter(
    (step) => !step.requiresMarketingConsent || marketingConsented,
  );
}

export type SupportRoutingClass =
  | 'self_service'
  | 'ai_assisted'
  | 'l1_human'
  | 'trust_safety'
  | 'billing'
  | 'security_privacy'
  | 'founder';

export function routeSupportCase(input: {
  category: 'account' | 'billing' | 'fraud' | 'navigation' | 'orientation' | 'security_privacy';
  executiveEscalation: boolean;
  needsArtifactAccess: boolean;
  safetySeverity: 'none' | 'low' | 'high';
}): SupportRoutingClass {
  if (input.executiveEscalation) return 'founder';
  if (input.category === 'security_privacy') return 'security_privacy';
  if (input.category === 'billing') return 'billing';
  if (input.category === 'fraud' || input.safetySeverity === 'high' || input.needsArtifactAccess) {
    return 'trust_safety';
  }
  if (input.category === 'navigation') return 'self_service';
  return input.safetySeverity === 'low' ? 'l1_human' : 'ai_assisted';
}

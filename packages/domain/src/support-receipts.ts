export const supportReceiptCategories = [
  'account_access',
  'billing',
  'check_experience',
  'family_access',
  'mobile_app',
  'privacy',
  'service_availability',
] as const;

export type SupportReceiptCategory = (typeof supportReceiptCategories)[number];

export const supportReceiptImpacts = ['question', 'degraded', 'blocked', 'safety_concern'] as const;

export type SupportReceiptImpact = (typeof supportReceiptImpacts)[number];

export const supportReceiptStates = [
  'open',
  'acknowledged',
  'in_review',
  'resolved',
  'withdrawn',
] as const;

export type SupportReceiptState = (typeof supportReceiptStates)[number];

export const supportReceiptActions = [
  'create',
  'acknowledge',
  'start_review',
  'resolve',
  'withdraw',
] as const;

export type SupportReceiptAction = (typeof supportReceiptActions)[number];

export const supportReceiptResolutionCodes = [
  'completed',
  'duplicate',
  'insufficient_content_free_evidence',
  'outside_supported_scope',
] as const;

export type SupportReceiptResolutionCode = (typeof supportReceiptResolutionCodes)[number];

export type SupportReceiptActorKind = 'customer' | 'hq';

export const terminalSupportReceiptStates = new Set<SupportReceiptState>(['resolved', 'withdrawn']);

export function nextSupportReceiptState(input: {
  readonly currentState?: SupportReceiptState;
  readonly action: SupportReceiptAction;
  readonly actorKind: SupportReceiptActorKind;
  readonly resolutionCode?: SupportReceiptResolutionCode;
}): SupportReceiptState {
  const { action, actorKind, currentState, resolutionCode } = input;
  const resolving = action === 'resolve';
  if (resolving !== (resolutionCode !== undefined)) {
    throw new TypeError('Support receipt resolution evidence is invalid');
  }
  if (action === 'create') {
    if (actorKind === 'customer' && currentState === undefined) return 'open';
    throw new TypeError('Support receipt creation transition is invalid');
  }
  if (currentState === undefined || terminalSupportReceiptStates.has(currentState)) {
    throw new TypeError('Support receipt terminal transition is invalid');
  }
  if (action === 'withdraw') {
    if (actorKind === 'customer') return 'withdrawn';
    throw new TypeError('Support receipt withdrawal transition is invalid');
  }
  if (actorKind !== 'hq') {
    throw new TypeError('Support receipt HQ transition authority is invalid');
  }
  if (action === 'acknowledge' && currentState === 'open') return 'acknowledged';
  if (action === 'start_review' && currentState === 'acknowledged') return 'in_review';
  if (action === 'resolve' && (currentState === 'acknowledged' || currentState === 'in_review')) {
    return 'resolved';
  }
  throw new TypeError('Support receipt state transition is invalid');
}

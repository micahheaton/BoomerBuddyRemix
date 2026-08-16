import { DomainError } from './errors';

export const orientationSteps = [
  'protection_subject',
  'trusted_circle',
  'safe_word',
  'practice_check',
  'capabilities_and_limits',
  'review',
] as const;
export type OrientationStep = (typeof orientationSteps)[number];
export type OrientationStatus = 'not_started' | 'in_progress' | 'ready';

export interface OrientationState {
  readonly status: OrientationStatus;
  readonly completedSteps: readonly OrientationStep[];
  readonly safeWordDisposition: 'unanswered' | 'configured' | 'informed_deferral';
  readonly needsAttention: boolean;
  readonly updatedAt: Date;
}

export function createOrientation(now: Date = new Date()): OrientationState {
  return {
    status: 'not_started',
    completedSteps: [],
    safeWordDisposition: 'unanswered',
    needsAttention: false,
    updatedAt: now,
  };
}

export function startOrientation(
  state: OrientationState,
  now: Date = new Date(),
): OrientationState {
  if (state.status !== 'not_started') return state;
  return { ...state, status: 'in_progress', updatedAt: now };
}

export function completeOrientationStep(
  state: OrientationState,
  step: OrientationStep,
  now: Date = new Date(),
): OrientationState {
  if (state.completedSteps.includes(step)) return state;
  if (state.status === 'ready') {
    throw new DomainError('invalid_transition', 'A ready orientation cannot be changed');
  }
  const expected = orientationSteps[state.completedSteps.length];
  if (expected !== step) {
    throw new DomainError('invalid_transition', 'Orientation steps must be completed in order', {
      expected: expected ?? 'complete',
      received: step,
    });
  }
  if (step === 'safe_word' && state.safeWordDisposition === 'unanswered') {
    throw new DomainError(
      'invalid_transition',
      'Configure or knowingly defer the safe word before completing this step',
    );
  }
  const completedSteps = [...state.completedSteps, step];
  return {
    ...state,
    status: completedSteps.length === orientationSteps.length ? 'ready' : 'in_progress',
    completedSteps,
    needsAttention: false,
    updatedAt: now,
  };
}

export function recordSafeWordDisposition(
  state: OrientationState,
  disposition: Exclude<OrientationState['safeWordDisposition'], 'unanswered'>,
  now: Date = new Date(),
): OrientationState {
  if (state.status === 'ready' || state.completedSteps.includes('safe_word')) {
    throw new DomainError('invalid_transition', 'Safe-word orientation has already been completed');
  }
  return { ...state, safeWordDisposition: disposition, updatedAt: now };
}

export function flagOrientationAttention(
  state: OrientationState,
  now: Date = new Date(),
): OrientationState {
  return { ...state, needsAttention: true, updatedAt: now };
}

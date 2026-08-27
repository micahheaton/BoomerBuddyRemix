import { settleIdentitySignOut } from '@boomerbuddy/security/identity-sign-out';

export const mobileIdentitySignOutTimeoutMs = 15_000;
export const mobileProviderStateSettleTimeoutMs = 2_000;

export type MobileSignOutPlan = Readonly<{
  shouldSignOut: boolean;
  identitySessionId?: string;
}>;

export type MobileSignOutOutcome = 'complete' | 'retry_required';

export function planMobileSignOut(input: {
  readonly isSignedIn: boolean;
  readonly pendingIdentitySessionId?: string;
  readonly currentIdentitySessionId?: string;
  readonly restoredIdentitySessionId?: string;
}): MobileSignOutPlan {
  if (!input.isSignedIn && !input.pendingIdentitySessionId) return { shouldSignOut: false };
  const identitySessionId =
    (
      input.pendingIdentitySessionId ??
      input.restoredIdentitySessionId ??
      input.currentIdentitySessionId
    )?.trim() || undefined;
  return {
    shouldSignOut: true,
    ...(identitySessionId ? { identitySessionId } : {}),
  };
}

export function shouldUseProviderWideMobileSignOut(input: {
  readonly markerPersisted: boolean;
  readonly targetIdentitySessionId?: string;
  readonly currentIdentitySessionId?: string;
}): boolean {
  return (
    !input.markerPersisted ||
    !input.targetIdentitySessionId ||
    !input.currentIdentitySessionId ||
    input.targetIdentitySessionId !== input.currentIdentitySessionId
  );
}

export function classifyMobileSignOutInspection(input: {
  readonly isSignedIn: boolean;
  readonly pendingStatus: 'none' | 'pending' | 'unavailable';
  readonly hasActiveSignOut: boolean;
}): 'clear' | 'restore_allowed' | 'retry_required' {
  if (!input.isSignedIn) return 'clear';
  return input.pendingStatus === 'none' && !input.hasActiveSignOut
    ? 'restore_allowed'
    : 'retry_required';
}

export interface MobileSignOutAttemptGate {
  readonly isActive: () => boolean;
  readonly run: (operation: () => Promise<MobileSignOutOutcome>) => Promise<MobileSignOutOutcome>;
}

export function createMobileSignOutAttemptGate(): MobileSignOutAttemptGate {
  let active: Promise<MobileSignOutOutcome> | undefined;
  return {
    isActive: () => active !== undefined,
    run(operation) {
      if (active !== undefined) return active;
      const attempt = Promise.resolve().then(operation);
      active = attempt;
      const clear = (): void => {
        if (active === attempt) active = undefined;
      };
      void attempt.then(clear, clear);
      return attempt;
    },
  };
}

export function beginMobileSignOutAttempt(input: {
  readonly gate: MobileSignOutAttemptGate;
  readonly closePrivateAccess: () => void;
  readonly operation: () => Promise<MobileSignOutOutcome>;
}): Promise<MobileSignOutOutcome> {
  if (!input.gate.isActive()) input.closePrivateAccess();
  return input.gate.run(input.operation);
}

export async function completeMobileSignOut(input: {
  readonly clearDeviceState: () => Promise<void>;
  readonly signOutIdentitySession: () => Promise<void>;
}): Promise<MobileSignOutOutcome> {
  const deviceStateCleared = await clearMobileDeviceStateSafely(input.clearDeviceState);
  const identitySignOut = await settleIdentitySignOut({
    clearIdentitySession: input.signOutIdentitySession,
    timeoutMs: mobileIdentitySignOutTimeoutMs,
  });
  if (identitySignOut !== 'cleared') return 'retry_required';
  return deviceStateCleared ? 'complete' : 'retry_required';
}

export async function clearMobileDeviceStateSafely(
  clearDeviceState: () => Promise<void>,
): Promise<boolean> {
  try {
    await clearDeviceState();
    return true;
  } catch {
    // The in-memory household selection is cleared before secure-storage cleanup is attempted.
    return false;
  }
}

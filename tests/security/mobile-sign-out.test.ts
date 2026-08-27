import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginMobileSignOutAttempt,
  classifyMobileSignOutInspection,
  clearMobileDeviceStateSafely,
  clearMobilePrivateDeviceState,
  completeMobileSignOut,
  createMobileSignOutAttemptGate,
  mobileIdentitySignOutTimeoutMs,
  planMobileSignOut,
  shouldUseProviderWideMobileSignOut,
} from '../../apps/mobile/src/sign-out';

describe('mobile sign-out recovery', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps recovery sign-out available before account bootstrap succeeds', () => {
    expect(
      planMobileSignOut({
        isSignedIn: true,
        currentIdentitySessionId: 'session-current',
      }),
    ).toEqual({ shouldSignOut: true, identitySessionId: 'session-current' });
    expect(
      planMobileSignOut({
        isSignedIn: true,
        currentIdentitySessionId: 'session-current',
        restoredIdentitySessionId: 'session-restored',
      }),
    ).toEqual({ shouldSignOut: true, identitySessionId: 'session-restored' });
  });

  it('allows provider-wide recovery sign-out when Clerk has no current session id', () => {
    expect(planMobileSignOut({ isSignedIn: true })).toEqual({ shouldSignOut: true });
    expect(
      planMobileSignOut({ isSignedIn: false, currentIdentitySessionId: 'stale-session' }),
    ).toEqual({ shouldSignOut: false });
  });

  it('keeps the captured pending Clerk session id across a retry', () => {
    expect(
      planMobileSignOut({
        isSignedIn: true,
        pendingIdentitySessionId: 'session-captured',
        currentIdentitySessionId: 'session-current',
        restoredIdentitySessionId: 'session-restored',
      }),
    ).toEqual({ shouldSignOut: true, identitySessionId: 'session-captured' });
    expect(
      planMobileSignOut({
        isSignedIn: false,
        pendingIdentitySessionId: 'session-captured',
      }),
    ).toEqual({ shouldSignOut: true, identitySessionId: 'session-captured' });
  });

  it('uses provider-wide sign-out when persistence fails or the Clerk session was replaced', () => {
    expect(
      shouldUseProviderWideMobileSignOut({
        markerPersisted: true,
        targetIdentitySessionId: 'session-current',
        currentIdentitySessionId: 'session-current',
      }),
    ).toBe(false);
    expect(
      shouldUseProviderWideMobileSignOut({
        markerPersisted: false,
        targetIdentitySessionId: 'session-current',
        currentIdentitySessionId: 'session-current',
      }),
    ).toBe(true);
    expect(
      shouldUseProviderWideMobileSignOut({
        markerPersisted: true,
        targetIdentitySessionId: 'session-before-restart',
        currentIdentitySessionId: 'session-after-restart',
      }),
    ).toBe(true);
  });

  it('keeps restoration closed when authentication changes during an active sign-out', () => {
    expect(
      classifyMobileSignOutInspection({
        isSignedIn: true,
        pendingStatus: 'none',
        hasActiveSignOut: true,
      }),
    ).toBe('retry_required');
    expect(
      classifyMobileSignOutInspection({
        isSignedIn: true,
        pendingStatus: 'none',
        hasActiveSignOut: false,
      }),
    ).toBe('restore_allowed');
    expect(
      classifyMobileSignOutInspection({
        isSignedIn: false,
        pendingStatus: 'pending',
        hasActiveSignOut: true,
      }),
    ).toBe('clear');
  });

  it('closes private access synchronously and coalesces duplicate sign-out taps', async () => {
    const gate = createMobileSignOutAttemptGate();
    const events: string[] = [];
    let release!: (outcome: 'complete') => void;
    const operation = vi.fn(
      () =>
        new Promise<'complete'>((resolve) => {
          events.push('operation');
          release = resolve;
        }),
    );
    const first = beginMobileSignOutAttempt({
      gate,
      closePrivateAccess: () => events.push('private_closed'),
      operation,
    });
    expect(events).toEqual(['private_closed']);
    const second = beginMobileSignOutAttempt({
      gate,
      closePrivateAccess: () => events.push('private_closed_again'),
      operation,
    });
    expect(second).toBe(first);
    await Promise.resolve();
    expect(events).toEqual(['private_closed', 'operation']);
    expect(operation).toHaveBeenCalledOnce();

    release('complete');
    await expect(Promise.all([first, second])).resolves.toEqual(['complete', 'complete']);
    await expect(gate.run(async () => 'complete')).resolves.toBe('complete');
  });

  it('does not strand signed-out restoration when secure-storage cleanup fails', async () => {
    await expect(
      clearMobileDeviceStateSafely(async () => {
        throw new Error('fixture secure storage unavailable');
      }),
    ).resolves.toBe(false);
    await expect(clearMobileDeviceStateSafely(async () => undefined)).resolves.toBe(true);
  });

  it('attempts every private-state cleanup category when passive sign-out cleanup partially fails', async () => {
    const events: string[] = [];
    await expect(
      clearMobilePrivateDeviceState({
        clearWeeklyReminder: async () => {
          events.push('reminder');
        },
        clearPendingLearningOperations: async () => {
          events.push('pending-learning');
          throw new Error('fixture secure storage unavailable');
        },
        clearHouseholdState: async () => {
          events.push('household');
        },
      }),
    ).resolves.toBe(false);
    expect(events).toEqual(expect.arrayContaining(['reminder', 'pending-learning', 'household']));
  });

  it('attempts identity sign out and reports retry when secure-storage cleanup fails', async () => {
    const signOutIdentitySession = vi.fn(async () => undefined);

    await expect(
      completeMobileSignOut({
        clearDeviceState: async () => {
          throw new Error('secure storage unavailable');
        },
        signOutIdentitySession,
      }),
    ).resolves.toBe('retry_required');
    expect(signOutIdentitySession).toHaveBeenCalledOnce();
  });

  it('reports completion only when device cleanup and identity sign out both finish', async () => {
    await expect(
      completeMobileSignOut({
        clearDeviceState: async () => undefined,
        signOutIdentitySession: async () => undefined,
      }),
    ).resolves.toBe('complete');
  });

  it('returns a retry state instead of throwing provider details', async () => {
    await expect(
      completeMobileSignOut({
        clearDeviceState: async () => undefined,
        signOutIdentitySession: async () => {
          throw new Error('sensitive provider detail');
        },
      }),
    ).resolves.toBe('retry_required');
  });

  it('bounds a never-settling provider sign-out and leaves the pending marker intact', async () => {
    vi.useFakeTimers();
    const completion = completeMobileSignOut({
      clearDeviceState: async () => undefined,
      signOutIdentitySession: () => new Promise<void>(() => undefined),
    });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(mobileIdentitySignOutTimeoutMs - 1);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1);

    await expect(completion).resolves.toBe('retry_required');
    expect(vi.getTimerCount()).toBe(0);
  });
});

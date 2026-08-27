import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { settleIdentitySignOut } from '@boomerbuddy/security';
import {
  clearCustomerSessionState,
  clearClerkSessionAndNavigate,
  clearClerkSessionWhenLoaded,
  createAuthenticationRecoveryCoordinator,
  createSessionRecoveryRetryController,
  productionSessionRecoveryPath,
  shouldBeginProductionAuthenticationRecovery,
} from '../../apps/web/src/lib/auth-recovery';
import { classifyApiRequestSecurity } from '../../apps/web/src/lib/api';

const source = (path: string) => readFile(path, 'utf8');

describe('customer production authentication recovery', () => {
  it('clears household and protected-operation state without deleting unrelated session data', () => {
    const keys = [
      'boomerbuddy.selected-household',
      'bb:protected-self:enroll:person-one:household-one',
      'bb:protected-self:withdraw:person-one:household-one',
      'bb:member-learning:pending:household-one:lesson-answer',
      'unrelated.session-value',
    ];
    const storage = {
      get length() {
        return keys.length;
      },
      key: (index: number) => keys[index] ?? null,
      removeItem: (key: string) => {
        const index = keys.indexOf(key);
        if (index >= 0) keys.splice(index, 1);
      },
    };

    clearCustomerSessionState(storage);

    expect(keys).toEqual(['unrelated.session-value']);
  });

  it('bounds a nonsettling Clerk cleanup and reports the terminal recovery outcome', async () => {
    vi.useFakeTimers();
    try {
      const cleanup = settleIdentitySignOut({
        clearIdentitySession: () => new Promise<void>(() => undefined),
      });

      await vi.advanceTimersByTimeAsync(2_000);

      await expect(cleanup).resolves.toBe('cleanup_timed_out');
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces concurrent unauthorized responses into one clear and one Clerk sign-out', async () => {
    const coordinator = createAuthenticationRecoveryCoordinator();
    const clearLocalState = vi.fn();
    const fallbackNavigation = vi.fn();
    let releaseSignOut: (() => void) | undefined;
    const signOut = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseSignOut = resolve;
        }),
    );
    coordinator.register(signOut);

    const first = coordinator.begin({ clearLocalState, fallbackNavigation });
    const second = coordinator.begin({ clearLocalState, fallbackNavigation });
    const third = coordinator.begin({ clearLocalState, fallbackNavigation });

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(clearLocalState).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledOnce());
    expect(fallbackNavigation).not.toHaveBeenCalled();

    releaseSignOut?.();
    await Promise.all([first, second, third]);
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('uses one terminal same-origin fallback when Clerk recovery fails', async () => {
    const coordinator = createAuthenticationRecoveryCoordinator();
    const clearLocalState = vi.fn();
    const fallbackNavigation = vi.fn();
    coordinator.register(async () => {
      throw new Error('synthetic revoked or expired session');
    });

    await coordinator.begin({ clearLocalState, fallbackNavigation });

    expect(clearLocalState).toHaveBeenCalledOnce();
    expect(fallbackNavigation).toHaveBeenCalledOnce();
    expect(productionSessionRecoveryPath).toBe('/sign-in/session-recovery');
  });

  it('explicitly navigates after Clerk resolves without navigating for a zero-session client', async () => {
    const signOut = vi.fn(async () => undefined);
    const navigate = vi.fn();

    await expect(
      clearClerkSessionAndNavigate({ clearClerkSession: signOut, navigate }),
    ).resolves.toBe('cleared');

    expect(signOut).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('does not invoke the installed IsomorphicClerk sign-out semantics until Clerk is loaded', async () => {
    let loaded = false;
    let waitCount = 0;
    let unloadedQueueCount = 0;
    const signOut = vi.fn(() => {
      if (!loaded) unloadedQueueCount += 1;
      return Promise.resolve();
    });

    await clearClerkSessionWhenLoaded({
      clearClerkSession: signOut,
      isLoaded: () => loaded,
      pollIntervalMs: 25,
      timeoutMs: 75,
      wait: () => {
        waitCount += 1;
        if (waitCount === 2) loaded = true;
        return Promise.resolve();
      },
    });

    expect(waitCount).toBe(2);
    expect(unloadedQueueCount).toBe(0);
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('times out Clerk readiness without signing out and still reaches automatic terminal recovery', async () => {
    const signOut = vi.fn(async () => undefined);
    const navigate = vi.fn();
    const wait = vi.fn(async () => undefined);

    await expect(
      clearClerkSessionAndNavigate({
        clearClerkSession: () =>
          clearClerkSessionWhenLoaded({
            clearClerkSession: signOut,
            isLoaded: () => false,
            pollIntervalMs: 25,
            timeoutMs: 50,
            wait,
          }),
        navigate,
      }),
    ).resolves.toBe('cleanup_failed');

    expect(wait).toHaveBeenCalledTimes(2);
    expect(signOut).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('still navigates to the terminal route when Clerk cleanup rejects', async () => {
    const signOut = vi.fn(async () => {
      throw new Error('synthetic Clerk cleanup failure');
    });
    const navigate = vi.fn();

    await expect(
      clearClerkSessionAndNavigate({ clearClerkSession: signOut, navigate }),
    ).resolves.toBe('cleanup_failed');

    expect(signOut).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('holds the concurrent latch through navigation settling and rearms if navigation never starts', async () => {
    const coordinator = createAuthenticationRecoveryCoordinator();
    const clearLocalState = vi.fn();
    const fallbackNavigation = vi.fn();
    const signOut = vi.fn(async () => undefined);
    let scheduledRearm: (() => void) | undefined;
    coordinator.register(signOut);
    const input = {
      clearLocalState,
      fallbackNavigation,
      hasReachedRecoveryDestination: () => false,
      scheduleRearm: (callback: () => void) => {
        scheduledRearm = callback;
      },
    };

    const first = coordinator.begin(input);
    await first;
    const stillLatched = coordinator.begin(input);
    expect(stillLatched).toBe(first);
    expect(signOut).toHaveBeenCalledOnce();

    scheduledRearm?.();
    const rearmed = coordinator.begin(input);
    expect(rearmed).not.toBe(first);
    await rearmed;
    expect(clearLocalState).toHaveBeenCalledTimes(2);
    expect(signOut).toHaveBeenCalledTimes(2);
  });

  it('treats only production 401 as session recovery and preserves 403 authorization failures', () => {
    expect(shouldBeginProductionAuthenticationRecovery(401, 'production', true)).toBe(true);
    expect(shouldBeginProductionAuthenticationRecovery(401, 'development', true)).toBe(false);
    expect(shouldBeginProductionAuthenticationRecovery(403, 'production', true)).toBe(false);
    expect(shouldBeginProductionAuthenticationRecovery(500, 'production', true)).toBe(false);
    expect(shouldBeginProductionAuthenticationRecovery(401, 'production', false)).toBe(false);
  });

  it('preserves an anonymous Public Check result across the expected sign-in handoff', () => {
    const conversionSave = classifyApiRequestSecurity(
      '/v1/public/checks/check-public-one/save',
      'POST',
      'conversion_save',
    );
    expect(conversionSave).toEqual({
      anonymousPublicRequest: false,
      intentionalSignOut: false,
      authenticationRecoveryEligible: false,
    });
    expect(
      shouldBeginProductionAuthenticationRecovery(
        401,
        'production',
        conversionSave.authenticationRecoveryEligible,
      ),
    ).toBe(false);

    const ordinaryAuthenticatedRequest = classifyApiRequestSecurity('/v1/me', 'GET');
    expect(ordinaryAuthenticatedRequest.authenticationRecoveryEligible).toBe(true);
    const householdDiscovery = classifyApiRequestSecurity('/v1/me', 'GET', 'household_discovery');
    expect(householdDiscovery.authenticationRecoveryEligible).toBe(false);
    const householdName = classifyApiRequestSecurity('/v1/family', 'GET', 'household_name');
    expect(householdName.authenticationRecoveryEligible).toBe(false);
    expect(() => classifyApiRequestSecurity('/v1/family', 'GET', 'household_discovery')).toThrow(
      'limited to the exact Public Check handoff request',
    );
    expect(() => classifyApiRequestSecurity('/v1/me', 'GET', 'household_name')).toThrow(
      'limited to the exact Public Check handoff request',
    );
    expect(() =>
      classifyApiRequestSecurity(
        '/v1/public/checks/check-public-one/save',
        'GET',
        'conversion_save',
      ),
    ).toThrow('limited to the exact Public Check handoff request');
  });

  it('coalesces retry while busy and keeps the successful state latched for navigation', async () => {
    let releaseSignOut: (() => void) | undefined;
    const signOut = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseSignOut = resolve;
        }),
    );
    const navigate = vi.fn();
    const states: Array<{ readonly busy: boolean; readonly error: string }> = [];
    const retry = createSessionRecoveryRetryController({
      clearClerkSession: signOut,
      confirmNavigation: async () => true,
      navigate,
      onStateChange: (state) => states.push(state),
    });

    const first = retry.retry();
    const second = retry.retry();
    expect(second).toBe(first);
    expect(retry.state()).toEqual({ busy: true, error: '' });
    expect(signOut).toHaveBeenCalledOnce();

    releaseSignOut?.();
    await expect(first).resolves.toBe('navigated');
    expect(navigate).toHaveBeenCalledOnce();
    await expect(retry.retry()).resolves.toBe('busy');
    expect(states).toEqual([{ busy: true, error: '' }]);
  });

  it('keeps retry terminal with a visible error after cleanup or navigation failure', async () => {
    const cleanupStates: Array<{ readonly busy: boolean; readonly error: string }> = [];
    const cleanupNavigate = vi.fn();
    const cleanupRetry = createSessionRecoveryRetryController({
      clearClerkSession: async () => {
        throw new Error('synthetic cleanup failure');
      },
      confirmNavigation: async () => true,
      navigate: cleanupNavigate,
      onStateChange: (state) => cleanupStates.push(state),
    });

    await expect(cleanupRetry.retry()).resolves.toBe('cleanup_failed');
    expect(cleanupNavigate).not.toHaveBeenCalled();
    expect(cleanupRetry.state()).toMatchObject({ busy: false });
    expect(cleanupRetry.state().error).toContain('could not confirm that the session was cleared');

    const navigationStates: Array<{ readonly busy: boolean; readonly error: string }> = [];
    const navigationRetry = createSessionRecoveryRetryController({
      clearClerkSession: async () => undefined,
      confirmNavigation: async () => false,
      navigate: vi.fn(),
      onStateChange: (state) => navigationStates.push(state),
    });

    await expect(navigationRetry.retry()).resolves.toBe('navigation_failed');
    expect(navigationRetry.state()).toMatchObject({ busy: false });
    expect(navigationRetry.state().error).toContain('could not open a fresh sign-in page');
    expect(cleanupStates.at(-1)?.error).not.toBe('');
    expect(navigationStates.at(-1)?.error).not.toBe('');
  });

  it('keeps an unloaded timeout terminal, then succeeds once Clerk becomes loaded', async () => {
    let loaded = false;
    const signOut = vi.fn(async () => undefined);
    const navigate = vi.fn();
    const retry = createSessionRecoveryRetryController({
      clearClerkSession: () =>
        clearClerkSessionWhenLoaded({
          clearClerkSession: signOut,
          isLoaded: () => loaded,
          pollIntervalMs: 25,
          timeoutMs: 50,
          wait: async () => undefined,
        }),
      confirmNavigation: async () => true,
      navigate,
      onStateChange: vi.fn(),
    });

    await expect(retry.retry()).resolves.toBe('cleanup_failed');
    expect(signOut).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(retry.state().error).toContain('could not confirm that the session was cleared');

    loaded = true;
    await expect(retry.retry()).resolves.toBe('navigated');
    expect(signOut).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('wires every customer API 401 through the boundary without automatic recovery redirects', async () => {
    const [api, recovery, provider, boundary, signIn, publicCheck] = await Promise.all([
      source('apps/web/src/lib/api.ts'),
      source('apps/web/src/lib/auth-recovery.ts'),
      source('apps/web/src/components/identity-provider.tsx'),
      source('apps/web/src/components/production-auth-recovery.tsx'),
      source('apps/web/src/app/sign-in/[[...sign-in]]/page.tsx'),
      source('apps/web/src/app/check/page.tsx'),
    ]);

    expect(api).toContain('shouldBeginProductionAuthenticationRecovery(');
    expect(api).toContain('!anonymousPublicRequest');
    expect(api).toContain('!intentionalSignOut');
    expect(api).toContain('void beginProductionAuthenticationRecovery();');
    expect(api).toContain("publicCheckHandoff === 'conversion_save'");
    expect(api).toContain("publicCheckHandoff === 'household_discovery'");
    expect(api).toContain("publicCheckHandoff === 'household_name'");
    expect(publicCheck).toContain("publicCheckHandoff: 'conversion_save'");
    expect(publicCheck).toContain("publicCheckHandoff: 'household_discovery'");
    expect(publicCheck).toContain("publicCheckHandoff: 'household_name'");
    expect(publicCheck).toContain('setSelectedHouseholdId(householdId)');
    expect(provider).toContain('<ProductionAuthenticationRecovery>{children}');
    expect(boundary).toContain('registerProductionAuthenticationRecovery(async () =>');
    expect(boundary).toContain('clearClerkSessionAndNavigate({');
    expect(boundary).toContain('clearClerkSessionWhenLoaded({');
    expect(boundary).toContain('clearClerkSession: () => clerk.signOut()');
    expect(boundary).toContain('isLoaded: () => clerk.loaded');
    expect(boundary).not.toContain('redirectUrl');
    expect(boundary).toContain('window.location.replace(productionSessionRecoveryPath)');
    expect(recovery).toContain('scheduleRearm: (callback) => window.setTimeout(callback, 1_000)');
    expect(signIn).toContain('pathname === productionSessionRecoveryPath');
    expect(signIn).toContain('createSessionRecoveryRetryController({');
    expect(signIn).toContain('clearClerkSessionWhenLoaded({');
    expect(signIn).toContain('clearCustomerSessionState(window.sessionStorage);');
    expect(signIn).toContain('await clerk.signOut();');
    expect(signIn).toContain('isLoaded: () => clerk.loaded');
    expect(signIn).toContain("window.location.replace('/sign-in')");
    expect(signIn).toMatch(/This page does\s+not continue automatically\./u);
    expect(signIn).toContain('href="/sign-in"');
    expect(recovery).toContain('This page has not continued. Try again or email support.');
  });
});

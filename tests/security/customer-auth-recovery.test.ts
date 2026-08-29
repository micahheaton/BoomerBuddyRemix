import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { settleIdentitySignOut } from '@boomerbuddy/security';
import {
  clearClerkClientSessions,
  clearCustomerSessionState,
  clearMemberAuthenticationProbe,
  clearClerkSessionAndNavigate,
  clearClerkSessionWhenLoaded,
  clearClerkSessionsWithLocalFallback,
  createAuthenticationRecoveryCoordinator,
  createSessionRecoveryRetryController,
  decideMemberAuthenticationProbe,
  hasPendingMemberAuthenticationProbe,
  isSameOriginMemberRedirectTarget,
  isTerminalSessionReset,
  markMemberAuthenticationProbe,
  memberAuthenticationProbeStorageKey,
  productionSessionRecoveryPath,
  productionSessionResetPath,
  productionSessionResetTarget,
  resetBrowserClerkSession,
  shouldBeginProductionAuthenticationRecovery,
} from '../../apps/web/src/lib/auth-recovery';
import { resetCustomerBrowserSession } from '../../apps/web/src/app/sign-in/session-reset/route';
import { classifyApiRequestSecurity } from '../../apps/web/src/lib/api';

const source = (path: string) => readFile(path, 'utf8');

describe('customer production authentication recovery', () => {
  it('clears every Clerk session on this browser and requires provider confirmation', async () => {
    const signOut = vi.fn(async (callback: () => void | Promise<void>) => {
      await callback();
    });

    await clearClerkClientSessions({ signOut });

    expect(signOut).toHaveBeenCalledOnce();
    expect(signOut).toHaveBeenCalledWith(expect.any(Function));
  });

  it('rejects a resolved Clerk no-op that never invokes its completion callback', async () => {
    const signOut = vi.fn(async () => undefined);

    await expect(clearClerkClientSessions({ signOut })).rejects.toThrow(
      'did not confirm that this browser session was cleared',
    );
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('uses the same-origin reset fallback after a rejected or resolved-no-op Clerk cleanup', async () => {
    const resetLocalSession = vi.fn(async () => undefined);

    await clearClerkSessionsWithLocalFallback({
      clearClerkSessions: () => clearClerkClientSessions({ signOut: vi.fn(async () => undefined) }),
      resetLocalSession,
    });

    expect(resetLocalSession).toHaveBeenCalledOnce();
  });

  it('does not call the local fallback after Clerk confirms cleanup', async () => {
    const resetLocalSession = vi.fn(async () => undefined);

    await clearClerkSessionsWithLocalFallback({
      clearClerkSessions: () =>
        clearClerkClientSessions({
          signOut: vi.fn(async (callback: () => void | Promise<void>) => callback()),
        }),
      resetLocalSession,
    });

    expect(resetLocalSession).not.toHaveBeenCalled();
  });

  it('posts the browser reset only to the fixed same-origin route with credentials', async () => {
    const fetchSessionReset = vi.fn(async () => new Response(null, { status: 204 }));

    await resetBrowserClerkSession(fetchSessionReset as typeof fetch);

    expect(fetchSessionReset).toHaveBeenCalledWith(productionSessionResetPath, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
  });

  it('rejects a browser reset response that did not clear the cookie', async () => {
    const fetchSessionReset = vi.fn(async () => new Response(null, { status: 403 }));

    await expect(resetBrowserClerkSession(fetchSessionReset as typeof fetch)).rejects.toThrow(
      'status 403',
    );
  });

  it('expires only the host-scoped Clerk session cookie for an exact same-origin POST', () => {
    const origin = 'https://app.boomerbuddy.net';
    const response = resetCustomerBrowserSession(
      new Request(`${origin}${productionSessionResetPath}`, {
        method: 'POST',
        headers: { origin },
      }),
      { BB_PUBLIC_ORIGIN: origin, NODE_ENV: 'production' },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('__session=;');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('SameSite=lax');
    expect(cookie).toContain('Secure');
    expect(cookie).not.toContain('__client_uat');
  });

  it('rejects a cross-origin or unconfigured browser-session reset', () => {
    const origin = 'https://app.boomerbuddy.net';
    const crossOrigin = resetCustomerBrowserSession(
      new Request(`${origin}${productionSessionResetPath}`, {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
      }),
      { BB_PUBLIC_ORIGIN: origin, NODE_ENV: 'production' },
    );
    const unconfigured = resetCustomerBrowserSession(
      new Request(`${origin}${productionSessionResetPath}`, {
        method: 'POST',
        headers: { origin },
      }),
      { NODE_ENV: 'production' },
    );

    expect(crossOrigin.status).toBe(403);
    expect(crossOrigin.headers.get('set-cookie')).toBeNull();
    expect(unconfigured.status).toBe(503);
    expect(unconfigured.headers.get('set-cookie')).toBeNull();
  });

  it('marks only the explicit post-reset sign-in target as terminal', () => {
    expect(productionSessionResetTarget).toBe('/sign-in?session_reset=1');
    expect(isTerminalSessionReset('?session_reset=1')).toBe(true);
    expect(isTerminalSessionReset('?session_reset=0')).toBe(false);
    expect(isTerminalSessionReset('?redirect_url=%2Fmember')).toBe(false);
  });

  it('recognizes only same-origin member paths as valid probe destinations', () => {
    const origin = 'https://app.boomerbuddy.net';

    expect(isSameOriginMemberRedirectTarget(`${origin}/member`, origin)).toBe(true);
    expect(
      isSameOriginMemberRedirectTarget(`${origin}/member/account-security?return=billing`, origin),
    ).toBe(true);
    expect(isSameOriginMemberRedirectTarget('/member', origin)).toBe(true);

    for (const value of [
      null,
      '',
      'not a URL',
      'https://boomerbuddy.net/member',
      'https://app.boomerbuddy.net/member-danger',
      'https://app.boomerbuddy.net.evil.example/member',
      'https://user:password@app.boomerbuddy.net/member',
    ]) {
      expect(isSameOriginMemberRedirectTarget(value, origin)).toBe(false);
    }
  });

  it('sends the first ordinary signed-in redirect through one member probe without recovery', () => {
    expect(
      decideMemberAuthenticationProbe({
        currentOrigin: 'https://app.boomerbuddy.net',
        probePending: false,
        redirectTarget: '/member',
      }),
    ).toEqual({ action: 'navigate', target: '/member' });
    expect(
      decideMemberAuthenticationProbe({
        currentOrigin: 'https://app.boomerbuddy.net',
        probePending: false,
        redirectTarget: '/member/account-security?return=billing',
      }),
    ).toEqual({ action: 'navigate', target: '/member/account-security?return=billing' });
    expect(
      decideMemberAuthenticationProbe({
        currentOrigin: 'https://app.boomerbuddy.net',
        probePending: false,
        redirectTarget: 'https://evil.example/member',
      }),
    ).toEqual({ action: 'navigate', target: '/member' });
  });

  it('shows recovery only when a marked member probe returns to sign in', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(hasPendingMemberAuthenticationProbe(storage)).toBe(false);
    markMemberAuthenticationProbe(storage);
    expect(values.get(memberAuthenticationProbeStorageKey)).toBe('pending');
    expect(hasPendingMemberAuthenticationProbe(storage)).toBe(true);
    expect(
      decideMemberAuthenticationProbe({
        currentOrigin: 'https://app.boomerbuddy.net',
        probePending: hasPendingMemberAuthenticationProbe(storage),
        redirectTarget: '/member',
      }),
    ).toEqual({ action: 'recover' });
    clearMemberAuthenticationProbe(storage);
    expect(hasPendingMemberAuthenticationProbe(storage)).toBe(false);
  });

  it('clears household and protected-operation state without deleting unrelated session data', () => {
    const keys = [
      'boomerbuddy.selected-household',
      memberAuthenticationProbeStorageKey,
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
    const [api, recovery, provider, boundary, signIn, sessionReset, household, publicCheck] =
      await Promise.all([
        source('apps/web/src/lib/api.ts'),
        source('apps/web/src/lib/auth-recovery.ts'),
        source('apps/web/src/components/identity-provider.tsx'),
        source('apps/web/src/components/production-auth-recovery.tsx'),
        source('apps/web/src/app/sign-in/[[...sign-in]]/page.tsx'),
        source('apps/web/src/app/sign-in/session-reset/route.ts'),
        source('apps/web/src/components/household-context.tsx'),
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
    expect(boundary).toContain('clearClerkClientSessions({');
    expect(boundary).toContain('clearClerkSessionsWithLocalFallback({');
    expect(boundary).toContain('resetBrowserClerkSession()');
    expect(boundary).toContain('clerk.signOut(callback)');
    expect(boundary).not.toContain('sessionId');
    expect(boundary).toContain('isLoaded: () => clerk.loaded');
    expect(boundary).not.toContain('redirectUrl');
    expect(boundary).toContain('window.location.replace(productionSessionRecoveryPath)');
    expect(recovery).toContain('scheduleRearm: (callback) => window.setTimeout(callback, 1_000)');
    expect(signIn).toContain('pathname === productionSessionRecoveryPath');
    expect(signIn).toContain('createSessionRecoveryRetryController({');
    expect(signIn).toContain('clearClerkSessionWhenLoaded({');
    expect(signIn).toContain('clearClerkSessionsWithLocalFallback({');
    expect(signIn).toContain('clearCustomerSessionState(window.sessionStorage);');
    expect(signIn).toContain('clearClerkClientSessions({');
    expect(signIn).toContain('clerk.signOut(callback)');
    expect(signIn).toContain('isLoaded: () => clerk.loaded');
    expect(signIn).toMatch(/<ClerkLoaded>\s*<ProductionLoadedSignIn\s*\/>\s*<\/ClerkLoaded>/u);
    expect(signIn).toContain('const { isLoaded, isSignedIn } = useAuth();');
    expect(signIn).toContain('if (!isLoaded)');
    expect(signIn).toContain('if (isSignedIn) return <ProductionSignedInSignInRecovery />;');
    expect(signIn).not.toMatch(/\bSignedIn\b/u);
    expect(signIn).not.toMatch(/\bSignedOut\b/u);
    expect(signIn).toContain('decideMemberAuthenticationProbe({');
    expect(signIn).toContain('probePending: hasPendingMemberAuthenticationProbe(');
    expect(signIn).toContain("new URL(window.location.href).searchParams.get('redirect_url')");
    expect(signIn).toContain("if (decision.action === 'recover')");
    expect(signIn).toContain('markMemberAuthenticationProbe(window.sessionStorage)');
    expect(signIn).toContain('window.location.replace(decision.target)');
    expect(signIn).toContain('if (isTerminalSessionReset(window.location.search))');
    expect(signIn).toContain('setTerminalResetFailure(true)');
    expect(signIn).toContain('memberNavigationStarted.current = true');
    expect(signIn).toContain('onClick={() => void retry.retry()}');
    expect(signIn).toContain('Clear browser sign-ins and sign in again');
    expect(signIn).not.toContain('void retry.retry();');
    expect(signIn).toContain('window.location.replace(productionSessionResetTarget)');
    expect(signIn).toMatch(/This page does\s+not continue automatically\./u);
    expect(signIn).toContain('href="/sign-in"');
    expect(sessionReset).toContain("request.headers.get('origin') !== configuredOrigin");
    expect(sessionReset).toContain("response.cookies.set('__session', ''");
    expect(sessionReset).not.toContain('__client_uat');
    expect(household).toContain(
      'if (value !== undefined) clearMemberAuthenticationProbe(window.sessionStorage);',
    );
    expect(recovery).toContain('This page has not continued. Try again or email support.');
  });
});

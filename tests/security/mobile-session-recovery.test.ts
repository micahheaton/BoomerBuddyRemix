import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureMobileAuthenticationContext,
  configureMobileAuthentication,
  isMobileAuthenticationContextCurrent,
  readCurrentMobileAuthenticationToken,
  readMobileAuthenticationToken,
  recoverUnauthorizedMobileSession,
  type MobileAuthenticationBridge,
} from '../../apps/mobile/src/authentication';

describe('mobile authentication recovery', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads session material only through the configured authentication bridge', async () => {
    const getToken = vi.fn(async () => 'clerk-mobile-token');
    const dispose = configureMobileAuthentication({
      getToken,
      recoverUnauthorizedSession: async () => undefined,
    });

    await expect(readMobileAuthenticationToken()).resolves.toBe('clerk-mobile-token');
    expect(getToken).toHaveBeenCalledWith({ skipCache: false });

    dispose();
    await expect(readMobileAuthenticationToken()).resolves.toBeNull();
  });

  it('does not release a token after its household session stops being current', async () => {
    let current = true;
    let releaseToken!: (token: string) => void;
    const readToken = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          releaseToken = resolve;
        }),
    );
    const token = readCurrentMobileAuthenticationToken({
      isCurrent: () => current,
      readToken,
    });
    expect(readToken).toHaveBeenCalledOnce();

    current = false;
    releaseToken('fresh-rotating-jti-token');

    await expect(token).resolves.toBeNull();
  });

  it('coalesces forced token refreshes and bypasses the Clerk token cache', async () => {
    const getToken = vi.fn(async () => 'fresh-clerk-mobile-token');
    const dispose = configureMobileAuthentication({
      getToken,
      recoverUnauthorizedSession: async () => undefined,
    });

    await expect(
      Promise.all([
        readMobileAuthenticationToken({ skipCache: true }),
        readMobileAuthenticationToken({ skipCache: true }),
      ]),
    ).resolves.toEqual(['fresh-clerk-mobile-token', 'fresh-clerk-mobile-token']);
    expect(getToken).toHaveBeenCalledOnce();
    expect(getToken).toHaveBeenCalledWith({ skipCache: true });
    dispose();
  });

  it('coalesces concurrent unauthorized responses into one recovery action', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const recoverUnauthorizedSession = vi.fn(() => gate);
    const dispose = configureMobileAuthentication({
      getToken: async () => 'clerk-mobile-token',
      recoverUnauthorizedSession,
    });

    const first = recoverUnauthorizedMobileSession();
    const second = recoverUnauthorizedMobileSession();
    await Promise.resolve();
    expect(recoverUnauthorizedSession).toHaveBeenCalledOnce();

    release?.();
    await Promise.all([first, second]);
    dispose();
  });

  it('rejects a cached token result that resolves after authentication bridge replacement', async () => {
    let releaseOldToken!: (token: string | null) => void;
    const oldToken = new Promise<string | null>((resolve) => {
      releaseOldToken = resolve;
    });
    const oldGetToken = vi.fn(() => oldToken);
    const disposeOld = configureMobileAuthentication({
      getToken: oldGetToken,
      recoverUnauthorizedSession: async () => undefined,
    });
    const staleToken = readMobileAuthenticationToken();
    const staleTokenRejection = expect(staleToken).rejects.toThrow(
      'Authentication context changed',
    );
    expect(oldGetToken).toHaveBeenCalledOnce();

    const newGetToken = vi.fn(async () => 'new-session-token');
    const disposeNew = configureMobileAuthentication({
      getToken: newGetToken,
      recoverUnauthorizedSession: async () => undefined,
    });
    releaseOldToken('old-session-token');

    await staleTokenRejection;
    await expect(readMobileAuthenticationToken()).resolves.toBe('new-session-token');
    expect(newGetToken).toHaveBeenCalledOnce();
    disposeOld();
    disposeNew();
  });

  it('never carries a forced refresh or recovery into a replacement authentication bridge', async () => {
    let releaseOldToken!: (token: string | null) => void;
    let releaseOldRecovery!: () => void;
    const oldToken = new Promise<string | null>((resolve) => {
      releaseOldToken = resolve;
    });
    const oldRecovery = new Promise<void>((resolve) => {
      releaseOldRecovery = resolve;
    });
    const oldGetToken = vi.fn(() => oldToken);
    const oldRecover = vi.fn(() => oldRecovery);
    const disposeOld = configureMobileAuthentication({
      getToken: oldGetToken,
      recoverUnauthorizedSession: oldRecover,
    });
    const staleToken = readMobileAuthenticationToken({ skipCache: true });
    const staleTokenRejection = expect(staleToken).rejects.toThrow(
      'Authentication context changed',
    );
    const staleRecovery = recoverUnauthorizedMobileSession();
    await Promise.resolve();
    expect(oldGetToken).toHaveBeenCalledOnce();
    expect(oldRecover).toHaveBeenCalledOnce();

    const newGetToken = vi.fn(async () => 'new-session-token');
    const newRecover = vi.fn(async () => undefined);
    const disposeNew = configureMobileAuthentication({
      getToken: newGetToken,
      recoverUnauthorizedSession: newRecover,
    });
    await expect(readMobileAuthenticationToken({ skipCache: true })).resolves.toBe(
      'new-session-token',
    );
    await expect(recoverUnauthorizedMobileSession()).resolves.toBeUndefined();
    expect(newGetToken).toHaveBeenCalledOnce();
    expect(newRecover).toHaveBeenCalledOnce();

    releaseOldToken('old-session-token');
    releaseOldRecovery();
    await staleTokenRejection;
    await expect(staleRecovery).resolves.toBeUndefined();
    disposeOld();
    disposeNew();
  });

  it('turns a deferred old-session recovery guard false before replacement cleanup', async () => {
    let releaseOldRecovery!: () => void;
    const oldRecoveryGate = new Promise<void>((resolve) => {
      releaseOldRecovery = resolve;
    });
    const oldCleanup = vi.fn(async () => undefined);
    const oldSignOut = vi.fn(async () => undefined);
    const oldRecover = vi.fn(async (guard: { readonly isCurrent: () => boolean }) => {
      await oldRecoveryGate;
      if (!guard.isCurrent()) return;
      await oldCleanup();
      if (guard.isCurrent()) await oldSignOut();
    });
    const disposeOld = configureMobileAuthentication({
      getToken: async () => 'old-session-token',
      recoverUnauthorizedSession: oldRecover,
    });
    const oldContext = captureMobileAuthenticationContext();
    const staleRecovery = recoverUnauthorizedMobileSession(oldContext);
    await vi.waitFor(() => expect(oldRecover).toHaveBeenCalledOnce());

    disposeOld();
    const newRecover = vi.fn(async () => undefined);
    const disposeNew = configureMobileAuthentication({
      getToken: async () => 'new-session-token',
      recoverUnauthorizedSession: newRecover,
    });
    releaseOldRecovery();

    await expect(staleRecovery).resolves.toBeUndefined();
    expect(isMobileAuthenticationContextCurrent(oldContext)).toBe(false);
    expect(oldCleanup).not.toHaveBeenCalled();
    expect(oldSignOut).not.toHaveBeenCalled();
    expect(newRecover).not.toHaveBeenCalled();
    disposeNew();
  });

  it('invalidates a deferred manual sign-out action before a replacement session is touched', async () => {
    const disposeOld = configureMobileAuthentication({
      getToken: async () => 'old-session-token',
      recoverUnauthorizedSession: async () => undefined,
    });
    const oldContext = captureMobileAuthenticationContext();
    let releaseDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const clearOldDeviceState = vi.fn(async () => undefined);
    const signOutOldIdentity = vi.fn(async () => undefined);
    const staleSignOut = (async () => {
      await deleteGate;
      if (!isMobileAuthenticationContextCurrent(oldContext)) return;
      await clearOldDeviceState();
      if (isMobileAuthenticationContextCurrent(oldContext)) await signOutOldIdentity();
    })();

    disposeOld();
    const newSignOut = vi.fn(async () => undefined);
    const disposeNew = configureMobileAuthentication({
      getToken: async () => 'new-session-token',
      recoverUnauthorizedSession: async () => newSignOut(),
    });
    releaseDelete();

    await staleSignOut;
    expect(clearOldDeviceState).not.toHaveBeenCalled();
    expect(signOutOldIdentity).not.toHaveBeenCalled();
    expect(newSignOut).not.toHaveBeenCalled();
    disposeNew();
  });

  it('invalidates work queued by a disposed authentication bridge before it can start', async () => {
    const getToken = vi.fn(async () => 'disposed-session-token');
    const recoverUnauthorizedSession = vi.fn(async () => undefined);
    const dispose = configureMobileAuthentication({ getToken, recoverUnauthorizedSession });
    const staleToken = readMobileAuthenticationToken({ skipCache: true });
    const staleTokenRejection = expect(staleToken).rejects.toThrow(
      'Authentication context changed',
    );
    const staleRecovery = recoverUnauthorizedMobileSession();

    dispose();

    await staleTokenRejection;
    await expect(staleRecovery).resolves.toBeUndefined();
    expect(getToken).not.toHaveBeenCalled();
    expect(recoverUnauthorizedSession).not.toHaveBeenCalled();
  });

  it('keeps the safe session-ended response even if local cleanup fails', async () => {
    const dispose = configureMobileAuthentication({
      getToken: async () => null,
      recoverUnauthorizedSession: async () => {
        throw new Error('sensitive provider detail');
      },
    });

    await expect(recoverUnauthorizedMobileSession()).resolves.toBeUndefined();
    dispose();
  });

  it('evicts a timed-out coalesced forced refresh so a later request can retry', async () => {
    vi.useFakeTimers();
    const getToken = vi
      .fn<MobileAuthenticationBridge['getToken']>()
      .mockImplementationOnce(() => new Promise<string | null>(() => undefined))
      .mockResolvedValueOnce('retry-mobile-token');
    const dispose = configureMobileAuthentication({
      getToken,
      recoverUnauthorizedSession: async () => undefined,
    });
    const first = readMobileAuthenticationToken({ skipCache: true });
    const second = readMobileAuthenticationToken({ skipCache: true });
    const firstRejection = expect(first).rejects.toThrow('Authentication provider timed out');
    const secondRejection = expect(second).rejects.toThrow('Authentication provider timed out');
    await vi.advanceTimersByTimeAsync(0);
    expect(getToken).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(15_000);

    await Promise.all([firstRejection, secondRejection]);
    await expect(readMobileAuthenticationToken({ skipCache: true })).resolves.toBe(
      'retry-mobile-token',
    );
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    dispose();
  });

  it('evicts timed-out coalesced recovery so a later request can retry cleanup', async () => {
    vi.useFakeTimers();
    const recoverUnauthorizedSession = vi
      .fn<MobileAuthenticationBridge['recoverUnauthorizedSession']>()
      .mockImplementationOnce(() => new Promise<void>(() => undefined))
      .mockResolvedValueOnce(undefined);
    const dispose = configureMobileAuthentication({
      getToken: async () => null,
      recoverUnauthorizedSession,
    });
    const first = recoverUnauthorizedMobileSession();
    const second = recoverUnauthorizedMobileSession();
    await vi.advanceTimersByTimeAsync(0);
    expect(recoverUnauthorizedSession).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(15_000);

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    await expect(recoverUnauthorizedMobileSession()).resolves.toBeUndefined();
    expect(recoverUnauthorizedSession).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    dispose();
  });
});

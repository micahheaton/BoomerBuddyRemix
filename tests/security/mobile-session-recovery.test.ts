import { describe, expect, it, vi } from 'vitest';
import {
  configureMobileAuthentication,
  readMobileAuthenticationToken,
  recoverUnauthorizedMobileSession,
} from '../../apps/mobile/src/authentication';

describe('mobile authentication recovery', () => {
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
});

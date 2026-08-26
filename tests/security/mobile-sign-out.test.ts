import { describe, expect, it, vi } from 'vitest';
import {
  clearMobileDeviceStateSafely,
  completeMobileSignOut,
} from '../../apps/mobile/src/sign-out';

describe('mobile sign-out recovery', () => {
  it('does not strand signed-out restoration when secure-storage cleanup fails', async () => {
    await expect(
      clearMobileDeviceStateSafely(async () => {
        throw new Error('fixture secure storage unavailable');
      }),
    ).resolves.toBe(false);
    await expect(clearMobileDeviceStateSafely(async () => undefined)).resolves.toBe(true);
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
});

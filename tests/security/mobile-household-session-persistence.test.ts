import { beforeEach, describe, expect, it, vi } from 'vitest';

const secureStore = vi.hoisted(() => ({
  deleteItemAsync: vi.fn<(key: string) => Promise<void>>(),
  getItemAsync: vi.fn<(key: string) => Promise<string | null>>(),
  isAvailableAsync: vi.fn<() => Promise<boolean>>(),
  setItemAsync: vi.fn<(key: string, value: string, options?: unknown) => Promise<void>>(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
}));

vi.mock('expo-secure-store', () => secureStore);
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

async function sessionModule() {
  vi.resetModules();
  return import('../../apps/mobile/src/session');
}

describe('mobile household selection persistence', () => {
  beforeEach(() => {
    secureStore.deleteItemAsync.mockReset().mockResolvedValue(undefined);
    secureStore.getItemAsync.mockReset().mockResolvedValue(null);
    secureStore.isAvailableAsync.mockReset().mockResolvedValue(true);
    secureStore.setItemAsync.mockReset().mockResolvedValue(undefined);
  });

  it('restores no preference instead of blocking a valid session when secure storage cannot read', async () => {
    secureStore.getItemAsync.mockRejectedValueOnce(new Error('fixture keychain read failure'));
    const session = await sessionModule();

    await expect(session.restoreSelectedHouseholdId()).resolves.toBeNull();
    expect(session.readSelectedHouseholdId()).toBeNull();
  });

  it('keeps the in-memory selection usable when secure storage cannot write', async () => {
    secureStore.setItemAsync.mockRejectedValueOnce(new Error('fixture keychain write failure'));
    const session = await sessionModule();

    await expect(session.setSelectedHouseholdId('household-preferred')).resolves.toBeUndefined();
    expect(session.readSelectedHouseholdId()).toBe('household-preferred');
  });

  it('clears the in-memory selection even when persisted preference deletion fails', async () => {
    secureStore.deleteItemAsync.mockRejectedValueOnce(
      new Error('fixture preference deletion failure'),
    );
    const session = await sessionModule();
    await session.setSelectedHouseholdId('household-preferred');

    await expect(session.setSelectedHouseholdId(null)).resolves.toBeUndefined();
    expect(session.readSelectedHouseholdId()).toBeNull();
  });

  it.each(['availability', 'deletion'] as const)(
    'does not strand valid session restoration when legacy token %s fails',
    async (failure) => {
      if (failure === 'availability') {
        secureStore.isAvailableAsync.mockRejectedValueOnce(
          new Error('fixture keychain availability failure'),
        );
      } else {
        secureStore.deleteItemAsync.mockRejectedValueOnce(
          new Error('fixture legacy token deletion failure'),
        );
      }
      const session = await sessionModule();
      const restoreAuthenticatedPrincipal = vi.fn(async () => ({ id: 'principal-valid' }));

      await expect(session.clearLegacyDevelopmentSessionToken()).resolves.toBeUndefined();
      await expect(session.restoreSelectedHouseholdId()).resolves.toBeNull();
      await expect(restoreAuthenticatedPrincipal()).resolves.toEqual({ id: 'principal-valid' });
      expect(restoreAuthenticatedPrincipal).toHaveBeenCalledOnce();
    },
  );
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readCurrentMobileAuthenticationToken } from '../../apps/mobile/src/authentication';

const secureStore = vi.hoisted(() => ({
  deleteItemAsync: vi.fn<(key: string) => Promise<void>>(),
  getItemAsync: vi.fn<(key: string) => Promise<string | null>>(),
  isAvailableAsync: vi.fn<() => Promise<boolean>>(),
  setItemAsync: vi.fn<(key: string, value: string, options?: unknown) => Promise<void>>(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
}));

vi.mock('../../apps/mobile/src/secure-store', () => secureStore);
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

  it('keeps the local adapter as the production Expo Secure Store boundary', () => {
    const adapter = readFileSync(
      join(process.cwd(), 'apps', 'mobile', 'src', 'secure-store.ts'),
      'utf8',
    ).trim();

    expect(adapter).toBe("export * from 'expo-secure-store';");
  });

  it('persists and clears only the opaque Clerk session id for pending sign-out', async () => {
    const session = await sessionModule();

    await expect(session.markPendingMobileSignOut('session_pending_one')).resolves.toBe(true);
    expect(session.isMobileSignOutPending()).toBe(true);
    await expect(session.readPendingMobileSignOut()).resolves.toEqual({
      status: 'pending',
      identitySessionId: 'session_pending_one',
    });
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      'boomerbuddy.mobile.pending-sign-out-session',
      'session_pending_one',
      { keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );

    await expect(session.clearPendingMobileSignOut('session_pending_one')).resolves.toBe(true);
    expect(session.isMobileSignOutPending()).toBe(false);
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(
      'boomerbuddy.mobile.pending-sign-out-session',
    );
  });

  it('blocks a cold-start token read even when Clerk can mint a fresh rotating JTI', async () => {
    const firstLaunch = await sessionModule();
    await firstLaunch.markPendingMobileSignOut('session_pending_cold_start');
    secureStore.getItemAsync.mockResolvedValueOnce('session_pending_cold_start');

    const coldStart = await sessionModule();
    await expect(coldStart.readPendingMobileSignOut()).resolves.toEqual({
      status: 'pending',
      identitySessionId: 'session_pending_cold_start',
    });
    const mintFreshToken = vi.fn(async () => 'fresh-token-with-new-jti');

    await expect(
      readCurrentMobileAuthenticationToken({
        isCurrent: () => !coldStart.isMobileSignOutPending(),
        readToken: mintFreshToken,
      }),
    ).resolves.toBeNull();
    expect(mintFreshToken).not.toHaveBeenCalled();
  });

  it('keeps a replacement Clerk session closed until the captured pending session is cleared', async () => {
    const session = await sessionModule();
    await session.markPendingMobileSignOut('session_pending_original');
    const replacementSession = session.beginMobileHouseholdSession('session_replacement');
    const mintReplacementToken = vi.fn(async () => 'replacement-session-token');

    await expect(
      readCurrentMobileAuthenticationToken({
        isCurrent: () =>
          session.isMobileHouseholdSessionCurrent(replacementSession) &&
          !session.isMobileSignOutPending(),
        readToken: mintReplacementToken,
      }),
    ).resolves.toBeNull();
    expect(mintReplacementToken).not.toHaveBeenCalled();
    await expect(session.clearPendingMobileSignOut('session_replacement')).resolves.toBe(false);
    await expect(session.readPendingMobileSignOut()).resolves.toEqual({
      status: 'pending',
      identitySessionId: 'session_pending_original',
    });
  });

  it('fails closed when the pending-sign-out marker cannot be checked', async () => {
    secureStore.getItemAsync.mockRejectedValueOnce(new Error('fixture keychain read failure'));
    const session = await sessionModule();

    await expect(session.readPendingMobileSignOut()).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('reads, writes, and deletes a person-scoped preference with device-only access', async () => {
    secureStore.getItemAsync.mockResolvedValueOnce('household-preferred');
    const session = await sessionModule();
    const householdSession = session.beginMobileHouseholdSession('identity-session-positive');

    await expect(
      session.restoreSelectedHouseholdId(householdSession, 'person-preference-owner'),
    ).resolves.toBe('household-preferred');
    expect(session.readSelectedHouseholdId()).toBeNull();
    expect(secureStore.getItemAsync).toHaveBeenCalledWith(
      'boomerbuddy.mobile.selected-household.person-preference-owner',
    );

    await expect(
      session.setSelectedHouseholdId(
        householdSession,
        'person-preference-owner',
        'household-preferred',
      ),
    ).resolves.toBeUndefined();
    expect(session.readSelectedHouseholdId()).toBe('household-preferred');
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      'boomerbuddy.mobile.selected-household.person-preference-owner',
      'household-preferred',
      { keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );

    await expect(
      session.setSelectedHouseholdId(householdSession, 'person-preference-owner', null),
    ).resolves.toBeUndefined();
    expect(session.readSelectedHouseholdId()).toBeNull();
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(
      'boomerbuddy.mobile.selected-household.person-preference-owner',
    );
  });

  it('restores no preference instead of blocking a valid session when secure storage cannot read', async () => {
    secureStore.getItemAsync.mockRejectedValueOnce(new Error('fixture keychain read failure'));
    const session = await sessionModule();
    const householdSession = session.beginMobileHouseholdSession('identity-session-read-failure');

    await expect(
      session.restoreSelectedHouseholdId(householdSession, 'person-preference-owner'),
    ).resolves.toBeNull();
    expect(session.readSelectedHouseholdId()).toBeNull();
  });

  it('keeps the in-memory selection usable when secure storage cannot write', async () => {
    secureStore.setItemAsync.mockRejectedValueOnce(new Error('fixture keychain write failure'));
    const session = await sessionModule();
    const householdSession = session.beginMobileHouseholdSession('identity-session-write-failure');

    await expect(
      session.setSelectedHouseholdId(
        householdSession,
        'person-preference-owner',
        'household-preferred',
      ),
    ).resolves.toBeUndefined();
    expect(session.readSelectedHouseholdId()).toBe('household-preferred');
  });

  it('clears the in-memory selection even when persisted preference deletion fails', async () => {
    const session = await sessionModule();
    const householdSession = session.beginMobileHouseholdSession('identity-session-delete-failure');
    await session.setSelectedHouseholdId(
      householdSession,
      'person-preference-owner',
      'household-preferred',
    );
    secureStore.deleteItemAsync.mockRejectedValueOnce(
      new Error('fixture preference deletion failure'),
    );

    await expect(
      session.setSelectedHouseholdId(householdSession, 'person-preference-owner', null),
    ).resolves.toBeUndefined();
    expect(session.readSelectedHouseholdId()).toBeNull();
  });

  it('prevents a deferred old-session restore from overwriting a replacement session', async () => {
    let releaseOldRead!: (value: string | null) => void;
    secureStore.getItemAsync.mockImplementationOnce(
      () =>
        new Promise<string | null>((resolve) => {
          releaseOldRead = resolve;
        }),
    );
    const session = await sessionModule();
    const oldSession = session.beginMobileHouseholdSession('identity-session-old');
    const oldRestore = session.restoreSelectedHouseholdId(oldSession, 'person-shared');
    await vi.waitFor(() => expect(secureStore.getItemAsync).toHaveBeenCalledOnce());

    const replacementSession = session.beginMobileHouseholdSession('identity-session-new');
    await session.setSelectedHouseholdId(
      replacementSession,
      'person-shared',
      'household-new-session',
    );
    releaseOldRead('household-old-session');

    await expect(oldRestore).resolves.toBeNull();
    expect(session.readSelectedHouseholdId()).toBe('household-new-session');
    expect(session.isMobileHouseholdSessionCurrent(oldSession)).toBe(false);
    expect(session.isMobileHouseholdSessionCurrent(replacementSession)).toBe(true);
  });

  it('rechecks the session generation before a deferred preference write', async () => {
    let releaseOldAvailability!: (available: boolean) => void;
    secureStore.isAvailableAsync
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            releaseOldAvailability = resolve;
          }),
      )
      .mockResolvedValue(true);
    const session = await sessionModule();
    const oldSession = session.beginMobileHouseholdSession('identity-session-old-write');
    const oldWrite = session.setSelectedHouseholdId(
      oldSession,
      'person-shared',
      'household-old-session',
    );
    await vi.waitFor(() => expect(secureStore.isAvailableAsync).toHaveBeenCalledOnce());

    const replacementSession = session.beginMobileHouseholdSession('identity-session-new-write');
    const replacementWrite = session.setSelectedHouseholdId(
      replacementSession,
      'person-shared',
      'household-new-session',
    );
    releaseOldAvailability(true);
    await Promise.all([oldWrite, replacementWrite]);

    expect(session.readSelectedHouseholdId()).toBe('household-new-session');
    expect(secureStore.setItemAsync).toHaveBeenCalledTimes(1);
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      'boomerbuddy.mobile.selected-household.person-shared',
      'household-new-session',
      { keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );
  });

  it('does not let stale cleanup clear a replacement session', async () => {
    const session = await sessionModule();
    const oldSession = session.beginMobileHouseholdSession('identity-session-old-cleanup');
    const replacementSession = session.beginMobileHouseholdSession('identity-session-new-cleanup');
    await session.setSelectedHouseholdId(
      replacementSession,
      'person-replacement',
      'household-replacement',
    );

    await expect(session.clearMobileDeviceState(oldSession)).resolves.toBeUndefined();
    expect(session.readSelectedHouseholdId()).toBe('household-replacement');
    expect(session.isMobileHouseholdSessionCurrent(replacementSession)).toBe(true);
  });

  it('does not let a never-settling old write block a replacement session', async () => {
    vi.useFakeTimers();
    try {
      let markOldWriteStarted!: () => void;
      const oldWriteStarted = new Promise<void>((resolve) => {
        markOldWriteStarted = resolve;
      });
      secureStore.setItemAsync.mockImplementationOnce(() => {
        markOldWriteStarted();
        return new Promise<void>(() => undefined);
      });
      secureStore.getItemAsync.mockResolvedValueOnce('household-replacement');
      const session = await sessionModule();
      const oldSession = session.beginMobileHouseholdSession('identity-session-hung-write');
      const oldWrite = session.setSelectedHouseholdId(
        oldSession,
        'person-old-write',
        'household-old-write',
      );
      await oldWriteStarted;

      const replacementSession = session.beginMobileHouseholdSession(
        'identity-session-after-hung-write',
      );
      await expect(
        session.restoreSelectedHouseholdId(replacementSession, 'person-replacement'),
      ).resolves.toBe('household-replacement');
      await expect(
        session.setSelectedHouseholdId(
          replacementSession,
          'person-replacement',
          'household-replacement',
        ),
      ).resolves.toBeUndefined();
      expect(session.readSelectedHouseholdId()).toBe('household-replacement');

      await vi.advanceTimersByTimeAsync(2_000);
      await expect(oldWrite).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('repairs a newer same-person preference after a timed-out old write settles late', async () => {
    vi.useFakeTimers();
    try {
      let releaseOldWrite!: () => void;
      let markOldWriteStarted!: () => void;
      let markRepairStarted!: () => void;
      const oldWriteStarted = new Promise<void>((resolve) => {
        markOldWriteStarted = resolve;
      });
      const repairStarted = new Promise<void>((resolve) => {
        markRepairStarted = resolve;
      });
      secureStore.setItemAsync
        .mockImplementationOnce(() => {
          markOldWriteStarted();
          return new Promise<void>((resolve) => {
            releaseOldWrite = resolve;
          });
        })
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(async () => {
          markRepairStarted();
        });
      const session = await sessionModule();
      const oldSession = session.beginMobileHouseholdSession('identity-session-old-late-settle');
      const oldWrite = session.setSelectedHouseholdId(
        oldSession,
        'person-same-key',
        'household-old-value',
      );
      await oldWriteStarted;
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(oldWrite).resolves.toBeUndefined();

      const replacementSession = session.beginMobileHouseholdSession(
        'identity-session-new-late-settle',
      );
      await session.setSelectedHouseholdId(
        replacementSession,
        'person-same-key',
        'household-new-value',
      );
      releaseOldWrite();
      await repairStarted;

      expect(secureStore.setItemAsync).toHaveBeenNthCalledWith(
        1,
        'boomerbuddy.mobile.selected-household.person-same-key',
        'household-old-value',
        { keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
      );
      expect(secureStore.setItemAsync).toHaveBeenNthCalledWith(
        2,
        'boomerbuddy.mobile.selected-household.person-same-key',
        'household-new-value',
        { keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
      );
      expect(secureStore.setItemAsync).toHaveBeenNthCalledWith(
        3,
        'boomerbuddy.mobile.selected-household.person-same-key',
        'household-new-value',
        { keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('repairs a same-person preference deletion after a timed-out set settles late', async () => {
    vi.useFakeTimers();
    try {
      let releaseOldWrite!: () => void;
      let markOldWriteStarted!: () => void;
      let markRepairDeleteStarted!: () => void;
      const oldWriteStarted = new Promise<void>((resolve) => {
        markOldWriteStarted = resolve;
      });
      const repairDeleteStarted = new Promise<void>((resolve) => {
        markRepairDeleteStarted = resolve;
      });
      secureStore.setItemAsync.mockImplementationOnce(() => {
        markOldWriteStarted();
        return new Promise<void>((resolve) => {
          releaseOldWrite = resolve;
        });
      });
      secureStore.deleteItemAsync
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(async () => {
          markRepairDeleteStarted();
        });
      const session = await sessionModule();
      const oldSession = session.beginMobileHouseholdSession('identity-session-old-late-delete');
      const oldWrite = session.setSelectedHouseholdId(
        oldSession,
        'person-same-delete-key',
        'household-old-value',
      );
      await oldWriteStarted;
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(oldWrite).resolves.toBeUndefined();

      const replacementSession = session.beginMobileHouseholdSession(
        'identity-session-new-late-delete',
      );
      await session.setSelectedHouseholdId(replacementSession, 'person-same-delete-key', null);
      releaseOldWrite();
      await repairDeleteStarted;

      expect(secureStore.deleteItemAsync).toHaveBeenNthCalledWith(
        1,
        'boomerbuddy.mobile.selected-household.person-same-delete-key',
      );
      expect(secureStore.deleteItemAsync).toHaveBeenNthCalledWith(
        2,
        'boomerbuddy.mobile.selected-household.person-same-delete-key',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds a never-settling preference read and fails open to the first authorized household', async () => {
    vi.useFakeTimers();
    try {
      secureStore.getItemAsync.mockImplementationOnce(() => new Promise(() => undefined));
      const session = await sessionModule();
      const householdSession = session.beginMobileHouseholdSession('identity-session-hung-read');
      const restore = session.restoreSelectedHouseholdId(householdSession, 'person-hung-read');

      await vi.advanceTimersByTimeAsync(2_000);

      await expect(restore).resolves.toBeNull();
      expect(session.isMobileHouseholdSessionCurrent(householdSession)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('deletes retired unscoped device values without ever reading them', async () => {
    const session = await sessionModule();

    await expect(session.clearLegacyDevelopmentSessionToken()).resolves.toBeUndefined();

    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith('boomerbuddy.local.mobile.dev-token');
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(
      'boomerbuddy.mobile.selected-household',
    );
    expect(secureStore.getItemAsync).not.toHaveBeenCalledWith(
      'boomerbuddy.mobile.selected-household',
    );
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
      const householdSession = session.beginMobileHouseholdSession(
        `identity-session-legacy-${failure}`,
      );
      const restoreAuthenticatedPrincipal = vi.fn(async () => ({ id: 'principal-valid' }));

      await expect(session.clearLegacyDevelopmentSessionToken()).resolves.toBeUndefined();
      await expect(
        session.restoreSelectedHouseholdId(householdSession, 'person-preference-owner'),
      ).resolves.toBeNull();
      await expect(restoreAuthenticatedPrincipal()).resolves.toEqual({ id: 'principal-valid' });
      expect(restoreAuthenticatedPrincipal).toHaveBeenCalledOnce();
    },
  );
});

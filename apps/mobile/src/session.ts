import { Platform } from 'react-native';
import * as SecureStore from './secure-store';

const legacyDevelopmentTokenKey = 'boomerbuddy.local.mobile.dev-token';
const legacySelectedHouseholdKey = 'boomerbuddy.mobile.selected-household';
const pendingSignOutKey = 'boomerbuddy.mobile.pending-sign-out-session';
const selectedHouseholdKeyPrefix = 'boomerbuddy.mobile.selected-household.';
const secureStoreOperationTimeoutMs = 2_000;
const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u;

export type MobileHouseholdSession = Readonly<{
  generation: number;
  identitySessionId: string;
}>;

export type PendingMobileSignOutRead =
  | Readonly<{ status: 'none' }>
  | Readonly<{ status: 'pending'; identitySessionId: string }>
  | Readonly<{ status: 'unavailable' }>;

let householdSessionGeneration = 0;
let activeHouseholdSession: MobileHouseholdSession | undefined;
let activeHouseholdPersonId: string | undefined;
let selectedHouseholdId: string | null = null;
let preferenceRevision = 0;
let pendingSignOutRevision = 0;
let pendingSignOutSessionId: string | undefined;

type HouseholdPreference = Readonly<{
  householdId: string | null;
  revision: number;
}>;

const latestHouseholdPreference = new Map<string, HouseholdPreference>();

type PendingSignOutPreference = Readonly<{
  identitySessionId?: string;
  revision: number;
}>;

let latestPendingSignOutPreference: PendingSignOutPreference = Object.freeze({ revision: 0 });

function selectedHouseholdKey(personId: string): string | undefined {
  return opaqueIdPattern.test(personId) ? `${selectedHouseholdKeyPrefix}${personId}` : undefined;
}

function boundSecureStoreOperation<T>(operation: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Secure Store operation timed out')),
      secureStoreOperationTimeoutMs,
    );
    operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function currentPreference(personId: string, preference: HouseholdPreference): boolean {
  return latestHouseholdPreference.get(personId)?.revision === preference.revision;
}

function persistHouseholdPreference(
  personId: string,
  preference: HouseholdPreference,
  session?: MobileHouseholdSession,
): Promise<void> {
  const key = selectedHouseholdKey(personId);
  if (!key || Platform.OS === 'web') return Promise.resolve();
  const persist = async (): Promise<void> => {
    if (!currentPreference(personId, preference)) return;
    if (session && !isMobileHouseholdSessionCurrent(session)) return;
    if (!(await boundSecureStoreOperation(SecureStore.isAvailableAsync()))) return;
    if (!currentPreference(personId, preference)) return;
    if (session && !isMobileHouseholdSessionCurrent(session)) return;
    const operation = preference.householdId
      ? SecureStore.setItemAsync(key, preference.householdId, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        })
      : SecureStore.deleteItemAsync(key);
    void operation.then(
      () => {
        const latest = latestHouseholdPreference.get(personId);
        if (latest && latest.revision !== preference.revision) {
          void persistHouseholdPreference(personId, latest).catch(() => undefined);
        }
      },
      () => {
        const latest = latestHouseholdPreference.get(personId);
        if (latest && latest.revision !== preference.revision) {
          void persistHouseholdPreference(personId, latest).catch(() => undefined);
        }
      },
    );
    await boundSecureStoreOperation(operation);
  };
  return persist().catch(() => undefined);
}

function persistPendingSignOutPreference(preference: PendingSignOutPreference): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(true);
  const persist = async (): Promise<boolean> => {
    if (latestPendingSignOutPreference.revision !== preference.revision) return false;
    if (!(await boundSecureStoreOperation(SecureStore.isAvailableAsync()))) return false;
    if (latestPendingSignOutPreference.revision !== preference.revision) return false;
    const operation = preference.identitySessionId
      ? SecureStore.setItemAsync(pendingSignOutKey, preference.identitySessionId, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        })
      : SecureStore.deleteItemAsync(pendingSignOutKey);
    const repairIfStale = (): void => {
      if (latestPendingSignOutPreference.revision !== preference.revision) {
        void persistPendingSignOutPreference(latestPendingSignOutPreference);
      }
    };
    void operation.then(repairIfStale, repairIfStale);
    await boundSecureStoreOperation(operation);
    return latestPendingSignOutPreference.revision === preference.revision;
  };
  return persist().catch(() => false);
}

export function isMobileSignOutPending(): boolean {
  return pendingSignOutSessionId !== undefined;
}

export function markPendingMobileSignOut(identitySessionId: string): Promise<boolean> {
  const normalized = identitySessionId.trim();
  if (!opaqueIdPattern.test(normalized)) return Promise.resolve(false);
  pendingSignOutSessionId = normalized;
  latestPendingSignOutPreference = Object.freeze({
    identitySessionId: normalized,
    revision: (pendingSignOutRevision += 1),
  });
  return persistPendingSignOutPreference(latestPendingSignOutPreference);
}

export async function readPendingMobileSignOut(): Promise<PendingMobileSignOutRead> {
  if (pendingSignOutSessionId !== undefined) {
    return { status: 'pending', identitySessionId: pendingSignOutSessionId };
  }
  if (Platform.OS === 'web') return { status: 'none' };
  const observedRevision = latestPendingSignOutPreference.revision;
  try {
    if (!(await boundSecureStoreOperation(SecureStore.isAvailableAsync()))) {
      return { status: 'unavailable' };
    }
    const stored = await boundSecureStoreOperation(SecureStore.getItemAsync(pendingSignOutKey));
    if (latestPendingSignOutPreference.revision !== observedRevision) {
      return pendingSignOutSessionId === undefined
        ? { status: 'none' }
        : { status: 'pending', identitySessionId: pendingSignOutSessionId };
    }
    if (stored === null) return { status: 'none' };
    if (!opaqueIdPattern.test(stored)) return { status: 'unavailable' };
    pendingSignOutSessionId = stored;
    latestPendingSignOutPreference = Object.freeze({
      identitySessionId: stored,
      revision: observedRevision,
    });
    return { status: 'pending', identitySessionId: stored };
  } catch {
    // Authentication must not resume when a pending-sign-out marker cannot be checked.
    return { status: 'unavailable' };
  }
}

export function clearPendingMobileSignOut(identitySessionId: string): Promise<boolean> {
  const normalized = identitySessionId.trim();
  if (
    !opaqueIdPattern.test(normalized) ||
    (pendingSignOutSessionId !== undefined && pendingSignOutSessionId !== normalized)
  ) {
    return Promise.resolve(false);
  }
  pendingSignOutSessionId = undefined;
  latestPendingSignOutPreference = Object.freeze({
    revision: (pendingSignOutRevision += 1),
  });
  return persistPendingSignOutPreference(latestPendingSignOutPreference);
}

export function beginMobileHouseholdSession(identitySessionId: string): MobileHouseholdSession {
  const session = Object.freeze({
    generation: (householdSessionGeneration += 1),
    identitySessionId,
  });
  activeHouseholdSession = session;
  activeHouseholdPersonId = undefined;
  selectedHouseholdId = null;
  return session;
}

export function isMobileHouseholdSessionCurrent(session: MobileHouseholdSession): boolean {
  return (
    activeHouseholdSession?.generation === session.generation &&
    activeHouseholdSession.identitySessionId === session.identitySessionId
  );
}

export function endMobileHouseholdSession(session?: MobileHouseholdSession): boolean {
  if (session && !isMobileHouseholdSessionCurrent(session)) return false;
  householdSessionGeneration += 1;
  activeHouseholdSession = undefined;
  activeHouseholdPersonId = undefined;
  selectedHouseholdId = null;
  return true;
}

export function readSelectedHouseholdId(): string | null {
  return selectedHouseholdId;
}

export async function restoreSelectedHouseholdId(
  session: MobileHouseholdSession,
  personId: string,
): Promise<string | null> {
  const key = selectedHouseholdKey(personId);
  if (!key || !isMobileHouseholdSessionCurrent(session) || Platform.OS === 'web') return null;
  activeHouseholdPersonId = personId;
  const inMemoryPreference = latestHouseholdPreference.get(personId);
  if (inMemoryPreference) return inMemoryPreference.householdId;
  try {
    if (
      !(await boundSecureStoreOperation(SecureStore.isAvailableAsync())) ||
      !isMobileHouseholdSessionCurrent(session)
    ) {
      return null;
    }
    const stored = await boundSecureStoreOperation(SecureStore.getItemAsync(key));
    return isMobileHouseholdSessionCurrent(session) ? stored : null;
  } catch {
    // Household selection is a convenience preference, not authentication material. A keychain
    // read failure must not prevent a valid identity session from restoring through /v1/me.
    return null;
  }
}

export function setSelectedHouseholdId(
  session: MobileHouseholdSession,
  personId: string,
  householdId: string | null,
): Promise<void> {
  const key = selectedHouseholdKey(personId);
  if (!key || !isMobileHouseholdSessionCurrent(session)) return Promise.resolve();
  activeHouseholdPersonId = personId;
  selectedHouseholdId = householdId;
  const preference = Object.freeze({
    householdId,
    revision: (preferenceRevision += 1),
  });
  latestHouseholdPreference.set(personId, preference);
  return persistHouseholdPreference(personId, preference, session);
}

export async function clearLegacyDevelopmentSessionToken(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    if (!(await boundSecureStoreOperation(SecureStore.isAvailableAsync()))) return;
    await Promise.allSettled([
      boundSecureStoreOperation(SecureStore.deleteItemAsync(legacyDevelopmentTokenKey)),
      boundSecureStoreOperation(SecureStore.deleteItemAsync(legacySelectedHouseholdKey)),
    ]);
  } catch {
    // Retired unscoped values are never used for current authentication or household selection.
    // Cleanup failure must not prevent a valid Clerk identity from restoring through /v1/me.
  }
}

export async function clearMobileDeviceState(session?: MobileHouseholdSession): Promise<void> {
  if (session && !isMobileHouseholdSessionCurrent(session)) return;
  const personKey = activeHouseholdPersonId
    ? selectedHouseholdKey(activeHouseholdPersonId)
    : undefined;
  const personId = activeHouseholdPersonId;
  const clearedPreference = personId
    ? Object.freeze({ householdId: null, revision: (preferenceRevision += 1) })
    : undefined;
  if (personId && clearedPreference) {
    latestHouseholdPreference.set(personId, clearedPreference);
  }
  endMobileHouseholdSession(session);
  await Promise.all([
    personKey && personId && clearedPreference
      ? persistHouseholdPreference(personId, clearedPreference)
      : Promise.resolve(),
    clearLegacyDevelopmentSessionToken(),
  ]);
}

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const legacyDevelopmentTokenKey = 'boomerbuddy.local.mobile.dev-token';
const selectedHouseholdKey = 'boomerbuddy.mobile.selected-household';
let selectedHouseholdId: string | null = null;
let selectedHouseholdWrite: Promise<void> = Promise.resolve();

export function readSelectedHouseholdId(): string | null {
  return selectedHouseholdId;
}

export async function restoreSelectedHouseholdId(): Promise<string | null> {
  if (Platform.OS === 'web') return selectedHouseholdId;
  await selectedHouseholdWrite.catch(() => undefined);
  try {
    if (!(await SecureStore.isAvailableAsync())) {
      selectedHouseholdId = null;
      return null;
    }
    selectedHouseholdId = await SecureStore.getItemAsync(selectedHouseholdKey);
    return selectedHouseholdId;
  } catch {
    // Household selection is a convenience preference, not authentication material. A keychain
    // read failure must not prevent a valid identity session from restoring through /v1/me.
    selectedHouseholdId = null;
    return null;
  }
}

export function setSelectedHouseholdId(householdId: string | null): Promise<void> {
  selectedHouseholdId = householdId;
  if (Platform.OS === 'web') return Promise.resolve();
  selectedHouseholdWrite = selectedHouseholdWrite
    .catch(() => undefined)
    .then(async () => {
      if (!(await SecureStore.isAvailableAsync())) return;
      if (householdId) {
        await SecureStore.setItemAsync(selectedHouseholdKey, householdId, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
      } else {
        await SecureStore.deleteItemAsync(selectedHouseholdKey);
      }
    })
    .catch(() => undefined);
  return selectedHouseholdWrite;
}

export async function clearLegacyDevelopmentSessionToken(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    if (!(await SecureStore.isAvailableAsync())) return;
    await SecureStore.deleteItemAsync(legacyDevelopmentTokenKey);
  } catch {
    // The retired development token is never used for current authentication. Failure to remove
    // it must not prevent a valid Clerk identity from restoring through /v1/me.
  }
}

export async function clearMobileDeviceState(): Promise<void> {
  await setSelectedHouseholdId(null);
  await clearLegacyDevelopmentSessionToken();
}

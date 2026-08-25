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
  if (!(await SecureStore.isAvailableAsync())) {
    selectedHouseholdId = null;
    return null;
  }
  selectedHouseholdId = await SecureStore.getItemAsync(selectedHouseholdKey);
  return selectedHouseholdId;
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
    });
  return selectedHouseholdWrite;
}

export async function clearLegacyDevelopmentSessionToken(): Promise<void> {
  if (Platform.OS === 'web' || !(await SecureStore.isAvailableAsync())) return;
  await SecureStore.deleteItemAsync(legacyDevelopmentTokenKey);
}

export async function clearMobileDeviceState(): Promise<void> {
  await setSelectedHouseholdId(null);
  await clearLegacyDevelopmentSessionToken();
}

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const tokenKey = 'boomerbuddy.local.mobile.dev-token';
const selectedHouseholdKey = 'boomerbuddy.local.mobile.selected-household';
let webMemoryToken: string | null = null;
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

export async function readSessionToken(): Promise<string | null> {
  if (Platform.OS === 'web') return webMemoryToken;
  if (!(await SecureStore.isAvailableAsync())) return null;
  return await SecureStore.getItemAsync(tokenKey);
}

export async function writeSessionToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    webMemoryToken = token;
    return;
  }
  if (!(await SecureStore.isAvailableAsync()))
    throw new Error(
      'Secure device storage is unavailable, so this development session was not saved.',
    );
  await SecureStore.setItemAsync(tokenKey, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearSessionToken(): Promise<void> {
  await setSelectedHouseholdId(null);
  if (Platform.OS === 'web') {
    webMemoryToken = null;
    return;
  }
  if (await SecureStore.isAvailableAsync()) await SecureStore.deleteItemAsync(tokenKey);
}

export const sessionStorageDisclosure =
  Platform.OS === 'web'
    ? 'This web preview keeps the development bearer and selected household only in memory. Refreshing ends the session.'
    : 'The development bearer and selected-household preference use separate operating-system secure-store entries restricted to this device when supported.';

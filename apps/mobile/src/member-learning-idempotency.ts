import {
  DurableActionOperationKeys,
  type ActionOperationPersistence,
  type PersistedActionOperation,
} from '@boomerbuddy/contracts';
import * as Crypto from 'expo-crypto';
import * as SecureStore from './secure-store';

const pendingOperationsKey = 'boomerbuddy.mobile.member-learning.pending-operations';

function recordKey(scope: string, action: string): string {
  return `${encodeURIComponent(scope)}:${encodeURIComponent(action)}`;
}

export function mobileMemberLearningOperationScope(personId: string, householdId: string): string {
  return `${personId.length}:${personId}${householdId.length}:${householdId}`;
}

async function readRecords(): Promise<Record<string, PersistedActionOperation>> {
  if (!(await SecureStore.isAvailableAsync())) {
    throw new Error('Secure pending-operation storage is unavailable');
  }
  const stored = await SecureStore.getItemAsync(pendingOperationsKey);
  if (stored === null) return {};
  try {
    const parsed = JSON.parse(stored) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, PersistedActionOperation>)
      : {};
  } catch {
    return {};
  }
}

async function writeRecords(records: Record<string, PersistedActionOperation>): Promise<void> {
  if (Object.keys(records).length === 0) {
    await SecureStore.deleteItemAsync(pendingOperationsKey);
    return;
  }
  await SecureStore.setItemAsync(pendingOperationsKey, JSON.stringify(records), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

function mobilePersistence(): ActionOperationPersistence {
  return {
    load: async (scope, action) => (await readRecords())[recordKey(scope, action)],
    save: async (operation) => {
      const records = await readRecords();
      records[recordKey(operation.scope, operation.action)] = operation;
      await writeRecords(records);
    },
    remove: async (scope, action) => {
      const records = await readRecords();
      delete records[recordKey(scope, action)];
      await writeRecords(records);
    },
    clear: () => SecureStore.deleteItemAsync(pendingOperationsKey),
  };
}

export function createMobileMemberLearningOperationKeys(): DurableActionOperationKeys {
  return new DurableActionOperationKeys(
    mobilePersistence(),
    (canonicalRequest) =>
      Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, canonicalRequest, {
        encoding: Crypto.CryptoEncoding.HEX,
      }),
    () => Crypto.randomUUID(),
  );
}

export function clearMobileMemberLearningPendingOperations(): Promise<void> {
  return SecureStore.deleteItemAsync(pendingOperationsKey);
}

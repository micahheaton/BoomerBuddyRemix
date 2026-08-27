import {
  DurableActionOperationKeys,
  type ActionOperationPersistence,
  type PersistedActionOperation,
} from '@boomerbuddy/contracts';

export const memberLearningPendingOperationStoragePrefix = 'bb:member-learning:pending:';

type PendingOperationStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'
>;

function storageKey(scope: string, action: string): string {
  return `${memberLearningPendingOperationStoragePrefix}${encodeURIComponent(scope)}:${encodeURIComponent(action)}`;
}

export function clearWebMemberLearningPendingOperations(storage: PendingOperationStorage): void {
  const matching: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(memberLearningPendingOperationStoragePrefix)) matching.push(key);
  }
  for (const key of matching) storage.removeItem(key);
}

function webPersistence(storage: PendingOperationStorage): ActionOperationPersistence {
  return {
    load: (scope, action) => {
      const stored = storage.getItem(storageKey(scope, action));
      if (stored === null) return Promise.resolve(undefined);
      try {
        return Promise.resolve(JSON.parse(stored) as unknown);
      } catch {
        return Promise.resolve(undefined);
      }
    },
    save: (operation: PersistedActionOperation) => {
      storage.setItem(storageKey(operation.scope, operation.action), JSON.stringify(operation));
      return Promise.resolve();
    },
    remove: (scope, action) => {
      storage.removeItem(storageKey(scope, action));
      return Promise.resolve();
    },
    clear: () => {
      clearWebMemberLearningPendingOperations(storage);
      return Promise.resolve();
    },
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createWebMemberLearningOperationKeys(
  storage: PendingOperationStorage,
): DurableActionOperationKeys {
  return new DurableActionOperationKeys(webPersistence(storage), sha256Hex, () =>
    crypto.randomUUID(),
  );
}

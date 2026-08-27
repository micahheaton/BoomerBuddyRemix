import { beforeEach, describe, expect, it, vi } from 'vitest';

const secureStore = vi.hoisted(() => ({
  deleteItemAsync: vi.fn<(key: string) => Promise<void>>(),
  getItemAsync: vi.fn<(key: string) => Promise<string | null>>(),
  isAvailableAsync: vi.fn<() => Promise<boolean>>(),
  setItemAsync: vi.fn<(key: string, value: string, options?: unknown) => Promise<void>>(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
}));

const crypto = vi.hoisted(() => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { HEX: 'hex' },
  digestStringAsync:
    vi.fn<(algorithm: string, value: string, options: unknown) => Promise<string>>(),
  randomUUID: vi.fn<() => string>(),
}));

vi.mock('./secure-store', () => secureStore);
vi.mock('expo-crypto', () => crypto);

describe('mobile member-learning pending operations', () => {
  let stored: string | null;
  let sequence: number;

  beforeEach(() => {
    stored = null;
    sequence = 0;
    secureStore.isAvailableAsync.mockReset().mockResolvedValue(true);
    secureStore.getItemAsync.mockReset().mockImplementation(() => Promise.resolve(stored));
    secureStore.setItemAsync.mockReset().mockImplementation((_key, value) => {
      stored = value;
      return Promise.resolve();
    });
    secureStore.deleteItemAsync.mockReset().mockImplementation(() => {
      stored = null;
      return Promise.resolve();
    });
    crypto.digestStringAsync
      .mockReset()
      .mockImplementation((_algorithm, value) =>
        Promise.resolve((value.includes('pause') ? 'a' : 'b').repeat(64)),
      );
    crypto.randomUUID
      .mockReset()
      .mockImplementation(() => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`);
  });

  it('retains an opaque action key across manager reload and rotates on intent mismatch', async () => {
    const { createMobileMemberLearningOperationKeys, mobileMemberLearningOperationScope } =
      await import('./member-learning-idempotency');
    const input = {
      scope: mobileMemberLearningOperationScope('person-one', 'household-one'),
      action: 'lesson-answer',
      canonicalRequest: 'lesson-one:1:pause',
      keyPrefix: 'member-learning:lesson-answer',
    };

    const first = await createMobileMemberLearningOperationKeys().retain(input);
    expect(stored).not.toContain(input.canonicalRequest);
    expect(await createMobileMemberLearningOperationKeys().retain(input)).toBe(first);
    await expect(
      createMobileMemberLearningOperationKeys().retain({
        ...input,
        canonicalRequest: 'lesson-one:1:wait',
      }),
    ).resolves.not.toBe(first);
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      'boomerbuddy.mobile.member-learning.pending-operations',
      expect.any(String),
      { keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );
  });

  it('binds pending keys to the exact person as well as the household', async () => {
    const { createMobileMemberLearningOperationKeys, mobileMemberLearningOperationScope } =
      await import('./member-learning-idempotency');
    const manager = createMobileMemberLearningOperationKeys();
    const common = {
      action: 'lesson-answer',
      canonicalRequest: 'lesson-one:1:pause',
      keyPrefix: 'member-learning:lesson-answer',
    };
    const first = await manager.retain({
      ...common,
      scope: mobileMemberLearningOperationScope('person-one', 'household-one'),
    });
    const second = await manager.retain({
      ...common,
      scope: mobileMemberLearningOperationScope('person-two', 'household-one'),
    });

    expect(second).not.toBe(first);
    expect(stored).not.toContain(common.canonicalRequest);
  });

  it('clears all pending keys on explicit sign-out and fails closed without secure storage', async () => {
    const { clearMobileMemberLearningPendingOperations, createMobileMemberLearningOperationKeys } =
      await import('./member-learning-idempotency');
    await createMobileMemberLearningOperationKeys().retain({
      scope: 'household-one',
      action: 'weekly-rehearsal-complete',
      canonicalRequest: 'complete:true',
      keyPrefix: 'member-learning:weekly-rehearsal-complete',
    });
    await clearMobileMemberLearningPendingOperations();
    expect(stored).toBeNull();

    secureStore.isAvailableAsync.mockResolvedValue(false);
    await expect(
      createMobileMemberLearningOperationKeys().retain({
        scope: 'household-one',
        action: 'lesson-start',
        canonicalRequest: 'lesson-one:1',
        keyPrefix: 'member-learning:lesson-start',
      }),
    ).rejects.toThrow('Secure pending-operation storage is unavailable');
  });
});

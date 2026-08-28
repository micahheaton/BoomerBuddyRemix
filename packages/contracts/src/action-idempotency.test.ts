import { describe, expect, it } from 'vitest';

import {
  DurableActionOperationKeys,
  type ActionOperationPersistence,
  type PersistedActionOperation,
} from './action-idempotency';

function memoryPersistence(): ActionOperationPersistence & {
  readonly records: Map<string, PersistedActionOperation>;
} {
  const records = new Map<string, PersistedActionOperation>();
  const id = (scope: string, action: string) => `${scope}:${action}`;
  return {
    records,
    load: (scope, action) => Promise.resolve(records.get(id(scope, action))),
    save: (operation) => {
      records.set(id(operation.scope, operation.action), operation);
      return Promise.resolve();
    },
    remove: (scope, action) => {
      records.delete(id(scope, action));
      return Promise.resolve();
    },
    clear: () => {
      records.clear();
      return Promise.resolve();
    },
  };
}

describe('durable action operation keys', () => {
  it('survives reload, expires, rotates mismatched intent, and clears on success or sign-out', async () => {
    const persistence = memoryPersistence();
    let currentTime = new Date('2026-08-27T12:00:00.000Z');
    let sequence = 0;
    const digest = (request: string) =>
      Promise.resolve((request.includes('pause') ? 'a' : 'b').repeat(64));
    const manager = () =>
      new DurableActionOperationKeys(
        persistence,
        digest,
        () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
        () => currentTime,
      );
    const input = {
      scope: 'household-one',
      action: 'lesson-answer',
      canonicalRequest: 'lesson-one:1:pause',
      keyPrefix: 'member-learning:lesson-answer',
    };

    const first = await manager().retain(input);
    expect(JSON.stringify([...persistence.records.values()])).not.toContain('lesson-one:1:pause');
    expect(await manager().retain(input)).toBe(first);
    const changed = await manager().retain({
      ...input,
      canonicalRequest: 'lesson-one:1:wait',
    });
    expect(changed).not.toBe(first);
    expect(await manager().retain({ ...input, scope: 'household-two' })).not.toBe(first);

    currentTime = new Date(currentTime.getTime() + 24 * 60 * 60 * 1_000 + 1);
    const expired = await manager().retain({
      ...input,
      canonicalRequest: 'lesson-one:1:wait',
    });
    expect(expired).not.toBe(changed);

    const settleManager = manager();
    await settleManager.settle({ ...input, key: expired });
    expect(persistence.records.has('household-one:lesson-answer')).toBe(false);
    await settleManager.clear();
    expect(persistence.records.size).toBe(0);
  });

  it('serializes concurrent first retain and removes malformed persisted keys', async () => {
    const persistence = memoryPersistence();
    let sequence = 0;
    const manager = new DurableActionOperationKeys(
      persistence,
      () => Promise.resolve('c'.repeat(64)),
      () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
      () => new Date('2026-08-27T12:00:00.000Z'),
    );
    const input = {
      scope: 'household-one',
      action: 'weekly-rehearsal-complete',
      canonicalRequest: 'complete:true',
      keyPrefix: 'member-learning:weekly-rehearsal-complete',
    };
    const concurrent = await Promise.all([manager.retain(input), manager.retain(input)]);
    expect(new Set(concurrent).size).toBe(1);
    expect(persistence.records.size).toBe(1);

    persistence.records.set('household-two:lesson-answer', {
      scope: 'household-two',
      action: 'lesson-answer',
      key: 'forged-header',
      requestDigest: 'not-a-digest',
      createdAt: 'not-a-date',
    });
    const repaired = await manager.retain({
      scope: 'household-two',
      action: 'lesson-answer',
      canonicalRequest: 'lesson-one:1:pause',
      keyPrefix: 'member-learning:lesson-answer',
    });
    expect(repaired).toMatch(/^member-learning:lesson-answer:/u);
    expect(repaired).not.toBe('forged-header');
  });
});

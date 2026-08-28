import { describe, expect, it } from 'vitest';

import { clearWebMemberLearningPendingOperations } from './member-learning-idempotency';

describe('web member learning pending operations', () => {
  it('clears only the bounded member-learning session records on sign-out', () => {
    const values = new Map([
      ['bb:member-learning:pending:household:lesson-answer', 'digest-only'],
      ['boomerbuddy.selected-household', 'household'],
    ]);
    const storage = {
      get length() {
        return values.size;
      },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => {
        values.delete(key);
      },
    };

    clearWebMemberLearningPendingOperations(storage);
    expect([...values.keys()]).toEqual(['boomerbuddy.selected-household']);
  });
});

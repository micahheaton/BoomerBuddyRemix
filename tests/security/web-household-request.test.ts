import { describe, expect, it } from 'vitest';
import {
  householdBoundValue,
  householdRequestIsCurrent,
  type HouseholdRequestIdentity,
} from '../../apps/web/src/lib/household-request';

describe('web household request identity', () => {
  it('rejects a delayed response after the selected household changes', () => {
    const attempt: HouseholdRequestIdentity = { householdId: 'household-a', generation: 4 };

    expect(householdRequestIsCurrent(attempt, { householdId: 'household-b', generation: 5 })).toBe(
      false,
    );
  });

  it('rejects an older response for the same household after a retry', () => {
    const attempt: HouseholdRequestIdentity = { householdId: 'household-a', generation: 4 };

    expect(householdRequestIsCurrent(attempt, { householdId: 'household-a', generation: 5 })).toBe(
      false,
    );
  });

  it('accepts only the current household and generation', () => {
    const attempt: HouseholdRequestIdentity = { householdId: 'household-a', generation: 5 };

    expect(householdRequestIsCurrent(attempt, attempt)).toBe(true);
  });

  it('never exposes a household-bound value under another household', () => {
    const state = { householdId: 'household-a', value: 'household A private data' } as const;

    expect(householdBoundValue(state, 'household-b')).toBeUndefined();
    expect(householdBoundValue(state, 'household-a')).toBe(state.value);
  });
});

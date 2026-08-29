import { afterEach, describe, expect, it } from 'vitest';
import {
  clearCheckRefreshDraft,
  readCheckRefreshDraft,
  retainCheckRefreshDraft,
} from './check-refresh-draft';

describe('mobile Check refresh draft', () => {
  afterEach(() => clearCheckRefreshDraft());

  it('returns an exact-input draft only for its Check and household', () => {
    retainCheckRefreshDraft({
      checkId: 'check_one',
      householdId: 'household_one',
      kind: 'url',
      content: 'example.com',
    });

    expect(readCheckRefreshDraft('check_one', 'household_one')).toMatchObject({
      kind: 'url',
      content: 'example.com',
    });
    expect(readCheckRefreshDraft('check_two', 'household_one')).toBeUndefined();
    expect(readCheckRefreshDraft('check_one', 'household_two')).toBeUndefined();
  });

  it('clears only the matching Check draft when given an id', () => {
    retainCheckRefreshDraft({
      checkId: 'check_one',
      householdId: 'household_one',
      kind: 'text',
      content: 'A fictional suspicious message',
    });

    clearCheckRefreshDraft('check_two');
    expect(readCheckRefreshDraft('check_one', 'household_one')).toBeDefined();

    clearCheckRefreshDraft('check_one');
    expect(readCheckRefreshDraft('check_one', 'household_one')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import {
  historyContinuationIsCurrent,
  mergeHistoryContinuation,
  type HistoryContinuation,
} from '../../apps/mobile/src/history-resource';

type HistoryRecord = { readonly id: string; readonly label: string };

describe('mobile History continuation binding', () => {
  const continuation: HistoryContinuation = {
    householdId: 'household-a',
    householdGeneration: 4,
    requestId: 7,
    offset: 50,
  };
  const current: HistoryRecord[] = [{ id: 'check-current', label: 'Current household record' }];
  const incoming: HistoryRecord[] = [{ id: 'check-incoming', label: 'Incoming page record' }];

  it('never appends a page after the selected household changes', () => {
    const context = {
      householdId: 'household-b',
      householdGeneration: 5,
      requestId: 8,
    };

    expect(historyContinuationIsCurrent(continuation, context)).toBe(false);
    expect(mergeHistoryContinuation(current, incoming, 50, continuation, context)).toBe(current);
  });

  it('never appends an obsolete generation, request, or offset', () => {
    for (const context of [
      { householdId: 'household-a', householdGeneration: 5, requestId: 7 },
      { householdId: 'household-a', householdGeneration: 4, requestId: 8 },
    ]) {
      expect(mergeHistoryContinuation(current, incoming, 50, continuation, context)).toBe(current);
    }
    expect(
      mergeHistoryContinuation(current, incoming, 100, continuation, {
        householdId: 'household-a',
        householdGeneration: 4,
        requestId: 7,
      }),
    ).toBe(current);
  });

  it('merges only the exact current continuation and de-duplicates records', () => {
    const context = {
      householdId: 'household-a',
      householdGeneration: 4,
      requestId: 7,
    };

    expect(
      mergeHistoryContinuation(
        current,
        [{ id: 'check-current', label: 'Current record refreshed' }, ...incoming],
        50,
        continuation,
        context,
      ),
    ).toEqual([
      { id: 'check-current', label: 'Current record refreshed' },
      { id: 'check-incoming', label: 'Incoming page record' },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { canCloseSharedResult } from '../../apps/mobile/src/share-lifecycle';

describe('mobile shared-result closure sequencing', () => {
  it('does not offer closure before the recipient acknowledges the redacted result', () => {
    expect(canCloseSharedResult(undefined)).toBe(false);
    expect(canCloseSharedResult({ state: 'shared' })).toBe(false);
  });

  it('offers closure only after acknowledgement and removes it after closure', () => {
    expect(canCloseSharedResult({ state: 'acknowledged' })).toBe(true);
    expect(canCloseSharedResult({ state: 'closed' })).toBe(false);
  });
});

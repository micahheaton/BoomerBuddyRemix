import { describe, expect, it } from 'vitest';

import {
  nextSupportReceiptState,
  supportReceiptResolutionCodes,
  type SupportReceiptState,
} from './support-receipts';

describe('content-free support receipt state machine', () => {
  it('accepts the exact customer and HQ lifecycle', () => {
    expect(nextSupportReceiptState({ action: 'create', actorKind: 'customer' })).toBe('open');
    expect(
      nextSupportReceiptState({
        action: 'acknowledge',
        actorKind: 'hq',
        currentState: 'open',
      }),
    ).toBe('acknowledged');
    expect(
      nextSupportReceiptState({
        action: 'start_review',
        actorKind: 'hq',
        currentState: 'acknowledged',
      }),
    ).toBe('in_review');
    for (const currentState of ['acknowledged', 'in_review'] as const) {
      for (const resolutionCode of supportReceiptResolutionCodes) {
        expect(
          nextSupportReceiptState({
            action: 'resolve',
            actorKind: 'hq',
            currentState,
            resolutionCode,
          }),
        ).toBe('resolved');
      }
    }
    for (const currentState of ['open', 'acknowledged', 'in_review'] as const) {
      expect(
        nextSupportReceiptState({
          action: 'withdraw',
          actorKind: 'customer',
          currentState,
        }),
      ).toBe('withdrawn');
    }
  });

  it('rejects skipped, cross-authority, terminal, and malformed resolution transitions', () => {
    const invalid = [
      { action: 'create', actorKind: 'hq' },
      { action: 'create', actorKind: 'customer', currentState: 'open' },
      { action: 'acknowledge', actorKind: 'customer', currentState: 'open' },
      { action: 'acknowledge', actorKind: 'hq', currentState: 'acknowledged' },
      { action: 'start_review', actorKind: 'hq', currentState: 'open' },
      { action: 'resolve', actorKind: 'hq', currentState: 'in_review' },
      {
        action: 'acknowledge',
        actorKind: 'hq',
        currentState: 'open',
        resolutionCode: 'completed',
      },
      { action: 'withdraw', actorKind: 'hq', currentState: 'open' },
      { action: 'withdraw', actorKind: 'customer', currentState: 'resolved' },
      { action: 'acknowledge', actorKind: 'hq', currentState: 'withdrawn' },
    ] as const;
    for (const value of invalid) {
      expect(() =>
        nextSupportReceiptState(
          value as {
            action: 'create' | 'acknowledge' | 'start_review' | 'resolve' | 'withdraw';
            actorKind: 'customer' | 'hq';
            currentState?: SupportReceiptState;
            resolutionCode?: 'completed';
          },
        ),
      ).toThrow();
    }
  });
});

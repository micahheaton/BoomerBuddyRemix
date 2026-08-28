import { SupportReceiptRepository, type SupportReceiptRecord } from '@boomerbuddy/persistence';
import { describe, expect, it, vi } from 'vitest';

import { browserHeaders, createApiHarness, login } from './support';

function records(start: number, count: number): SupportReceiptRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    receiptCode: `support_receipt_${String(start + index).padStart(32, '0')}`,
    householdId: 'household-sunrise',
    category: 'billing',
    impact: 'question',
    state: 'open',
    createdAt: new Date('2026-08-25T12:00:00.000Z'),
    updatedAt: new Date('2026-08-25T12:00:00.000Z'),
  }));
}

describe('support receipt API pagination ceiling', () => {
  it('preserves the final reachable page and never emits an unrequestable next offset', async () => {
    const harness = await createApiHarness();
    try {
      const customer = await login(harness.app, 'owner-alice');
      const list = vi
        .spyOn(SupportReceiptRepository.prototype, 'listForCustomer')
        .mockImplementation(async (input) => {
          if (input.offset === 9_950) {
            return {
              receipts: records(9_950, 50),
              truncated: true,
              nextOffset: 10_000,
            };
          }
          if (input.offset === 10_000) {
            return {
              receipts: records(10_000, 100),
              truncated: true,
              nextOffset: null,
            };
          }
          throw new Error(`Unexpected test offset: ${String(input.offset)}`);
        });

      const nearCeiling = await harness.app.inject({
        method: 'GET',
        url: '/v1/support-receipts?limit=100&offset=9950',
        headers: browserHeaders(customer.cookie!),
      });
      expect(nearCeiling.statusCode).toBe(200);
      expect(nearCeiling.json()).toMatchObject({
        receipts: expect.arrayContaining([
          expect.objectContaining({ receiptCode: expect.any(String) }),
        ]),
        truncated: true,
        nextOffset: 10_000,
      });

      const atCeiling = await harness.app.inject({
        method: 'GET',
        url: '/v1/support-receipts?limit=100&offset=10000',
        headers: browserHeaders(customer.cookie!),
      });
      expect(atCeiling.statusCode).toBe(200);
      expect(atCeiling.json()).toMatchObject({
        receipts: expect.arrayContaining([
          expect.objectContaining({ receiptCode: expect.any(String) }),
        ]),
        truncated: true,
        nextOffset: null,
      });

      const beyondCeiling = await harness.app.inject({
        method: 'GET',
        url: '/v1/support-receipts?limit=100&offset=10001',
        headers: browserHeaders(customer.cookie!),
      });
      expect(beyondCeiling.statusCode).toBe(400);
      expect(list).toHaveBeenCalledTimes(2);
      expect(list).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ limit: 100, offset: 9_950 }),
      );
      expect(list).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ limit: 100, offset: 10_000 }),
      );
    } finally {
      vi.restoreAllMocks();
      await harness.close();
    }
  });
});

import { describe, expect, it } from 'vitest';

import {
  createSupportReceiptRequestSchema,
  hqSupportReceiptListResponseSchema,
  hqSupportReceiptRecordSchema,
  supportReceiptCreateOperationKeySchema,
  supportReceiptListResponseSchema,
  supportReceiptRecordSchema,
  transitionSupportReceiptRequestSchema,
  withdrawSupportReceiptRequestSchema,
} from './support-receipts';

const receiptCode = `support_receipt_${'a'.repeat(32)}`;

describe('content-free support receipt contracts', () => {
  it('accepts only exact enum-only customer input', () => {
    expect(
      createSupportReceiptRequestSchema.parse({ category: 'billing', impact: 'blocked' }),
    ).toEqual({ category: 'billing', impact: 'blocked' });
    expect(withdrawSupportReceiptRequestSchema.parse({ receiptCode })).toEqual({ receiptCode });
    for (const forbidden of [
      'name',
      'email',
      'phone',
      'message',
      'url',
      'attachment',
      'contact',
      'description',
    ]) {
      expect(() =>
        createSupportReceiptRequestSchema.parse({
          category: 'billing',
          impact: 'blocked',
          [forbidden]: 'forbidden',
        }),
      ).toThrow();
      expect(() =>
        withdrawSupportReceiptRequestSchema.parse({ receiptCode, [forbidden]: 'forbidden' }),
      ).toThrow();
    }
    expect(() =>
      createSupportReceiptRequestSchema.parse({ category: 'other', impact: 'urgent' }),
    ).toThrow();
  });

  it('requires resolution evidence exactly when HQ resolves', () => {
    expect(
      transitionSupportReceiptRequestSchema.parse({
        receiptCode,
        action: 'resolve',
        resolutionCode: 'completed',
      }),
    ).toEqual({ receiptCode, action: 'resolve', resolutionCode: 'completed' });
    expect(() =>
      transitionSupportReceiptRequestSchema.parse({ receiptCode, action: 'resolve' }),
    ).toThrow();
    expect(() =>
      transitionSupportReceiptRequestSchema.parse({
        receiptCode,
        action: 'acknowledge',
        resolutionCode: 'completed',
      }),
    ).toThrow();
    expect(() =>
      transitionSupportReceiptRequestSchema.parse({
        receiptCode,
        action: 'acknowledge',
        note: 'forbidden',
      }),
    ).toThrow();
  });

  it('accepts only action-scoped idempotency keys', () => {
    expect(
      supportReceiptCreateOperationKeySchema.parse(
        'support-receipt:create:00000000-0000-4000-8000-000000000001',
      ),
    ).toContain('support-receipt:create:');
    expect(() =>
      supportReceiptCreateOperationKeySchema.parse(
        'support-receipt:withdraw:00000000-0000-4000-8000-000000000001',
      ),
    ).toThrow();
  });

  it('binds resolution evidence to the resolved response state', () => {
    const record = {
      receiptCode,
      category: 'billing',
      impact: 'blocked',
      createdAt: '2026-08-25T12:00:00.000Z',
      updatedAt: '2026-08-25T12:01:00.000Z',
    } as const;
    expect(() => supportReceiptRecordSchema.parse({ ...record, state: 'resolved' })).toThrow();
    expect(() =>
      supportReceiptRecordSchema.parse({
        ...record,
        state: 'open',
        resolutionCode: 'completed',
      }),
    ).toThrow();
    expect(
      hqSupportReceiptRecordSchema.parse({
        ...record,
        householdId: 'household-synthetic',
        state: 'resolved',
        resolutionCode: 'completed',
      }),
    ).toMatchObject({ state: 'resolved', resolutionCode: 'completed' });
  });

  it('accepts terminal truncation but rejects unrequestable or contradictory next offsets', () => {
    const boundary = {
      receipts: [],
      truncated: true,
      contentIncluded: false,
      outboundMessage: 'not_sent',
      providerAction: 'none',
    } as const;

    expect(
      supportReceiptListResponseSchema.parse({ ...boundary, nextOffset: 10_000 }),
    ).toMatchObject({ truncated: true, nextOffset: 10_000 });
    expect(supportReceiptListResponseSchema.parse({ ...boundary, nextOffset: null })).toMatchObject(
      { truncated: true, nextOffset: null },
    );
    expect(() =>
      supportReceiptListResponseSchema.parse({ ...boundary, nextOffset: 10_001 }),
    ).toThrow();
    expect(() =>
      supportReceiptListResponseSchema.parse({
        ...boundary,
        truncated: false,
        nextOffset: 10_000,
      }),
    ).toThrow();
    expect(
      hqSupportReceiptListResponseSchema.parse({
        ...boundary,
        projection: 'content_free_support_receipts',
        nextOffset: null,
      }),
    ).toMatchObject({ truncated: true, nextOffset: null });
  });
});

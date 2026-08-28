import { describe, expect, it } from 'vitest';
import {
  trustedCircleAttentionLimit,
  trustedCircleAttentionResponseSchema,
} from './trusted-circle-attention';

const acknowledgement = (index: number) => ({
  checkId: `analysis-attention-${index}`,
  attentionKind: 'shared_check_needs_acknowledgement' as const,
  sharedAt: '2026-08-27T12:00:00.000Z',
});

describe('Trusted Circle attention contract', () => {
  it('accepts only the content-free bounded projection', () => {
    const parsed = trustedCircleAttentionResponseSchema.parse({
      pendingAcknowledgementCount: 1,
      pendingAcknowledgements: [acknowledgement(1)],
      page: { limit: trustedCircleAttentionLimit, hasMore: false },
    });

    expect(parsed.pendingAcknowledgements[0]).toEqual(acknowledgement(1));
    expect(
      trustedCircleAttentionResponseSchema.safeParse({
        pendingAcknowledgementCount: 1,
        pendingAcknowledgements: [{ ...acknowledgement(1), summary: 'Do not expose this' }],
        page: { limit: trustedCircleAttentionLimit, hasMore: false },
      }).success,
    ).toBe(false);
  });

  it('rejects an oversized or internally inconsistent attention response', () => {
    expect(
      trustedCircleAttentionResponseSchema.safeParse({
        pendingAcknowledgementCount: trustedCircleAttentionLimit + 1,
        pendingAcknowledgements: Array.from(
          { length: trustedCircleAttentionLimit + 1 },
          (_, index) => acknowledgement(index),
        ),
        page: { limit: trustedCircleAttentionLimit, hasMore: false },
      }).success,
    ).toBe(false);
    expect(
      trustedCircleAttentionResponseSchema.safeParse({
        pendingAcknowledgementCount: 2,
        pendingAcknowledgements: [acknowledgement(1)],
        page: { limit: trustedCircleAttentionLimit, hasMore: false },
      }).success,
    ).toBe(false);
  });
});

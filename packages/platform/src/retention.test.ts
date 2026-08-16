import { describe, expect, it } from 'vitest';
import { nextRetentionSchedule, retentionIntervalKey } from './retention';

describe('durable retention scheduling', () => {
  const now = new Date('2026-08-16T12:00:00.000Z');
  const intervalMs = 5 * 60_000;

  it('uses a continuation key that cannot collide with the running interval job', () => {
    const currentKey = retentionIntervalKey(now, intervalMs);
    const continuation = nextRetentionSchedule({
      currentJobId: 'job-current',
      intervalMs,
      now,
      workWasFound: true,
    });
    expect(continuation.idempotencyKey).not.toBe(currentKey);
    expect(continuation.idempotencyKey).toBe('retention.sweep:continue:job-current');
    expect(continuation.scheduledAt.getTime()).toBe(now.getTime() + 1_000);
  });

  it('moves an idle sweep into the next interval bucket', () => {
    const next = nextRetentionSchedule({
      currentJobId: 'job-current',
      intervalMs,
      now,
      workWasFound: false,
    });
    expect(next.idempotencyKey).toBe(retentionIntervalKey(next.scheduledAt, intervalMs));
  });
});

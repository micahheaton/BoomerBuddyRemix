import { describe, expect, it, vi } from 'vitest';
import {
  createFeedbackRetentionHandler,
  enqueueFeedbackRetention,
  feedbackRetentionIntervalKey,
  feedbackRetentionIntervalMs,
  feedbackRetentionJobType,
} from '../../apps/worker/src/feedback-retention';

describe('feedback retention worker foundation', () => {
  it('enqueues a content-free local-only maintenance job', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const now = new Date('2026-08-17T12:00:00.000Z');
    await enqueueFeedbackRetention({ jobs: { enqueue }, now, batch: 1_000 });
    expect(enqueue).toHaveBeenCalledWith({
      type: feedbackRetentionJobType,
      version: 1,
      classification: 'internal',
      payload: { batch: 100, localOnly: true },
      idempotencyKey: feedbackRetentionIntervalKey(now),
      scheduledAt: now,
      maxAttempts: 8,
      correlationId: feedbackRetentionIntervalKey(now),
    });
    expect(JSON.stringify(enqueue.mock.calls)).not.toMatch(/cipher|text|destination|provider/iu);
  });

  it('erases a bounded batch, heartbeats, and schedules prompt continuation when full', async () => {
    const now = new Date('2026-08-17T12:00:00.000Z');
    const purgeDue = vi.fn().mockResolvedValue(25);
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const heartbeat = vi.fn().mockResolvedValue(undefined);
    const handler = createFeedbackRetentionHandler({
      feedback: { purgeDue },
      jobs: { enqueue },
      clock: () => now,
    });
    await handler({
      job: {
        id: 'job-feedback-retention',
        type: feedbackRetentionJobType,
        version: 1,
        classification: 'internal',
        payload: { batch: 25, localOnly: true },
        idempotencyKey: 'feedback-retention-test',
        state: 'running',
        priority: 0,
        attempts: 1,
        maxAttempts: 8,
        nextAttemptAt: now,
        correlationId: 'feedback-retention-test',
      },
      idempotencyKey: 'feedback-retention-test',
      signal: new AbortController().signal,
      heartbeat,
    });
    expect(purgeDue).toHaveBeenCalledWith({ now, limit: 25 });
    expect(heartbeat).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: feedbackRetentionJobType,
        scheduledAt: new Date(now.getTime() + 1_000),
      }),
    );
  });

  it('uses the normal interval after a partial batch', async () => {
    const now = new Date('2026-08-17T12:00:00.000Z');
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const handler = createFeedbackRetentionHandler({
      feedback: { purgeDue: vi.fn().mockResolvedValue(2) },
      jobs: { enqueue },
      clock: () => now,
    });
    await handler({
      job: {
        id: 'job-feedback-retention-partial',
        type: feedbackRetentionJobType,
        version: 1,
        classification: 'internal',
        payload: { batch: 25, localOnly: true },
        idempotencyKey: 'feedback-retention-partial',
        state: 'running',
        priority: 0,
        attempts: 1,
        maxAttempts: 8,
        nextAttemptAt: now,
        correlationId: 'feedback-retention-partial',
      },
      idempotencyKey: 'feedback-retention-partial',
      signal: new AbortController().signal,
      heartbeat: vi.fn().mockResolvedValue(undefined),
    });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: feedbackRetentionIntervalKey(
          new Date(now.getTime() + feedbackRetentionIntervalMs),
        ),
      }),
    );
  });

  it('rejects a malformed or non-local maintenance job without erasing anything', async () => {
    const now = new Date('2026-08-17T12:00:00.000Z');
    const purgeDue = vi.fn().mockResolvedValue(0);
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const handler = createFeedbackRetentionHandler({
      feedback: { purgeDue },
      jobs: { enqueue },
      clock: () => now,
    });
    await expect(
      handler({
        job: {
          id: 'job-feedback-retention-malformed',
          type: feedbackRetentionJobType,
          version: 1,
          classification: 'internal',
          payload: { batch: 25, localOnly: false, text: 'must-not-be-accepted' },
          idempotencyKey: 'feedback-retention-malformed',
          state: 'running',
          priority: 0,
          attempts: 1,
          maxAttempts: 8,
          nextAttemptAt: now,
          correlationId: 'feedback-retention-malformed',
        },
        idempotencyKey: 'feedback-retention-malformed',
        signal: new AbortController().signal,
        heartbeat: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toThrow('exact content-free local-only job');
    expect(purgeDue).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

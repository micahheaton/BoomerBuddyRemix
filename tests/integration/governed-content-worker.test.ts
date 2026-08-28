import { describe, expect, it, vi } from 'vitest';
import {
  createGovernedContentDailyHandler,
  enqueueGovernedContentDailyJob,
  governedContentDailyJobType,
} from '../../apps/worker/src/governed-content';

const now = new Date('2026-08-28T12:00:00.000Z');

describe('governed content daily worker', () => {
  it('queues only a content-free internal schedule payload', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    await enqueueGovernedContentDailyJob({ jobs: { enqueue }, now });
    expect(enqueue).toHaveBeenCalledWith({
      type: governedContentDailyJobType,
      classification: 'internal',
      payload: { scheduleDate: '2026-08-28', batch: 1 },
      idempotencyKey: 'editorial.daily-draft:2026-08-28',
      scheduledAt: now,
      maxAttempts: 8,
      correlationId: 'editorial.daily-draft:2026-08-28',
    });
    expect(JSON.stringify(enqueue.mock.calls[0]?.[0])).not.toMatch(
      /customer|email|phone|message|sourceUrl|body/iu,
    );
  });

  it('generates encrypted drafts and schedules tomorrow without publishing', async () => {
    const generateDailyDrafts = vi.fn().mockResolvedValue(['content-revision-one']);
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const heartbeat = vi.fn().mockResolvedValue(true);
    const handler = createGovernedContentDailyHandler({
      content: { generateDailyDrafts },
      jobs: { enqueue },
      clock: () => now,
    });
    await handler({
      heartbeat,
      idempotencyKey: 'editorial.daily-draft:2026-08-28',
      signal: new AbortController().signal,
      job: {
        id: 'job-content-daily',
        type: governedContentDailyJobType,
        version: 1,
        classification: 'internal',
        payload: { scheduleDate: '2026-08-28', batch: 1 },
        idempotencyKey: 'editorial.daily-draft:2026-08-28',
        state: 'running',
        priority: 0,
        attempts: 1,
        maxAttempts: 8,
        nextAttemptAt: now,
        correlationId: 'editorial.daily-draft:2026-08-28',
      },
    });
    expect(generateDailyDrafts).toHaveBeenCalledWith({
      scheduleDate: '2026-08-28',
      now,
      limit: 1,
    });
    expect(heartbeat).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: governedContentDailyJobType,
        idempotencyKey: 'editorial.daily-draft:2026-08-29',
        payload: { scheduleDate: '2026-08-29', batch: 1 },
      }),
    );
    expect(generateDailyDrafts.mock.calls[0]?.[0]).not.toHaveProperty('publish');
  });
});

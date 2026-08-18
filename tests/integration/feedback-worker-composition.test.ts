import { DurableJobRepository, type Database } from '@boomerbuddy/persistence';
import { createSeededTestDatabase, fixedTestNow } from '@boomerbuddy/testkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  composeFeedbackWorker,
  type FeedbackWorkerComposition,
} from '../../apps/worker/src/feedback-composition';
import {
  feedbackRetentionIntervalKey,
  feedbackRetentionIntervalMs,
  feedbackRetentionJobType,
} from '../../apps/worker/src/feedback-retention';

describe('feedback worker composition', () => {
  let database: Database | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  it('installs exactly retention maintenance and idempotently bootstraps one provider-free job', async () => {
    database = await createSeededTestDatabase(fixedTestNow);
    const jobs = new DurableJobRepository(database);
    const feedback = { purgeDue: vi.fn().mockResolvedValue(0) };
    const first = await composeFeedbackWorker({
      environment: 'development',
      feedback,
      jobs,
      now: fixedTestNow,
    });
    const replay = await composeFeedbackWorker({
      environment: 'development',
      feedback,
      jobs,
      now: fixedTestNow,
    });

    expect(Object.keys(first.handlers)).toEqual([feedbackRetentionJobType]);
    expect(Object.keys(replay.handlers)).toEqual([feedbackRetentionJobType]);
    expect(Object.keys(first.handlers)).not.toEqual(
      expect.arrayContaining([
        'feedback.redaction.verify',
        'feedback.classify.local',
        'feedback.deduplicate.local',
        'feedback.draft.local',
      ]),
    );
    const persisted = await database.query<{
      readonly job_type: string;
      readonly classification: string;
      readonly payload: unknown;
      readonly count: number;
    }>(
      'SELECT job_type, classification, payload, count(*)::int AS count FROM durable_jobs WHERE job_type = $1 GROUP BY job_type, classification, payload',
      [feedbackRetentionJobType],
    );
    expect(persisted.rows).toEqual([
      {
        job_type: feedbackRetentionJobType,
        classification: 'internal',
        payload: { batch: 25, externalEffect: false, retentionOnly: true },
        count: 1,
      },
    ]);
  });

  it('installs only metadata-only retention and bootstraps it idempotently in production', async () => {
    database = await createSeededTestDatabase(fixedTestNow);
    const jobs = new DurableJobRepository(database);
    const feedback = { purgeDue: vi.fn().mockResolvedValue(0) };
    const composition: FeedbackWorkerComposition = await composeFeedbackWorker({
      environment: 'production',
      feedback,
      jobs,
      now: fixedTestNow,
    });
    await composeFeedbackWorker({
      environment: 'production',
      feedback,
      jobs,
      now: fixedTestNow,
    });
    expect(Object.keys(composition.handlers)).toEqual([feedbackRetentionJobType]);
    expect(Object.keys(composition.handlers)).not.toEqual(
      expect.arrayContaining([
        'feedback.redaction.verify',
        'feedback.classify.local',
        'feedback.deduplicate.local',
        'feedback.draft.local',
      ]),
    );
    const persisted = await database.query<{
      readonly count: number;
      readonly classification: string;
      readonly payload: unknown;
    }>(
      `SELECT count(*)::int AS count, classification, payload
       FROM durable_jobs WHERE job_type = $1 GROUP BY classification, payload`,
      [feedbackRetentionJobType],
    );
    expect(persisted.rows).toEqual([
      {
        count: 1,
        classification: 'internal',
        payload: { batch: 25, externalEffect: false, retentionOnly: true },
      },
    ]);
  });

  it('converges a production restart replay to one content-free successor', async () => {
    database = await createSeededTestDatabase(fixedTestNow);
    const jobs = new DurableJobRepository(database);
    const purgeDue = vi.fn().mockResolvedValue(0);
    let observedAt = fixedTestNow;
    const composition = await composeFeedbackWorker({
      environment: 'production',
      feedback: { purgeDue },
      jobs,
      now: fixedTestNow,
      clock: () => observedAt,
    });
    const claimed = await jobs.claim({
      workerId: 'worker-feedback-production-restart',
      jobTypes: [feedbackRetentionJobType],
      limit: 1,
      leaseDurationMs: 60_000,
      now: fixedTestNow,
    });
    const job = claimed[0];
    if (job === undefined) throw new Error('Production feedback retention job was not claimable');
    const handler = composition.handlers[feedbackRetentionJobType];
    if (handler === undefined) throw new Error('Production feedback retention handler is missing');
    const heartbeat = vi.fn().mockResolvedValue(undefined);
    const context = {
      job,
      idempotencyKey: job.idempotencyKey,
      signal: new AbortController().signal,
      heartbeat,
    };
    await handler(context);
    observedAt = new Date(fixedTestNow.getTime() + 20 * 60_000);
    await handler(context);

    expect(purgeDue).toHaveBeenCalledTimes(2);
    expect(purgeDue).toHaveBeenNthCalledWith(1, { now: fixedTestNow, limit: 25 });
    expect(purgeDue).toHaveBeenNthCalledWith(2, { now: observedAt, limit: 25 });
    expect(heartbeat).toHaveBeenCalledTimes(2);
    const persisted = await database.query<{
      readonly idempotency_key: string;
      readonly payload: unknown;
    }>(
      `SELECT idempotency_key, payload FROM durable_jobs
       WHERE job_type = $1 ORDER BY idempotency_key`,
      [feedbackRetentionJobType],
    );
    expect(persisted.rows).toEqual([
      {
        idempotency_key: feedbackRetentionIntervalKey(fixedTestNow),
        payload: { batch: 25, externalEffect: false, retentionOnly: true },
      },
      {
        idempotency_key: feedbackRetentionIntervalKey(
          new Date(fixedTestNow.getTime() + feedbackRetentionIntervalMs),
        ),
        payload: { batch: 25, externalEffect: false, retentionOnly: true },
      },
    ]);
    expect(JSON.stringify(persisted.rows)).not.toMatch(
      /cipher|text|destination|provider|attachment|media|outbound/iu,
    );
  });
});

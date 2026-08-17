import { DurableJobRepository, type Database } from '@boomerbuddy/persistence';
import { createSeededTestDatabase, fixedTestNow } from '@boomerbuddy/testkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  composeFeedbackWorker,
  type FeedbackWorkerComposition,
} from '../../apps/worker/src/feedback-composition';
import { feedbackRetentionJobType } from '../../apps/worker/src/feedback-retention';

describe('feedback worker composition', () => {
  let database: Database | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  it('installs exactly retention maintenance and idempotently bootstraps one local job', async () => {
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
        payload: { batch: 25, localOnly: true },
        count: 1,
      },
    ]);
  });

  it('installs no feedback handler and enqueues no feedback job in production', async () => {
    database = await createSeededTestDatabase(fixedTestNow);
    const jobs = new DurableJobRepository(database);
    const composition: FeedbackWorkerComposition = await composeFeedbackWorker({
      environment: 'production',
      feedback: { purgeDue: vi.fn().mockResolvedValue(0) },
      jobs,
      now: fixedTestNow,
    });
    expect(composition.handlers).toEqual({});
    const persisted = await database.query<{ readonly count: number }>(
      'SELECT count(*)::int AS count FROM durable_jobs WHERE job_type = $1',
      [feedbackRetentionJobType],
    );
    expect(persisted.rows[0]?.count).toBe(0);
  });
});

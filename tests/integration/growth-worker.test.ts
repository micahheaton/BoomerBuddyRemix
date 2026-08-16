import { afterEach, describe, expect, it } from 'vitest';
import { createSeededTestDatabase, fixedTestNow } from '@boomerbuddy/testkit';
import {
  DurableJobRepository,
  GrowthRuntimeRepository,
  type Database,
  type IdFactory,
} from '@boomerbuddy/persistence';
import {
  createGrowthRuntimeHandlers,
  enqueueGrowthRuntimeJobs,
  growthRuntimeJobTypes,
} from '../../apps/worker/src/growth-runtime';

function ids(): IdFactory {
  let sequence = 0;
  return { next: (prefix) => `${prefix}-growth-worker-${(sequence += 1)}` };
}

describe('growth durable worker registration', () => {
  let database: Database | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  it('registers the three handlers and idempotently bootstraps one durable job for each', async () => {
    database = await createSeededTestDatabase();
    const jobs = new DurableJobRepository(database, ids());
    const growth = new GrowthRuntimeRepository(database, ids());
    const handlers = createGrowthRuntimeHandlers({ growth, jobs });
    expect(Object.keys(handlers).sort()).toEqual([...growthRuntimeJobTypes].sort());

    await enqueueGrowthRuntimeJobs({ jobs, now: fixedTestNow, batch: 100 });
    await enqueueGrowthRuntimeJobs({ jobs, now: fixedTestNow, batch: 100 });
    const queued = await database.query<{
      job_type: string;
      jobs: number;
      idempotency_keys: number;
    }>(
      `SELECT job_type, count(*)::int AS jobs,
              count(DISTINCT idempotency_key)::int AS idempotency_keys
       FROM durable_jobs
       WHERE job_type IN ('attribution.process','lifecycle.advance','customer-health.recalculate')
       GROUP BY job_type ORDER BY job_type`,
    );
    expect(queued.rows).toEqual([
      { job_type: 'attribution.process', jobs: 1, idempotency_keys: 1 },
      { job_type: 'customer-health.recalculate', jobs: 1, idempotency_keys: 1 },
      { job_type: 'lifecycle.advance', jobs: 1, idempotency_keys: 1 },
    ]);
  });
});

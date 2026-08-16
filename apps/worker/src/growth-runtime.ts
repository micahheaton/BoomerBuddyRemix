import { type DurableJobRepository, type GrowthRuntimeRepository } from '@boomerbuddy/persistence';
import type { JobHandler } from '@boomerbuddy/platform';

export const growthRuntimeJobTypes = [
  'attribution.process',
  'lifecycle.advance',
  'customer-health.recalculate',
] as const;

export type GrowthRuntimeJobType = (typeof growthRuntimeJobTypes)[number];

const intervals: Readonly<Record<GrowthRuntimeJobType, number>> = {
  'attribution.process': 60_000,
  'lifecycle.advance': 5 * 60_000,
  'customer-health.recalculate': 60 * 60_000,
};

function batchFromPayload(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? Math.max(1, Math.min(value, 500))
    : 100;
}

export function growthRuntimeIntervalKey(type: GrowthRuntimeJobType, at: Date): string {
  if (!Number.isFinite(at.getTime())) throw new TypeError('Growth job schedule is invalid');
  return `${type}:interval:${Math.floor(at.getTime() / intervals[type])}`;
}

async function enqueueNext(input: {
  readonly jobs: DurableJobRepository;
  readonly type: GrowthRuntimeJobType;
  readonly currentJobId: string;
  readonly batch: number;
  readonly workWasFound: boolean;
  readonly now: Date;
}): Promise<void> {
  const scheduledAt = new Date(
    input.now.getTime() + (input.workWasFound ? 1_000 : intervals[input.type]),
  );
  const idempotencyKey = input.workWasFound
    ? `${input.type}:continue:${input.currentJobId}`
    : growthRuntimeIntervalKey(input.type, scheduledAt);
  await input.jobs.enqueue({
    type: input.type,
    payload: { batch: input.batch },
    idempotencyKey,
    scheduledAt,
    maxAttempts: 8,
    correlationId: idempotencyKey,
  });
}

export function createGrowthRuntimeHandlers(input: {
  readonly growth: GrowthRuntimeRepository;
  readonly jobs: DurableJobRepository;
  readonly clock?: () => Date;
}): Readonly<Record<GrowthRuntimeJobType, JobHandler>> {
  const clock = input.clock ?? (() => new Date());
  const attribution: JobHandler = async ({ job, heartbeat }) => {
    const batch = batchFromPayload(job.payload.batch);
    const now = clock();
    const processed = await input.growth.projectPending({ limit: batch, now });
    await heartbeat();
    await enqueueNext({
      jobs: input.jobs,
      type: 'attribution.process',
      currentJobId: job.id,
      batch,
      workWasFound: processed === batch,
      now,
    });
  };
  const lifecycle: JobHandler = async ({ job, heartbeat }) => {
    const batch = batchFromPayload(job.payload.batch);
    const now = clock();
    const advanced = await input.growth.projectDueLifecycle({ limit: batch, now });
    const notifications = await input.growth.processReadyLifecycleNotifications({
      limit: batch,
      now,
    });
    await heartbeat();
    await enqueueNext({
      jobs: input.jobs,
      type: 'lifecycle.advance',
      currentJobId: job.id,
      batch,
      workWasFound:
        advanced === batch ||
        notifications.materialized > 0 ||
        notifications.completed > 0 ||
        notifications.suppressed > 0,
      now,
    });
  };
  const health: JobHandler = async ({ job, heartbeat }) => {
    const batch = batchFromPayload(job.payload.batch);
    const now = clock();
    const calculated = await input.growth.recalculateStaleHealth({ limit: batch, now });
    await heartbeat();
    await enqueueNext({
      jobs: input.jobs,
      type: 'customer-health.recalculate',
      currentJobId: job.id,
      batch,
      workWasFound: calculated === batch,
      now,
    });
  };
  return {
    'attribution.process': attribution,
    'lifecycle.advance': lifecycle,
    'customer-health.recalculate': health,
  };
}

export async function enqueueGrowthRuntimeJobs(input: {
  readonly jobs: DurableJobRepository;
  readonly now: Date;
  readonly batch?: number;
}): Promise<void> {
  const batch = batchFromPayload(input.batch);
  await Promise.all(
    growthRuntimeJobTypes.map(async (type) => {
      const idempotencyKey = growthRuntimeIntervalKey(type, input.now);
      await input.jobs.enqueue({
        type,
        payload: { batch },
        idempotencyKey,
        scheduledAt: input.now,
        maxAttempts: 8,
        correlationId: idempotencyKey,
      });
    }),
  );
}

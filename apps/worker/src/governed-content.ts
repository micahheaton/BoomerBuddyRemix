import type { DurableJobRepository, GovernedContentRepository } from '@boomerbuddy/persistence';
import type { JobHandler } from '@boomerbuddy/platform';

export const governedContentDailyJobType = 'editorial.daily-draft';

export function governedContentScheduleDate(at: Date): string {
  if (!Number.isFinite(at.getTime())) throw new TypeError('Content schedule time is invalid');
  return at.toISOString().slice(0, 10);
}

function nextUtcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1, 8, 0, 0));
}

export async function enqueueGovernedContentDailyJob(input: {
  readonly jobs: Pick<DurableJobRepository, 'enqueue'>;
  readonly now: Date;
}): Promise<void> {
  const scheduleDate = governedContentScheduleDate(input.now);
  const idempotencyKey = `${governedContentDailyJobType}:${scheduleDate}`;
  await input.jobs.enqueue({
    type: governedContentDailyJobType,
    classification: 'internal',
    payload: { scheduleDate, batch: 1 },
    idempotencyKey,
    scheduledAt: input.now,
    maxAttempts: 8,
    correlationId: idempotencyKey,
  });
}

export function createGovernedContentDailyHandler(input: {
  readonly content: Pick<GovernedContentRepository, 'generateDailyDrafts'>;
  readonly jobs: Pick<DurableJobRepository, 'enqueue'>;
  readonly clock?: () => Date;
}): JobHandler {
  const clock = input.clock ?? (() => new Date());
  return async ({ heartbeat, job }) => {
    const now = clock();
    const scheduleDate =
      typeof job.payload.scheduleDate === 'string'
        ? job.payload.scheduleDate
        : governedContentScheduleDate(now);
    const batch =
      typeof job.payload.batch === 'number' && Number.isSafeInteger(job.payload.batch)
        ? Math.min(Math.max(job.payload.batch, 1), 25)
        : 1;
    await input.content.generateDailyDrafts({ scheduleDate, now, limit: batch });
    await heartbeat();
    const scheduledAt = nextUtcDay(now);
    const nextScheduleDate = governedContentScheduleDate(scheduledAt);
    const idempotencyKey = `${governedContentDailyJobType}:${nextScheduleDate}`;
    await input.jobs.enqueue({
      type: governedContentDailyJobType,
      classification: 'internal',
      payload: { scheduleDate: nextScheduleDate, batch },
      idempotencyKey,
      scheduledAt,
      maxAttempts: 8,
      correlationId: idempotencyKey,
    });
  };
}

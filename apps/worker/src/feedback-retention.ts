import type { DurableJobRepository } from '@boomerbuddy/persistence';
import type { JobHandler } from '@boomerbuddy/platform';

export const feedbackRetentionJobType = 'feedback.retention.maintain';
export const feedbackRetentionIntervalMs = 15 * 60_000;

function boundedBatch(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? Math.max(1, Math.min(value, 100))
    : 25;
}

function assertedJobBatch(job: Parameters<JobHandler>[0]['job']): number {
  const payloadKeys = Object.keys(job.payload).sort();
  const legacyProviderFreeJob =
    job.version === 1 &&
    job.payload.localOnly === true &&
    payloadKeys.length === 2 &&
    payloadKeys[0] === 'batch' &&
    payloadKeys[1] === 'localOnly';
  const retentionOnlyJob =
    job.version === 2 &&
    job.payload.externalEffect === false &&
    job.payload.retentionOnly === true &&
    payloadKeys.length === 3 &&
    payloadKeys[0] === 'batch' &&
    payloadKeys[1] === 'externalEffect' &&
    payloadKeys[2] === 'retentionOnly';
  if (
    job.type !== feedbackRetentionJobType ||
    job.classification !== 'internal' ||
    (!legacyProviderFreeJob && !retentionOnlyJob) ||
    typeof job.payload.batch !== 'number' ||
    !Number.isSafeInteger(job.payload.batch) ||
    job.payload.batch < 1 ||
    job.payload.batch > 100
  ) {
    throw new TypeError('Feedback retention requires an exact content-free retention-only job');
  }
  return job.payload.batch;
}

export function feedbackRetentionIntervalKey(at: Date): string {
  if (!Number.isFinite(at.getTime())) throw new TypeError('Feedback retention time is invalid');
  return `${feedbackRetentionJobType}:v2:interval:${Math.floor(
    at.getTime() / feedbackRetentionIntervalMs,
  )}`;
}

export async function enqueueFeedbackRetention(input: {
  readonly jobs: Pick<DurableJobRepository, 'enqueue'>;
  readonly now: Date;
  readonly batch?: number;
}): Promise<void> {
  const idempotencyKey = feedbackRetentionIntervalKey(input.now);
  await input.jobs.enqueue({
    type: feedbackRetentionJobType,
    version: 2,
    classification: 'internal',
    payload: {
      batch: boundedBatch(input.batch),
      externalEffect: false,
      retentionOnly: true,
    },
    idempotencyKey,
    scheduledAt: input.now,
    maxAttempts: 8,
    correlationId: idempotencyKey,
  });
}

export function createFeedbackRetentionHandler(input: {
  readonly feedback: {
    purgeDue(value: { readonly now: Date; readonly limit: number }): Promise<number>;
  };
  readonly jobs: Pick<DurableJobRepository, 'enqueue'>;
  readonly clock?: () => Date;
}): JobHandler {
  const clock = input.clock ?? (() => new Date());
  return async ({ heartbeat, job }) => {
    const batch = assertedJobBatch(job);
    const observedAt = clock();
    const erased = await input.feedback.purgeDue({ now: observedAt, limit: batch });
    await heartbeat();
    const scheduledAt = new Date(
      (erased === batch ? observedAt : job.nextAttemptAt).getTime() +
        (erased === batch ? 1_000 : feedbackRetentionIntervalMs),
    );
    const idempotencyKey =
      erased === batch
        ? `${feedbackRetentionJobType}:v2:continue:${job.id}`
        : feedbackRetentionIntervalKey(scheduledAt);
    await input.jobs.enqueue({
      type: feedbackRetentionJobType,
      version: 2,
      classification: 'internal',
      payload: { batch, externalEffect: false, retentionOnly: true },
      idempotencyKey,
      scheduledAt,
      maxAttempts: 8,
      correlationId: idempotencyKey,
    });
  };
}

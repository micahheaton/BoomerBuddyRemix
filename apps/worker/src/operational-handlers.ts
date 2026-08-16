import { runEvaluation, runOneCorpus } from '@boomerbuddy/eval-lab';
import type {
  DurableJobRepository,
  OperationalWorkRepository,
  DurableJobPayload,
} from '@boomerbuddy/persistence';
import { JobExecutionError, type JobHandler } from '@boomerbuddy/platform';

const intelligenceIntervalMs = 24 * 60 * 60_000;
const evaluationIntervalMs = 7 * 24 * 60 * 60_000;

function stringField(payload: DurableJobPayload, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new JobExecutionError('invalid_job_payload', false);
  }
  return value;
}

function numberField(payload: DurableJobPayload, key: string): number {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new JobExecutionError('invalid_job_payload', false);
  }
  return value;
}

function intervalBoundary(now: Date, intervalMs: number): Date {
  return new Date(Math.floor(now.getTime() / intervalMs) * intervalMs);
}

function intervalKey(type: string, boundary: Date): string {
  return `${type}:${boundary.toISOString()}`;
}

async function enqueueRecurring(input: {
  readonly jobs: DurableJobRepository;
  readonly type: string;
  readonly payload: DurableJobPayload;
  readonly boundary: Date;
  readonly scheduledAt: Date;
}): Promise<void> {
  const idempotencyKey = intervalKey(input.type, input.boundary);
  await input.jobs.enqueue({
    type: input.type,
    payload: input.payload,
    idempotencyKey,
    scheduledAt: input.scheduledAt,
    maxAttempts: 8,
    correlationId: idempotencyKey,
  });
}

async function enqueueNext(input: {
  readonly jobs: DurableJobRepository;
  readonly type: string;
  readonly payload: DurableJobPayload;
  readonly intervalMs: number;
  readonly now: Date;
}): Promise<void> {
  const boundary = new Date(
    intervalBoundary(input.now, input.intervalMs).getTime() + input.intervalMs,
  );
  await enqueueRecurring({
    jobs: input.jobs,
    type: input.type,
    payload: input.payload,
    boundary,
    scheduledAt: boundary,
  });
}

export async function seedOperationalSchedules(input: {
  readonly jobs: DurableJobRepository;
  readonly now: Date;
}): Promise<void> {
  const schedules = [
    {
      type: 'intelligence.refresh',
      payload: { locale: 'en-US', jurisdiction: 'US', freshnessDays: 90 },
      intervalMs: intelligenceIntervalMs,
    },
    {
      type: 'evaluation.run',
      payload: { corpusKey: 'boomerbuddy-run-1-synthetic', corpusVersion: 1 },
      intervalMs: evaluationIntervalMs,
    },
  ] as const;
  for (const schedule of schedules) {
    await enqueueRecurring({
      jobs: input.jobs,
      type: schedule.type,
      payload: schedule.payload,
      boundary: intervalBoundary(input.now, schedule.intervalMs),
      scheduledAt: input.now,
    });
  }
}

export function createOperationalHandlers(input: {
  readonly jobs: DurableJobRepository;
  readonly operations: OperationalWorkRepository;
  readonly fingerprintKey: Uint8Array;
  readonly clock?: () => Date;
}): Readonly<Record<string, JobHandler>> {
  const clock = input.clock ?? (() => new Date());
  const notification: JobHandler = async ({ job, heartbeat }) => {
    const requestId = stringField(job.payload, 'requestId');
    await heartbeat();
    await input.operations.dispatchNotification({ requestId, jobId: job.id, now: clock() });
  };
  const intelligence: JobHandler = async ({ job, heartbeat }) => {
    const locale = stringField(job.payload, 'locale');
    const jurisdiction = stringField(job.payload, 'jurisdiction');
    const freshnessDays = numberField(job.payload, 'freshnessDays');
    const now = clock();
    await input.operations.recordIntelligenceRefresh({
      jobId: job.id,
      locale,
      jurisdiction,
      freshnessDays,
      now,
    });
    await heartbeat();
    await enqueueNext({
      jobs: input.jobs,
      type: job.type,
      payload: { locale, jurisdiction, freshnessDays },
      intervalMs: intelligenceIntervalMs,
      now,
    });
  };
  const evaluation: JobHandler = async ({ job, heartbeat }) => {
    const corpusKey = stringField(job.payload, 'corpusKey');
    const corpusVersion = numberField(job.payload, 'corpusVersion');
    if (corpusKey !== runOneCorpus.corpusId || corpusVersion !== runOneCorpus.version) {
      throw new JobExecutionError('unsupported_evaluation_corpus', false);
    }
    const now = clock();
    const report = await runEvaluation(runOneCorpus, {
      fingerprintKey: input.fingerprintKey,
      now,
    });
    await heartbeat();
    await input.operations.recordEvaluationRun({
      jobId: job.id,
      corpusKey: report.corpus.id,
      corpusVersion: report.corpus.version,
      cases: report.summary.cases,
      passed: report.summary.passed,
      failed: report.summary.failed,
      forbiddenActionViolations: report.summary.forbiddenActionViolations,
      providerFailures: report.summary.providerFailures,
      calibration: report.calibration,
      now,
    });
    await enqueueNext({
      jobs: input.jobs,
      type: job.type,
      payload: { corpusKey, corpusVersion },
      intervalMs: evaluationIntervalMs,
      now,
    });
  };
  return {
    'notification.dispatch': notification,
    'intelligence.refresh': intelligence,
    'evaluation.run': evaluation,
  };
}

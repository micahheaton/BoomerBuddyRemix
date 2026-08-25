import type { Logger } from '@boomerbuddy/observability';
import type {
  ClaimedOutboxEvent,
  DurableJob,
  DurableJobRepository,
  OutboxDeliveryRepository,
} from '@boomerbuddy/persistence';
import type { WorkerRuntimeConfig } from './config';

export interface JobHandlerContext {
  readonly job: DurableJob;
  readonly idempotencyKey: string;
  readonly signal: AbortSignal;
  readonly heartbeat: () => Promise<boolean>;
}

export type JobHandler = (context: JobHandlerContext) => Promise<void>;
export type OutboxHandler = (context: {
  readonly event: ClaimedOutboxEvent;
  readonly idempotencyKey: string;
  readonly signal: AbortSignal;
  readonly heartbeat: () => Promise<boolean>;
}) => Promise<void>;

export interface SelectiveOutboxHandler {
  readonly eventTypes: readonly string[];
  readonly handle: OutboxHandler;
}

function unrefTimer(timer: unknown): void {
  if (
    typeof timer === 'object' &&
    timer !== null &&
    'unref' in timer &&
    typeof timer.unref === 'function'
  ) {
    timer.unref();
  }
}

export class JobExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly retryable = true,
  ) {
    super(code);
    this.name = 'JobExecutionError';
  }
}

export function boundedRetryDelay(input: {
  readonly attempt: number;
  readonly baseMs: number;
  readonly maximumMs: number;
  readonly random?: () => number;
}): number {
  if (
    !Number.isSafeInteger(input.attempt) ||
    input.attempt < 1 ||
    !Number.isSafeInteger(input.baseMs) ||
    input.baseMs < 1 ||
    !Number.isSafeInteger(input.maximumMs) ||
    input.maximumMs < input.baseMs
  ) {
    throw new TypeError('Invalid retry policy');
  }
  const exponent = Math.min(input.attempt - 1, 20);
  const ceiling = Math.min(input.maximumMs, input.baseMs * 2 ** exponent);
  const random = Math.min(1, Math.max(0, (input.random ?? Math.random)()));
  return Math.max(input.baseMs, Math.floor(ceiling / 2 + (ceiling / 2) * random));
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, milliseconds);
    unrefTimer(timeout);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

function serializedLeaseHeartbeat(renew: () => Promise<boolean>): {
  readonly heartbeat: () => Promise<boolean>;
  readonly settled: () => Promise<boolean>;
} {
  let tail = Promise.resolve(true);
  const heartbeat = (): Promise<boolean> => {
    const pending = tail.then(async (held) => {
      if (!held) return false;
      try {
        return await renew();
      } catch {
        return false;
      }
    });
    tail = pending;
    return pending;
  };
  return { heartbeat, settled: () => tail };
}

export class PortableWorker {
  private readonly controller = new AbortController();
  private readonly startedAt: Date;
  private readonly active = new Set<Promise<void>>();
  private stopping = false;
  private stopPromise: Promise<void> | undefined;

  constructor(
    private readonly jobs: DurableJobRepository,
    private readonly outbox: OutboxDeliveryRepository,
    private readonly handlers: Readonly<Record<string, JobHandler>>,
    private readonly outboxHandler: SelectiveOutboxHandler | undefined,
    private readonly config: WorkerRuntimeConfig,
    private readonly logger: Logger,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.startedAt = clock();
  }

  private nextAttempt(job: DurableJob, minimumDelayMs = 0): Date {
    return new Date(
      this.clock().getTime() +
        Math.max(
          minimumDelayMs,
          boundedRetryDelay({
            attempt: job.attempts,
            baseMs: this.config.retryBaseMs,
            maximumMs: this.config.retryMaxMs,
          }),
        ),
    );
  }

  private async processJob(job: DurableJob): Promise<void> {
    const handler = this.handlers[job.type];
    if (handler === undefined) return;
    const now = this.clock();
    const consumerKey = `job-handler:${job.type}:v${job.version}`;
    const receipt = await this.jobs.beginConsumerReceipt({
      consumerKey,
      idempotencyKey: job.idempotencyKey,
      jobId: job.id,
      workerId: this.config.workerId,
      leaseDurationMs: this.config.leaseDurationMs,
      now,
    });
    if (receipt === 'completed') {
      await this.jobs.complete({
        jobId: job.id,
        workerId: this.config.workerId,
        now: this.clock(),
      });
      return;
    }
    if (receipt === 'busy') {
      await this.jobs.fail({
        jobId: job.id,
        workerId: this.config.workerId,
        errorCode: 'consumer_receipt_busy',
        nextAttemptAt: this.nextAttempt(job, this.config.leaseDurationMs),
        now: this.clock(),
      });
      return;
    }
    const lease = serializedLeaseHeartbeat(() =>
      this.jobs.heartbeatWithConsumerReceipt({
        jobId: job.id,
        consumerKey,
        idempotencyKey: job.idempotencyKey,
        workerId: this.config.workerId,
        leaseDurationMs: this.config.leaseDurationMs,
        now: this.clock(),
      }),
    );
    const timer = setInterval(() => void lease.heartbeat(), this.config.heartbeatIntervalMs);
    unrefTimer(timer);
    try {
      await handler({
        job,
        idempotencyKey: job.idempotencyKey,
        signal: this.controller.signal,
        heartbeat: lease.heartbeat,
      });
      clearInterval(timer);
      if (!(await lease.settled())) throw new JobExecutionError('consumer_receipt_lease_lost');
      const completedReceipt = await this.jobs.completeConsumerReceipt({
        consumerKey,
        idempotencyKey: job.idempotencyKey,
        workerId: this.config.workerId,
        resultCode: 'completed',
        now: this.clock(),
      });
      if (!completedReceipt) throw new JobExecutionError('consumer_receipt_lease_lost');
      const completed = await this.jobs.complete({
        jobId: job.id,
        workerId: this.config.workerId,
        now: this.clock(),
      });
      if (!completed) throw new JobExecutionError('job_lease_lost');
      this.logger.info('worker.job_completed', { jobId: job.id, jobType: job.type });
    } catch (error) {
      clearInterval(timer);
      const classified =
        error instanceof JobExecutionError ? error : new JobExecutionError('handler_failed', true);
      if (classified.retryable) {
        await this.jobs.fail({
          jobId: job.id,
          workerId: this.config.workerId,
          errorCode: classified.code,
          nextAttemptAt: this.nextAttempt(job, this.config.leaseDurationMs),
          now: this.clock(),
        });
      } else {
        await this.jobs.deadLetter({
          jobId: job.id,
          workerId: this.config.workerId,
          errorCode: classified.code,
          now: this.clock(),
        });
      }
      this.logger.error('worker.job_failed', {
        jobId: job.id,
        jobType: job.type,
        errorCode: classified.code,
      });
    } finally {
      clearInterval(timer);
    }
  }

  private async processOutbox(event: ClaimedOutboxEvent): Promise<void> {
    if (this.outboxHandler === undefined) return;
    const lease = serializedLeaseHeartbeat(() =>
      this.outbox.heartbeat({
        eventId: event.id,
        workerId: this.config.workerId,
        leaseDurationMs: this.config.leaseDurationMs,
        now: this.clock(),
      }),
    );
    const timer = setInterval(() => void lease.heartbeat(), this.config.heartbeatIntervalMs);
    unrefTimer(timer);
    try {
      await this.outboxHandler.handle({
        event,
        idempotencyKey: event.id,
        signal: this.controller.signal,
        heartbeat: lease.heartbeat,
      });
      clearInterval(timer);
      if (!(await lease.settled())) throw new JobExecutionError('outbox_lease_lost');
      const completed = await this.outbox.complete({
        eventId: event.id,
        workerId: this.config.workerId,
        now: this.clock(),
      });
      if (!completed) throw new JobExecutionError('outbox_lease_lost');
      this.logger.info('worker.outbox_completed', {
        eventId: event.id,
        eventType: event.eventType,
      });
    } catch (error) {
      clearInterval(timer);
      const classified =
        error instanceof JobExecutionError ? error : new JobExecutionError('dispatcher_failed');
      const nextAttemptAt = new Date(
        this.clock().getTime() +
          boundedRetryDelay({
            attempt: event.attempts,
            baseMs: this.config.retryBaseMs,
            maximumMs: this.config.retryMaxMs,
          }),
      );
      const failureState = await this.outbox.fail({
        eventId: event.id,
        workerId: this.config.workerId,
        errorCode: classified.code,
        nextAttemptAt,
        now: this.clock(),
      });
      this.logger.error('worker.outbox_failed', {
        eventId: event.id,
        eventType: event.eventType,
        errorCode: classified.code,
        failureState,
      });
    } finally {
      clearInterval(timer);
    }
  }

  async runOnce(): Promise<{ readonly jobs: number; readonly outbox: number }> {
    if (this.stopping) return { jobs: 0, outbox: 0 };
    const jobTypes = Object.keys(this.handlers);
    const [claimedJobs, claimedOutbox] = await Promise.all([
      this.jobs.claim({
        workerId: this.config.workerId,
        jobTypes,
        limit: this.config.batchSize,
        leaseDurationMs: this.config.leaseDurationMs,
        now: this.clock(),
      }),
      this.outboxHandler === undefined
        ? Promise.resolve([])
        : this.outbox.claim({
            workerId: this.config.workerId,
            eventTypes: this.outboxHandler.eventTypes,
            limit: this.config.batchSize,
            leaseDurationMs: this.config.leaseDurationMs,
            now: this.clock(),
          }),
    ]);
    const executions = [
      ...claimedJobs.map((job) => this.processJob(job)),
      ...claimedOutbox.map((event) => this.processOutbox(event)),
    ];
    for (const execution of executions) {
      this.active.add(execution);
      void execution.then(
        () => this.active.delete(execution),
        () => this.active.delete(execution),
      );
    }
    await Promise.allSettled(executions);
    return { jobs: claimedJobs.length, outbox: claimedOutbox.length };
  }

  async start(): Promise<void> {
    this.logger.info('worker.started', { workerId: this.config.workerId });
    while (!this.stopping) {
      await this.jobs.updateWorkerHeartbeat({
        workerId: this.config.workerId,
        state: 'running',
        currentJobCount: this.active.size,
        version: 'run2-v1',
        startedAt: this.startedAt,
        now: this.clock(),
      });
      try {
        await this.runOnce();
      } catch (error) {
        this.logger.error('worker.poll_failed', { error });
      }
      await delay(this.config.pollIntervalMs, this.controller.signal);
    }
  }

  stop(): Promise<void> {
    if (this.stopPromise !== undefined) return this.stopPromise;
    this.stopping = true;
    this.controller.abort();
    this.stopPromise = this.finishStop();
    return this.stopPromise;
  }

  private async finishStop(): Promise<void> {
    await this.jobs.updateWorkerHeartbeat({
      workerId: this.config.workerId,
      state: 'draining',
      currentJobCount: this.active.size,
      version: 'run2-v1',
      startedAt: this.startedAt,
      now: this.clock(),
    });
    const completion = Promise.allSettled([...this.active]);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      completion,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, this.config.shutdownTimeoutMs);
        unrefTimer(timeout);
      }),
    ]);
    if (timeout !== undefined) clearTimeout(timeout);
    await Promise.all([
      this.jobs.relinquishWorkerLeases({ workerId: this.config.workerId, now: this.clock() }),
      this.outbox.relinquishWorkerLeases({ workerId: this.config.workerId, now: this.clock() }),
    ]);
    await this.jobs.updateWorkerHeartbeat({
      workerId: this.config.workerId,
      state: 'stopped',
      currentJobCount: 0,
      version: 'run2-v1',
      startedAt: this.startedAt,
      now: this.clock(),
    });
    this.logger.info('worker.stopped', { workerId: this.config.workerId });
  }
}

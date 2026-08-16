import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger, type LogRecord } from '@boomerbuddy/observability';
import type {
  ClaimedOutboxEvent,
  DurableJob,
  DurableJobRepository,
  OutboxDeliveryRepository,
} from '@boomerbuddy/persistence';
import type { WorkerRuntimeConfig } from './config';
import { PortableWorker } from './worker';

const now = new Date('2026-08-16T12:00:00.000Z');

const config: WorkerRuntimeConfig = {
  workerId: 'worker-test-one',
  pollIntervalMs: 50,
  leaseDurationMs: 1_000,
  heartbeatIntervalMs: 100,
  shutdownTimeoutMs: 1_000,
  batchSize: 1,
  retryBaseMs: 100,
  retryMaxMs: 1_000,
};

const job: DurableJob = {
  id: 'job-one',
  type: 'test.long-handler',
  version: 1,
  classification: 'internal',
  payload: { evaluationId: 'evaluation-one' },
  idempotencyKey: 'test-long-handler-one',
  state: 'running',
  priority: 0,
  attempts: 1,
  maxAttempts: 3,
  nextAttemptAt: now,
  leaseOwner: config.workerId,
  leaseExpiresAt: new Date(now.getTime() + config.leaseDurationMs),
  correlationId: 'test-long-handler-one',
};

const event: ClaimedOutboxEvent = {
  id: 'event-one',
  eventType: 'test.event.v1',
  eventVersion: 1,
  aggregateType: 'test',
  aggregateId: 'aggregate-one',
  correlationId: 'test-event-one',
  classification: 'internal',
  payload: { state: 'ready' },
  attempts: 1,
  maxAttempts: 3,
  leaseOwner: config.workerId,
  leaseExpiresAt: new Date(now.getTime() + config.leaseDurationMs),
};

afterEach(() => vi.useRealTimers());

describe('portable worker leases', () => {
  it('uses one atomic heartbeat for the job and its consumer receipt', async () => {
    let heartbeatInput:
      | {
          readonly jobId: string;
          readonly consumerKey: string;
          readonly idempotencyKey: string;
        }
      | undefined;
    const jobs = {
      claim: async () => [job],
      beginConsumerReceipt: async () => 'acquired' as const,
      heartbeatWithConsumerReceipt: async (input) => {
        heartbeatInput = input;
        return true;
      },
      completeConsumerReceipt: async () => true,
      complete: async () => true,
      fail: async () => 'retry' as const,
      deadLetter: async () => true,
    } satisfies Partial<DurableJobRepository>;
    const outbox = {
      claim: async () => [],
    } satisfies Partial<OutboxDeliveryRepository>;
    const records: LogRecord[] = [];
    const worker = new PortableWorker(
      jobs as unknown as DurableJobRepository,
      outbox as unknown as OutboxDeliveryRepository,
      {
        [job.type]: async ({ heartbeat }) => {
          await expect(heartbeat()).resolves.toBe(true);
        },
      },
      undefined,
      config,
      createLogger({ sink: (record) => records.push(record), clock: () => now }),
      () => now,
    );

    await expect(worker.runOnce()).resolves.toEqual({ jobs: 1, outbox: 0 });
    expect(heartbeatInput).toMatchObject({
      jobId: job.id,
      consumerKey: `job-handler:${job.type}:v${job.version}`,
      idempotencyKey: job.idempotencyKey,
    });
    expect(records.map((record) => record.event)).toContain('worker.job_completed');
  });

  it('automatically heartbeats an outbox handler that runs longer than one lease', async () => {
    vi.useFakeTimers();
    let heartbeatCalls = 0;
    let releaseHandler: (() => void) | undefined;
    const jobs = {
      claim: async () => [],
    } satisfies Partial<DurableJobRepository>;
    const outbox = {
      claim: async () => [event],
      heartbeat: async () => {
        heartbeatCalls += 1;
        return true;
      },
      complete: async () => true,
      fail: async () => 'retry' as const,
    } satisfies Partial<OutboxDeliveryRepository>;
    const worker = new PortableWorker(
      jobs as unknown as DurableJobRepository,
      outbox as unknown as OutboxDeliveryRepository,
      {},
      {
        eventTypes: [event.eventType],
        handle: async () =>
          new Promise<void>((resolve) => {
            releaseHandler = resolve;
          }),
      },
      config,
      createLogger({ sink: () => undefined, clock: () => now }),
      () => now,
    );

    const execution = worker.runOnce();
    await vi.advanceTimersByTimeAsync(config.leaseDurationMs + config.heartbeatIntervalMs);
    expect(heartbeatCalls).toBeGreaterThanOrEqual(
      config.leaseDurationMs / config.heartbeatIntervalMs,
    );
    expect(releaseHandler).toBeTypeOf('function');
    releaseHandler?.();
    await expect(execution).resolves.toEqual({ jobs: 0, outbox: 1 });
  });

  it('fails a lost outbox completion without logging a false success', async () => {
    let failureCalls = 0;
    const jobs = {
      claim: async () => [],
    } satisfies Partial<DurableJobRepository>;
    const outbox = {
      claim: async () => [event],
      heartbeat: async () => true,
      complete: async () => false,
      fail: async () => {
        failureCalls += 1;
        return 'lost_lease' as const;
      },
    } satisfies Partial<OutboxDeliveryRepository>;
    const records: LogRecord[] = [];
    const worker = new PortableWorker(
      jobs as unknown as DurableJobRepository,
      outbox as unknown as OutboxDeliveryRepository,
      {},
      { eventTypes: [event.eventType], handle: async () => undefined },
      config,
      createLogger({ sink: (record) => records.push(record), clock: () => now }),
      () => now,
    );

    await expect(worker.runOnce()).resolves.toEqual({ jobs: 0, outbox: 1 });
    expect(failureCalls).toBe(1);
    expect(records.map((record) => record.event)).not.toContain('worker.outbox_completed');
    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'error',
        event: 'worker.outbox_failed',
        fields: expect.objectContaining({
          errorCode: 'outbox_lease_lost',
          failureState: 'lost_lease',
        }),
      }),
    );
  });

  it('shares one in-flight shutdown before leases or the database may close', async () => {
    const workerStates: string[] = [];
    let releaseDraining: (() => void) | undefined;
    let jobRelinquishes = 0;
    let outboxRelinquishes = 0;
    const draining = new Promise<void>((resolve) => {
      releaseDraining = resolve;
    });
    const jobs = {
      updateWorkerHeartbeat: async (input) => {
        workerStates.push(input.state);
        if (input.state === 'draining') await draining;
      },
      relinquishWorkerLeases: async () => {
        jobRelinquishes += 1;
        return 0;
      },
    } satisfies Partial<DurableJobRepository>;
    const outbox = {
      relinquishWorkerLeases: async () => {
        outboxRelinquishes += 1;
        return 0;
      },
    } satisfies Partial<OutboxDeliveryRepository>;
    const worker = new PortableWorker(
      jobs as unknown as DurableJobRepository,
      outbox as unknown as OutboxDeliveryRepository,
      {},
      undefined,
      config,
      createLogger({ sink: () => undefined, clock: () => now }),
      () => now,
    );

    const signalStop = worker.stop();
    const finallyStop = worker.stop();
    expect(finallyStop).toBe(signalStop);
    expect(workerStates).toEqual(['draining']);
    expect(jobRelinquishes).toBe(0);
    releaseDraining?.();
    await Promise.all([signalStop, finallyStop]);
    expect(workerStates).toEqual(['draining', 'stopped']);
    expect(jobRelinquishes).toBe(1);
    expect(outboxRelinquishes).toBe(1);
  });
});

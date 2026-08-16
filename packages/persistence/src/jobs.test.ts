import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSeededTestDatabase, fixedTestNow } from '@boomerbuddy/testkit';
import type { Database } from './database';
import { OutboxDeliveryRepository } from './events';
import { DurableJobRepository } from './jobs';
import type { IdFactory } from './values';

function sequentialIds(): IdFactory {
  let counter = 0;
  return { next: (prefix) => `${prefix}-jobs-test-${++counter}` };
}

describe('durable database jobs', () => {
  let database: Database;
  let ids: IdFactory;
  let jobs: DurableJobRepository;

  beforeEach(async () => {
    database = await createSeededTestDatabase();
    ids = sequentialIds();
    jobs = new DurableJobRepository(database, ids);
  });

  afterEach(async () => database.close());

  it('deduplicates enqueue, rejects conflicting evidence, and reclaims expired leases', async () => {
    const first = await jobs.enqueue({
      type: 'billing.reconcile',
      householdId: 'household-sunrise',
      payload: { provider: 'stripe', batch: 10 },
      idempotencyKey: 'billing-reconcile-one',
      scheduledAt: fixedTestNow,
      correlationId: 'billing-reconcile-one',
      maxAttempts: 3,
    });
    expect(first.duplicate).toBe(false);
    await expect(
      jobs.enqueue({
        type: 'billing.reconcile',
        householdId: 'household-sunrise',
        payload: { provider: 'stripe', batch: 10 },
        idempotencyKey: 'billing-reconcile-one',
        scheduledAt: fixedTestNow,
        correlationId: 'billing-reconcile-one',
        maxAttempts: 3,
      }),
    ).resolves.toMatchObject({ duplicate: true });
    await expect(
      jobs.enqueue({
        type: 'billing.reconcile',
        householdId: 'household-harbor',
        payload: { provider: 'stripe', batch: 10 },
        idempotencyKey: 'billing-reconcile-one',
        scheduledAt: fixedTestNow,
        correlationId: 'billing-reconcile-other-tenant',
        maxAttempts: 3,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      jobs.enqueue({
        type: 'billing.reconcile',
        householdId: 'household-sunrise',
        payload: { provider: 'stripe', batch: 10 },
        idempotencyKey: 'billing-reconcile-one',
        scheduledAt: new Date(fixedTestNow.getTime() + 1),
        correlationId: 'billing-reconcile-rescheduled',
        maxAttempts: 3,
      }),
    ).resolves.toMatchObject({
      duplicate: true,
      job: { nextAttemptAt: fixedTestNow, correlationId: 'billing-reconcile-one' },
    });
    await expect(
      jobs.enqueue({
        type: 'billing.reconcile',
        payload: { provider: 'stripe', batch: 11 },
        idempotencyKey: 'billing-reconcile-one',
        scheduledAt: fixedTestNow,
        correlationId: 'billing-reconcile-one',
      }),
    ).rejects.toMatchObject({ code: 'conflict' });

    const workerOne = await jobs.claim({
      workerId: 'worker-one',
      jobTypes: ['billing.reconcile'],
      limit: 1,
      leaseDurationMs: 5_000,
      now: fixedTestNow,
    });
    expect(workerOne).toHaveLength(1);
    await expect(
      jobs.claim({
        workerId: 'worker-two',
        jobTypes: ['billing.reconcile'],
        limit: 1,
        leaseDurationMs: 5_000,
        now: new Date(fixedTestNow.getTime() + 4_999),
      }),
    ).resolves.toEqual([]);
    const reclaimed = await jobs.claim({
      workerId: 'worker-two',
      jobTypes: ['billing.reconcile'],
      limit: 1,
      leaseDurationMs: 5_000,
      now: new Date(fixedTestNow.getTime() + 5_001),
    });
    expect(reclaimed[0]).toMatchObject({ leaseOwner: 'worker-two', attempts: 2 });
    await expect(
      jobs.complete({
        jobId: first.job.id,
        workerId: 'worker-one',
        now: new Date(fixedTestNow.getTime() + 5_002),
      }),
    ).resolves.toBe(false);
  });

  it('bounds retries, dead-letters poison jobs, and audits an operator replay', async () => {
    const queued = await jobs.enqueue({
      type: 'notification.dispatch',
      payload: { notificationId: 'notice-one' },
      idempotencyKey: 'notice-one',
      scheduledAt: fixedTestNow,
      correlationId: 'notice-one',
      maxAttempts: 2,
    });
    const first = (
      await jobs.claim({
        workerId: 'worker-one',
        jobTypes: ['notification.dispatch'],
        limit: 1,
        leaseDurationMs: 10_000,
        now: fixedTestNow,
      })
    )[0];
    expect(first).toBeDefined();
    const retryAt = new Date(fixedTestNow.getTime() + 20_000);
    await expect(
      jobs.fail({
        jobId: queued.job.id,
        workerId: 'worker-one',
        errorCode: 'provider_unavailable',
        nextAttemptAt: retryAt,
        now: new Date(fixedTestNow.getTime() + 1_000),
      }),
    ).resolves.toBe('retry');
    const second = (
      await jobs.claim({
        workerId: 'worker-two',
        jobTypes: ['notification.dispatch'],
        limit: 1,
        leaseDurationMs: 10_000,
        now: retryAt,
      })
    )[0];
    expect(second).toMatchObject({ attempts: 2 });
    await expect(
      jobs.fail({
        jobId: queued.job.id,
        workerId: 'worker-two',
        errorCode: 'provider_unavailable',
        nextAttemptAt: new Date(retryAt.getTime() + 20_000),
        now: new Date(retryAt.getTime() + 1_000),
      }),
    ).resolves.toBe('dead_letter');

    const replay = await jobs.replayDeadLetter({
      jobId: queued.job.id,
      actorPersonId: 'person-owner-alice',
      reason: 'provider_recovered',
      correlationId: 'operator-replay-one',
      now: new Date(retryAt.getTime() + 30_000),
    });
    expect(replay).toMatchObject({ state: 'queued', type: 'notification.dispatch', attempts: 0 });
    const audit = await database.query<{ readonly total: number } & Record<string, unknown>>(
      `SELECT count(*)::int AS total FROM audit_events
       WHERE action = 'job.replayed' AND resource_id = $1`,
      [replay.id],
    );
    expect(audit.rows[0]?.total).toBe(1);
  });

  it('uses leased consumer receipts and rejects restricted payloads', async () => {
    const queued = await jobs.enqueue({
      type: 'evaluation.refresh',
      payload: { evaluationId: 'evaluation-one' },
      idempotencyKey: 'evaluation-one',
      scheduledAt: fixedTestNow,
      correlationId: 'evaluation-one',
    });
    await expect(
      jobs.beginConsumerReceipt({
        consumerKey: 'evaluation-handler',
        idempotencyKey: queued.job.idempotencyKey,
        jobId: queued.job.id,
        workerId: 'worker-one',
        leaseDurationMs: 5_000,
        now: fixedTestNow,
      }),
    ).resolves.toBe('acquired');
    await expect(
      jobs.beginConsumerReceipt({
        consumerKey: 'evaluation-handler',
        idempotencyKey: queued.job.idempotencyKey,
        jobId: queued.job.id,
        workerId: 'worker-two',
        leaseDurationMs: 5_000,
        now: new Date(fixedTestNow.getTime() + 1_000),
      }),
    ).resolves.toBe('busy');
    await expect(
      jobs.enqueue({
        type: 'unsafe.job',
        payload: { url: 'https://example.invalid/private' },
        idempotencyKey: 'unsafe-one',
        scheduledAt: fixedTestNow,
        correlationId: 'unsafe-one',
      }),
    ).rejects.toMatchObject({ code: 'restricted_input' });
  });

  it('renews the job and consumer receipt together past the original lease', async () => {
    const queued = await jobs.enqueue({
      type: 'evaluation.refresh',
      payload: { evaluationId: 'evaluation-long-running' },
      idempotencyKey: 'evaluation-long-running',
      scheduledAt: fixedTestNow,
      correlationId: 'evaluation-long-running',
    });
    await jobs.claim({
      workerId: 'worker-one',
      jobTypes: ['evaluation.refresh'],
      limit: 1,
      leaseDurationMs: 5_000,
      now: fixedTestNow,
    });
    await jobs.beginConsumerReceipt({
      consumerKey: 'evaluation-handler',
      idempotencyKey: queued.job.idempotencyKey,
      jobId: queued.job.id,
      workerId: 'worker-one',
      leaseDurationMs: 5_000,
      now: fixedTestNow,
    });

    await expect(
      jobs.heartbeatWithConsumerReceipt({
        jobId: queued.job.id,
        consumerKey: 'evaluation-handler',
        idempotencyKey: queued.job.idempotencyKey,
        workerId: 'worker-one',
        leaseDurationMs: 5_000,
        now: new Date(fixedTestNow.getTime() + 4_000),
      }),
    ).resolves.toBe(true);
    const pastOriginalLease = new Date(fixedTestNow.getTime() + 6_000);
    await expect(
      jobs.claim({
        workerId: 'worker-two',
        jobTypes: ['evaluation.refresh'],
        limit: 1,
        leaseDurationMs: 5_000,
        now: pastOriginalLease,
      }),
    ).resolves.toEqual([]);
    await expect(
      jobs.beginConsumerReceipt({
        consumerKey: 'evaluation-handler',
        idempotencyKey: queued.job.idempotencyKey,
        jobId: queued.job.id,
        workerId: 'worker-two',
        leaseDurationMs: 5_000,
        now: pastOriginalLease,
      }),
    ).resolves.toBe('busy');
    const completedAt = new Date(fixedTestNow.getTime() + 7_000);
    await expect(
      jobs.completeConsumerReceipt({
        consumerKey: 'evaluation-handler',
        idempotencyKey: queued.job.idempotencyKey,
        workerId: 'worker-one',
        resultCode: 'completed',
        now: completedAt,
      }),
    ).resolves.toBe(true);
    await expect(
      jobs.complete({ jobId: queued.job.id, workerId: 'worker-one', now: completedAt }),
    ).resolves.toBe(true);
  });

  it('does not renew either lease when the consumer receipt has expired', async () => {
    const queued = await jobs.enqueue({
      type: 'evaluation.refresh',
      payload: { evaluationId: 'evaluation-lost-receipt' },
      idempotencyKey: 'evaluation-lost-receipt',
      scheduledAt: fixedTestNow,
      correlationId: 'evaluation-lost-receipt',
    });
    await jobs.claim({
      workerId: 'worker-one',
      jobTypes: ['evaluation.refresh'],
      limit: 1,
      leaseDurationMs: 5_000,
      now: fixedTestNow,
    });
    await jobs.beginConsumerReceipt({
      consumerKey: 'evaluation-handler',
      idempotencyKey: queued.job.idempotencyKey,
      jobId: queued.job.id,
      workerId: 'worker-one',
      leaseDurationMs: 5_000,
      now: fixedTestNow,
    });
    await database.query(
      `UPDATE durable_consumer_receipts SET lease_expires_at = $3
       WHERE consumer_key = $1 AND idempotency_key = $2`,
      [
        'evaluation-handler',
        queued.job.idempotencyKey,
        new Date(fixedTestNow.getTime() + 2_000).toISOString(),
      ],
    );

    await expect(
      jobs.heartbeatWithConsumerReceipt({
        jobId: queued.job.id,
        consumerKey: 'evaluation-handler',
        idempotencyKey: queued.job.idempotencyKey,
        workerId: 'worker-one',
        leaseDurationMs: 5_000,
        now: new Date(fixedTestNow.getTime() + 3_000),
      }),
    ).resolves.toBe(false);
    const jobLease = await database.query<
      { readonly lease_expires_at: unknown } & Record<string, unknown>
    >('SELECT lease_expires_at FROM durable_jobs WHERE id = $1', [queued.job.id]);
    expect(new Date(String(jobLease.rows[0]?.lease_expires_at)).getTime()).toBe(
      fixedTestNow.getTime() + 5_000,
    );
    await expect(
      jobs.claim({
        workerId: 'worker-two',
        jobTypes: ['evaluation.refresh'],
        limit: 1,
        leaseDurationMs: 5_000,
        now: new Date(fixedTestNow.getTime() + 5_001),
      }),
    ).resolves.toHaveLength(1);
  });
});

describe('leased outbox delivery', () => {
  it('does not double-claim and releases failed work with bounded state', async () => {
    const database = await createSeededTestDatabase();
    const repository = new OutboxDeliveryRepository(database, sequentialIds());
    try {
      await database.query(
        `UPDATE outbox_events SET processed_at = $1, lease_owner = NULL, lease_expires_at = NULL
         WHERE processed_at IS NULL`,
        [fixedTestNow.toISOString()],
      );
      await database.query(
        `INSERT INTO outbox_events(
           id, event_type, event_version, aggregate_type, aggregate_id, correlation_id,
           classification, payload, occurred_at, available_at, next_attempt_at, max_attempts
         ) VALUES ('event-outbox-test','test.event.v1',1,'test','aggregate-one','outbox-one',
                   'internal','{"state":"ready"}'::jsonb,$1,$1,$1,2)`,
        [fixedTestNow.toISOString()],
      );
      const claimed = await repository.claim({
        workerId: 'worker-one',
        limit: 1,
        leaseDurationMs: 5_000,
        now: fixedTestNow,
      });
      expect(claimed).toHaveLength(1);
      await expect(
        repository.heartbeat({
          eventId: 'event-outbox-test',
          workerId: 'worker-one',
          leaseDurationMs: 5_000,
          now: new Date(fixedTestNow.getTime() + 4_000),
        }),
      ).resolves.toBe(true);
      await expect(
        repository.claim({
          workerId: 'worker-two',
          limit: 1,
          leaseDurationMs: 5_000,
          now: new Date(fixedTestNow.getTime() + 6_000),
        }),
      ).resolves.toEqual([]);
      await expect(
        repository.fail({
          eventId: 'event-outbox-test',
          workerId: 'worker-one',
          errorCode: 'sink_unavailable',
          nextAttemptAt: new Date(fixedTestNow.getTime() + 10_000),
          now: new Date(fixedTestNow.getTime() + 7_000),
        }),
      ).resolves.toBe('retry');
    } finally {
      await database.close();
    }
  }, 15_000);

  it('rejects completion after an outbox lease is lost', async () => {
    const database = await createSeededTestDatabase();
    const repository = new OutboxDeliveryRepository(database, sequentialIds());
    try {
      await database.query(
        `UPDATE outbox_events SET processed_at = $1, lease_owner = NULL, lease_expires_at = NULL
         WHERE processed_at IS NULL`,
        [fixedTestNow.toISOString()],
      );
      await database.query(
        `INSERT INTO outbox_events(
           id, event_type, event_version, aggregate_type, aggregate_id, correlation_id,
           classification, payload, occurred_at, available_at, next_attempt_at, max_attempts
         ) VALUES ('event-outbox-lost','test.event.v1',1,'test','aggregate-one','outbox-lost',
                   'internal','{"state":"ready"}'::jsonb,$1,$1,$1,2)`,
        [fixedTestNow.toISOString()],
      );
      await repository.claim({
        workerId: 'worker-one',
        limit: 1,
        leaseDurationMs: 5_000,
        now: fixedTestNow,
      });
      const afterLease = new Date(fixedTestNow.getTime() + 5_001);
      await expect(
        repository.complete({
          eventId: 'event-outbox-lost',
          workerId: 'worker-one',
          now: afterLease,
        }),
      ).resolves.toBe(false);
      await expect(
        repository.claim({
          workerId: 'worker-two',
          limit: 1,
          leaseDurationMs: 5_000,
          now: afterLease,
        }),
      ).resolves.toMatchObject([{ id: 'event-outbox-lost', leaseOwner: 'worker-two' }]);
    } finally {
      await database.close();
    }
  }, 15_000);
});

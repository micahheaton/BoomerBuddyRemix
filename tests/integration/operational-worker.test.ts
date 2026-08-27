import { describe, expect, it } from 'vitest';
import { createLogger } from '@boomerbuddy/observability';
import {
  DurableJobRepository,
  GrowthRuntimeRepository,
  growthProjectionEventTypes,
  OperationalWorkRepository,
  OrientationRepository,
  OutboxDeliveryRepository,
} from '@boomerbuddy/persistence';
import { PortableWorker, type WorkerRuntimeConfig } from '@boomerbuddy/platform';
import { createGrowthRuntimeHandlers } from '../../apps/worker/src/growth-runtime';
import {
  createOperationalHandlers,
  seedOperationalSchedules,
} from '../../apps/worker/src/operational-handlers';
import { createSeededTestDatabase, fixedTestNow } from '@boomerbuddy/testkit';

const workerConfig: WorkerRuntimeConfig = {
  workerId: 'worker-operational-test',
  pollIntervalMs: 50,
  leaseDurationMs: 5_000,
  heartbeatIntervalMs: 1_000,
  shutdownTimeoutMs: 1_000,
  batchSize: 10,
  retryBaseMs: 100,
  retryMaxMs: 1_000,
};

describe('operational durable worker handlers', () => {
  it('installs no discretionary intelligence or evaluation work in production', async () => {
    const database = await createSeededTestDatabase();
    try {
      const jobs = new DurableJobRepository(database);
      const operations = new OperationalWorkRepository(database);
      await seedOperationalSchedules({ environment: 'production', jobs, now: fixedTestNow });
      expect(
        Object.keys(
          createOperationalHandlers({
            environment: 'production',
            jobs,
            operations,
            fingerprintKey: new Uint8Array(32).fill(7),
          }),
        ),
      ).toEqual(['notification.dispatch']);
      const discretionary = await database.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM durable_jobs
         WHERE job_type IN ('intelligence.refresh', 'evaluation.run')`,
      );
      expect(discretionary.rows[0]?.count).toBe(0);
    } finally {
      await database.close();
    }
  });

  it('executes notification, intelligence, and evaluation work with durable receipts', async () => {
    const database = await createSeededTestDatabase();
    try {
      const jobs = new DurableJobRepository(database);
      const operations = new OperationalWorkRepository(database);
      const notificationId = await operations.createNotificationRequest({
        householdId: 'household-sunrise',
        recipientPersonId: 'person-owner-alice',
        templateKey: 'orientation.reminder.v1',
        channel: 'local_test',
        consentBasis: 'orientation-reminder-test-v1',
        now: fixedTestNow,
      });
      await Promise.all([
        jobs.enqueue({
          type: 'notification.dispatch',
          householdId: 'household-sunrise',
          payload: { requestId: notificationId },
          idempotencyKey: 'operational-notification-one',
          scheduledAt: fixedTestNow,
          correlationId: 'operational-notification-one',
        }),
        jobs.enqueue({
          type: 'intelligence.refresh',
          payload: { locale: 'en-US', jurisdiction: 'US', freshnessDays: 90 },
          idempotencyKey: 'operational-intelligence-one',
          scheduledAt: fixedTestNow,
          correlationId: 'operational-intelligence-one',
        }),
        jobs.enqueue({
          type: 'evaluation.run',
          payload: { corpusKey: 'boomerbuddy-run-1-synthetic', corpusVersion: 1 },
          idempotencyKey: 'operational-evaluation-one',
          scheduledAt: fixedTestNow,
          correlationId: 'operational-evaluation-one',
        }),
      ]);
      const worker = new PortableWorker(
        jobs,
        new OutboxDeliveryRepository(database),
        createOperationalHandlers({
          environment: 'test',
          jobs,
          operations,
          fingerprintKey: new Uint8Array(32).fill(7),
          clock: () => fixedTestNow,
        }),
        undefined,
        workerConfig,
        createLogger({ sink: () => undefined, clock: () => fixedTestNow }),
        () => fixedTestNow,
      );

      await expect(worker.runOnce()).resolves.toEqual({ jobs: 3, outbox: 0 });
      const evidence = await operations.listEvidence();
      expect(evidence).toHaveLength(3);
      expect(new Set(evidence.map((item) => item.kind))).toEqual(
        new Set(['notification_dispatch', 'intelligence_refresh', 'evaluation_run']),
      );
      expect(evidence.find((item) => item.kind === 'evaluation_run')).toMatchObject({
        outcome: 'completed',
        summary: {
          cases: 12,
          passed: 12,
          forbiddenActionViolations: 0,
          calibration: 'not_calibrated',
        },
      });
      const jobStates = await database.query<{ job_type: string; state: string }>(
        `SELECT job_type, state FROM durable_jobs
         WHERE job_type IN ('notification.dispatch','intelligence.refresh','evaluation.run')
         ORDER BY job_type, next_attempt_at`,
      );
      expect(jobStates.rows.filter((row) => row.state === 'succeeded')).toHaveLength(3);
      expect(jobStates.rows.filter((row) => row.state === 'queued')).toHaveLength(2);
    } finally {
      await database.close();
    }
  }, 30_000);

  it('claims only allowlisted outbox events and completes their exact growth projection', async () => {
    const database = await createSeededTestDatabase();
    try {
      await database.query(
        `UPDATE outbox_events SET processed_at = $1, lease_owner = NULL, lease_expires_at = NULL
         WHERE processed_at IS NULL`,
        [fixedTestNow.toISOString()],
      );
      const orientations = new OrientationRepository(
        database,
        new Uint8Array(32).fill(4),
        undefined,
        'local',
      );
      await orientations.start({
        householdId: 'household-sunrise',
        subjectPersonId: 'person-owner-alice',
        actorPersonId: 'person-owner-alice',
        audience: 'customer',
        correlationId: 'operational-outbox-orientation',
        now: fixedTestNow,
      });
      const growth = new GrowthRuntimeRepository(database);
      const worker = new PortableWorker(
        new DurableJobRepository(database),
        new OutboxDeliveryRepository(database),
        {},
        {
          eventTypes: growthProjectionEventTypes,
          handle: async ({ event }) => {
            await growth.projectEventById({ eventId: event.id, now: fixedTestNow });
          },
        },
        workerConfig,
        createLogger({ sink: () => undefined, clock: () => fixedTestNow }),
        () => fixedTestNow,
      );

      await expect(worker.runOnce()).resolves.toEqual({ jobs: 0, outbox: 1 });
      const evidence = await database.query<
        { readonly processed: boolean; readonly projected: boolean } & Record<string, unknown>
      >(
        `SELECT event.processed_at IS NOT NULL AS processed,
                receipt.event_id IS NOT NULL AS projected
         FROM outbox_events event
         LEFT JOIN growth_event_receipts receipt ON receipt.event_id = event.id
         WHERE event.correlation_id = 'operational-outbox-orientation'`,
      );
      expect(evidence.rows).toEqual([{ processed: true, projected: true }]);
    } finally {
      await database.close();
    }
  }, 30_000);

  it('materializes and completes an eligible lifecycle notification only from its durable test receipt', async () => {
    const database = await createSeededTestDatabase();
    try {
      const startedAt = fixedTestNow;
      let workerNow = new Date(startedAt.getTime() + 25 * 60 * 60 * 1_000);
      const clock = (): Date => workerNow;
      const orientations = new OrientationRepository(
        database,
        new Uint8Array(32).fill(8),
        undefined,
        'local',
      );
      await orientations.start({
        householdId: 'household-sunrise',
        subjectPersonId: 'person-protected-pat',
        actorPersonId: 'person-protected-pat',
        audience: 'customer',
        correlationId: 'operational-lifecycle-orientation',
        now: startedAt,
      });
      const jobs = new DurableJobRepository(database);
      const growth = new GrowthRuntimeRepository(database);
      const operations = new OperationalWorkRepository(database);
      await jobs.enqueue({
        type: 'lifecycle.advance',
        payload: { batch: 100 },
        idempotencyKey: 'operational-lifecycle-first',
        scheduledAt: workerNow,
        correlationId: 'operational-lifecycle-first',
      });
      const worker = new PortableWorker(
        jobs,
        new OutboxDeliveryRepository(database),
        {
          ...createGrowthRuntimeHandlers({ growth, jobs, clock }),
          ...createOperationalHandlers({
            environment: 'test',
            jobs,
            operations,
            fingerprintKey: new Uint8Array(32).fill(9),
            clock,
          }),
        },
        undefined,
        workerConfig,
        createLogger({ sink: () => undefined, clock }),
        clock,
      );

      await expect(worker.runOnce()).resolves.toEqual({ jobs: 1, outbox: 0 });
      const materialized = await database.query<{
        step_state: string;
        request_state: string;
        job_state: string;
        template_key: string;
        channel: string;
      }>(
        `SELECT step.state AS step_state, request.state AS request_state,
                job.state AS job_state, request.template_key, request.channel
         FROM lifecycle_workflows workflow
         JOIN lifecycle_steps step ON step.workflow_id = workflow.id
         JOIN notification_dispatch_requests request
           ON request.id = 'lifecycle-notification:' || step.id
         JOIN durable_jobs job
           ON job.job_type = 'notification.dispatch'
          AND job.idempotency_key = 'notification.dispatch:lifecycle:' || step.id
         WHERE workflow.trigger_event_id LIKE
           'growth.orientation_abandoned:household-sunrise:person-protected-pat:%'`,
      );
      expect(materialized.rows).toEqual([
        {
          step_state: 'ready',
          request_state: 'queued',
          job_state: 'queued',
          template_key: 'lifecycle.orientation_stalled.v1',
          channel: 'local_test',
        },
      ]);

      const claimedForDeadLetter = await jobs.claim({
        workerId: 'worker-lifecycle-poison',
        jobTypes: ['notification.dispatch'],
        limit: 1,
        leaseDurationMs: 5_000,
        now: workerNow,
      });
      const originalNotificationJob = claimedForDeadLetter[0];
      expect(originalNotificationJob?.type).toBe('notification.dispatch');
      await expect(
        jobs.deadLetter({
          jobId: originalNotificationJob?.id ?? '',
          workerId: 'worker-lifecycle-poison',
          errorCode: 'local_test_poison',
          now: workerNow,
        }),
      ).resolves.toBe(true);
      await jobs.replayDeadLetter({
        jobId: originalNotificationJob?.id ?? '',
        actorPersonId: 'person-owner-alice',
        reason: 'local_test_retry',
        correlationId: 'operational-lifecycle-replay',
        now: workerNow,
      });

      await expect(worker.runOnce()).resolves.toEqual({ jobs: 1, outbox: 0 });
      const deliveredBeforeReconciliation = await database.query<{
        step_state: string;
        request_state: string;
        job_state: string;
        evidence_outcome: string;
      }>(
        `SELECT step.state AS step_state, request.state AS request_state,
                job.state AS job_state, evidence.outcome AS evidence_outcome
         FROM lifecycle_workflows workflow
         JOIN lifecycle_steps step ON step.workflow_id = workflow.id
         JOIN notification_dispatch_requests request
           ON request.id = 'lifecycle-notification:' || step.id
         JOIN durable_jobs original
           ON original.idempotency_key = 'notification.dispatch:lifecycle:' || step.id
         JOIN durable_jobs job ON job.replay_of_job_id = original.id
         JOIN operational_job_evidence evidence
           ON evidence.job_id = job.id AND evidence.evidence_kind = 'notification_dispatch'
         WHERE workflow.trigger_event_id LIKE
           'growth.orientation_abandoned:household-sunrise:person-protected-pat:%'`,
      );
      expect(deliveredBeforeReconciliation.rows).toEqual([
        {
          step_state: 'ready',
          request_state: 'test_delivered',
          job_state: 'succeeded',
          evidence_outcome: 'test_delivered',
        },
      ]);

      workerNow = new Date(workerNow.getTime() + 1_001);
      await expect(worker.runOnce()).resolves.toEqual({ jobs: 1, outbox: 0 });
      const reconciled = await database.query<{
        workflow_state: string;
        step_state: string;
        requests: number;
        jobs: number;
        receipts: number;
        replay_audits: number;
      }>(
        `SELECT workflow.state AS workflow_state, step.state AS step_state,
           (SELECT count(*)::int FROM notification_dispatch_requests request
            WHERE request.id = 'lifecycle-notification:' || step.id) AS requests,
           (SELECT count(*)::int FROM durable_jobs job
            WHERE job.job_type = 'notification.dispatch' AND (
              job.idempotency_key = 'notification.dispatch:lifecycle:' || step.id
              OR job.replay_of_job_id = (
                SELECT original.id FROM durable_jobs original
                WHERE original.idempotency_key = 'notification.dispatch:lifecycle:' || step.id
              )
            )) AS jobs,
           (SELECT count(*)::int FROM operational_job_evidence evidence
            JOIN durable_jobs job ON job.id = evidence.job_id
            WHERE job.replay_of_job_id = (
              SELECT original.id FROM durable_jobs original
              WHERE original.idempotency_key = 'notification.dispatch:lifecycle:' || step.id
            )
              AND evidence.evidence_kind = 'notification_dispatch') AS receipts,
           (SELECT count(*)::int FROM audit_events audit
             WHERE audit.action = 'job.replayed'
               AND audit.correlation_id = 'operational-lifecycle-replay') AS replay_audits
         FROM lifecycle_workflows workflow
         JOIN lifecycle_steps step ON step.workflow_id = workflow.id
         WHERE workflow.trigger_event_id LIKE
           'growth.orientation_abandoned:household-sunrise:person-protected-pat:%'`,
      );
      expect(reconciled.rows).toEqual([
        {
          workflow_state: 'completed',
          step_state: 'completed',
          requests: 1,
          jobs: 2,
          receipts: 1,
          replay_audits: 1,
        },
      ]);
    } finally {
      await database.close();
    }
  }, 30_000);
});

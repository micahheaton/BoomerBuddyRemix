import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSeededTestDatabase, fixedTestNow } from '@boomerbuddy/testkit';
import { BusinessOsRepository } from './business-os';
import type { Database } from './database';
import { DurableJobRepository } from './jobs';
import { OperationalWorkRepository } from './operational-work';
import type { IdFactory } from './values';

function sequentialIds(): IdFactory {
  let counter = 0;
  return { next: (prefix) => `${prefix}-operational-test-${++counter}` };
}

describe('operational durable-work evidence', () => {
  let database: Database;
  let jobs: DurableJobRepository;
  let operations: OperationalWorkRepository;

  beforeEach(async () => {
    database = await createSeededTestDatabase();
    const ids = sequentialIds();
    jobs = new DurableJobRepository(database, ids);
    operations = new OperationalWorkRepository(database, ids);
  });

  afterEach(async () => database.close());

  it('executes only the local notification test sink and records external delivery as blocked', async () => {
    await expect(
      operations.createNotificationRequest({
        householdId: 'household-sunrise',
        recipientPersonId: 'person-owner-alice',
        templateKey: 'arbitrary.unreviewed.v1',
        channel: 'local_test',
        consentBasis: 'orientation-reminder-test-v1',
        now: fixedTestNow,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      operations.createNotificationRequest({
        householdId: 'household-sunrise',
        recipientPersonId: 'person-owner-alice',
        templateKey: 'orientation.reminder.v1',
        channel: 'local_test',
        consentBasis: '4242424242424242',
        now: fixedTestNow,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    const localRequest = await operations.createNotificationRequest({
      householdId: 'household-sunrise',
      recipientPersonId: 'person-owner-alice',
      templateKey: 'orientation.reminder.v1',
      channel: 'local_test',
      consentBasis: 'orientation-reminder-test-v1',
      now: fixedTestNow,
    });
    const localJob = await jobs.enqueue({
      type: 'notification.dispatch',
      householdId: 'household-sunrise',
      payload: { requestId: localRequest },
      idempotencyKey: 'notification-local-test-one',
      scheduledAt: fixedTestNow,
      correlationId: 'notification-local-test-one',
    });
    await expect(
      operations.dispatchNotification({
        requestId: localRequest,
        jobId: localJob.job.id,
        now: fixedTestNow,
      }),
    ).resolves.toBe('test_delivered');

    const externalRequest = await operations.createNotificationRequest({
      householdId: 'household-sunrise',
      recipientPersonId: 'person-owner-alice',
      templateKey: 'orientation.reminder.v1',
      channel: 'push',
      consentBasis: 'orientation-reminder-test-v1',
      now: fixedTestNow,
    });
    const externalJob = await jobs.enqueue({
      type: 'notification.dispatch',
      householdId: 'household-sunrise',
      payload: { requestId: externalRequest },
      idempotencyKey: 'notification-external-test-one',
      scheduledAt: fixedTestNow,
      correlationId: 'notification-external-test-one',
    });
    await expect(
      operations.dispatchNotification({
        requestId: externalRequest,
        jobId: externalJob.job.id,
        now: fixedTestNow,
      }),
    ).resolves.toBe('blocked_external');

    const suppressedRequest = await operations.createNotificationRequest({
      householdId: 'household-sunrise',
      recipientPersonId: 'person-protected-pat',
      templateKey: 'lifecycle.orientation_stalled.v1',
      channel: 'local_test',
      consentBasis: 'transactional_lifecycle',
      now: fixedTestNow,
    });
    const suppressedJob = await jobs.enqueue({
      type: 'notification.dispatch',
      householdId: 'household-sunrise',
      payload: { requestId: suppressedRequest },
      idempotencyKey: 'notification-suppressed-test-one',
      scheduledAt: fixedTestNow,
      correlationId: 'notification-suppressed-test-one',
    });
    await new BusinessOsRepository(database, sequentialIds()).suppressCommunication({
      channel: 'email',
      effectiveAt: fixedTestNow,
      reason: 'Lifecycle dispatch suppression regression',
      scope: 'lifecycle',
      source: 'customer_preference',
      subjectId: 'person-protected-pat',
      subjectKind: 'person',
    });
    await expect(
      operations.dispatchNotification({
        requestId: suppressedRequest,
        jobId: suppressedJob.job.id,
        now: fixedTestNow,
      }),
    ).resolves.toBe('failed');

    const evidence = await operations.listEvidence('notification_dispatch');
    expect(evidence).toHaveLength(3);
    expect(new Set(evidence.map((item) => item.outcome))).toEqual(
      new Set(['test_delivered', 'blocked_external', 'attention']),
    );
    expect(evidence.find((item) => item.outcome === 'attention')?.summary).toMatchObject({
      deliveryMode: 'governance_blocked',
      governanceFailure: 'communication_suppressed',
    });
    expect(JSON.stringify(evidence)).not.toContain('person-owner-alice');
    await expect(
      database.query("UPDATE operational_job_evidence SET outcome = 'completed'"),
    ).rejects.toThrow(/append-only/iu);
  });

  it('records governed intelligence freshness without activating or publishing an asset', async () => {
    const now = new Date('2027-08-15T12:00:00.000Z');
    const queued = await jobs.enqueue({
      type: 'intelligence.refresh',
      payload: { locale: 'en-US', jurisdiction: 'US', freshnessDays: 90 },
      idempotencyKey: 'intelligence-refresh-2027',
      scheduledAt: now,
      correlationId: 'intelligence-refresh-2027',
    });
    const evidence = await operations.recordIntelligenceRefresh({
      jobId: queued.job.id,
      locale: 'en-US',
      jurisdiction: 'US',
      freshnessDays: 90,
      now,
    });
    expect(evidence).toMatchObject({
      kind: 'intelligence_refresh',
      outcome: 'attention',
      summary: {
        autoPublished: false,
        runtimeEligibleAssets: 0,
        staleSources: 2,
        totalAssets: 2,
      },
    });
    const lifecycle = await database.query<{ lifecycle: string }>(
      'SELECT lifecycle FROM knowledge_assets ORDER BY id',
    );
    expect(new Set(lifecycle.rows.map((row) => row.lifecycle))).toEqual(new Set(['draft']));
  });

  it('persists only content-free evaluation summary evidence idempotently', async () => {
    const queued = await jobs.enqueue({
      type: 'evaluation.run',
      payload: { corpusKey: 'run_one_synthetic', corpusVersion: 1 },
      idempotencyKey: 'evaluation-run-one-v1',
      scheduledAt: fixedTestNow,
      correlationId: 'evaluation-run-one-v1',
    });
    const input = {
      jobId: queued.job.id,
      corpusKey: 'run_one_synthetic',
      corpusVersion: 1,
      cases: 12,
      passed: 12,
      failed: 0,
      forbiddenActionViolations: 0,
      providerFailures: 1,
      calibration: 'not_calibrated' as const,
      now: fixedTestNow,
    };
    await expect(operations.recordEvaluationRun(input)).resolves.toMatchObject({
      kind: 'evaluation_run',
      outcome: 'completed',
      summary: {
        cases: 12,
        passed: 12,
        failed: 0,
        forbiddenActionViolations: 0,
        providerFailures: 1,
        calibration: 'not_calibrated',
      },
    });
    await expect(operations.recordEvaluationRun(input)).resolves.toMatchObject({
      outcome: 'completed',
    });
    expect(await operations.listEvidence('evaluation_run')).toHaveLength(1);
    await expect(
      operations.recordEvaluationRun({ ...input, failed: 1, passed: 11 }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});

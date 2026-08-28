import { afterEach, describe, expect, it } from 'vitest';
import { hqOperationalHealthResponseSchema } from '@boomerbuddy/contracts';
import { ids } from '@boomerbuddy/domain';
import { HqRepository } from '@boomerbuddy/persistence';
import { browserHeaders, createApiHarness, hqOrigin, login, type ApiHarness } from './support';

describe('owner operational health projection', () => {
  let harness: ApiHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('is owner-only, no-store, audited, aggregate-only, and fail-closed without a heartbeat', async () => {
    harness = await createApiHarness();
    const owner = await login(harness.app, 'hq-heidi', 'hq');
    const reviewer = await login(harness.app, 'hq-riley', 'hq');
    const support = await login(harness.app, 'hq-sam', 'hq');

    const anonymousResponse = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/operational-health',
      headers: { origin: hqOrigin },
    });
    const reviewerResponse = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/operational-health',
      headers: browserHeaders(reviewer.cookie as string, hqOrigin),
    });
    const supportResponse = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/operational-health',
      headers: browserHeaders(support.cookie as string, hqOrigin),
    });
    expect(anonymousResponse.statusCode).toBe(401);
    expect(reviewerResponse.statusCode).toBe(403);
    expect(supportResponse.statusCode).toBe(403);
    await harness.database.query(
      `UPDATE outbox_events
       SET processed_at = $1, lease_owner = NULL, lease_expires_at = NULL
       WHERE processed_at IS NULL AND founding_household_operation_key IS NULL`,
      [harness.clock.now().toISOString()],
    );
    await harness.database.query(
      `INSERT INTO outbox_events(
         id, event_type, event_version, aggregate_type, aggregate_id, correlation_id,
         classification, payload, occurred_at, available_at, next_attempt_at
       ) VALUES (
         'event-intentionally-unconsumed','audit.internal_only.v1',1,'audit','aggregate-audit',
         'correlation-unconsumed','internal','{"state":"ready"}'::jsonb,$1,$1,$1
       )`,
      [new Date(harness.clock.now().getTime() - 3_600_000).toISOString()],
    );

    const ownerResponse = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/operational-health',
      headers: browserHeaders(owner.cookie as string, hqOrigin),
    });
    expect(ownerResponse.statusCode).toBe(200);
    expect(ownerResponse.headers['cache-control']).toBe('private, no-store, max-age=0');
    expect(ownerResponse.headers.pragma).toBe('no-cache');
    const body = hqOperationalHealthResponseSchema.parse(ownerResponse.json());
    expect(body).toMatchObject({
      projection: 'content_free_operational_health',
      status: 'critical',
      thresholds: {
        workerStaleAfterSeconds: 60,
        backlogStaleAfterSeconds: 300,
        clockSkewToleranceSeconds: 5,
        aggregateCountCeiling: 1_000_000,
      },
      workers: {
        status: 'critical',
        observedCount: 0,
        runningCount: 0,
        drainingCount: 0,
        stoppedCount: 0,
        staleCount: 0,
        clockSkewCount: 0,
        oldestActiveHeartbeatAgeSeconds: null,
        freshestActiveHeartbeatAgeSeconds: null,
        countSaturated: false,
      },
      durableJobs: {
        status: 'healthy',
        queuedCount: 0,
        retryCount: 0,
        runningCount: 0,
        staleRunningCount: 0,
        exhaustedCount: 0,
        deadLetterCount: 0,
        actionableCount: 0,
        oldestActionableAgeSeconds: null,
        oldestStaleRunningAgeSeconds: null,
        oldestExhaustedAgeSeconds: null,
        oldestDeadLetterAgeSeconds: null,
        countSaturated: false,
      },
      outbox: {
        status: 'healthy',
        unprocessedCount: 0,
        exhaustedCount: 0,
        causallyBlockedCount: 0,
        deadLetterCount: 0,
        actionableCount: 0,
        oldestActionableAgeSeconds: null,
        oldestExhaustedAgeSeconds: null,
        oldestCausallyBlockedAgeSeconds: null,
        oldestDeadLetterAgeSeconds: null,
        countSaturated: false,
      },
      attentionCodes: ['worker_missing'],
    });
    expect(ownerResponse.body).not.toMatch(
      /payload|householdId|tenantId|customerId|personId|eventType|jobType/iu,
    );

    const audits = await harness.database.query<
      {
        readonly actor_person_id: string;
        readonly resource_id: string;
        readonly metadata: unknown;
      } & Record<string, unknown>
    >(
      `SELECT actor_person_id, resource_id, metadata FROM audit_events
       WHERE action = 'hq.metadata_projection.read'
         AND resource_id = 'owner_operational_health'`,
    );
    expect(audits.rows).toEqual([
      expect.objectContaining({
        actor_person_id: 'person-hq-heidi',
        resource_id: 'owner_operational_health',
        metadata: { projection: 'owner_operational_health' },
      }),
    ]);

    const repository = new HqRepository(harness.database);
    const observationClock = harness.clock;
    await expect(
      repository.ownerOperationalHealth(
        {
          actorPersonId: ids.person('person-hq-heidi'),
          correlationId: ids.correlation('correlation-invalid-ops-threshold'),
          observeNow: () => observationClock.now(),
        },
        {
          workerStaleAfterSeconds: 60,
          backlogStaleAfterSeconds: 300,
          clockSkewToleranceSeconds: 31,
          aggregateCountCeiling: 1_000_000,
        },
      ),
    ).rejects.toThrow('Operational-health thresholds are outside the fail-closed safety bounds');
    const invalidThresholdAudits = await harness.database.query<
      {
        readonly count: number;
      } & Record<string, unknown>
    >(
      `SELECT count(*)::integer AS count FROM audit_events
       WHERE correlation_id = 'correlation-invalid-ops-threshold'`,
    );
    expect(invalidThresholdAudits.rows[0]?.count).toBe(0);

    const customThresholds = {
      workerStaleAfterSeconds: 120,
      backlogStaleAfterSeconds: 600,
      clockSkewToleranceSeconds: 10,
      aggregateCountCeiling: 1_000,
    } as const;
    let observationCount = 0;
    const custom = await repository.ownerOperationalHealth(
      {
        actorPersonId: ids.person('person-hq-heidi'),
        correlationId: ids.correlation('correlation-valid-ops-threshold'),
        observeNow: () => {
          observationCount += 1;
          return observationClock.now();
        },
      },
      customThresholds,
    );
    expect(custom.thresholds).toBe(customThresholds);
    expect(observationCount).toBe(1);
  }, 20_000);

  it('matches production outbox scope and causal claim ordering without false actionable work', async () => {
    harness = await createApiHarness();
    const now = harness.clock.now();
    const at = (secondsFromNow: number) =>
      new Date(now.getTime() + secondsFromNow * 1_000).toISOString();
    const owner = await login(harness.app, 'hq-heidi', 'hq');
    await harness.database.query(
      `UPDATE outbox_events
       SET processed_at = $1, lease_owner = NULL, lease_expires_at = NULL
       WHERE processed_at IS NULL AND founding_household_operation_key IS NULL`,
      [now.toISOString()],
    );
    await harness.database.query(
      `INSERT INTO worker_heartbeats(
         worker_id, started_at, last_seen_at, state, current_job_count, version
       ) VALUES ('worker-causal',$1,$2,'running',0,'test-causal')`,
      [at(-300), at(-10)],
    );
    await harness.database.query(
      `INSERT INTO outbox_events(
         id, event_type, event_version, aggregate_type, aggregate_id, correlation_id,
         classification, payload, occurred_at, available_at, next_attempt_at,
         causal_order_position
       ) VALUES
         ('event-scope-ignored','audit.internal_only.v1',1,'audit','aggregate-ignored',
          'correlation-scope-ignored','internal',$1::jsonb,$2,$2,$2,50),
         ('event-causal-first','check.completed.v1',1,'ops','aggregate-handled-order',
          'correlation-causal-first','internal',$1::jsonb,$3,$3,$3,100),
         ('event-causal-second','public_check.saved.v1',1,'ops','aggregate-handled-order',
          'correlation-causal-second','internal',$1::jsonb,$3,$3,$3,101)`,
      [JSON.stringify({ secretMarker: 'causal-payload-must-not-project' }), at(-3_600), at(-10)],
    );
    const headers = browserHeaders(owner.cookie as string, hqOrigin);
    const orderedResponse = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/operational-health',
      headers,
    });
    const ordered = hqOperationalHealthResponseSchema.parse(orderedResponse.json());
    expect(ordered.status).toBe('healthy');
    expect(ordered.outbox).toMatchObject({
      status: 'healthy',
      unprocessedCount: 2,
      actionableCount: 1,
      causallyBlockedCount: 0,
      oldestActionableAgeSeconds: 10,
    });
    expect(ordered.attentionCodes).toEqual([]);

    await harness.database.query(
      `INSERT INTO outbox_events(
         id, event_type, event_version, aggregate_type, aggregate_id, correlation_id,
         classification, payload, occurred_at, available_at, next_attempt_at,
         causal_order_position
       ) VALUES
         ('event-causal-unhandled','audit.internal_only.v1',1,'ops','aggregate-blocked-order',
          'correlation-causal-unhandled','internal',$1::jsonb,$2,$2,$2,200),
         ('event-causal-blocked','commerce.lifecycle_applied.v1',1,'ops',
          'aggregate-blocked-order','correlation-causal-blocked','internal',$1::jsonb,$2,$2,$2,201)`,
      [JSON.stringify({ secretMarker: 'causal-payload-must-not-project' }), at(-20)],
    );
    const blockedResponse = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/operational-health',
      headers,
    });
    const blocked = hqOperationalHealthResponseSchema.parse(blockedResponse.json());
    expect(blocked.outbox).toMatchObject({
      status: 'critical',
      unprocessedCount: 3,
      actionableCount: 1,
      causallyBlockedCount: 1,
      oldestActionableAgeSeconds: 10,
      oldestCausallyBlockedAgeSeconds: 20,
    });
    expect(blocked.attentionCodes).toEqual(['outbox_causally_blocked']);
    expect(blockedResponse.body).not.toContain('causal-payload-must-not-project');
  }, 20_000);

  it('surfaces bounded stale backlogs without returning stored payloads or historical-stop noise', async () => {
    harness = await createApiHarness();
    const now = harness.clock.now();
    const at = (secondsFromNow: number) =>
      new Date(now.getTime() + secondsFromNow * 1_000).toISOString();
    const owner = await login(harness.app, 'hq-heidi', 'hq');
    await harness.database.query(
      `UPDATE outbox_events
       SET processed_at = $1, lease_owner = NULL, lease_expires_at = NULL
       WHERE processed_at IS NULL AND founding_household_operation_key IS NULL`,
      [now.toISOString()],
    );
    await harness.database.query(
      `INSERT INTO worker_heartbeats(
         worker_id, started_at, last_seen_at, state, current_job_count, version
       ) VALUES
         ('worker-current',$1,$2,'running',1,'test-current'),
         ('worker-historical',$3,$3,'stopped',0,'test-old')`,
      [at(-300), at(-30), at(-86_400)],
    );
    await harness.database.query(
      `INSERT INTO durable_jobs(
         id, job_type, job_version, classification, payload, payload_hash,
         idempotency_key, state, scheduled_at, next_attempt_at, attempts, max_attempts,
         lease_owner, lease_expires_at, heartbeat_at, correlation_id, created_at,
         dead_lettered_at
       ) VALUES
         ('job-queued','ops.queue',1,'internal',$1::jsonb,'hash-queued',
          'idempotency-queued','queued',$2,$2,0,8,NULL,NULL,NULL,'correlation-queued',$2,NULL),
         ('job-retry','ops.retry',1,'internal',$1::jsonb,'hash-retry',
          'idempotency-retry','retry',$3,$3,1,8,NULL,NULL,$3,'correlation-retry',$3,NULL),
         ('job-running-fresh','ops.running',1,'internal',$1::jsonb,'hash-running-fresh',
          'idempotency-running-fresh','running',$4,$4,1,8,'worker-current',$5,$4,
          'correlation-running-fresh',$4,NULL),
         ('job-running-stale','ops.running',1,'internal',$1::jsonb,'hash-running-stale',
          'idempotency-running-stale','running',$6,$6,1,8,'worker-old',$7,$6,
          'correlation-running-stale',$6,NULL),
         ('job-exhausted','ops.exhausted',1,'internal',$1::jsonb,'hash-exhausted',
          'idempotency-exhausted','queued',$9,$9,8,8,NULL,NULL,$9,
          'correlation-exhausted',$9,NULL),
         ('job-dead','ops.dead',1,'internal',$1::jsonb,'hash-dead',
          'idempotency-dead','dead_letter',$8,$8,8,8,NULL,NULL,$8,'correlation-dead',$8,$8)`,
      [
        JSON.stringify({ secretMarker: 'job-payload-must-not-project' }),
        at(-120),
        at(-600),
        at(-20),
        at(120),
        at(-150),
        at(-90),
        at(-200),
        at(-700),
      ],
    );
    await harness.database.query(
      `INSERT INTO outbox_events(
         id, event_type, event_version, aggregate_type, aggregate_id, correlation_id,
         classification, payload, occurred_at, available_at, next_attempt_at,
         attempts, max_attempts, lease_owner, lease_expires_at, dead_lettered_at,
         causal_order_position
       ) VALUES
         ('event-pending','check.completed.v1',1,'ops','aggregate-pending','correlation-pending',
          'internal',$1::jsonb,$2,$2,$2,0,8,NULL,NULL,NULL,100),
         ('event-running','public_check.saved.v1',1,'ops','aggregate-running','correlation-running',
          'internal',$1::jsonb,$4,$4,$4,1,8,'worker-current',$5,NULL,200),
         ('event-exhausted','orientation.step_completed.v1',1,'ops','aggregate-exhausted',
          'correlation-exhausted','internal',$1::jsonb,$6,$6,$6,8,8,NULL,NULL,NULL,300),
         ('event-dead','orientation.started.v1',1,'ops','aggregate-dead','correlation-outbox-dead',
          'internal',$1::jsonb,$3,$3,$3,8,8,NULL,NULL,$3,400),
         ('event-unhandled-blocker','audit.internal_only.v1',1,'ops','aggregate-blocked',
          'correlation-blocker','internal',$1::jsonb,$7,$7,$7,0,8,NULL,NULL,NULL,500),
         ('event-blocked','commerce.lifecycle_applied.v1',1,'ops','aggregate-blocked',
          'correlation-blocked','internal',$1::jsonb,$8,$8,$8,0,8,NULL,NULL,NULL,501)`,
      [
        JSON.stringify({ secretMarker: 'outbox-payload-must-not-project' }),
        at(-400),
        at(-200),
        at(-500),
        at(120),
        at(-700),
        at(-500),
        at(-350),
      ],
    );

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/operational-health',
      headers: browserHeaders(owner.cookie as string, hqOrigin),
    });
    expect(response.statusCode).toBe(200);
    const body = hqOperationalHealthResponseSchema.parse(response.json());
    expect(body.status).toBe('critical');
    expect(body.workers).toMatchObject({
      status: 'healthy',
      observedCount: 2,
      runningCount: 1,
      drainingCount: 0,
      stoppedCount: 1,
      staleCount: 0,
      oldestActiveHeartbeatAgeSeconds: 30,
      freshestActiveHeartbeatAgeSeconds: 30,
    });
    expect(body.durableJobs).toMatchObject({
      status: 'critical',
      queuedCount: 2,
      retryCount: 1,
      runningCount: 2,
      staleRunningCount: 1,
      exhaustedCount: 1,
      deadLetterCount: 1,
      actionableCount: 2,
      oldestActionableAgeSeconds: 600,
      oldestStaleRunningAgeSeconds: 90,
      oldestExhaustedAgeSeconds: 700,
      oldestDeadLetterAgeSeconds: 200,
      countSaturated: false,
    });
    expect(body.outbox).toMatchObject({
      status: 'critical',
      unprocessedCount: 4,
      exhaustedCount: 1,
      causallyBlockedCount: 1,
      deadLetterCount: 1,
      actionableCount: 1,
      oldestActionableAgeSeconds: 400,
      oldestExhaustedAgeSeconds: 700,
      oldestCausallyBlockedAgeSeconds: 350,
      oldestDeadLetterAgeSeconds: 200,
      countSaturated: false,
    });
    expect(body.attentionCodes).toEqual([
      'job_backlog_stale',
      'job_running_stale',
      'job_exhausted',
      'job_dead_letter',
      'outbox_backlog_stale',
      'outbox_exhausted',
      'outbox_causally_blocked',
      'outbox_dead_letter',
    ]);
    expect(response.body).not.toMatch(
      /job-payload-must-not-project|outbox-payload-must-not-project/iu,
    );
    expect(body.attentionCodes).not.toContain('worker_stopped');
  }, 20_000);

  it('keeps unresolved replay lineages critical and excludes only successfully resolved dead letters', async () => {
    harness = await createApiHarness();
    const now = harness.clock.now();
    const at = (secondsFromNow: number) =>
      new Date(now.getTime() + secondsFromNow * 1_000).toISOString();
    const owner = await login(harness.app, 'hq-heidi', 'hq');
    await harness.database.query(
      `UPDATE outbox_events
       SET processed_at = $1, lease_owner = NULL, lease_expires_at = NULL
       WHERE processed_at IS NULL AND founding_household_operation_key IS NULL`,
      [now.toISOString()],
    );
    await harness.database.query(
      `INSERT INTO worker_heartbeats(
         worker_id, started_at, last_seen_at, state, current_job_count, version
       ) VALUES ('worker-replay',$1,$2,'running',0,'test-replay')`,
      [at(-300), at(-10)],
    );
    await harness.database.query(
      `INSERT INTO durable_jobs(
         id, job_type, job_version, classification, payload, payload_hash,
         idempotency_key, state, scheduled_at, next_attempt_at, attempts, max_attempts,
         correlation_id, created_at, completed_at, dead_lettered_at, replay_of_job_id
       ) VALUES
         ('job-resolved-root','ops.replay',1,'internal',$1::jsonb,'hash-resolved-root',
          'idempotency-resolved-root','dead_letter',$2,$2,8,8,'correlation-resolved-root',$2,
          NULL,$2,NULL),
         ('job-resolved-child','ops.replay',1,'internal',$1::jsonb,'hash-resolved-child',
          'idempotency-resolved-child','dead_letter',$3,$3,8,8,'correlation-resolved-child',$3,
          NULL,$3,'job-resolved-root'),
         ('job-resolved-leaf','ops.replay',1,'internal',$1::jsonb,'hash-resolved-leaf',
          'idempotency-resolved-leaf','succeeded',$4,$4,1,8,'correlation-resolved-leaf',$4,
          $4,NULL,'job-resolved-child'),
         ('job-failed-root','ops.replay',1,'internal',$1::jsonb,'hash-failed-root',
          'idempotency-failed-root','dead_letter',$5,$5,8,8,'correlation-failed-root',$5,
          NULL,$5,NULL),
         ('job-failed-child','ops.replay',1,'internal',$1::jsonb,'hash-failed-child',
          'idempotency-failed-child','dead_letter',$6,$6,8,8,'correlation-failed-child',$6,
          NULL,$6,'job-failed-root'),
         ('job-pending-root','ops.replay',1,'internal',$1::jsonb,'hash-pending-root',
          'idempotency-pending-root','dead_letter',$7,$7,8,8,'correlation-pending-root',$7,
          NULL,$7,NULL),
         ('job-pending-child','ops.replay',1,'internal',$1::jsonb,'hash-pending-child',
          'idempotency-pending-child','queued',$8,$8,0,8,'correlation-pending-child',$9,
          NULL,NULL,'job-pending-root')`,
      [
        JSON.stringify({ secretMarker: 'replay-job-payload-must-not-project' }),
        at(-1_000),
        at(-900),
        at(-800),
        at(-300),
        at(-200),
        at(-250),
        at(120),
        at(-100),
      ],
    );
    await harness.database.query(
      `INSERT INTO outbox_events(
         id, event_type, event_version, aggregate_type, aggregate_id, correlation_id,
         classification, payload, occurred_at, available_at, next_attempt_at,
         attempts, max_attempts, dead_lettered_at, replay_resolved_at, replay_of_event_id,
         causal_order_position
       ) VALUES
         ('event-resolved-root','check.completed.v1',1,'ops','aggregate-resolved',
          'correlation-event-resolved','internal',$1::jsonb,$2,$2,$2,8,8,$2,$3,NULL,1000),
         ('event-failed-root','orientation.started.v1',1,'ops','aggregate-failed',
          'correlation-event-failed-root','internal',$1::jsonb,$4,$4,$4,8,8,$4,$5,NULL,1100),
         ('event-failed-child','orientation.started.v1',1,'ops','aggregate-failed',
          'correlation-event-failed-child','internal',$1::jsonb,$6,$6,$6,8,8,$6,NULL,
          'event-failed-root',1100),
         ('event-unresolved-root','commerce.lifecycle_applied.v1',1,'ops',
          'aggregate-unresolved','correlation-event-unresolved','internal',$1::jsonb,$7,$7,$7,
          8,8,$7,NULL,NULL,1200)`,
      [
        JSON.stringify({ secretMarker: 'replay-outbox-payload-must-not-project' }),
        at(-1_000),
        at(-900),
        at(-400),
        at(-350),
        at(-300),
        at(-250),
      ],
    );

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/operational-health',
      headers: browserHeaders(owner.cookie as string, hqOrigin),
    });
    expect(response.statusCode).toBe(200);
    const body = hqOperationalHealthResponseSchema.parse(response.json());
    expect(body.durableJobs).toMatchObject({
      status: 'critical',
      queuedCount: 1,
      deadLetterCount: 3,
      actionableCount: 0,
      exhaustedCount: 0,
      oldestDeadLetterAgeSeconds: 300,
    });
    expect(body.outbox).toMatchObject({
      status: 'critical',
      unprocessedCount: 0,
      deadLetterCount: 2,
      actionableCount: 0,
      exhaustedCount: 0,
      causallyBlockedCount: 0,
      oldestDeadLetterAgeSeconds: 300,
    });
    expect(body.attentionCodes).toContain('job_dead_letter');
    expect(body.attentionCodes).toContain('outbox_dead_letter');
    expect(response.body).not.toMatch(
      /replay-job-payload-must-not-project|replay-outbox-payload-must-not-project/iu,
    );

    const raw = await harness.database.query<
      { readonly job_dead: number; readonly outbox_dead: number } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::integer FROM durable_jobs WHERE state = 'dead_letter') AS job_dead,
         (SELECT count(*)::integer FROM outbox_events WHERE dead_lettered_at IS NOT NULL)
           AS outbox_dead`,
    );
    expect(raw.rows[0]).toMatchObject({ job_dead: 5, outbox_dead: 4 });
  }, 20_000);

  it('uses exact stale and clock-skew tolerance boundaries', async () => {
    harness = await createApiHarness();
    const now = harness.clock.now();
    await harness.database.query(
      `INSERT INTO worker_heartbeats(
         worker_id, started_at, last_seen_at, state, current_job_count, version
       ) VALUES ('worker-boundary',$1,$2,'running',0,'test-boundary')`,
      [
        new Date(now.getTime() - 300_000).toISOString(),
        new Date(now.getTime() - 60_000).toISOString(),
      ],
    );
    const owner = await login(harness.app, 'hq-heidi', 'hq');
    const headers = browserHeaders(owner.cookie as string, hqOrigin);

    const atBoundary = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/operational-health',
      headers,
    });
    expect(hqOperationalHealthResponseSchema.parse(atBoundary.json()).workers).toMatchObject({
      status: 'healthy',
      staleCount: 0,
      oldestActiveHeartbeatAgeSeconds: 60,
    });

    harness.clock.advance(1_000);
    const beyondBoundary = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/operational-health',
      headers,
    });
    const staleBody = hqOperationalHealthResponseSchema.parse(beyondBoundary.json());
    expect(staleBody.workers).toMatchObject({ status: 'critical', staleCount: 1 });
    expect(staleBody.attentionCodes).toContain('worker_stale');

    await harness.database.query(
      `UPDATE worker_heartbeats SET last_seen_at = $1 WHERE worker_id = 'worker-boundary'`,
      [new Date(harness.clock.now().getTime() + 5_000).toISOString()],
    );
    const withinTolerance = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/operational-health',
      headers,
    });
    const withinToleranceBody = hqOperationalHealthResponseSchema.parse(withinTolerance.json());
    expect(withinToleranceBody.workers).toMatchObject({
      status: 'healthy',
      clockSkewCount: 0,
      oldestActiveHeartbeatAgeSeconds: 0,
      freshestActiveHeartbeatAgeSeconds: 0,
    });
    expect(withinToleranceBody.attentionCodes).not.toContain('worker_clock_skew');

    await harness.database.query(
      `UPDATE worker_heartbeats SET last_seen_at = $1 WHERE worker_id = 'worker-boundary'`,
      [new Date(harness.clock.now().getTime() + 6_000).toISOString()],
    );
    const beyondTolerance = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/operational-health',
      headers,
    });
    const skewBody = hqOperationalHealthResponseSchema.parse(beyondTolerance.json());
    expect(skewBody.workers).toMatchObject({
      status: 'critical',
      clockSkewCount: 1,
      oldestActiveHeartbeatAgeSeconds: 0,
      freshestActiveHeartbeatAgeSeconds: 0,
    });
    expect(skewBody.attentionCodes).toContain('worker_clock_skew');

    await harness.database.query(
      `UPDATE worker_heartbeats
       SET state = 'stopped', last_seen_at = $1
       WHERE worker_id = 'worker-boundary'`,
      [harness.clock.now().toISOString()],
    );
    const stoppedWorker = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/operational-health',
      headers,
    });
    const stoppedBody = hqOperationalHealthResponseSchema.parse(stoppedWorker.json());
    expect(stoppedBody.workers).toMatchObject({
      status: 'critical',
      observedCount: 1,
      runningCount: 0,
      stoppedCount: 1,
      oldestActiveHeartbeatAgeSeconds: null,
      freshestActiveHeartbeatAgeSeconds: null,
    });
    expect(stoppedBody.attentionCodes).toContain('worker_stopped');
    expect(stoppedBody.attentionCodes).not.toContain('worker_missing');
  }, 20_000);
});

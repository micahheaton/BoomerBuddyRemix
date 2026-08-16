import { randomUUID } from 'node:crypto';
import {
  createPostgresDatabase,
  DurableJobRepository,
  OutboxDeliveryRepository,
  runMigrations,
} from '@boomerbuddy/persistence';

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString.trim() === '') {
  throw new TypeError('DATABASE_URL is required for real PostgreSQL verification');
}
if (process.env.BB_ALLOW_POSTGRES_VERIFICATION !== 'true') {
  throw new TypeError(
    'BB_ALLOW_POSTGRES_VERIFICATION=true is required for destructive CI fixtures',
  );
}
const databaseName = decodeURIComponent(new URL(connectionString).pathname.replace(/^\//u, ''));
if (!/(?:^|[_-])(?:ci|test)(?:$|[_-])/iu.test(databaseName)) {
  throw new TypeError(
    'Real PostgreSQL verification refuses a database not explicitly named CI/test',
  );
}

const database = await createPostgresDatabase(connectionString);
try {
  const first = await runMigrations(database);
  const second = await runMigrations(database);
  if (first.length === 0 || second.length !== 0) {
    throw new Error('PostgreSQL migrations were not forward-only and idempotent');
  }
  const initialState = await database.query<
    { readonly jobs: number; readonly outbox: number } & Record<string, unknown>
  >(
    `SELECT
       (SELECT count(*)::int FROM durable_jobs) AS jobs,
       (SELECT count(*)::int FROM outbox_events) AS outbox`,
  );
  invariant(
    initialState.rows[0]?.jobs === 0 && initialState.rows[0]?.outbox === 0,
    'Real PostgreSQL verification requires a new, empty disposable CI/test database',
  );

  const jobs = new DurableJobRepository(database);
  const outbox = new OutboxDeliveryRepository(database);
  const suffix = randomUUID();
  const base = new Date();
  const at = (offsetMs: number): Date => new Date(base.getTime() + offsetMs);
  const type = (scenario: string): string => `ci.${scenario}.${suffix}`;
  const worker = (scenario: string): string => `postgres-${scenario}-${suffix}`;
  const actorPersonId = `person-postgres-ci-${suffix}`;
  await database.query(
    `INSERT INTO persons(id, display_name, created_at) VALUES ($1,$2,$3)
     ON CONFLICT (id) DO NOTHING`,
    [actorPersonId, 'PostgreSQL CI operator', base.toISOString()],
  );

  const competingType = type('competing');
  const competing = await jobs.enqueue({
    type: competingType,
    payload: { fixture: suffix },
    idempotencyKey: `competing-${suffix}`,
    scheduledAt: base,
    correlationId: `competing-${suffix}`,
    maxAttempts: 3,
  });
  const competingClaims = await Promise.all([
    jobs.claim({
      workerId: worker('competing-one'),
      jobTypes: [competingType],
      limit: 1,
      leaseDurationMs: 5_000,
      now: base,
    }),
    jobs.claim({
      workerId: worker('competing-two'),
      jobTypes: [competingType],
      limit: 1,
      leaseDurationMs: 5_000,
      now: base,
    }),
  ]);
  const competingOwners = competingClaims.flat();
  invariant(competingOwners.length === 1, 'SKIP LOCKED did not produce one job owner');
  invariant(competingOwners[0]?.id === competing.job.id, 'The wrong competing job was claimed');

  const duplicate = await jobs.enqueue({
    type: competingType,
    payload: { fixture: suffix },
    idempotencyKey: `competing-${suffix}`,
    scheduledAt: base,
    correlationId: `competing-${suffix}`,
    maxAttempts: 3,
  });
  invariant(duplicate.duplicate, 'Exact duplicate enqueue did not converge idempotently');
  let conflictRejected = false;
  try {
    await jobs.enqueue({
      type: competingType,
      payload: { fixture: `conflict-${suffix}` },
      idempotencyKey: `competing-${suffix}`,
      scheduledAt: base,
      correlationId: `competing-${suffix}`,
      maxAttempts: 3,
    });
  } catch {
    conflictRejected = true;
  }
  invariant(conflictRejected, 'Conflicting duplicate job evidence was accepted');

  const heartbeatType = type('heartbeat');
  const heartbeatJob = await jobs.enqueue({
    type: heartbeatType,
    payload: { fixture: suffix },
    idempotencyKey: `heartbeat-${suffix}`,
    scheduledAt: at(10_000),
    correlationId: `heartbeat-${suffix}`,
  });
  await jobs.claim({
    workerId: worker('heartbeat-one'),
    jobTypes: [heartbeatType],
    limit: 1,
    leaseDurationMs: 5_000,
    now: at(10_000),
  });
  invariant(
    !(await jobs.heartbeat({
      jobId: heartbeatJob.job.id,
      workerId: worker('heartbeat-two'),
      leaseDurationMs: 5_000,
      now: at(11_000),
    })),
    'A non-owner renewed a job lease',
  );
  invariant(
    await jobs.heartbeat({
      jobId: heartbeatJob.job.id,
      workerId: worker('heartbeat-one'),
      leaseDurationMs: 5_000,
      now: at(14_000),
    }),
    'The job owner could not renew its lease',
  );
  invariant(
    (
      await jobs.claim({
        workerId: worker('heartbeat-two'),
        jobTypes: [heartbeatType],
        limit: 1,
        leaseDurationMs: 5_000,
        now: at(15_001),
      })
    ).length === 0,
    'A heartbeat did not protect work past its original lease',
  );
  const reclaimedHeartbeat = await jobs.claim({
    workerId: worker('heartbeat-two'),
    jobTypes: [heartbeatType],
    limit: 1,
    leaseDurationMs: 5_000,
    now: at(19_001),
  });
  invariant(
    reclaimedHeartbeat[0]?.attempts === 2,
    'Expired work was not reclaimed as a second attempt',
  );
  invariant(
    !(await jobs.complete({
      jobId: heartbeatJob.job.id,
      workerId: worker('heartbeat-one'),
      now: at(19_002),
    })),
    'A crashed/expired owner completed reclaimed work',
  );

  const orderedType = type('ordered');
  for (const sequence of [3, 1, 2]) {
    await jobs.enqueue({
      type: orderedType,
      payload: { sequence },
      idempotencyKey: `ordered-${sequence}-${suffix}`,
      scheduledAt: at(20_000 + sequence),
      correlationId: `ordered-${sequence}-${suffix}`,
    });
  }
  for (const sequence of [1, 2, 3]) {
    const claimed = await jobs.claim({
      workerId: worker(`ordered-${sequence}`),
      jobTypes: [orderedType],
      limit: 1,
      leaseDurationMs: 5_000,
      now: at(21_000 + sequence * 1_000),
    });
    invariant(claimed[0]?.payload.sequence === sequence, 'Scheduled job order was not preserved');
    invariant(
      await jobs.complete({
        jobId: claimed[0].id,
        workerId: worker(`ordered-${sequence}`),
        now: at(21_100 + sequence * 1_000),
      }),
      'Ordered job did not complete under its owner',
    );
  }

  const receiptType = type('receipt');
  const receiptJob = await jobs.enqueue({
    type: receiptType,
    payload: { fixture: suffix },
    idempotencyKey: `receipt-${suffix}`,
    scheduledAt: at(30_000),
    correlationId: `receipt-${suffix}`,
  });
  await jobs.claim({
    workerId: worker('receipt-one'),
    jobTypes: [receiptType],
    limit: 1,
    leaseDurationMs: 5_000,
    now: at(30_000),
  });
  invariant(
    (await jobs.beginConsumerReceipt({
      consumerKey: 'ci-reconciliation-handler',
      idempotencyKey: receiptJob.job.idempotencyKey,
      jobId: receiptJob.job.id,
      workerId: worker('receipt-one'),
      leaseDurationMs: 5_000,
      now: at(30_000),
    })) === 'acquired',
    'The first consumer receipt was not acquired',
  );
  invariant(
    (await jobs.beginConsumerReceipt({
      consumerKey: 'ci-reconciliation-handler',
      idempotencyKey: receiptJob.job.idempotencyKey,
      jobId: receiptJob.job.id,
      workerId: worker('receipt-two'),
      leaseDurationMs: 5_000,
      now: at(31_000),
    })) === 'busy',
    'Duplicate delivery bypassed the live consumer receipt',
  );
  invariant(
    await jobs.heartbeatWithConsumerReceipt({
      jobId: receiptJob.job.id,
      consumerKey: 'ci-reconciliation-handler',
      idempotencyKey: receiptJob.job.idempotencyKey,
      workerId: worker('receipt-one'),
      leaseDurationMs: 5_000,
      now: at(34_000),
    }),
    'The job and consumer receipt did not heartbeat atomically',
  );
  invariant(
    await jobs.completeConsumerReceipt({
      consumerKey: 'ci-reconciliation-handler',
      idempotencyKey: receiptJob.job.idempotencyKey,
      workerId: worker('receipt-one'),
      resultCode: 'completed',
      now: at(36_000),
    }),
    'Consumer receipt completion failed after renewal',
  );
  invariant(
    await jobs.complete({
      jobId: receiptJob.job.id,
      workerId: worker('receipt-one'),
      now: at(36_000),
    }),
    'Receipt-backed job completion failed after renewal',
  );
  invariant(
    (await jobs.beginConsumerReceipt({
      consumerKey: 'ci-reconciliation-handler',
      idempotencyKey: receiptJob.job.idempotencyKey,
      jobId: receiptJob.job.id,
      workerId: worker('receipt-two'),
      leaseDurationMs: 5_000,
      now: at(37_000),
    })) === 'completed',
    'Completed duplicate delivery was not suppressed',
  );

  const retryType = type('retry');
  const retryJob = await jobs.enqueue({
    type: retryType,
    payload: { fixture: suffix },
    idempotencyKey: `retry-${suffix}`,
    scheduledAt: at(40_000),
    correlationId: `retry-${suffix}`,
    maxAttempts: 2,
  });
  await jobs.claim({
    workerId: worker('retry-one'),
    jobTypes: [retryType],
    limit: 1,
    leaseDurationMs: 5_000,
    now: at(40_000),
  });
  invariant(
    (await jobs.fail({
      jobId: retryJob.job.id,
      workerId: worker('retry-one'),
      errorCode: 'provider_unavailable',
      nextAttemptAt: at(42_000),
      now: at(41_000),
    })) === 'retry',
    'First failure did not enter bounded retry',
  );
  invariant(
    (
      await jobs.claim({
        workerId: worker('retry-two'),
        jobTypes: [retryType],
        limit: 1,
        leaseDurationMs: 5_000,
        now: at(41_999),
      })
    ).length === 0,
    'Retry ran before its scheduled time',
  );
  await jobs.claim({
    workerId: worker('retry-two'),
    jobTypes: [retryType],
    limit: 1,
    leaseDurationMs: 5_000,
    now: at(42_000),
  });
  invariant(
    (await jobs.fail({
      jobId: retryJob.job.id,
      workerId: worker('retry-two'),
      errorCode: 'provider_unavailable',
      nextAttemptAt: at(44_000),
      now: at(43_000),
    })) === 'dead_letter',
    'Poison work was not isolated after its retry ceiling',
  );
  invariant(
    (
      await jobs.claim({
        workerId: worker('retry-three'),
        jobTypes: [retryType],
        limit: 1,
        leaseDurationMs: 5_000,
        now: at(44_000),
      })
    ).length === 0,
    'Dead-lettered work remained claimable',
  );
  const replay = await jobs.replayDeadLetter({
    jobId: retryJob.job.id,
    actorPersonId,
    reason: 'provider_recovered',
    correlationId: `retry-replay-${suffix}`,
    now: at(45_000),
  });
  invariant(replay.state === 'queued', 'Audited replay did not create fresh queued work');

  const shutdownType = type('shutdown');
  for (const sequence of [1, 2]) {
    await jobs.enqueue({
      type: shutdownType,
      payload: { sequence },
      idempotencyKey: `shutdown-${sequence}-${suffix}`,
      scheduledAt: at(50_000),
      correlationId: `shutdown-${sequence}-${suffix}`,
    });
  }
  await jobs.claim({
    workerId: worker('shutdown-one'),
    jobTypes: [shutdownType],
    limit: 2,
    leaseDurationMs: 5_000,
    now: at(50_000),
  });
  await jobs.updateWorkerHeartbeat({
    workerId: worker('shutdown-one'),
    state: 'draining',
    currentJobCount: 2,
    version: 'ci',
    startedAt: at(50_000),
    now: at(51_000),
  });
  invariant(
    (await jobs.relinquishWorkerLeases({
      workerId: worker('shutdown-one'),
      now: at(51_000),
    })) === 2,
    'Shutdown did not relinquish every owned job lease',
  );
  invariant(
    (
      await jobs.claim({
        workerId: worker('shutdown-two'),
        jobTypes: [shutdownType],
        limit: 2,
        leaseDurationMs: 5_000,
        now: at(51_001),
      })
    ).length === 2,
    'Relinquished shutdown work was not immediately reclaimable',
  );

  const reconciliationType = type('commerce-reconcile');
  const reconciliation = await jobs.enqueue({
    type: reconciliationType,
    payload: { subscriptionId: `subscription-${suffix}` },
    idempotencyKey: `reconciliation-${suffix}`,
    deduplicationKey: `subscription-${suffix}`,
    scheduledAt: at(60_000),
    correlationId: `reconciliation-${suffix}`,
  });
  const duplicateReconciliation = await jobs.enqueue({
    type: reconciliationType,
    payload: { subscriptionId: `subscription-${suffix}` },
    idempotencyKey: `reconciliation-${suffix}`,
    deduplicationKey: `subscription-${suffix}`,
    scheduledAt: at(60_000),
    correlationId: `reconciliation-${suffix}`,
  });
  invariant(
    duplicateReconciliation.duplicate && duplicateReconciliation.job.id === reconciliation.job.id,
    'Reconciliation intent did not deduplicate against canonical job evidence',
  );

  const firstEventId = `event-ordered-z-first-${suffix}`;
  const secondEventId = `event-ordered-a-second-${suffix}`;
  const orderedEventType = type('outbox-ordered');
  for (const [eventId, sequence] of [
    [firstEventId, 1],
    [secondEventId, 2],
  ] as const) {
    await database.query(
      `INSERT INTO outbox_events(
         id, event_type, event_version, aggregate_type, aggregate_id, correlation_id,
         classification, payload, occurred_at, available_at, next_attempt_at, max_attempts
       ) VALUES ($1,$2,1,'ci','aggregate-ordered','outbox-order','internal',$3::jsonb,$4,$4,$4,2)`,
      [
        eventId,
        orderedEventType,
        JSON.stringify({ sequence }),
        sequence === 1 ? at(70_000) : at(60_000),
      ],
    );
  }
  const orderedClaims = await Promise.all([
    outbox.claim({
      workerId: worker('outbox-order-one'),
      eventTypes: [orderedEventType],
      limit: 1,
      leaseDurationMs: 5_000,
      now: at(71_000),
    }),
    outbox.claim({
      workerId: worker('outbox-order-two'),
      eventTypes: [orderedEventType],
      limit: 1,
      leaseDurationMs: 5_000,
      now: at(71_000),
    }),
  ]);
  const firstOutbox = orderedClaims.flat();
  invariant(
    firstOutbox.length === 1 && firstOutbox[0]?.id === firstEventId,
    'Concurrent workers did not serialize the first event for one aggregate',
  );
  const firstOutboxOwner = firstOutbox[0]?.leaseOwner;
  invariant(firstOutboxOwner !== undefined, 'First ordered outbox event has no lease owner');
  invariant(
    await outbox.complete({
      eventId: firstEventId,
      workerId: firstOutboxOwner,
      now: at(71_100),
    }),
    'First ordered outbox event did not complete',
  );
  const secondOutbox = await outbox.claim({
    workerId: worker('outbox-order-two'),
    eventTypes: [orderedEventType],
    limit: 1,
    leaseDurationMs: 5_000,
    now: at(71_200),
  });
  invariant(secondOutbox[0]?.id === secondEventId, 'Second outbox event overtook its aggregate');
  invariant(
    await outbox.complete({
      eventId: secondEventId,
      workerId: worker('outbox-order-two'),
      now: at(71_300),
    }),
    'Second ordered outbox event did not complete',
  );

  const retryEventId = `event-retry-${suffix}`;
  const retrySuccessorEventId = `event-retry-successor-${suffix}`;
  const retryEventType = type('outbox-retry');
  await database.query(
    `INSERT INTO outbox_events(
       id, event_type, event_version, aggregate_type, aggregate_id, correlation_id,
       classification, payload, occurred_at, available_at, next_attempt_at, max_attempts
     ) VALUES
       ($1,$2,1,'ci','aggregate-retry','outbox-retry','internal',$3::jsonb,$4,$4,$4,2),
       ($5,$2,1,'ci','aggregate-retry','outbox-retry-successor','internal',$6::jsonb,$7,$4,$4,2)`,
    [
      retryEventId,
      retryEventType,
      JSON.stringify({ fixture: suffix, sequence: 1 }),
      at(80_000),
      retrySuccessorEventId,
      JSON.stringify({ fixture: suffix, sequence: 2 }),
      at(80_001),
    ],
  );
  await outbox.claim({
    workerId: worker('outbox-retry-one'),
    eventTypes: [retryEventType],
    limit: 1,
    leaseDurationMs: 5_000,
    now: at(80_000),
  });
  invariant(
    !(await outbox.heartbeat({
      eventId: retryEventId,
      workerId: worker('outbox-retry-two'),
      leaseDurationMs: 5_000,
      now: at(81_000),
    })),
    'A non-owner renewed an outbox lease',
  );
  invariant(
    await outbox.heartbeat({
      eventId: retryEventId,
      workerId: worker('outbox-retry-one'),
      leaseDurationMs: 5_000,
      now: at(81_000),
    }),
    'The outbox owner could not renew its lease',
  );
  invariant(
    (await outbox.fail({
      eventId: retryEventId,
      workerId: worker('outbox-retry-one'),
      errorCode: 'sink_unavailable',
      nextAttemptAt: at(82_000),
      now: at(81_000),
    })) === 'retry',
    'Outbox failure did not enter retry',
  );
  invariant(
    (
      await outbox.claim({
        workerId: worker('outbox-retry-two'),
        eventTypes: [retryEventType],
        limit: 1,
        leaseDurationMs: 5_000,
        now: at(81_999),
      })
    ).length === 0,
    'Outbox retry ran before its next-attempt time',
  );
  await outbox.claim({
    workerId: worker('outbox-retry-two'),
    eventTypes: [retryEventType],
    limit: 1,
    leaseDurationMs: 5_000,
    now: at(82_000),
  });
  invariant(
    (await outbox.fail({
      eventId: retryEventId,
      workerId: worker('outbox-retry-two'),
      errorCode: 'sink_unavailable',
      nextAttemptAt: at(84_000),
      now: at(83_000),
    })) === 'dead_letter',
    'Outbox poison event was not dead-lettered',
  );
  invariant(
    (
      await outbox.claim({
        workerId: worker('outbox-poison-blocked'),
        eventTypes: [retryEventType],
        limit: 1,
        leaseDurationMs: 5_000,
        now: at(84_000),
      })
    ).length === 0,
    'A successor overtook an unresolved poison event',
  );
  const replayEventId = await outbox.replayDeadLetter({
    eventId: retryEventId,
    actorPersonId,
    reason: 'sink_recovered',
    correlationId: `outbox-replay-${suffix}`,
    now: at(85_000),
  });
  const replayLineage = await database.query<
    {
      readonly causal_order_position: number;
      readonly original_causal_order_position: number;
      readonly replay_of_event_id: string;
      readonly occurred_at: unknown;
    } & Record<string, unknown>
  >(
    `SELECT replay.causal_order_position,
            original.causal_order_position AS original_causal_order_position,
            replay.replay_of_event_id, replay.occurred_at
     FROM outbox_events AS replay
     JOIN outbox_events AS original ON original.id = replay.replay_of_event_id
     WHERE replay.id = $1`,
    [replayEventId],
  );
  invariant(
    replayLineage.rows[0]?.replay_of_event_id === retryEventId &&
      replayLineage.rows[0]?.causal_order_position ===
        replayLineage.rows[0]?.original_causal_order_position &&
      new Date(String(replayLineage.rows[0]?.occurred_at)).getTime() === at(80_000).getTime(),
    'Outbox replay did not retain the original causal position and lineage',
  );
  const replayAudits = await database.query<{ readonly total: number } & Record<string, unknown>>(
    `SELECT count(*)::int AS total FROM audit_events
     WHERE action IN ('job.replayed','outbox.replayed')
       AND resource_id IN ($1,$2)`,
    [replay.id, replayEventId],
  );
  invariant(replayAudits.rows[0]?.total === 2, 'Job/outbox replay audit evidence is incomplete');
  const replayClaim = await outbox.claim({
    workerId: worker('outbox-shutdown-one'),
    eventTypes: [retryEventType],
    limit: 1,
    leaseDurationMs: 5_000,
    now: at(86_000),
  });
  invariant(replayClaim[0]?.id === replayEventId, 'Replayed outbox event was not claimable');
  invariant(
    (await outbox.relinquishWorkerLeases({
      workerId: worker('outbox-shutdown-one'),
      now: at(87_000),
    })) === 1,
    'Shutdown did not relinquish the owned outbox lease',
  );
  const reclaimedReplay = await outbox.claim({
    workerId: worker('outbox-shutdown-two'),
    eventTypes: [retryEventType],
    limit: 1,
    leaseDurationMs: 5_000,
    now: at(87_001),
  });
  invariant(
    reclaimedReplay[0]?.id === replayEventId,
    'Relinquished outbox work was not immediately reclaimable',
  );
  invariant(
    (await outbox.fail({
      eventId: replayEventId,
      workerId: worker('outbox-shutdown-two'),
      errorCode: 'sink_still_unavailable',
      nextAttemptAt: at(87_100),
      now: at(87_100),
    })) === 'dead_letter',
    'A poison replay did not re-enter the dead-letter chain',
  );
  invariant(
    (
      await outbox.claim({
        workerId: worker('outbox-successor-blocked-again'),
        eventTypes: [retryEventType],
        limit: 1,
        leaseDurationMs: 5_000,
        now: at(87_150),
      })
    ).length === 0,
    'A successor overtook a dead-lettered replay',
  );
  const secondReplayEventId = await outbox.replayDeadLetter({
    eventId: replayEventId,
    actorPersonId,
    reason: 'sink_recovered_after_second_attempt',
    correlationId: `outbox-second-replay-${suffix}`,
    now: at(87_175),
  });
  const secondReplayClaim = await outbox.claim({
    workerId: worker('outbox-second-replay'),
    eventTypes: [retryEventType],
    limit: 1,
    leaseDurationMs: 5_000,
    now: at(87_180),
  });
  invariant(
    secondReplayClaim[0]?.id === secondReplayEventId,
    'Second replay in the causal chain was not claimable',
  );
  invariant(
    await outbox.complete({
      eventId: secondReplayEventId,
      workerId: worker('outbox-second-replay'),
      now: at(87_190),
    }),
    'Second replay in the causal chain did not complete',
  );
  const successorAfterReplay = await outbox.claim({
    workerId: worker('outbox-successor'),
    eventTypes: [retryEventType],
    limit: 1,
    leaseDurationMs: 5_000,
    now: at(87_200),
  });
  invariant(
    successorAfterReplay[0]?.id === retrySuccessorEventId,
    'Successor did not unblock after the causal replay completed',
  );

  process.stdout.write(
    'Real PostgreSQL migrations, locking, lease/reclaim/heartbeat ownership, duplicate receipts, ordering, retry/dead-letter/audited replay, shutdown, outbox, and reconciliation-intent persistence passed.\n',
  );
} finally {
  await database.close();
}

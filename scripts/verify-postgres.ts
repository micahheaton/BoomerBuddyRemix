import { randomUUID } from 'node:crypto';
import {
  DomainError,
  foundingHouseholdProtectedEnrollmentConsentVersion,
  foundingHouseholdProductionServiceConsentVersion,
} from '@boomerbuddy/domain';
import {
  AutomationBudgetRepository,
  BusinessOsRepository,
  CommerceRuntimeRepository,
  createPostgresDatabase,
  DurableJobRepository,
  FeedbackRepository,
  type FeedbackIntakeRequest,
  FoundingHouseholdRepository,
  foundingHouseholdProductionServiceDocuments,
  foundingHouseholdProtectedDocuments,
  FounderProvisioningRepository,
  OutboxDeliveryRepository,
  ProductionIdentityRepository,
  runMigrations,
  SessionRepository,
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
    {
      readonly feedback_charges: number;
      readonly feedback_records: number;
      readonly founding_operations: number;
      readonly jobs: number;
      readonly outbox: number;
      readonly production_customer_bootstraps: number;
      readonly production_founder_bootstraps: number;
    } & Record<string, unknown>
  >(
    `SELECT
       (SELECT count(*)::int FROM durable_jobs) AS jobs,
       (SELECT count(*)::int FROM outbox_events) AS outbox,
       (SELECT count(*)::int FROM production_founder_bootstraps)
         AS production_founder_bootstraps,
       (SELECT count(*)::int FROM production_customer_bootstraps)
         AS production_customer_bootstraps,
       (SELECT count(*)::int FROM founding_household_operations) AS founding_operations,
       (SELECT count(*)::int FROM feedback_records) AS feedback_records,
       (SELECT count(*)::int FROM feedback_authenticated_quota_charges) AS feedback_charges`,
  );
  const emptyInitialState = initialState.rows[0];
  invariant(
    emptyInitialState?.jobs === 0 &&
      emptyInitialState.outbox === 0 &&
      emptyInitialState.production_founder_bootstraps === 0 &&
      emptyInitialState.production_customer_bootstraps === 0 &&
      emptyInitialState.founding_operations === 0 &&
      emptyInitialState.feedback_records === 0 &&
      emptyInitialState.feedback_charges === 0,
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
  const stripeHouseholdId = `household-postgres-stripe-${suffix}`;
  await database.query(`INSERT INTO households(id, name, created_at) VALUES ($1,$2,$3)`, [
    stripeHouseholdId,
    'PostgreSQL Stripe concurrency fixture',
    base.toISOString(),
  ]);
  await database.query(
    `INSERT INTO household_memberships(
       household_id, id, person_id, membership_kind, status, created_at
     ) VALUES ($1,$2,$3,'member','active',$4)`,
    [stripeHouseholdId, `membership-postgres-stripe-${suffix}`, actorPersonId, base.toISOString()],
  );
  await database.query(
    `INSERT INTO household_billing_authorities(
       household_id, person_id, status, granted_by_person_id, granted_at
     ) VALUES ($1,$2,'active',$2,$3)`,
    [stripeHouseholdId, actorPersonId, base.toISOString()],
  );
  await database.query(
    `INSERT INTO organizations(id, name, kind, verification_state, created_at)
     VALUES ($1,$2,'internal','local_fixture',$3)
     ON CONFLICT (id) DO NOTHING`,
    [`organization-postgres-ci-${suffix}`, 'PostgreSQL CI internal', base.toISOString()],
  );
  await database.query(
    `INSERT INTO employee_assignments(id, person_id, organization_id, role, status, created_at)
     VALUES ($1,$2,$3,'hq_owner','active',$4)
     ON CONFLICT (id) DO NOTHING`,
    [
      `assignment-postgres-ci-${suffix}`,
      actorPersonId,
      `organization-postgres-ci-${suffix}`,
      base.toISOString(),
    ],
  );

  const businessOs = new BusinessOsRepository(database, undefined, actorPersonId);
  const automationBudgets = new AutomationBudgetRepository(database, undefined, actorPersonId);
  const founderProvisioning = new FounderProvisioningRepository(database, actorPersonId);
  const commerceRuntime = new CommerceRuntimeRepository(database);
  const stripeDispatchInput = {
    householdId: stripeHouseholdId,
    action: 'portal' as const,
    environment: 'test' as const,
    serverOperationId: `portal-postgres-${suffix}`,
    providerIdempotencyKey: `bb:test:portal:postgres-${suffix}`,
    actorPersonId,
    providerCustomerId: `cus_postgres_${suffix.replaceAll('-', '')}`,
    providerConfigurationId: `bpc_postgres_${suffix.replaceAll('-', '')}`,
    returnUrl: 'https://customer.boomerbuddy.test/member/billing',
    now: base,
  };
  const initialStripeClaims = await Promise.all([
    commerceRuntime.beginStripeSessionOperation(stripeDispatchInput),
    commerceRuntime.beginStripeSessionOperation(stripeDispatchInput),
  ]);
  invariant(
    initialStripeClaims.filter((claim) => claim.shouldDispatch).length === 1 &&
      initialStripeClaims.every((claim) => claim.attempt === 1),
    'Concurrent Stripe dispatch creation did not serialize to one provider attempt',
  );
  const stripeRetryAt = at(2 * 60_000 + 1);
  const retryStripeClaims = await Promise.all([
    commerceRuntime.beginStripeSessionOperation({
      ...stripeDispatchInput,
      allowDueRetry: true,
      now: stripeRetryAt,
    }),
    commerceRuntime.beginStripeSessionOperation({
      ...stripeDispatchInput,
      allowDueRetry: true,
      now: stripeRetryAt,
    }),
  ]);
  invariant(
    retryStripeClaims.filter((claim) => claim.shouldDispatch).length === 1 &&
      retryStripeClaims.every((claim) => claim.attempt === 2),
    'Concurrent stale Stripe lease recovery did not serialize to one same-key retry',
  );
  const stripeAttemptLedger = await database.query<
    {
      readonly attempt_count: number;
      readonly dispatch_started_count: number;
      readonly distinct_provider_keys: number;
      readonly lease_expired_count: number;
    } & Record<string, unknown>
  >(
    `SELECT operation.attempt_count,
            count(*) FILTER (WHERE attempt.event_kind = 'dispatch_started')::int
              AS dispatch_started_count,
            count(*) FILTER (WHERE attempt.event_kind = 'lease_expired')::int
              AS lease_expired_count,
            count(DISTINCT attempt.provider_idempotency_key)::int AS distinct_provider_keys
     FROM commerce_stripe_session_operations operation
     JOIN commerce_stripe_session_operation_attempts attempt ON attempt.operation_id = operation.id
     WHERE operation.household_id = $1 AND operation.server_operation_id = $2
     GROUP BY operation.attempt_count`,
    [stripeHouseholdId, stripeDispatchInput.serverOperationId],
  );
  invariant(
    stripeAttemptLedger.rows[0]?.attempt_count === 2 &&
      stripeAttemptLedger.rows[0]?.dispatch_started_count === 2 &&
      stripeAttemptLedger.rows[0]?.lease_expired_count === 1 &&
      stripeAttemptLedger.rows[0]?.distinct_provider_keys === 1,
    'Stripe dispatch attempt ledger lost same-key concurrency evidence',
  );
  const provisioningInputs = [0, 1].map((index) => ({
    access: {
      actorPersonId,
      correlationId: `postgres-provisioning-${index}-${suffix}`,
    },
    workstreamKey: 'company_git' as const,
    operationKey: `provisioning:company_git:${index === 0 ? suffix : randomUUID()}`,
    toStatus: 'founder_in_progress' as const,
    evidence: {
      tier: 'founder_report' as const,
      kind: 'setup_started' as const,
      result: 'reported' as const,
      observedAt: base,
    },
  }));
  const competingProvisioningTransitions = await Promise.allSettled(
    provisioningInputs.map((input) => founderProvisioning.transition(input)),
  );
  const successfulProvisioningIndex = competingProvisioningTransitions.findIndex(
    ({ status }) => status === 'fulfilled',
  );
  invariant(
    successfulProvisioningIndex >= 0 &&
      competingProvisioningTransitions.filter(({ status }) => status === 'fulfilled').length === 1,
    'Concurrent founder provisioning transitions did not serialize to exactly one commit',
  );
  const successfulProvisioningInput = provisioningInputs[successfulProvisioningIndex];
  invariant(successfulProvisioningInput !== undefined, 'Successful provisioning input is missing');
  const provisioningRetry = await founderProvisioning.transition(successfulProvisioningInput);
  invariant(
    provisioningRetry.reused && provisioningRetry.externalActionExecuted === false,
    'Founder provisioning exact retry was not idempotent and side-effect-free',
  );
  const provisioningState = await database.query<
    {
      readonly evidence_count: number;
      readonly operation_count: number;
      readonly status_count: number;
    } & Record<string, unknown>
  >(`
    SELECT
      (SELECT count(*)::int FROM founder_provisioning_evidence
        WHERE workstream_key = 'company_git') AS evidence_count,
      (SELECT count(*)::int FROM founder_provisioning_operations
        WHERE workstream_key = 'company_git') AS operation_count,
      (SELECT count(*)::int FROM founder_provisioning_status_events
        WHERE workstream_key = 'company_git') AS status_count
  `);
  invariant(
    provisioningState.rows[0]?.evidence_count === 2 &&
      provisioningState.rows[0]?.operation_count === 1 &&
      provisioningState.rows[0]?.status_count === 2,
    'Founder provisioning concurrency left duplicate or orphan ledger rows',
  );
  const budgetPolicyId = await businessOs.putAutomationPolicy({
    approvedByPersonId: actorPersonId,
    correlationId: `postgres-budget-policy-${suffix}`,
    now: base,
    policy: {
      action: 'create_internal_task',
      allowedDataClasses: ['public'],
      allowedTools: ['hq'],
      autonomy: 'auto',
      enabled: true,
      maxCostPerOperationCents: 10,
      requiresAudit: true,
    },
  });
  const budgetScopes = [
    { periodKind: 'day' as const, scopeKind: 'company' as const, scopeKey: 'global' },
    { periodKind: 'month' as const, scopeKind: 'company' as const, scopeKey: 'global' },
    {
      periodKind: 'day' as const,
      scopeKind: 'agent' as const,
      scopeKey: 'postgres_budget_agent',
    },
    {
      periodKind: 'day' as const,
      scopeKind: 'action' as const,
      scopeKey: 'create_internal_task',
    },
    { periodKind: 'day' as const, scopeKind: 'tool' as const, scopeKey: 'hq' },
    {
      periodKind: 'month' as const,
      scopeKind: 'policy' as const,
      scopeKey: budgetPolicyId,
    },
  ];
  for (const [index, cap] of budgetScopes.entries()) {
    await automationBudgets.putCap({
      approvedByPersonId: actorPersonId,
      context: {
        actorPersonId,
        audience: 'hq',
        correlationId: `postgres-budget-cap-${index}-${suffix}`,
        now: base,
      },
      enabled: true,
      limitCents: 10,
      ...cap,
    });
  }
  await businessOs.setGlobalAutomationKillSwitch({
    correlationId: `postgres-budget-clear-${suffix}`,
    killSwitch: false,
    now: base,
    updatedByPersonId: actorPersonId,
  });
  const competingBudgetReservations = await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      automationBudgets.reserve({
        agentKey: 'postgres_budget_agent',
        context: {
          actorPersonId,
          audience: 'hq',
          correlationId: `postgres-budget-reserve-${index}-${suffix}`,
          now: base,
        },
        operationKey: `postgres-budget-operation-${index}-${suffix}`,
        request: {
          action: 'create_internal_task',
          dataClasses: ['public'],
          estimatedCostCents: 1,
          tool: 'hq',
        },
        ttlMs: 60_000,
      }),
    ),
  );
  invariant(
    competingBudgetReservations.filter((reservation) => reservation.allowed).length === 10,
    'Concurrent automation budget reservations exceeded or underused the cumulative cap',
  );
  invariant(
    (await automationBudgets.status(base)).every(
      (cap) => cap.reservedCents === 10 && cap.availableCents === 0,
    ),
    'Overlapping automation budget windows did not converge on the same atomic reservation total',
  );
  await businessOs.setGlobalAutomationKillSwitch({
    correlationId: `postgres-budget-engage-${suffix}`,
    killSwitch: true,
    now: at(1),
    updatedByPersonId: actorPersonId,
  });

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

  const run31FounderPersonId = `person-run31-founder-${suffix}`;
  const run31FounderIssuer = 'https://hq.postgres.test';
  const run31FounderSubject = `founder_postgres_${suffix}`;
  const run31CustomerIssuer = 'https://customer.postgres.test';
  const run31CustomerSubject = `customer_postgres_${suffix}`;
  const run31Identities = new ProductionIdentityRepository(database);
  const run31FounderInput = {
    issuer: run31FounderIssuer,
    subject: run31FounderSubject,
    founderPersonId: run31FounderPersonId,
    correlationId: `correlation:run31-founder-${suffix}`,
    now: base,
  };
  const run31Founder = await run31Identities.bootstrapFounder(run31FounderInput);
  const run31FounderReplay = await run31Identities.bootstrapFounder(run31FounderInput);
  invariant(
    run31Founder.personId === run31FounderPersonId &&
      !run31Founder.reused &&
      run31FounderReplay.reused &&
      run31FounderReplay.identityId === run31Founder.identityId &&
      run31FounderReplay.organizationId === run31Founder.organizationId,
    'Run 3.1 production founder identity did not bootstrap and exact-replay once',
  );

  const run31Founding = new FoundingHouseholdRepository(
    database,
    Buffer.alloc(32, 71),
    1,
    run31FounderPersonId,
    'production',
  );
  const run31ProgramInput = {
    access: {
      actorPersonId: run31FounderPersonId,
      correlationId: `correlation:run31-program-${suffix}`,
    },
    operationKey: `founding-policy:${randomUUID()}`,
    benefitKey: 'family_beta_v1',
    maxHouseholds: 1,
    invitationTtlDays: 7,
    accessDurationDays: 30,
    programEndsAt: new Date(base.getTime() + 60 * 86_400_000),
    sponsorshipPrivacyPolicyVersion: 'run3-1-postgres-verification-v1',
    sponsorshipStartsAt: new Date(base.getTime() - 86_400_000),
    sponsorshipEndsAt: new Date(base.getTime() + 90 * 86_400_000),
    now: base,
  } as const;
  const run31Program = await run31Founding.bootstrapProductionProgram(run31ProgramInput);
  const run31ProgramReplay = await run31Founding.bootstrapProductionProgram(run31ProgramInput);
  invariant(
    run31Program.policy.environment === 'production' &&
      run31Program.policy.state === 'active' &&
      run31Program.policy.maxHouseholds === 1 &&
      run31Program.backingEvidenceTier === 'live_production' &&
      run31ProgramReplay.reused &&
      run31ProgramReplay.sponsorshipId === run31Program.sponsorshipId &&
      run31ProgramReplay.policy.revision === run31Program.policy.revision,
    'Run 3.1 production Founding Household program did not persist and exact-replay its sponsor policy',
  );

  const run31CustomerBootstraps = await Promise.all([
    run31Identities.ensureCustomerBootstrap({
      issuer: run31CustomerIssuer,
      subject: run31CustomerSubject,
      now: base,
    }),
    run31Identities.ensureCustomerBootstrap({
      issuer: run31CustomerIssuer,
      subject: run31CustomerSubject,
      now: base,
    }),
  ]);
  const run31Customer = run31CustomerBootstraps[0];
  invariant(
    run31Customer !== null &&
      run31CustomerBootstraps[1] !== null &&
      run31Customer.identityId === run31CustomerBootstraps[1].identityId &&
      run31Customer.personId === run31CustomerBootstraps[1].personId &&
      run31Customer.householdId === run31CustomerBootstraps[1].householdId &&
      run31Customer.membershipId === run31CustomerBootstraps[1].membershipId,
    'Concurrent Run 3.1 customer bootstrap did not converge on one exact empty household',
  );
  const run31BootstrapEvidence = await database.query<
    {
      readonly administrators: number;
      readonly bootstraps: number;
      readonly grants: number;
      readonly identities: number;
      readonly memberships: number;
      readonly protected_members: number;
    } & Record<string, unknown>
  >(
    `SELECT
       (SELECT count(*)::integer FROM identities
        WHERE id = $1 AND issuer = $2 AND subject = $3 AND person_id = $4
          AND status = 'active') AS identities,
       (SELECT count(*)::integer FROM production_customer_bootstraps
        WHERE identity_id = $1 AND issuer = $2 AND subject = $3
          AND person_id = $4 AND household_id = $5 AND membership_id = $6) AS bootstraps,
       (SELECT count(*)::integer FROM household_memberships
        WHERE household_id = $5 AND id = $6 AND person_id = $4
          AND membership_kind = 'member' AND status = 'active') AS memberships,
       (SELECT count(*)::integer FROM household_administrator_assignments
        WHERE household_id = $5 AND person_id = $4 AND status = 'active') AS administrators,
       (SELECT count(*)::integer FROM entitlement_grants
        WHERE household_id = $5 AND revoked_at IS NULL) AS grants,
       (SELECT count(*)::integer FROM protected_members
        WHERE household_id = $5) AS protected_members`,
    [
      run31Customer.identityId,
      run31Customer.issuer,
      run31Customer.subject,
      run31Customer.personId,
      run31Customer.householdId,
      run31Customer.membershipId,
    ],
  );
  invariant(
    run31BootstrapEvidence.rows[0]?.identities === 1 &&
      run31BootstrapEvidence.rows[0]?.bootstraps === 1 &&
      run31BootstrapEvidence.rows[0]?.memberships === 1 &&
      run31BootstrapEvidence.rows[0]?.administrators === 1 &&
      run31BootstrapEvidence.rows[0]?.grants === 0 &&
      run31BootstrapEvidence.rows[0]?.protected_members === 0,
    'Run 3.1 customer bootstrap created ambiguous authority or an unauthorized entitlement',
  );

  const run31Session = await new SessionRepository(
    database,
    undefined,
    'production',
  ).resolveProviderSession({
    identityId: run31Customer.identityId,
    personId: run31Customer.personId,
    issuer: run31Customer.issuer,
    subject: run31Customer.subject,
    providerSessionId: `provider_session_postgres_${suffix}`,
    audience: 'customer',
    issuedAt: new Date(base.getTime() - 60_000),
    expiresAt: new Date(base.getTime() + 90 * 86_400_000),
    now: base,
  });
  invariant(
    run31Session !== null &&
      run31Session.identityId === run31Customer.identityId &&
      run31Session.identitySubject === run31Customer.subject &&
      run31Session.providerSessionId === `provider_session_postgres_${suffix}`,
    'Run 3.1 provider session did not retain its exact identity and provider-session binding',
  );
  const run31SessionEvidence = await database.query<
    { readonly exact_sessions: number } & Record<string, unknown>
  >(
    `SELECT count(*)::integer AS exact_sessions FROM sessions
     WHERE id = $1 AND identity_id = $2 AND person_id = $3 AND issuer = $4
       AND identity_subject = $5 AND provider_session_id = $6
       AND audience = 'customer' AND revoked_at IS NULL`,
    [
      run31Session.principal.sessionId,
      run31Customer.identityId,
      run31Customer.personId,
      run31Customer.issuer,
      run31Customer.subject,
      run31Session.providerSessionId,
    ],
  );
  invariant(
    run31SessionEvidence.rows[0]?.exact_sessions === 1,
    'Run 3.1 provider session durable identity binding is incomplete',
  );
  const run31Access = {
    actorPersonId: run31Customer.personId,
    actorIssuer: run31Session.issuer,
    actorIdentityId: run31Session.identityId,
    actorIdentitySubject: run31Session.identitySubject,
    sessionId: run31Session.principal.sessionId,
    audience: 'customer' as const,
    correlationId: `correlation:run31-customer-${suffix}`,
  };
  const run31Feedback = new FeedbackRepository(database, {
    encryptionKey: Buffer.alloc(32, 73),
    encryptionKeyVersion: 1,
    fingerprintKey: Buffer.alloc(32, 79),
    fingerprintKeyVersion: 1,
  });
  const run31PreEnrollmentRequest: FeedbackIntakeRequest = {
    operationKey: `feedback:${randomUUID()}`,
    text: 'Run 3.1 PostgreSQL verification must reject feedback before enrollment.',
    feedbackType: 'product_feedback',
    source: { surface: 'in_app_contextual', deviceClass: 'desktop' },
    link: { permitted: false },
    followUp: { granted: false },
    researchRetention: { granted: false },
  };
  let run31PreEnrollmentError: unknown;
  try {
    await run31Feedback.createAuthenticated({
      householdId: run31Customer.householdId,
      actorPersonId: run31Customer.personId,
      request: run31PreEnrollmentRequest,
      correlationId: `correlation:run31-feedback-denied-${suffix}`,
      evidenceTier: 'live_production',
      now: base,
    });
  } catch (error) {
    run31PreEnrollmentError = error;
  }
  const run31PreEnrollmentRows = await database.query<
    {
      readonly buckets: number;
      readonly charges: number;
      readonly operations: number;
      readonly records: number;
    } & Record<string, unknown>
  >(
    `SELECT
       (SELECT count(*)::integer FROM feedback_intake_operations
        WHERE operation_key = $1) AS operations,
       (SELECT count(*)::integer FROM feedback_authenticated_quota_charges
        WHERE operation_key = $1) AS charges,
       (SELECT count(*)::integer FROM feedback_authenticated_quota_buckets
        WHERE (scope_kind = 'person' AND scope_id = $3)
           OR (scope_kind = 'household' AND scope_id = $2)) AS buckets,
       (SELECT count(*)::integer FROM feedback_records
        WHERE household_id = $2 AND actor_person_id = $3
          AND evidence_tier = 'live_production') AS records`,
    [run31PreEnrollmentRequest.operationKey, run31Customer.householdId, run31Customer.personId],
  );
  invariant(
    run31PreEnrollmentError instanceof DomainError &&
      run31PreEnrollmentError.code === 'not_authorized' &&
      run31PreEnrollmentError.message ===
        'Live feedback requires a current Founding Household sponsored entitlement' &&
      run31PreEnrollmentRows.rows[0]?.operations === 0 &&
      run31PreEnrollmentRows.rows[0]?.charges === 0 &&
      run31PreEnrollmentRows.rows[0]?.buckets === 0 &&
      run31PreEnrollmentRows.rows[0]?.records === 0,
    'Run 3.1 feedback admission did not fail closed before exact Founding enrollment',
  );

  const run31Invitation = await run31Founding.createInvitation({
    access: {
      actorPersonId: run31FounderPersonId,
      correlationId: `correlation:run31-invite-${suffix}`,
    },
    intendedIdentity: run31Customer,
    operationKey: `founding-invite:${randomUUID()}`,
    now: base,
  });
  invariant(
    run31Invitation.invitationCredential !== undefined &&
      run31Invitation.invitation.identityBindingState === 'verified_identity' &&
      run31Invitation.invitation.householdId === run31Customer.householdId,
    'Run 3.1 production invitation was not bound to the exact customer bootstrap',
  );
  const run31Enrollment = await run31Founding.acceptInvitation({
    access: run31Access,
    householdId: run31Customer.householdId,
    invitationId: run31Invitation.invitation.id,
    invitationCredential: run31Invitation.invitationCredential,
    operationKey: `founding-accept:${randomUUID()}`,
    serviceConsentVersion: foundingHouseholdProductionServiceConsentVersion,
    serviceDisclosureDigest: foundingHouseholdProductionServiceDocuments.disclosureDigest,
    servicePolicyDigest: foundingHouseholdProductionServiceDocuments.policyDigest,
    protectedEnrollmentConsentVersion: foundingHouseholdProtectedEnrollmentConsentVersion,
    protectedEnrollmentDisclosureDigest: foundingHouseholdProtectedDocuments.disclosureDigest,
    protectedEnrollmentPolicyDigest: foundingHouseholdProtectedDocuments.policyDigest,
    now: base,
  });
  invariant(
    run31Enrollment.enrollment.environment === 'production' &&
      run31Enrollment.enrollment.evidenceTier === 'live_production' &&
      run31Enrollment.enrollment.householdId === run31Customer.householdId &&
      run31Enrollment.enrollment.acceptedByPersonId === run31Customer.personId &&
      run31Enrollment.enrollment.state === 'active' &&
      run31Enrollment.enrollment.paymentState === 'not_paid_sponsored_beta' &&
      !run31Enrollment.paymentCollected,
    'Run 3.1 Founding enrollment did not persist as finite sponsored access without payment',
  );
  const run31GrantEvidence = await database.query<
    {
      readonly allocation_state: string;
      readonly allocation_verified: boolean;
      readonly consent_purpose: string;
      readonly consent_revoked_at: unknown | null;
      readonly consent_state: string;
      readonly consent_version: string;
      readonly credential_fingerprint: string | null;
      readonly exact_allocation: boolean;
      readonly exact_grant: boolean;
      readonly exact_plan: boolean;
      readonly exact_subscription: boolean;
      readonly grant_revoked_at: unknown | null;
      readonly grant_source: string;
      readonly grant_verified: boolean;
      readonly invitation_state: string;
      readonly payer_person_id: string | null;
      readonly reconciliation_state: string;
      readonly subscription_lifecycle: string;
      readonly subscription_source: string;
      readonly subscription_verified: boolean;
    } & Record<string, unknown>
  >(
    `SELECT
       invitation.state AS invitation_state,
       invitation.credential_fingerprint,
       subscription.payer_person_id,
       subscription.source AS subscription_source,
       subscription.lifecycle AS subscription_lifecycle,
       subscription.source_verified AS subscription_verified,
       subscription.reconciliation_state,
       allocation.state AS allocation_state,
       allocation.source_verified AS allocation_verified,
       grant_record.source AS grant_source,
       grant_record.source_verified AS grant_verified,
       grant_record.revoked_at AS grant_revoked_at,
       grant_record.plan_version_id = enrollment.plan_version_id AS exact_plan,
       grant_record.subscription_id = enrollment.subscription_id AS exact_subscription,
       grant_record.sponsorship_id = enrollment.sponsorship_allocation_id AS exact_allocation,
       grant_record.starts_at = enrollment.starts_at
         AND grant_record.ends_at = enrollment.ends_at
         AND grant_record.capabilities = plan.capabilities AS exact_grant,
       consent.purpose AS consent_purpose,
       consent.consent_version,
       consent.state AS consent_state,
       consent.revoked_at AS consent_revoked_at
     FROM founding_household_enrollments enrollment
     JOIN founding_household_invitations invitation
       ON invitation.id = enrollment.invitation_id
     JOIN commerce_plan_versions plan ON plan.id = enrollment.plan_version_id
     JOIN commerce_subscriptions subscription
       ON subscription.household_id = enrollment.household_id
      AND subscription.id = enrollment.subscription_id
     JOIN commerce_sponsorship_allocations allocation
       ON allocation.household_id = enrollment.household_id
      AND allocation.id = enrollment.sponsorship_allocation_id
     JOIN entitlement_grants grant_record
       ON grant_record.household_id = enrollment.household_id
      AND grant_record.id = enrollment.entitlement_grant_id
     JOIN consents consent
       ON consent.household_id = enrollment.household_id
      AND consent.id = enrollment.service_consent_id
     WHERE enrollment.id = $1 AND enrollment.environment = 'production'
       AND enrollment.evidence_tier = 'live_production'
       AND enrollment.accepted_identity_id = $2
       AND enrollment.accepted_identity_issuer = $3
       AND enrollment.accepted_identity_subject = $4
       AND enrollment.accepted_session_id = $5
       AND enrollment.state = 'active' AND enrollment.revoked_at IS NULL`,
    [
      run31Enrollment.enrollment.id,
      run31Customer.identityId,
      run31Customer.issuer,
      run31Customer.subject,
      run31Session.principal.sessionId,
    ],
  );
  const run31Grant = run31GrantEvidence.rows[0];
  invariant(
    run31Grant?.invitation_state === 'accepted' &&
      run31Grant.credential_fingerprint === null &&
      run31Grant.payer_person_id === null &&
      run31Grant.subscription_source === 'sponsor' &&
      run31Grant.subscription_lifecycle === 'active' &&
      run31Grant.subscription_verified &&
      run31Grant.reconciliation_state === 'not_required' &&
      run31Grant.allocation_state === 'active' &&
      run31Grant.allocation_verified &&
      run31Grant.grant_source === 'sponsor' &&
      run31Grant.grant_verified &&
      run31Grant.grant_revoked_at === null &&
      run31Grant.exact_plan &&
      run31Grant.exact_subscription &&
      run31Grant.exact_allocation &&
      run31Grant.exact_grant &&
      run31Grant.consent_purpose === 'founding_household_service_beta' &&
      run31Grant.consent_version === foundingHouseholdProductionServiceConsentVersion &&
      run31Grant.consent_state === 'active' &&
      run31Grant.consent_revoked_at === null,
    'Run 3.1 enrollment lost its exact identity, session, or sponsored entitlement lineage',
  );

  const run31QuotaSafetyWindowSeconds = 60;
  const run31SecondsUntilNextHour = async (): Promise<number> => {
    const result = await database.query<
      { readonly seconds_remaining: number } & Record<string, unknown>
    >(
      `WITH authority AS MATERIALIZED (
         SELECT clock_timestamp() AS authority_now
       )
       SELECT floor(extract(epoch FROM (
         date_trunc('hour', authority_now) + interval '1 hour' - authority_now
       )))::integer AS seconds_remaining
       FROM authority`,
    );
    const secondsRemaining = result.rows[0]?.seconds_remaining;
    invariant(
      secondsRemaining !== undefined && secondsRemaining >= 0 && secondsRemaining <= 3_600,
      'Run 3.1 PostgreSQL quota clock preflight is unavailable',
    );
    return secondsRemaining;
  };
  const run31InitialQuotaWindow = await run31SecondsUntilNextHour();
  if (run31InitialQuotaWindow < run31QuotaSafetyWindowSeconds) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, (run31InitialQuotaWindow + 1) * 1_000);
    });
  }
  invariant(
    (await run31SecondsUntilNextHour()) >= run31QuotaSafetyWindowSeconds,
    'Run 3.1 PostgreSQL quota verification requires one safe database-clock hour window',
  );

  const run31FeedbackRequests = Array.from({ length: 21 }, (_unused, index) => ({
    request: {
      operationKey: `feedback:${randomUUID()}`,
      text: `Run 3.1 PostgreSQL authenticated feedback quota attempt ${index + 1}.`,
      feedbackType: 'product_feedback',
      source: { surface: 'in_app_contextual', deviceClass: 'desktop' },
      link: { permitted: false },
      followUp: { granted: false },
      researchRetention: { granted: false },
    } satisfies FeedbackIntakeRequest,
    correlationId: `correlation:run31-feedback-${index + 1}-${suffix}`,
  }));
  const run31FeedbackAttempts = await Promise.allSettled(
    run31FeedbackRequests.map(({ request, correlationId }) =>
      run31Feedback.createAuthenticated({
        householdId: run31Customer.householdId,
        actorPersonId: run31Customer.personId,
        request,
        correlationId,
        evidenceTier: 'live_production',
        now: base,
      }),
    ),
  );
  const run31RejectedFeedback = run31FeedbackAttempts.find(({ status }) => status === 'rejected');
  invariant(
    run31FeedbackAttempts.filter(({ status }) => status === 'fulfilled').length === 20 &&
      run31FeedbackAttempts.filter(({ status }) => status === 'rejected').length === 1 &&
      run31RejectedFeedback?.status === 'rejected' &&
      run31RejectedFeedback.reason instanceof DomainError &&
      run31RejectedFeedback.reason.code === 'conflict' &&
      run31RejectedFeedback.reason.message === 'Live feedback hourly intake quota is exhausted',
    'Concurrent Run 3.1 authenticated feedback did not enforce the exact person quota',
  );
  const run31ReplayIndex = run31FeedbackAttempts.findIndex(({ status }) => status === 'fulfilled');
  const run31ReplayInput = run31FeedbackRequests[run31ReplayIndex];
  invariant(run31ReplayInput !== undefined, 'Run 3.1 feedback replay fixture is unavailable');
  const run31Replay = await run31Feedback.createAuthenticated({
    householdId: run31Customer.householdId,
    actorPersonId: run31Customer.personId,
    request: run31ReplayInput.request,
    correlationId: run31ReplayInput.correlationId,
    evidenceTier: 'live_production',
    now: base,
  });
  invariant(run31Replay.reused, 'Run 3.1 exact feedback replay consumed quota again');

  const run31FeedbackEvidence = await database.query<
    {
      readonly charge_buckets: number;
      readonly charges: number;
      readonly household_quota: number;
      readonly operations: number;
      readonly person_quota: number;
      readonly processing_tier_mismatches: number;
      readonly records: number;
      readonly state_tier_mismatches: number;
    } & Record<string, unknown>
  >(
    `SELECT
       (SELECT count(*)::integer FROM feedback_records
        WHERE household_id = $1 AND actor_person_id = $2
          AND evidence_tier = 'live_production') AS records,
       (SELECT count(*)::integer FROM feedback_intake_operations operation
        JOIN feedback_authenticated_quota_charges charge
          ON charge.operation_key = operation.operation_key
        WHERE charge.household_id = $1 AND charge.person_id = $2
          AND operation.feedback_id IS NOT NULL AND operation.completed_at IS NOT NULL)
         AS operations,
       (SELECT count(*)::integer FROM feedback_authenticated_quota_charges
        WHERE household_id = $1 AND person_id = $2) AS charges,
       (SELECT count(DISTINCT bucket_starts_at)::integer
        FROM feedback_authenticated_quota_charges
        WHERE household_id = $1 AND person_id = $2) AS charge_buckets,
       (SELECT coalesce(sum(accepted_count),0)::integer
        FROM feedback_authenticated_quota_buckets
        WHERE scope_kind = 'person' AND scope_id = $2) AS person_quota,
       (SELECT coalesce(sum(accepted_count),0)::integer
        FROM feedback_authenticated_quota_buckets
        WHERE scope_kind = 'household' AND scope_id = $1) AS household_quota,
       (SELECT count(*)::integer
        FROM feedback_state_events state_event
        JOIN feedback_records record ON record.id = state_event.feedback_id
        WHERE record.household_id = $1 AND record.actor_person_id = $2
          AND state_event.evidence_tier <> record.evidence_tier) AS state_tier_mismatches,
       (SELECT count(*)::integer
        FROM feedback_processing_jobs processing_job
        JOIN feedback_records record ON record.id = processing_job.feedback_id
        WHERE record.household_id = $1 AND record.actor_person_id = $2
          AND processing_job.evidence_tier <> record.evidence_tier)
         AS processing_tier_mismatches`,
    [run31Customer.householdId, run31Customer.personId],
  );
  invariant(
    run31FeedbackEvidence.rows[0]?.records === 20 &&
      run31FeedbackEvidence.rows[0]?.operations === 20 &&
      run31FeedbackEvidence.rows[0]?.charges === 20 &&
      run31FeedbackEvidence.rows[0]?.charge_buckets === 1 &&
      run31FeedbackEvidence.rows[0]?.person_quota === 20 &&
      run31FeedbackEvidence.rows[0]?.household_quota === 20 &&
      run31FeedbackEvidence.rows[0]?.state_tier_mismatches === 0 &&
      run31FeedbackEvidence.rows[0]?.processing_tier_mismatches === 0,
    'Run 3.1 feedback quota race left partial, duplicate, or over-limit durable evidence',
  );

  process.stdout.write(
    'Real PostgreSQL migrations, founder provisioning, budget and Stripe dispatch concurrency, locking, lease/reclaim/heartbeat ownership, duplicate receipts, ordering, retry/dead-letter/audited replay, shutdown, outbox, reconciliation-intent persistence, and Run 3.1 production-schema identity/bootstrap, Founding enrollment/grant, and authenticated feedback quota semantics passed.\n',
  );
} finally {
  await database.close();
}

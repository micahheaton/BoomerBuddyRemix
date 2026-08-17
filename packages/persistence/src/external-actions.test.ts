import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AutomationBudgetRepository } from './automation-budget';
import { BusinessOsRepository } from './business-os';
import { createPGliteDatabase, type Database } from './database';
import {
  ExternalActionRepository,
  type ExternalActionClass,
  type ExternalActionDispatchCapability,
} from './external-actions';
import { runMigrations } from './migrations';
import type { IdFactory } from './values';

let now = new Date();
const ownerPersonId = 'person-external-action-owner';
const agentKey = 'external_action_agent';
const automationActionKey = 'create_internal_task';
const automationToolKey = 'hq';
const originId = 'outbox-external-action-origin';

function evidenceDigest(value: string): string {
  return createHmac('sha256', Buffer.alloc(32, 61)).update(value).digest('base64url');
}

function sequentialIds(): IdFactory {
  let value = 0;
  return { next: (prefix) => `${prefix}_${String((value += 1)).padStart(4, '0')}` };
}

describe('external action effectively-once foundation', () => {
  let database: Database;
  let repository: ExternalActionRepository;
  let budgets: AutomationBudgetRepository;
  let businessOs: BusinessOsRepository;
  let policyId: string;

  const context = (suffix: string, at = now) => ({
    actorPersonId: ownerPersonId,
    audience: 'hq' as const,
    correlationId: `external-action-${suffix}`,
    now: at,
  });

  beforeEach(async () => {
    database = await createPGliteDatabase();
    await runMigrations(database);
    const databaseClock = await database.query<
      { authority_now: unknown } & Record<string, unknown>
    >('SELECT clock_timestamp() AS authority_now');
    now = new Date(String(databaseClock.rows[0]?.authority_now));
    await database.query('INSERT INTO persons(id, display_name, created_at) VALUES ($1,$2,$3)', [
      ownerPersonId,
      'External Action Owner',
      now.toISOString(),
    ]);
    await database.query(
      `INSERT INTO organizations(id, name, kind, verification_state, created_at)
       VALUES ('organization-external-action-internal','External Action Internal',
               'internal','local_fixture',$1)`,
      [now.toISOString()],
    );
    await database.query(
      `INSERT INTO employee_assignments(
         id, person_id, organization_id, role, status, created_at
       ) VALUES ('assignment-external-action-owner',$1,
                 'organization-external-action-internal','hq_owner','active',$2)`,
      [ownerPersonId, now.toISOString()],
    );
    await database.query(
      `INSERT INTO outbox_events(
         id, event_type, event_version, aggregate_type, aggregate_id, actor_person_id,
         correlation_id, classification, payload, occurred_at, available_at,
         next_attempt_at, attempts
       ) VALUES (
         $1,'external.action.intent.v1',1,'company','global',$2,
         'external-action-origin-correlation','internal','{}',$3,$3,$3,0
       )`,
      [originId, ownerPersonId, now.toISOString()],
    );
    businessOs = new BusinessOsRepository(database, undefined, ownerPersonId);
    budgets = new AutomationBudgetRepository(
      database,
      sequentialIds(),
      ownerPersonId,
      async (_transaction, observedAt) => observedAt,
    );
    repository = new ExternalActionRepository(
      database,
      sequentialIds(),
      ownerPersonId,
      async (_transaction, observedAt) => observedAt,
    );
    policyId = await businessOs.putAutomationPolicy({
      approvedByPersonId: ownerPersonId,
      correlationId: 'external-action-policy',
      now,
      policy: {
        action: automationActionKey,
        allowedDataClasses: ['public'],
        allowedTools: [automationToolKey],
        autonomy: 'auto',
        enabled: true,
        maxCostPerOperationCents: 100,
        requiresAudit: true,
      },
    });
    const caps = [
      { periodKind: 'day' as const, scopeKind: 'company' as const, scopeKey: 'global' },
      { periodKind: 'month' as const, scopeKind: 'company' as const, scopeKey: 'global' },
      { periodKind: 'day' as const, scopeKind: 'agent' as const, scopeKey: agentKey },
      {
        periodKind: 'day' as const,
        scopeKind: 'action' as const,
        scopeKey: automationActionKey,
      },
      { periodKind: 'day' as const, scopeKind: 'tool' as const, scopeKey: automationToolKey },
      { periodKind: 'month' as const, scopeKind: 'policy' as const, scopeKey: policyId },
    ];
    for (const [index, cap] of caps.entries()) {
      await budgets.putCap({
        approvedByPersonId: ownerPersonId,
        context: context(`cap-${index}`),
        enabled: true,
        limitCents: 100,
        ...cap,
      });
    }
    for (const rule of [
      {
        actionClass: 'email' as const,
        providerKey: 'mail-reviewed',
        providerSupportsIdempotency: true,
      },
      {
        actionClass: 'sms' as const,
        providerKey: 'sms-nonidem',
        providerSupportsIdempotency: false,
      },
      {
        actionClass: 'refund' as const,
        providerKey: 'refund-reviewed',
        providerSupportsIdempotency: true,
      },
      {
        actionClass: 'paid_tool' as const,
        providerKey: 'paid-tool-reviewed',
        providerSupportsIdempotency: true,
      },
    ]) {
      await repository.putProviderAcceptanceRule({
        ...rule,
        context: context(`rule-${rule.providerKey}`),
        enabled: true,
        ...(rule.providerSupportsIdempotency
          ? { idempotencyKeyDerivationVersion: 'bb-operation-sha256-v1' }
          : {}),
        providerAccountDigest: evidenceDigest(`provider-account:${rule.providerKey}`),
        providerResponseState: 'accepted',
      });
    }
    await businessOs.setGlobalAutomationKillSwitch({
      correlationId: 'external-action-clear-stop',
      killSwitch: false,
      now,
      updatedByPersonId: ownerPersonId,
    });
  });

  afterEach(async () => database.close());

  type ExternalActionFixtureInput = {
    readonly actionClass: ExternalActionClass;
    readonly costUpperBoundCents: number;
    readonly maxAttempts?: number;
    readonly operationId: string;
    readonly providerKey: string;
    readonly providerSupportsIdempotency: boolean;
    readonly reservationTtlMs?: number;
  };

  async function reserveExternalBudget(input: ExternalActionFixtureInput) {
    const reserved = await budgets.reserve({
      agentKey,
      context: context(`reserve-${input.operationId}`),
      operationKey: input.operationId,
      request: {
        action: automationActionKey,
        dataClasses: ['public'],
        estimatedCostCents: input.costUpperBoundCents,
        tool: automationToolKey,
      },
      ttlMs: input.reservationTtlMs ?? 60_000,
    });
    if (!reserved.allowed) throw new Error('External action fixture reservation failed');
    return reserved.reservation;
  }

  async function reserveAndPrepareRegistration(input: ExternalActionFixtureInput) {
    const reservation = await reserveExternalBudget(input);
    const exposureAuthority = await repository.authorizeLocalFixtureExposure({
      actionClass: input.actionClass,
      budgetReservationId: reservation.id,
      context: context(`exposure-${input.operationId}`),
      costSourceKey: 'reviewed_price_catalog',
      costSourceVersion: 'catalog_v1',
      operationId: input.operationId,
      providerAccountDigest: evidenceDigest(`provider-account:${input.providerKey}`),
      providerKey: input.providerKey,
    });
    const registration = {
      actionClass: input.actionClass,
      automationActionKey,
      automationToolKey,
      budgetReservationId: reservation.id,
      context: context(`register-${input.operationId}`),
      exposureAuthority,
      intentFingerprint: evidenceDigest(`intent:${input.operationId}`),
      maxAttempts: input.maxAttempts ?? 3,
      operationId: input.operationId,
      originId,
      originKind: 'outbox_event' as const,
      providerKey: input.providerKey,
      scopeId: 'global',
      scopeKind: 'company' as const,
    };
    return { registration, reservation };
  }

  async function reserveAndRegister(input: Parameters<typeof reserveAndPrepareRegistration>[0]) {
    const fixture = await reserveAndPrepareRegistration(input);
    const action = await repository.register(fixture.registration);
    return { action, ...fixture };
  }

  async function recheck(reservationId: string, at: Date) {
    const result = await budgets.recheckBeforeIrreversibleExecution({
      context: context(`recheck-${reservationId}`, at),
      reservationId,
    });
    if (!result.allowed)
      throw new Error(`External action fixture recheck failed: ${result.reason}`);
    return result;
  }

  async function authorizeOrigin(workerId: string, at: Date) {
    const leaseExpiresAt = new Date(at.getTime() + 10 * 60_000);
    await database.query(
      `UPDATE outbox_events
       SET lease_owner = $2, lease_expires_at = $3, heartbeat_at = $1
       WHERE id = $4 AND processed_at IS NULL AND dead_lettered_at IS NULL`,
      [at.toISOString(), workerId, leaseExpiresAt.toISOString(), originId],
    );
    return repository.authorizeOriginLease({
      now: at,
      originId,
      originKind: 'outbox_event',
      scopeId: 'global',
      scopeKind: 'company',
      workerId,
    });
  }

  const costEvidence = (
    value: string,
    actualFinancialExposureCents: number,
    budgetMagnitudeKind:
      'provider_cost' | 'refund_principal' | 'credit_principal' = 'provider_cost',
  ) => ({
    actualFinancialExposureCents,
    budgetMagnitudeKind,
    currency: 'USD' as const,
    digest: evidenceDigest(`cost:${value}`),
    evidenceLevel: 'local_fixture' as const,
    reference: `cost-evidence:${value}`,
    sourceKey: 'reviewed_price_catalog',
    sourceVersion: 'catalog_v1',
  });

  const reconciliationEvidence = (
    kind: 'provider_query' | 'provider_webhook' | 'operator_review',
    value: string,
    observedAt: Date,
    providerKey: string,
  ) => ({
    digest: evidenceDigest(`reconciliation:${value}`),
    kind,
    observedAt,
    providerAccountDigest: evidenceDigest(`provider-account:${providerKey}`),
    providerKey,
    reference: `reconciliation-evidence:${value}`,
  });

  it('binds even zero-cost actions to an exact immutable budget, scope, origin, and actor envelope', async () => {
    const fixture = await reserveAndRegister({
      actionClass: 'email',
      costUpperBoundCents: 0,
      operationId: 'email:company:zero-cost-notice',
      providerKey: 'mail-reviewed',
      providerSupportsIdempotency: true,
    });
    expect(fixture.action).toMatchObject({
      budgetReservationId: fixture.reservation.id,
      financialExposureUpperBoundCents: 0,
      effectState: 'not_dispatched',
      originId,
      registeredByPersonId: ownerPersonId,
      scopeId: 'global',
      state: 'pending',
    });
    await expect(repository.register(fixture.registration)).resolves.toEqual(fixture.action);
    await expect(
      repository.register({
        ...fixture.registration,
        exposureAuthority: {
          ...fixture.registration.exposureAuthority,
          costSourceVersion: 'catalog_v2',
        },
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      repository.register({
        ...fixture.registration,
        context: context('same-operation-fresh-correlation', new Date(now.getTime() + 1)),
      }),
    ).resolves.toEqual(fixture.action);
    await expect(
      repository.find({
        operationId: fixture.action.operationId,
        scopeId: 'wrong-company',
        scopeKind: 'organization',
      }),
    ).resolves.toBeNull();
    await expect(
      database.query(
        `UPDATE external_actions SET scope_id = 'changed'
         WHERE operation_id = $1`,
        [fixture.action.operationId],
      ),
    ).rejects.toThrow('immutable');
    await expect(
      database.query('DELETE FROM external_actions WHERE operation_id = $1', [
        fixture.action.operationId,
      ]),
    ).rejects.toThrow('cannot be deleted');
    const columns = await database.query<{ column_name: string } & Record<string, unknown>>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name IN ('external_actions', 'external_action_attempts')`,
    );
    expect(columns.rows.map((row) => row.column_name)).not.toEqual(
      expect.arrayContaining(['payload', 'content', 'message', 'destination', 'token', 'secret']),
    );
  });

  it('claims once, rejects forged capabilities/arbitrary provider states, and commits late accepted cost truth', async () => {
    const fixture = await reserveAndRegister({
      actionClass: 'email',
      costUpperBoundCents: 5,
      operationId: 'email:company:late-accepted-notice',
      providerKey: 'mail-reviewed',
      providerSupportsIdempotency: true,
    });
    const claimAt = new Date(now.getTime() + 100);
    await recheck(fixture.reservation.id, claimAt);
    const originAuthority = await authorizeOrigin('worker-alpha', claimAt);
    const claims = await Promise.allSettled([
      repository.claimForDispatch({
        budgetReservationId: fixture.reservation.id,
        now: claimAt,
        operationId: fixture.action.operationId,
        originAuthority,
        scopeId: 'global',
        scopeKind: 'company',
      }),
      repository.claimForDispatch({
        budgetReservationId: fixture.reservation.id,
        now: claimAt,
        operationId: fixture.action.operationId,
        originAuthority,
        scopeId: 'global',
        scopeKind: 'company',
      }),
    ]);
    const winner = claims.find(
      (result): result is PromiseFulfilledResult<ExternalActionDispatchCapability> =>
        result.status === 'fulfilled',
    );
    expect(winner).toBeDefined();
    expect(claims.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const capability = winner!.value;
    const forged = { ...capability, token: 'A'.repeat(43) } as ExternalActionDispatchCapability;
    await expect(
      repository.recordOutcomeUnknown({
        capability: forged,
        errorCode: 'forged_capability',
        now: new Date(claimAt.getTime() + 1_000),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      repository.recordProviderAccepted({
        capability,
        costEvidence: costEvidence('late-accepted', 2),
        now: new Date(claimAt.getTime() + 1_000),
        providerResponseId: 'provider-late-accepted-001',
        providerResponseState: 'queued',
      }),
    ).rejects.toThrow('not a reviewed accepted outcome');

    const acceptedAt = new Date(claimAt.getTime() + 7_000);
    await repository.recordProviderAccepted({
      capability,
      costEvidence: costEvidence('late-accepted', 2),
      now: acceptedAt,
      providerResponseId: 'provider-late-accepted-001',
      providerResponseState: 'accepted',
    });
    await expect(
      budgets.release({
        context: context('release-after-accepted', new Date(acceptedAt.getTime() + 1)),
        reasonCode: 'execution_not_started',
        reservationId: fixture.reservation.id,
      }),
    ).rejects.toThrow('cannot be released');
    const committed = await budgets.commit({
      context: context('commit-late-accepted', new Date(acceptedAt.getTime() + 1_000)),
      evidence: { kind: 'external_action', reference: fixture.action.operationId },
      reservationId: fixture.reservation.id,
    });
    expect(committed).toMatchObject({
      actualCostCents: 2,
      authorizationBreach: false,
      overrun: false,
      state: 'committed',
    });
    const acceptedAttempt = await database.query<
      {
        actual_financial_exposure_cents: number;
        provider_normalized_outcome: string;
      } & Record<string, unknown>
    >(
      `SELECT actual_financial_exposure_cents, provider_normalized_outcome
       FROM external_action_attempts
       WHERE operation_id = $1 AND event_kind = 'provider_accepted'`,
      [fixture.action.operationId],
    );
    expect(acceptedAttempt.rows[0]).toEqual({
      actual_financial_exposure_cents: 2,
      provider_normalized_outcome: 'accepted',
    });
  });

  it('requires typed evidence and owner authority while retaining canceled unknowns for later truth', async () => {
    const fixture = await reserveAndRegister({
      actionClass: 'sms',
      costUpperBoundCents: 5,
      maxAttempts: 2,
      operationId: 'sms:company:unknown-delivery',
      providerKey: 'sms-nonidem',
      providerSupportsIdempotency: false,
    });
    const firstClaimAt = new Date(now.getTime() + 100);
    await recheck(fixture.reservation.id, firstClaimAt);
    const originAuthority = await authorizeOrigin('worker-alpha', firstClaimAt);
    const first = await repository.claimForDispatch({
      budgetReservationId: fixture.reservation.id,
      now: firstClaimAt,
      operationId: fixture.action.operationId,
      originAuthority,
      scopeId: 'global',
      scopeKind: 'company',
    });
    const unknownAt = new Date(firstClaimAt.getTime() + 7_000);
    await repository.recordOutcomeUnknown({
      capability: first,
      errorCode: 'provider_timeout_after_dispatch',
      now: unknownAt,
    });
    await expect(
      budgets.release({
        context: context('release-unknown', new Date(unknownAt.getTime() + 1)),
        reasonCode: 'provider_timeout',
        reservationId: fixture.reservation.id,
      }),
    ).rejects.toThrow('must be reconciled');
    const operatorAuthority = await repository.authorizeReconciliation({
      budgetReservationId: fixture.reservation.id,
      context: context('authorize-operator-no-effect', new Date(unknownAt.getTime() + 10)),
      operationId: fixture.action.operationId,
      requestedOutcome: 'confirmed_no_effect',
      scopeId: 'global',
      scopeKind: 'company',
    });
    await expect(
      repository.reconcileUnknown({
        capability: operatorAuthority,
        evidence: reconciliationEvidence(
          'operator_review',
          'operator-no-effect',
          new Date(unknownAt.getTime() + 10),
          fixture.action.providerKey,
        ),
        now: new Date(unknownAt.getTime() + 20),
        outcome: {
          kind: 'confirmed_no_effect',
          retryAt: new Date(unknownAt.getTime() + 20),
        },
      }),
    ).rejects.toThrow('cannot rearm this action');
    await expect(
      repository.reconcileUnknown({
        capability: operatorAuthority,
        evidence: reconciliationEvidence(
          'provider_query',
          'provider-no-effect',
          new Date(unknownAt.getTime() + 10),
          fixture.action.providerKey,
        ),
        now: new Date(unknownAt.getTime() + 20),
        outcome: {
          kind: 'confirmed_no_effect',
          retryAt: new Date(unknownAt.getTime() + 20),
        },
      }),
    ).resolves.toMatchObject({ effectState: 'confirmed_no_effect', state: 'retry_wait' });

    const secondClaimAt = new Date(unknownAt.getTime() + 1_000);
    await recheck(fixture.reservation.id, secondClaimAt);
    const second = await repository.claimForDispatch({
      budgetReservationId: fixture.reservation.id,
      now: secondClaimAt,
      operationId: fixture.action.operationId,
      originAuthority,
      scopeId: 'global',
      scopeKind: 'company',
    });
    const secondUnknownAt = new Date(secondClaimAt.getTime() + 7_000);
    await repository.recordOutcomeUnknown({
      capability: second,
      errorCode: 'second_timeout_after_dispatch',
      now: secondUnknownAt,
    });
    const cancelAuthority = await repository.authorizeReconciliation({
      budgetReservationId: fixture.reservation.id,
      context: context('authorize-cancel', new Date(secondUnknownAt.getTime() + 10)),
      operationId: fixture.action.operationId,
      requestedOutcome: 'canceled',
      scopeId: 'global',
      scopeKind: 'company',
    });
    await expect(
      repository.reconcileUnknown({
        capability: cancelAuthority,
        evidence: reconciliationEvidence(
          'operator_review',
          'cancel-future-retries',
          new Date(secondUnknownAt.getTime() + 10),
          fixture.action.providerKey,
        ),
        now: new Date(secondUnknownAt.getTime() + 20),
        outcome: { kind: 'canceled' },
      }),
    ).resolves.toMatchObject({
      effectState: 'unknown',
      retrySuppressed: true,
      state: 'outcome_unknown',
    });
    const successAuthority = await repository.authorizeReconciliation({
      budgetReservationId: fixture.reservation.id,
      context: context('authorize-late-success', new Date(secondUnknownAt.getTime() + 30)),
      operationId: fixture.action.operationId,
      requestedOutcome: 'confirmed_succeeded',
      scopeId: 'global',
      scopeKind: 'company',
    });
    const confirmedAt = new Date(secondUnknownAt.getTime() + 40);
    await expect(
      repository.reconcileUnknown({
        capability: successAuthority,
        evidence: reconciliationEvidence(
          'provider_webhook',
          'late-success',
          confirmedAt,
          fixture.action.providerKey,
        ),
        now: confirmedAt,
        outcome: {
          costEvidence: costEvidence('sms-late-success', 3),
          kind: 'confirmed_succeeded',
          providerResponseId: 'provider-sms-late-success',
          providerResponseState: 'accepted',
        },
      }),
    ).resolves.toMatchObject({ effectState: 'accepted', state: 'succeeded' });
    await expect(
      budgets.commit({
        context: context('commit-sms-late-success', new Date(confirmedAt.getTime() + 1)),
        evidence: { kind: 'external_action', reference: fixture.action.operationId },
        reservationId: fixture.reservation.id,
      }),
    ).resolves.toMatchObject({ actualCostCents: 3, authorizationBreach: false });
  });

  it('moves an expired outcome lease to unknown without fresh dispatch authority and prevents sweeping it', async () => {
    const fixture = await reserveAndRegister({
      actionClass: 'paid_tool',
      costUpperBoundCents: 4,
      operationId: 'paid-tool:company:expired-outcome-lease',
      providerKey: 'paid-tool-reviewed',
      providerSupportsIdempotency: true,
      reservationTtlMs: 10_000,
    });
    const claimAt = new Date(now.getTime() + 100);
    await recheck(fixture.reservation.id, claimAt);
    const originAuthority = await authorizeOrigin('worker-alpha', claimAt);
    await repository.claimForDispatch({
      budgetReservationId: fixture.reservation.id,
      leaseMs: 1_000,
      now: claimAt,
      operationId: fixture.action.operationId,
      originAuthority,
      scopeId: 'global',
      scopeKind: 'company',
    });
    const afterExpiry = new Date(claimAt.getTime() + 10_001);
    await expect(
      repository.claimForDispatch({
        budgetReservationId: fixture.reservation.id,
        now: afterExpiry,
        operationId: fixture.action.operationId,
        originAuthority,
        scopeId: 'global',
        scopeKind: 'company',
      }),
    ).rejects.toThrow('requires reconciliation');
    await expect(
      repository.find({
        operationId: fixture.action.operationId,
        scopeId: 'global',
        scopeKind: 'company',
      }),
    ).resolves.toMatchObject({ effectState: 'unknown', state: 'outcome_unknown' });
    await expect(
      budgets.releaseExpired({ context: context('sweep-unknown', afterExpiry), limit: 10 }),
    ).resolves.toBe(0);
  });

  it('serializes release against claim so exactly one authority transition wins', async () => {
    const fixture = await reserveAndRegister({
      actionClass: 'email',
      costUpperBoundCents: 1,
      operationId: 'email:company:release-claim-race',
      providerKey: 'mail-reviewed',
      providerSupportsIdempotency: true,
    });
    const raceAt = new Date(now.getTime() + 100);
    await recheck(fixture.reservation.id, raceAt);
    const originAuthority = await authorizeOrigin('worker-race', raceAt);
    const race = await Promise.allSettled([
      budgets.release({
        context: context('release-race', raceAt),
        reasonCode: 'execution_not_started',
        reservationId: fixture.reservation.id,
      }),
      repository.claimForDispatch({
        budgetReservationId: fixture.reservation.id,
        now: raceAt,
        operationId: fixture.action.operationId,
        originAuthority,
        scopeId: 'global',
        scopeKind: 'company',
      }),
    ]);
    expect(race.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(race.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const reservation = await database.query<{ state: string } & Record<string, unknown>>(
      'SELECT state FROM automation_budget_reservations WHERE id = $1',
      [fixture.reservation.id],
    );
    const action = await repository.find({
      operationId: fixture.action.operationId,
      scopeId: 'global',
      scopeKind: 'company',
    });
    expect(
      (reservation.rows[0]?.state === 'released' && action?.state === 'pending') ||
        (reservation.rows[0]?.state === 'reserved' && action?.state === 'in_flight'),
    ).toBe(true);
  });

  it('keeps provider acceptance mappings revocable with immutable reviewed history', async () => {
    await businessOs.setGlobalAutomationKillSwitch({
      correlationId: 'external-action-engage-for-rule-revoke',
      killSwitch: true,
      now: new Date(now.getTime() + 100),
      updatedByPersonId: ownerPersonId,
    });
    const ruleId = await repository.putProviderAcceptanceRule({
      actionClass: 'email',
      context: context('disable-mail-rule', new Date(now.getTime() + 200)),
      enabled: false,
      idempotencyKeyDerivationVersion: 'bb-operation-sha256-v1',
      providerAccountDigest: evidenceDigest('provider-account:mail-reviewed'),
      providerKey: 'mail-reviewed',
      providerResponseState: 'accepted',
      providerSupportsIdempotency: true,
    });
    const rule = await database.query<
      { enabled: boolean; version: number; versions: number } & Record<string, unknown>
    >(
      `SELECT current.enabled, current.version,
         (SELECT count(*)::int FROM external_action_provider_acceptance_rule_versions history
          WHERE history.rule_id = current.id) AS versions
       FROM external_action_provider_acceptance_rules current WHERE current.id = $1`,
      [ruleId],
    );
    expect(rule.rows[0]).toEqual({ enabled: false, version: 2, versions: 2 });
    await expect(
      database.query(
        `UPDATE external_action_provider_acceptance_rule_versions
         SET enabled = true WHERE rule_id = $1`,
        [ruleId],
      ),
    ).rejects.toThrow('append-only');
  });

  it('derives idempotency only from reviewed provider/account/action metadata', async () => {
    const fixture = await reserveAndRegister({
      actionClass: 'email',
      costUpperBoundCents: 1,
      operationId: 'email:company:reviewed-provider-metadata',
      providerKey: 'mail-reviewed',
      providerSupportsIdempotency: true,
    });
    expect(fixture.action).toMatchObject({
      providerAccountDigest: evidenceDigest('provider-account:mail-reviewed'),
      providerIdempotencyKeyDerivationVersion: 'bb-operation-sha256-v1',
      providerSupportsIdempotency: true,
    });
    expect(fixture.action.providerIdempotencyKey).toMatch(
      /^bb:bb-operation-sha256-v1:[A-Za-z0-9_-]{43}$/u,
    );
    await expect(
      repository.register({
        ...fixture.registration,
        exposureAuthority: {
          ...fixture.registration.exposureAuthority,
          providerSupportsIdempotency: false,
        },
      }),
    ).rejects.toMatchObject({ code: 'conflict' });

    const unreviewed = await budgets.reserve({
      agentKey,
      context: context('reserve-unreviewed-provider'),
      operationKey: 'email:company:unreviewed-provider',
      request: {
        action: automationActionKey,
        dataClasses: ['public'],
        estimatedCostCents: 1,
        tool: automationToolKey,
      },
      ttlMs: 60_000,
    });
    if (!unreviewed.allowed) throw new Error('Unreviewed provider fixture reservation failed');
    await expect(
      repository.authorizeLocalFixtureExposure({
        actionClass: 'email',
        budgetReservationId: unreviewed.reservation.id,
        context: context('authorize-unreviewed-provider'),
        costSourceKey: 'reviewed_price_catalog',
        costSourceVersion: 'catalog_v1',
        operationId: 'email:company:unreviewed-provider',
        providerAccountDigest: evidenceDigest('provider-account:missing'),
        providerKey: 'missing-provider',
      }),
    ).rejects.toThrow('reviewed provider/account/action rule');
  });

  it('snapshots a reviewed rule at dispatch and records late truth after rule revocation', async () => {
    const dispatched = await reserveAndRegister({
      actionClass: 'email',
      costUpperBoundCents: 5,
      operationId: 'email:company:rule-snapshot-dispatched',
      providerKey: 'mail-reviewed',
      providerSupportsIdempotency: true,
    });
    const pending = await reserveAndRegister({
      actionClass: 'email',
      costUpperBoundCents: 5,
      operationId: 'email:company:rule-snapshot-pending',
      providerKey: 'mail-reviewed',
      providerSupportsIdempotency: true,
    });
    const claimAt = new Date(now.getTime() + 100);
    await recheck(dispatched.reservation.id, claimAt);
    const originAuthority = await authorizeOrigin('worker-rule-snapshot', claimAt);
    const capability = await repository.claimForDispatch({
      budgetReservationId: dispatched.reservation.id,
      now: claimAt,
      operationId: dispatched.action.operationId,
      originAuthority,
      scopeId: 'global',
      scopeKind: 'company',
    });
    await expect(
      database.query(
        `INSERT INTO external_action_attempts(
           id, operation_id, attempt, event_kind, worker_id, transition_capability_digest,
           budget_reservation_id, budget_control_version, budget_rechecked_at,
           budget_authorization_expires_at, acceptance_rule_id, acceptance_rule_version,
           occurred_at
         )
         SELECT 'external-action-duplicate-claim', operation_id, attempt, event_kind, worker_id,
                transition_capability_digest, budget_reservation_id, budget_control_version,
                budget_rechecked_at, budget_authorization_expires_at,
                acceptance_rule_id, acceptance_rule_version, occurred_at
         FROM external_action_attempts
         WHERE operation_id = $1 AND event_kind = 'claimed'`,
        [dispatched.action.operationId],
      ),
    ).rejects.toThrow(/unique|duplicate/iu);
    await businessOs.setGlobalAutomationKillSwitch({
      correlationId: 'external-action-engage-for-rule-snapshot',
      killSwitch: true,
      now: new Date(claimAt.getTime() + 10),
      updatedByPersonId: ownerPersonId,
    });
    await repository.putProviderAcceptanceRule({
      actionClass: 'email',
      context: context('revoke-after-dispatch', new Date(claimAt.getTime() + 20)),
      enabled: false,
      idempotencyKeyDerivationVersion: 'bb-operation-sha256-v1',
      providerAccountDigest: evidenceDigest('provider-account:mail-reviewed'),
      providerKey: 'mail-reviewed',
      providerResponseState: 'accepted',
      providerSupportsIdempotency: true,
    });
    await businessOs.setGlobalAutomationKillSwitch({
      correlationId: 'external-action-clear-after-rule-snapshot',
      killSwitch: false,
      now: new Date(claimAt.getTime() + 30),
      updatedByPersonId: ownerPersonId,
    });
    await recheck(pending.reservation.id, new Date(claimAt.getTime() + 40));
    await expect(
      repository.claimForDispatch({
        budgetReservationId: pending.reservation.id,
        now: new Date(claimAt.getTime() + 40),
        operationId: pending.action.operationId,
        originAuthority,
        scopeId: 'global',
        scopeKind: 'company',
      }),
    ).rejects.toThrow('reviewed provider acceptance mapping');
    await expect(
      repository.recordProviderAccepted({
        capability,
        costEvidence: costEvidence('accepted-after-rule-revocation', 2),
        now: new Date(claimAt.getTime() + 1_000),
        providerResponseId: 'provider-accepted-after-rule-revocation',
        providerResponseState: 'accepted',
      }),
    ).resolves.toBeUndefined();
    await expect(
      budgets.commit({
        context: context('commit-after-rule-revocation', new Date(claimAt.getTime() + 1_001)),
        evidence: { kind: 'external_action', reference: dispatched.action.operationId },
        reservationId: dispatched.reservation.id,
      }),
    ).resolves.toMatchObject({ actualCostCents: 2, state: 'committed' });
  });

  it('rejects stale reconciliation evidence and direct post-claim reset attempts', async () => {
    const fixture = await reserveAndRegister({
      actionClass: 'sms',
      costUpperBoundCents: 5,
      operationId: 'sms:company:stale-reconciliation-evidence',
      providerKey: 'sms-nonidem',
      providerSupportsIdempotency: false,
    });
    const claimAt = new Date(now.getTime() + 100);
    await recheck(fixture.reservation.id, claimAt);
    const originAuthority = await authorizeOrigin('worker-stale-evidence', claimAt);
    const capability = await repository.claimForDispatch({
      budgetReservationId: fixture.reservation.id,
      now: claimAt,
      operationId: fixture.action.operationId,
      originAuthority,
      scopeId: 'global',
      scopeKind: 'company',
    });
    await expect(
      database.query(
        `UPDATE external_actions
         SET state = 'retry_wait', effect_state = 'not_dispatched',
             lease_owner = NULL, lease_expires_at = NULL,
             transition_capability_digest = NULL, transition_capability_expires_at = NULL
         WHERE operation_id = $1`,
        [fixture.action.operationId],
      ),
    ).rejects.toThrow('state transition is not permitted');
    const unknownAt = new Date(claimAt.getTime() + 1_000);
    await repository.recordOutcomeUnknown({
      capability,
      errorCode: 'ambiguous_provider_timeout',
      now: unknownAt,
    });
    const authority = await repository.authorizeReconciliation({
      budgetReservationId: fixture.reservation.id,
      context: context('authorize-stale-evidence', new Date(unknownAt.getTime() + 10)),
      operationId: fixture.action.operationId,
      requestedOutcome: 'confirmed_no_effect',
      scopeId: 'global',
      scopeKind: 'company',
    });
    await expect(
      repository.reconcileUnknown({
        capability: authority,
        evidence: reconciliationEvidence(
          'provider_query',
          'pre-dispatch-query',
          new Date(claimAt.getTime() - 1),
          fixture.action.providerKey,
        ),
        now: new Date(unknownAt.getTime() + 20),
        outcome: {
          kind: 'confirmed_no_effect',
          retryAt: new Date(unknownAt.getTime() + 20),
        },
      }),
    ).rejects.toThrow('predates the unknown outcome');
  });

  it('accounts provider-confirmed runaway truth atomically and engages the stop', async () => {
    const fixture = await reserveAndRegister({
      actionClass: 'paid_tool',
      costUpperBoundCents: 5,
      operationId: 'paid-tool:company:runaway-observed-truth',
      providerKey: 'paid-tool-reviewed',
      providerSupportsIdempotency: true,
    });
    const claimAt = new Date(now.getTime() + 100);
    await recheck(fixture.reservation.id, claimAt);
    const originAuthority = await authorizeOrigin('worker-runaway-truth', claimAt);
    const capability = await repository.claimForDispatch({
      budgetReservationId: fixture.reservation.id,
      now: claimAt,
      operationId: fixture.action.operationId,
      originAuthority,
      scopeId: 'global',
      scopeKind: 'company',
    });
    await repository.recordProviderAccepted({
      capability,
      costEvidence: costEvidence('runaway-observed-truth', 100_000_001),
      now: new Date(claimAt.getTime() + 1_000),
      providerResponseId: 'provider-runaway-observed-truth',
      providerResponseState: 'accepted',
    });
    const truth = await database.query<
      {
        actual_cost_cents: number;
        authorization_breach: boolean;
        kill_switch: boolean;
        overrun_detected: boolean;
      } & Record<string, unknown>
    >(
      `SELECT reservation.actual_cost_cents, reservation.authorization_breach,
              reservation.overrun_detected, control.kill_switch
       FROM automation_budget_reservations reservation
       CROSS JOIN automation_global_control control
       WHERE reservation.id = $1 AND control.control_key = 'global'`,
      [fixture.reservation.id],
    );
    expect(truth.rows[0]).toEqual({
      actual_cost_cents: 100_000_001,
      authorization_breach: false,
      kill_switch: true,
      overrun_detected: true,
    });
    const blocked = await budgets.reserve({
      agentKey,
      context: context('reserve-after-runaway-stop', new Date(claimAt.getTime() + 1_001)),
      operationKey: 'email:company:blocked-after-runaway-stop',
      request: {
        action: automationActionKey,
        dataClasses: ['public'],
        estimatedCostCents: 0,
        tool: automationToolKey,
      },
      ttlMs: 60_000,
    });
    expect(blocked.allowed).toBe(false);
  });

  it('binds refund principal exposure to the positive reservation and accepted movement', async () => {
    const zero = await budgets.reserve({
      agentKey,
      context: context('reserve-zero-refund'),
      operationKey: 'refund:company:zero-principal-refused',
      request: {
        action: automationActionKey,
        dataClasses: ['public'],
        estimatedCostCents: 0,
        tool: automationToolKey,
      },
      ttlMs: 60_000,
    });
    if (!zero.allowed) throw new Error('Zero-refund fixture reservation failed');
    await expect(
      repository.authorizeLocalFixtureExposure({
        actionClass: 'refund',
        budgetReservationId: zero.reservation.id,
        context: context('authorize-zero-refund'),
        costSourceKey: 'reviewed_price_catalog',
        costSourceVersion: 'catalog_v1',
        operationId: 'refund:company:zero-principal-refused',
        providerAccountDigest: evidenceDigest('provider-account:refund-reviewed'),
        providerKey: 'refund-reviewed',
      }),
    ).rejects.toThrow('budget envelope is unavailable');

    const fixture = await reserveAndRegister({
      actionClass: 'refund',
      costUpperBoundCents: 10,
      operationId: 'refund:company:principal-bound',
      providerKey: 'refund-reviewed',
      providerSupportsIdempotency: true,
    });
    expect(fixture.action).toMatchObject({
      budgetMagnitudeKind: 'refund_principal',
      financialExposureUpperBoundCents: 10,
    });
    const claimAt = new Date(now.getTime() + 100);
    await recheck(fixture.reservation.id, claimAt);
    const capability = await repository.claimForDispatch({
      budgetReservationId: fixture.reservation.id,
      now: claimAt,
      operationId: fixture.action.operationId,
      originAuthority: await authorizeOrigin('worker-refund-principal', claimAt),
      scopeId: 'global',
      scopeKind: 'company',
    });
    await expect(
      repository.recordProviderAccepted({
        capability,
        costEvidence: costEvidence('refund-fee-only-mismatch', 1, 'provider_cost'),
        now: new Date(claimAt.getTime() + 1_000),
        providerResponseId: 'provider-refund-principal',
        providerResponseState: 'accepted',
      }),
    ).rejects.toThrow('does not match its envelope');
    await repository.recordProviderAccepted({
      capability,
      costEvidence: costEvidence('refund-principal-accepted', 7, 'refund_principal'),
      now: new Date(claimAt.getTime() + 1_001),
      providerResponseId: 'provider-refund-principal',
      providerResponseState: 'accepted',
    });
    await expect(
      budgets.commit({
        context: context('commit-refund-principal', new Date(claimAt.getTime() + 1_002)),
        evidence: { kind: 'external_action', reference: fixture.action.operationId },
        reservationId: fixture.reservation.id,
      }),
    ).resolves.toMatchObject({ actualCostCents: 7, overrun: false, state: 'committed' });
  });

  it('requires a current internal owner organization for exposure issuance and registration', async () => {
    await database.query(
      `INSERT INTO organizations(id, name, kind, verification_state, created_at)
       VALUES ('organization-external-action-sponsor','External Action Sponsor',
               'sponsor','local_fixture',$1)`,
      [now.toISOString()],
    );
    const authorityInput = {
      actionClass: 'email' as const,
      costUpperBoundCents: 2,
      operationId: 'email:company:owner-exposure-authority',
      providerKey: 'mail-reviewed',
      providerSupportsIdempotency: true,
    };
    const reservation = await reserveExternalBudget(authorityInput);
    const authorizeExposure = () =>
      repository.authorizeLocalFixtureExposure({
        actionClass: authorityInput.actionClass,
        budgetReservationId: reservation.id,
        context: context('owner-exposure-authority'),
        costSourceKey: 'reviewed_price_catalog',
        costSourceVersion: 'catalog_v1',
        operationId: authorityInput.operationId,
        providerAccountDigest: evidenceDigest('provider-account:mail-reviewed'),
        providerKey: authorityInput.providerKey,
      });

    await database.query(
      `UPDATE employee_assignments SET organization_id = NULL
       WHERE id = 'assignment-external-action-owner'`,
    );
    await expect(authorizeExposure()).rejects.toMatchObject({ code: 'conflict' });
    await database.query(
      `UPDATE employee_assignments
       SET organization_id = 'organization-external-action-sponsor'
       WHERE id = 'assignment-external-action-owner'`,
    );
    await expect(authorizeExposure()).rejects.toMatchObject({ code: 'conflict' });
    const deniedAuthorizations = await database.query<{ total: number } & Record<string, unknown>>(
      `SELECT count(*)::int AS total FROM external_action_exposure_authorizations
       WHERE operation_id = $1`,
      [authorityInput.operationId],
    );
    expect(deniedAuthorizations.rows[0]?.total).toBe(0);

    await database.query(
      `INSERT INTO employee_assignments(
         id, person_id, organization_id, role, status, created_at
       ) VALUES ('assignment-external-action-owner-internal-secondary',$1,
                 'organization-external-action-internal','hq_owner','active',$2)`,
      [ownerPersonId, now.toISOString()],
    );
    const exposureAuthority = await authorizeExposure();
    const dualRegistration = {
      actionClass: authorityInput.actionClass,
      automationActionKey,
      automationToolKey,
      budgetReservationId: reservation.id,
      context: context('owner-dual-assignment-registration'),
      exposureAuthority,
      intentFingerprint: evidenceDigest(`intent:${authorityInput.operationId}`),
      maxAttempts: 3,
      operationId: authorityInput.operationId,
      originId,
      originKind: 'outbox_event' as const,
      providerKey: authorityInput.providerKey,
      scopeId: 'global',
      scopeKind: 'company' as const,
    };
    await expect(repository.register(dualRegistration)).resolves.toMatchObject({
      operationId: authorityInput.operationId,
      registeredByPersonId: ownerPersonId,
    });
    await database.query(
      "DELETE FROM employee_assignments WHERE id = 'assignment-external-action-owner'",
    );

    const mutationFixture = await reserveAndPrepareRegistration({
      ...authorityInput,
      operationId: 'email:company:owner-registration-mutations',
    });
    const assertRegistrationDenied = async (
      suffix: string,
      mutate: () => Promise<unknown>,
      restore: () => Promise<unknown>,
    ): Promise<void> => {
      await mutate();
      await expect(
        repository.register({
          ...mutationFixture.registration,
          context: context(`owner-registration-${suffix}`),
        }),
      ).rejects.toMatchObject({ code: 'conflict' });
      const state = await database.query<
        { actions: number; used_at: unknown | null } & Record<string, unknown>
      >(
        `SELECT
           (SELECT count(*)::int FROM external_actions WHERE operation_id = $1) AS actions,
           used_at
         FROM external_action_exposure_authorizations WHERE id = $2`,
        [
          mutationFixture.registration.operationId,
          mutationFixture.registration.exposureAuthority.authorizationId,
        ],
      );
      expect(state.rows[0]).toMatchObject({ actions: 0, used_at: null });
      await restore();
    };
    const secondaryAssignment = 'assignment-external-action-owner-internal-secondary';
    await assertRegistrationDenied(
      'null-organization',
      () =>
        database.query('UPDATE employee_assignments SET organization_id = NULL WHERE id = $1', [
          secondaryAssignment,
        ]),
      () =>
        database.query(
          `UPDATE employee_assignments
           SET organization_id = 'organization-external-action-internal' WHERE id = $1`,
          [secondaryAssignment],
        ),
    );
    await assertRegistrationDenied(
      'organization-kind',
      () =>
        database.query(
          "UPDATE organizations SET kind = 'sponsor' WHERE id = 'organization-external-action-internal'",
        ),
      () =>
        database.query(
          "UPDATE organizations SET kind = 'internal' WHERE id = 'organization-external-action-internal'",
        ),
    );
    await assertRegistrationDenied(
      'suspended-assignment',
      () =>
        database.query("UPDATE employee_assignments SET status = 'suspended' WHERE id = $1", [
          secondaryAssignment,
        ]),
      () =>
        database.query("UPDATE employee_assignments SET status = 'active' WHERE id = $1", [
          secondaryAssignment,
        ]),
    );
    await assertRegistrationDenied(
      'repointed-assignment',
      () =>
        database.query(
          `UPDATE employee_assignments
           SET organization_id = 'organization-external-action-sponsor' WHERE id = $1`,
          [secondaryAssignment],
        ),
      () =>
        database.query(
          `UPDATE employee_assignments
           SET organization_id = 'organization-external-action-internal' WHERE id = $1`,
          [secondaryAssignment],
        ),
    );

    const race = await Promise.allSettled([
      repository.register({
        ...mutationFixture.registration,
        context: context('owner-registration-race'),
      }),
      database.query(
        "UPDATE organizations SET kind = 'sponsor' WHERE id = 'organization-external-action-internal'",
      ),
    ]);
    expect(race[1]?.status).toBe('fulfilled');
    const raceState = await database.query<
      { actions: number; used: number } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::int FROM external_actions WHERE operation_id = $1) AS actions,
         (SELECT count(*)::int FROM external_action_exposure_authorizations
          WHERE id = $2 AND used_at IS NOT NULL) AS used`,
      [
        mutationFixture.registration.operationId,
        mutationFixture.registration.exposureAuthority.authorizationId,
      ],
    );
    expect(raceState.rows[0]).toEqual({
      actions: race[0]?.status === 'fulfilled' ? 1 : 0,
      used: race[0]?.status === 'fulfilled' ? 1 : 0,
    });
    await expect(
      repository.register({
        ...mutationFixture.registration,
        context: context('owner-registration-after-race'),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('rechecks the locked internal owner organization when reconciliation authority is issued and consumed', async () => {
    const fixture = await reserveAndRegister({
      actionClass: 'email',
      costUpperBoundCents: 2,
      operationId: 'email:company:owner-reconciliation-authority',
      providerKey: 'mail-reviewed',
      providerSupportsIdempotency: true,
    });
    const claimAt = new Date(now.getTime() + 100);
    await recheck(fixture.reservation.id, claimAt);
    const capability = await repository.claimForDispatch({
      budgetReservationId: fixture.reservation.id,
      now: claimAt,
      operationId: fixture.action.operationId,
      originAuthority: await authorizeOrigin('worker-owner-reconciliation', claimAt),
      scopeId: 'global',
      scopeKind: 'company',
    });
    const unknownAt = new Date(claimAt.getTime() + 7_000);
    await repository.recordOutcomeUnknown({
      capability,
      errorCode: 'owner_reconciliation_unknown',
      now: unknownAt,
    });
    await database.query(
      `INSERT INTO organizations(id, name, kind, verification_state, created_at)
       VALUES ('organization-external-action-sponsor','External Action Sponsor',
               'sponsor','local_fixture',$1)`,
      [now.toISOString()],
    );
    const authorizeReconciliation = () =>
      repository.authorizeReconciliation({
        budgetReservationId: fixture.reservation.id,
        context: context('owner-reconciliation-authorization', new Date(unknownAt.getTime() + 10)),
        operationId: fixture.action.operationId,
        requestedOutcome: 'still_unknown',
        scopeId: 'global',
        scopeKind: 'company',
      });

    await database.query(
      `UPDATE employee_assignments SET organization_id = NULL
       WHERE id = 'assignment-external-action-owner'`,
    );
    await expect(authorizeReconciliation()).rejects.toMatchObject({ code: 'not_authorized' });
    await database.query(
      `UPDATE employee_assignments
       SET organization_id = 'organization-external-action-sponsor'
       WHERE id = 'assignment-external-action-owner'`,
    );
    await expect(authorizeReconciliation()).rejects.toMatchObject({ code: 'not_authorized' });
    const deniedAuthorizations = await database.query<{ total: number } & Record<string, unknown>>(
      `SELECT count(*)::int AS total FROM external_action_reconciliation_authorizations
       WHERE operation_id = $1`,
      [fixture.action.operationId],
    );
    expect(deniedAuthorizations.rows[0]?.total).toBe(0);
    await database.query(
      `INSERT INTO employee_assignments(
         id, person_id, organization_id, role, status, created_at
       ) VALUES ('assignment-external-action-owner-internal-secondary',$1,
                 'organization-external-action-internal','hq_owner','active',$2)`,
      [ownerPersonId, now.toISOString()],
    );
    const reconciliationAuthority = await authorizeReconciliation();
    await database.query(
      `UPDATE employee_assignments SET organization_id = NULL
       WHERE id = 'assignment-external-action-owner'`,
    );
    const secondaryAssignment = 'assignment-external-action-owner-internal-secondary';
    let evidenceSequence = 0;
    const reconcile = () => {
      const sequence = (evidenceSequence += 1);
      const observedAt = new Date(unknownAt.getTime() + 20 + sequence);
      return repository.reconcileUnknown({
        capability: reconciliationAuthority,
        evidence: reconciliationEvidence(
          'provider_query',
          `owner-authority-${sequence}`,
          observedAt,
          fixture.action.providerKey,
        ),
        now: observedAt,
        outcome: { errorCode: 'owner_authority_still_unknown', kind: 'still_unknown' },
      });
    };
    const assertReconciliationDenied = async (
      mutate: () => Promise<unknown>,
      restore: () => Promise<unknown>,
    ): Promise<void> => {
      await mutate();
      await expect(reconcile()).rejects.toMatchObject({ code: 'conflict' });
      const evidence = await database.query<
        { attempts: number; used_at: unknown | null } & Record<string, unknown>
      >(
        `SELECT
           (SELECT count(*)::int FROM external_action_attempts
            WHERE operation_id = $1 AND event_kind = 'reconciliation_still_unknown') AS attempts,
           used_at
         FROM external_action_reconciliation_authorizations WHERE id = $2`,
        [fixture.action.operationId, reconciliationAuthority.authorizationId],
      );
      expect(evidence.rows[0]).toMatchObject({ attempts: 0, used_at: null });
      await restore();
    };
    await assertReconciliationDenied(
      () =>
        database.query('UPDATE employee_assignments SET organization_id = NULL WHERE id = $1', [
          secondaryAssignment,
        ]),
      () =>
        database.query(
          `UPDATE employee_assignments
           SET organization_id = 'organization-external-action-internal' WHERE id = $1`,
          [secondaryAssignment],
        ),
    );
    await assertReconciliationDenied(
      () =>
        database.query(
          "UPDATE organizations SET kind = 'sponsor' WHERE id = 'organization-external-action-internal'",
        ),
      () =>
        database.query(
          "UPDATE organizations SET kind = 'internal' WHERE id = 'organization-external-action-internal'",
        ),
    );
    await assertReconciliationDenied(
      () =>
        database.query("UPDATE employee_assignments SET status = 'suspended' WHERE id = $1", [
          secondaryAssignment,
        ]),
      () =>
        database.query("UPDATE employee_assignments SET status = 'active' WHERE id = $1", [
          secondaryAssignment,
        ]),
    );
    await assertReconciliationDenied(
      () =>
        database.query(
          `UPDATE employee_assignments
           SET organization_id = 'organization-external-action-sponsor' WHERE id = $1`,
          [secondaryAssignment],
        ),
      () =>
        database.query(
          `UPDATE employee_assignments
           SET organization_id = 'organization-external-action-internal' WHERE id = $1`,
          [secondaryAssignment],
        ),
    );

    await database.query(
      `UPDATE employee_assignments
       SET organization_id = 'organization-external-action-sponsor'
       WHERE id = 'assignment-external-action-owner'`,
    );
    await expect(reconcile()).resolves.toMatchObject({
      effectState: 'unknown',
      state: 'outcome_unknown',
    });
    const consumedEvidence = await database.query<
      { attempts: number; used: number } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::int FROM external_action_attempts
          WHERE operation_id = $1 AND event_kind = 'reconciliation_still_unknown') AS attempts,
         (SELECT count(*)::int FROM external_action_reconciliation_authorizations
          WHERE id = $2 AND used_at IS NOT NULL) AS used`,
      [fixture.action.operationId, reconciliationAuthority.authorizationId],
    );
    expect(consumedEvidence.rows[0]).toEqual({ attempts: 1, used: 1 });
    await expect(reconcile()).rejects.toMatchObject({ code: 'conflict' });
  });

  it('rejects direct-SQL owner and registration bypasses without consuming authority', async () => {
    await database.query(
      `INSERT INTO organizations(id, name, kind, verification_state, created_at)
       VALUES ('organization-external-action-sponsor','External Action Sponsor',
               'sponsor','local_fixture',$1)`,
      [now.toISOString()],
    );
    await database.query(
      `UPDATE employee_assignments SET organization_id = NULL
       WHERE id = 'assignment-external-action-owner'`,
    );
    await expect(
      database.query(
        `INSERT INTO external_action_provider_acceptance_rules(
           id, provider_key, provider_account_digest, action_class,
           provider_response_state, normalized_outcome, provider_supports_idempotency,
           idempotency_key_derivation_version, enabled, version,
           reviewed_by_person_id, reviewed_at, updated_at
         ) VALUES (
           'direct-owner-rule-bypass','direct-owner-provider',$1,'email',
           'accepted','accepted',false,NULL,true,1,$2,$3,$3
         )`,
        [
          evidenceDigest('provider-account:direct-owner-provider'),
          ownerPersonId,
          now.toISOString(),
        ],
      ),
    ).rejects.toThrow('External action owner authority is unavailable');
    await database.query(
      `UPDATE employee_assignments
       SET organization_id = 'organization-external-action-internal'
       WHERE id = 'assignment-external-action-owner'`,
    );

    const exposureInput = {
      actionClass: 'sms' as const,
      costUpperBoundCents: 1,
      operationId: 'sms:company:direct-owner-exposure',
      providerKey: 'sms-nonidem',
      providerSupportsIdempotency: false,
    };
    const exposureReservation = await reserveExternalBudget(exposureInput);
    await database.query(
      `UPDATE employee_assignments
       SET organization_id = 'organization-external-action-sponsor'
       WHERE id = 'assignment-external-action-owner'`,
    );
    await expect(
      database.query(
        `INSERT INTO external_action_exposure_authorizations(
           id, budget_reservation_id, operation_id, action_class, provider_key,
           provider_account_digest, provider_capability_rule_id,
           provider_capability_rule_version, provider_supports_idempotency,
           provider_idempotency_key, provider_idempotency_key_derivation_version,
           financial_exposure_upper_bound_cents, budget_magnitude_kind, cost_currency,
           cost_source_key, cost_source_version, evidence_level, capability_digest,
           authorized_by_person_id, created_at, expires_at
         )
         SELECT 'direct-owner-exposure-bypass', reservation.id, reservation.operation_key,
           'sms', rule.provider_key, rule.provider_account_digest, rule.id, rule.version,
           false, NULL, NULL, reservation.estimated_cost_cents, 'provider_cost', 'USD',
           'reviewed_price_catalog', 'catalog_v1', 'local_fixture', repeat('a',64),
           $2, $3, $4
         FROM automation_budget_reservations reservation
         JOIN external_action_provider_acceptance_rules rule
           ON rule.provider_key = 'sms-nonidem'
          AND rule.provider_account_digest = $5
          AND rule.action_class = 'sms' AND rule.enabled = true
         WHERE reservation.id = $1`,
        [
          exposureReservation.id,
          ownerPersonId,
          now.toISOString(),
          new Date(now.getTime() + 60_000).toISOString(),
          evidenceDigest('provider-account:sms-nonidem'),
        ],
      ),
    ).rejects.toThrow('External action owner authority is unavailable');
    const deniedOwnerRows = await database.query<
      { exposures: number; rules: number } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::int FROM external_action_provider_acceptance_rules
          WHERE id = 'direct-owner-rule-bypass') AS rules,
         (SELECT count(*)::int FROM external_action_exposure_authorizations
          WHERE id = 'direct-owner-exposure-bypass') AS exposures`,
    );
    expect(deniedOwnerRows.rows[0]).toEqual({ exposures: 0, rules: 0 });
    await database.query(
      `UPDATE employee_assignments
       SET organization_id = 'organization-external-action-internal'
       WHERE id = 'assignment-external-action-owner'`,
    );

    const registrationFixture = await reserveAndPrepareRegistration({
      actionClass: 'email',
      costUpperBoundCents: 1,
      operationId: 'email:company:direct-registration-authority',
      providerKey: 'mail-reviewed',
      providerSupportsIdempotency: true,
    });
    await database.query(
      `UPDATE employee_assignments
       SET organization_id = 'organization-external-action-sponsor'
       WHERE id = 'assignment-external-action-owner'`,
    );
    await expect(
      database.query(
        `INSERT INTO external_actions(
           operation_id, budget_reservation_id, exposure_authorization_id,
           budget_envelope_digest, automation_action_key, automation_tool_key,
           financial_exposure_upper_bound_cents, budget_magnitude_kind, cost_currency,
           cost_source_key, cost_source_version, exposure_evidence_level,
           scope_kind, scope_id, origin_kind, origin_id, registered_by_person_id,
           registration_audience, action_class, provider_key, provider_account_digest,
           provider_capability_rule_id, provider_capability_rule_version,
           provider_supports_idempotency, provider_idempotency_key,
           provider_idempotency_key_derivation_version, intent_fingerprint,
           state, effect_state, retry_suppressed, attempts, max_attempts,
           next_attempt_at, correlation_id, created_at, updated_at
         )
         SELECT exposure.operation_id, exposure.budget_reservation_id, exposure.id,
           reservation.envelope_digest, reservation.action_key, reservation.tool_key,
           exposure.financial_exposure_upper_bound_cents, exposure.budget_magnitude_kind,
           exposure.cost_currency, exposure.cost_source_key, exposure.cost_source_version,
           exposure.evidence_level, 'company', 'global', 'outbox_event', $3, $4, 'hq',
           exposure.action_class, exposure.provider_key, exposure.provider_account_digest,
           exposure.provider_capability_rule_id, exposure.provider_capability_rule_version,
           exposure.provider_supports_idempotency, exposure.provider_idempotency_key,
           exposure.provider_idempotency_key_derivation_version, $5,
           'pending', 'not_dispatched', false, 0, 3, $6, $7, $6, $6
         FROM external_action_exposure_authorizations exposure
         JOIN automation_budget_reservations reservation
           ON reservation.id = exposure.budget_reservation_id
         WHERE exposure.id = $1 AND reservation.id = $2`,
        [
          registrationFixture.registration.exposureAuthority.authorizationId,
          registrationFixture.reservation.id,
          originId,
          ownerPersonId,
          registrationFixture.registration.intentFingerprint,
          now.toISOString(),
          'direct-registration-authority-correlation',
        ],
      ),
    ).rejects.toThrow('External action registration authority is unavailable');
    const deniedRegistration = await database.query<
      { actions: number; used_at: unknown | null } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::int FROM external_actions WHERE operation_id = $1) AS actions,
         used_at
       FROM external_action_exposure_authorizations WHERE id = $2`,
      [
        registrationFixture.registration.operationId,
        registrationFixture.registration.exposureAuthority.authorizationId,
      ],
    );
    expect(deniedRegistration.rows[0]).toMatchObject({ actions: 0, used_at: null });
    await database.query(
      `UPDATE employee_assignments
       SET organization_id = 'organization-external-action-internal'
       WHERE id = 'assignment-external-action-owner'`,
    );

    const reconciliationFixture = await reserveAndRegister({
      actionClass: 'email',
      costUpperBoundCents: 1,
      operationId: 'email:company:direct-reconciliation-authority',
      providerKey: 'mail-reviewed',
      providerSupportsIdempotency: true,
    });
    const claimAt = new Date(now.getTime() + 100);
    await recheck(reconciliationFixture.reservation.id, claimAt);
    const dispatch = await repository.claimForDispatch({
      budgetReservationId: reconciliationFixture.reservation.id,
      now: claimAt,
      operationId: reconciliationFixture.action.operationId,
      originAuthority: await authorizeOrigin('worker-direct-reconciliation', claimAt),
      scopeId: 'global',
      scopeKind: 'company',
    });
    const unknownAt = new Date(claimAt.getTime() + 7_000);
    await repository.recordOutcomeUnknown({
      capability: dispatch,
      errorCode: 'direct_reconciliation_unknown',
      now: unknownAt,
    });
    await database.query(
      `UPDATE employee_assignments SET organization_id = NULL
       WHERE id = 'assignment-external-action-owner'`,
    );
    await expect(
      database.query(
        `INSERT INTO external_action_reconciliation_authorizations(
           id, operation_id, budget_reservation_id, scope_kind, scope_id,
           requested_outcome, capability_digest, actor_person_id, audience,
           created_at, expires_at
         ) VALUES (
           'direct-owner-reconciliation-bypass',$1,$2,'company','global',
           'still_unknown',repeat('b',64),$3,'hq',$4,$5
         )`,
        [
          reconciliationFixture.action.operationId,
          reconciliationFixture.reservation.id,
          ownerPersonId,
          unknownAt.toISOString(),
          new Date(unknownAt.getTime() + 60_000).toISOString(),
        ],
      ),
    ).rejects.toThrow('External action owner authority is unavailable');
    const deniedReconciliation = await database.query<{ total: number } & Record<string, unknown>>(
      `SELECT count(*)::int AS total FROM external_action_reconciliation_authorizations
       WHERE id = 'direct-owner-reconciliation-bypass'`,
    );
    expect(deniedReconciliation.rows[0]?.total).toBe(0);
  });

  it('requires the configured founder through a locked internal organization for provider metadata', async () => {
    const secondOwnerId = 'person-external-action-second-owner';
    await database.query('INSERT INTO persons(id, display_name, created_at) VALUES ($1,$2,$3)', [
      secondOwnerId,
      'Second HQ Owner',
      now.toISOString(),
    ]);
    await database.query(
      `INSERT INTO employee_assignments(
         id, person_id, organization_id, role, status, created_at
       ) VALUES ('assignment-external-action-second-owner',$1,
                 'organization-external-action-internal','hq_owner','active',$2)`,
      [secondOwnerId, now.toISOString()],
    );
    await businessOs.setGlobalAutomationKillSwitch({
      correlationId: 'external-action-engage-for-founder-auth',
      killSwitch: true,
      now: new Date(now.getTime() + 100),
      updatedByPersonId: ownerPersonId,
    });
    await expect(
      repository.putProviderAcceptanceRule({
        actionClass: 'email',
        context: {
          actorPersonId: secondOwnerId,
          audience: 'hq',
          correlationId: 'second-owner-provider-rule',
          now: new Date(now.getTime() + 110),
        },
        enabled: true,
        idempotencyKeyDerivationVersion: 'bb-operation-sha256-v1',
        providerAccountDigest: evidenceDigest('provider-account:second-owner-attempt'),
        providerKey: 'second-owner-provider',
        providerResponseState: 'accepted',
        providerSupportsIdempotency: true,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' });

    await database.query(
      `INSERT INTO organizations(id, name, kind, verification_state, created_at)
       VALUES ('organization-external-action-sponsor','External Action Sponsor',
               'sponsor','local_fixture',$1)`,
      [now.toISOString()],
    );
    await database.query(
      `UPDATE employee_assignments SET organization_id = NULL
       WHERE id = 'assignment-external-action-owner'`,
    );
    await expect(
      repository.putProviderAcceptanceRule({
        actionClass: 'email',
        context: context('founder-null-organization-rule', new Date(now.getTime() + 111)),
        enabled: true,
        idempotencyKeyDerivationVersion: 'bb-operation-sha256-v1',
        providerAccountDigest: evidenceDigest('provider-account:null-organization-provider'),
        providerKey: 'null-organization-provider',
        providerResponseState: 'accepted',
        providerSupportsIdempotency: true,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' });
    await database.query(
      `UPDATE employee_assignments
       SET organization_id = 'organization-external-action-sponsor'
       WHERE id = 'assignment-external-action-owner'`,
    );
    await expect(
      repository.putProviderAcceptanceRule({
        actionClass: 'email',
        context: context('founder-sponsor-organization-rule', new Date(now.getTime() + 112)),
        enabled: true,
        idempotencyKeyDerivationVersion: 'bb-operation-sha256-v1',
        providerAccountDigest: evidenceDigest('provider-account:sponsor-organization-provider'),
        providerKey: 'sponsor-organization-provider',
        providerResponseState: 'accepted',
        providerSupportsIdempotency: true,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' });
    const deniedRules = await database.query<{ total: number } & Record<string, unknown>>(
      `SELECT count(*)::int AS total
       FROM external_action_provider_acceptance_rules
       WHERE provider_key IN ('null-organization-provider','sponsor-organization-provider')`,
    );
    expect(deniedRules.rows[0]?.total).toBe(0);
    await database.query(
      `INSERT INTO employee_assignments(
         id, person_id, organization_id, role, status, created_at
       ) VALUES ('assignment-external-action-owner-internal-secondary',$1,
                 'organization-external-action-internal','hq_owner','active',$2)`,
      [ownerPersonId, now.toISOString()],
    );
    await expect(
      repository.putProviderAcceptanceRule({
        actionClass: 'email',
        context: context('founder-dual-assignment-rule', new Date(now.getTime() + 113)),
        enabled: true,
        idempotencyKeyDerivationVersion: 'bb-operation-sha256-v1',
        providerAccountDigest: evidenceDigest('provider-account:dual-assignment-provider'),
        providerKey: 'dual-assignment-provider',
        providerResponseState: 'accepted',
        providerSupportsIdempotency: true,
      }),
    ).resolves.toBeTruthy();
    await database.query(
      "DELETE FROM employee_assignments WHERE id = 'assignment-external-action-owner'",
    );

    const race = await Promise.allSettled([
      repository.putProviderAcceptanceRule({
        actionClass: 'email',
        context: context('founder-rule-revocation-race', new Date(now.getTime() + 120)),
        enabled: true,
        idempotencyKeyDerivationVersion: 'bb-operation-sha256-v1',
        providerAccountDigest: evidenceDigest('provider-account:founder-race-provider'),
        providerKey: 'founder-race-provider',
        providerResponseState: 'accepted',
        providerSupportsIdempotency: true,
      }),
      database.query(
        `UPDATE organizations SET kind = 'sponsor'
         WHERE id = 'organization-external-action-internal'`,
      ),
    ]);
    expect(race[1]?.status).toBe('fulfilled');
    await expect(
      repository.putProviderAcceptanceRule({
        actionClass: 'email',
        context: context('founder-rule-after-org-revocation', new Date(now.getTime() + 130)),
        enabled: true,
        idempotencyKeyDerivationVersion: 'bb-operation-sha256-v1',
        providerAccountDigest: evidenceDigest('provider-account:after-founder-revocation'),
        providerKey: 'after-founder-revocation',
        providerResponseState: 'accepted',
        providerSupportsIdempotency: true,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' });
  });
});

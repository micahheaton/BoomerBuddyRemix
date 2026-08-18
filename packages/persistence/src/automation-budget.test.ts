import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AutomationBudgetRepository } from './automation-budget';
import { BusinessOsRepository } from './business-os';
import { createPGliteDatabase, type Database } from './database';
import { runMigrations } from './migrations';

const actorPersonId = 'person-automation-budget-owner';
const agentKey = 'owner_brief_agent';
const action = 'create_internal_task';
const tool = 'hq';
const baseNow = new Date('2026-08-17T12:00:00.000Z');

describe('transactional automation budgets', () => {
  let database: Database;
  let budgets: AutomationBudgetRepository;
  let businessOs: BusinessOsRepository;
  let policyId: string;

  const context = (suffix: string, now = baseNow) => ({
    actorPersonId,
    audience: 'hq' as const,
    correlationId: `automation-budget-${suffix}`,
    now,
  });

  const request = (estimatedCostCents: number) => ({
    action,
    dataClasses: ['public'],
    estimatedCostCents,
    tool,
  });

  async function configureRequiredCaps(limitCents: number): Promise<void> {
    const caps = [
      { periodKind: 'day' as const, scopeKind: 'company' as const, scopeKey: 'global' },
      { periodKind: 'month' as const, scopeKind: 'company' as const, scopeKey: 'global' },
      { periodKind: 'day' as const, scopeKind: 'agent' as const, scopeKey: agentKey },
      { periodKind: 'day' as const, scopeKind: 'action' as const, scopeKey: action },
      { periodKind: 'day' as const, scopeKind: 'tool' as const, scopeKey: tool },
      { periodKind: 'month' as const, scopeKind: 'policy' as const, scopeKey: policyId },
    ];
    for (const [index, cap] of caps.entries()) {
      await budgets.putCap({
        approvedByPersonId: actorPersonId,
        context: context(`cap-${index}`),
        enabled: true,
        limitCents,
        ...cap,
      });
    }
  }

  beforeEach(async () => {
    database = await createPGliteDatabase();
    await runMigrations(database);
    await database.query('INSERT INTO persons(id, display_name, created_at) VALUES ($1,$2,$3)', [
      actorPersonId,
      'Automation Budget Owner',
      baseNow.toISOString(),
    ]);
    await database.query(
      `INSERT INTO organizations(id, name, kind, verification_state, created_at)
       VALUES ('organization-automation-budget-internal','Automation Budget Internal',
               'internal','local_fixture',$1)`,
      [baseNow.toISOString()],
    );
    await database.query(
      `INSERT INTO employee_assignments(id, person_id, organization_id, role, status, created_at)
       VALUES ('assignment-automation-budget-owner',$1,
               'organization-automation-budget-internal','hq_owner','active',$2)`,
      [actorPersonId, baseNow.toISOString()],
    );
    businessOs = new BusinessOsRepository(database, undefined, actorPersonId);
    budgets = new AutomationBudgetRepository(
      database,
      undefined,
      actorPersonId,
      async (_transaction, observedAt) => observedAt,
    );
    policyId = await businessOs.putAutomationPolicy({
      approvedByPersonId: actorPersonId,
      correlationId: 'automation-budget-policy',
      now: baseNow,
      policy: {
        action,
        allowedDataClasses: ['public'],
        allowedTools: [tool],
        autonomy: 'auto',
        enabled: true,
        maxCostPerOperationCents: 10,
        requiresAudit: true,
      },
    });
  });

  afterEach(async () => database.close());

  async function clearKillSwitch(now = baseNow): Promise<void> {
    await businessOs.setGlobalAutomationKillSwitch({
      correlationId: `automation-control-clear-${now.toISOString()}`,
      killSwitch: false,
      now,
      updatedByPersonId: actorPersonId,
    });
  }

  it('fails closed when any required cumulative cap is missing', async () => {
    await clearKillSwitch();
    const result = await budgets.reserve({
      agentKey,
      context: context('missing-cap'),
      operationKey: 'operation-missing-cap',
      request: request(1),
      ttlMs: 60_000,
    });
    expect(result).toMatchObject({
      allowed: false,
      reasons: [expect.stringContaining('company_day')],
    });
    const totals = await database.query<{ reservations: number; reserved: number }>(
      `SELECT
         (SELECT count(*)::int FROM automation_budget_reservations) AS reservations,
         (SELECT COALESCE(sum(reserved_cents),0)::int FROM automation_budget_windows) AS reserved`,
    );
    expect(totals.rows[0]).toEqual({ reservations: 0, reserved: 0 });
  });

  it('atomically prevents many individually-cheap requests from exceeding a cumulative cap', async () => {
    await configureRequiredCaps(10);
    await clearKillSwitch();
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        budgets.reserve({
          agentKey,
          context: context(`concurrent-${index}`),
          operationKey: `operation-concurrent-${index}`,
          request: request(1),
          ttlMs: 60_000,
        }),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(10);
    expect(results.filter((result) => !result.allowed)).toHaveLength(15);
    const status = await budgets.status(baseNow);
    expect(status).toHaveLength(6);
    expect(status.every((cap) => cap.reservedCents === 10 && cap.availableCents === 0)).toBe(true);
    const rows = await database.query<{ reservations: number; allocations: number }>(
      `SELECT
         (SELECT count(*)::int FROM automation_budget_reservations) AS reservations,
         (SELECT count(*)::int FROM automation_budget_reservation_allocations) AS allocations`,
    );
    expect(rows.rows[0]).toEqual({ allocations: 60, reservations: 10 });
  });

  it('makes exact operation retries idempotent and conflicting envelopes fail closed', async () => {
    await configureRequiredCaps(10);
    await clearKillSwitch();
    const [first, retry] = await Promise.all([
      budgets.reserve({
        agentKey,
        context: context('idempotent-first'),
        operationKey: 'operation-idempotent',
        request: { ...request(2), dataClasses: ['public', 'public'] },
        ttlMs: 60_000,
      }),
      budgets.reserve({
        agentKey,
        context: context('idempotent-retry'),
        operationKey: 'operation-idempotent',
        request: request(2),
        ttlMs: 60_000,
      }),
    ]);
    expect([first, retry].filter((result) => result.allowed && !result.reused)).toHaveLength(1);
    expect([first, retry].filter((result) => result.allowed && result.reused)).toHaveLength(1);
    expect(first.allowed && retry.allowed && first.reservation.id).toBe(
      retry.allowed ? retry.reservation.id : '',
    );
    await expect(
      budgets.reserve({
        agentKey,
        context: context('idempotent-conflict'),
        operationKey: 'operation-idempotent',
        request: request(3),
        ttlMs: 60_000,
      }),
    ).rejects.toThrow('conflicts with its original envelope');
    expect((await budgets.status(baseNow)).every((cap) => cap.reservedCents === 2)).toBe(true);
  });

  it('preserves current-period use across cap versions and rejects an unsafe reduction', async () => {
    await configureRequiredCaps(10);
    await clearKillSwitch();
    await expect(
      budgets.reserve({
        agentKey,
        context: context('version-reserve'),
        operationKey: 'operation-cap-version',
        request: request(6),
        ttlMs: 60_000,
      }),
    ).resolves.toMatchObject({ allowed: true });
    await businessOs.setGlobalAutomationKillSwitch({
      correlationId: 'automation-control-engage-for-cap-version',
      killSwitch: true,
      now: new Date(baseNow.getTime() + 1_000),
      updatedByPersonId: actorPersonId,
    });
    const capId = await budgets.putCap({
      approvedByPersonId: actorPersonId,
      context: context('version-raise', new Date(baseNow.getTime() + 2_000)),
      enabled: true,
      limitCents: 12,
      periodKind: 'day',
      scopeKey: 'global',
      scopeKind: 'company',
    });
    expect(
      (await budgets.status(new Date(baseNow.getTime() + 2_000))).find((cap) => cap.id === capId),
    ).toMatchObject({ availableCents: 6, limitCents: 12, reservedCents: 6, version: 2 });
    await expect(
      budgets.putCap({
        approvedByPersonId: actorPersonId,
        context: context('version-unsafe-lower', new Date(baseNow.getTime() + 3_000)),
        enabled: true,
        limitCents: 5,
        periodKind: 'day',
        scopeKey: 'global',
        scopeKind: 'company',
      }),
    ).rejects.toThrow('cannot fall below reserved or committed use');
  });

  it('releases or commits every overlapping allocation exactly once', async () => {
    await configureRequiredCaps(10);
    await clearKillSwitch();
    const released = await budgets.reserve({
      agentKey,
      context: context('release-reserve'),
      operationKey: 'operation-release',
      request: request(4),
      ttlMs: 60_000,
    });
    const committed = await budgets.reserve({
      agentKey,
      context: context('commit-reserve'),
      operationKey: 'operation-commit',
      request: request(5),
      ttlMs: 60_000,
    });
    if (!released.allowed || !committed.allowed) throw new Error('Fixture reservation failed');

    await expect(
      budgets.release({
        context: context('release'),
        reasonCode: 'execution_not_started',
        reservationId: released.reservation.id,
      }),
    ).resolves.toMatchObject({ state: 'released' });
    await expect(
      budgets.release({
        context: context('release-retry'),
        reasonCode: 'execution_not_started',
        reservationId: released.reservation.id,
      }),
    ).resolves.toMatchObject({ state: 'released' });

    const recheckAt = new Date(baseNow.getTime() + 1_000);
    await expect(
      budgets.recheckBeforeIrreversibleExecution({
        context: context('recheck', recheckAt),
        reservationId: committed.reservation.id,
      }),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      budgets.commit({
        context: context('unconfirmed-external-commit', new Date(recheckAt.getTime() + 2_000)),
        evidence: { kind: 'external_action', reference: 'operation-commit' },
        reservationId: committed.reservation.id,
      }),
    ).rejects.toThrow('not terminally confirmed');
    await expect(
      budgets.commit({
        context: context('invalid-date-commit', new Date(recheckAt.getTime() + 2_000)),
        evidence: {
          acceptedAt: new Date(Number.NaN),
          actualCostCents: 3,
          evidenceLevel: 'fixture',
          kind: 'local_simulation',
          reference: 'simulation-invalid-date',
        },
        reservationId: committed.reservation.id,
      }),
    ).rejects.toThrow('Invalid automation acceptance time');
    const commit = await budgets.commit({
      context: context('commit', new Date(recheckAt.getTime() + 2_000)),
      evidence: {
        acceptedAt: new Date(recheckAt.getTime() + 1_000),
        actualCostCents: 3,
        evidenceLevel: 'fixture',
        kind: 'local_simulation',
        reference: 'simulation-commit-one',
      },
      reservationId: committed.reservation.id,
    });
    expect(commit).toMatchObject({ actualCostCents: 3, overrun: false, state: 'committed' });
    await expect(
      budgets.commit({
        context: context('commit-retry', new Date(recheckAt.getTime() + 2_000)),
        evidence: {
          acceptedAt: new Date(recheckAt.getTime() + 1_000),
          actualCostCents: 3,
          evidenceLevel: 'fixture',
          kind: 'local_simulation',
          reference: 'simulation-commit-one',
        },
        reservationId: committed.reservation.id,
      }),
    ).resolves.toMatchObject({ state: 'committed' });
    const status = await budgets.status(new Date(recheckAt.getTime() + 2_000));
    expect(status.every((cap) => cap.reservedCents === 0 && cap.committedCents === 3)).toBe(true);
    await expect(
      budgets.release({
        context: context('release-committed'),
        reasonCode: 'invalid_release',
        reservationId: committed.reservation.id,
      }),
    ).rejects.toThrow('cannot be released');
    await expect(
      budgets.reserve({
        agentKey,
        context: context('released-operation-retry', new Date(recheckAt.getTime() + 3_000)),
        operationKey: 'operation-release',
        request: request(4),
        ttlMs: 60_000,
      }),
    ).resolves.toMatchObject({
      allowed: false,
      executable: false,
      reservation: { state: 'released' },
      reused: true,
    });
    await expect(
      budgets.reserve({
        agentKey,
        context: context('committed-operation-retry', new Date(recheckAt.getTime() + 3_000)),
        operationKey: 'operation-commit',
        request: request(5),
        ttlMs: 60_000,
      }),
    ).resolves.toMatchObject({
      allowed: false,
      executable: false,
      reservation: { state: 'committed' },
      reused: true,
    });
  });

  it('atomically releases an expired exact retry and sweeps unrelated stale authority', async () => {
    await configureRequiredCaps(2);
    await clearKillSwitch();
    const exact = await budgets.reserve({
      agentKey,
      context: context('expired-exact-reserve'),
      operationKey: 'operation-expired-exact',
      request: request(2),
      ttlMs: 1_000,
    });
    if (!exact.allowed) throw new Error('Fixture reservation failed');
    const afterExpiry = new Date(baseNow.getTime() + 1_001);
    await expect(
      budgets.reserve({
        agentKey,
        context: context('expired-exact-retry', afterExpiry),
        operationKey: 'operation-expired-exact',
        request: request(2),
        ttlMs: 1_000,
      }),
    ).resolves.toMatchObject({
      allowed: false,
      executable: false,
      reservation: { state: 'released' },
      reused: true,
    });
    const stale = await budgets.reserve({
      agentKey,
      context: context('stale-unrelated-reserve', afterExpiry),
      operationKey: 'operation-stale-unrelated',
      request: request(2),
      ttlMs: 1_000,
    });
    if (!stale.allowed) throw new Error('Fixture reservation failed');
    const afterStaleExpiry = new Date(afterExpiry.getTime() + 1_001);
    await expect(
      budgets.reserve({
        agentKey,
        context: context('stale-blocked-before-sweep', afterStaleExpiry),
        operationKey: 'operation-before-sweep',
        request: request(1),
        ttlMs: 1_000,
      }),
    ).resolves.toMatchObject({ allowed: false, executable: false });
    await expect(
      budgets.releaseExpired({ context: context('stale-sweep', afterStaleExpiry), limit: 1 }),
    ).resolves.toBe(1);
    await expect(
      budgets.reserve({
        agentKey,
        context: context('stale-after-sweep', afterStaleExpiry),
        operationKey: 'operation-after-sweep',
        request: request(1),
        ttlMs: 1_000,
      }),
    ).resolves.toMatchObject({ allowed: true, executable: true });
  });

  it('releases on a changed kill switch or policy before irreversible execution', async () => {
    await configureRequiredCaps(10);
    await clearKillSwitch();
    const killReservation = await budgets.reserve({
      agentKey,
      context: context('kill-reserve'),
      operationKey: 'operation-kill-recheck',
      request: request(2),
      ttlMs: 60_000,
    });
    if (!killReservation.allowed) throw new Error('Fixture reservation failed');
    await businessOs.setGlobalAutomationKillSwitch({
      correlationId: 'automation-control-engage',
      killSwitch: true,
      now: new Date(baseNow.getTime() + 1_000),
      updatedByPersonId: actorPersonId,
    });
    await expect(
      budgets.recheckBeforeIrreversibleExecution({
        context: context('kill-recheck', new Date(baseNow.getTime() + 2_000)),
        reservationId: killReservation.reservation.id,
      }),
    ).resolves.toEqual({ allowed: false, reason: 'global_kill_switch_engaged' });

    await clearKillSwitch(new Date(baseNow.getTime() + 3_000));
    const policyReservation = await budgets.reserve({
      agentKey,
      context: context('policy-reserve', new Date(baseNow.getTime() + 3_000)),
      operationKey: 'operation-policy-recheck',
      request: request(2),
      ttlMs: 60_000,
    });
    if (!policyReservation.allowed) throw new Error('Fixture reservation failed');
    await businessOs.putAutomationPolicy({
      approvedByPersonId: actorPersonId,
      correlationId: 'automation-budget-policy-disable',
      now: new Date(baseNow.getTime() + 4_000),
      policy: {
        action,
        allowedDataClasses: ['public'],
        allowedTools: [tool],
        autonomy: 'auto',
        enabled: false,
        maxCostPerOperationCents: 10,
        requiresAudit: true,
      },
    });
    await expect(
      budgets.recheckBeforeIrreversibleExecution({
        context: context('policy-recheck', new Date(baseNow.getTime() + 5_000)),
        reservationId: policyReservation.reservation.id,
      }),
    ).resolves.toEqual({ allowed: false, reason: 'policy_changed' });
    expect(
      (await budgets.status(new Date(baseNow.getTime() + 5_000))).every(
        (cap) => cap.reservedCents === 0,
      ),
    ).toBe(true);
  });

  it('releases when the applicable cumulative cap envelope changes before execution', async () => {
    await configureRequiredCaps(10);
    await clearKillSwitch();
    const result = await budgets.reserve({
      agentKey,
      context: context('cap-recheck-reserve'),
      operationKey: 'operation-cap-recheck',
      request: request(2),
      ttlMs: 60_000,
    });
    if (!result.allowed) throw new Error('Fixture reservation failed');
    await businessOs.setGlobalAutomationKillSwitch({
      correlationId: 'automation-control-engage-for-cap-recheck',
      killSwitch: true,
      now: new Date(baseNow.getTime() + 1_000),
      updatedByPersonId: actorPersonId,
    });
    await budgets.putCap({
      approvedByPersonId: actorPersonId,
      context: context('cap-recheck-change', new Date(baseNow.getTime() + 2_000)),
      enabled: true,
      limitCents: 10,
      periodKind: 'day',
      scopeKey: 'global',
      scopeKind: 'company',
    });
    await clearKillSwitch(new Date(baseNow.getTime() + 3_000));
    await expect(
      budgets.recheckBeforeIrreversibleExecution({
        context: context('cap-recheck', new Date(baseNow.getTime() + 4_000)),
        reservationId: result.reservation.id,
      }),
    ).resolves.toEqual({ allowed: false, reason: 'budget_cap_changed' });
    expect(
      (await budgets.status(new Date(baseNow.getTime() + 4_000))).every(
        (cap) => cap.reservedCents === 0,
      ),
    ).toBe(true);
  });

  it('records unexpected accepted-cost truth and trips the global stop on overrun', async () => {
    await configureRequiredCaps(10);
    await clearKillSwitch();
    const result = await budgets.reserve({
      agentKey,
      context: context('overrun-reserve'),
      operationKey: 'operation-overrun',
      request: request(1),
      ttlMs: 60_000,
    });
    if (!result.allowed) throw new Error('Fixture reservation failed');
    const recheckedAt = new Date(baseNow.getTime() + 1_000);
    await budgets.recheckBeforeIrreversibleExecution({
      context: context('overrun-recheck', recheckedAt),
      reservationId: result.reservation.id,
    });
    await expect(
      budgets.commit({
        context: context('overrun-commit', new Date(recheckedAt.getTime() + 2_000)),
        evidence: {
          acceptedAt: new Date(recheckedAt.getTime() + 1_000),
          actualCostCents: 12,
          evidenceLevel: 'fixture',
          kind: 'local_simulation',
          reference: 'simulation-overrun-one',
        },
        reservationId: result.reservation.id,
      }),
    ).resolves.toMatchObject({ actualCostCents: 12, overrun: true, state: 'committed' });
    expect(await businessOs.globalAutomationControl()).toMatchObject({ killSwitch: true });
    expect(
      (await budgets.status(new Date(recheckedAt.getTime() + 2_000))).every(
        (cap) => cap.committedCents === 12 && cap.availableCents === -2,
      ),
    ).toBe(true);
    const events = await database.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM automation_budget_events
       WHERE reservation_id = $1 AND event_kind = 'overrun'`,
      [result.reservation.id],
    );
    expect(events.rows[0]?.total).toBe(1);
    await expect(
      budgets.reserve({
        agentKey,
        context: context('overrun-follow-up', new Date(recheckedAt.getTime() + 3_000)),
        operationKey: 'operation-after-overrun',
        request: request(1),
        ttlMs: 60_000,
      }),
    ).resolves.toMatchObject({ allowed: false });
  });

  it('allows only an engaged-stop founder override and keeps evidence immutable', async () => {
    await configureRequiredCaps(1);
    const companyDay = (await budgets.status(baseNow)).find(
      (cap) => cap.scopeKind === 'company' && cap.periodKind === 'day',
    );
    if (companyDay === undefined) throw new Error('Fixture cap missing');
    await clearKillSwitch();
    await expect(
      budgets.overrideCurrentWindow({
        additionalCents: 2,
        approvedByPersonId: actorPersonId,
        capId: companyDay.id,
        context: context('unsafe-override'),
        overrideKey: 'founder-override-one',
        reasonCode: 'founder_test_override',
      }),
    ).rejects.toThrow('requires the global kill switch engaged');
    await businessOs.setGlobalAutomationKillSwitch({
      correlationId: 'automation-control-engage-for-override',
      killSwitch: true,
      now: new Date(baseNow.getTime() + 1_000),
      updatedByPersonId: actorPersonId,
    });
    await expect(
      budgets.overrideCurrentWindow({
        additionalCents: 2,
        approvedByPersonId: actorPersonId,
        capId: companyDay.id,
        context: context('safe-override', new Date(baseNow.getTime() + 2_000)),
        overrideKey: 'founder-override-one',
        reasonCode: 'founder_test_override',
      }),
    ).resolves.toEqual({ reused: false });
    await expect(
      budgets.overrideCurrentWindow({
        additionalCents: 2,
        approvedByPersonId: actorPersonId,
        capId: companyDay.id,
        context: context('safe-override-retry', new Date(baseNow.getTime() + 2_000)),
        overrideKey: 'founder-override-one',
        reasonCode: 'founder_test_override',
      }),
    ).resolves.toEqual({ reused: true });
    await expect(
      budgets.overrideCurrentWindow({
        additionalCents: 3,
        approvedByPersonId: actorPersonId,
        capId: companyDay.id,
        context: context('safe-override-conflict', new Date(baseNow.getTime() + 2_000)),
        overrideKey: 'founder-override-one',
        reasonCode: 'founder_test_override',
      }),
    ).rejects.toThrow('conflicts with its original envelope');
    expect(
      (await budgets.status(new Date(baseNow.getTime() + 2_000))).find(
        (cap) => cap.id === companyDay.id,
      ),
    ).toMatchObject({ availableCents: 3, overrideCents: 2 });
    await expect(
      database.query("UPDATE automation_budget_events SET reason_code = 'changed'"),
    ).rejects.toThrow('append-only');
    await expect(database.query('DELETE FROM automation_budget_events')).rejects.toThrow(
      'append-only',
    );
    await clearKillSwitch(new Date(baseNow.getTime() + 3_000));
    await expect(
      budgets.reserve({
        agentKey,
        context: context('immutable-allocation', new Date(baseNow.getTime() + 3_000)),
        operationKey: 'operation-immutable-allocation',
        request: request(1),
        ttlMs: 60_000,
      }),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      database.query('DELETE FROM automation_budget_reservation_allocations'),
    ).rejects.toThrow('append-only');
    await expect(database.query('DELETE FROM autonomy_policy_versions')).rejects.toThrow(
      'append-only',
    );
  });

  it('protects cap identity and reservation envelopes beneath append-only evidence', async () => {
    await configureRequiredCaps(10);
    const cap = (await budgets.status(baseNow))[0];
    if (cap === undefined) throw new Error('Fixture cap missing');
    await expect(
      database.query("UPDATE automation_budget_caps SET scope_key = 'rewritten' WHERE id = $1", [
        cap.id,
      ]),
    ).rejects.toThrow('identity/version is immutable');
    await expect(
      database.query('DELETE FROM automation_budget_caps WHERE id = $1', [cap.id]),
    ).rejects.toThrow('cannot be deleted');
    await clearKillSwitch();
    const result = await budgets.reserve({
      agentKey,
      context: context('reservation-envelope-protection'),
      operationKey: 'operation-envelope-protection',
      request: request(1),
      ttlMs: 60_000,
    });
    if (!result.allowed) throw new Error('Fixture reservation failed');
    await expect(
      database.query(
        "UPDATE automation_budget_reservations SET action_key = 'rewritten' WHERE id = $1",
        [result.reservation.id],
      ),
    ).rejects.toThrow('envelope is immutable');
    await expect(
      database.query('DELETE FROM automation_budget_reservations WHERE id = $1', [
        result.reservation.id,
      ]),
    ).rejects.toThrow('cannot be deleted');
  });

  it('requires an exact internal founder assignment for caps and overrides and serializes revocation', async () => {
    const unconfigured = new AutomationBudgetRepository(
      database,
      undefined,
      undefined,
      async (_transaction, observedAt) => observedAt,
    );
    await expect(
      unconfigured.putCap({
        approvedByPersonId: actorPersonId,
        context: context('unconfigured-founder'),
        enabled: true,
        limitCents: 10,
        periodKind: 'day',
        scopeKey: 'global',
        scopeKind: 'company',
      }),
    ).rejects.toThrow('configured founder identity');
    await database.query(
      `INSERT INTO organizations(id, name, kind, verification_state, created_at)
       VALUES ('organization-automation-budget-sponsor','Automation Budget Sponsor',
               'sponsor','local_fixture',$1)`,
      [baseNow.toISOString()],
    );
    await database.query(
      'UPDATE employee_assignments SET organization_id = NULL WHERE person_id = $1',
      [actorPersonId],
    );
    await expect(
      budgets.putCap({
        approvedByPersonId: actorPersonId,
        context: context('null-organization-founder'),
        enabled: true,
        limitCents: 10,
        periodKind: 'day',
        scopeKey: 'global',
        scopeKind: 'company',
      }),
    ).rejects.toThrow('active founder owner assignment');
    await database.query(
      `UPDATE employee_assignments
       SET organization_id = 'organization-automation-budget-sponsor'
       WHERE person_id = $1`,
      [actorPersonId],
    );
    await expect(
      budgets.putCap({
        approvedByPersonId: actorPersonId,
        context: context('sponsor-organization-founder'),
        enabled: true,
        limitCents: 10,
        periodKind: 'day',
        scopeKey: 'global',
        scopeKind: 'company',
      }),
    ).rejects.toThrow('active founder owner assignment');
    const rows = await database.query<{ total: number } & Record<string, unknown>>(
      "SELECT count(*)::int AS total FROM automation_budget_caps WHERE scope_kind = 'company'",
    );
    expect(rows.rows[0]?.total).toBe(0);
    await database.query(
      `INSERT INTO employee_assignments(
         id, person_id, organization_id, role, status, created_at
       ) VALUES ('assignment-automation-budget-owner-internal',$1,
                 'organization-automation-budget-internal','hq_owner','active',$2)`,
      [actorPersonId, baseNow.toISOString()],
    );
    const capId = await budgets.putCap({
      approvedByPersonId: actorPersonId,
      context: context('dual-assignment-cap'),
      enabled: true,
      limitCents: 10,
      periodKind: 'day',
      scopeKey: 'global',
      scopeKind: 'company',
    });
    await expect(
      budgets.overrideCurrentWindow({
        additionalCents: 2,
        approvedByPersonId: actorPersonId,
        capId,
        context: context('dual-assignment-override'),
        overrideKey: 'dual-assignment-founder-override',
        reasonCode: 'founder_authority_test',
      }),
    ).resolves.toEqual({ reused: false });
    await database.query(
      "DELETE FROM employee_assignments WHERE id = 'assignment-automation-budget-owner'",
    );
    await database.query(
      "UPDATE employee_assignments SET status = 'suspended' WHERE id = 'assignment-automation-budget-owner-internal'",
    );
    await expect(
      budgets.overrideCurrentWindow({
        additionalCents: 1,
        approvedByPersonId: actorPersonId,
        capId,
        context: context('suspended-founder-override'),
        overrideKey: 'suspended-founder-override',
        reasonCode: 'founder_authority_test',
      }),
    ).rejects.toThrow('active founder owner assignment');
    const overrideEvents = await database.query<{ total: number } & Record<string, unknown>>(
      "SELECT count(*)::int AS total FROM automation_budget_events WHERE event_kind = 'window_override'",
    );
    expect(overrideEvents.rows[0]?.total).toBe(1);
    await database.query(
      "UPDATE employee_assignments SET status = 'active' WHERE id = 'assignment-automation-budget-owner-internal'",
    );
    const race = await Promise.allSettled([
      budgets.putCap({
        approvedByPersonId: actorPersonId,
        context: context('founder-repoint-race'),
        enabled: true,
        limitCents: 10,
        periodKind: 'month',
        scopeKey: agentKey,
        scopeKind: 'agent',
      }),
      database.query(
        `UPDATE employee_assignments
         SET organization_id = 'organization-automation-budget-sponsor'
         WHERE id = 'assignment-automation-budget-owner-internal'`,
      ),
    ]);
    expect(race[1]?.status).toBe('fulfilled');
    await expect(
      budgets.putCap({
        approvedByPersonId: actorPersonId,
        context: context('founder-after-repoint-race'),
        enabled: true,
        limitCents: 10,
        periodKind: 'day',
        scopeKey: 'founder-after-repoint',
        scopeKind: 'action',
      }),
    ).rejects.toThrow('active founder owner assignment');
  });

  it('uses the transaction authority clock instead of backdated or future caller time', async () => {
    await configureRequiredCaps(10);
    await clearKillSwitch();
    const authorityNow = new Date(baseNow.getTime() + 10_000);
    const clocked = new AutomationBudgetRepository(
      database,
      undefined,
      actorPersonId,
      async () => authorityNow,
    );
    const result = await clocked.reserve({
      agentKey,
      context: context('malicious-future-observation', new Date('2036-01-01T00:00:00.000Z')),
      operationKey: 'operation-authority-clock',
      request: request(1),
      ttlMs: 1_000,
    });
    if (!result.allowed) throw new Error('Fixture reservation failed');
    expect(result.reservation.expiresAt).toEqual(new Date(authorityNow.getTime() + 1_000));
    const stored = await database.query<{ reserved_at: unknown } & Record<string, unknown>>(
      'SELECT reserved_at FROM automation_budget_reservations WHERE id = $1',
      [result.reservation.id],
    );
    expect(new Date(String(stored.rows[0]?.reserved_at))).toEqual(authorityNow);
  });
});

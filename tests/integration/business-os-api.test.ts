import { BusinessOsRepository } from '@boomerbuddy/persistence';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { browserHeaders, createApiHarness, hqOrigin, login, type ApiHarness } from './support';

describe('HQ Business OS API', () => {
  let harness: ApiHarness;

  beforeEach(async () => {
    harness = await createApiHarness();
  });

  afterEach(async () => harness.close());

  it('caps owner queues and reports truncation instead of loading unbounded work', async () => {
    await harness.database.query(
      `INSERT INTO owner_attention_items(
         id, attention_kind, source_type, source_id, dedupe_key,
         why_founder_required, recommended_action, consequence_of_inaction,
         state, created_at, updated_at
       )
       SELECT 'attention-bound-' || value, 'release_review', 'fixture',
              'source-' || value, 'attention-bound-' || value,
              'Founder decision required', 'Review the bounded fixture',
              'The fixture remains pending', 'open', $1, $1
       FROM generate_series(1, 102) AS generated(value)`,
      [harness.clock.now().toISOString()],
    );
    const owner = await login(harness.app, 'hq-heidi', 'hq');
    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/business-os/attention',
      headers: browserHeaders(owner.cookie as string, hqOrigin),
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<{ items: unknown[]; truncated: boolean }>()).toMatchObject({
      truncated: true,
      items: expect.any(Array),
    });
    expect(response.json<{ items: unknown[] }>().items).toHaveLength(100);
  });

  it('shows official snapshot provenance, disciplined pipeline, and no automatic outreach', async () => {
    const repository = new BusinessOsRepository(harness.database);
    await repository.importNcuaSnapshot({
      records: [
        {
          assets: 750_000_000,
          charterNumber: 12_345,
          charterState: 'CA',
          city: 'Oakland',
          deposits: 600_000_000,
          fitReasons: [
            '50,000 to 249,999 reported memberships.',
            '$500 million or more in reported assets.',
          ],
          fitScore: 50,
          internalJoinNumber: 12_345,
          loans: 500_000_000,
          lowIncomeDesignation: false,
          memberSegment: '50k_250k',
          members: 75_000,
          name: 'Fixture Credit Union',
          ncuaRegion: '2',
          peerGroup: 6,
          sourceTypeCode: '1',
          state: 'CA',
          zipCode: '94612',
        },
      ],
      provenance: {
        cycleDate: '2026-03-31',
        downloadedAt: harness.clock.now(),
        sha256: 'a'.repeat(64),
        sourceUrl: 'https://ncua.gov/fixture',
      },
      context: {
        audience: 'hq',
        actorPersonId: 'person-hq-heidi',
        correlationId: 'correlation-business-os-import',
        now: harness.clock.now(),
      },
    });
    const organization = await harness.database.query<{ id: string } & Record<string, unknown>>(
      `SELECT id FROM crm_organizations WHERE source_name = 'ncua' AND source_external_id = '12345'`,
    );
    const organizationId = organization.rows[0]?.id;
    if (organizationId === undefined) throw new Error('Fixture organization missing');

    const owner = await login(harness.app, 'hq-heidi', 'hq');
    const headers = browserHeaders(owner.cookie as string, hqOrigin);
    const targets = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/business-os/credit-unions?minimumFitScore=40',
      headers,
    });
    expect(targets.statusCode, targets.body).toBe(200);
    expect(targets.json()).toMatchObject({
      dataState: 'official_fixed_snapshot',
      limitation: 'Fit is explainable segmentation, not buyer intent.',
      targets: [{ name: 'Fixture Credit Union', fitScore: 50, intentClaimed: false }],
    });

    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/hq/business-os/opportunities',
      headers,
      payload: { organizationId, name: 'Discovery hypothesis' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ outreachSent: false });
    const queue = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/business-os/opportunities',
      headers,
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json()).toMatchObject({
      consequentialOutreachAutomatic: false,
      opportunities: [{ name: 'Discovery hypothesis', stage: 'target' }],
    });

    const policy = await harness.app.inject({
      method: 'PUT',
      url: '/v1/hq/business-os/autonomy/policies',
      headers,
      payload: {
        action: 'prepare_owner_brief',
        allowedDataClasses: ['aggregate_metrics'],
        allowedTools: ['local_database'],
        autonomy: 'auto',
        enabled: true,
        maxCostPerOperationCents: 0,
        requiresAudit: true,
      },
    });
    expect(policy.statusCode).toBe(200);
    expect(policy.json()).toMatchObject({ actionExecuted: false });
    const policyId = policy.json<{ policy: { id: string } }>().policy.id;
    const requiredCaps = [
      { periodKind: 'day', scopeKind: 'company', scopeKey: 'global' },
      { periodKind: 'month', scopeKind: 'company', scopeKey: 'global' },
      { periodKind: 'day', scopeKind: 'agent', scopeKey: 'owner_brief_agent' },
      { periodKind: 'day', scopeKind: 'action', scopeKey: 'prepare_owner_brief' },
      { periodKind: 'day', scopeKind: 'tool', scopeKey: 'local_database' },
      { periodKind: 'month', scopeKind: 'policy', scopeKey: policyId },
    ];
    for (const cap of requiredCaps) {
      const response = await harness.app.inject({
        method: 'PUT',
        url: '/v1/hq/business-os/autonomy/budgets/caps',
        headers,
        payload: {
          ...cap,
          confirmation: 'CONFIGURE_BUDGET_CAP',
          enabled: true,
          limitCents: 100,
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({ actionExecuted: false });
    }
    const initialBudgetStatus = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/business-os/autonomy/budgets',
      headers,
    });
    expect(initialBudgetStatus.statusCode, initialBudgetStatus.body).toBe(200);
    expect(initialBudgetStatus.json()).toMatchObject({
      caps: expect.arrayContaining([
        expect.objectContaining({
          availableCents: 100,
          scopeKind: 'company',
          scopeKey: 'global',
        }),
      ]),
      evidenceState: 'persistent_local_ledger',
      externalExecutionEnabled: false,
      killSwitch: true,
    });
    const blockedEvaluation = await harness.app.inject({
      method: 'POST',
      url: '/v1/hq/business-os/autonomy/evaluate',
      headers,
      payload: {
        action: 'prepare_owner_brief',
        dataClasses: ['aggregate_metrics'],
        estimatedCostCents: 0,
        tool: 'local_database',
      },
    });
    expect(blockedEvaluation.statusCode).toBe(200);
    expect(blockedEvaluation.json()).toMatchObject({
      actionExecuted: false,
      allowed: false,
      cumulativeBudgetReserved: false,
      disposition: 'blocked',
      evaluationOnly: true,
    });
    const globalControl = await harness.app.inject({
      method: 'PUT',
      url: '/v1/hq/business-os/autonomy/global-control',
      headers,
      payload: { killSwitch: false, confirmation: 'DISENGAGE' },
    });
    expect(globalControl.statusCode).toBe(200);
    expect(globalControl.json()).toMatchObject({ killSwitch: false });
    const evaluation = await harness.app.inject({
      method: 'POST',
      url: '/v1/hq/business-os/autonomy/evaluate',
      headers,
      payload: {
        action: 'prepare_owner_brief',
        dataClasses: ['aggregate_metrics'],
        estimatedCostCents: 0,
        tool: 'local_database',
      },
    });
    expect(evaluation.statusCode).toBe(200);
    expect(evaluation.json()).toMatchObject({
      actionExecuted: false,
      allowed: true,
      cumulativeBudgetReserved: false,
      disposition: 'auto',
      evaluationOnly: true,
    });
    const afterEvaluationBudgetStatus = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/business-os/autonomy/budgets',
      headers,
    });
    expect(
      afterEvaluationBudgetStatus
        .json<{ caps: { committedCents: number; reservedCents: number }[] }>()
        .caps.every((cap) => cap.committedCents === 0 && cap.reservedCents === 0),
    ).toBe(true);
    const capId = initialBudgetStatus
      .json<{ caps: { id: string; scopeKind: string; periodKind: string }[] }>()
      .caps.find((cap) => cap.scopeKind === 'company' && cap.periodKind === 'day')?.id;
    expect(capId).toBeDefined();
    const unsafeOverride = await harness.app.inject({
      method: 'POST',
      url: '/v1/hq/business-os/autonomy/budgets/overrides',
      headers,
      payload: {
        additionalCents: 25,
        capId,
        confirmation: 'EXPAND_BUDGET_CAP',
        overrideKey: 'founder_fixture_override_one',
        reasonCode: 'founder_fixture_override',
      },
    });
    expect(unsafeOverride.statusCode).toBe(400);
    const engageControl = await harness.app.inject({
      method: 'PUT',
      url: '/v1/hq/business-os/autonomy/global-control',
      headers,
      payload: { killSwitch: true, confirmation: 'ENGAGE' },
    });
    expect(engageControl.statusCode).toBe(200);
    const override = await harness.app.inject({
      method: 'POST',
      url: '/v1/hq/business-os/autonomy/budgets/overrides',
      headers,
      payload: {
        additionalCents: 25,
        capId,
        confirmation: 'EXPAND_BUDGET_CAP',
        overrideKey: 'founder_fixture_override_one',
        reasonCode: 'founder_fixture_override',
      },
    });
    expect(override.statusCode, override.body).toBe(200);
    expect(override.json()).toEqual({ actionExecuted: false, overridden: true, reused: false });

    const unsafePolicy = await harness.app.inject({
      method: 'PUT',
      url: '/v1/hq/business-os/autonomy/policies',
      headers,
      payload: {
        action: 'send_outreach',
        allowedDataClasses: ['public'],
        allowedTools: ['email'],
        autonomy: 'auto',
        enabled: true,
        maxCostPerOperationCents: 0,
        requiresAudit: true,
      },
    });
    expect(unsafePolicy.statusCode).toBe(400);

    const unsafeTuple = await harness.app.inject({
      method: 'PUT',
      url: '/v1/hq/business-os/autonomy/policies',
      headers,
      payload: {
        action: 'prepare_owner_brief',
        allowedDataClasses: ['customer_content'],
        allowedTools: ['gmail'],
        autonomy: 'auto',
        enabled: true,
        maxCostPerOperationCents: 0,
        requiresAudit: true,
      },
    });
    expect(unsafeTuple.statusCode).toBe(400);

    const autonomyEvidence = await harness.database.query<
      { policy_versions: number; control_versions: number; audits: number } & Record<
        string,
        unknown
      >
    >(
      `SELECT
         (SELECT count(*)::int FROM autonomy_policy_versions) AS policy_versions,
         (SELECT count(*)::int FROM automation_global_control_history) AS control_versions,
         (SELECT count(*)::int FROM audit_events
          WHERE action IN (
            'business_os.autonomy_policy_changed',
            'business_os.automation_global_control_changed'
          )) AS audits`,
    );
    expect(autonomyEvidence.rows[0]).toMatchObject({
      policy_versions: 1,
      control_versions: 3,
      audits: 3,
    });
  });

  it('keeps owner, revenue, target, and attention context owner-only', async () => {
    const reviewer = await login(harness.app, 'hq-riley', 'hq');
    const headers = browserHeaders(reviewer.cookie as string, hqOrigin);
    expect(
      (
        await harness.app.inject({
          method: 'GET',
          url: '/v1/hq/business-os/owner-brief',
          headers,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await harness.app.inject({
          method: 'GET',
          url: '/v1/hq/business-os/autonomy/budgets',
          headers,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await harness.app.inject({
          method: 'PUT',
          url: '/v1/hq/business-os/autonomy/policies',
          headers,
          payload: {
            action: 'send_outreach',
            allowedDataClasses: [],
            allowedTools: [],
            autonomy: 'auto',
            enabled: true,
            maxCostPerOperationCents: 0,
            requiresAudit: true,
          },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('records self-service privacy intake and an owner-audited content-free fulfillment plan', async () => {
    const protectedMember = await login(harness.app, 'protected-pat');
    const customerHeaders = browserHeaders(protectedMember.cookie as string);
    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/privacy-requests',
      headers: customerHeaders,
      payload: { requestKind: 'export' },
    });
    expect(created.statusCode, created.body).toBe(202);
    const requestId = created.json<{ id: string }>().id;
    const duplicate = await harness.app.inject({
      method: 'POST',
      url: '/v1/privacy-requests',
      headers: customerHeaders,
      payload: { requestKind: 'export' },
    });
    expect(duplicate.statusCode).toBe(409);
    const selfList = await harness.app.inject({
      method: 'GET',
      url: '/v1/privacy-requests',
      headers: customerHeaders,
    });
    expect(selfList.statusCode).toBe(200);
    expect(selfList.json()).toMatchObject({
      fulfillmentMode: 'evidence_plan_only',
      truncated: false,
      requests: [{ id: requestId, state: 'received', requestKind: 'export' }],
    });

    const owner = await login(harness.app, 'hq-heidi', 'hq');
    const hqHeaders = browserHeaders(owner.cookie as string, hqOrigin);
    for (const [action, evidenceReference] of [
      ['verify_identity', 'identity:fixture-reviewed-v1'],
      ['begin_review', 'review:fixture-started-v1'],
      ['record_plan', 'plan:fixture-generated-v1'],
    ] as const) {
      const response = await harness.app.inject({
        method: 'POST',
        url: `/v1/hq/business-os/privacy-requests/${requestId}/actions`,
        headers: hqHeaders,
        payload: { action, evidenceReference },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({ fulfillmentPerformed: false });
    }
    const queue = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/business-os/privacy-requests',
      headers: hqHeaders,
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json()).toMatchObject({
      truncated: false,
      requests: [
        {
          id: requestId,
          state: 'in_progress',
          identityVerificationState: 'verified',
          plan: {
            kind: 'export_manifest',
            containsCustomerContent: false,
            requiresProfessionalReview: true,
          },
        },
      ],
    });
    const serialized = JSON.stringify(queue.json());
    expect(serialized).not.toContain('encrypted_content');
    expect(serialized).not.toContain('input_fingerprint');

    const reviewer = await login(harness.app, 'hq-riley', 'hq');
    const denied = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/business-os/privacy-requests',
      headers: browserHeaders(reviewer.cookie as string, hqOrigin),
    });
    expect(denied.statusCode).toBe(403);
  });
});

import { BusinessOsRepository } from '@boomerbuddy/persistence';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { browserHeaders, createApiHarness, hqOrigin, login, type ApiHarness } from './support';

describe('HQ Business OS API', () => {
  let harness: ApiHarness;

  beforeEach(async () => {
    harness = await createApiHarness();
  });

  afterEach(async () => harness.close());

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
        budgetCents: 0,
        enabled: true,
        requiresAudit: true,
      },
    });
    expect(policy.statusCode).toBe(200);
    expect(policy.json()).toMatchObject({ actionExecuted: false });
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
    expect(blockedEvaluation.json()).toMatchObject({ allowed: false, disposition: 'blocked' });
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
    expect(evaluation.json()).toMatchObject({ allowed: true, disposition: 'auto' });

    const unsafePolicy = await harness.app.inject({
      method: 'PUT',
      url: '/v1/hq/business-os/autonomy/policies',
      headers,
      payload: {
        action: 'send_outreach',
        allowedDataClasses: ['public'],
        allowedTools: ['email'],
        autonomy: 'auto',
        budgetCents: 0,
        enabled: true,
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
        budgetCents: 0,
        enabled: true,
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
      control_versions: 1,
      audits: 2,
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
          method: 'PUT',
          url: '/v1/hq/business-os/autonomy/policies',
          headers,
          payload: {
            action: 'send_outreach',
            allowedDataClasses: [],
            allowedTools: [],
            autonomy: 'auto',
            budgetCents: 0,
            enabled: true,
            requiresAudit: true,
          },
        })
      ).statusCode,
    ).toBe(403);
  });
});

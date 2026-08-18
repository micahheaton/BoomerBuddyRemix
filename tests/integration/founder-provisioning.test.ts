import { afterEach, describe, expect, it } from 'vitest';

import { founderProvisioningRegisterResponseSchema } from '@boomerbuddy/contracts';
import { createLogger } from '@boomerbuddy/observability';
import { createPGliteDatabase } from '@boomerbuddy/persistence';

import { buildApp } from '../../apps/api/src/app';
import {
  browserHeaders,
  createApiHarness,
  createMutableClock,
  hqOrigin,
  login,
  testConfig,
  type ApiHarness,
} from './support';

describe('founder-only provisioning console API', () => {
  let harness: ApiHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('returns the exact reconciled 23-row register without secret values or external effects', async () => {
    harness = await createApiHarness();
    const founder = await login(harness.app, 'hq-heidi', 'hq');
    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/provisioning',
      headers: browserHeaders(founder.cookie as string, hqOrigin),
    });
    const body = founderProvisioningRegisterResponseSchema.parse(response.json());
    const stripe = body.workstreams.find(({ key }) => key === 'stripe');

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      authority: 'configured_founder_only',
      catalogueVersion: 1,
      evidenceBoundary: 'names_digests_enums_only',
      externalActionExecuted: false,
    });
    expect(body.workstreams).toHaveLength(23);
    expect(body.workstreams.filter(({ status }) => status === 'not_started')).toHaveLength(11);
    expect(body.workstreams.filter(({ status }) => status === 'founder_in_progress')).toHaveLength(
      7,
    );
    expect(body.workstreams.filter(({ status }) => status === 'blocked')).toHaveLength(5);
    expect(body.workstreams.some(({ status }) => status === 'test_proven')).toBe(false);
    expect(stripe?.configurationEnvironmentNames).toEqual([
      'BB_STRIPE_MODE',
      'BB_STRIPE_TEST_ACCOUNT_ID',
      'BB_STRIPE_TEST_FOUNDING_PRODUCT_ID',
      'BB_STRIPE_TEST_FOUNDING_MONTHLY_PRICE_ID',
      'BB_STRIPE_TEST_CANCEL_ONLY_PORTAL_CONFIGURATION_ID',
      'BB_STRIPE_LIVE_ACCOUNT_ID',
      'BB_STRIPE_LIVE_FOUNDING_PRODUCT_ID',
      'BB_STRIPE_LIVE_FOUNDING_MONTHLY_PRICE_ID',
      'BB_STRIPE_LIVE_CANCEL_ONLY_PORTAL_CONFIGURATION_ID',
    ]);
    expect(stripe?.secretEnvironmentNames).toEqual([
      'BB_STRIPE_TEST_API_KEY',
      'BB_STRIPE_TEST_WEBHOOK_SECRET',
      'BB_STRIPE_LIVE_API_KEY',
      'BB_STRIPE_LIVE_WEBHOOK_SECRET',
    ]);
    expect(response.body).not.toMatch(/(?:sk|pk)_(?:test|live)_[A-Za-z0-9]+/u);
    expect(response.body).not.toMatch(/whsec_[A-Za-z0-9]+/u);
    expect(response.body).not.toMatch(/postgres(?:ql)?:\/\//u);
    expect(response.body).not.toMatch(/https?:\/\//u);
  });

  it('records and exactly reuses a names-and-digest-only transition without enabling anything', async () => {
    harness = await createApiHarness();
    const founder = await login(harness.app, 'hq-heidi', 'hq');
    const headers = {
      ...browserHeaders(founder.cookie as string, hqOrigin),
      'idempotency-key': 'provisioning:company_git:00000000-0000-4000-8000-000000000001',
    };
    const payload = {
      toStatus: 'founder_in_progress',
      evidence: {
        tier: 'founder_report',
        kind: 'setup_started',
        result: 'reported',
        observedAt: new Date().toISOString(),
      },
    };

    const first = await harness.app.inject({
      method: 'POST',
      url: '/v1/hq/provisioning/company_git/transitions',
      headers,
      payload,
    });
    const retry = await harness.app.inject({
      method: 'POST',
      url: '/v1/hq/provisioning/company_git/transitions',
      headers,
      payload,
    });
    const rows = await harness.database.query<{
      evidence_count: number;
      operation_count: number;
      status_count: number;
    }>(`
      SELECT
        (SELECT count(*)::integer FROM founder_provisioning_evidence
          WHERE workstream_key = 'company_git') AS evidence_count,
        (SELECT count(*)::integer FROM founder_provisioning_operations
          WHERE workstream_key = 'company_git') AS operation_count,
        (SELECT count(*)::integer FROM founder_provisioning_status_events
          WHERE workstream_key = 'company_git') AS status_count
    `);

    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      workstreamKey: 'company_git',
      status: 'founder_in_progress',
      version: 2,
      reused: false,
      externalActionExecuted: false,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual({ ...first.json(), reused: true });
    expect(rows.rows[0]).toEqual({ evidence_count: 2, operation_count: 1, status_count: 2 });

    const manifestDigest = 'B'.repeat(43);
    const configured = await harness.app.inject({
      method: 'POST',
      url: '/v1/hq/provisioning/company_git/transitions',
      headers: {
        ...browserHeaders(founder.cookie as string, hqOrigin),
        'idempotency-key': 'provisioning:company_git:00000000-0000-4000-8000-000000000006',
      },
      payload: {
        toStatus: 'ready_for_test',
        evidence: {
          tier: 'repository_review',
          kind: 'configuration_ready',
          result: 'passed',
          manifestDigest,
          observedAt: new Date().toISOString(),
        },
      },
    });
    const registerResponse = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/provisioning',
      headers: browserHeaders(founder.cookie as string, hqOrigin),
    });
    const register = founderProvisioningRegisterResponseSchema.parse(registerResponse.json());

    expect(configured.statusCode).toBe(200);
    expect(registerResponse.statusCode).toBe(200);
    expect(
      register.workstreams.find(({ key }) => key === 'company_git')?.latestEvidence,
    ).toMatchObject({
      kind: 'configuration_ready',
      result: 'passed',
      manifestDigest,
    });
  });

  it('rejects missing idempotency, free text, secret fields, and skipped evidence gates atomically', async () => {
    harness = await createApiHarness();
    const founder = await login(harness.app, 'hq-heidi', 'hq');
    const baseHeaders = browserHeaders(founder.cookie as string, hqOrigin);
    const validPayload = {
      toStatus: 'founder_in_progress',
      evidence: {
        tier: 'founder_report',
        kind: 'setup_started',
        result: 'reported',
        observedAt: new Date().toISOString(),
      },
    };

    const missingKey = await harness.app.inject({
      method: 'POST',
      url: '/v1/hq/provisioning/company_git/transitions',
      headers: baseHeaders,
      payload: validPayload,
    });
    const secretField = await harness.app.inject({
      method: 'POST',
      url: '/v1/hq/provisioning/company_git/transitions',
      headers: {
        ...baseHeaders,
        'idempotency-key': 'provisioning:company_git:00000000-0000-4000-8000-000000000002',
      },
      payload: { ...validPayload, secretValue: 'sk_test_must_not_be_accepted' },
    });
    const noteField = await harness.app.inject({
      method: 'POST',
      url: '/v1/hq/provisioning/company_git/transitions',
      headers: {
        ...baseHeaders,
        'idempotency-key': 'provisioning:company_git:00000000-0000-4000-8000-000000000003',
      },
      payload: {
        ...validPayload,
        evidence: { ...validPayload.evidence, note: 'unbounded founder note' },
      },
    });
    const skipped = await harness.app.inject({
      method: 'POST',
      url: '/v1/hq/provisioning/company_git/transitions',
      headers: {
        ...baseHeaders,
        'idempotency-key': 'provisioning:company_git:00000000-0000-4000-8000-000000000004',
      },
      payload: {
        toStatus: 'ready_for_test',
        evidence: {
          tier: 'repository_review',
          kind: 'configuration_ready',
          result: 'passed',
          manifestDigest: 'A'.repeat(43),
          observedAt: new Date().toISOString(),
        },
      },
    });
    const mismatchedOperation = await harness.app.inject({
      method: 'POST',
      url: '/v1/hq/provisioning/company_git/transitions',
      headers: {
        ...baseHeaders,
        'idempotency-key': 'provisioning:stripe:00000000-0000-4000-8000-000000000005',
      },
      payload: validPayload,
    });
    const rows = await harness.database.query<{
      evidence_count: number;
      operation_count: number;
      status_count: number;
    }>(`
      SELECT
        (SELECT count(*)::integer FROM founder_provisioning_evidence
          WHERE workstream_key = 'company_git') AS evidence_count,
        (SELECT count(*)::integer FROM founder_provisioning_operations
          WHERE workstream_key = 'company_git') AS operation_count,
        (SELECT count(*)::integer FROM founder_provisioning_status_events
          WHERE workstream_key = 'company_git') AS status_count
    `);

    expect(missingKey.statusCode).toBe(400);
    expect(secretField.statusCode).toBe(400);
    expect(noteField.statusCode).toBe(400);
    expect(skipped.statusCode).toBe(409);
    expect(mismatchedOperation.statusCode).toBe(400);
    expect(rows.rows[0]).toEqual({ evidence_count: 1, operation_count: 0, status_count: 1 });
  });

  it('rejects ancient, future, and pre-configuration evidence at the HTTP boundary', async () => {
    harness = await createApiHarness();
    const activeHarness = harness;
    const founder = await login(harness.app, 'hq-heidi', 'hq');
    const baseHeaders = browserHeaders(founder.cookie as string, hqOrigin);
    const baseline = await harness.database.query<
      { occurred_at: unknown } & Record<string, unknown>
    >(
      `SELECT occurred_at FROM founder_provisioning_status_events
       WHERE workstream_key = 'company_git' AND version = 1`,
    );
    const baselineValue = baseline.rows[0]?.occurred_at;
    const baselineAt =
      baselineValue instanceof Date ? baselineValue : new Date(String(baselineValue));
    const progressPayload = (observedAt: Date) => ({
      toStatus: 'founder_in_progress',
      evidence: {
        tier: 'founder_report',
        kind: 'setup_started',
        result: 'reported',
        observedAt: observedAt.toISOString(),
      },
    });
    const post = async (sequence: number, payload: Record<string, unknown>) =>
      activeHarness.app.inject({
        method: 'POST',
        url: '/v1/hq/provisioning/company_git/transitions',
        headers: {
          ...baseHeaders,
          'idempotency-key': `provisioning:company_git:00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
        },
        payload,
      });

    const ancient = await post(100, progressPayload(new Date(baselineAt.getTime() - 1)));
    const future = await post(101, progressPayload(new Date(Date.now() + 10 * 60 * 1_000)));
    const progress = await post(102, progressPayload(new Date()));
    const progressStatus = await harness.database.query<
      { occurred_at: unknown } & Record<string, unknown>
    >(
      `SELECT occurred_at FROM founder_provisioning_status_events
       WHERE workstream_key = 'company_git' AND version = 2`,
    );
    const progressValue = progressStatus.rows[0]?.occurred_at;
    const progressAt =
      progressValue instanceof Date ? progressValue : new Date(String(progressValue));
    const configured = await post(103, {
      toStatus: 'ready_for_test',
      evidence: {
        tier: 'repository_review',
        kind: 'configuration_ready',
        result: 'passed',
        manifestDigest: 'K'.repeat(43),
        observedAt: progressAt.toISOString(),
      },
    });
    const configStatus = await harness.database.query<
      { occurred_at: unknown } & Record<string, unknown>
    >(
      `SELECT occurred_at FROM founder_provisioning_status_events
       WHERE workstream_key = 'company_git' AND version = 3`,
    );
    const configValue = configStatus.rows[0]?.occurred_at;
    const configuredAt = configValue instanceof Date ? configValue : new Date(String(configValue));
    const staleProof = await post(104, {
      toStatus: 'test_proven',
      evidence: {
        tier: 'deployed_staging',
        kind: 'verification_passed',
        result: 'passed',
        manifestDigest: 'L'.repeat(43),
        observedAt: new Date(configuredAt.getTime() - 1).toISOString(),
      },
    });
    const rows = await harness.database.query<{
      evidence_count: number;
      operation_count: number;
      status_count: number;
    }>(`
      SELECT
        (SELECT count(*)::integer FROM founder_provisioning_evidence
          WHERE workstream_key = 'company_git') AS evidence_count,
        (SELECT count(*)::integer FROM founder_provisioning_operations
          WHERE workstream_key = 'company_git') AS operation_count,
        (SELECT count(*)::integer FROM founder_provisioning_status_events
          WHERE workstream_key = 'company_git') AS status_count
    `);

    expect(ancient.statusCode).toBe(400);
    expect(future.statusCode).toBe(400);
    expect(progress.statusCode).toBe(200);
    expect(configured.statusCode).toBe(200);
    expect(staleProof.statusCode).toBe(400);
    expect(rows.rows[0]).toEqual({ evidence_count: 3, operation_count: 2, status_count: 3 });
  });

  it('denies reviewers, support staff, customer sessions, and sponsor-scoped founder sessions', async () => {
    harness = await createApiHarness();
    const reviewer = await login(harness.app, 'hq-riley', 'hq');
    const support = await login(harness.app, 'hq-sam', 'hq');
    const customer = await login(harness.app, 'owner-alice');
    for (const cookie of [reviewer.cookie, support.cookie]) {
      const denied = await harness.app.inject({
        method: 'GET',
        url: '/v1/hq/provisioning',
        headers: browserHeaders(cookie as string, hqOrigin),
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.body).not.toContain('BB_STRIPE_TEST_API_KEY');
    }
    const wrongAudience = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/provisioning',
      headers: browserHeaders(customer.cookie as string, hqOrigin),
    });
    expect(wrongAudience.statusCode).toBe(401);

    await harness.database.query(
      `UPDATE employee_assignments
       SET organization_id = 'organization-synthetic-sponsor'
       WHERE id = 'employee-hq-heidi'`,
    );
    const sponsorFounder = await login(harness.app, 'hq-heidi', 'hq');
    const sponsorRead = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/provisioning',
      headers: browserHeaders(sponsorFounder.cookie as string, hqOrigin),
    });
    const sponsorMutation = await harness.app.inject({
      method: 'POST',
      url: '/v1/hq/provisioning/company_git/transitions',
      headers: {
        ...browserHeaders(sponsorFounder.cookie as string, hqOrigin),
        'idempotency-key': 'provisioning:company_git:00000000-0000-4000-8000-000000000005',
      },
      payload: {
        toStatus: 'founder_in_progress',
        evidence: {
          tier: 'founder_report',
          kind: 'setup_started',
          result: 'reported',
          observedAt: new Date().toISOString(),
        },
      },
    });
    expect(sponsorRead.statusCode).toBe(403);
    expect(sponsorMutation.statusCode).toBe(403);
  });

  it('rechecks founder authority after a valid HQ session when custody changes', async () => {
    harness = await createApiHarness();
    const founder = await login(harness.app, 'hq-heidi', 'hq');
    const headers = browserHeaders(founder.cookie as string, hqOrigin);
    const initial = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/provisioning',
      headers,
    });
    expect(initial.statusCode).toBe(200);

    const expectDenied = async (sequence: number): Promise<void> => {
      const read = await harness?.app.inject({
        method: 'GET',
        url: '/v1/hq/provisioning',
        headers,
      });
      const mutation = await harness?.app.inject({
        method: 'POST',
        url: '/v1/hq/provisioning/company_git/transitions',
        headers: {
          ...headers,
          'idempotency-key': `provisioning:company_git:00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
        },
        payload: {
          toStatus: 'founder_in_progress',
          evidence: {
            tier: 'founder_report',
            kind: 'setup_started',
            result: 'reported',
            observedAt: new Date().toISOString(),
          },
        },
      });
      expect(read?.statusCode).toBe(403);
      expect(mutation?.statusCode).toBe(403);
    };

    await harness.database.query(
      "UPDATE employee_assignments SET status = 'suspended' WHERE id = 'employee-hq-heidi'",
    );
    await expectDenied(200);
    await harness.database.query(
      `UPDATE employee_assignments
       SET status = 'active', organization_id = 'organization-synthetic-sponsor'
       WHERE id = 'employee-hq-heidi'`,
    );
    await expectDenied(201);
    await harness.database.query(
      `UPDATE employee_assignments SET organization_id = 'organization-boomerbuddy'
       WHERE id = 'employee-hq-heidi'`,
    );
    await harness.database.query(
      "UPDATE organizations SET kind = 'sponsor' WHERE id = 'organization-boomerbuddy'",
    );
    await expectDenied(202);

    const operations = await harness.database.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM founder_provisioning_operations
       WHERE workstream_key = 'company_git'`,
    );
    expect(operations.rows[0]?.count).toBe(0);
  });

  it('fails closed at the API policy when no founder identity is configured', async () => {
    const clock = createMutableClock();
    const baseConfig = testConfig();
    const config = {
      ...baseConfig,
      identity: {
        allowDevelopmentIssuer: baseConfig.identity.allowDevelopmentIssuer,
        customerOrigins: baseConfig.identity.customerOrigins,
        hqOrigins: baseConfig.identity.hqOrigins,
      },
    };
    const database = await createPGliteDatabase();
    const app = await buildApp({
      config,
      database,
      closeDatabase: false,
      now: clock.now,
      logger: createLogger({ level: 'error', sink: () => undefined, clock: clock.now }),
    });
    harness = {
      app,
      database,
      clock,
      close: async () => {
        await app.close();
        await database.close();
      },
    };
    const owner = await login(app, 'hq-heidi', 'hq');

    const denied = await app.inject({
      method: 'GET',
      url: '/v1/hq/provisioning',
      headers: browserHeaders(owner.cookie as string, hqOrigin),
    });
    const audits = await database.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM audit_events
       WHERE action LIKE 'founder.provisioning.%'`,
    );

    expect(denied.statusCode).toBe(403);
    expect(denied.body).not.toContain('BB_STRIPE_TEST_API_KEY');
    expect(audits.rows[0]?.count).toBe(0);
  });
});

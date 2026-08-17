import { afterEach, describe, expect, it } from 'vitest';
import { SessionRepository } from '@boomerbuddy/persistence';
import {
  browserHeaders,
  createApiHarness,
  customerOrigin,
  hqOrigin,
  login,
  type ApiHarness,
} from './support';

describe('orientation and separate HQ projections', () => {
  let harness: ApiHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('audits the protected actor, makes retries idempotent, and denies deferred helper access', async () => {
    harness = await createApiHarness();
    const pat = await login(harness.app, 'protected-pat');
    const terry = await login(harness.app, 'trusted-terry');
    const headers = browserHeaders(pat.cookie as string);
    const started = await harness.app.inject({
      method: 'POST',
      url: '/v1/orientation/start',
      headers,
    });
    expect(started.statusCode).toBe(200);
    const first = await harness.app.inject({
      method: 'PUT',
      url: '/v1/orientation/steps/protection_subject',
      headers,
      payload: { complete: true },
    });
    const retry = await harness.app.inject({
      method: 'PUT',
      url: '/v1/orientation/steps/protection_subject',
      headers,
      payload: { complete: true },
    });
    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(first.json());
    const audits = await harness.database.query<{
      action: string;
      actor_person_id: string;
      resource_id: string;
    }>(
      `SELECT action, actor_person_id, resource_id FROM audit_events
       WHERE action LIKE 'orientation.%' ORDER BY occurred_at`,
    );
    expect(audits.rows).toEqual([
      expect.objectContaining({
        action: 'orientation.started',
        actor_person_id: 'person-protected-pat',
        resource_id: 'person-protected-pat',
      }),
      expect.objectContaining({
        action: 'orientation.step_completed',
        actor_person_id: 'person-protected-pat',
        resource_id: 'person-protected-pat',
      }),
    ]);

    const deferredHelper = await harness.app.inject({
      method: 'GET',
      url: '/v1/orientation?subjectPersonId=person-protected-pat',
      headers: browserHeaders(terry.cookie as string),
    });
    expect(deferredHelper.statusCode).toBe(403);
  }, 15_000);

  it('keeps customer and HQ sessions usable in one browser without audience confusion', async () => {
    harness = await createApiHarness();
    const alice = await login(harness.app, 'owner-alice');
    const heidi = await login(harness.app, 'hq-heidi', 'hq');
    const dualCookie = `${alice.cookie as string}; ${heidi.cookie as string}`;

    const customer = await harness.app.inject({
      method: 'GET',
      url: '/v1/checks',
      headers: { cookie: dualCookie, origin: customerOrigin },
    });
    const hq = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/overview',
      headers: { cookie: dualCookie, origin: hqOrigin },
    });
    expect(customer.statusCode).toBe(200);
    expect(hq.statusCode).toBe(200);
    expect(
      hq
        .json()
        .metrics.every(
          (metric: { dataState: string; source: string }) =>
            metric.dataState === 'local_development' && metric.source === 'local_development',
        ),
    ).toBe(true);
    expect(hq.json().alerts).toEqual([
      expect.objectContaining({
        dataState: 'local_development',
        message: expect.stringMatching(
          /synthetic seed fixtures.*local run.*not production evidence/iu,
        ),
      }),
    ]);

    const hqWithCustomerOnly = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/overview',
      headers: { cookie: alice.cookie as string, origin: hqOrigin },
    });
    const customerWithHqOnly = await harness.app.inject({
      method: 'GET',
      url: '/v1/checks',
      headers: { cookie: heidi.cookie as string, origin: customerOrigin },
    });
    expect(hqWithCustomerOnly.statusCode).toBe(401);
    expect(customerWithHqOnly.statusCode).toBe(401);

    const reviews = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/checks',
      headers: { cookie: heidi.cookie as string, origin: hqOrigin },
    });
    const households = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/households',
      headers: { cookie: heidi.cookie as string, origin: hqOrigin },
    });
    const revenue = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/revenue',
      headers: { cookie: heidi.cookie as string, origin: hqOrigin },
    });
    expect(reviews.statusCode).toBe(200);
    expect(reviews.body).not.toMatch(
      /encrypted_content|ciphertext|input_fingerprint|synthetic bank alert/iu,
    );
    expect(households.statusCode).toBe(200);
    expect(revenue.statusCode).toBe(200);
    expect(revenue.json().opportunities.some((item: { stale: boolean }) => item.stale)).toBe(true);
    const projectionAudits = await harness.database.query<{
      actor_person_id: string;
      resource_id: string;
      metadata: unknown;
    }>(
      `SELECT actor_person_id, resource_id, metadata FROM audit_events
       WHERE action = 'hq.metadata_projection.read' ORDER BY resource_id`,
    );
    expect(projectionAudits.rows).toEqual([
      expect.objectContaining({
        actor_person_id: 'person-hq-heidi',
        resource_id: 'owner_checks',
      }),
      expect.objectContaining({
        actor_person_id: 'person-hq-heidi',
        resource_id: 'owner_households',
      }),
    ]);
    expect(JSON.stringify(projectionAudits.rows)).not.toMatch(
      /household-sunrise|household-harbor|Sunrise Household|Harbor Household|analysis-seed/iu,
    );
  });

  it('rejects sponsor and organization-less HQ assignments before any global or managing scope is projected', async () => {
    harness = await createApiHarness();
    const now = harness.clock.now();
    const grantExpiry = new Date(now.getTime() + 60 * 60 * 1_000);
    await harness.database.query(
      `UPDATE employee_assignments
       SET organization_id = 'organization-synthetic-sponsor'
       WHERE id = 'employee-hq-heidi'`,
    );
    await harness.database.query(
      `UPDATE employee_assignments
       SET organization_id = NULL, role = 'hq_owner'
       WHERE id = 'employee-hq-riley'`,
    );
    await harness.database.query(
      `INSERT INTO employee_assignments(
         id, person_id, organization_id, role, status, created_at
       ) VALUES
         ('employee-hq-heidi-sponsor-support','person-hq-heidi',
          'organization-synthetic-sponsor','hq_support','active',$1),
         ('employee-hq-riley-null-support','person-hq-riley',NULL,'hq_support','active',$1)`,
      [now.toISOString()],
    );
    await harness.database.query(
      `INSERT INTO support_cases(
         household_id, id, purpose, status, opened_by_person_id, opened_at
       ) VALUES
         ('household-sunrise','support-case-sponsor-invalid',
          'CUSTOMER-SPONSOR-SECRET-MUST-NOT-SCOPE','open','person-owner-alice',$1),
         ('household-harbor','support-case-null-invalid',
          'CUSTOMER-NULL-SECRET-MUST-NOT-SCOPE','open','person-owner-bob',$1)`,
      [now.toISOString()],
    );
    await harness.database.query(
      `INSERT INTO support_case_assignments(
         household_id, case_id, employee_assignment_id, status, assigned_at
       ) VALUES
         ('household-sunrise','support-case-sponsor-invalid',
          'employee-hq-heidi-sponsor-support','active',$1),
         ('household-harbor','support-case-null-invalid',
          'employee-hq-riley-null-support','active',$1)`,
      [now.toISOString()],
    );
    await harness.database.query(
      `INSERT INTO restricted_access_grants(
         household_id, id, case_id, employee_assignment_id, resource_type,
         resource_id, purpose, assurance, status, granted_by_person_id,
         granted_at, expires_at
       ) VALUES
         ('household-sunrise','restricted-grant-sponsor-invalid',
          'support-case-sponsor-invalid','employee-hq-heidi-sponsor-support','artifact',
          'artifact-sponsor-invalid','CUSTOMER-SPONSOR-GRANT-MUST-NOT-SCOPE',
          'step_up_verified','active','person-owner-alice',$1,$2),
         ('household-harbor','restricted-grant-null-invalid',
          'support-case-null-invalid','employee-hq-riley-null-support','artifact',
          'artifact-null-invalid','CUSTOMER-NULL-GRANT-MUST-NOT-SCOPE',
          'step_up_verified','active','person-owner-bob',$1,$2)`,
      [now.toISOString(), grantExpiry.toISOString()],
    );

    const sessions = new SessionRepository(harness.database);
    const personas = [
      await login(harness.app, 'hq-heidi', 'hq'),
      await login(harness.app, 'hq-riley', 'hq'),
    ];
    const globalReadUrls = [
      '/v1/hq/overview',
      '/v1/hq/households',
      '/v1/hq/checks',
      '/v1/hq/provider-health',
      '/v1/hq/audit',
      '/v1/hq/revenue',
      '/v1/hq/business-os/owner-brief',
    ];
    const controlBefore = await harness.database.query<
      {
        kill_switch: boolean;
        updated_by_person_id: string | null;
        updated_at: unknown;
      } & Record<string, unknown>
    >(
      `SELECT kill_switch, updated_by_person_id, updated_at
       FROM automation_global_control WHERE control_key = 'global'`,
    );

    for (const persona of personas) {
      const issuedPrincipal = persona.body.principal as {
        readonly roles: readonly string[];
        readonly sessionId: string;
      };
      expect(issuedPrincipal.roles).not.toContain('hq_owner');
      expect(issuedPrincipal.roles).not.toContain('hq_support');
      const resolved = await sessions.resolve(issuedPrincipal.sessionId, 'hq', now);
      expect(resolved?.principal.employeeScopes).toEqual([]);
      expect(resolved?.principal.supportCaseScopes).toEqual([]);
      expect(resolved?.principal.restrictedAccessScopes).toEqual([]);

      const headers = browserHeaders(persona.cookie as string, hqOrigin);
      for (const url of globalReadUrls) {
        const denied = await harness.app.inject({ method: 'GET', url, headers });
        expect(denied.statusCode, url).toBe(403);
        expect(denied.body, url).not.toMatch(/Sunrise|Harbor|analysis-seed|CUSTOMER-/u);
      }
      const deniedMutation = await harness.app.inject({
        method: 'PUT',
        url: '/v1/hq/business-os/autonomy/global-control',
        headers,
        payload: { killSwitch: !controlBefore.rows[0]?.kill_switch },
      });
      expect(deniedMutation.statusCode).toBe(403);
    }
    const controlAfter = await harness.database.query<
      {
        kill_switch: boolean;
        updated_by_person_id: string | null;
        updated_at: unknown;
      } & Record<string, unknown>
    >(
      `SELECT kill_switch, updated_by_person_id, updated_at
       FROM automation_global_control WHERE control_key = 'global'`,
    );
    expect(controlAfter.rows).toEqual(controlBefore.rows);
  });

  it('limits reviewer and support employees to exact assigned, content-minimal queues', async () => {
    harness = await createApiHarness();
    await harness.database.query(
      `INSERT INTO hq_work_cases(
         id, case_kind, household_id, severity, state, routing_class, summary,
         assigned_person_id, created_at, updated_at
       ) VALUES (
         'case-unrelated-owner-review','fraud','household-harbor','critical','open',
         'trust_safety','Synthetic unrelated queue fixture','person-hq-heidi',$1,$1
       )`,
      [harness.clock.now().toISOString()],
    );
    await harness.database.query(
      `INSERT INTO support_cases(
         household_id, id, purpose, status, opened_by_person_id, opened_at
       ) VALUES (
         'household-harbor','support-case-unrelated-owner','Synthetic unrelated support case',
         'open','person-owner-bob',$1
       )`,
      [harness.clock.now().toISOString()],
    );
    await harness.database.query(
      `INSERT INTO support_case_assignments(
         household_id, case_id, employee_assignment_id, status, assigned_at
       ) VALUES (
         'household-harbor','support-case-unrelated-owner','employee-hq-heidi','active',$1
       )`,
      [harness.clock.now().toISOString()],
    );
    const riley = await login(harness.app, 'hq-riley', 'hq');
    const reviewerHeaders = { cookie: riley.cookie as string, origin: hqOrigin };
    const reviewerQueue = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/review-queue',
      headers: reviewerHeaders,
    });
    expect(reviewerQueue.statusCode).toBe(200);
    expect(reviewerQueue.json()).toEqual({
      projection: 'assigned_review_queue',
      truncated: false,
      cases: [
        expect.objectContaining({
          id: 'case-seeded-riley-review',
          severity: 'medium',
          state: 'open',
          routingClass: 'trust_safety',
          dataState: 'local_development',
        }),
      ],
    });
    expect(reviewerQueue.body).not.toMatch(
      /household|Sunrise|Harbor|analysis-seed|lower_concern|caution|high_concern|provider|summary|synthetic bank alert/iu,
    );
    await harness.database.query(
      `UPDATE hq_work_cases
       SET state = 'resolved', resolved_at = $2, updated_at = $2
       WHERE id = $1`,
      ['case-seeded-riley-review', harness.clock.now().toISOString()],
    );
    const reviewerAfterResolution = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/review-queue',
      headers: reviewerHeaders,
    });
    expect(reviewerAfterResolution.statusCode).toBe(200);
    expect(reviewerAfterResolution.json().cases).toEqual([]);
    for (const url of [
      '/v1/hq/checks',
      '/v1/hq/households',
      '/v1/hq/overview',
      '/v1/hq/audit',
      '/v1/hq/support-queue',
    ]) {
      const denied = await harness.app.inject({ method: 'GET', url, headers: reviewerHeaders });
      expect(denied.statusCode, url).toBe(403);
      expect(denied.body, url).not.toMatch(/Sunrise|Harbor|analysis-seed|high_concern/iu);
    }

    await harness.database.query(
      `UPDATE support_cases SET purpose = 'CUSTOMER-SECRET-MUST-NOT-PROJECT'
       WHERE household_id = 'household-sunrise' AND id = 'support-case-seeded-sam'`,
    );
    const sam = await login(harness.app, 'hq-sam', 'hq');
    const supportHeaders = { cookie: sam.cookie as string, origin: hqOrigin };
    const supportQueue = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/support-queue',
      headers: supportHeaders,
    });
    expect(supportQueue.statusCode).toBe(200);
    expect(supportQueue.json()).toEqual({
      projection: 'assigned_support_queue',
      truncated: false,
      cases: [
        expect.objectContaining({
          id: 'support-case-seeded-sam',
          householdId: 'household-sunrise',
          householdName: 'Sunrise Household',
          purposeCode: 'customer_support',
          status: 'open',
          dataState: 'local_development',
        }),
      ],
    });
    expect(supportQueue.body).not.toMatch(
      /CUSTOMER-SECRET-MUST-NOT-PROJECT|household-harbor|Harbor Household|analysis-seed|lower_concern|caution|high_concern|provider|orientation|entitlement|synthetic bank alert/iu,
    );
    await harness.database.query(
      `UPDATE support_case_assignments
       SET status = 'ended', ended_at = $2
       WHERE household_id = 'household-sunrise' AND case_id = $1
         AND employee_assignment_id = 'employee-hq-sam'`,
      ['support-case-seeded-sam', harness.clock.now().toISOString()],
    );
    const supportAfterAssignmentEnds = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/support-queue',
      headers: supportHeaders,
    });
    expect(supportAfterAssignmentEnds.statusCode).toBe(200);
    expect(supportAfterAssignmentEnds.json().cases).toEqual([]);
    for (const url of ['/v1/hq/checks', '/v1/hq/households', '/v1/hq/review-queue']) {
      const denied = await harness.app.inject({ method: 'GET', url, headers: supportHeaders });
      expect(denied.statusCode, url).toBe(403);
      expect(denied.body, url).not.toMatch(/Sunrise|Harbor|analysis-seed|high_concern/iu);
    }

    const projectionAudits = await harness.database.query<{
      actor_person_id: string;
      resource_id: string;
      metadata: unknown;
    }>(
      `SELECT actor_person_id, resource_id, metadata FROM audit_events
       WHERE action = 'hq.metadata_projection.read' ORDER BY resource_id`,
    );
    expect(projectionAudits.rows).toHaveLength(4);
    expect(projectionAudits.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actor_person_id: 'person-hq-riley',
          resource_id: 'assigned_review_queue',
        }),
        expect.objectContaining({
          actor_person_id: 'person-hq-sam',
          resource_id: 'assigned_support_queue',
        }),
      ]),
    );
    expect(JSON.stringify(projectionAudits.rows)).not.toMatch(
      /household-sunrise|household-harbor|Sunrise Household|Harbor Household|analysis-seed/iu,
    );
  });

  it('fails closed before releasing owner metadata when the required access audit cannot persist', async () => {
    harness = await createApiHarness();
    await harness.database.exec(`
      CREATE FUNCTION fail_hq_projection_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'hq.metadata_projection.read' THEN
          RAISE EXCEPTION 'forced projection audit failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER fail_hq_projection_audit
      BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION fail_hq_projection_audit();
    `);
    const heidi = await login(harness.app, 'hq-heidi', 'hq');
    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/households',
      headers: { cookie: heidi.cookie as string, origin: hqOrigin },
    });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toMatch(/Sunrise|Harbor|household-sunrise|household-harbor/iu);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
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
    const revenue = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/revenue',
      headers: { cookie: heidi.cookie as string, origin: hqOrigin },
    });
    expect(reviews.statusCode).toBe(200);
    expect(reviews.body).not.toMatch(
      /encrypted_content|ciphertext|input_fingerprint|synthetic bank alert/iu,
    );
    expect(revenue.statusCode).toBe(200);
    expect(revenue.json().opportunities.some((item: { stale: boolean }) => item.stale)).toBe(true);
  });

  it('limits an HQ reviewer to the review projection', async () => {
    harness = await createApiHarness();
    const riley = await login(harness.app, 'hq-riley', 'hq');
    const headers = { cookie: riley.cookie as string, origin: hqOrigin };
    const checks = await harness.app.inject({ method: 'GET', url: '/v1/hq/checks', headers });
    const overview = await harness.app.inject({ method: 'GET', url: '/v1/hq/overview', headers });
    const audit = await harness.app.inject({ method: 'GET', url: '/v1/hq/audit', headers });
    expect(checks.statusCode).toBe(200);
    expect(overview.statusCode).toBe(403);
    expect(audit.statusCode).toBe(403);
  });
});

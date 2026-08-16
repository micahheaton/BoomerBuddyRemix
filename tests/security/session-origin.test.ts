import { afterEach, describe, expect, it } from 'vitest';
import {
  bearerHeaders,
  browserHeaders,
  createApiHarness,
  customerOrigin,
  hqOrigin,
  login,
  type ApiHarness,
} from '../integration/support';

describe('session, audience, origin, and revocation security', () => {
  let harness: ApiHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('requires an exact trusted origin for browser sessions and cookie mutations', async () => {
    harness = await createApiHarness();
    const missingOrigin = await harness.app.inject({
      method: 'POST',
      url: '/v1/dev/sessions/customer',
      payload: { personaId: 'owner-alice' },
    });
    const wrongOrigin = await harness.app.inject({
      method: 'POST',
      url: '/v1/dev/sessions/customer',
      headers: { origin: hqOrigin },
      payload: { personaId: 'owner-alice' },
    });
    expect(missingOrigin.statusCode).toBe(403);
    expect(wrongOrigin.statusCode).toBe(403);

    const alice = await login(harness.app, 'owner-alice');
    const payload = { kind: 'text', content: 'A local message for an origin-bound request.' };
    const noCsrfOrigin = await harness.app.inject({
      method: 'POST',
      url: '/v1/checks',
      headers: { cookie: alice.cookie as string },
      payload,
    });
    const hqCsrfOrigin = await harness.app.inject({
      method: 'POST',
      url: '/v1/checks',
      headers: { cookie: alice.cookie as string, origin: hqOrigin },
      payload,
    });
    expect(noCsrfOrigin.statusCode).toBe(403);
    expect(hqCsrfOrigin.statusCode).toBe(403);
  }, 15_000);

  it('allows the required customer and HQ CORS methods and headers only for trusted origins', async () => {
    harness = await createApiHarness();
    for (const origin of [customerOrigin, hqOrigin]) {
      for (const method of ['PUT', 'DELETE']) {
        const preflight = await harness.app.inject({
          method: 'OPTIONS',
          url: '/v1/orientation/safe-word',
          headers: {
            origin,
            'access-control-request-method': method,
            'access-control-request-headers': 'content-type,authorization,x-bb-household-id',
          },
        });
        expect(preflight.statusCode).toBe(204);
        expect(preflight.headers['access-control-allow-origin']).toBe(origin);
        expect(preflight.headers['access-control-allow-methods']).toContain(method);
        expect(String(preflight.headers['access-control-allow-headers']).toLowerCase()).toContain(
          'x-bb-household-id',
        );
      }
    }
    const untrusted = await harness.app.inject({
      method: 'OPTIONS',
      url: '/v1/checks/example-id',
      headers: {
        origin: 'https://attacker.example',
        'access-control-request-method': 'DELETE',
      },
    });
    expect(untrusted.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('supports native mobile dev login without Origin but rejects an explicit untrusted origin', async () => {
    harness = await createApiHarness();
    const native = await harness.app.inject({
      method: 'POST',
      url: '/v1/dev/sessions/mobile',
      payload: { personaId: 'owner-alice' },
    });
    const untrusted = await harness.app.inject({
      method: 'POST',
      url: '/v1/dev/sessions/mobile',
      headers: { origin: 'https://attacker.example' },
      payload: { personaId: 'owner-alice' },
    });
    expect(native.statusCode).toBe(201);
    expect(native.json().token).toEqual(expect.any(String));
    expect(untrusted.statusCode).toBe(403);
    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/checks',
      headers: bearerHeaders(String(native.json().token)),
      payload: { kind: 'text', content: 'A local message sent from the native application.' },
    });
    expect(created.statusCode).toBe(201);
  });

  it('rejects cross-audience and ambiguous bearer-plus-cookie credentials', async () => {
    harness = await createApiHarness();
    const alice = await login(harness.app, 'owner-alice');
    const mobile = await login(harness.app, 'owner-alice', 'mobile');
    const heidi = await login(harness.app, 'hq-heidi', 'hq');
    const customerToHq = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/overview',
      headers: { cookie: alice.cookie as string, origin: hqOrigin },
    });
    const hqToCustomer = await harness.app.inject({
      method: 'GET',
      url: '/v1/checks',
      headers: { cookie: heidi.cookie as string, origin: customerOrigin },
    });
    const mobileToHq = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/overview',
      headers: bearerHeaders(mobile.token as string),
    });
    const ambiguous = await harness.app.inject({
      method: 'GET',
      url: '/v1/checks',
      headers: {
        cookie: alice.cookie as string,
        authorization: `Bearer ${mobile.token as string}`,
      },
    });
    expect(customerToHq.statusCode).toBe(401);
    expect(hqToCustomer.statusCode).toBe(401);
    expect(mobileToHq.statusCode).toBe(401);
    expect(ambiguous.statusCode).toBe(401);

    const validHqCookieAtCustomerOrigin = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/overview',
      headers: { cookie: heidi.cookie as string, origin: customerOrigin },
    });
    const validCustomerCookieAtHqOrigin = await harness.app.inject({
      method: 'GET',
      url: '/v1/checks',
      headers: { cookie: alice.cookie as string, origin: hqOrigin },
    });
    const dualAtWrongApp = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/overview',
      headers: {
        cookie: `${alice.cookie as string}; ${heidi.cookie as string}`,
        origin: customerOrigin,
      },
    });
    expect(validHqCookieAtCustomerOrigin.statusCode).toBe(403);
    expect(validCustomerCookieAtHqOrigin.statusCode).toBe(403);
    expect(dualAtWrongApp.statusCode).toBe(403);

    const customerMeAtHq = await harness.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: alice.cookie as string, origin: hqOrigin },
    });
    const hqMeAtCustomer = await harness.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: heidi.cookie as string, origin: customerOrigin },
    });
    const dualCookie = `${alice.cookie as string}; ${heidi.cookie as string}`;
    const customerMeWithBoth = await harness.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: dualCookie, origin: customerOrigin },
    });
    const hqMeWithBoth = await harness.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: dualCookie, origin: hqOrigin },
    });
    expect(customerMeAtHq.statusCode).toBe(401);
    expect(hqMeAtCustomer.statusCode).toBe(401);
    expect(customerMeWithBoth.json().principal.audience).toBe('customer');
    expect(hqMeWithBoth.json().principal.audience).toBe('hq');
  });

  it('invalidates revoked, expired, tampered, and disabled-identity sessions', async () => {
    harness = await createApiHarness();
    const revokedSession = await login(harness.app, 'owner-alice');
    const revoked = await harness.app.inject({
      method: 'DELETE',
      url: '/v1/sessions/current',
      headers: browserHeaders(revokedSession.cookie as string),
    });
    expect(revoked.statusCode).toBe(204);
    const afterRevoke = await harness.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: revokedSession.cookie as string, origin: customerOrigin },
    });
    expect(afterRevoke.statusCode).toBe(401);

    const expiring = await login(harness.app, 'owner-bob');
    harness.clock.advance(8 * 60 * 60 * 1_000 + 1);
    const afterExpiry = await harness.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: expiring.cookie as string, origin: customerOrigin },
    });
    expect(afterExpiry.statusCode).toBe(401);

    harness.clock.set(new Date('2026-08-15T12:00:00.000Z'));
    const disabled = await login(harness.app, 'protected-pat');
    await harness.database.query(
      `UPDATE identities SET status = 'disabled'
       WHERE issuer = 'boomerbuddy-dev' AND subject = 'protected-pat'`,
    );
    const afterDisable = await harness.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: disabled.cookie as string, origin: customerOrigin },
    });
    expect(afterDisable.statusCode).toBe(401);

    const cookie = disabled.cookie as string;
    const tampered = `${cookie.slice(0, -1)}${cookie.endsWith('a') ? 'b' : 'a'}`;
    const afterTamper = await harness.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: tampered, origin: customerOrigin },
    });
    expect(afterTamper.statusCode).toBe(401);
  });
});

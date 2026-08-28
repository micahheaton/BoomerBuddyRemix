import type { AppConfig } from '@boomerbuddy/config';
import { createLogger } from '@boomerbuddy/observability';
import {
  createPGliteDatabase,
  ProductionIdentityRepository,
  runMigrations,
  type Database,
} from '@boomerbuddy/persistence';
import type { IdentityTokenVerifier, VerifiedIdentityToken } from '@boomerbuddy/security';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../apps/api/src/app';

const now = new Date('2026-08-17T12:00:00.000Z');
const customerOrigin = 'https://customer.test';
const hqOrigin = 'https://hq.test';
const mobileAuthorizedParty = 'https://native-auth.test';
const customerIssuer = 'https://customer.clerk.test';
const hqIssuer = 'https://hq.clerk.test';

function config(): AppConfig {
  return {
    environment: 'production',
    api: { host: '127.0.0.1', port: 4000, trustedProxyHops: 0 },
    database: {
      driver: 'pglite',
      path: ':memory:',
      runMigrations: false,
      seedDemo: false,
    },
    identity: {
      allowDevelopmentIssuer: false,
      customerOrigins: [customerOrigin],
      hqOrigins: [hqOrigin],
      founderPersonId: 'person-production-founder',
      clerk: {
        customer: {
          issuer: customerIssuer,
          audience: 'boomerbuddy-customer',
          jwtKey: 'customer-key',
          authorizedParties: [customerOrigin],
          mobileAuthorizedParties: [mobileAuthorizedParty],
        },
        hq: {
          issuer: hqIssuer,
          audience: 'boomerbuddy-hq',
          jwtKey: 'hq-key',
          authorizedParties: [hqOrigin],
          maxSecondFactorAgeSeconds: 600,
        },
        founderSubject: 'user_production_founder',
      },
    },
    secrets: {
      session: Buffer.alloc(0),
      artifactEncryptionKey: Buffer.alloc(32, 7),
      fingerprintKey: Buffer.alloc(32, 11),
      safeWordPepper: Buffer.from('production-test-safe-word-pepper'),
      custodyClassification: 'replit_runtime_secret_beta',
    },
    commerce: { stripe: { mode: 'disabled' } },
    messaging: {
      twilio: {
        mode: 'disabled',
        runtimeNetworkPermitted: false,
        credentialLoadingPermitted: false,
      },
    },
    logLevel: 'error',
  };
}

function verified(
  audience: 'customer' | 'mobile' | 'hq',
  overrides: Partial<VerifiedIdentityToken> = {},
): VerifiedIdentityToken {
  const hq = audience === 'hq';
  return {
    issuer: hq ? hqIssuer : customerIssuer,
    subject: hq ? 'user_production_founder' : 'user_customer_one',
    providerSessionId: hq
      ? 'sess_hq_founder'
      : audience === 'mobile'
        ? 'jwt_mobile_one'
        : 'sess_customer_one',
    audience,
    issuedAt: new Date(now.getTime() - 30_000),
    expiresAt: new Date(now.getTime() + 60_000),
    ...(audience === 'mobile' ? {} : { authorizedParty: hq ? hqOrigin : customerOrigin }),
    ...(hq ? { firstFactorAgeSeconds: 60, secondFactorAgeSeconds: 60 } : {}),
    ...overrides,
  };
}

function verifiedHqFactors(input: {
  readonly providerSessionId: string;
  readonly firstFactorAgeSeconds?: number;
  readonly secondFactorAgeSeconds?: number;
}): VerifiedIdentityToken {
  return {
    issuer: hqIssuer,
    subject: 'user_production_founder',
    providerSessionId: input.providerSessionId,
    audience: 'hq',
    issuedAt: new Date(now.getTime() - 30_000),
    expiresAt: new Date(now.getTime() + 60_000),
    authorizedParty: hqOrigin,
    ...(input.firstFactorAgeSeconds === undefined
      ? {}
      : { firstFactorAgeSeconds: input.firstFactorAgeSeconds }),
    ...(input.secondFactorAgeSeconds === undefined
      ? {}
      : { secondFactorAgeSeconds: input.secondFactorAgeSeconds }),
  };
}

describe('production identity authentication boundary', () => {
  let database: Database;
  let app: FastifyInstance;
  let verifier: IdentityTokenVerifier;

  beforeEach(async () => {
    database = await createPGliteDatabase(':memory:');
    await runMigrations(database);
    await new ProductionIdentityRepository(database).bootstrapFounder({
      issuer: hqIssuer,
      subject: 'user_production_founder',
      founderPersonId: 'person-production-founder',
      correlationId: 'correlation-production-founder',
      now,
    });
    verifier = {
      verify: vi.fn(async (input) => {
        if (input.token === 'valid-customer-token') return verified('customer');
        if (input.token === 'valid-hq-token') return verified('hq');
        if (input.token === 'stale-hq-token') {
          return verified('hq', {
            providerSessionId: 'sess_hq_founder_stale',
            secondFactorAgeSeconds: 600,
          });
        }
        if (input.token === 'missing-first-factor-hq-token')
          return verifiedHqFactors({
            providerSessionId: 'sess_hq_founder_missing_first',
            secondFactorAgeSeconds: 60,
          });
        if (input.token === 'missing-second-factor-hq-token')
          return verifiedHqFactors({
            providerSessionId: 'sess_hq_founder_missing_second',
            firstFactorAgeSeconds: 60,
          });
        if (input.token === 'future-factor-hq-token')
          return verifiedHqFactors({
            providerSessionId: 'sess_hq_founder_future_factor',
            firstFactorAgeSeconds: 60,
            secondFactorAgeSeconds: -1,
          });
        if (input.token === 'boundary-factor-hq-token')
          return verifiedHqFactors({
            providerSessionId: 'sess_hq_founder_boundary_factor',
            firstFactorAgeSeconds: 599,
            secondFactorAgeSeconds: 600,
          });
        if (input.token === 'inside-boundary-hq-token')
          return verifiedHqFactors({
            providerSessionId: 'sess_hq_founder_inside_boundary',
            firstFactorAgeSeconds: 599,
            secondFactorAgeSeconds: 599,
          });
        if (input.token === 'valid-mobile-token') return verified('mobile');
        if (input.token === 'allowlisted-mobile-party-token')
          return verified('mobile', {
            providerSessionId: 'jwt_mobile_allowlisted',
            authorizedParty: mobileAuthorizedParty,
          });
        if (input.token === 'swapped-customer-token') return verified('customer');
        if (input.token === 'swapped-mobile-audience-token') return verified('customer');
        if (input.token === 'mobile-browser-party-token')
          return verified('mobile', { authorizedParty: customerOrigin });
        throw new Error('invalid token');
      }),
    };
    app = await buildApp({
      config: config(),
      database,
      closeDatabase: false,
      initialize: false,
      now: () => now,
      identityTokenVerifier: verifier,
      logger: createLogger({ level: 'error', sink: () => undefined, clock: () => now }),
    });
  });

  afterEach(async () => {
    await app.close();
    await database.close();
  });

  it('bootstraps a verified customer into one server-owned empty admin household', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { origin: customerOrigin, cookie: '__session=valid-customer-token' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      principal: {
        audience: 'customer',
        roles: ['household_administrator'],
        households: [
          {
            membershipKind: 'member',
            isAdministrator: true,
            isProtectedMember: false,
            capabilities: [],
          },
        ],
      },
    });
    const bootstrap = await database.query(
      `SELECT bootstrap.identity_id FROM production_customer_bootstraps bootstrap
       WHERE bootstrap.issuer = $1 AND bootstrap.subject = $2`,
      [customerIssuer, 'user_customer_one'],
    );
    const entitlements = await database.query('SELECT id FROM entitlement_grants');
    expect(bootstrap.rowCount).toBe(1);
    expect(entitlements.rowCount).toBe(0);
  });

  it('finds but never bootstraps an exact preprovisioned HQ identity', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { origin: hqOrigin, cookie: '__session=valid-hq-token' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      principal: {
        personId: 'person-production-founder',
        audience: 'hq',
        roles: ['hq_owner'],
        households: [],
      },
    });
    const bootstraps = await database.query(
      'SELECT identity_id FROM production_customer_bootstraps',
    );
    expect(bootstraps.rowCount).toBe(0);
  });

  it('accepts only a bearer-only mobile token in the customer identity realm', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: 'Bearer valid-mobile-token' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      principal: {
        audience: 'mobile',
        roles: ['household_administrator'],
      },
    });
    expect(verifier.verify).toHaveBeenCalledWith({
      token: 'valid-mobile-token',
      audience: 'mobile',
      realm: config().identity.clerk?.customer,
      now,
    });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/me',
          headers: { authorization: 'Bearer allowlisted-mobile-party-token' },
        })
      ).statusCode,
    ).toBe(200);

    for (const headers of [
      { authorization: 'Bearer valid-mobile-token', origin: customerOrigin },
      { authorization: 'Bearer valid-mobile-token', cookie: 'analytics=present' },
      { authorization: 'Bearer swapped-mobile-audience-token' },
      { authorization: 'Bearer mobile-browser-party-token' },
    ]) {
      const rejected = await app.inject({ method: 'GET', url: '/v1/me', headers });
      expect(rejected.statusCode).toBe(401);
    }
  });

  it('keeps billing-authority operations inside the verified HQ founder realm', async () => {
    const hq = await app.inject({
      method: 'GET',
      url: '/v1/hq/billing-authorities/household-not-present',
      headers: { origin: hqOrigin, cookie: '__session=valid-hq-token' },
    });
    expect(hq.statusCode).toBe(404);

    const customer = await app.inject({
      method: 'GET',
      url: '/v1/hq/billing-authorities/household-not-present',
      headers: { origin: customerOrigin, cookie: '__session=valid-customer-token' },
    });
    expect(customer.statusCode).toBe(401);

    const missingTrustedOrigin = await app.inject({
      method: 'GET',
      url: '/v1/hq/billing-authorities/household-not-present',
      headers: { cookie: '__session=valid-hq-token' },
    });
    expect(missingTrustedOrigin.statusCode).toBe(401);
  });

  it('requires recent HQ MFA before grant or revoke can create durable side effects', async () => {
    const durableSideEffectCounts = () =>
      database.query<{
        readonly authorities: number;
        readonly events: number;
        readonly audits: number;
        readonly outbox: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM household_billing_authorities) AS authorities,
           (SELECT count(*)::int FROM household_billing_authority_events) AS events,
           (SELECT count(*)::int FROM audit_events) AS audits,
           (SELECT count(*)::int FROM outbox_events) AS outbox`,
      );
    const sideEffectsBefore = await durableSideEffectCounts();
    const rejectedTokens = [
      'missing-first-factor-hq-token',
      'missing-second-factor-hq-token',
      'future-factor-hq-token',
      'boundary-factor-hq-token',
      'stale-hq-token',
    ];
    let sequence = 1;
    for (const token of rejectedTokens) {
      for (const action of ['grant', 'revoke'] as const) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/hq/billing-authorities/household-not-present/person-not-present/transitions',
          headers: {
            origin: hqOrigin,
            cookie: `__session=${token}`,
            'idempotency-key': `billing-authority:${action}:mfa-denied-${String(sequence).padStart(4, '0')}`,
          },
          payload: {
            action,
            reasonCode:
              action === 'grant'
                ? 'customer_billing_consent_verified'
                : 'customer_billing_consent_withdrawn',
          },
        });
        expect(response.statusCode, `${token}/${action}: ${response.body}`).toBe(403);
        sequence += 1;
      }
    }

    const malformedAfterStaleMfa = await app.inject({
      method: 'POST',
      url: '/v1/hq/billing-authorities/not-a-valid-id/not-a-valid-id/transitions',
      headers: { origin: hqOrigin, cookie: '__session=stale-hq-token' },
      payload: { unexpected: 'content' },
    });
    expect(malformedAfterStaleMfa.statusCode).toBe(403);

    const insideBoundary = await app.inject({
      method: 'POST',
      url: '/v1/hq/billing-authorities/household-not-present/person-not-present/transitions',
      headers: {
        origin: hqOrigin,
        cookie: '__session=inside-boundary-hq-token',
        'idempotency-key': 'billing-authority:grant:mfa-inside-boundary-0001',
      },
      payload: { action: 'grant', reasonCode: 'customer_billing_consent_verified' },
    });
    expect(insideBoundary.statusCode, insideBoundary.body).toBe(404);

    const sideEffectsAfter = await durableSideEffectCounts();
    expect(sideEffectsAfter.rows).toEqual(sideEffectsBefore.rows);
  });

  it('keeps secret-free Stripe control reads owner-only and behind recent MFA', async () => {
    const owner = await app.inject({
      method: 'GET',
      url: '/v1/hq/commerce/stripe/status?environment=production',
      headers: { origin: hqOrigin, cookie: '__session=valid-hq-token' },
    });
    expect(owner.statusCode, owner.body).toBe(200);
    expect(owner.json()).toEqual({
      environment: 'production',
      preflight: { state: 'unknown' },
      eligibleHouseholds: [],
      evidence: [],
    });
    expect(owner.body).not.toMatch(/secret|apiKey|accountId|providerProduct|raw/u);

    for (const url of [
      '/v1/hq/commerce/stripe/initiation-control?environment=production',
      '/v1/hq/commerce/stripe/cohort-control?environment=production',
      '/v1/hq/commerce/stripe/status?environment=production',
    ]) {
      const staleMfa = await app.inject({
        method: 'GET',
        url,
        headers: { origin: hqOrigin, cookie: '__session=stale-hq-token' },
      });
      expect(staleMfa.statusCode, `${url}: ${staleMfa.body}`).toBe(403);
    }

    const customer = await app.inject({
      method: 'GET',
      url: '/v1/hq/commerce/stripe/status?environment=production',
      headers: { origin: customerOrigin, cookie: '__session=valid-customer-token' },
    });
    expect(customer.statusCode).toBe(401);
  });

  it.each([
    ['missing trusted origin', { cookie: '__session=valid-customer-token' }],
    ['wrong trusted origin', { origin: hqOrigin, cookie: '__session=swapped-customer-token' }],
    ['bearer transport', { origin: customerOrigin, authorization: 'Bearer valid-customer-token' }],
    [
      'legacy cookie',
      { origin: customerOrigin, cookie: 'bb_customer_session=valid-customer-token' },
    ],
    [
      'legacy cookie mixed with Clerk',
      {
        origin: customerOrigin,
        cookie: '__session=valid-customer-token; bb_customer_session=legacy',
      },
    ],
    [
      'unfiltered cookie mixed with Clerk',
      {
        origin: customerOrigin,
        cookie: '__session=valid-customer-token; analytics_cookie=unexpected',
      },
    ],
  ])('rejects %s', async (_name, headers) => {
    const response = await app.inject({ method: 'GET', url: '/v1/me', headers });
    expect(response.statusCode).toBe(401);
  });

  it('does not resurrect a locally revoked provider session id', async () => {
    const headers = { origin: customerOrigin, cookie: '__session=valid-customer-token' };
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers })).statusCode).toBe(200);
    const logout = await app.inject({ method: 'DELETE', url: '/v1/sessions/current', headers });
    expect(logout.statusCode).toBe(204);
    expect(logout.headers['set-cookie']).toContain('__session=;');
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers })).statusCode).toBe(401);
  });
});

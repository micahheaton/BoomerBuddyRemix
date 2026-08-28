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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app';

const now = new Date('2026-08-17T12:00:00.000Z');
const customerOrigin = 'https://customer.test';
const hqOrigin = 'https://hq.test';
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
      artifactEncryptionKey: Buffer.alloc(32, 17),
      fingerprintKey: Buffer.alloc(32, 19),
      safeWordPepper: Buffer.from('production-family-safe-word-pepper'),
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

function customerToken(
  subject: string,
  providerSessionId: string,
  firstFactorAgeSeconds = 30,
): VerifiedIdentityToken {
  return {
    issuer: customerIssuer,
    subject,
    providerSessionId,
    audience: 'customer',
    issuedAt: new Date(now.getTime() - 30_000),
    expiresAt: new Date(now.getTime() + 60_000),
    authorizedParty: customerOrigin,
    firstFactorAgeSeconds,
  };
}

describe('production Trusted Circle identity binding', () => {
  let database: Database;
  let app: FastifyInstance;
  const firstHeaders = { origin: customerOrigin, cookie: '__session=customer-one-token' };

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
    const verifier: IdentityTokenVerifier = {
      verify: async ({ token }) => {
        if (token === 'customer-one-token') {
          return customerToken('user_customer_one', 'sess_customer_one');
        }
        if (token === 'customer-two-token') {
          return customerToken('user_customer_two', 'sess_customer_two');
        }
        if (token === 'customer-one-stale-token') {
          return customerToken('user_customer_one', 'sess_customer_one', 600);
        }
        throw new Error('invalid token');
      },
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

  it('uses an opaque rotatable recipient code without granting invitation authority', async () => {
    const first = await app.inject({ method: 'GET', url: '/v1/me', headers: firstHeaders });
    const secondHeaders = { origin: customerOrigin, cookie: '__session=customer-two-token' };
    const second = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: secondHeaders,
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const householdId = String(first.json().principal.households[0].id);
    const codeState = () =>
      database.query<{
        codes: number;
        rate_buckets: number;
        audit_events: number;
        outbox_events: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM trusted_circle_recipient_codes) AS codes,
           (SELECT count(*)::int FROM trusted_circle_authenticated_rate_buckets)
             AS rate_buckets,
           (SELECT count(*)::int FROM audit_events) AS audit_events,
           (SELECT count(*)::int FROM outbox_events) AS outbox_events`,
      );
    const beforeStaleCodeAttempt = await codeState();
    const staleCodeAttempt = await app.inject({
      method: 'POST',
      url: '/v1/family/recipient-connection-codes',
      headers: { origin: customerOrigin, cookie: '__session=customer-one-stale-token' },
      payload: {},
    });
    expect(staleCodeAttempt.statusCode, staleCodeAttempt.body).toBe(403);
    expect(staleCodeAttempt.json().error).toMatchObject({
      message: 'Sign in again before changing household access',
      details: {
        action: 'sign_in_again',
        reason: 'recent_authentication_required',
      },
    });
    expect((await codeState()).rows).toEqual(beforeStaleCodeAttempt.rows);
    const firstCode = await app.inject({
      method: 'POST',
      url: '/v1/family/recipient-connection-codes',
      headers: secondHeaders,
      payload: {},
    });
    const secondCode = await app.inject({
      method: 'POST',
      url: '/v1/family/recipient-connection-codes',
      headers: secondHeaders,
      payload: {},
    });
    expect(firstCode.statusCode, firstCode.body).toBe(201);
    expect(secondCode.statusCode, secondCode.body).toBe(201);
    const firstRecipientCode = String(firstCode.json().recipientConnectionCode);
    const recipientConnectionCode = String(secondCode.json().recipientConnectionCode);
    expect(firstRecipientCode).not.toBe(recipientConnectionCode);

    const beforeStaleAttempt = await database.query<{
      invitations: number;
      member_invitations: number;
      rate_buckets: number;
      active_codes: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM invitations) AS invitations,
         (SELECT count(*)::int FROM household_member_invitations) AS member_invitations,
         (SELECT count(*)::int FROM trusted_circle_authenticated_rate_buckets) AS rate_buckets,
         (SELECT count(*)::int FROM trusted_circle_recipient_codes WHERE state = 'active')
           AS active_codes`,
    );
    const staleAttempt = await app.inject({
      method: 'POST',
      url: '/v1/family/member-invitations',
      headers: {
        origin: customerOrigin,
        cookie: '__session=customer-one-stale-token',
        'x-bb-household-id': householdId,
      },
      payload: { recipientConnectionCode },
    });
    expect(staleAttempt.statusCode, staleAttempt.body).toBe(403);
    expect(staleAttempt.json().error).toMatchObject({
      message: 'Sign in again before changing household access',
      details: {
        action: 'sign_in_again',
        reason: 'recent_authentication_required',
      },
    });
    const afterStaleAttempt = await database.query<{
      invitations: number;
      member_invitations: number;
      rate_buckets: number;
      active_codes: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM invitations) AS invitations,
         (SELECT count(*)::int FROM household_member_invitations) AS member_invitations,
         (SELECT count(*)::int FROM trusted_circle_authenticated_rate_buckets) AS rate_buckets,
         (SELECT count(*)::int FROM trusted_circle_recipient_codes WHERE state = 'active')
           AS active_codes`,
    );
    expect(afterStaleAttempt.rows).toEqual(beforeStaleAttempt.rows);

    const request = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/v1/family/invitations',
        headers: { ...firstHeaders, 'x-bb-household-id': householdId },
        payload: {
          permissions: ['view_shared_checks'],
          ...payload,
        },
      });

    expect((await request({})).statusCode).toBe(400);
    expect((await request({ intendedCustomerSubject: 'user_customer_two' })).statusCode).toBe(400);
    expect(
      (
        await request({
          recipientConnectionCode,
          householdId: 'household-attacker',
          role: 'hq_owner',
        })
      ).statusCode,
    ).toBe(400);

    // A recipient-created code identifies the exact active account, but it grants no invitation
    // authority to an administrator who has not separately enrolled as protected.
    expect((await request({ recipientConnectionCode })).statusCode).toBe(403);
    expect((await database.query('SELECT id FROM invitations')).rowCount).toBe(0);
    const codeRows = await database.query<{
      state: string;
      code_fingerprint: string;
    }>('SELECT state, code_fingerprint FROM trusted_circle_recipient_codes ORDER BY created_at');
    expect(codeRows.rows.map((row) => row.state)).toEqual(['rotated', 'active']);
    expect(JSON.stringify(codeRows.rows)).not.toContain(firstRecipientCode);
    expect(JSON.stringify(codeRows.rows)).not.toContain(recipientConnectionCode);
    const evidence = await database.query<{ payload: unknown }>(
      `SELECT payload FROM outbox_events
       WHERE aggregate_type = 'recipient_connection_code' ORDER BY occurred_at`,
    );
    expect(JSON.stringify(evidence.rows)).not.toContain(firstRecipientCode);
    expect(JSON.stringify(evidence.rows)).not.toContain(recipientConnectionCode);
  });
});

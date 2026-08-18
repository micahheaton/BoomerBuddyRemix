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

function customerToken(subject: string, providerSessionId: string): VerifiedIdentityToken {
  return {
    issuer: customerIssuer,
    subject,
    providerSessionId,
    audience: 'customer',
    issuedAt: new Date(now.getTime() - 30_000),
    expiresAt: new Date(now.getTime() + 60_000),
    authorizedParty: customerOrigin,
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

  it('requires one exact active customer subject and rejects self or client authority fields', async () => {
    const first = await app.inject({ method: 'GET', url: '/v1/me', headers: firstHeaders });
    const second = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { origin: customerOrigin, cookie: '__session=customer-two-token' },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const householdId = String(first.json().principal.households[0].id);
    const request = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/v1/family/invitations',
        headers: { ...firstHeaders, 'x-bb-household-id': householdId },
        payload: {
          inviteeDisplayName: 'Ignored client display name',
          permissions: ['view_shared_checks'],
          ...payload,
        },
      });

    expect((await request({})).statusCode).toBe(400);
    expect((await request({ intendedCustomerSubject: 'user_customer_missing' })).statusCode).toBe(
      404,
    );
    expect((await request({ intendedCustomerSubject: 'user_customer_one' })).statusCode).toBe(400);
    expect(
      (
        await request({
          intendedCustomerSubject: 'user_customer_two',
          householdId: 'household-attacker',
          role: 'hq_owner',
        })
      ).statusCode,
    ).toBe(400);

    // The exact second identity resolves successfully, then the server-side protected-member
    // authorization gate denies this administrator-only bootstrap. Identity lookup alone grants
    // neither enrollment nor invitation authority.
    expect((await request({ intendedCustomerSubject: 'user_customer_two' })).statusCode).toBe(403);
    expect((await database.query('SELECT id FROM invitations')).rowCount).toBe(0);
  });
});

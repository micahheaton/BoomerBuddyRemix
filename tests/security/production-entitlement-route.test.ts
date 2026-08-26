import type { AppConfig } from '@boomerbuddy/config';
import { createLogger } from '@boomerbuddy/observability';
import {
  createPGliteDatabase,
  EntitlementRepository,
  ProductionIdentityRepository,
  runMigrations,
  type Database,
  type HouseholdEntitlements,
} from '@boomerbuddy/persistence';
import type { IdentityTokenVerifier, VerifiedIdentityToken } from '@boomerbuddy/security';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../apps/api/src/app';

const now = new Date('2026-08-26T12:00:00.000Z');
const customerOrigin = 'https://customer.test';
const customerIssuer = 'https://customer.clerk.test';
const hqIssuer = 'https://hq.clerk.test';
const customerHeaders = { origin: customerOrigin, cookie: '__session=customer-token' };

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
      hqOrigins: ['https://hq.test'],
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
          authorizedParties: ['https://hq.test'],
          maxSecondFactorAgeSeconds: 600,
        },
        founderSubject: 'user_production_founder',
      },
    },
    secrets: {
      session: Buffer.alloc(0),
      artifactEncryptionKey: Buffer.alloc(32, 17),
      fingerprintKey: Buffer.alloc(32, 19),
      safeWordPepper: Buffer.from('production-entitlement-route-test-pepper'),
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

function verifiedCustomerToken(): VerifiedIdentityToken {
  return {
    issuer: customerIssuer,
    subject: 'user_production_customer',
    providerSessionId: 'session_production_customer',
    audience: 'customer',
    issuedAt: new Date(now.getTime() - 30_000),
    expiresAt: new Date(now.getTime() + 60_000),
    authorizedParty: customerOrigin,
  };
}

type FixtureSource = 'local' | 'sponsor' | 'web';

function fixture(
  householdId: string,
  source: FixtureSource,
  options: { readonly includeContaminants?: boolean } = {},
): HouseholdEntitlements {
  const sponsor = source === 'sponsor';
  const paid = source === 'web';
  const subscriptionId = `subscription-${source}`;
  const grantId = `grant-${source}`;
  const plan = sponsor
    ? {
        id: 'founding_family_beta_v2',
        key: 'family',
        version: 2,
        displayName: 'Founding Family beta sponsor benefit',
        state: 'active',
        prices: [
          {
            interval: 'month',
            amountMinor: 0,
            currency: 'USD',
            kind: 'founding_experiment',
          },
        ],
      }
    : {
        id: 'family_v1',
        key: 'family',
        version: 1,
        displayName: 'Family',
        state: 'hypothesis',
        prices: [{ interval: 'month', amountMinor: 1_499, currency: 'USD', kind: 'list' }],
      };
  const primarySource = {
    subscriptionId,
    planVersionId: plan.id,
    planKey: plan.key,
    planVersion: plan.version,
    source,
    lifecycle: 'active',
    precedence: 500,
    accessState: 'effective',
    contributingGrantIds: [grantId],
  };
  const primaryGrant = {
    id: grantId,
    subject: { kind: 'household', householdId },
    source,
    planVersionId: plan.id,
    subscriptionId,
    capabilities: ['check:text', 'history:read'],
    startsAt: new Date('2026-08-01T00:00:00.000Z'),
    sourceVerified: true,
    precedence: 500,
  };
  const primaryRecord = {
    subscription: {
      id: subscriptionId,
      source,
      lifecycle: 'active',
      sourceVerified: true,
      precedence: 500,
      startsAt: new Date('2026-08-01T00:00:00.000Z'),
    },
    reconciliationState: paid ? 'reconciled' : 'not_required',
    plan,
    planState: plan.state,
  };
  const localGrant = {
    ...primaryGrant,
    id: 'grant-local-contaminant',
    source: 'local',
    subscriptionId: 'subscription-local-contaminant',
    planVersionId: 'family_v1',
    precedence: 300,
  };
  const localSource = {
    ...primarySource,
    subscriptionId: 'subscription-local-contaminant',
    planVersionId: 'family_v1',
    planVersion: 1,
    source: 'local',
    precedence: 300,
    contributingGrantIds: ['grant-local-contaminant'],
  };
  const pendingGrant = {
    ...primaryGrant,
    id: 'grant-pending-contaminant',
    source: 'web',
    subscriptionId: 'subscription-pending-contaminant',
    planVersionId: 'family_v1',
    sourceVerified: false,
    precedence: 600,
  };
  const pendingSource = {
    ...primarySource,
    subscriptionId: 'subscription-pending-contaminant',
    planVersionId: 'family_v1',
    planVersion: 1,
    source: 'web',
    lifecycle: 'pending',
    precedence: 600,
    accessState: 'unverified_source',
    contributingGrantIds: [],
  };
  return {
    householdId,
    capabilities: ['check:text', 'history:read'],
    grants: options.includeContaminants ? [primaryGrant, localGrant, pendingGrant] : [primaryGrant],
    portfolio: {
      accessState: 'effective',
      primarySource,
      sources: options.includeContaminants
        ? [primarySource, localSource, pendingSource]
        : [primarySource],
      contributingGrantIds: options.includeContaminants
        ? [grantId, 'grant-local-contaminant']
        : [grantId],
      allowances: [
        {
          kind: 'protected_members',
          limit: 3,
          used: 1,
          remaining: 2,
          state: 'available',
          sourceSubscriptionId: subscriptionId,
          sourcePlanVersionId: plan.id,
        },
        ...(options.includeContaminants
          ? [
              {
                kind: 'trusted_circle_participants',
                limit: 6,
                used: 0,
                remaining: 6,
                state: 'available',
                sourceSubscriptionId: 'subscription-local-contaminant',
                sourcePlanVersionId: 'family_v1',
              },
            ]
          : []),
      ],
    },
    sources: [primaryRecord],
  } as unknown as HouseholdEntitlements;
}

describe('production entitlement route projection', () => {
  let database: Database;
  let app: FastifyInstance;
  let householdId: string;

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
    const identityTokenVerifier: IdentityTokenVerifier = {
      verify: async () => verifiedCustomerToken(),
    };
    app = await buildApp({
      config: config(),
      database,
      closeDatabase: false,
      initialize: false,
      now: () => now,
      identityTokenVerifier,
      logger: createLogger({ level: 'error', sink: () => undefined, clock: () => now }),
    });
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: customerHeaders });
    expect(me.statusCode).toBe(200);
    householdId = String(me.json().principal.households[0].id);
    const personId = String(me.json().principal.personId);
    await database.query(
      `INSERT INTO household_billing_authorities(
         household_id, person_id, status, granted_by_person_id, granted_at, grant_source
       ) VALUES ($1,$2,'active',$2,$3,'household_member')`,
      [householdId, personId, now.toISOString()],
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    await database.close();
  });

  async function entitlements(value: HouseholdEntitlements) {
    vi.spyOn(EntitlementRepository.prototype, 'forHousehold').mockResolvedValue(value);
    return app.inject({ method: 'GET', url: '/v1/entitlements', headers: customerHeaders });
  }

  it('returns empty production diagnostics for a local-only portfolio', async () => {
    const response = await entitlements(fixture(householdId, 'local'));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      subject: { kind: 'household', id: householdId },
      capabilities: [],
      grants: [],
      commerce: {
        accessState: 'no_effective_context',
        primary: null,
        sources: [],
        allowances: [],
        mode: 'canonical',
        hypothesis: false,
      },
      environment: 'production',
    });
  });

  it('returns only an exact effective sponsor projection', async () => {
    const response = await entitlements(
      fixture(householdId, 'sponsor', { includeContaminants: true }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      subject: { kind: 'household', id: householdId },
      capabilities: ['check:text', 'history:read'],
      grants: [],
      commerce: {
        accessState: 'effective',
        primary: {
          subscriptionId: 'subscription-sponsor',
          source: 'sponsor',
          lifecycle: 'active',
          precedence: 500,
          sourceVerified: true,
          reconciliationState: 'not_required',
          startsAt: '2026-08-01T00:00:00.000Z',
          plan: {
            id: 'founding_family_beta_v2',
            key: 'family',
            version: 2,
            displayName: 'Sponsored Family access',
            state: 'active',
            prices: [],
          },
        },
        sources: [],
        allowances: [
          {
            kind: 'protected_members',
            limit: 3,
            used: 1,
            remaining: 2,
            state: 'available',
            sourceSubscriptionId: 'subscription-sponsor',
            sourcePlanVersionId: 'founding_family_beta_v2',
          },
        ],
        mode: 'canonical',
        hypothesis: false,
      },
      environment: 'production',
    });
    expect(response.body).not.toMatch(
      /grant-sponsor|local-contaminant|pending-contaminant|founding_experiment/,
    );
  });

  it('pins a future effective paid-family route response to monthly USD 14.99', async () => {
    // This serializer fixture begins after a future resolver repair has produced effective paid
    // access. It does not claim that the current production resolver can make family_v1 effective.
    const response = await entitlements(fixture(householdId, 'web'));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      subject: { kind: 'household', id: householdId },
      capabilities: ['check:text', 'history:read'],
      grants: [],
      commerce: {
        accessState: 'effective',
        primary: {
          subscriptionId: 'subscription-web',
          source: 'web',
          lifecycle: 'active',
          precedence: 500,
          sourceVerified: true,
          reconciliationState: 'reconciled',
          startsAt: '2026-08-01T00:00:00.000Z',
          plan: {
            id: 'family_v1',
            key: 'family',
            version: 1,
            displayName: 'Family',
            state: 'active',
            prices: [{ interval: 'month', amountMinor: 1_499, currency: 'USD', kind: 'list' }],
          },
        },
        sources: [],
        allowances: [
          {
            kind: 'protected_members',
            limit: 3,
            used: 1,
            remaining: 2,
            state: 'available',
            sourceSubscriptionId: 'subscription-web',
            sourcePlanVersionId: 'family_v1',
          },
        ],
        mode: 'canonical',
        hypothesis: false,
      },
      environment: 'production',
    });
    expect(response.body).not.toMatch(/14900|grant-web|"hypothesis":true|local_mock|development/);
  });
});

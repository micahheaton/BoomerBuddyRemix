import type { AppConfig } from '@boomerbuddy/config';
import type { StripeTransport } from '@boomerbuddy/integrations';
import { createLogger } from '@boomerbuddy/observability';
import {
  CommerceRuntimeRepository,
  createPGliteDatabase,
  runMigrations,
  seedDemoData,
  type Database,
} from '@boomerbuddy/persistence';
import { ClerkSessionTokenVerifier } from '@boomerbuddy/security';
import { testArtifactProtection } from '@boomerbuddy/testkit';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../apps/api/src/app';
import {
  customerBillingReverificationEvidence,
  customerBillingReverificationHint,
  customerBillingSecondFactorMaximumAgeSeconds,
  type AuthContext,
} from '../../apps/api/src/auth';

const now = new Date('2026-08-25T12:00:00.000Z');
const nowSeconds = Math.floor(now.getTime() / 1_000);
const customerOrigin = 'https://customer.test';
const customerIssuer = 'https://customer.clerk.test';
const customerSubject = 'user_customer_billing_mfa';

function auth(input: {
  readonly firstFactorAgeSeconds?: number;
  readonly secondFactorAgeSeconds?: number;
  readonly reverificationId?: string;
}): AuthContext {
  return {
    audience: 'customer',
    transport: 'cookie',
    resolved: {} as AuthContext['resolved'],
    principal: {} as AuthContext['principal'],
    assurance: {
      kind: 'clerk',
      ...input,
    },
  };
}

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
      founderPersonId: 'person-hq-heidi',
      clerk: {
        customer: {
          issuer: customerIssuer,
          audience: 'boomerbuddy-customer',
          jwtKey: 'customer-key',
          authorizedParties: [customerOrigin],
        },
        hq: {
          issuer: 'https://hq.clerk.test',
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
      artifactEncryptionKey: Buffer.alloc(32, 7),
      fingerprintKey: Buffer.alloc(32, 11),
      safeWordPepper: Buffer.from('production-test-safe-word-pepper'),
      custodyClassification: 'replit_runtime_secret_beta',
    },
    commerce: {
      stripe: {
        mode: 'test',
        environment: 'test',
        accountId: 'acct_fixture1234',
        apiKey: 'rk_test_fixture_12345678',
        webhookSecret: 'whsec_fixture_12345678',
        apiVersion: '2026-07-29.dahlia',
        runtimeNetworkPermitted: true,
        runtimeInitiationPermitted: true,
        cancelOnlyPortalConfigurationId: 'bpc_cancel_only_fixture',
        defaultOfferId: 'family_annual_v2',
        offer: {
          offerId: 'founding_family_monthly_v1',
          planVersionId: 'family_v1',
          plan: 'family',
          displayName: 'Family',
          billingInterval: 'month',
          providerProductId: 'prod_family_fixture',
          providerPriceId: 'price_family_month_fixture',
          currency: 'usd',
          unitAmountMinor: 1499,
          quantity: 1,
          trialPeriodDays: 0,
          customerSelectable: false,
          defaultAcquisitionOffer: false,
        },
        offers: [
          {
            offerId: 'founding_family_monthly_v1',
            planVersionId: 'family_v1',
            plan: 'family',
            displayName: 'Family',
            billingInterval: 'month',
            providerProductId: 'prod_family_fixture',
            providerPriceId: 'price_family_month_fixture',
            currency: 'usd',
            unitAmountMinor: 1499,
            quantity: 1,
            trialPeriodDays: 0,
            customerSelectable: false,
            defaultAcquisitionOffer: false,
          },
          {
            offerId: 'family_monthly_v2',
            planVersionId: 'family_v3',
            plan: 'family',
            displayName: 'Family',
            billingInterval: 'month',
            providerProductId: 'prod_family_fixture',
            providerPriceId: 'price_family_month_fixture',
            currency: 'usd',
            unitAmountMinor: 1499,
            quantity: 1,
            trialPeriodDays: 0,
            customerSelectable: true,
            defaultAcquisitionOffer: false,
          },
          {
            offerId: 'family_annual_v2',
            planVersionId: 'family_v3',
            plan: 'family',
            displayName: 'Family',
            billingInterval: 'year',
            providerProductId: 'prod_family_fixture',
            providerPriceId: 'price_family_annual_fixture',
            currency: 'usd',
            unitAmountMinor: 14_990,
            quantity: 1,
            trialPeriodDays: 7,
            customerSelectable: true,
            defaultAcquisitionOffer: true,
          },
        ],
        billingOperationalReadiness: { state: 'incomplete' },
      },
    },
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

function rawClaims(token: string): Record<string, unknown> {
  const fva = token.includes('fresh')
    ? [0, 0]
    : token.includes('missing-id') || token.includes('elapsed')
      ? [0, 0]
      : token.includes('fallback')
        ? [0, -1]
        : token.includes('stale')
          ? [0, 10]
          : token.includes('malformed')
            ? [0, 'invalid']
            : undefined;
  const tokenIssuedAt = token.includes('elapsed') ? nowSeconds - 600 : nowSeconds - 30;
  const reverificationId = token.includes('missing-id')
    ? undefined
    : token.includes('portal')
      ? 'reverification_portal_fresh_0001'
      : token.includes('competing')
        ? 'reverification_competing_fresh_0001'
        : token.includes('fresh')
          ? 'reverification_checkout_fresh_0001'
          : 'reverification_blocked_fixture_0001';
  return {
    iss: customerIssuer,
    sub: customerSubject,
    sid: 'sess_customer_billing_mfa',
    aud: 'boomerbuddy-customer',
    azp: customerOrigin,
    iat: tokenIssuedAt,
    nbf: tokenIssuedAt,
    exp: nowSeconds + 3_600,
    sts: 'active',
    ...(fva === undefined ? {} : { fva }),
    ...(reverificationId === undefined ? {} : { reverification_id: reverificationId }),
  };
}

function transport(): StripeTransport {
  return {
    get: vi.fn(async ({ path }) => {
      if (path === '/v1/account') return { id: 'acct_fixture1234', object: 'account' };
      if (path === '/v1/products/prod_family_fixture') {
        return { id: 'prod_family_fixture', object: 'product', livemode: false, active: true };
      }
      if (path === '/v1/prices/price_family_month_fixture') {
        return {
          id: 'price_family_month_fixture',
          object: 'price',
          livemode: false,
          active: true,
          product: 'prod_family_fixture',
          currency: 'usd',
          unit_amount: 1499,
          unit_amount_decimal: '1499',
          type: 'recurring',
          billing_scheme: 'per_unit',
          custom_unit_amount: null,
          tiers_mode: null,
          transform_quantity: null,
          recurring: {
            interval: 'month',
            interval_count: 1,
            usage_type: 'licensed',
            trial_period_days: null,
          },
        };
      }
      if (path === '/v1/prices/price_family_annual_fixture') {
        return {
          id: 'price_family_annual_fixture',
          object: 'price',
          livemode: false,
          active: true,
          product: 'prod_family_fixture',
          currency: 'usd',
          unit_amount: 14_990,
          unit_amount_decimal: '14990',
          type: 'recurring',
          billing_scheme: 'per_unit',
          custom_unit_amount: null,
          tiers_mode: null,
          transform_quantity: null,
          recurring: {
            interval: 'year',
            interval_count: 1,
            usage_type: 'licensed',
            trial_period_days: null,
          },
        };
      }
      if (path === '/v1/billing_portal/configurations/bpc_cancel_only_fixture') {
        return {
          id: 'bpc_cancel_only_fixture',
          object: 'billing_portal.configuration',
          livemode: false,
          active: true,
          features: {
            subscription_cancel: {
              enabled: true,
              mode: 'at_period_end',
              proration_behavior: 'none',
            },
            subscription_update: { enabled: false, default_allowed_updates: [] },
            payment_method_update: { enabled: true },
            customer_update: { enabled: false, allowed_updates: [] },
            invoice_history: { enabled: true },
          },
        };
      }
      return {};
    }),
    postForm: vi.fn(async ({ path, form }) => {
      if (path === '/v1/billing_portal/sessions') {
        return {
          id: 'bps_test_customer_mfa',
          object: 'billing_portal.session',
          livemode: false,
          url: 'https://billing.stripe.com/p/session/customer-mfa',
          customer: form.customer,
          configuration: form.configuration,
          return_url: form.return_url,
        };
      }
      if (path !== '/v1/checkout/sessions') {
        throw new Error('Unexpected synthetic Stripe POST path');
      }
      return {
        id: 'cs_test_customer_mfa',
        object: 'checkout.session',
        livemode: false,
        url: 'https://checkout.stripe.com/c/pay/customer-mfa',
        mode: 'subscription',
        status: 'open',
        payment_status: 'unpaid',
        client_reference_id: form.client_reference_id,
        success_url: form.success_url,
        cancel_url: form.cancel_url,
        customer: null,
        metadata: {
          household_id: form['metadata[household_id]'],
          canonical_subscription_id: form['metadata[canonical_subscription_id]'],
          plan_version_id: form['metadata[plan_version_id]'],
          offer_id: form['metadata[offer_id]'],
        },
        expires_at: Number(form.expires_at),
      };
    }),
  };
}

describe('customer billing recent-MFA boundary', () => {
  let database: Database;
  let app: FastifyInstance;
  let stripeTransport: StripeTransport;
  let householdId: string;
  let personId: string;

  beforeEach(async () => {
    database = await createPGliteDatabase(':memory:');
    await runMigrations(database);
    await seedDemoData(database, testArtifactProtection(), 'test', now);
    await database.query(
      `UPDATE identities SET issuer = 'https://hq.clerk.test', subject = 'user_production_founder'
       WHERE id = 'identity-hq-heidi'`,
    );
    await database.query(
      `UPDATE organizations SET verification_state = 'verified'
       WHERE id = 'organization-boomerbuddy'`,
    );
    await database.query(
      `INSERT INTO production_founder_bootstraps(
         bootstrap_key, identity_id, issuer, subject, person_id,
         organization_id, organization_kind, organization_verification_state,
         employee_assignment_id, employee_role, correlation_id, created_at
       ) VALUES (
         'production-founder-v1', 'identity-hq-heidi', 'https://hq.clerk.test',
         'user_production_founder', 'person-hq-heidi', 'organization-boomerbuddy',
         'internal', 'verified', 'employee-hq-heidi', 'hq_owner',
         'customer-mfa-founder-0001', $1
       )`,
      [now.toISOString()],
    );
    stripeTransport = transport();
    app = await buildApp({
      config: config(),
      database,
      closeDatabase: false,
      initialize: false,
      stripeTransport,
      now: () => now,
      identityTokenVerifier: new ClerkSessionTokenVerifier(async (token) => rawClaims(token)),
      logger: createLogger({ level: 'error', sink: () => undefined, clock: () => now }),
    });

    const bootstrap = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { origin: customerOrigin, cookie: '__session=customer-token-fresh-0001' },
    });
    expect(bootstrap.statusCode, bootstrap.body).toBe(200);
    const row = await database.query<{ household_id: string; person_id: string }>(
      `SELECT household_id, person_id FROM production_customer_bootstraps
       WHERE issuer = $1 AND subject = $2`,
      [customerIssuer, customerSubject],
    );
    householdId = row.rows[0]!.household_id;
    personId = row.rows[0]!.person_id;
    await database.query(
      `INSERT INTO household_billing_authorities(
         household_id, person_id, status, granted_by_person_id, granted_at, grant_source
       ) VALUES ($1,$2,'active',$2,$3,'household_member')`,
      [householdId, personId, now.toISOString()],
    );
    const runtime = new CommerceRuntimeRepository(database);
    await runtime.changeStripeInitiationControl({
      environment: 'test',
      nextState: 'enabled',
      reasonCode: 'founder_test_activation',
      expectedRevision: 0,
      actorPersonId: 'person-hq-heidi',
      configuredFounderPersonId: 'person-hq-heidi',
      correlationId: 'customer-mfa-control-0001',
      now,
    });
    await runtime.changeStripeHouseholdEligibility({
      householdId,
      nextState: 'eligible',
      actorPersonId: 'person-hq-heidi',
      configuredFounderPersonId: 'person-hq-heidi',
      correlationId: 'customer-mfa-eligible-0001',
      now,
    });
  });

  afterEach(async () => {
    if (app !== undefined) await app.close();
    await database.close();
  });

  it('fails closed for incomplete, fallback, and effectively stale evidence before provider access', async () => {
    const cases = ['absent', 'malformed', 'stale', 'elapsed', 'missing-id', 'fallback'] as const;
    for (const [index, factorAge] of cases.entries()) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/commerce/stripe/checkout',
        headers: {
          origin: customerOrigin,
          cookie: `__session=customer-token-${factorAge}-0001`,
          'x-bb-household-id': householdId,
          'idempotency-key': `customer_mfa_blocked_${index.toString().padStart(4, '0')}`,
        },
        payload: { offerId: 'family_monthly_v2' },
      });
      expect(response.statusCode, response.body).toBe(403);
      expect(response.json()).toEqual(customerBillingReverificationHint());
    }
    expect(stripeTransport.get).not.toHaveBeenCalled();
    expect(stripeTransport.postForm).not.toHaveBeenCalled();

    const ordinaryAccess = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { origin: customerOrigin, cookie: '__session=customer-token-malformed-0001' },
    });
    expect(ordinaryAccess.statusCode, ordinaryAccess.body).toBe(200);
  });

  it('permits an exact-household billing authority with a fresh second factor', async () => {
    const request = {
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers: {
        origin: customerOrigin,
        cookie: '__session=customer-token-fresh-0001',
        'x-bb-household-id': householdId,
        'idempotency-key': 'customer_mfa_fresh_0001',
      },
      payload: { offerId: 'family_monthly_v2' },
    } as const;
    const response = await app.inject(request);
    expect(response.statusCode, response.body).toBe(201);
    expect(stripeTransport.get).toHaveBeenCalled();
    expect(stripeTransport.postForm).toHaveBeenCalledTimes(1);

    const repeated = await app.inject(request);
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(stripeTransport.postForm).toHaveBeenCalledTimes(1);

    const binding = await database.query<
      {
        reverification_fingerprint: string;
        binding_fingerprint: string;
        person_id: string;
        household_id: string;
        action: string;
        server_operation_id: string;
        offer_id: string;
        amount_minor: number;
        factor_level: string;
      } & Record<string, unknown>
    >('SELECT * FROM commerce_billing_reverification_bindings');
    expect(binding.rowCount).toBe(1);
    expect(binding.rows[0]).toMatchObject({
      person_id: personId,
      household_id: householdId,
      action: 'checkout',
      server_operation_id: 'customer_mfa_fresh_0001',
      offer_id: 'family_monthly_v2',
      amount_minor: 1499,
      factor_level: 'multi_factor',
    });
    expect(binding.rows[0]?.reverification_fingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(binding.rows[0]?.binding_fingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(JSON.stringify(binding.rows[0])).not.toContain('reverification_checkout_fresh_0001');
    await expect(
      database.query(
        `UPDATE commerce_billing_reverification_bindings
         SET effective_factor_age_seconds = 0 WHERE id = $1`,
        [binding.rows[0]?.id],
      ),
    ).rejects.toThrow(/immutable/iu);

    const crossOperationReplay = await app.inject({
      ...request,
      headers: { ...request.headers, 'idempotency-key': 'customer_mfa_replay_0002' },
    });
    expect(crossOperationReplay.statusCode, crossOperationReplay.body).toBe(403);
    expect(crossOperationReplay.json()).toEqual(customerBillingReverificationHint());
    expect(stripeTransport.postForm).toHaveBeenCalledTimes(1);
  });

  it('applies true-MFA and one-time reverification binding to the billing portal', async () => {
    await database.query(
      `INSERT INTO commerce_provider_customers(
         provider, environment, provider_customer_id, household_id, verified_at
       ) VALUES ('stripe','test','cus_customer_mfa',$1,$2)`,
      [householdId, now.toISOString()],
    );

    const blocked = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/portal',
      headers: {
        origin: customerOrigin,
        cookie: '__session=customer-token-fallback-portal-0001',
        'x-bb-household-id': householdId,
        'idempotency-key': 'customer_mfa_portal_blocked_0001',
      },
    });
    expect(blocked.statusCode, blocked.body).toBe(403);
    expect(blocked.json()).toEqual(customerBillingReverificationHint());
    expect(stripeTransport.get).not.toHaveBeenCalled();
    expect(stripeTransport.postForm).not.toHaveBeenCalled();

    const request = {
      method: 'POST',
      url: '/v1/commerce/stripe/portal',
      headers: {
        origin: customerOrigin,
        cookie: '__session=customer-token-fresh-portal-0001',
        'x-bb-household-id': householdId,
        'idempotency-key': 'customer_mfa_portal_fresh_0001',
      },
    } as const;
    const response = await app.inject(request);
    expect(response.statusCode, response.body).toBe(200);
    expect(stripeTransport.postForm).toHaveBeenCalledTimes(1);
    expect(stripeTransport.postForm).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/v1/billing_portal/sessions',
        form: expect.objectContaining({ customer: 'cus_customer_mfa' }),
      }),
    );

    const repeated = await app.inject(request);
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(stripeTransport.postForm).toHaveBeenCalledTimes(1);

    const binding = await database.query<
      {
        action: string;
        server_operation_id: string;
        offer_id: string;
        amount_minor: number;
        factor_level: string;
      } & Record<string, unknown>
    >('SELECT * FROM commerce_billing_reverification_bindings');
    expect(binding.rowCount).toBe(1);
    expect(binding.rows[0]).toMatchObject({
      action: 'portal',
      server_operation_id: 'customer_mfa_portal_fresh_0001',
      offer_id: 'cancel_only_portal_v1',
      amount_minor: 0,
      factor_level: 'multi_factor',
    });
    expect(JSON.stringify(binding.rows[0])).not.toContain('reverification_portal_fresh_0001');

    const crossActionReplay = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers: {
        ...request.headers,
        'idempotency-key': 'customer_mfa_portal_cross_action_0001',
      },
      payload: { offerId: 'family_monthly_v2' },
    });
    expect(crossActionReplay.statusCode, crossActionReplay.body).toBe(403);
    expect(crossActionReplay.json()).toEqual(customerBillingReverificationHint());
    expect(stripeTransport.postForm).toHaveBeenCalledTimes(1);
  });

  it('serializes competing operations that present one fresh reverification id', async () => {
    const request = (serverOperationId: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/commerce/stripe/checkout',
        headers: {
          origin: customerOrigin,
          cookie: '__session=customer-token-fresh-competing-0001',
          'x-bb-household-id': householdId,
          'idempotency-key': serverOperationId,
        },
        payload: { offerId: 'family_monthly_v2' },
      });
    const operationIds = [
      'customer_mfa_competing_first_0001',
      'customer_mfa_competing_second_0001',
    ] as const;
    const responses = await Promise.all(operationIds.map((operationId) => request(operationId)));
    expect(
      responses.map((response) => response.statusCode).sort((left, right) => left - right),
    ).toEqual([201, 403]);
    const rejected = responses.find((response) => response.statusCode === 403);
    expect(rejected?.json()).toEqual(customerBillingReverificationHint());
    expect(stripeTransport.postForm).toHaveBeenCalledTimes(1);

    const bindings = await database.query<
      { server_operation_id: string; reverification_fingerprint: string } & Record<string, unknown>
    >(
      `SELECT server_operation_id, reverification_fingerprint
       FROM commerce_billing_reverification_bindings`,
    );
    expect(bindings.rowCount).toBe(1);
    expect(operationIds).toContain(
      bindings.rows[0]?.server_operation_id as (typeof operationIds)[number],
    );
    expect(bindings.rows[0]?.reverification_fingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(JSON.stringify(bindings.rows[0])).not.toContain('reverification_competing_fresh_0001');
  });

  it('lets the exact active household administrator accept and withdraw billing authority with durable replay-safe evidence', async () => {
    await database.query(
      `DELETE FROM household_billing_authorities
       WHERE household_id = $1 AND person_id = $2`,
      [householdId, personId],
    );
    const headers = {
      origin: customerOrigin,
      cookie: '__session=customer-token-fresh-authority-grant-0001',
      'x-bb-household-id': householdId,
    } as const;
    const status = await app.inject({
      method: 'GET',
      url: '/v1/commerce/billing-authority',
      headers,
    });
    expect(status.statusCode, status.body).toBe(200);
    const initial = status.json<{
      authorityStatus: string;
      administratorEligible: boolean;
      canAccept: boolean;
      documents: {
        accept: { version: string; digest: string };
        revoke: { version: string; digest: string };
      };
    }>();
    expect(initial).toMatchObject({
      authorityStatus: 'absent',
      administratorEligible: true,
      canAccept: true,
    });

    const acceptRequest = {
      method: 'POST',
      url: '/v1/commerce/billing-authority/accept',
      headers: {
        ...headers,
        'idempotency-key': 'billing-authority:grant:self-accept-00000001',
      },
      payload: {
        documentVersion: initial.documents.accept.version,
        documentDigest: initial.documents.accept.digest,
        consentAccepted: true,
      },
    } as const;
    const accepted = await app.inject(acceptRequest);
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toMatchObject({
      householdId,
      personId,
      action: 'grant',
      previousStatus: 'absent',
      nextStatus: 'active',
      reasonCode: 'customer_billing_consent_verified',
      reused: false,
      externalActionExecuted: false,
    });
    const acceptedReplay = await app.inject(acceptRequest);
    expect(acceptedReplay.statusCode, acceptedReplay.body).toBe(200);
    expect(acceptedReplay.json()).toMatchObject({ reused: true, nextStatus: 'active' });

    const activeStatus = await app.inject({
      method: 'GET',
      url: '/v1/commerce/billing-authority',
      headers,
    });
    expect(activeStatus.statusCode, activeStatus.body).toBe(200);
    expect(activeStatus.json()).toMatchObject({
      authorityStatus: 'active',
      canAccept: false,
      canRevoke: true,
    });

    const revokeRequest = {
      method: 'POST',
      url: '/v1/commerce/billing-authority/revoke',
      headers: {
        ...headers,
        cookie: '__session=customer-token-portal-fresh-authority-revoke-0001',
        'idempotency-key': 'billing-authority:revoke:self-revoke-00000001',
      },
      payload: {
        documentVersion: initial.documents.revoke.version,
        documentDigest: initial.documents.revoke.digest,
        withdrawalAcknowledged: true,
      },
    } as const;
    const revoked = await app.inject(revokeRequest);
    expect(revoked.statusCode, revoked.body).toBe(200);
    expect(revoked.json()).toMatchObject({
      action: 'revoke',
      previousStatus: 'active',
      nextStatus: 'revoked',
      reasonCode: 'customer_billing_consent_withdrawn',
      reused: false,
    });
    const revokedReplay = await app.inject(revokeRequest);
    expect(revokedReplay.statusCode, revokedReplay.body).toBe(200);
    expect(revokedReplay.json()).toMatchObject({ reused: true, nextStatus: 'revoked' });

    const durable = await database.query<
      {
        readonly customer_events: number;
        readonly active_authorities: number;
        readonly audit_events: number;
        readonly outbox_events: number;
      } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::int FROM household_billing_authority_events
          WHERE household_id = $1 AND person_id = $2
            AND transition_source = 'customer_self') AS customer_events,
         (SELECT count(*)::int FROM household_billing_authorities
          WHERE household_id = $1 AND person_id = $2 AND status = 'active') AS active_authorities,
         (SELECT count(*)::int FROM audit_events
          WHERE household_id = $1 AND actor_person_id = $2
            AND action IN ('billing_authority.granted','billing_authority.revoked')) AS audit_events,
         (SELECT count(*)::int FROM outbox_events
          WHERE aggregate_id = $3
            AND event_type IN ('billing_authority.granted','billing_authority.revoked')) AS outbox_events`,
      [householdId, personId, `${householdId}:${personId}`],
    );
    expect(durable.rows[0]).toEqual({
      customer_events: 2,
      active_authorities: 0,
      audit_events: 2,
      outbox_events: 2,
    });

    const crossHousehold = await app.inject({
      method: 'GET',
      url: '/v1/commerce/billing-authority',
      headers: { ...headers, 'x-bb-household-id': 'household-sunrise' },
    });
    expect(crossHousehold.statusCode, crossHousehold.body).toBe(403);

    await database.query(
      `UPDATE household_administrator_assignments
       SET status = 'revoked', revoked_at = $3
       WHERE household_id = $1 AND person_id = $2`,
      [householdId, personId, now.toISOString()],
    );
    const roleDenied = await app.inject({
      ...acceptRequest,
      headers: {
        ...acceptRequest.headers,
        cookie: '__session=customer-token-competing-fresh-authority-role-0001',
        'idempotency-key': 'billing-authority:grant:role-denied-0000001',
      },
    });
    expect([401, 403], roleDenied.body).toContain(roleDenied.statusCode);
  });

  it('uses a strict ten-minute boundary and keeps local development usable', () => {
    expect(customerBillingSecondFactorMaximumAgeSeconds).toBe(600);
    expect(
      customerBillingReverificationEvidence(
        auth({
          firstFactorAgeSeconds: 0,
          secondFactorAgeSeconds: 0,
          reverificationId: 'reverification_test_0001',
        }),
      ),
    ).toMatchObject({ kind: 'clerk', factorLevel: 'multi_factor' });
    expect(
      customerBillingReverificationEvidence(
        auth({
          firstFactorAgeSeconds: 599,
          secondFactorAgeSeconds: 599,
          reverificationId: 'reverification_test_0001',
        }),
      ),
    ).toBeDefined();
    for (const evidence of [
      auth({
        firstFactorAgeSeconds: 600,
        secondFactorAgeSeconds: 0,
        reverificationId: 'reverification_test_0001',
      }),
      auth({
        firstFactorAgeSeconds: 0,
        secondFactorAgeSeconds: 600,
        reverificationId: 'reverification_test_0001',
      }),
      auth({ firstFactorAgeSeconds: 0, secondFactorAgeSeconds: 0 }),
      auth({ firstFactorAgeSeconds: 0, reverificationId: 'reverification_test_0001' }),
    ]) {
      expect(customerBillingReverificationEvidence(evidence)).toBeUndefined();
    }
    expect(
      customerBillingReverificationEvidence({
        ...auth({}),
        assurance: { kind: 'development' },
      }),
    ).toEqual({ kind: 'development' });
  });
});

import type { AppConfig } from '@boomerbuddy/config';
import {
  signStripeFixture,
  StripeSessionDispatchError,
  StripeTestAdapter,
  type StripeTransport,
} from '@boomerbuddy/integrations';
import { createLogger } from '@boomerbuddy/observability';
import {
  BusinessOsRepository,
  CommerceOperationsRepository,
  CommerceRuntimeRepository,
  createPGliteDatabase,
  DurableJobRepository,
  EntitlementRepository,
  OutboxDeliveryRepository,
} from '@boomerbuddy/persistence';
import { PortableWorker } from '@boomerbuddy/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api/src/app';
import { createStripeReconciliationHandler } from '../../apps/worker/src/commerce-reconciliation';
import { createWorkerStripeAdapter } from '../../apps/worker/src/stripe-adapter';
import { createStripeSessionRetryHandler } from '../../apps/worker/src/stripe-session-retry';
import { createMutableClock, testConfig } from './support';

const customerOrigin = 'https://customer.boomerbuddy.test';
const hqOrigin = 'https://hq.boomerbuddy.test';
const endpointSecret = 'whsec_fixture_12345678';
const liveEndpointSecret = ['whsec', 'live', 'fixture_12345678'].join('_');
const apiVersion = '2026-07-29.dahlia';

function stripeConfig(): AppConfig {
  const base = testConfig();
  return {
    ...base,
    identity: {
      ...base.identity,
      customerOrigins: [customerOrigin],
      hqOrigins: [hqOrigin],
    },
    commerce: {
      stripe: {
        mode: 'test',
        environment: 'test',
        accountId: 'acct_fixture1234',
        apiKey: 'rk_test_fixture_12345678',
        webhookSecret: endpointSecret,
        apiVersion,
        runtimeNetworkPermitted: true,
        runtimeInitiationPermitted: true,
        cancelOnlyPortalConfigurationId: 'bpc_cancel_only_fixture',
        offer: {
          offerId: 'founding_family_monthly_v1',
          planVersionId: 'family_v1',
          billingInterval: 'month',
          providerProductId: 'prod_family_fixture',
          providerPriceId: 'price_family_month_fixture',
          currency: 'usd',
          unitAmountMinor: 1499,
          quantity: 1,
        },
      },
    },
  };
}

function liveApiConfig(runtimeInitiationPermitted: boolean): AppConfig {
  const base = stripeConfig();
  return {
    ...base,
    commerce: {
      stripe: {
        mode: 'live',
        environment: 'production',
        runtimeSurface: 'api',
        accountId: 'acct_livefixture1',
        apiRestrictedKey: ['rk', 'live', 'fixture_12345678'].join('_'),
        webhookSecret: liveEndpointSecret,
        apiVersion,
        runtimeInitiationPermitted,
        runtimeNetworkPermitted: true,
        credentialCustody: 'separate_replit_runtime_restricted_keys',
        cancelOnlyPortalConfigurationId: 'bpc_live_cancel_fixture',
        offer: {
          offerId: 'founding_family_monthly_v1',
          planVersionId: 'family_v1',
          billingInterval: 'month',
          providerProductId: 'prod_live_family_fixture',
          providerPriceId: 'price_live_family_fixture',
          currency: 'usd',
          unitAmountMinor: 1499,
          quantity: 1,
        },
      },
    },
  };
}

function livePreflightFixture(path: string): Readonly<Record<string, unknown>> {
  if (path === '/v1/account') {
    return {
      id: 'acct_livefixture1',
      object: 'account',
      charges_enabled: true,
      payouts_enabled: true,
      country: 'US',
      business_type: 'company',
    };
  }
  if (path === '/v1/products/prod_live_family_fixture') {
    return {
      id: 'prod_live_family_fixture',
      object: 'product',
      livemode: true,
      active: true,
    };
  }
  if (path === '/v1/prices/price_live_family_fixture') {
    return {
      id: 'price_live_family_fixture',
      object: 'price',
      livemode: true,
      active: true,
      product: 'prod_live_family_fixture',
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
  if (path === '/v1/billing_portal/configurations/bpc_live_cancel_fixture') {
    return {
      id: 'bpc_live_cancel_fixture',
      object: 'billing_portal.configuration',
      livemode: true,
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
}

describe('Stripe live runtime boundary', () => {
  it('accepts the API-scoped live boundary while keeping injected evidence local-only', async () => {
    const liveConfig = liveApiConfig(false);
    const injectedTransport: StripeTransport = {
      get: vi.fn(async () => ({})),
      postForm: vi.fn(async () => ({})),
    };
    const database = await createPGliteDatabase(':memory:');
    const app = await buildApp({
      config: liveConfig,
      database,
      closeDatabase: false,
      stripeTransport: injectedTransport,
    });
    const publicConfiguration = await app.inject({ method: 'GET', url: '/v1/public/config' });
    expect(publicConfiguration.statusCode, publicConfiguration.body).toBe(200);
    expect(publicConfiguration.json()).toMatchObject({
      liveProvidersEnabled: true,
      pricing: [
        {
          key: 'family',
          monthlyUsd: 14.99,
          annualUsd: null,
          hypothesis: false,
        },
      ],
    });
    expect(injectedTransport.get).not.toHaveBeenCalled();
    expect(injectedTransport.postForm).not.toHaveBeenCalled();
    await app.close();
    await database.close();
    await expect(
      buildApp({
        config: liveConfig,
        stripeTransport: injectedTransport,
        stripeEvidenceLevel: 'live_production',
        initialize: false,
      }),
    ).rejects.toThrow('evidence tier does not match the runtime transport boundary');
  });

  it('denies a non-owner HQ preflight before any provider transport call', async () => {
    const get = vi.fn(async ({ path }: Parameters<StripeTransport['get']>[0]) =>
      livePreflightFixture(path),
    );
    const postForm = vi.fn(async () => ({}));
    const database = await createPGliteDatabase(':memory:');
    const app = await buildApp({
      config: liveApiConfig(false),
      database,
      closeDatabase: false,
      stripeTransport: { get, postForm },
    });
    const reviewer = await loginHq(app, 'hq-riley');
    const denied = await app.inject({
      method: 'POST',
      url: '/v1/hq/commerce/stripe/preflight',
      headers: { cookie: reviewer, origin: hqOrigin },
      payload: { environment: 'production' },
    });
    expect(denied.statusCode, denied.body).toBe(403);
    expect(get).not.toHaveBeenCalled();
    expect(postForm).not.toHaveBeenCalled();
    const evidence = await database.query<{ readonly count: number } & Record<string, unknown>>(
      `SELECT count(*)::int AS count FROM commerce_stripe_preflight_records`,
    );
    expect(evidence.rows[0]?.count).toBe(0);
    await app.close();
    await database.close();
  });

  it('records founder preflight through four GETs while every live initiation gate stays closed', async () => {
    const get = vi.fn(async ({ path }: Parameters<StripeTransport['get']>[0]) =>
      livePreflightFixture(path),
    );
    const postForm = vi.fn(async () => ({}));
    const database = await createPGliteDatabase(':memory:');
    const app = await buildApp({
      config: liveApiConfig(false),
      database,
      closeDatabase: false,
      stripeTransport: { get, postForm },
    });
    const founder = await loginHq(app);
    const headers = { cookie: founder, origin: hqOrigin };
    const initiation = await app.inject({
      method: 'GET',
      url: '/v1/hq/commerce/stripe/initiation-control?environment=production',
      headers,
    });
    expect(initiation.statusCode, initiation.body).toBe(200);
    expect(initiation.json()).toMatchObject({
      state: 'absent',
      revision: 0,
      liveEnableAvailable: false,
    });
    const cohort = await app.inject({
      method: 'GET',
      url: '/v1/hq/commerce/stripe/cohort-control?environment=production',
      headers,
    });
    expect(cohort.statusCode, cohort.body).toBe(200);
    expect(cohort.json()).toMatchObject({ state: 'absent', maxActive: 0, revision: 0 });

    const wrongEnvironment = await app.inject({
      method: 'POST',
      url: '/v1/hq/commerce/stripe/preflight',
      headers,
      payload: { environment: 'test' },
    });
    expect(wrongEnvironment.statusCode, wrongEnvironment.body).toBe(503);
    expect(get).not.toHaveBeenCalled();

    const preflight = await app.inject({
      method: 'POST',
      url: '/v1/hq/commerce/stripe/preflight',
      headers,
      payload: { environment: 'production' },
    });
    expect(preflight.statusCode, preflight.body).toBe(200);
    expect(preflight.json()).toMatchObject({
      environment: 'production',
      preflight: {
        state: 'configured',
        evidenceLevel: 'local_fixture',
        authenticityKind: 'fixture_assertion',
        transportKind: 'injected_fixture',
        checks: {
          accountReady: true,
          offerReady: true,
          portalReady: true,
          checkoutPolicyReady: true,
        },
      },
      eligibleHouseholds: [],
    });
    expect(get.mock.calls.map(([request]) => request.path).sort()).toEqual(
      [
        '/v1/account',
        '/v1/billing_portal/configurations/bpc_live_cancel_fixture',
        '/v1/prices/price_live_family_fixture',
        '/v1/products/prod_live_family_fixture',
      ].sort(),
    );
    expect(postForm).not.toHaveBeenCalled();
    const rows = await database.query<
      {
        readonly preflight_records: number;
        readonly checkout_intents: number;
        readonly session_operations: number;
        readonly initiation_controls: number;
        readonly cohort_policies: number;
      } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::int FROM commerce_stripe_preflight_records) AS preflight_records,
         (SELECT count(*)::int FROM commerce_checkout_intents) AS checkout_intents,
         (SELECT count(*)::int FROM commerce_stripe_session_operations) AS session_operations,
         (SELECT count(*)::int FROM commerce_stripe_initiation_controls) AS initiation_controls,
         (SELECT count(*)::int FROM commerce_stripe_cohort_policies) AS cohort_policies`,
    );
    expect(rows.rows[0]).toMatchObject({
      preflight_records: 1,
      checkout_intents: 0,
      session_operations: 0,
      initiation_controls: 0,
      cohort_policies: 0,
    });
    await app.close();
    await database.close();
  });

  it('fails Portal closed when its runtime configuration and adapter are absent', async () => {
    const database = await createPGliteDatabase(':memory:');
    const app = await buildApp({
      config: testConfig(),
      database,
      closeDatabase: false,
    });
    const portal = await app.inject({ method: 'POST', url: '/v1/commerce/stripe/portal' });
    expect(portal.statusCode, portal.body).toBe(503);
    expect(portal.json()).toMatchObject({
      error: { code: 'integration_unavailable' },
    });
    await app.close();
    await database.close();
  });

  it('keeps verified-customer Portal available while live Checkout initiation is off', async () => {
    const liveConfig = liveApiConfig(false);
    const liveNow = new Date();
    const postForm = vi.fn(async ({ path, form }) => {
      if (path !== '/v1/billing_portal/sessions') throw new Error('Unexpected Stripe mutation');
      return {
        id: 'bps_live_portal_independent',
        object: 'billing_portal.session',
        livemode: true,
        url: 'https://billing.stripe.com/p/session/live-portal-independent',
        customer: form.customer,
        configuration: form.configuration,
        return_url: form.return_url,
      };
    });
    const transport: StripeTransport = {
      postForm,
      get: vi.fn(async ({ path }) => {
        if (path === '/v1/account') {
          return {
            id: 'acct_livefixture1',
            object: 'account',
            charges_enabled: true,
            payouts_enabled: true,
            country: 'US',
            business_type: 'company',
          };
        }
        if (path === '/v1/products/prod_live_family_fixture') {
          return {
            id: 'prod_live_family_fixture',
            object: 'product',
            livemode: true,
            active: true,
          };
        }
        if (path === '/v1/prices/price_live_family_fixture') {
          return {
            id: 'price_live_family_fixture',
            object: 'price',
            livemode: true,
            active: true,
            product: 'prod_live_family_fixture',
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
        if (path === '/v1/billing_portal/configurations/bpc_live_cancel_fixture') {
          return {
            id: 'bpc_live_cancel_fixture',
            object: 'billing_portal.configuration',
            livemode: true,
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
    };
    const database = await createPGliteDatabase(':memory:');
    const app = await buildApp({
      config: liveConfig,
      database,
      closeDatabase: false,
      stripeTransport: transport,
      now: () => liveNow,
    });
    await database.query(
      `INSERT INTO commerce_provider_customers(
         provider, environment, provider_customer_id, household_id, verified_at
       ) VALUES ('stripe','production','cus_live_portal_independent','household-sunrise',CURRENT_TIMESTAMP)`,
    );
    const cookie = await login(app, 'owner-alice');
    const customerHeaders = {
      cookie,
      origin: customerOrigin,
      'x-bb-household-id': 'household-sunrise',
    };
    const billing = await app.inject({
      method: 'GET',
      url: '/v1/commerce/stripe/billing',
      headers: customerHeaders,
    });
    expect(billing.statusCode, billing.body).toBe(200);
    expect(billing.json()).toMatchObject({
      billing: { runtimeInitiationEnabled: false, portalAvailable: true },
    });
    const checkout = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers: { ...customerHeaders, 'idempotency-key': 'live-disabled-checkout-request-0001' },
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    expect(checkout.statusCode, checkout.body).toBe(403);
    const portal = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/portal',
      headers: { ...customerHeaders, 'idempotency-key': 'live-independent-portal-request-0001' },
    });
    expect(portal.statusCode, portal.body).toBe(200);
    expect(portal.json()).toMatchObject({
      portal: { environment: 'production', sessionId: 'bps_live_portal_independent' },
    });
    expect(postForm).toHaveBeenCalledTimes(1);
    expect(postForm).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/v1/billing_portal/sessions' }),
    );
    const webhookCreated = Math.floor(liveNow.getTime() / 1_000);
    const rawWebhook = JSON.stringify({
      id: 'evt_live_async_payment_failed_initiation_off',
      type: 'checkout.session.async_payment_failed',
      created: webhookCreated,
      livemode: true,
      account: 'acct_livefixture1',
      api_version: apiVersion,
      data: {
        object: {
          id: 'cs_live_async_payment_failed_initiation_off',
          object: 'checkout.session',
          livemode: true,
          mode: 'subscription',
          status: 'complete',
          payment_status: 'unpaid',
          amount_total: 1499,
          currency: 'usd',
          expires_at: webhookCreated + 3600,
          customer: 'cus_live_async_payment_failed_initiation_off',
          subscription: 'sub_live_async_payment_failed_initiation_off',
          metadata: {
            household_id: 'household-sunrise',
            canonical_subscription_id: 'subscription-live-async-payment-failed-initial-off',
            plan_version_id: 'family_v1',
          },
        },
      },
    });
    const webhook = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signStripeFixture({
          rawBody: rawWebhook,
          endpointSecret: liveEndpointSecret,
          timestampSeconds: webhookCreated,
        }),
      },
      payload: rawWebhook,
    });
    expect(webhook.statusCode, webhook.body).toBe(202);
    expect(webhook.json()).toMatchObject({
      received: true,
      duplicate: false,
      application: 'reconciliation_queued',
    });
    const queuedWebhook = await database.query<
      { readonly job_type: string; readonly payload: unknown } & Record<string, unknown>
    >(
      `SELECT job_type, payload FROM durable_jobs
       WHERE job_type = 'commerce.reconcile'
       ORDER BY created_at DESC LIMIT 1`,
    );
    expect(queuedWebhook.rows[0]).toMatchObject({
      job_type: 'commerce.reconcile',
      payload: expect.objectContaining({
        environment: 'production',
        eventType: 'checkout.session.async_payment_failed',
        externalSubscriptionId: 'sub_live_async_payment_failed_initiation_off',
      }),
    });
    const hqCookie = await loginHq(app);
    const status = await app.inject({
      method: 'GET',
      url: '/v1/hq/commerce/stripe/status?environment=production',
      headers: { cookie: hqCookie, origin: hqOrigin },
    });
    expect(status.statusCode, status.body).toBe(200);
    expect(status.json()).toMatchObject({
      environment: 'production',
      preflight: {
        state: 'configured',
        checks: {
          accountReady: true,
          offerReady: true,
          portalReady: true,
          checkoutPolicyReady: true,
        },
      },
    });
    expect(JSON.stringify(status.json())).not.toMatch(/apiRestrictedKey|provider_product_id|raw/u);
    await app.close();
    await database.close();
  });

  it('composes worker Checkout and Portal retries with the configured customer origin and exact keys', async () => {
    const configuredStripe = stripeConfig().commerce.stripe;
    if (configuredStripe.mode !== 'test') throw new Error('Expected Stripe test configuration');
    const postForm = vi.fn(async ({ path, form }: Parameters<StripeTransport['postForm']>[0]) =>
      path === '/v1/checkout/sessions'
        ? {
            id: 'cs_test_worker_composition',
            object: 'checkout.session',
            livemode: false,
            url: 'https://checkout.stripe.com/c/pay/worker-composition',
            mode: 'subscription',
            status: 'open',
            payment_status: 'unpaid',
            client_reference_id: form.client_reference_id,
            success_url: form.success_url,
            cancel_url: form.cancel_url,
            customer: form.customer ?? null,
            metadata: {
              household_id: form['metadata[household_id]'],
              canonical_subscription_id: form['metadata[canonical_subscription_id]'],
              plan_version_id: form['metadata[plan_version_id]'],
            },
            expires_at: Number(form.expires_at),
          }
        : {
            id: 'bps_worker_composition',
            object: 'billing_portal.session',
            livemode: false,
            url: 'https://billing.stripe.com/p/session/worker-composition',
            customer: form.customer,
            configuration: form.configuration,
            return_url: form.return_url,
          },
    );
    const adapter = createWorkerStripeAdapter({
      transport: { get: vi.fn(async () => ({})), postForm },
      customerOrigins: [customerOrigin],
      configuration: {
        environment: 'test',
        accountId: 'acct_fixture1234',
        apiVersion,
        portalConfigurationId: 'bpc_cancel_only_fixture',
        offer: configuredStripe.offer,
      },
    });
    const actor = {
      personId: 'person-owner-alice',
      householdId: 'household-sunrise',
      billingAuthorityId: 'billing-authority-sunrise-alice',
      resolvedAt: new Date('2026-08-16T12:00:00.000Z'),
    };
    await expect(
      adapter.createCheckout({
        actor,
        canonicalSubscriptionId: 'subscription-worker-composition',
        planVersionId: 'family_v1',
        providerPriceId: 'price_family_month_fixture',
        successUrl: `${customerOrigin}/member/billing/success`,
        cancelUrl: `${customerOrigin}/member/billing`,
        idempotencyKey: 'provider-worker-checkout-key-0001',
        providerExpiresAt: new Date('2026-08-16T13:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ id: 'cs_test_worker_composition' });
    await expect(
      adapter.createPortal({
        actor,
        providerCustomerId: 'cus_worker_composition',
        providerConfigurationId: 'bpc_cancel_only_fixture',
        returnUrl: `${customerOrigin}/member/billing`,
        idempotencyKey: 'provider-worker-portal-key-0001',
      }),
    ).resolves.toMatchObject({ id: 'bps_worker_composition' });
    expect(postForm).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        path: '/v1/checkout/sessions',
        idempotencyKey: 'provider-worker-checkout-key-0001',
        form: expect.objectContaining({
          success_url: `${customerOrigin}/member/billing/success`,
          cancel_url: `${customerOrigin}/member/billing`,
        }),
      }),
    );
    expect(postForm).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: '/v1/billing_portal/sessions',
        idempotencyKey: 'provider-worker-portal-key-0001',
        form: expect.objectContaining({ return_url: `${customerOrigin}/member/billing` }),
      }),
    );
  });
});

async function login(app: FastifyInstance, personaId: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/dev/sessions/customer',
    headers: { origin: customerOrigin },
    payload: { personaId },
  });
  expect(response.statusCode).toBe(201);
  const value = response.headers['set-cookie'];
  const cookie = (Array.isArray(value) ? value[0] : value)?.split(';', 1)[0];
  if (cookie === undefined) throw new Error('Missing test cookie');
  return cookie;
}

async function loginHq(app: FastifyInstance, personaId = 'hq-heidi'): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/dev/sessions/hq',
    headers: { origin: hqOrigin },
    payload: { personaId },
  });
  expect(response.statusCode).toBe(201);
  const value = response.headers['set-cookie'];
  const cookie = (Array.isArray(value) ? value[0] : value)?.split(';', 1)[0];
  if (cookie === undefined) throw new Error('Missing HQ test cookie');
  return cookie;
}

async function runReconciliation(
  database: Awaited<ReturnType<typeof createPGliteDatabase>>,
  transport: StripeTransport,
  now: () => Date,
): Promise<void> {
  const jobs = new DurableJobRepository(database);
  const worker = new PortableWorker(
    jobs,
    new OutboxDeliveryRepository(database),
    {
      'commerce.reconcile': createStripeReconciliationHandler({
        businessOs: new BusinessOsRepository(database),
        commerce: new CommerceOperationsRepository(
          database,
          Buffer.alloc(32, 11),
          1,
          undefined,
          'local',
        ),
        commerceRuntime: new CommerceRuntimeRepository(database),
        jobs,
        provider: new StripeTestAdapter(
          transport,
          { authorize: async () => ({ allowed: false, reason: 'test_worker' }) },
          new Set(),
          apiVersion,
        ),
        clock: now,
      }),
    },
    undefined,
    {
      workerId: 'stripe-reconciliation-test-worker',
      pollIntervalMs: 100,
      leaseDurationMs: 30_000,
      heartbeatIntervalMs: 5_000,
      shutdownTimeoutMs: 1_000,
      batchSize: 10,
      retryBaseMs: 100,
      retryMaxMs: 1_000,
    },
    createLogger({ level: 'error', sink: () => undefined, clock: now }),
    now,
  );
  await worker.runOnce();
  await worker.stop();
}

async function runStripeSessionRetry(
  database: Awaited<ReturnType<typeof createPGliteDatabase>>,
  transport: StripeTransport,
  now: () => Date,
  customerOrigins: readonly string[] = [customerOrigin],
): Promise<void> {
  const jobs = new DurableJobRepository(database);
  const worker = new PortableWorker(
    jobs,
    new OutboxDeliveryRepository(database),
    {
      'commerce.stripe-session-retry': createStripeSessionRetryHandler({
        businessOs: new BusinessOsRepository(database),
        commerceRuntime: new CommerceRuntimeRepository(database),
        provider: new StripeTestAdapter(
          transport,
          {
            authorize: async () => ({
              allowed: true,
              reason: 'durable_repository_claimed_same_key_retry_only',
            }),
          },
          new Set(customerOrigins),
          apiVersion,
        ),
        evidenceLevel: 'local_fixture',
        transportKind: 'injected_fixture',
        runtimeRunId: 'stripe-session-retry-test-runtime',
        authenticityKind: 'fixture_assertion',
        runtimeInitiationPermitted: true,
        clock: now,
      }),
    },
    undefined,
    {
      workerId: 'stripe-session-retry-test-worker',
      pollIntervalMs: 100,
      leaseDurationMs: 30_000,
      heartbeatIntervalMs: 5_000,
      shutdownTimeoutMs: 1_000,
      batchSize: 10,
      retryBaseMs: 100,
      retryMaxMs: 1_000,
    },
    createLogger({ level: 'error', sink: () => undefined, clock: now }),
    now,
  );
  await worker.runOnce();
  await worker.stop();
}

async function activateCompletedCheckoutWithPaidInvoice(input: {
  readonly app: FastifyInstance;
  readonly database: Awaited<ReturnType<typeof createPGliteDatabase>>;
  readonly transport: StripeTransport;
  readonly now: () => Date;
  readonly canonicalSubscriptionId: string;
  readonly externalSubscriptionId: string;
  readonly providerCustomerId: string;
  readonly fixtureKey: string;
  readonly periodStart: number;
  readonly periodEnd: number;
  readonly checkoutEventType?:
    'checkout.session.completed' | 'checkout.session.async_payment_succeeded';
}): Promise<void> {
  const checkoutExpiry = await input.database.query<
    { readonly provider_returned_expires_at: unknown } & Record<string, unknown>
  >(
    `SELECT provider_returned_expires_at FROM commerce_checkout_intents
     WHERE household_id = 'household-sunrise' AND subscription_id = $1`,
    [input.canonicalSubscriptionId],
  );
  const providerCheckoutExpiry = new Date(
    String(checkoutExpiry.rows[0]?.provider_returned_expires_at),
  );
  if (!Number.isFinite(providerCheckoutExpiry.getTime())) {
    throw new Error('Missing provider Checkout expiry fixture');
  }
  const send = async (event: Record<string, unknown>) => {
    const rawBody = JSON.stringify(event);
    const timestampSeconds = Number(event.created);
    return input.app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signStripeFixture({
          rawBody,
          endpointSecret,
          timestampSeconds,
        }),
      },
      payload: rawBody,
    });
  };
  const checkout = await send({
    id: `evt_${input.fixtureKey}_checkout_completed`,
    type: input.checkoutEventType ?? 'checkout.session.completed',
    created: input.periodStart,
    livemode: false,
    api_version: apiVersion,
    data: {
      object: {
        id: 'cs_test_fixture_123',
        object: 'checkout.session',
        livemode: false,
        mode: 'subscription',
        customer: input.providerCustomerId,
        subscription: input.externalSubscriptionId,
        payment_intent: `pi_${input.fixtureKey}_checkout`,
        status: 'complete',
        payment_status: 'paid',
        amount_total: 1499,
        currency: 'usd',
        expires_at: providerCheckoutExpiry.getTime() / 1_000,
        metadata: {
          household_id: 'household-sunrise',
          canonical_subscription_id: input.canonicalSubscriptionId,
          plan_version_id: 'family_v1',
        },
      },
    },
  });
  expect(checkout.statusCode).toBe(200);
  const invoiceId = `in_${input.fixtureKey}_initial`;
  const paymentIntentId = `pi_${input.fixtureKey}_initial`;
  const subscription = {
    id: input.externalSubscriptionId,
    object: 'subscription',
    livemode: false,
    customer: input.providerCustomerId,
    status: 'active',
    cancel_at_period_end: false,
    created: input.periodStart,
    current_period_start: input.periodStart,
    current_period_end: input.periodEnd,
    items: {
      has_more: false,
      data: [
        {
          id: `si_${input.fixtureKey}`,
          quantity: 1,
          price: {
            id: 'price_family_month_fixture',
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
          },
        },
      ],
    },
  };
  vi.mocked(input.transport.get).mockImplementation(async ({ path }) => {
    if (path === `/v1/invoices/${invoiceId}`) {
      return {
        id: invoiceId,
        object: 'invoice',
        livemode: false,
        status: 'paid',
        billing_reason: 'subscription_create',
        amount_paid: 1499,
        amount_remaining: 0,
        currency: 'usd',
        subtotal: 1499,
        total: 1499,
        total_discount_amounts: [],
        total_pretax_credit_amounts: [],
        total_taxes: [],
        discounts: [],
        pre_payment_credit_notes_amount: 0,
        post_payment_credit_notes_amount: 0,
        starting_balance: 0,
        ending_balance: 0,
        amount_overpaid: 0,
        parent: { subscription_details: { subscription: input.externalSubscriptionId } },
        payments: {
          object: 'list',
          has_more: false,
          data: [
            {
              id: `inpay_${input.fixtureKey}`,
              object: 'invoice_payment',
              livemode: false,
              invoice: invoiceId,
              payment: { type: 'payment_intent', payment_intent: paymentIntentId },
              status: 'paid',
              is_default: true,
              amount_paid: 1499,
              amount_requested: 1499,
              currency: 'usd',
              status_transitions: { paid_at: input.periodStart },
            },
          ],
        },
        lines: {
          object: 'list',
          has_more: false,
          data: [
            {
              id: `il_${input.fixtureKey}`,
              object: 'line_item',
              amount: 1499,
              currency: 'usd',
              quantity: 1,
              discount_amounts: [],
              discounts: [],
              pretax_credit_amounts: [],
              taxes: [],
              parent: {
                type: 'subscription_item_details',
                subscription_item_details: {
                  subscription: input.externalSubscriptionId,
                  subscription_item: `si_${input.fixtureKey}`,
                  proration: false,
                },
              },
              pricing: {
                price_details: {
                  price: 'price_family_month_fixture',
                  product: 'prod_family_fixture',
                },
              },
              period: { start: input.periodStart, end: input.periodEnd },
            },
          ],
        },
      };
    }
    if (path === `/v1/payment_intents/${paymentIntentId}`) {
      return {
        id: paymentIntentId,
        object: 'payment_intent',
        livemode: false,
        status: 'succeeded',
        amount: 1499,
        amount_received: 1499,
        currency: 'usd',
      };
    }
    if (path === `/v1/subscriptions/${input.externalSubscriptionId}`) return subscription;
    return {};
  });
  const paid = await send({
    id: `evt_${input.fixtureKey}_invoice_paid`,
    type: 'invoice.paid',
    created: input.periodStart,
    livemode: false,
    api_version: apiVersion,
    data: { object: { id: invoiceId, object: 'invoice' } },
  });
  expect(paid.statusCode).toBe(202);
  await runReconciliation(input.database, input.transport, input.now);
}

describe('Stripe test-mode transaction path', () => {
  const clock = createMutableClock();
  let app: FastifyInstance;
  let database: Awaited<ReturnType<typeof createPGliteDatabase>>;
  let transport: StripeTransport;

  beforeEach(async () => {
    database = await createPGliteDatabase(':memory:');
    transport = {
      postForm: vi.fn(async ({ path, form }) =>
        path === '/v1/checkout/sessions'
          ? {
              id: 'cs_test_fixture_123',
              object: 'checkout.session',
              livemode: false,
              url: 'https://checkout.stripe.com/c/pay/session-fixture',
              mode: 'subscription',
              status: 'open',
              payment_status: 'unpaid',
              client_reference_id: form.client_reference_id,
              success_url: form.success_url,
              cancel_url: form.cancel_url,
              customer: form.customer ?? null,
              metadata: {
                household_id: form['metadata[household_id]'],
                canonical_subscription_id: form['metadata[canonical_subscription_id]'],
                plan_version_id: form['metadata[plan_version_id]'],
              },
              expires_at: Number(form.expires_at),
            }
          : {
              id: 'bps_test_fixture',
              object: 'billing_portal.session',
              livemode: false,
              url: 'https://billing.stripe.com/p/session/portal-fixture',
              customer: form.customer,
              configuration: form.configuration,
              return_url: form.return_url,
            },
      ),
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
    };
    app = await buildApp({
      config: stripeConfig(),
      database,
      closeDatabase: false,
      stripeTransport: transport,
      now: clock.now,
      logger: createLogger({ level: 'error', sink: () => undefined, clock: clock.now }),
    });
    const runtime = new CommerceRuntimeRepository(database);
    await runtime.changeStripeInitiationControl({
      environment: 'test',
      nextState: 'enabled',
      reasonCode: 'founder_test_activation',
      expectedRevision: 0,
      actorPersonId: 'person-hq-heidi',
      configuredFounderPersonId: 'person-hq-heidi',
      correlationId: 'stripe-test-control-0001',
      now: clock.now(),
    });
    await runtime.changeStripeHouseholdEligibility({
      householdId: 'household-sunrise',
      nextState: 'eligible',
      actorPersonId: 'person-hq-heidi',
      configuredFounderPersonId: 'person-hq-heidi',
      correlationId: 'stripe-test-eligible-0001',
      now: clock.now(),
    });
  });

  afterEach(async () => {
    await app.close();
    await database.close();
  });

  it('queues signed asynchronous Checkout payment failure for provider reconciliation', async () => {
    const created = Math.floor(clock.now().getTime() / 1_000);
    const rawBody = JSON.stringify({
      id: 'evt_async_payment_failed_fixture',
      type: 'checkout.session.async_payment_failed',
      created,
      livemode: false,
      api_version: apiVersion,
      data: {
        object: {
          id: 'cs_test_async_payment_failed',
          object: 'checkout.session',
          livemode: false,
          mode: 'subscription',
          status: 'complete',
          payment_status: 'unpaid',
          amount_total: 1499,
          currency: 'usd',
          expires_at: created + 3600,
          customer: 'cus_async_payment_failed',
          subscription: 'sub_async_payment_failed',
          metadata: {
            household_id: 'household-sunrise',
            canonical_subscription_id: 'subscription-async-payment-failed',
            plan_version_id: 'family_v1',
          },
        },
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signStripeFixture({
          rawBody,
          endpointSecret,
          timestampSeconds: created,
        }),
      },
      payload: rawBody,
    });

    expect(response.statusCode, response.body).toBe(202);
    expect(response.json()).toMatchObject({
      received: true,
      duplicate: false,
      application: 'reconciliation_queued',
    });
    const queued = await database.query<
      { readonly job_type: string; readonly payload: unknown } & Record<string, unknown>
    >(
      `SELECT job_type, payload
         FROM durable_jobs
        WHERE job_type = 'commerce.reconcile'
        ORDER BY created_at DESC
        LIMIT 1`,
    );
    expect(queued.rows[0]).toMatchObject({
      job_type: 'commerce.reconcile',
      payload: expect.objectContaining({
        environment: 'test',
        eventType: 'checkout.session.async_payment_failed',
        externalSubscriptionId: 'sub_async_payment_failed',
      }),
    });
  });

  it('binds checkout, signed webhook, canonical grant, portal, and duplicate delivery', async () => {
    const cookie = await login(app, 'owner-alice');
    const headers = {
      cookie,
      origin: customerOrigin,
      'x-bb-household-id': 'household-sunrise',
      'idempotency-key': 'checkout_fixture_request_0001',
    };
    const checkout = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers,
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    expect(checkout.statusCode, checkout.body).toBe(201);
    const checkoutBody = checkout.json<{
      checkout: { canonicalSubscriptionId: string; sessionId: string; expiresAt: string };
    }>();
    expect(checkoutBody.checkout.sessionId).toBe('cs_test_fixture_123');

    const repeated = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers,
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    expect(repeated.statusCode).toBe(200);
    const intents = await database.query<{ count: number } & Record<string, unknown>>(
      `SELECT count(*)::int AS count FROM commerce_checkout_intents
       WHERE household_id = 'household-sunrise'`,
    );
    expect(intents.rows[0]?.count).toBe(1);
    const preflightBinding = await database.query<
      {
        readonly preflight_record_id: string;
        readonly operation_environment: string;
        readonly preflight_environment: string;
        readonly offer_id: string;
        readonly operation_price_id: string;
        readonly preflight_price_id: string;
      } & Record<string, unknown>
    >(
      `SELECT operation.preflight_record_id,
              operation.environment AS operation_environment,
              preflight.environment AS preflight_environment,
              preflight.offer_id,
              operation.provider_price_id AS operation_price_id,
              preflight.provider_price_id AS preflight_price_id
       FROM commerce_stripe_session_operations operation
       JOIN commerce_stripe_preflight_records preflight
         ON preflight.id = operation.preflight_record_id
        AND preflight.environment = operation.environment
       WHERE operation.checkout_intent_id = (
         SELECT intent.id FROM commerce_checkout_intents intent
         WHERE intent.household_id = 'household-sunrise'
           AND intent.subscription_id = $1
       )`,
      [checkoutBody.checkout.canonicalSubscriptionId],
    );
    expect(preflightBinding.rows).toEqual([
      {
        preflight_record_id: expect.any(String),
        operation_environment: 'test',
        preflight_environment: 'test',
        offer_id: 'founding_family_monthly_v1',
        operation_price_id: 'price_family_month_fixture',
        preflight_price_id: 'price_family_month_fixture',
      },
    ]);

    const parallelCheckout = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers: { ...headers, 'idempotency-key': 'checkout_fixture_request_0002' },
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    expect(parallelCheckout.statusCode).toBe(409);

    const initialStart = Math.floor(clock.now().getTime() / 1_000);
    const initialEnd = initialStart + 30 * 86_400;
    const checkoutExpiresAt = new Date(checkoutBody.checkout.expiresAt).getTime() / 1_000;
    const checkoutEvent = JSON.stringify({
      id: 'evt_fixture_checkout_completed_1',
      type: 'checkout.session.completed',
      created: initialStart,
      livemode: false,
      api_version: apiVersion,
      data: {
        object: {
          id: 'cs_test_fixture_123',
          object: 'checkout.session',
          livemode: false,
          mode: 'subscription',
          customer: 'cus_fixture_1',
          subscription: 'sub_stripe_fixture_1',
          payment_intent: 'pi_checkout_fixture_1',
          status: 'complete',
          payment_status: 'paid',
          amount_total: 1499,
          currency: 'usd',
          expires_at: checkoutExpiresAt,
          metadata: {
            household_id: 'household-sunrise',
            canonical_subscription_id: checkoutBody.checkout.canonicalSubscriptionId,
            plan_version_id: 'family_v1',
          },
        },
      },
    });
    const checkoutSignature = signStripeFixture({
      rawBody: checkoutEvent,
      endpointSecret,
      timestampSeconds: initialStart,
    });
    for (const duplicate of [false, true]) {
      const webhook = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': checkoutSignature },
        payload: checkoutEvent,
      });
      expect(webhook.statusCode).toBe(200);
      expect(webhook.json()).toMatchObject({ received: true, duplicate, application: 'applied' });
    }

    const pending = await database.query<
      { lifecycle: string; source_verified: boolean; grants: number } & Record<string, unknown>
    >(
      `SELECT subscription.lifecycle, subscription.source_verified,
              (SELECT count(*)::int FROM entitlement_grants grant_record
               WHERE grant_record.household_id = subscription.household_id
                 AND grant_record.subscription_id = subscription.id
                 AND grant_record.revoked_at IS NULL) AS grants
       FROM commerce_subscriptions subscription
       WHERE subscription.household_id = 'household-sunrise' AND subscription.id = $1`,
      [checkoutBody.checkout.canonicalSubscriptionId],
    );
    expect(pending.rows[0]).toEqual({ lifecycle: 'pending', source_verified: false, grants: 0 });

    vi.mocked(transport.get).mockImplementation(async ({ path }) => {
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
      if (path === '/v1/invoices/in_fixture_initial_paid') {
        return {
          id: 'in_fixture_initial_paid',
          object: 'invoice',
          livemode: false,
          status: 'paid',
          billing_reason: 'subscription_create',
          amount_paid: 1499,
          amount_remaining: 0,
          currency: 'usd',
          subtotal: 1499,
          total: 1499,
          total_discount_amounts: [],
          total_pretax_credit_amounts: [],
          total_taxes: [],
          discounts: [],
          pre_payment_credit_notes_amount: 0,
          post_payment_credit_notes_amount: 0,
          starting_balance: 0,
          ending_balance: 0,
          amount_overpaid: 0,
          parent: { subscription_details: { subscription: 'sub_stripe_fixture_1' } },
          payments: {
            object: 'list',
            has_more: false,
            data: [
              {
                id: 'inpay_fixture_initial_paid',
                object: 'invoice_payment',
                livemode: false,
                invoice: 'in_fixture_initial_paid',
                payment: { type: 'payment_intent', payment_intent: 'pi_fixture_initial_paid' },
                status: 'paid',
                is_default: true,
                amount_paid: 1499,
                amount_requested: 1499,
                currency: 'usd',
                status_transitions: { paid_at: initialStart },
              },
            ],
          },
          lines: {
            object: 'list',
            has_more: false,
            data: [
              {
                id: 'il_fixture_initial_paid',
                object: 'line_item',
                amount: 1499,
                currency: 'usd',
                quantity: 1,
                discount_amounts: [],
                discounts: [],
                pretax_credit_amounts: [],
                taxes: [],
                parent: {
                  type: 'subscription_item_details',
                  subscription_item_details: {
                    subscription: 'sub_stripe_fixture_1',
                    subscription_item: 'si_stripe_fixture_1',
                    proration: false,
                  },
                },
                pricing: {
                  price_details: {
                    price: 'price_family_month_fixture',
                    product: 'prod_family_fixture',
                  },
                },
                period: { start: initialStart, end: initialEnd },
              },
            ],
          },
        };
      }
      if (path === '/v1/payment_intents/pi_fixture_initial_paid') {
        return {
          id: 'pi_fixture_initial_paid',
          object: 'payment_intent',
          livemode: false,
          status: 'succeeded',
          amount: 1499,
          amount_received: 1499,
          currency: 'usd',
        };
      }
      if (path === '/v1/subscriptions/sub_stripe_fixture_1') {
        return {
          id: 'sub_stripe_fixture_1',
          object: 'subscription',
          livemode: false,
          customer: 'cus_fixture_1',
          status: 'active',
          cancel_at_period_end: false,
          created: initialStart,
          current_period_start: initialStart,
          current_period_end: initialEnd,
          items: {
            has_more: false,
            data: [
              {
                id: 'si_stripe_fixture_1',
                quantity: 1,
                price: {
                  id: 'price_family_month_fixture',
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
                },
              },
            ],
          },
        };
      }
      return {};
    });
    const invoiceEvent = JSON.stringify({
      id: 'evt_fixture_invoice_paid_1',
      type: 'invoice.paid',
      created: initialStart,
      livemode: false,
      api_version: apiVersion,
      data: { object: { id: 'in_fixture_initial_paid', object: 'invoice' } },
    });
    const invoiceWebhook = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signStripeFixture({
          rawBody: invoiceEvent,
          endpointSecret,
          timestampSeconds: initialStart,
        }),
      },
      payload: invoiceEvent,
    });
    expect(invoiceWebhook.statusCode).toBe(202);
    expect(invoiceWebhook.json()).toMatchObject({ application: 'reconciliation_queued' });
    await runReconciliation(database, transport, clock.now);

    const canonical = await database.query<
      { lifecycle: string; source_verified: boolean; grants: number } & Record<string, unknown>
    >(
      `SELECT subscription.lifecycle, subscription.source_verified,
              (SELECT count(*)::int FROM entitlement_grants grant_record
               WHERE grant_record.household_id = subscription.household_id
                 AND grant_record.subscription_id = subscription.id
                 AND grant_record.source = 'web' AND grant_record.source_verified = true
                 AND grant_record.revoked_at IS NULL) AS grants
       FROM commerce_subscriptions subscription
       WHERE subscription.household_id = 'household-sunrise' AND subscription.id = $1`,
      [checkoutBody.checkout.canonicalSubscriptionId],
    );
    expect(canonical.rows[0]).toMatchObject({
      lifecycle: 'active',
      source_verified: true,
      grants: 1,
    });
    const paidProof = await database.query<
      {
        readonly amount_paid: number;
        readonly amount_remaining: number;
        readonly currency: string;
        readonly quantity: number;
        readonly discount_amount: number;
        readonly tax_amount: number;
        readonly billing_reason: string;
        readonly provider_invoice_payment_id: string;
      } & Record<string, unknown>
    >(
      `SELECT amount_paid, amount_remaining, currency, quantity, discount_amount,
              tax_amount, billing_reason, provider_invoice_payment_id
       FROM commerce_stripe_paid_invoice_evidence
       WHERE provider_invoice_id = 'in_fixture_initial_paid'`,
    );
    expect(paidProof.rows[0]).toEqual({
      amount_paid: 1499,
      amount_remaining: 0,
      currency: 'usd',
      quantity: 1,
      discount_amount: 0,
      tax_amount: 0,
      billing_reason: 'subscription_create',
      provider_invoice_payment_id: 'inpay_fixture_initial_paid',
    });
    const authorityFacts = await database.query<
      {
        readonly invoice_credits_empty: boolean;
        readonly invoice_discounts_empty: boolean;
        readonly invoice_taxes_empty: boolean;
        readonly provider_invoice_line_id: string;
        readonly provider_product_id: string;
        readonly provider_subscription_item_id: string;
        readonly subscription_page_complete: boolean;
      } & Record<string, unknown>
    >(
      `SELECT provider_invoice_line_id, provider_subscription_item_id,
              provider_product_id, invoice_discounts_empty, invoice_taxes_empty,
              invoice_credits_empty, subscription_page_complete
       FROM commerce_stripe_invoice_authority_facts
       WHERE provider_invoice_id = 'in_fixture_initial_paid'`,
    );
    expect(authorityFacts.rows[0]).toEqual({
      provider_invoice_line_id: 'il_fixture_initial_paid',
      provider_subscription_item_id: 'si_stripe_fixture_1',
      provider_product_id: 'prod_family_fixture',
      invoice_discounts_empty: true,
      invoice_taxes_empty: true,
      invoice_credits_empty: true,
      subscription_page_complete: true,
    });
    const retrievedSnapshotProvenance = await database.query<
      {
        readonly evidence_tier: string;
        readonly runtime_run_id: string;
        readonly signature_verified_at: unknown;
        readonly transport_kind: string;
        readonly transport_livemode: boolean;
      } & Record<string, unknown>
    >(
      `SELECT evidence_tier, transport_kind, transport_livemode,
              runtime_run_id, signature_verified_at
       FROM commerce_event_inbox
       WHERE event_type = 'subscription.reconciliation'
         AND provider_object_id = 'sub_stripe_fixture_1'`,
    );
    expect(retrievedSnapshotProvenance.rows[0]).toMatchObject({
      evidence_tier: 'local_fixture',
      transport_kind: 'injected_fixture',
      transport_livemode: false,
      signature_verified_at: null,
    });
    expect(retrievedSnapshotProvenance.rows[0]?.runtime_run_id).toMatch(/^api-/u);

    vi.mocked(transport.get).mockImplementation(async ({ path }) => {
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
    });

    const portal = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/portal',
      headers: { ...headers, 'idempotency-key': 'portal_fixture_request_0001' },
    });
    expect(portal.statusCode, portal.body).toBe(200);
    expect(transport.postForm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: '/v1/billing_portal/sessions',
        form: expect.objectContaining({ customer: 'cus_fixture_1' }),
      }),
    );
    const preflightReceipts = await database.query<
      {
        readonly authenticity_kind: string;
        readonly account_business_type: string | null;
        readonly account_charges_enabled: boolean;
        readonly account_country: string | null;
        readonly account_payouts_enabled: boolean;
        readonly evidence_digest: string;
        readonly evidence_level: string;
        readonly portal_mutation_controls_exact: boolean;
        readonly portal_invoice_history_enabled: boolean;
        readonly retention_coupon_evidence: string;
        readonly runtime_run_id: string;
        readonly transport_kind: string;
      } & Record<string, unknown>
    >(
      `SELECT evidence_level, evidence_digest, transport_kind, runtime_run_id,
              authenticity_kind, portal_mutation_controls_exact, retention_coupon_evidence,
              portal_invoice_history_enabled,
              account_charges_enabled, account_payouts_enabled, account_country,
              account_business_type
       FROM commerce_stripe_preflight_records
       WHERE environment = 'test'
       ORDER BY id`,
    );
    expect(preflightReceipts.rows).toHaveLength(4);
    expect(new Set(preflightReceipts.rows.map((row) => row.evidence_digest)).size).toBe(1);
    for (const receipt of preflightReceipts.rows) {
      expect(receipt).toMatchObject({
        evidence_level: 'local_fixture',
        transport_kind: 'injected_fixture',
        authenticity_kind: 'fixture_assertion',
        account_charges_enabled: false,
        account_payouts_enabled: false,
        account_country: null,
        account_business_type: null,
        portal_mutation_controls_exact: true,
        portal_invoice_history_enabled: true,
        retention_coupon_evidence: 'manual_founder_browser_required',
      });
      expect(receipt.runtime_run_id).toMatch(/^api-/u);
    }
    const webhookProvenance = await database.query<
      {
        readonly evidence_tier: string;
        readonly runtime_run_id: string;
        readonly signature_verified_at: Date;
        readonly transport_kind: string;
        readonly transport_livemode: boolean;
      } & Record<string, unknown>
    >(
      `SELECT evidence_tier, transport_kind, transport_livemode, runtime_run_id,
              signature_verified_at
       FROM commerce_event_inbox
       WHERE external_event_id = 'evt_fixture_checkout_completed_1'`,
    );
    expect(webhookProvenance.rows[0]).toMatchObject({
      evidence_tier: 'local_fixture',
      transport_kind: 'injected_fixture',
      transport_livemode: false,
    });
    expect(webhookProvenance.rows[0]?.runtime_run_id).toMatch(/^api-/u);
    expect(webhookProvenance.rows[0]?.signature_verified_at).toBeDefined();
  });

  it('advances paid-through only from the matching paid invoice service period', async () => {
    const cookie = await login(app, 'owner-alice');
    const checkout = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers: {
        cookie,
        origin: customerOrigin,
        'x-bb-household-id': 'household-sunrise',
        'idempotency-key': 'checkout_paid_period_proof_0001',
      },
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    const checkoutBody = checkout.json<{
      checkout: { canonicalSubscriptionId: string; expiresAt: string };
    }>();
    const subscriptionId = checkoutBody.checkout.canonicalSubscriptionId;
    const initialStart = Math.floor(clock.now().getTime() / 1_000);
    const initialEnd = initialStart + 30 * 86_400;
    const renewalEnd = initialEnd + 30 * 86_400;
    const subscriptionObject = (start: number, end: number) => ({
      id: 'sub_paid_period_proof',
      object: 'subscription',
      livemode: false,
      customer: 'cus_paid_period_proof',
      status: 'active',
      cancel_at_period_end: false,
      created: initialStart,
      current_period_start: start,
      current_period_end: end,
      items: {
        has_more: false,
        data: [
          {
            id: 'si_paid_period_proof',
            quantity: 1,
            price: {
              id: 'price_family_month_fixture',
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
            },
          },
        ],
      },
    });
    const sendWebhook = async (event: Record<string, unknown>) => {
      const rawBody = JSON.stringify(event);
      const created = Number(event.created);
      return app.inject({
        method: 'POST',
        url: '/v1/webhooks/stripe',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': signStripeFixture({
            rawBody,
            endpointSecret,
            timestampSeconds: created,
          }),
        },
        payload: rawBody,
      });
    };
    const activation = await sendWebhook({
      id: 'evt_paid_period_checkout_completed',
      type: 'checkout.session.completed',
      created: initialStart,
      livemode: false,
      api_version: apiVersion,
      data: {
        object: {
          id: 'cs_test_fixture_123',
          object: 'checkout.session',
          livemode: false,
          mode: 'subscription',
          customer: 'cus_paid_period_proof',
          subscription: 'sub_paid_period_proof',
          payment_intent: 'pi_checkout_paid_period_proof',
          status: 'complete',
          payment_status: 'paid',
          amount_total: 1499,
          currency: 'usd',
          expires_at: new Date(checkoutBody.checkout.expiresAt).getTime() / 1_000,
          metadata: {
            household_id: 'household-sunrise',
            canonical_subscription_id: subscriptionId,
            plan_version_id: 'family_v1',
          },
        },
      },
    });
    expect(activation.statusCode).toBe(200);

    let snapshotStart = initialStart;
    let snapshotEnd = initialEnd;
    const paidInvoice = (id: string, start: number, end: number) => {
      const paymentIntentId = `pi_${id}`;
      return {
        id,
        object: 'invoice',
        livemode: false,
        status: 'paid',
        billing_reason: start === initialStart ? 'subscription_create' : 'subscription_cycle',
        amount_paid: 1499,
        amount_remaining: 0,
        currency: 'usd',
        subtotal: 1499,
        total: 1499,
        total_discount_amounts: [],
        total_pretax_credit_amounts: [],
        total_taxes: [],
        discounts: [],
        pre_payment_credit_notes_amount: 0,
        post_payment_credit_notes_amount: 0,
        starting_balance: 0,
        ending_balance: 0,
        amount_overpaid: 0,
        parent: { subscription_details: { subscription: 'sub_paid_period_proof' } },
        payments: {
          object: 'list',
          has_more: false,
          data: [
            {
              id: `inpay_${id}`,
              object: 'invoice_payment',
              livemode: false,
              invoice: id,
              payment: { type: 'payment_intent', payment_intent: paymentIntentId },
              status: 'paid',
              is_default: true,
              amount_paid: 1499,
              amount_requested: 1499,
              currency: 'usd',
              status_transitions: { paid_at: Math.floor(clock.now().getTime() / 1_000) },
            },
          ],
        },
        lines: {
          object: 'list',
          has_more: false,
          data: [
            {
              id: `il_${id}`,
              object: 'line_item',
              amount: 1499,
              currency: 'usd',
              quantity: 1,
              discount_amounts: [],
              discounts: [],
              pretax_credit_amounts: [],
              taxes: [],
              parent: {
                type: 'subscription_item_details',
                subscription_item_details: {
                  subscription: 'sub_paid_period_proof',
                  subscription_item: 'si_paid_period_proof',
                  proration: false,
                },
              },
              pricing: {
                price_details: {
                  price: 'price_family_month_fixture',
                  product: 'prod_family_fixture',
                },
              },
              period: { start, end },
            },
          ],
        },
      };
    };
    vi.mocked(transport.get).mockImplementation(async ({ path }) => {
      if (path === '/v1/invoices/in_paid_period_initial') {
        return paidInvoice('in_paid_period_initial', initialStart, initialEnd);
      }
      if (path === '/v1/invoices/in_paid_period_old') {
        return paidInvoice('in_paid_period_old', initialStart, initialEnd);
      }
      if (path === '/v1/invoices/in_paid_period_renewal') {
        return paidInvoice('in_paid_period_renewal', initialEnd, renewalEnd);
      }
      if (path.startsWith('/v1/payment_intents/pi_in_paid_period_')) {
        return {
          id: path.slice('/v1/payment_intents/'.length),
          object: 'payment_intent',
          livemode: false,
          status: 'succeeded',
          amount: 1499,
          amount_received: 1499,
          currency: 'usd',
        };
      }
      if (path === '/v1/subscriptions/sub_paid_period_proof') {
        return subscriptionObject(snapshotStart, snapshotEnd);
      }
      return {};
    });
    const sendPaidInvoice = async (eventId: string, invoiceId: string) => {
      clock.advance(1_000);
      const created = Math.floor(clock.now().getTime() / 1_000);
      const response = await sendWebhook({
        id: eventId,
        type: 'invoice.paid',
        created,
        livemode: false,
        api_version: apiVersion,
        data: { object: { id: invoiceId, object: 'invoice' } },
      });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({ application: 'reconciliation_queued' });
      await runReconciliation(database, transport, clock.now);
    };
    await sendPaidInvoice('evt_paid_period_initial_invoice', 'in_paid_period_initial');

    clock.advance(30 * 86_400_000 + 1_000);
    snapshotStart = initialEnd;
    snapshotEnd = renewalEnd;
    const renewalStatusCreated = Math.floor(clock.now().getTime() / 1_000);
    const unprovedRenewal = await sendWebhook({
      id: 'evt_paid_period_unproved_renewal',
      type: 'customer.subscription.updated',
      created: renewalStatusCreated,
      livemode: false,
      api_version: apiVersion,
      data: { object: subscriptionObject(initialEnd, renewalEnd) },
    });
    expect(unprovedRenewal.statusCode).toBe(200);
    const periodAfterStatus = await database.query<
      { readonly current_period_ends_at: unknown } & Record<string, unknown>
    >(
      `SELECT current_period_ends_at FROM commerce_subscriptions
       WHERE household_id = 'household-sunrise' AND id = $1`,
      [subscriptionId],
    );
    expect(new Date(String(periodAfterStatus.rows[0]?.current_period_ends_at))).toEqual(
      new Date(initialEnd * 1_000),
    );
    const accessAfterStatus = await new EntitlementRepository(
      database,
      undefined,
      'local',
    ).forHousehold('household-sunrise', clock.now());
    expect(
      accessAfterStatus.portfolio.sources.find((source) => source.subscriptionId === subscriptionId)
        ?.accessState,
    ).toBe('expired');

    await sendPaidInvoice('evt_paid_period_old_invoice', 'in_paid_period_old');
    const mismatchedInvoice = await database.query<
      { readonly application_state: string; readonly error_code: string | null } & Record<
        string,
        unknown
      >
    >(
      `SELECT application_state, error_code FROM commerce_event_inbox
       WHERE provider = 'stripe' AND environment = 'test' AND external_event_id = $1`,
      ['evt_paid_period_old_invoice'],
    );
    expect(mismatchedInvoice.rows[0]).toMatchObject({
      application_state: 'quarantined',
      error_code: 'stripe.reconciliation_evidence_mismatch',
    });
    const periodAfterOldInvoice = await database.query<
      { readonly current_period_ends_at: unknown } & Record<string, unknown>
    >(
      `SELECT current_period_ends_at FROM commerce_subscriptions
       WHERE household_id = 'household-sunrise' AND id = $1`,
      [subscriptionId],
    );
    expect(new Date(String(periodAfterOldInvoice.rows[0]?.current_period_ends_at))).toEqual(
      new Date(initialEnd * 1_000),
    );
    const accessAfterOldInvoice = await new EntitlementRepository(
      database,
      undefined,
      'local',
    ).forHousehold('household-sunrise', clock.now());
    expect(
      accessAfterOldInvoice.portfolio.sources.find(
        (source) => source.subscriptionId === subscriptionId,
      )?.accessState,
    ).toBe('expired');

    await sendPaidInvoice('evt_paid_period_current_invoice', 'in_paid_period_renewal');
    const periodAfterCurrentInvoice = await database.query<
      {
        readonly current_period_starts_at: unknown;
        readonly current_period_ends_at: unknown;
      } & Record<string, unknown>
    >(
      `SELECT current_period_starts_at, current_period_ends_at FROM commerce_subscriptions
       WHERE household_id = 'household-sunrise' AND id = $1`,
      [subscriptionId],
    );
    expect(new Date(String(periodAfterCurrentInvoice.rows[0]?.current_period_starts_at))).toEqual(
      new Date(initialEnd * 1_000),
    );
    expect(new Date(String(periodAfterCurrentInvoice.rows[0]?.current_period_ends_at))).toEqual(
      new Date(renewalEnd * 1_000),
    );
    const accessAfterCurrentInvoice = await new EntitlementRepository(
      database,
      undefined,
      'local',
    ).forHousehold('household-sunrise', clock.now());
    expect(
      accessAfterCurrentInvoice.portfolio.sources.find(
        (source) => source.subscriptionId === subscriptionId,
      )?.accessState,
    ).toBe('effective');
  });

  it('holds a large incomplete first subscription pending until Checkout binding exists', async () => {
    const cookie = await login(app, 'owner-alice');
    const headers = {
      cookie,
      origin: customerOrigin,
      'x-bb-household-id': 'household-sunrise',
      'idempotency-key': 'checkout_fixture_reconcile_0001',
    };
    const checkout = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers,
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    expect(checkout.statusCode).toBe(201);
    const subscriptionId = checkout.json<{ checkout: { canonicalSubscriptionId: string } }>()
      .checkout.canonicalSubscriptionId;
    const periodStart = Math.floor(clock.now().getTime() / 1_000);
    const periodEnd = periodStart + 30 * 86_400;
    vi.mocked(transport.get).mockResolvedValue({
      id: 'sub_reconcile_fixture_1',
      object: 'subscription',
      livemode: false,
      customer: 'cus_reconcile_fixture_1',
      status: 'active',
      created: periodStart,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      items: {
        has_more: false,
        data: [
          {
            id: 'si_financial_fixture',
            quantity: 1,
            price: {
              id: 'price_family_month_fixture',
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
            },
          },
        ],
      },
    });
    const event = JSON.stringify({
      id: 'evt_large_incomplete_first',
      type: 'customer.subscription.updated',
      created: periodStart,
      livemode: false,
      api_version: apiVersion,
      data: {
        object: {
          id: 'sub_reconcile_fixture_1',
          object: 'subscription',
          livemode: false,
          customer: 'cus_reconcile_fixture_1',
          status: 'active',
          metadata: {
            household_id: 'household-sunrise',
            canonical_subscription_id: subscriptionId,
            plan_version_id: 'family_v1',
          },
          padding: 'x'.repeat(30_000),
        },
      },
    });
    const queued = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signStripeFixture({
          rawBody: event,
          endpointSecret,
          timestampSeconds: periodStart,
        }),
      },
      payload: event,
    });
    expect(queued.statusCode).toBe(202);
    expect(queued.json()).toMatchObject({ application: 'reconciliation_queued' });

    await runReconciliation(database, transport, clock.now);
    const state = await database.query<
      { lifecycle: string; reconciliation_state: string; job_state: string } & Record<
        string,
        unknown
      >
    >(
      `SELECT subscription.lifecycle, subscription.reconciliation_state,
              (SELECT state FROM durable_jobs WHERE job_type = 'commerce.reconcile') AS job_state
       FROM commerce_subscriptions subscription
       WHERE subscription.household_id = 'household-sunrise' AND subscription.id = $1`,
      [subscriptionId],
    );
    expect(state.rows[0]).toMatchObject({
      lifecycle: 'pending',
      reconciliation_state: 'pending',
      job_state: 'succeeded',
    });
    const inbox = await database.query<
      { readonly application_state: string; readonly error_code: string | null } & Record<
        string,
        unknown
      >
    >(
      `SELECT application_state, error_code FROM commerce_event_inbox
       WHERE provider = 'stripe' AND environment = 'test' AND external_event_id = $1`,
      ['evt_large_incomplete_first'],
    );
    expect(inbox.rows[0]).toMatchObject({
      application_state: 'pending',
      error_code: null,
    });
    const reconciliation = await database.query(
      `SELECT state, failure_code FROM commerce_reconciliation_runs
       WHERE trigger_event_id = (
         SELECT id FROM commerce_event_inbox WHERE external_event_id = $1
       )`,
      ['evt_large_incomplete_first'],
    );
    expect(reconciliation.rows[0]).toMatchObject({
      state: 'attention',
      failure_code: 'stripe.checkout_binding_pending',
    });
  });

  it('rejects a signed Stripe body above the verifier cap before application', async () => {
    const event = JSON.stringify({
      id: 'evt_too_large',
      type: 'customer.subscription.updated',
      created: Math.floor(clock.now().getTime() / 1_000),
      livemode: false,
      api_version: apiVersion,
      data: { object: { id: 'sub_too_large', padding: 'x'.repeat(257 * 1_024) } },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signStripeFixture({
          rawBody: event,
          endpointSecret,
          timestampSeconds: Math.floor(clock.now().getTime() / 1_000),
        }),
      },
      payload: event,
    });
    expect(response.statusCode).toBe(413);
  });

  it('persists transport ambiguity, rejects browser replay, and retries durably with the same key', async () => {
    const cookie = await login(app, 'owner-alice');
    const headers = {
      cookie,
      origin: customerOrigin,
      'x-bb-household-id': 'household-sunrise',
      'idempotency-key': 'checkout_outcome_unknown_fixture_0001',
    };
    vi.mocked(transport.postForm).mockRejectedValueOnce(new Error('fixture transport timeout'));
    const uncertain = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers,
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    expect(uncertain.statusCode).toBe(409);
    const persisted = await database.query<
      {
        readonly dispatch_state: string;
        readonly operation_state: string;
        readonly provider_idempotency_key: string;
      } & Record<string, unknown>
    >(
      `SELECT intent.dispatch_state, operation.state AS operation_state,
              operation.provider_idempotency_key
       FROM commerce_checkout_intents intent
       JOIN commerce_stripe_session_operations operation
         ON operation.checkout_intent_id = intent.id
        AND operation.household_id = intent.household_id
       WHERE intent.idempotency_key = 'checkout_outcome_unknown_fixture_0001'`,
    );
    expect(persisted.rows[0]).toMatchObject({
      dispatch_state: 'outcome_unknown',
      operation_state: 'outcome_unknown',
    });

    vi.mocked(transport.postForm).mockImplementationOnce(async ({ form }) => ({
      id: 'cs_test_outcome_unknown_reconciled',
      object: 'checkout.session',
      livemode: false,
      url: 'https://checkout.stripe.com/c/pay/outcome-unknown-reconciled',
      mode: 'subscription',
      status: 'open',
      payment_status: 'unpaid',
      client_reference_id: form.client_reference_id,
      success_url: form.success_url,
      cancel_url: form.cancel_url,
      customer: form.customer ?? null,
      metadata: {
        household_id: form['metadata[household_id]'],
        canonical_subscription_id: form['metadata[canonical_subscription_id]'],
        plan_version_id: form['metadata[plan_version_id]'],
      },
      expires_at: Number(form.expires_at),
    }));
    const retried = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers,
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    expect(retried.statusCode).toBe(409);
    expect(
      vi
        .mocked(transport.postForm)
        .mock.calls.filter(([request]) => request.path === '/v1/checkout/sessions'),
    ).toHaveLength(1);
    clock.advance(2 * 60_000 + 1_000);
    await runStripeSessionRetry(database, transport, clock.now);
    const checkoutCalls = vi
      .mocked(transport.postForm)
      .mock.calls.filter(([request]) => request.path === '/v1/checkout/sessions');
    expect(checkoutCalls).toHaveLength(2);
    expect(checkoutCalls[0]?.[0].idempotencyKey).toBe(persisted.rows[0]?.provider_idempotency_key);
    expect(checkoutCalls[1]?.[0].idempotencyKey).toBe(persisted.rows[0]?.provider_idempotency_key);
    const resolved = await database.query<
      { readonly dispatch_state: string; readonly operation_state: string } & Record<
        string,
        unknown
      >
    >(
      `SELECT intent.dispatch_state, operation.state AS operation_state
       FROM commerce_checkout_intents intent
       JOIN commerce_stripe_session_operations operation
         ON operation.checkout_intent_id = intent.id
        AND operation.household_id = intent.household_id
       WHERE intent.idempotency_key = 'checkout_outcome_unknown_fixture_0001'`,
    );
    expect(resolved.rows[0]).toEqual({
      dispatch_state: 'session_recorded',
      operation_state: 'succeeded',
    });
    const attempts = await database.query<
      {
        readonly attempt: number;
        readonly event_kind: string;
        readonly provider_idempotency_key: string;
      } & Record<string, unknown>
    >(
      `SELECT attempt, event_kind, provider_idempotency_key
       FROM commerce_stripe_session_operation_attempts
       WHERE operation_id = (
         SELECT id FROM commerce_stripe_session_operations
         WHERE server_operation_id = 'checkout_outcome_unknown_fixture_0001'
       )`,
    );
    expect(attempts.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attempt: 1,
          event_kind: 'dispatch_started',
          provider_idempotency_key: persisted.rows[0]?.provider_idempotency_key,
        }),
        expect.objectContaining({
          attempt: 1,
          event_kind: 'outcome_unknown',
          provider_idempotency_key: persisted.rows[0]?.provider_idempotency_key,
        }),
        expect.objectContaining({
          attempt: 2,
          event_kind: 'dispatch_started',
          provider_idempotency_key: persisted.rows[0]?.provider_idempotency_key,
        }),
        expect.objectContaining({
          attempt: 2,
          event_kind: 'succeeded',
          provider_idempotency_key: persisted.rows[0]?.provider_idempotency_key,
        }),
      ]),
    );
  });

  it('offers one founder-audited same-key retry only after the six-attempt ambiguity budget', async () => {
    const cookie = await login(app, 'owner-alice');
    const serverOperationId = 'checkout_founder_same_key_repair_0001';
    const headers = {
      cookie,
      origin: customerOrigin,
      'x-bb-household-id': 'household-sunrise',
      'idempotency-key': serverOperationId,
    };
    for (let attempt = 0; attempt < 6; attempt += 1) {
      vi.mocked(transport.postForm).mockRejectedValueOnce(
        new Error(`fixture transport ambiguity ${attempt + 1}`),
      );
    }
    const initial = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers,
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    expect(initial.statusCode).toBe(409);
    for (let cycle = 0; cycle < 12; cycle += 1) {
      const operation = await database.query<
        { readonly attempt_count: number; readonly next_retry_at: unknown } & Record<
          string,
          unknown
        >
      >(
        `SELECT attempt_count, next_retry_at FROM commerce_stripe_session_operations
         WHERE environment = 'test' AND action = 'checkout'
           AND household_id = 'household-sunrise' AND server_operation_id = $1`,
        [serverOperationId],
      );
      if (operation.rows[0]?.attempt_count === 6 && operation.rows[0].next_retry_at === null) break;
      clock.advance(2 * 60_000);
      await runStripeSessionRetry(database, transport, clock.now);
    }
    const beforeRepair = await database.query<
      {
        readonly id: string;
        readonly state: string;
        readonly attempt_count: number;
        readonly authorized_attempt_limit: number;
        readonly manual_retry_revision: number;
        readonly next_retry_at: unknown;
        readonly provider_idempotency_key: string;
      } & Record<string, unknown>
    >(
      `SELECT id, state, attempt_count, authorized_attempt_limit, manual_retry_revision,
              next_retry_at, provider_idempotency_key
       FROM commerce_stripe_session_operations
       WHERE environment = 'test' AND action = 'checkout'
         AND household_id = 'household-sunrise' AND server_operation_id = $1`,
      [serverOperationId],
    );
    expect(beforeRepair.rows[0]).toMatchObject({
      state: 'outcome_unknown',
      attempt_count: 6,
      authorized_attempt_limit: 6,
      manual_retry_revision: 0,
      next_retry_at: null,
    });
    const providerKey = beforeRepair.rows[0]?.provider_idempotency_key;
    expect(
      vi
        .mocked(transport.postForm)
        .mock.calls.filter(([request]) => request.path === '/v1/checkout/sessions'),
    ).toHaveLength(6);

    const founder = await loginHq(app);
    const hqHeaders = { cookie: founder, origin: hqOrigin };
    const query = new URLSearchParams({
      householdId: 'household-sunrise',
      serverOperationId,
    });
    const runtime = new CommerceRuntimeRepository(database);
    await runtime.changeStripeInitiationControl({
      environment: 'test',
      nextState: 'disabled',
      reasonCode: 'founder_disable',
      expectedRevision: 1,
      actorPersonId: 'person-hq-heidi',
      configuredFounderPersonId: 'person-hq-heidi',
      correlationId: 'stripe-session-repair-gate-closed-0001',
      now: clock.now(),
    });
    const closedProjection = await app.inject({
      method: 'GET',
      url: `/v1/hq/commerce/stripe/session-retry-repair?${query.toString()}`,
      headers: hqHeaders,
    });
    expect(closedProjection.statusCode, closedProjection.body).toBe(200);
    expect(closedProjection.json()).toMatchObject({ repairAvailable: false });
    const closedRepair = await app.inject({
      method: 'POST',
      url: '/v1/hq/commerce/stripe/session-retry-repair',
      headers: hqHeaders,
      payload: {
        householdId: 'household-sunrise',
        serverOperationId,
        expectedRevision: 0,
        reasonCode: 'founder_bounded_same_key_retry',
        correlationId: 'stripe-session-repair-refused-closed-gate-0001',
      },
    });
    expect(closedRepair.statusCode).toBe(403);
    await runtime.changeStripeInitiationControl({
      environment: 'test',
      nextState: 'enabled',
      reasonCode: 'founder_test_activation',
      expectedRevision: 2,
      actorPersonId: 'person-hq-heidi',
      configuredFounderPersonId: 'person-hq-heidi',
      correlationId: 'stripe-session-repair-gate-reopened-0001',
      now: clock.now(),
    });
    const projection = await app.inject({
      method: 'GET',
      url: `/v1/hq/commerce/stripe/session-retry-repair?${query.toString()}`,
      headers: hqHeaders,
    });
    expect(projection.statusCode, projection.body).toBe(200);
    expect(projection.json()).toMatchObject({
      householdId: 'household-sunrise',
      serverOperationId,
      state: 'outcome_unknown',
      attemptCount: 6,
      authorizedAttemptLimit: 6,
      revision: 0,
      attentionState: 'open',
      repairAvailable: true,
    });
    const repairPayload = {
      householdId: 'household-sunrise',
      serverOperationId,
      expectedRevision: 0,
      reasonCode: 'founder_bounded_same_key_retry',
      correlationId: 'stripe-session-repair-correlation-0001',
    } as const;
    const repaired = await app.inject({
      method: 'POST',
      url: '/v1/hq/commerce/stripe/session-retry-repair',
      headers: hqHeaders,
      payload: repairPayload,
    });
    expect(repaired.statusCode, repaired.body).toBe(200);
    expect(repaired.json()).toMatchObject({
      revision: 1,
      authorizedAttemptLimit: 7,
      duplicate: false,
    });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/v1/hq/commerce/stripe/session-retry-repair',
      headers: hqHeaders,
      payload: repairPayload,
    });
    expect(duplicate.statusCode, duplicate.body).toBe(200);
    expect(duplicate.json()).toMatchObject({ duplicate: true, revision: 1 });
    const conflictingReplay = await app.inject({
      method: 'POST',
      url: '/v1/hq/commerce/stripe/session-retry-repair',
      headers: hqHeaders,
      payload: { ...repairPayload, correlationId: 'stripe-session-repair-correlation-0002' },
    });
    expect(conflictingReplay.statusCode).toBe(409);
    await runStripeSessionRetry(database, transport, clock.now);
    const afterRepair = await database.query<
      {
        readonly state: string;
        readonly attempt_count: number;
        readonly authorized_attempt_limit: number;
        readonly manual_retry_revision: number;
        readonly repair_events: number;
        readonly repair_jobs: number;
        readonly repair_audits: number;
      } & Record<string, unknown>
    >(
      `SELECT operation.state, operation.attempt_count, operation.authorized_attempt_limit,
              operation.manual_retry_revision,
              (SELECT count(*)::int FROM commerce_stripe_session_retry_repair_events
               WHERE operation_id = operation.id) AS repair_events,
              (SELECT count(*)::int FROM durable_jobs
               WHERE idempotency_key = 'stripe-session-founder-retry:test:checkout:' || operation.id || ':1')
                AS repair_jobs,
              (SELECT count(*)::int FROM audit_events
               WHERE action = 'commerce.stripe_session_same_key_repair_requested'
                 AND resource_id = operation.id) AS repair_audits
       FROM commerce_stripe_session_operations operation
       WHERE operation.environment = 'test' AND operation.action = 'checkout'
         AND operation.household_id = 'household-sunrise' AND operation.server_operation_id = $1`,
      [serverOperationId],
    );
    expect(afterRepair.rows[0]).toEqual({
      state: 'succeeded',
      attempt_count: 7,
      authorized_attempt_limit: 7,
      manual_retry_revision: 1,
      repair_events: 1,
      repair_jobs: 1,
      repair_audits: 1,
    });
    const checkoutCalls = vi
      .mocked(transport.postForm)
      .mock.calls.filter(([request]) => request.path === '/v1/checkout/sessions');
    expect(checkoutCalls).toHaveLength(7);
    expect(new Set(checkoutCalls.map(([request]) => request.idempotencyKey))).toEqual(
      new Set([providerKey]),
    );
    await expect(
      database.query(
        `UPDATE commerce_stripe_session_retry_repair_events
         SET reason_code = 'tampered'
         WHERE operation_id = $1`,
        [beforeRepair.rows[0]?.id],
      ),
    ).rejects.toThrow('history is append-only');
  });

  it('terminalizes a proven first-attempt pre-transport refusal and permits a fresh key', async () => {
    const runtime = new CommerceRuntimeRepository(database);
    const actor = await runtime.resolveActor({
      householdId: 'household-sunrise',
      personId: 'person-owner-alice',
      now: clock.now(),
    });
    const prepared = await runtime.prepareStripeCheckout({
      actor,
      offerId: 'founding_family_monthly_v1',
      planVersionId: 'family_v1',
      billingInterval: 'month',
      providerPriceId: 'price_family_month_fixture',
      idempotencyKey: 'checkout_local_refusal_first_attempt_0001',
      serverOperationId: 'checkout_local_refusal_first_attempt_0001',
      providerIdempotencyKey: 'provider-local-refusal-first-attempt-0001',
      environment: 'test',
      now: clock.now(),
    });
    const successUrl = `${customerOrigin}/member/billing/success`;
    const cancelUrl = `${customerOrigin}/member/billing`;
    await runtime.beginStripeSessionOperation({
      householdId: actor.householdId,
      checkoutIntentId: prepared.intentId,
      action: 'checkout',
      environment: 'test',
      serverOperationId: prepared.serverOperationId,
      providerIdempotencyKey: prepared.providerIdempotencyKey,
      actorPersonId: actor.personId,
      requestedExpiresAt: prepared.providerExpiresAt,
      canonicalSubscriptionId: prepared.subscriptionId,
      providerPriceId: 'price_family_month_fixture',
      successUrl,
      cancelUrl,
      now: clock.now(),
    });
    await database.query(
      `UPDATE household_billing_authorities
       SET status = 'revoked', suspended_at = NULL, revoked_at = $1
       WHERE household_id = 'household-sunrise' AND person_id = 'person-owner-alice'`,
      [clock.now().toISOString()],
    );
    const adapter = new StripeTestAdapter(
      transport,
      {
        authorize: ({ actor: candidate, planVersionId }) =>
          runtime.authorizeActor({
            actor: candidate,
            ...(planVersionId === undefined ? {} : { planVersionId }),
            now: clock.now(),
          }),
      },
      new Set([customerOrigin]),
      apiVersion,
    );
    let refusal: StripeSessionDispatchError | undefined;
    try {
      await adapter.createCheckout({
        actor,
        canonicalSubscriptionId: prepared.subscriptionId,
        planVersionId: prepared.planVersionId,
        providerPriceId: 'price_family_month_fixture',
        successUrl,
        cancelUrl,
        idempotencyKey: prepared.providerIdempotencyKey,
        providerExpiresAt: prepared.providerExpiresAt,
      });
    } catch (error) {
      if (error instanceof StripeSessionDispatchError) refusal = error;
      else throw error;
    }
    expect(refusal).toMatchObject({
      code: 'stripe.billing_authority_denied',
      dispatchAttempted: false,
    });
    expect(transport.postForm).not.toHaveBeenCalled();
    await expect(
      runtime.markStripeSessionFailedNoEffect({
        householdId: actor.householdId,
        checkoutIntentId: prepared.intentId,
        action: 'checkout',
        environment: 'test',
        serverOperationId: prepared.serverOperationId,
        errorCode: refusal?.code ?? 'stripe.pre_dispatch_failure',
        now: clock.now(),
      }),
    ).resolves.toBe('terminalized');
    const terminal = await database.query(
      `SELECT operation.state AS operation_state, intent.state AS intent_state,
              intent.dispatch_state, subscription.lifecycle
       FROM commerce_stripe_session_operations operation
       JOIN commerce_checkout_intents intent
         ON intent.household_id = operation.household_id
        AND intent.id = operation.checkout_intent_id
       JOIN commerce_subscriptions subscription
         ON subscription.household_id = intent.household_id
        AND subscription.id = intent.subscription_id
       WHERE operation.server_operation_id = $1`,
      [prepared.serverOperationId],
    );
    expect(terminal.rows[0]).toMatchObject({
      operation_state: 'failed_no_effect',
      intent_state: 'expired',
      dispatch_state: 'failed_no_effect',
      lifecycle: 'expired',
    });
    await database.query(
      `UPDATE household_billing_authorities
       SET status = 'active', suspended_at = NULL, revoked_at = NULL
       WHERE household_id = 'household-sunrise' AND person_id = 'person-owner-alice'`,
    );
    const refreshedActor = await runtime.resolveActor({
      householdId: 'household-sunrise',
      personId: 'person-owner-alice',
      now: clock.now(),
    });
    await expect(
      runtime.prepareStripeCheckout({
        actor: refreshedActor,
        offerId: 'founding_family_monthly_v1',
        planVersionId: 'family_v1',
        billingInterval: 'month',
        providerPriceId: 'price_family_month_fixture',
        idempotencyKey: 'checkout_safe_replacement_after_no_effect_0001',
        environment: 'test',
        now: clock.now(),
      }),
    ).resolves.toMatchObject({ duplicate: false });
  });

  it('preserves Checkout ambiguity after a crash leaves an earlier dispatch lease unresolved', async () => {
    const runtime = new CommerceRuntimeRepository(database);
    const actor = await runtime.resolveActor({
      householdId: 'household-sunrise',
      personId: 'person-owner-alice',
      now: clock.now(),
    });
    const prepared = await runtime.prepareStripeCheckout({
      actor,
      offerId: 'founding_family_monthly_v1',
      planVersionId: 'family_v1',
      billingInterval: 'month',
      providerPriceId: 'price_family_month_fixture',
      idempotencyKey: 'checkout_crash_lease_ambiguity_0001',
      serverOperationId: 'checkout_crash_lease_ambiguity_0001',
      providerIdempotencyKey: 'provider-checkout-crash-lease-ambiguity-0001',
      environment: 'test',
      now: clock.now(),
    });
    await runtime.beginStripeSessionOperation({
      householdId: actor.householdId,
      checkoutIntentId: prepared.intentId,
      action: 'checkout',
      environment: 'test',
      serverOperationId: prepared.serverOperationId,
      providerIdempotencyKey: prepared.providerIdempotencyKey,
      actorPersonId: actor.personId,
      requestedExpiresAt: prepared.providerExpiresAt,
      canonicalSubscriptionId: prepared.subscriptionId,
      providerPriceId: 'price_family_month_fixture',
      successUrl: `${customerOrigin}/member/billing/success`,
      cancelUrl: `${customerOrigin}/member/billing`,
      now: clock.now(),
    });
    // The process dies after the durable dispatch receipt and potentially after provider acceptance:
    // there is deliberately no caught-error/outcome_unknown receipt for attempt one.
    clock.advance(2 * 60_000 + 1);
    await runStripeSessionRetry(database, transport, clock.now, []);
    expect(transport.postForm).not.toHaveBeenCalled();
    const preserved = await database.query<
      {
        readonly operation_state: string;
        readonly intent_state: string;
        readonly dispatch_state: string;
        readonly attempt_count: number;
        readonly prior_dispatch_started: number;
        readonly prior_lease_expired: number;
        readonly current_failed_no_effect: number;
        readonly unknown_receipts: number;
        readonly attention_count: number;
      } & Record<string, unknown>
    >(
      `SELECT operation.state AS operation_state, intent.state AS intent_state,
              intent.dispatch_state, operation.attempt_count,
              (SELECT count(*)::int FROM commerce_stripe_session_operation_attempts attempt
               WHERE attempt.operation_id = operation.id AND attempt.attempt = 1
                 AND attempt.event_kind = 'dispatch_started') AS prior_dispatch_started,
              (SELECT count(*)::int FROM commerce_stripe_session_operation_attempts attempt
               WHERE attempt.operation_id = operation.id AND attempt.attempt = 1
                 AND attempt.event_kind = 'lease_expired') AS prior_lease_expired,
              (SELECT count(*)::int FROM commerce_stripe_session_operation_attempts attempt
               WHERE attempt.operation_id = operation.id AND attempt.attempt = 2
                 AND attempt.event_kind = 'failed_no_effect') AS current_failed_no_effect,
              (SELECT count(*)::int FROM commerce_stripe_session_operation_attempts attempt
               WHERE attempt.operation_id = operation.id
                 AND attempt.event_kind = 'outcome_unknown') AS unknown_receipts,
              (SELECT count(*)::int FROM owner_attention_items attention
               WHERE attention.dedupe_key =
                 'stripe_session_unknown_test_checkout_' || operation.server_operation_id
                 AND attention.state IN ('open','snoozed')) AS attention_count
       FROM commerce_stripe_session_operations operation
       JOIN commerce_checkout_intents intent
         ON intent.household_id = operation.household_id
        AND intent.id = operation.checkout_intent_id
       WHERE operation.server_operation_id = $1`,
      [prepared.serverOperationId],
    );
    expect(preserved.rows[0]).toEqual({
      operation_state: 'outcome_unknown',
      intent_state: 'prepared',
      dispatch_state: 'outcome_unknown',
      attempt_count: 2,
      prior_dispatch_started: 1,
      prior_lease_expired: 1,
      current_failed_no_effect: 1,
      unknown_receipts: 0,
      attention_count: 1,
    });
    const refreshedActor = await runtime.resolveActor({
      householdId: actor.householdId,
      personId: actor.personId,
      now: clock.now(),
    });
    await expect(
      runtime.prepareStripeCheckout({
        actor: refreshedActor,
        offerId: 'founding_family_monthly_v1',
        planVersionId: 'family_v1',
        billingInterval: 'month',
        providerPriceId: 'price_family_month_fixture',
        idempotencyKey: 'checkout_crash_replacement_blocked_0001',
        environment: 'test',
        now: clock.now(),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('preserves Portal ambiguity after a crash leaves an earlier dispatch lease unresolved', async () => {
    const runtime = new CommerceRuntimeRepository(database);
    const actor = await runtime.resolveActor({
      householdId: 'household-sunrise',
      personId: 'person-owner-alice',
      now: clock.now(),
    });
    const serverOperationId = 'portal_crash_lease_ambiguity_0001';
    await runtime.beginStripeSessionOperation({
      householdId: actor.householdId,
      action: 'portal',
      environment: 'test',
      serverOperationId,
      providerIdempotencyKey: 'provider-portal-crash-lease-ambiguity-0001',
      actorPersonId: actor.personId,
      providerCustomerId: 'cus_portal_crash_lease_ambiguity',
      providerConfigurationId: 'bpc_cancel_only_fixture',
      returnUrl: `${customerOrigin}/member/billing`,
      now: clock.now(),
    });
    clock.advance(2 * 60_000 + 1);
    await runStripeSessionRetry(database, transport, clock.now, []);
    expect(transport.postForm).not.toHaveBeenCalled();
    const preserved = await database.query<
      {
        readonly state: string;
        readonly attempt_count: number;
        readonly prior_dispatch_started: number;
        readonly prior_lease_expired: number;
        readonly current_failed_no_effect: number;
        readonly unknown_receipts: number;
        readonly attention_count: number;
      } & Record<string, unknown>
    >(
      `SELECT operation.state, operation.attempt_count,
              (SELECT count(*)::int FROM commerce_stripe_session_operation_attempts attempt
               WHERE attempt.operation_id = operation.id AND attempt.attempt = 1
                 AND attempt.event_kind = 'dispatch_started') AS prior_dispatch_started,
              (SELECT count(*)::int FROM commerce_stripe_session_operation_attempts attempt
               WHERE attempt.operation_id = operation.id AND attempt.attempt = 1
                 AND attempt.event_kind = 'lease_expired') AS prior_lease_expired,
              (SELECT count(*)::int FROM commerce_stripe_session_operation_attempts attempt
               WHERE attempt.operation_id = operation.id AND attempt.attempt = 2
                 AND attempt.event_kind = 'failed_no_effect') AS current_failed_no_effect,
              (SELECT count(*)::int FROM commerce_stripe_session_operation_attempts attempt
               WHERE attempt.operation_id = operation.id
                 AND attempt.event_kind = 'outcome_unknown') AS unknown_receipts,
              (SELECT count(*)::int FROM owner_attention_items attention
               WHERE attention.dedupe_key =
                 'stripe_session_unknown_test_portal_' || operation.server_operation_id
                 AND attention.state IN ('open','snoozed')) AS attention_count
       FROM commerce_stripe_session_operations operation
       WHERE operation.environment = 'test' AND operation.action = 'portal'
         AND operation.household_id = $1 AND operation.server_operation_id = $2`,
      [actor.householdId, serverOperationId],
    );
    expect(preserved.rows[0]).toEqual({
      state: 'outcome_unknown',
      attempt_count: 2,
      prior_dispatch_started: 1,
      prior_lease_expired: 1,
      current_failed_no_effect: 1,
      unknown_receipts: 0,
      attention_count: 1,
    });
  });

  it('preserves an earlier unknown outcome when a later retry fails before transport', async () => {
    const cookie = await login(app, 'owner-alice');
    const serverOperationId = 'checkout_prior_unknown_local_failure_0001';
    const headers = {
      cookie,
      origin: customerOrigin,
      'x-bb-household-id': 'household-sunrise',
      'idempotency-key': serverOperationId,
    };
    vi.mocked(transport.postForm).mockRejectedValueOnce(new Error('fixture response lost'));
    const initial = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers,
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    expect(initial.statusCode).toBe(409);
    const deadline = await database.query<
      { readonly requested_expires_at: unknown } & Record<string, unknown>
    >(
      `SELECT requested_expires_at FROM commerce_stripe_session_operations
       WHERE environment = 'test' AND action = 'checkout'
         AND household_id = 'household-sunrise' AND server_operation_id = $1`,
      [serverOperationId],
    );
    const providerDeadline = new Date(String(deadline.rows[0]?.requested_expires_at));
    clock.set(new Date(providerDeadline.getTime() - 29 * 60_000));
    await runStripeSessionRetry(database, transport, clock.now);
    expect(
      vi
        .mocked(transport.postForm)
        .mock.calls.filter(([request]) => request.path === '/v1/checkout/sessions'),
    ).toHaveLength(1);
    const preserved = await database.query<
      {
        readonly operation_state: string;
        readonly intent_state: string;
        readonly dispatch_state: string;
        readonly attempt_count: number;
        readonly next_retry_at: unknown;
        readonly failed_no_effect_attempts: number;
        readonly unknown_attempts: number;
        readonly attention_count: number;
        readonly retry_job_error: string | null;
      } & Record<string, unknown>
    >(
      `SELECT operation.state AS operation_state, intent.state AS intent_state,
              intent.dispatch_state, operation.attempt_count, operation.next_retry_at,
              (SELECT count(*)::int FROM commerce_stripe_session_operation_attempts attempt
               WHERE attempt.operation_id = operation.id AND attempt.event_kind = 'failed_no_effect')
                 AS failed_no_effect_attempts,
              (SELECT count(*)::int FROM commerce_stripe_session_operation_attempts attempt
               WHERE attempt.operation_id = operation.id AND attempt.event_kind = 'outcome_unknown')
                 AS unknown_attempts,
              (SELECT count(*)::int FROM owner_attention_items attention
               WHERE attention.dedupe_key =
                 'stripe_session_unknown_test_checkout_' || operation.server_operation_id
                 AND attention.state IN ('open','snoozed')) AS attention_count,
              (SELECT last_error_code FROM durable_jobs job
               WHERE job.idempotency_key =
                 'stripe-session-retry:test:checkout:' || operation.server_operation_id)
                AS retry_job_error
       FROM commerce_stripe_session_operations operation
       JOIN commerce_checkout_intents intent
         ON intent.household_id = operation.household_id
        AND intent.id = operation.checkout_intent_id
       WHERE operation.environment = 'test' AND operation.action = 'checkout'
         AND operation.household_id = 'household-sunrise' AND operation.server_operation_id = $1`,
      [serverOperationId],
    );
    expect(preserved.rows[0]).toEqual({
      operation_state: 'outcome_unknown',
      intent_state: 'prepared',
      dispatch_state: 'outcome_unknown',
      attempt_count: 2,
      next_retry_at: null,
      failed_no_effect_attempts: 1,
      unknown_attempts: 1,
      attention_count: 1,
      retry_job_error: 'stripe.invalid_checkout_expiry',
    });
    const refreshedCookie = await login(app, 'owner-alice');
    const replacement = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers: {
        ...headers,
        cookie: refreshedCookie,
        'idempotency-key': 'checkout_replacement_must_stay_blocked_0001',
      },
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    expect(replacement.statusCode).toBe(409);
    expect(
      vi
        .mocked(transport.postForm)
        .mock.calls.filter(([request]) => request.path === '/v1/checkout/sessions'),
    ).toHaveLength(1);
    const runtime = new CommerceRuntimeRepository(database);
    const founderProjection = await runtime.stripeSessionRetryRepairProjection({
      householdId: 'household-sunrise',
      serverOperationId,
      actorPersonId: 'person-hq-heidi',
      configuredFounderPersonId: 'person-hq-heidi',
      now: clock.now(),
    });
    expect(founderProjection).toMatchObject({
      state: 'outcome_unknown',
      revision: 0,
      repairAvailable: false,
    });
  });

  it('holds same-key Checkout retry when the founder initiation gate closes', async () => {
    const cookie = await login(app, 'owner-alice');
    const serverOperationId = 'checkout_retry_after_founder_disable_0001';
    vi.mocked(transport.postForm).mockRejectedValueOnce(new Error('fixture response lost'));
    const initial = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers: {
        cookie,
        origin: customerOrigin,
        'x-bb-household-id': 'household-sunrise',
        'idempotency-key': serverOperationId,
      },
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    expect(initial.statusCode).toBe(409);
    await new CommerceRuntimeRepository(database).changeStripeInitiationControl({
      environment: 'test',
      nextState: 'disabled',
      reasonCode: 'founder_disable',
      expectedRevision: 1,
      actorPersonId: 'person-hq-heidi',
      configuredFounderPersonId: 'person-hq-heidi',
      correlationId: 'stripe-test-disable-before-retry-0001',
      now: clock.now(),
    });
    clock.advance(2 * 60_000);
    await runStripeSessionRetry(database, transport, clock.now);
    expect(
      vi
        .mocked(transport.postForm)
        .mock.calls.filter(([request]) => request.path === '/v1/checkout/sessions'),
    ).toHaveLength(1);
    const held = await database.query<
      {
        readonly state: string;
        readonly attempt_count: number;
        readonly attention_count: number;
        readonly last_error_code: string | null;
      } & Record<string, unknown>
    >(
      `SELECT operation.state, operation.attempt_count,
              (SELECT count(*)::int FROM owner_attention_items attention
               WHERE attention.dedupe_key =
                 'stripe_session_unknown_test_checkout_' || operation.server_operation_id
                 AND attention.state IN ('open','snoozed')) AS attention_count,
              (SELECT last_error_code FROM durable_jobs job
               WHERE job.idempotency_key =
                 'stripe-session-retry:test:checkout:' || operation.server_operation_id)
                AS last_error_code
       FROM commerce_stripe_session_operations operation
       WHERE operation.environment = 'test' AND operation.action = 'checkout'
         AND operation.household_id = 'household-sunrise' AND operation.server_operation_id = $1`,
      [serverOperationId],
    );
    expect(held.rows[0]).toEqual({
      state: 'outcome_unknown',
      attempt_count: 1,
      attention_count: 1,
      last_error_code: 'stripe_retry_dispatch_gate_not_authorized',
    });
  });

  it('repairs an unknown POST only from an authentic exact completion and suppresses retry', async () => {
    const originalStartedAt = clock.now();
    const cookie = await login(app, 'owner-alice');
    vi.mocked(transport.postForm).mockRejectedValueOnce(new Error('fixture response lost'));
    const uncertain = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers: {
        cookie,
        origin: customerOrigin,
        'x-bb-household-id': 'household-sunrise',
        'idempotency-key': 'checkout_unknown_completion_repair_0001',
      },
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    expect(uncertain.statusCode).toBe(409);
    const pending = await database.query<
      { readonly subscription_id: string; readonly expires_at: unknown } & Record<string, unknown>
    >(
      `SELECT subscription_id, provider_requested_expires_at AS expires_at
       FROM commerce_checkout_intents
       WHERE idempotency_key = 'checkout_unknown_completion_repair_0001'`,
    );
    const binding = pending.rows[0];
    expect(binding).toBeDefined();
    const providerRequestedExpiresAt = new Date(String(binding?.expires_at));

    clock.advance(23 * 60 * 60_000 + 6 * 60_000);
    const replacementCookie = await login(app, 'owner-alice');
    const replacement = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers: {
        cookie: replacementCookie,
        origin: customerOrigin,
        'x-bb-household-id': 'household-sunrise',
        'idempotency-key': 'checkout_after_unknown_expiry_0001',
      },
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    expect(replacement.statusCode, replacement.body).toBe(409);
    expect(
      vi
        .mocked(transport.postForm)
        .mock.calls.filter(([request]) => request.path === '/v1/checkout/sessions'),
    ).toHaveLength(1);
    const billing = await app.inject({
      method: 'GET',
      url: '/v1/commerce/stripe/billing',
      headers: {
        cookie: replacementCookie,
        origin: customerOrigin,
        'x-bb-household-id': 'household-sunrise',
      },
    });
    expect(billing.statusCode).toBe(200);
    expect(billing.json()).toMatchObject({
      billing: {
        checkoutState: 'pending_provider',
        pendingOperation: {
          serverOperationId: 'checkout_unknown_completion_repair_0001',
          state: 'outcome_unknown',
        },
      },
    });

    // Wall-clock expiry never authorizes a replacement. A late authentic paid completion may
    // repair only the still-open original operation and suppress its same-key retry.
    const created = Math.floor((originalStartedAt.getTime() + 22 * 60 * 60_000) / 1_000);
    const deliveryTimestamp = Math.floor(clock.now().getTime() / 1_000);
    const rawBody = JSON.stringify({
      id: 'evt_checkout_unknown_completion_repair',
      type: 'checkout.session.completed',
      created,
      livemode: false,
      api_version: apiVersion,
      data: {
        object: {
          id: 'cs_test_unknown_completion_repair',
          object: 'checkout.session',
          livemode: false,
          mode: 'subscription',
          customer: 'cus_unknown_completion_repair',
          subscription: 'sub_unknown_completion_repair',
          payment_intent: 'pi_unknown_completion_repair',
          status: 'complete',
          payment_status: 'paid',
          amount_total: 1499,
          currency: 'usd',
          expires_at: Math.floor(providerRequestedExpiresAt.getTime() / 1_000),
          metadata: {
            household_id: 'household-sunrise',
            canonical_subscription_id: binding?.subscription_id,
            plan_version_id: 'family_v1',
          },
        },
      },
    });
    const completed = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signStripeFixture({
          rawBody,
          endpointSecret,
          timestampSeconds: deliveryTimestamp,
        }),
      },
      payload: rawBody,
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ application: 'applied' });
    const repaired = await database.query<
      {
        readonly completion_count: number;
        readonly dispatch_state: string;
        readonly operation_state: string;
        readonly provider_session_id: string;
      } & Record<string, unknown>
    >(
      `SELECT intent.dispatch_state, operation.state AS operation_state,
              operation.provider_session_id,
              (SELECT count(*)::int FROM commerce_stripe_checkout_completions completion
               WHERE completion.checkout_intent_id = intent.id) AS completion_count
       FROM commerce_checkout_intents intent
       JOIN commerce_stripe_session_operations operation
         ON operation.checkout_intent_id = intent.id
        AND operation.household_id = intent.household_id
       WHERE intent.idempotency_key = 'checkout_unknown_completion_repair_0001'`,
    );
    expect(repaired.rows[0]).toEqual({
      completion_count: 1,
      dispatch_state: 'session_recorded',
      operation_state: 'succeeded',
      provider_session_id: 'cs_test_unknown_completion_repair',
    });
    await runStripeSessionRetry(database, transport, clock.now);
    expect(
      vi
        .mocked(transport.postForm)
        .mock.calls.filter(([request]) => request.path === '/v1/checkout/sessions'),
    ).toHaveLength(1);
  });

  it('canonicalizes a fractional Checkout deadline across persistence, transport, and response', async () => {
    const fractionalNow = new Date(Math.floor(clock.now().getTime() / 1_000) * 1_000 + 789);
    clock.set(fractionalNow);
    const cookie = await login(app, 'owner-alice');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers: {
        cookie,
        origin: customerOrigin,
        'x-bb-household-id': 'household-sunrise',
        'idempotency-key': 'checkout_fractional_expiry_response_0001',
      },
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    expect(response.statusCode, response.body).toBe(201);
    const expectedProviderExpiry = new Date(
      Math.floor((fractionalNow.getTime() + 23 * 60 * 60_000) / 1_000) * 1_000,
    );
    expect(response.json<{ checkout: { expiresAt: string } }>().checkout.expiresAt).toBe(
      expectedProviderExpiry.toISOString(),
    );
    const checkoutPost = vi
      .mocked(transport.postForm)
      .mock.calls.find(([request]) => request.path === '/v1/checkout/sessions')?.[0];
    expect(checkoutPost?.form.expires_at).toBe(String(expectedProviderExpiry.getTime() / 1_000));
    const stored = await database.query<
      {
        readonly provider_requested_expires_at: unknown;
        readonly provider_returned_expires_at: unknown;
        readonly expires_at: unknown;
      } & Record<string, unknown>
    >(
      `SELECT provider_requested_expires_at, provider_returned_expires_at, expires_at
       FROM commerce_checkout_intents
       WHERE household_id = 'household-sunrise'
         AND idempotency_key = 'checkout_fractional_expiry_response_0001'`,
    );
    expect(new Date(String(stored.rows[0]?.provider_requested_expires_at))).toEqual(
      expectedProviderExpiry,
    );
    expect(new Date(String(stored.rows[0]?.provider_returned_expires_at))).toEqual(
      expectedProviderExpiry,
    );
    expect(new Date(String(stored.rows[0]?.expires_at))).toEqual(
      new Date(expectedProviderExpiry.getTime() + 5 * 60_000),
    );
  });

  it('repairs a lost fractional-time POST only from the signed exact-second expiry', async () => {
    const fractionalNow = new Date(Math.floor(clock.now().getTime() / 1_000) * 1_000 + 789);
    clock.set(fractionalNow);
    let outboundExpiresAt: string | undefined;
    vi.mocked(transport.postForm).mockImplementationOnce(async ({ form }) => {
      outboundExpiresAt = form.expires_at;
      throw new Error('fixture process lost the Checkout response');
    });
    const cookie = await login(app, 'owner-alice');
    const initial = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers: {
        cookie,
        origin: customerOrigin,
        'x-bb-household-id': 'household-sunrise',
        'idempotency-key': 'checkout_fractional_expiry_lost_0001',
      },
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    expect(initial.statusCode).toBe(409);
    const expectedProviderExpiry = new Date(
      Math.floor((fractionalNow.getTime() + 23 * 60 * 60_000) / 1_000) * 1_000,
    );
    expect(outboundExpiresAt).toBe(String(expectedProviderExpiry.getTime() / 1_000));
    const stored = await database.query<
      {
        readonly subscription_id: string;
        readonly provider_requested_expires_at: unknown;
        readonly expires_at: unknown;
        readonly operation_state: string;
      } & Record<string, unknown>
    >(
      `SELECT intent.subscription_id, intent.provider_requested_expires_at, intent.expires_at,
              operation.state AS operation_state
       FROM commerce_checkout_intents intent
       JOIN commerce_stripe_session_operations operation
         ON operation.household_id = intent.household_id
        AND operation.checkout_intent_id = intent.id
       WHERE intent.household_id = 'household-sunrise'
         AND intent.idempotency_key = 'checkout_fractional_expiry_lost_0001'`,
    );
    const canonicalSubscriptionId = stored.rows[0]?.subscription_id;
    if (canonicalSubscriptionId === undefined) throw new Error('Missing canonical fixture binding');
    expect(new Date(String(stored.rows[0]?.provider_requested_expires_at))).toEqual(
      expectedProviderExpiry,
    );
    expect(new Date(String(stored.rows[0]?.expires_at))).toEqual(
      new Date(expectedProviderExpiry.getTime() + 5 * 60_000),
    );
    expect(stored.rows[0]?.operation_state).toBe('outcome_unknown');
    clock.set(new Date(expectedProviderExpiry.getTime() + 2_000));
    const eventCreated = Math.floor(clock.now().getTime() / 1_000);
    const sendExpired = async (input: {
      readonly fixtureKey: string;
      readonly expiryOffsetSeconds: number;
    }) => {
      const rawBody = JSON.stringify({
        id: `evt_checkout_fractional_expiry_${input.fixtureKey}`,
        type: 'checkout.session.expired',
        created: eventCreated,
        livemode: false,
        api_version: apiVersion,
        data: {
          object: {
            id: `cs_test_fractional_expiry_${input.fixtureKey}`,
            object: 'checkout.session',
            livemode: false,
            status: 'expired',
            payment_status: 'unpaid',
            mode: 'subscription',
            amount_total: 1499,
            currency: 'usd',
            expires_at: expectedProviderExpiry.getTime() / 1_000 + input.expiryOffsetSeconds,
            metadata: {
              household_id: 'household-sunrise',
              canonical_subscription_id: canonicalSubscriptionId,
              plan_version_id: 'family_v1',
            },
          },
        },
      });
      return app.inject({
        method: 'POST',
        url: '/v1/webhooks/stripe',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': signStripeFixture({
            rawBody,
            endpointSecret,
            timestampSeconds: eventCreated,
          }),
        },
        payload: rawBody,
      });
    };
    for (const mismatch of [
      { fixtureKey: 'minus_one', expiryOffsetSeconds: -1 },
      { fixtureKey: 'plus_one', expiryOffsetSeconds: 1 },
    ]) {
      const response = await sendExpired(mismatch);
      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({ application: 'quarantined' });
    }
    const stillUnknown = await database.query<
      { readonly operation_state: string; readonly intent_state: string } & Record<string, unknown>
    >(
      `SELECT operation.state AS operation_state, intent.state AS intent_state
       FROM commerce_stripe_session_operations operation
       JOIN commerce_checkout_intents intent
         ON intent.household_id = operation.household_id
        AND intent.id = operation.checkout_intent_id
       WHERE intent.idempotency_key = 'checkout_fractional_expiry_lost_0001'`,
    );
    expect(stillUnknown.rows[0]).toEqual({
      operation_state: 'outcome_unknown',
      intent_state: 'prepared',
    });
    const exact = await sendExpired({ fixtureKey: 'exact', expiryOffsetSeconds: 0 });
    expect(exact.statusCode, exact.body).toBe(200);
    expect(exact.json()).toMatchObject({ application: 'applied' });
    const terminal = await database.query<
      {
        readonly operation_state: string;
        readonly intent_state: string;
        readonly provider_session_id: string;
      } & Record<string, unknown>
    >(
      `SELECT operation.state AS operation_state, intent.state AS intent_state,
              operation.provider_session_id
       FROM commerce_stripe_session_operations operation
       JOIN commerce_checkout_intents intent
         ON intent.household_id = operation.household_id
        AND intent.id = operation.checkout_intent_id
       WHERE intent.idempotency_key = 'checkout_fractional_expiry_lost_0001'`,
    );
    expect(terminal.rows[0]).toEqual({
      operation_state: 'failed_no_effect',
      intent_state: 'expired',
      provider_session_id: 'cs_test_fractional_expiry_exact',
    });
    const replacementCookie = await login(app, 'owner-alice');
    const replacement = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers: {
        cookie: replacementCookie,
        origin: customerOrigin,
        'x-bb-household-id': 'household-sunrise',
        'idempotency-key': 'checkout_fractional_expiry_replacement_0001',
      },
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    expect(replacement.statusCode, replacement.body).toBe(201);
  });

  it('blocks replacement until an authentically expired Checkout Session is observed', async () => {
    const cookie = await login(app, 'owner-alice');
    const baseHeaders = {
      cookie,
      origin: customerOrigin,
      'x-bb-household-id': 'household-sunrise',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers: { ...baseHeaders, 'idempotency-key': 'checkout_abandoned_fixture_0001' },
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    expect(first.statusCode).toBe(201);
    expect(vi.mocked(transport.postForm).mock.calls[0]?.[0].form).toMatchObject({
      expires_at: String(Math.floor((clock.now().getTime() + 23 * 60 * 60_000) / 1_000)),
    });
    clock.advance(23 * 60 * 60_000 + 6 * 60_000);
    const replacementCookie = await login(app, 'owner-alice');
    const replacement = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers: {
        ...baseHeaders,
        cookie: replacementCookie,
        'idempotency-key': 'checkout_abandoned_fixture_0002',
      },
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    expect(replacement.statusCode).toBe(409);
    const original = first.json<{
      checkout: { canonicalSubscriptionId: string; expiresAt: string };
    }>();
    const providerExpiresAt = new Date(original.checkout.expiresAt);
    const eventCreated = Math.floor(clock.now().getTime() / 1_000);
    const expiredBody = JSON.stringify({
      id: 'evt_checkout_abandoned_authentic_expiry',
      type: 'checkout.session.expired',
      created: eventCreated,
      livemode: false,
      api_version: apiVersion,
      data: {
        object: {
          id: 'cs_test_fixture_123',
          object: 'checkout.session',
          livemode: false,
          status: 'expired',
          payment_status: 'unpaid',
          mode: 'subscription',
          amount_total: 1499,
          currency: 'usd',
          expires_at: Math.floor(providerExpiresAt.getTime() / 1_000),
          metadata: {
            household_id: 'household-sunrise',
            canonical_subscription_id: original.checkout.canonicalSubscriptionId,
            plan_version_id: 'family_v1',
          },
        },
      },
    });
    const expiredWebhook = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signStripeFixture({
          rawBody: expiredBody,
          endpointSecret,
          timestampSeconds: eventCreated,
        }),
      },
      payload: expiredBody,
    });
    expect(expiredWebhook.statusCode, expiredWebhook.body).toBe(200);
    vi.mocked(transport.postForm).mockImplementationOnce(async ({ form }) => ({
      id: 'cs_test_fixture_replacement',
      object: 'checkout.session',
      livemode: false,
      url: 'https://checkout.stripe.com/c/pay/session-replacement',
      mode: 'subscription',
      status: 'open',
      payment_status: 'unpaid',
      client_reference_id: form.client_reference_id,
      success_url: form.success_url,
      cancel_url: form.cancel_url,
      customer: form.customer ?? null,
      metadata: {
        household_id: form['metadata[household_id]'],
        canonical_subscription_id: form['metadata[canonical_subscription_id]'],
        plan_version_id: form['metadata[plan_version_id]'],
      },
      expires_at: Number(form.expires_at),
    }));
    const afterTerminal = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers: {
        ...baseHeaders,
        cookie: replacementCookie,
        'idempotency-key': 'checkout_abandoned_fixture_0002',
      },
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    expect(afterTerminal.statusCode).toBe(201);
    const expired = await database.query<
      { state: string; lifecycle: string } & Record<string, unknown>
    >(
      `SELECT intent.state, subscription.lifecycle
       FROM commerce_checkout_intents intent
       JOIN commerce_subscriptions subscription
         ON subscription.household_id = intent.household_id
        AND subscription.id = intent.subscription_id
       WHERE intent.household_id = 'household-sunrise'
         AND intent.idempotency_key = 'checkout_abandoned_fixture_0001'`,
    );
    expect(expired.rows[0]).toMatchObject({ state: 'expired', lifecycle: 'expired' });
  });

  it('applies a signed checkout.session.expired event to the canonical pending checkout', async () => {
    const cookie = await login(app, 'owner-alice');
    const checkout = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers: {
        cookie,
        origin: customerOrigin,
        'x-bb-household-id': 'household-sunrise',
        'idempotency-key': 'checkout_expired_event_fixture_0001',
      },
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    expect(checkout.statusCode).toBe(201);
    const checkoutEvidence = checkout.json<{
      checkout: { canonicalSubscriptionId: string; expiresAt: string };
    }>();
    clock.set(new Date(new Date(checkoutEvidence.checkout.expiresAt).getTime() + 1_000));
    const eventCreated = Math.floor(clock.now().getTime() / 1_000);
    const rawBody = JSON.stringify({
      id: 'evt_checkout_expired_fixture',
      type: 'checkout.session.expired',
      created: eventCreated,
      livemode: false,
      api_version: apiVersion,
      data: {
        object: {
          id: 'cs_test_fixture_123',
          object: 'checkout.session',
          livemode: false,
          status: 'expired',
          payment_status: 'unpaid',
          mode: 'subscription',
          amount_total: 1499,
          currency: 'usd',
          expires_at: Math.floor(new Date(checkoutEvidence.checkout.expiresAt).getTime() / 1_000),
          metadata: {
            household_id: 'household-sunrise',
            canonical_subscription_id: checkoutEvidence.checkout.canonicalSubscriptionId,
            plan_version_id: 'family_v1',
          },
        },
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signStripeFixture({
          rawBody,
          endpointSecret,
          timestampSeconds: eventCreated,
        }),
      },
      payload: rawBody,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ application: 'applied' });
    const state = await database.query<
      { state: string; lifecycle: string } & Record<string, unknown>
    >(
      `SELECT intent.state, subscription.lifecycle
       FROM commerce_checkout_intents intent
       JOIN commerce_subscriptions subscription
         ON subscription.household_id = intent.household_id
        AND subscription.id = intent.subscription_id
       WHERE intent.household_id = 'household-sunrise'
         AND intent.idempotency_key = 'checkout_expired_event_fixture_0001'`,
    );
    expect(state.rows[0]).toMatchObject({ state: 'expired', lifecycle: 'expired' });
  });

  it('rejects a first subscription binding after billing authority is revoked', async () => {
    const cookie = await login(app, 'owner-alice');
    const checkout = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers: {
        cookie,
        origin: customerOrigin,
        'x-bb-household-id': 'household-sunrise',
        'idempotency-key': 'checkout_revoked_authority_0001',
      },
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    const subscriptionId = checkout.json<{ checkout: { canonicalSubscriptionId: string } }>()
      .checkout.canonicalSubscriptionId;
    await database.query(
      `UPDATE household_billing_authorities
       SET status = 'revoked', revoked_at = $3
       WHERE household_id = $1 AND person_id = $2`,
      ['household-sunrise', 'person-owner-alice', clock.now().toISOString()],
    );
    const created = Math.floor(clock.now().getTime() / 1_000);
    const rawBody = JSON.stringify({
      id: 'evt_revoked_authority_binding',
      type: 'customer.subscription.updated',
      created,
      livemode: false,
      api_version: apiVersion,
      data: {
        object: {
          id: 'sub_revoked_authority_fixture',
          object: 'subscription',
          livemode: false,
          customer: 'cus_revoked_authority_fixture',
          status: 'active',
          current_period_start: created,
          current_period_end: created + 30 * 86_400,
          items: {
            has_more: false,
            data: [
              {
                id: 'si_revoked_authority_fixture',
                quantity: 1,
                price: {
                  id: 'price_family_month_fixture',
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
                },
              },
            ],
          },
          metadata: {
            household_id: 'household-sunrise',
            canonical_subscription_id: subscriptionId,
            plan_version_id: 'family_v1',
          },
        },
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signStripeFixture({
          rawBody,
          endpointSecret,
          timestampSeconds: created,
        }),
      },
      payload: rawBody,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ application: 'quarantined' });
    const state = await database.query<
      { lifecycle: string; provider_records: number; grants: number } & Record<string, unknown>
    >(
      `SELECT subscription.lifecycle,
              (SELECT count(*)::int FROM commerce_provider_subscription_records
               WHERE subscription_id = subscription.id) AS provider_records,
              (SELECT count(*)::int FROM entitlement_grants
               WHERE subscription_id = subscription.id AND revoked_at IS NULL) AS grants
       FROM commerce_subscriptions subscription WHERE subscription.id = $1`,
      [subscriptionId],
    );
    expect(state.rows[0]).toMatchObject({ lifecycle: 'pending', provider_records: 0, grants: 0 });
  });

  it('records finalization attention and preserves paid-through access through payment recovery', async () => {
    const cookie = await login(app, 'owner-alice');
    const checkout = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers: {
        cookie,
        origin: customerOrigin,
        'x-bb-household-id': 'household-sunrise',
        'idempotency-key': 'checkout_invoice_policy_0001',
      },
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    const subscriptionId = checkout.json<{ checkout: { canonicalSubscriptionId: string } }>()
      .checkout.canonicalSubscriptionId;
    const created = Math.floor(clock.now().getTime() / 1_000);
    const subscriptionObject = {
      id: 'sub_invoice_policy_fixture',
      object: 'subscription',
      livemode: false,
      customer: 'cus_invoice_policy_fixture',
      status: 'active',
      created,
      current_period_start: created,
      current_period_end: created + 30 * 86_400,
      items: {
        has_more: false,
        data: [
          {
            id: 'si_invoice_policy_fixture',
            quantity: 1,
            price: {
              id: 'price_family_month_fixture',
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
            },
          },
        ],
      },
    };
    await activateCompletedCheckoutWithPaidInvoice({
      app,
      database,
      transport,
      now: clock.now,
      canonicalSubscriptionId: subscriptionId,
      externalSubscriptionId: 'sub_invoice_policy_fixture',
      providerCustomerId: 'cus_invoice_policy_fixture',
      fixtureKey: 'invoice_policy',
      periodStart: created,
      periodEnd: created + 30 * 86_400,
      checkoutEventType: 'checkout.session.async_payment_succeeded',
    });
    vi.mocked(transport.get).mockClear();

    clock.advance(1_000);
    const sendInvoiceEvent = async (
      id: string,
      type: string,
      object: Record<string, unknown>,
      eventCreated = Math.floor(clock.now().getTime() / 1_000),
    ) => {
      const rawBody = JSON.stringify({
        id,
        type,
        created: eventCreated,
        livemode: false,
        api_version: apiVersion,
        data: { object },
      });
      return app.inject({
        method: 'POST',
        url: '/v1/webhooks/stripe',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': signStripeFixture({
            rawBody,
            endpointSecret,
            timestampSeconds: Math.floor(clock.now().getTime() / 1_000),
          }),
        },
        payload: rawBody,
      });
    };
    const ambiguous = await sendInvoiceEvent(
      'evt_invoice_finalization_failed',
      'invoice.finalization_failed',
      {
        id: 'in_finalization_failed_fixture',
        object: 'invoice',
        subscription: 'sub_invoice_policy_fixture',
      },
      created - 1,
    );
    expect(ambiguous.statusCode).toBe(202);
    expect(ambiguous.json()).toMatchObject({
      duplicate: false,
      application: 'reconciliation_queued',
    });
    await runReconciliation(database, transport, clock.now);
    expect(transport.get).not.toHaveBeenCalled();
    const held = await database.query<
      {
        lifecycle: string;
        status: string;
        application_state: string;
        error_code: string;
        active_grants: number;
        recovery_events: number;
        attention_items: number;
      } & Record<string, unknown>
    >(
      `SELECT subscription.lifecycle, inbox.status, inbox.application_state, inbox.error_code,
              (SELECT count(*)::int FROM entitlement_grants grant_record
               WHERE grant_record.subscription_id = subscription.id
                 AND grant_record.revoked_at IS NULL) AS active_grants,
              (SELECT count(*)::int FROM commerce_stripe_invoice_recovery_events recovery
               WHERE recovery.source_inbox_id = inbox.id
                 AND recovery.recovery_state = 'attention') AS recovery_events,
              (SELECT count(*)::int FROM owner_attention_items attention
               WHERE attention.source_id = inbox.id
                 AND attention.attention_kind = 'billing_reconciliation') AS attention_items
       FROM commerce_subscriptions subscription
       JOIN commerce_event_inbox inbox ON inbox.external_event_id = 'evt_invoice_finalization_failed'
       WHERE subscription.id = $1`,
      [subscriptionId],
    );
    expect(held.rows[0]).toMatchObject({
      lifecycle: 'active',
      status: 'processed',
      application_state: 'ignored',
      error_code: 'provider.reconciled_from_snapshot',
      active_grants: 1,
      recovery_events: 1,
      attention_items: 1,
    });
    const terminalAttentionRun = await database.query<
      { readonly id: string; readonly trigger_event_id: string } & Record<string, unknown>
    >(
      `SELECT run.id, run.trigger_event_id
       FROM commerce_reconciliation_runs run
       JOIN commerce_event_inbox inbox ON inbox.id = run.trigger_event_id
       WHERE inbox.external_event_id = 'evt_invoice_finalization_failed'`,
    );
    await expect(
      new CommerceOperationsRepository(
        database,
        Buffer.alloc(32, 11),
        1,
        undefined,
        'local',
      ).claimProviderReconciliationAutomaticAttempt({
        id: terminalAttentionRun.rows[0]?.id ?? 'missing-run',
        inboxId: terminalAttentionRun.rows[0]?.trigger_event_id ?? 'missing-inbox',
        provider: 'stripe',
        environment: 'test',
        repairGeneration: 0,
        now: clock.now(),
      }),
    ).resolves.toEqual({ kind: 'already_terminal', terminalState: 'attention' });
    const finalizationStatus = await app.inject({
      method: 'GET',
      url: '/v1/commerce/stripe/billing',
      headers: { cookie, origin: customerOrigin, 'x-bb-household-id': 'household-sunrise' },
    });
    expect(finalizationStatus.statusCode).toBe(200);
    expect(finalizationStatus.json()).toMatchObject({
      billing: {
        canonicalAccessActive: true,
        recoveryReason: 'invoice_finalization_failed',
      },
    });
    const finalizationReplay = await sendInvoiceEvent(
      'evt_invoice_finalization_failed',
      'invoice.finalization_failed',
      {
        id: 'in_finalization_failed_fixture',
        object: 'invoice',
        subscription: 'sub_invoice_policy_fixture',
      },
      created - 1,
    );
    expect(finalizationReplay.statusCode).toBe(202);
    expect(finalizationReplay.json()).toMatchObject({
      duplicate: true,
      application: 'reconciliation_queued',
    });
    await runReconciliation(database, transport, clock.now);
    expect(transport.get).not.toHaveBeenCalled();
    const finalizationReplayCounts = await database.query<
      { recovery_events: number; attention_items: number } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::int FROM commerce_stripe_invoice_recovery_events
          WHERE provider_invoice_id = 'in_finalization_failed_fixture') AS recovery_events,
         (SELECT count(*)::int FROM owner_attention_items
          WHERE dedupe_key = 'billing_invoice_finalization_' ||
            (SELECT id FROM commerce_event_inbox
             WHERE external_event_id = 'evt_invoice_finalization_failed')) AS attention_items`,
    );
    expect(finalizationReplayCounts.rows[0]).toEqual({ recovery_events: 1, attention_items: 1 });

    clock.advance(1_000);
    vi.mocked(transport.get).mockClear();
    const paidThenFinalization = await sendInvoiceEvent(
      'evt_invoice_finalization_after_paid',
      'invoice.finalization_failed',
      {
        id: 'in_invoice_policy_initial',
        object: 'invoice',
        subscription: 'sub_invoice_policy_fixture',
      },
    );
    expect(paidThenFinalization.statusCode).toBe(202);
    const crashedJobs = new DurableJobRepository(database);
    const crashedClaim = await crashedJobs.claim({
      workerId: 'stripe-reconciliation-crashed-worker',
      jobTypes: ['commerce.reconcile'],
      limit: 1,
      leaseDurationMs: 30_000,
      now: clock.now(),
    });
    const crashedJob = crashedClaim[0];
    expect(crashedJob?.type).toBe('commerce.reconcile');
    if (crashedJob === undefined) throw new Error('Missing crash-window reconciliation job');
    await expect(
      crashedJobs.beginConsumerReceipt({
        consumerKey: 'job-handler:commerce.reconcile:v1',
        idempotencyKey: crashedJob.idempotencyKey,
        jobId: crashedJob.id,
        workerId: 'stripe-reconciliation-crashed-worker',
        leaseDurationMs: 30_000,
        now: clock.now(),
      }),
    ).resolves.toBe('acquired');
    const crashedHandler = createStripeReconciliationHandler({
      businessOs: new BusinessOsRepository(database),
      commerce: new CommerceOperationsRepository(
        database,
        Buffer.alloc(32, 11),
        1,
        undefined,
        'local',
      ),
      commerceRuntime: new CommerceRuntimeRepository(database),
      jobs: crashedJobs,
      provider: new StripeTestAdapter(
        transport,
        { authorize: async () => ({ allowed: false, reason: 'test_worker' }) },
        new Set(),
        apiVersion,
      ),
      clock: clock.now,
    });
    await expect(
      crashedHandler({
        job: crashedJob,
        idempotencyKey: crashedJob.idempotencyKey,
        signal: new AbortController().signal,
        heartbeat: async () => true,
      }),
    ).resolves.toBeUndefined();
    expect(transport.get).not.toHaveBeenCalled();

    const crashedState = await database.query<
      {
        automatic_attempt_count: number;
        job_state: string;
        recovery_state: string;
        run_state: string;
      } & Record<string, unknown>
    >(
      `SELECT run.state AS run_state, run.automatic_attempt_count,
              job.state AS job_state, recovery.recovery_state
       FROM commerce_reconciliation_runs run
       JOIN durable_jobs job
         ON job.idempotency_key = ('stripe-reconcile:test:' || run.trigger_event_id)
       JOIN commerce_stripe_invoice_recovery_events recovery
         ON recovery.source_inbox_id = run.trigger_event_id
       JOIN commerce_event_inbox inbox ON inbox.id = run.trigger_event_id
       WHERE inbox.external_event_id = 'evt_invoice_finalization_after_paid'`,
    );
    expect(crashedState.rows[0]).toMatchObject({
      run_state: 'completed',
      automatic_attempt_count: 1,
      job_state: 'running',
      recovery_state: 'resolved',
    });

    clock.advance(30_001);
    const restartedJobs = new DurableJobRepository(database);
    const restartedWorker = new PortableWorker(
      restartedJobs,
      new OutboxDeliveryRepository(database),
      {
        'commerce.reconcile': createStripeReconciliationHandler({
          businessOs: new BusinessOsRepository(database),
          commerce: new CommerceOperationsRepository(
            database,
            Buffer.alloc(32, 11),
            1,
            undefined,
            'local',
          ),
          commerceRuntime: new CommerceRuntimeRepository(database),
          jobs: restartedJobs,
          provider: new StripeTestAdapter(
            transport,
            { authorize: async () => ({ allowed: false, reason: 'test_worker' }) },
            new Set(),
            apiVersion,
          ),
          clock: clock.now,
        }),
      },
      undefined,
      {
        workerId: 'stripe-reconciliation-restarted-worker',
        pollIntervalMs: 100,
        leaseDurationMs: 30_000,
        heartbeatIntervalMs: 5_000,
        shutdownTimeoutMs: 1_000,
        batchSize: 10,
        retryBaseMs: 100,
        retryMaxMs: 1_000,
      },
      createLogger({ level: 'error', sink: () => undefined, clock: clock.now }),
      clock.now,
    );
    await restartedWorker.runOnce();
    await restartedWorker.stop();
    expect(transport.get).not.toHaveBeenCalled();
    const restartedState = await database.query<
      {
        automatic_attempt_count: number;
        budget_attention: number;
        finalization_attention: number;
        job_state: string;
      } & Record<string, unknown>
    >(
      `SELECT run.automatic_attempt_count, job.state AS job_state,
              (SELECT count(*)::int FROM owner_attention_items attention
               WHERE attention.dedupe_key =
                 ('billing_reconciliation_transport_' || run.trigger_event_id)
                 AND attention.state IN ('open','snoozed')) AS budget_attention,
              (SELECT count(*)::int FROM owner_attention_items attention
               WHERE attention.dedupe_key =
                 ('billing_invoice_finalization_' || run.trigger_event_id)
                 AND attention.state IN ('open','snoozed')) AS finalization_attention
       FROM commerce_reconciliation_runs run
       JOIN durable_jobs job
         ON job.idempotency_key = ('stripe-reconcile:test:' || run.trigger_event_id)
       JOIN commerce_event_inbox inbox ON inbox.id = run.trigger_event_id
       WHERE inbox.external_event_id = 'evt_invoice_finalization_after_paid'`,
    );
    expect(restartedState.rows[0]).toEqual({
      automatic_attempt_count: 1,
      budget_attention: 0,
      finalization_attention: 0,
      job_state: 'succeeded',
    });

    clock.advance(1_000);
    let failedAttemptCount = 1;
    let failedPaymentIntentStatus: 'requires_action' | 'requires_payment_method' =
      'requires_action';
    vi.mocked(transport.get).mockImplementation(async ({ path }) => {
      if (path === '/v1/invoices/in_payment_action_required_fixture') {
        const invoiceId = 'in_payment_action_required_fixture';
        const paymentIntentId = 'pi_payment_action_required_fixture';
        return {
          id: invoiceId,
          object: 'invoice',
          livemode: false,
          status: 'open',
          billing_reason: 'subscription_cycle',
          amount_due: 1499,
          currency: 'usd',
          subtotal: 1499,
          total: 1499,
          total_discount_amounts: [],
          total_pretax_credit_amounts: [],
          total_taxes: [],
          discounts: [],
          pre_payment_credit_notes_amount: 0,
          post_payment_credit_notes_amount: 0,
          attempt_count: failedAttemptCount,
          parent: { subscription_details: { subscription: 'sub_invoice_policy_fixture' } },
          payments: {
            object: 'list',
            has_more: false,
            data: [
              {
                id: `inpay_${invoiceId}`,
                object: 'invoice_payment',
                livemode: false,
                invoice: invoiceId,
                payment: {
                  type: 'payment_intent',
                  payment_intent: paymentIntentId,
                },
                status: 'open',
                is_default: true,
                amount_requested: 1499,
                currency: 'usd',
              },
            ],
          },
          lines: {
            object: 'list',
            has_more: false,
            data: [
              {
                id: 'il_payment_action_required_fixture',
                object: 'line_item',
                amount: 1499,
                currency: 'usd',
                quantity: 1,
                discount_amounts: [],
                discounts: [],
                pretax_credit_amounts: [],
                taxes: [],
                parent: {
                  type: 'subscription_item_details',
                  subscription_item_details: {
                    subscription: 'sub_invoice_policy_fixture',
                    subscription_item: 'si_invoice_policy_fixture',
                    proration: false,
                  },
                },
                pricing: {
                  price_details: {
                    price: 'price_family_month_fixture',
                    product: 'prod_family_fixture',
                  },
                },
                period: { start: created, end: created + 30 * 86_400 },
              },
            ],
          },
        };
      }
      if (path === '/v1/payment_intents/pi_payment_action_required_fixture') {
        return {
          id: 'pi_payment_action_required_fixture',
          object: 'payment_intent',
          livemode: false,
          status: failedPaymentIntentStatus,
        };
      }
      if (path === '/v1/subscriptions/sub_invoice_policy_fixture') {
        return { ...subscriptionObject, status: 'past_due', cancel_at_period_end: true };
      }
      return {};
    });
    const paymentActionRequired = await sendInvoiceEvent(
      'evt_invoice_payment_action_required',
      'invoice.payment_action_required',
      { id: 'in_payment_action_required_fixture', object: 'invoice' },
    );
    expect(paymentActionRequired.statusCode).toBe(202);
    expect(paymentActionRequired.json()).toMatchObject({
      duplicate: false,
      application: 'reconciliation_queued',
    });
    const duplicateActionRequired = await sendInvoiceEvent(
      'evt_invoice_payment_action_required',
      'invoice.payment_action_required',
      { id: 'in_payment_action_required_fixture', object: 'invoice' },
    );
    expect(duplicateActionRequired.statusCode).toBe(202);
    expect(duplicateActionRequired.json()).toMatchObject({
      duplicate: true,
      application: 'reconciliation_queued',
    });
    await runReconciliation(database, transport, clock.now);
    const actionRequiredReconciliation = await database.query<
      {
        readonly application_state: string;
        readonly error_code: string | null;
        readonly failure_code: string | null;
        readonly reconciliation_state: string;
        readonly status: string;
      } & Record<string, unknown>
    >(
      `SELECT inbox.status, inbox.application_state, inbox.error_code,
              run.state AS reconciliation_state, run.failure_code
       FROM commerce_event_inbox inbox
       JOIN commerce_reconciliation_runs run ON run.trigger_event_id = inbox.id
       WHERE inbox.external_event_id = 'evt_invoice_payment_action_required'`,
    );
    expect(actionRequiredReconciliation.rows[0]).toMatchObject({
      status: 'processed',
      application_state: 'ignored',
      error_code: 'provider.reconciled_from_snapshot',
      reconciliation_state: 'completed',
      failure_code: null,
    });
    const grace = await database.query<
      { lifecycle: string; current_period_ends_at: unknown; active_grants: number } & Record<
        string,
        unknown
      >
    >(
      `SELECT subscription.lifecycle, subscription.current_period_ends_at,
              (SELECT count(*)::int FROM entitlement_grants grant_record
               WHERE grant_record.subscription_id = subscription.id
                 AND grant_record.revoked_at IS NULL) AS active_grants
       FROM commerce_subscriptions subscription WHERE subscription.id = $1`,
      [subscriptionId],
    );
    expect(grace.rows[0]).toMatchObject({ lifecycle: 'grace', active_grants: 1 });
    expect(new Date(String(grace.rows[0]?.current_period_ends_at)).toISOString()).toBe(
      new Date((created + 33 * 86_400) * 1_000).toISOString(),
    );
    const dunning = await database.query<
      {
        readonly event_kind: string;
        readonly paid_through_at: unknown;
        readonly grace_starts_at: unknown;
        readonly grace_ends_at: unknown;
      } & Record<string, unknown>
    >(
      `SELECT event_kind, paid_through_at, grace_starts_at, grace_ends_at
       FROM commerce_stripe_dunning_events
       WHERE provider_invoice_id = 'in_payment_action_required_fixture'`,
    );
    expect(dunning.rows[0]?.event_kind).toBe('opened');
    expect(new Date(String(dunning.rows[0]?.paid_through_at)).toISOString()).toBe(
      new Date((created + 30 * 86_400) * 1_000).toISOString(),
    );
    expect(new Date(String(dunning.rows[0]?.grace_starts_at)).toISOString()).toBe(
      new Date((created + 30 * 86_400) * 1_000).toISOString(),
    );
    expect(new Date(String(dunning.rows[0]?.grace_ends_at)).toISOString()).toBe(
      new Date((created + 33 * 86_400) * 1_000).toISOString(),
    );
    const failedProof = await database.query<
      {
        readonly amount_due: number;
        readonly currency: string;
        readonly quantity: number;
        readonly attempt_count: number;
        readonly failure_status: string;
        readonly line_proration: boolean;
        readonly period_ends_at: unknown;
        readonly period_starts_at: unknown;
        readonly provider_invoice_line_id: string;
        readonly provider_invoice_payment_id: string;
        readonly provider_product_id: string;
        readonly provider_subscription_item_id: string;
      } & Record<string, unknown>
    >(
      `SELECT amount_due, currency, quantity, attempt_count, failure_status,
              provider_invoice_payment_id,
              provider_invoice_line_id, provider_subscription_item_id,
              provider_product_id, line_proration, period_starts_at, period_ends_at
       FROM commerce_stripe_failed_invoice_evidence
       WHERE provider_invoice_id = 'in_payment_action_required_fixture'`,
    );
    expect(failedProof.rows[0]).toMatchObject({
      amount_due: 1499,
      currency: 'usd',
      quantity: 1,
      attempt_count: 1,
      failure_status: 'requires_action',
      provider_invoice_payment_id: 'inpay_in_payment_action_required_fixture',
      provider_invoice_line_id: 'il_payment_action_required_fixture',
      provider_subscription_item_id: 'si_invoice_policy_fixture',
      provider_product_id: 'prod_family_fixture',
      line_proration: false,
    });
    expect(new Date(String(failedProof.rows[0]?.period_starts_at)).toISOString()).toBe(
      new Date(created * 1_000).toISOString(),
    );
    expect(new Date(String(failedProof.rows[0]?.period_ends_at)).toISOString()).toBe(
      new Date((created + 30 * 86_400) * 1_000).toISOString(),
    );
    const actionRequiredStatus = await app.inject({
      method: 'GET',
      url: '/v1/commerce/stripe/billing',
      headers: { cookie, origin: customerOrigin, 'x-bb-household-id': 'household-sunrise' },
    });
    expect(actionRequiredStatus.json()).toMatchObject({
      billing: { recoveryReason: 'payment_action_required' },
    });

    clock.advance(1_000);
    failedAttemptCount = 2;
    failedPaymentIntentStatus = 'requires_payment_method';
    const repeatFailure = await sendInvoiceEvent(
      'evt_invoice_payment_failed_repeat',
      'invoice.payment_failed',
      { id: 'in_payment_action_required_fixture', object: 'invoice' },
    );
    expect(repeatFailure.statusCode).toBe(202);
    await runReconciliation(database, transport, clock.now);
    const repeatedDunning = await database.query<
      { readonly opened_count: number; readonly current_period_ends_at: unknown } & Record<
        string,
        unknown
      >
    >(
      `SELECT
         (SELECT count(*)::int FROM commerce_stripe_dunning_events
          WHERE subscription_id = subscription.id AND event_kind = 'opened') AS opened_count,
         subscription.current_period_ends_at
       FROM commerce_subscriptions subscription WHERE subscription.id = $1`,
      [subscriptionId],
    );
    expect(repeatedDunning.rows[0]?.opened_count).toBe(1);
    expect(new Date(String(repeatedDunning.rows[0]?.current_period_ends_at)).toISOString()).toBe(
      new Date((created + 33 * 86_400) * 1_000).toISOString(),
    );
    const attemptEvidence = await database.query<
      { attempt_count: number; failure_status: string; source_event: string } & Record<
        string,
        unknown
      >
    >(
      `SELECT failed.attempt_count, failed.failure_status,
              inbox.external_event_id AS source_event
       FROM commerce_stripe_failed_invoice_evidence failed
       JOIN commerce_event_inbox inbox ON inbox.id = failed.source_inbox_id
       WHERE failed.provider_invoice_id = 'in_payment_action_required_fixture'
       ORDER BY failed.attempt_count`,
    );
    expect(attemptEvidence.rows).toEqual([
      {
        attempt_count: 1,
        failure_status: 'requires_action',
        source_event: 'evt_invoice_payment_action_required',
      },
      {
        attempt_count: 2,
        failure_status: 'requires_payment_method',
        source_event: 'evt_invoice_payment_failed_repeat',
      },
    ]);
    const failedStatus = await app.inject({
      method: 'GET',
      url: '/v1/commerce/stripe/billing',
      headers: { cookie, origin: customerOrigin, 'x-bb-household-id': 'household-sunrise' },
    });
    expect(failedStatus.json()).toMatchObject({
      billing: { recoveryReason: 'payment_failed' },
    });
    const billingRuntime = new CommerceRuntimeRepository(database);
    const billingActor = await billingRuntime.resolveActor({
      householdId: 'household-sunrise',
      personId: 'person-owner-alice',
      now: clock.now(),
    });
    const afterGraceStatus = await billingRuntime.stripeBillingStatus({
      actor: billingActor,
      environment: 'test',
      runtimeInitiationPermitted: true,
      runtimePortalPermitted: true,
      now: new Date((created + 33 * 86_400) * 1_000 + 1),
    });
    expect(afterGraceStatus).toMatchObject({
      canonicalAccessActive: false,
      portalAvailable: true,
      recoveryReason: 'payment_failed',
    });

    clock.advance(1_000);
    vi.mocked(transport.get).mockImplementation(async ({ path }) => {
      if (path === '/v1/invoices/in_finalization_failed_fixture') {
        return {
          id: 'in_finalization_failed_fixture',
          object: 'invoice',
          livemode: false,
          status: 'paid',
          billing_reason: 'subscription_cycle',
          amount_paid: 1499,
          amount_remaining: 0,
          currency: 'usd',
          subtotal: 1499,
          total: 1499,
          total_discount_amounts: [],
          total_pretax_credit_amounts: [],
          total_taxes: [],
          discounts: [],
          pre_payment_credit_notes_amount: 0,
          post_payment_credit_notes_amount: 0,
          starting_balance: 0,
          ending_balance: 0,
          amount_overpaid: 0,
          parent: { subscription_details: { subscription: 'sub_invoice_policy_fixture' } },
          payments: {
            object: 'list',
            has_more: false,
            data: [
              {
                id: 'inpay_paid_fixture',
                object: 'invoice_payment',
                livemode: false,
                invoice: 'in_finalization_failed_fixture',
                payment: { type: 'payment_intent', payment_intent: 'pi_paid_fixture' },
                status: 'paid',
                is_default: true,
                amount_paid: 1499,
                amount_requested: 1499,
                currency: 'usd',
                status_transitions: { paid_at: Math.floor(clock.now().getTime() / 1_000) },
              },
            ],
          },
          lines: {
            object: 'list',
            has_more: false,
            data: [
              {
                id: 'il_paid_fixture',
                object: 'line_item',
                amount: 1499,
                currency: 'usd',
                quantity: 1,
                discount_amounts: [],
                discounts: [],
                pretax_credit_amounts: [],
                taxes: [],
                parent: {
                  type: 'subscription_item_details',
                  subscription_item_details: {
                    subscription: 'sub_invoice_policy_fixture',
                    subscription_item: 'si_invoice_policy_fixture',
                    proration: false,
                  },
                },
                pricing: {
                  price_details: {
                    price: 'price_family_month_fixture',
                    product: 'prod_family_fixture',
                  },
                },
                period: { start: created, end: created + 30 * 86_400 },
              },
            ],
          },
        };
      }
      if (path === '/v1/payment_intents/pi_paid_fixture') {
        return {
          id: 'pi_paid_fixture',
          object: 'payment_intent',
          livemode: false,
          status: 'succeeded',
          amount: 1499,
          amount_received: 1499,
          currency: 'usd',
        };
      }
      if (path === '/v1/subscriptions/sub_invoice_policy_fixture') return subscriptionObject;
      return {};
    });
    const paid = await sendInvoiceEvent('evt_invoice_paid', 'invoice.paid', {
      id: 'in_finalization_failed_fixture',
      object: 'invoice',
    });
    expect(paid.statusCode).toBe(202);
    expect(paid.json()).toMatchObject({ application: 'reconciliation_queued' });
    await runReconciliation(database, transport, clock.now);
    const restored = await database.query<
      { lifecycle: string; current_period_ends_at: unknown; active_grants: number } & Record<
        string,
        unknown
      >
    >(
      `SELECT subscription.lifecycle, subscription.current_period_ends_at,
              (SELECT count(*)::int FROM entitlement_grants grant_record
               WHERE grant_record.subscription_id = subscription.id
                 AND grant_record.revoked_at IS NULL) AS active_grants
       FROM commerce_subscriptions subscription WHERE subscription.id = $1`,
      [subscriptionId],
    );
    expect(restored.rows[0]).toMatchObject({ lifecycle: 'active', active_grants: 1 });
    expect(new Date(String(restored.rows[0]?.current_period_ends_at)).toISOString()).toBe(
      new Date((created + 30 * 86_400) * 1_000).toISOString(),
    );
    const dunningAudit = await database.query<
      {
        readonly dunning_window_key: string;
        readonly event_kind: string;
        readonly grace_ends_at: unknown;
        readonly paid_through_at: unknown;
        readonly provider_invoice_id: string;
      } & Record<string, unknown>
    >(
      `SELECT dunning_window_key, event_kind, provider_invoice_id,
              paid_through_at, grace_ends_at
       FROM commerce_stripe_dunning_events
       WHERE subscription_id = $1
       ORDER BY occurred_at, event_kind`,
      [subscriptionId],
    );
    expect(dunningAudit.rows.map((row) => row.event_kind).sort()).toEqual(['opened', 'recovered']);
    expect(new Set(dunningAudit.rows.map((row) => row.dunning_window_key))).toEqual(
      new Set(['in_payment_action_required_fixture']),
    );
    expect(
      dunningAudit.rows.find((row) => row.event_kind === 'recovered')?.provider_invoice_id,
    ).toBe('in_finalization_failed_fixture');
    for (const audit of dunningAudit.rows) {
      expect(new Date(String(audit.paid_through_at)).toISOString()).toBe(
        new Date((created + 30 * 86_400) * 1_000).toISOString(),
      );
      expect(new Date(String(audit.grace_ends_at)).toISOString()).toBe(
        new Date((created + 33 * 86_400) * 1_000).toISOString(),
      );
    }
    const resolvedFinalization = await database.query<
      {
        readonly attention_state: string;
        readonly recovery_rows: number;
        readonly recovery_state: string;
        readonly resolved_at: unknown;
        readonly source_inbox_id: string;
      } & Record<string, unknown>
    >(
      `SELECT recovery.source_inbox_id, recovery.recovery_state,
              attention.state AS attention_state, attention.resolved_at,
              (SELECT count(*)::int FROM commerce_stripe_invoice_recovery_events exact_recovery
               WHERE exact_recovery.source_inbox_id = recovery.source_inbox_id) AS recovery_rows
       FROM commerce_stripe_invoice_recovery_events recovery
       JOIN commerce_event_inbox inbox ON inbox.id = recovery.source_inbox_id
       JOIN owner_attention_items attention ON attention.source_id = recovery.source_inbox_id
        AND attention.dedupe_key =
          ('billing_invoice_finalization_' || recovery.source_inbox_id)
       WHERE inbox.external_event_id = 'evt_invoice_finalization_failed'`,
    );
    expect(resolvedFinalization.rows[0]).toMatchObject({
      attention_state: 'resolved',
      recovery_rows: 1,
      recovery_state: 'attention',
    });
    expect(resolvedFinalization.rows[0]?.resolved_at).not.toBeNull();
    const recoveryInboxId = resolvedFinalization.rows[0]?.source_inbox_id;
    if (recoveryInboxId === undefined) throw new Error('Missing finalization recovery inbox');
    const recoveryClosureEvidence = {
      providerInvoiceId: 'in_finalization_failed_fixture',
      externalSubscriptionId: 'sub_invoice_policy_fixture',
      providerSubscriptionItemId: 'si_invoice_policy_fixture',
      providerInvoiceLineId: 'il_paid_fixture',
      providerInvoicePaymentId: 'inpay_paid_fixture',
      providerProductId: 'prod_family_fixture',
      providerPaymentIntentId: 'pi_paid_fixture',
      providerPriceId: 'price_family_month_fixture',
      billingReason: 'subscription_cycle' as const,
      amountPaid: 1499 as const,
      amountRemaining: 0 as const,
      currency: 'usd' as const,
      quantity: 1 as const,
      discountAmount: 0 as const,
      taxAmount: 0 as const,
      invoiceDiscountsEmpty: true as const,
      invoiceTaxesEmpty: true as const,
      invoiceCreditsEmpty: true as const,
      providerPaidAt: clock.now(),
      currentPeriodStartsAt: new Date(created * 1_000),
      currentPeriodEndsAt: new Date((created + 30 * 86_400) * 1_000),
    };
    const recoveryClosure = new CommerceOperationsRepository(
      database,
      Buffer.alloc(32, 11),
      1,
      undefined,
      'local',
    );
    for (const staleState of ['snoozed', 'open'] as const) {
      await database.query(
        `INSERT INTO owner_attention_items(
           id, attention_kind, source_type, source_id, dedupe_key, why_founder_required,
           recommended_action, consequence_of_inaction, deadline, state, created_at, updated_at
         ) VALUES ($1,'billing_reconciliation','commerce_event',$2,$3,$4,$5,$6,NULL,$7,$8,$8)`,
        [
          `attention-stale-finalization-${staleState}`,
          recoveryInboxId,
          `billing_invoice_finalization_${recoveryInboxId}`,
          'A concurrent finalization worker had already selected unpaid recovery evidence.',
          'No action is required after exact paid evidence commits.',
          'The post-commit closure must resolve this stale operational projection.',
          staleState,
          clock.now().toISOString(),
        ],
      );
      await expect(
        recoveryClosure.resolveStripeInvoiceFinalizationAttentionFromPaidEvidence({
          environment: 'test',
          householdId: 'household-sunrise',
          subscriptionId,
          evidence: recoveryClosureEvidence,
          now: clock.now(),
        }),
      ).resolves.toBe(1);
    }
    const closedConcurrentAttention = await database.query<
      {
        readonly active_grants: number;
        readonly open_attention: number;
        readonly recovery_rows: number;
        readonly resolved_attention: number;
      } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::int FROM commerce_stripe_invoice_recovery_events
          WHERE source_inbox_id = $1) AS recovery_rows,
         (SELECT count(*)::int FROM owner_attention_items
          WHERE source_id = $1 AND dedupe_key = ('billing_invoice_finalization_' || $1)
            AND state IN ('open','snoozed')) AS open_attention,
         (SELECT count(*)::int FROM owner_attention_items
          WHERE source_id = $1 AND dedupe_key = ('billing_invoice_finalization_' || $1)
            AND state = 'resolved') AS resolved_attention,
         (SELECT count(*)::int FROM entitlement_grants
          WHERE subscription_id = $2 AND revoked_at IS NULL) AS active_grants`,
      [recoveryInboxId, subscriptionId],
    );
    expect(closedConcurrentAttention.rows[0]).toEqual({
      recovery_rows: 1,
      open_attention: 0,
      resolved_attention: 3,
      active_grants: 1,
    });
    const recoveredBillingStatus = await app.inject({
      method: 'GET',
      url: '/v1/commerce/stripe/billing',
      headers: { cookie, origin: customerOrigin, 'x-bb-household-id': 'household-sunrise' },
    });
    expect(recoveredBillingStatus.statusCode).toBe(200);
    expect(recoveredBillingStatus.json().billing).not.toHaveProperty('recoveryReason');
  });

  it('keeps exact paid invoice evidence dominant across failure ordering and a stale-read late commit', async () => {
    const cookie = await login(app, 'owner-alice');
    const checkout = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers: {
        cookie,
        origin: customerOrigin,
        'x-bb-household-id': 'household-sunrise',
        'idempotency-key': 'checkout_paid_dominates_failure_0001',
      },
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    const subscriptionId = checkout.json<{ checkout: { canonicalSubscriptionId: string } }>()
      .checkout.canonicalSubscriptionId;
    const created = Math.floor(clock.now().getTime() / 1_000);
    const periodStartsAt = new Date(created * 1_000);
    const periodEndsAt = new Date((created + 30 * 86_400) * 1_000);
    const externalSubscriptionId = 'sub_paid_dominates_failure';
    const providerSubscriptionItemId = 'si_paid_dominates_failure';
    await activateCompletedCheckoutWithPaidInvoice({
      app,
      database,
      transport,
      now: clock.now,
      canonicalSubscriptionId: subscriptionId,
      externalSubscriptionId,
      providerCustomerId: 'cus_paid_dominates_failure',
      fixtureKey: 'paid_dominates_failure',
      periodStart: created,
      periodEnd: created + 30 * 86_400,
    });

    const commerce = new CommerceOperationsRepository(
      database,
      Buffer.alloc(32, 11),
      1,
      undefined,
      'local',
    );
    let eventSequence = 0;
    const captureSource = async (
      eventType: 'invoice.paid' | 'invoice.payment_failed',
      providerInvoiceId: string,
      observedAt: Date,
    ) => {
      eventSequence += 1;
      return commerce.captureVerifiedProviderEvent({
        provider: 'stripe',
        environment: 'test',
        externalEventId: `evt_exact_invoice_order_${String(eventSequence)}`,
        eventType,
        rawPayload: JSON.stringify({ eventType, providerInvoiceId, eventSequence }),
        providerApiVersion: apiVersion,
        providerObjectId: providerInvoiceId,
        providerEventCreatedAt: observedAt,
        evidenceTier: 'local_fixture',
        transportKind: 'injected_fixture',
        transportLivemode: false,
        runtimeRunId: 'exact-invoice-order-test',
        now: observedAt,
      });
    };
    const captureSnapshot = async (observedAt: Date) => {
      eventSequence += 1;
      return commerce.captureVerifiedProviderEvent({
        provider: 'stripe',
        environment: 'test',
        externalEventId: `reconciliation:exact-invoice-order:${String(eventSequence)}`,
        eventType: 'subscription.reconciliation',
        rawPayload: JSON.stringify({ externalSubscriptionId, eventSequence }),
        providerApiVersion: apiVersion,
        providerObjectId: externalSubscriptionId,
        providerEventCreatedAt: observedAt,
        normalizedLifecycle: 'active',
        evidenceTier: 'local_fixture',
        transportKind: 'injected_fixture',
        transportLivemode: false,
        runtimeRunId: 'exact-invoice-order-test',
        now: observedAt,
      });
    };
    const paidEvidence = (providerInvoiceId: string, observedAt: Date) => ({
      providerInvoiceId,
      externalSubscriptionId,
      providerSubscriptionItemId,
      providerInvoiceLineId: `il_${providerInvoiceId}`,
      providerInvoicePaymentId: `inpay_${providerInvoiceId}`,
      providerProductId: 'prod_family_fixture',
      providerPaymentIntentId: `pi_${providerInvoiceId}`,
      providerPriceId: 'price_family_month_fixture',
      billingReason: 'subscription_cycle' as const,
      amountPaid: 1499 as const,
      amountRemaining: 0 as const,
      currency: 'usd' as const,
      quantity: 1 as const,
      discountAmount: 0 as const,
      taxAmount: 0 as const,
      invoiceDiscountsEmpty: true as const,
      invoiceTaxesEmpty: true as const,
      invoiceCreditsEmpty: true as const,
      providerPaidAt: observedAt,
      currentPeriodStartsAt: periodStartsAt,
      currentPeriodEndsAt: periodEndsAt,
    });
    const failedEvidence = (providerInvoiceId: string) => ({
      providerInvoiceId,
      externalSubscriptionId,
      providerSubscriptionItemId,
      providerInvoiceLineId: `il_${providerInvoiceId}`,
      providerInvoicePaymentId: `inpay_${providerInvoiceId}`,
      providerProductId: 'prod_family_fixture',
      providerPaymentIntentId: `pi_${providerInvoiceId}`,
      providerPriceId: 'price_family_month_fixture',
      billingReason: 'subscription_cycle' as const,
      amountDue: 1499 as const,
      currency: 'usd' as const,
      quantity: 1 as const,
      attemptCount: 1,
      failureStatus: 'requires_payment_method' as const,
      lineProration: false as const,
      currentPeriodStartsAt: periodStartsAt,
      currentPeriodEndsAt: periodEndsAt,
    });
    const applyPaid = async (providerInvoiceId: string, observedAt: Date) => {
      const [source, snapshot] = await Promise.all([
        captureSource('invoice.paid', providerInvoiceId, observedAt),
        captureSnapshot(observedAt),
      ]);
      const result = await commerce.applyProviderLifecycle({
        inboxId: snapshot.id,
        provider: 'stripe',
        environment: 'test',
        externalEventId: `reconciliation:exact-invoice-order:${String(eventSequence)}`,
        providerApiVersion: apiVersion,
        providerObjectId: externalSubscriptionId,
        providerEventCreatedAt: observedAt,
        householdId: 'household-sunrise',
        subscriptionId,
        externalSubscriptionId,
        lifecycle: 'active',
        currentPeriodStartsAt: periodStartsAt,
        currentPeriodEndsAt: periodEndsAt,
        accessEvidence: {
          kind: 'payment_confirmed',
          sourceInboxId: source.id,
          evidence: paidEvidence(providerInvoiceId, observedAt),
        },
        authoritativeSnapshot: true,
        now: observedAt,
      });
      await commerce.ignoreProviderEventAfterReconciliation({
        inboxId: source.id,
        now: observedAt,
      });
      return result;
    };
    const applyFailed = async (
      sourceInboxId: string,
      evidence: ReturnType<typeof failedEvidence>,
      observedAt: Date,
    ) => {
      const snapshot = await captureSnapshot(observedAt);
      const result = await commerce.applyProviderLifecycle({
        inboxId: snapshot.id,
        provider: 'stripe',
        environment: 'test',
        externalEventId: `reconciliation:exact-invoice-order:${String(eventSequence)}`,
        providerApiVersion: apiVersion,
        providerObjectId: externalSubscriptionId,
        providerEventCreatedAt: observedAt,
        householdId: 'household-sunrise',
        subscriptionId,
        externalSubscriptionId,
        lifecycle: 'delinquent',
        currentPeriodStartsAt: periodStartsAt,
        currentPeriodEndsAt: periodEndsAt,
        accessEvidence: { kind: 'payment_failed', sourceInboxId, evidence },
        authoritativeSnapshot: true,
        now: observedAt,
      });
      await commerce.ignoreProviderEventAfterReconciliation({
        inboxId: sourceInboxId,
        now: observedAt,
      });
      return result;
    };

    clock.advance(1_000);
    const failureFirstAt = clock.now();
    const failureFirstInvoice = 'in_failure_before_paid';
    const failureFirstSource = await captureSource(
      'invoice.payment_failed',
      failureFirstInvoice,
      failureFirstAt,
    );
    await expect(
      applyFailed(failureFirstSource.id, failedEvidence(failureFirstInvoice), failureFirstAt),
    ).resolves.toMatchObject({ outcome: 'applied', lifecycle: 'grace' });
    clock.advance(1_000);
    await expect(applyPaid(failureFirstInvoice, clock.now())).resolves.toMatchObject({
      outcome: 'applied',
      lifecycle: 'active',
    });

    clock.advance(1_000);
    const paidFirstInvoice = 'in_paid_before_failure';
    await expect(applyPaid(paidFirstInvoice, clock.now())).resolves.toMatchObject({
      outcome: 'applied',
      lifecycle: 'active',
    });
    clock.advance(1_000);
    const paidFirstFailureAt = clock.now();
    const paidFirstFailureSource = await captureSource(
      'invoice.payment_failed',
      paidFirstInvoice,
      paidFirstFailureAt,
    );
    await expect(
      applyFailed(paidFirstFailureSource.id, failedEvidence(paidFirstInvoice), paidFirstFailureAt),
    ).resolves.toMatchObject({ outcome: 'superseded', lifecycle: 'active' });

    clock.advance(1_000);
    const stalledInvoice = 'in_stalled_failure_before_paid_commit';
    const staleReadAt = clock.now();
    const staleFailureSource = await captureSource(
      'invoice.payment_failed',
      stalledInvoice,
      staleReadAt,
    );
    const staleFailureEvidence = failedEvidence(stalledInvoice);
    let releaseLateCommit: (() => void) | undefined;
    const lateCommitGate = new Promise<void>((resolve) => {
      releaseLateCommit = resolve;
    });
    const lateFailureCommit = (async () => {
      await lateCommitGate;
      return applyFailed(staleFailureSource.id, staleFailureEvidence, staleReadAt);
    })();
    clock.advance(1_000);
    await expect(applyPaid(stalledInvoice, clock.now())).resolves.toMatchObject({
      outcome: 'applied',
      lifecycle: 'active',
    });
    releaseLateCommit?.();
    await expect(lateFailureCommit).resolves.toMatchObject({
      outcome: 'superseded',
      lifecycle: 'active',
    });

    const state = await database.query<
      {
        readonly active_grants: number;
        readonly failed_evidence: number;
        readonly lifecycle: string;
        readonly opened_dunning: number;
        readonly paid_evidence: number;
        readonly recovered_dunning: number;
        readonly superseded_failures: number;
      } & Record<string, unknown>
    >(
      `SELECT subscription.lifecycle,
              (SELECT count(*)::int FROM entitlement_grants grant_record
               WHERE grant_record.subscription_id = subscription.id
                 AND grant_record.revoked_at IS NULL) AS active_grants,
              (SELECT count(*)::int FROM commerce_stripe_paid_invoice_evidence paid
               WHERE paid.subscription_id = subscription.id
                 AND paid.provider_invoice_id IN (
                   'in_failure_before_paid', 'in_paid_before_failure',
                   'in_stalled_failure_before_paid_commit'
                 )) AS paid_evidence,
              (SELECT count(*)::int FROM commerce_stripe_failed_invoice_evidence failed
               WHERE failed.subscription_id = subscription.id
                 AND failed.provider_invoice_id IN (
                   'in_failure_before_paid', 'in_paid_before_failure',
                   'in_stalled_failure_before_paid_commit'
                 )) AS failed_evidence,
              (SELECT count(*)::int FROM commerce_stripe_dunning_events dunning
               WHERE dunning.subscription_id = subscription.id
                 AND dunning.event_kind = 'opened') AS opened_dunning,
              (SELECT count(*)::int FROM commerce_stripe_dunning_events dunning
               WHERE dunning.subscription_id = subscription.id
                 AND dunning.event_kind = 'recovered') AS recovered_dunning,
              (SELECT count(*)::int FROM commerce_event_inbox inbox
               WHERE inbox.external_event_id LIKE 'reconciliation:exact-invoice-order:%'
                 AND inbox.application_state = 'superseded') AS superseded_failures
       FROM commerce_subscriptions subscription
       WHERE subscription.household_id = 'household-sunrise' AND subscription.id = $1`,
      [subscriptionId],
    );
    expect(state.rows[0]).toEqual({
      lifecycle: 'active',
      active_grants: 1,
      paid_evidence: 3,
      failed_evidence: 3,
      opened_dunning: 1,
      recovered_dunning: 1,
      superseded_failures: 2,
    });
  });

  it('reconciles a full refund and chargeback without treating partial evidence as cancellation', async () => {
    const cookie = await login(app, 'owner-alice');
    const headers = {
      cookie,
      origin: customerOrigin,
      'x-bb-household-id': 'household-sunrise',
      'idempotency-key': 'checkout_financial_event_0001',
    };
    const checkout = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers,
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    const subscriptionId = checkout.json<{ checkout: { canonicalSubscriptionId: string } }>()
      .checkout.canonicalSubscriptionId;
    const created = Math.floor(clock.now().getTime() / 1_000);
    const periodEnd = created + 30 * 86_400;
    const subscriptionObject = {
      id: 'sub_financial_fixture',
      object: 'subscription',
      livemode: false,
      customer: 'cus_financial_fixture',
      status: 'active',
      created,
      current_period_start: created,
      current_period_end: periodEnd,
      items: {
        has_more: false,
        data: [
          {
            id: 'si_financial_fixture',
            quantity: 1,
            price: {
              id: 'price_family_month_fixture',
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
            },
          },
        ],
      },
    };
    await activateCompletedCheckoutWithPaidInvoice({
      app,
      database,
      transport,
      now: clock.now,
      canonicalSubscriptionId: subscriptionId,
      externalSubscriptionId: 'sub_financial_fixture',
      providerCustomerId: 'cus_financial_fixture',
      fixtureKey: 'financial',
      periodStart: created,
      periodEnd,
    });

    const disputeStatuses = new Map([
      ['dp_financial_fixture', 'needs_response'],
      ['dp_financial_fixture_2', 'needs_response'],
    ]);
    const refundStatuses = new Map([['re_pending_full_refund', 'pending']]);
    let chargeRefundSnapshot: 'partial' | 'full' = 'partial';
    vi.mocked(transport.get).mockImplementation(async ({ path }) => {
      if (path.startsWith('/v1/subscriptions/')) return subscriptionObject;
      if (path === '/v1/charges/ch_financial_fixture') {
        const full = chargeRefundSnapshot === 'full';
        return {
          id: 'ch_financial_fixture',
          object: 'charge',
          livemode: false,
          status: 'succeeded',
          paid: true,
          amount: 1_499,
          currency: 'usd',
          amount_refunded: full ? 1_499 : 500,
          refunded: full,
          payment_intent: 'pi_financial_initial',
          refunds: {
            has_more: false,
            data: full
              ? [
                  {
                    id: 're_full_refund_part_a',
                    object: 'refund',
                    livemode: false,
                    status: 'succeeded',
                    amount: 500,
                    currency: 'usd',
                    charge: 'ch_financial_fixture',
                    payment_intent: null,
                  },
                  {
                    id: 're_failed_attempt_ignored',
                    object: 'refund',
                    livemode: false,
                    status: 'failed',
                    amount: 1_499,
                    currency: 'usd',
                    charge: 'ch_financial_fixture',
                    payment_intent: 'pi_financial_initial',
                  },
                  {
                    id: 're_full_refund_part_b',
                    object: 'refund',
                    livemode: false,
                    status: 'succeeded',
                    amount: 999,
                    currency: 'usd',
                    charge: 'ch_financial_fixture',
                    payment_intent: 'pi_financial_initial',
                  },
                ]
              : [
                  {
                    id: 're_partial_refund',
                    object: 'refund',
                    livemode: false,
                    status: 'succeeded',
                    amount: 500,
                    currency: 'usd',
                    charge: 'ch_financial_fixture',
                    payment_intent: null,
                  },
                ],
          },
        };
      }
      if (path === '/v1/refunds/re_failed_refund') {
        return {
          id: 're_failed_refund',
          object: 'refund',
          livemode: false,
          status: 'failed',
          amount: 1_499,
          currency: 'usd',
          charge: 'ch_financial_fixture',
          payment_intent: null,
        };
      }
      if (path === '/v1/refunds/re_pending_full_refund') {
        return {
          id: 're_pending_full_refund',
          object: 'refund',
          livemode: false,
          status: refundStatuses.get('re_pending_full_refund'),
          amount: 1_499,
          currency: 'usd',
          charge: 'ch_financial_fixture',
          payment_intent: null,
        };
      }
      if (path === '/v1/payment_intents/pi_financial_initial') {
        return {
          id: 'pi_financial_initial',
          object: 'payment_intent',
          livemode: false,
          status: 'succeeded',
          amount: 1_499,
          amount_received: 1_499,
          currency: 'usd',
          latest_charge: 'ch_financial_fixture',
        };
      }
      if (
        path ===
        '/v1/invoice_payments?payment[type]=payment_intent&payment[payment_intent]=pi_financial_initial&limit=2'
      ) {
        return {
          object: 'list',
          has_more: false,
          data: [
            {
              id: 'inpay_financial_initial',
              object: 'invoice_payment',
              livemode: false,
              invoice: 'in_financial_initial',
              status: 'paid',
              is_default: true,
              amount_paid: 1_499,
              amount_requested: 1_499,
              currency: 'usd',
              payment: { type: 'payment_intent', payment_intent: 'pi_financial_initial' },
            },
          ],
        };
      }
      if (path === '/v1/invoices/in_financial_initial') {
        return {
          id: 'in_financial_initial',
          object: 'invoice',
          livemode: false,
          parent: { subscription_details: { subscription: 'sub_financial_fixture' } },
        };
      }
      if (path === '/v1/disputes/dp_financial_fixture') {
        return {
          id: 'dp_financial_fixture',
          object: 'dispute',
          livemode: false,
          charge: 'ch_financial_fixture',
          amount: 500,
          currency: 'usd',
          payment_intent: null,
          status: disputeStatuses.get('dp_financial_fixture'),
        };
      }
      if (path === '/v1/disputes/dp_financial_fixture_2') {
        return {
          id: 'dp_financial_fixture_2',
          object: 'dispute',
          livemode: false,
          charge: 'ch_financial_fixture',
          amount: 1_499,
          currency: 'usd',
          payment_intent: 'pi_financial_initial',
          status: disputeStatuses.get('dp_financial_fixture_2'),
        };
      }
      return {};
    });
    const sendFinancialEvent = async (
      id: string,
      type: string,
      objectId: string,
      providerCreatedAt = Math.floor(clock.now().getTime() / 1_000),
    ) => {
      const rawBody = JSON.stringify({
        id,
        type,
        created: providerCreatedAt,
        livemode: false,
        api_version: apiVersion,
        data: {
          object: {
            id: objectId,
            object: type.startsWith('charge.dispute')
              ? 'dispute'
              : type.startsWith('refund.')
                ? 'refund'
                : 'charge',
          },
        },
      });
      return app.inject({
        method: 'POST',
        url: '/v1/webhooks/stripe',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': signStripeFixture({
            rawBody,
            endpointSecret,
            timestampSeconds: Math.floor(clock.now().getTime() / 1_000),
          }),
        },
        payload: rawBody,
      });
    };
    expect(
      (
        await sendFinancialEvent('evt_partial_refund', 'charge.refunded', 'ch_financial_fixture')
      ).json(),
    ).toMatchObject({ application: 'reconciliation_queued' });
    await runReconciliation(database, transport, clock.now);
    let state = await database.query<
      { lifecycle: string; active_grants: number } & Record<string, unknown>
    >(
      `SELECT subscription.lifecycle,
              (SELECT count(*)::int FROM entitlement_grants grant_record
               WHERE grant_record.subscription_id = subscription.id
                 AND grant_record.revoked_at IS NULL) AS active_grants
       FROM commerce_subscriptions subscription WHERE subscription.id = $1`,
      [subscriptionId],
    );
    expect(state.rows[0]).toMatchObject({ lifecycle: 'active', active_grants: 1 });

    clock.advance(1_000);
    chargeRefundSnapshot = 'full';
    expect(
      (
        await sendFinancialEvent('evt_full_refund', 'charge.refunded', 'ch_financial_fixture')
      ).json(),
    ).toMatchObject({ application: 'reconciliation_queued' });
    await runReconciliation(database, transport, clock.now);
    const fullRefundEvidence = await database.query<
      {
        readonly application_state: string;
        readonly error_code: string | null;
        readonly restriction_events: number;
        readonly job_state: string;
        readonly job_error: string | null;
      } & Record<string, unknown>
    >(
      `SELECT inbox.application_state, inbox.error_code,
              (SELECT count(*)::int FROM commerce_stripe_financial_restriction_events
               WHERE source_inbox_id = inbox.id) AS restriction_events,
              (SELECT state FROM durable_jobs
               WHERE idempotency_key = 'stripe-reconcile:test:' || inbox.id) AS job_state,
              (SELECT last_error_code FROM durable_jobs
               WHERE idempotency_key = 'stripe-reconcile:test:' || inbox.id) AS job_error
       FROM commerce_event_inbox inbox
       WHERE inbox.external_event_id = 'evt_full_refund'`,
    );
    expect(fullRefundEvidence.rows[0]).toEqual({
      application_state: 'ignored',
      error_code: 'provider.reconciled_from_snapshot',
      restriction_events: 2,
      job_state: 'succeeded',
      job_error: null,
    });
    state = await database.query<
      { lifecycle: string; active_grants: number } & Record<string, unknown>
    >(
      `SELECT subscription.lifecycle,
              (SELECT count(*)::int FROM entitlement_grants grant_record
               WHERE grant_record.subscription_id = subscription.id
                 AND grant_record.revoked_at IS NULL) AS active_grants
       FROM commerce_subscriptions subscription WHERE subscription.id = $1`,
      [subscriptionId],
    );
    expect(state.rows[0]).toMatchObject({ lifecycle: 'refunded', active_grants: 0 });

    clock.advance(1_000);
    expect(
      (
        await sendFinancialEvent(
          'evt_pending_full_refund',
          'refund.created',
          're_pending_full_refund',
        )
      ).json(),
    ).toMatchObject({ application: 'reconciliation_queued' });
    await runReconciliation(database, transport, clock.now);
    refundStatuses.set('re_pending_full_refund', 'failed');
    clock.advance(1_000);
    expect(
      (
        await sendFinancialEvent(
          'evt_pending_full_refund_failed',
          'refund.failed',
          're_pending_full_refund',
        )
      ).json(),
    ).toMatchObject({ application: 'reconciliation_queued' });
    await runReconciliation(database, transport, clock.now);
    const exactRefundLifecycle = await database.query<
      { readonly event_state: string; readonly job_state: string } & Record<string, unknown>
    >(
      `SELECT restriction.event_state,
              (SELECT state FROM durable_jobs
               WHERE idempotency_key = 'stripe-reconcile:test:' || restriction.source_inbox_id)
                AS job_state
       FROM commerce_stripe_financial_restriction_events restriction
       WHERE restriction_kind = 'refund'
         AND provider_restriction_id = 're_pending_full_refund'
       ORDER BY observed_at`,
    );
    expect(exactRefundLifecycle.rows).toEqual([
      { event_state: 'opened', job_state: 'succeeded' },
      { event_state: 'cleared', job_state: 'succeeded' },
    ]);

    clock.advance(1_000);
    expect(
      (await sendFinancialEvent('evt_refund_failed', 'refund.failed', 're_failed_refund')).json(),
    ).toMatchObject({ application: 'reconciliation_queued' });
    await runReconciliation(database, transport, clock.now);
    const mismatchedRefundClosure = await database.query<
      {
        readonly application_state: string;
        readonly job_state: string;
        readonly job_error: string | null;
        readonly exact_open_refund: number;
        readonly mismatched_closure: number;
      } & Record<string, unknown>
    >(
      `SELECT inbox.application_state,
              (SELECT state FROM durable_jobs
               WHERE idempotency_key = 'stripe-reconcile:test:' || inbox.id) AS job_state,
              (SELECT last_error_code FROM durable_jobs
               WHERE idempotency_key = 'stripe-reconcile:test:' || inbox.id) AS job_error,
              (SELECT count(*)::int FROM commerce_stripe_financial_restriction_events
               WHERE restriction_kind = 'refund'
                 AND provider_restriction_id IN ('re_full_refund_part_a','re_full_refund_part_b')
                 AND event_state = 'opened') AS exact_open_refund,
              (SELECT count(*)::int FROM commerce_stripe_financial_restriction_events
               WHERE restriction_kind = 'refund' AND provider_restriction_id = 're_failed_refund'
                 AND event_state <> 'opened') AS mismatched_closure
       FROM commerce_event_inbox inbox
       WHERE external_event_id = 'evt_refund_failed'`,
    );
    expect(mismatchedRefundClosure.rows[0]).toEqual({
      application_state: 'pending',
      job_state: 'retry',
      job_error: 'handler_failed',
      exact_open_refund: 2,
      mismatched_closure: 0,
    });

    clock.advance(1_000);
    const firstDisputeCreatedAt = Math.floor(clock.now().getTime() / 1_000);
    expect(
      (
        await sendFinancialEvent('evt_chargeback', 'charge.dispute.created', 'dp_financial_fixture')
      ).json(),
    ).toMatchObject({ application: 'reconciliation_queued' });
    await runReconciliation(database, transport, clock.now);
    state = await database.query(
      `SELECT lifecycle,
              (SELECT count(*)::int FROM owner_attention_items
               WHERE attention_kind = 'billing_reconciliation' AND state = 'open') AS attention
       FROM commerce_subscriptions WHERE id = $1`,
      [subscriptionId],
    );
    expect(state.rows[0]).toMatchObject({ lifecycle: 'disputed', attention: 4 });

    clock.advance(1_000);
    expect(
      (
        await sendFinancialEvent(
          'evt_chargeback_closed_unresolved',
          'charge.dispute.closed',
          'dp_financial_fixture',
        )
      ).json(),
    ).toMatchObject({ application: 'reconciliation_queued' });
    await runReconciliation(database, transport, clock.now);
    const unresolvedClosure = await database.query<
      {
        readonly restriction_events: number;
        readonly job_state: string;
        readonly job_error: string | null;
      } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::int FROM commerce_stripe_financial_restriction_events restriction
          WHERE restriction.source_inbox_id = inbox.id) AS restriction_events,
         (SELECT state FROM durable_jobs
          WHERE idempotency_key = 'stripe-reconcile:test:' || inbox.id) AS job_state,
         (SELECT last_error_code FROM durable_jobs
          WHERE idempotency_key = 'stripe-reconcile:test:' || inbox.id) AS job_error
       FROM commerce_event_inbox inbox
       WHERE inbox.external_event_id = 'evt_chargeback_closed_unresolved'`,
    );
    expect(unresolvedClosure.rows[0]).toEqual({
      restriction_events: 1,
      job_state: 'succeeded',
      job_error: null,
    });

    clock.advance(1_000);
    expect(
      (
        await sendFinancialEvent(
          'evt_chargeback_second',
          'charge.dispute.created',
          'dp_financial_fixture_2',
        )
      ).json(),
    ).toMatchObject({ application: 'reconciliation_queued' });
    await runReconciliation(database, transport, clock.now);
    const unresolvedRestrictions = await database.query<
      { readonly refunds: number; readonly disputes: number } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::int FROM (
            SELECT DISTINCT ON (provider_restriction_id) provider_restriction_id, event_state
            FROM commerce_stripe_financial_restriction_events
            WHERE subscription_id = $1 AND restriction_kind = 'refund'
            ORDER BY provider_restriction_id, observed_at DESC, id DESC
          ) latest WHERE event_state <> 'cleared') AS refunds,
         (SELECT count(*)::int FROM (
            SELECT DISTINCT ON (provider_restriction_id) provider_restriction_id, event_state
            FROM commerce_stripe_financial_restriction_events
            WHERE subscription_id = $1 AND restriction_kind = 'dispute'
            ORDER BY provider_restriction_id, observed_at DESC, id DESC
          ) latest WHERE event_state <> 'cleared') AS disputes`,
      [subscriptionId],
    );
    expect(unresolvedRestrictions.rows[0]).toEqual({ refunds: 2, disputes: 2 });

    clock.advance(1_000);
    const routineActive = JSON.stringify({
      id: 'evt_active_after_chargeback',
      type: 'customer.subscription.updated',
      created: Math.floor(clock.now().getTime() / 1_000),
      livemode: false,
      api_version: apiVersion,
      data: { object: subscriptionObject },
    });
    const routineResponse = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signStripeFixture({
          rawBody: routineActive,
          endpointSecret,
          timestampSeconds: Math.floor(clock.now().getTime() / 1_000),
        }),
      },
      payload: routineActive,
    });
    expect(routineResponse.statusCode).toBe(200);
    const held = await database.query<
      { lifecycle: string; active_grants: number } & Record<string, unknown>
    >(
      `SELECT subscription.lifecycle,
              (SELECT count(*)::int FROM entitlement_grants grant_record
               WHERE grant_record.subscription_id = subscription.id
                 AND grant_record.revoked_at IS NULL) AS active_grants
       FROM commerce_subscriptions subscription WHERE subscription.id = $1`,
      [subscriptionId],
    );
    expect(held.rows[0]).toMatchObject({ lifecycle: 'disputed', active_grants: 0 });

    clock.advance(1_000);
    disputeStatuses.set('dp_financial_fixture', 'won');
    expect(
      (
        await sendFinancialEvent(
          'evt_chargeback_closed_won',
          'charge.dispute.closed',
          'dp_financial_fixture',
        )
      ).json(),
    ).toMatchObject({ application: 'reconciliation_queued' });
    await runReconciliation(database, transport, clock.now);
    let closure = await database.query<
      {
        readonly lifecycle: string;
        readonly financial_restriction: string | null;
        readonly cleared_disputes: number;
        readonly unresolved_disputes: number;
        readonly unresolved_refunds: number;
      } & Record<string, unknown>
    >(
      `SELECT subscription.lifecycle, provider_record.financial_restriction,
              (SELECT count(*)::int FROM commerce_stripe_financial_restriction_events
               WHERE subscription_id = subscription.id AND restriction_kind = 'dispute'
                 AND provider_restriction_id = 'dp_financial_fixture'
                 AND event_state = 'cleared') AS cleared_disputes,
              (SELECT count(*)::int FROM (
                 SELECT DISTINCT ON (provider_restriction_id)
                        provider_restriction_id, event_state
                 FROM commerce_stripe_financial_restriction_events
                 WHERE subscription_id = subscription.id AND restriction_kind = 'dispute'
                 ORDER BY provider_restriction_id, observed_at DESC, id DESC
               ) latest WHERE event_state <> 'cleared') AS unresolved_disputes,
              (SELECT count(*)::int FROM (
                 SELECT DISTINCT ON (provider_restriction_id)
                        provider_restriction_id, event_state
                 FROM commerce_stripe_financial_restriction_events
                 WHERE subscription_id = subscription.id AND restriction_kind = 'refund'
                 ORDER BY provider_restriction_id, observed_at DESC, id DESC
               ) latest WHERE event_state <> 'cleared') AS unresolved_refunds
       FROM commerce_subscriptions subscription
       JOIN commerce_provider_subscription_records provider_record
         ON provider_record.household_id = subscription.household_id
        AND provider_record.subscription_id = subscription.id
       WHERE subscription.id = $1`,
      [subscriptionId],
    );
    expect(closure.rows[0]).toEqual({
      lifecycle: 'disputed',
      financial_restriction: 'disputed',
      cleared_disputes: 1,
      unresolved_disputes: 1,
      unresolved_refunds: 2,
    });

    clock.advance(1_000);
    expect(
      (
        await sendFinancialEvent(
          'evt_chargeback_stale_created_delivery',
          'charge.dispute.created',
          'dp_financial_fixture',
          firstDisputeCreatedAt,
        )
      ).json(),
    ).toMatchObject({ application: 'reconciliation_queued' });
    await runReconciliation(database, transport, clock.now);
    const staleDelivery = await database.query<
      {
        readonly opened_events: number;
        readonly unresolved_exact_dispute: number;
      } & Record<string, unknown>
    >(
      `SELECT
         count(*) FILTER (WHERE event_state = 'opened')::int AS opened_events,
         CASE WHEN
           max(observed_at) FILTER (WHERE event_state <> 'cleared') >=
           max(observed_at) FILTER (WHERE event_state = 'cleared')
         THEN 1 ELSE 0 END::int AS unresolved_exact_dispute
       FROM commerce_stripe_financial_restriction_events
       WHERE restriction_kind = 'dispute'
         AND provider_restriction_id = 'dp_financial_fixture'`,
    );
    expect(staleDelivery.rows[0]).toEqual({
      opened_events: 2,
      unresolved_exact_dispute: 0,
    });

    clock.advance(1_000);
    disputeStatuses.set('dp_financial_fixture_2', 'won');
    expect(
      (
        await sendFinancialEvent(
          'evt_chargeback_second_closed_won',
          'charge.dispute.closed',
          'dp_financial_fixture_2',
        )
      ).json(),
    ).toMatchObject({ application: 'reconciliation_queued' });
    await runReconciliation(database, transport, clock.now);
    closure = await database.query(
      `SELECT subscription.lifecycle, provider_record.financial_restriction,
              (SELECT count(*)::int FROM commerce_stripe_financial_restriction_events
               WHERE subscription_id = subscription.id AND restriction_kind = 'dispute'
                 AND event_state = 'cleared') AS cleared_disputes,
              (SELECT count(*)::int FROM (
                 SELECT DISTINCT ON (provider_restriction_id)
                        provider_restriction_id, event_state
                 FROM commerce_stripe_financial_restriction_events
                 WHERE subscription_id = subscription.id AND restriction_kind = 'dispute'
                 ORDER BY provider_restriction_id, observed_at DESC, id DESC
               ) latest WHERE event_state <> 'cleared') AS unresolved_disputes,
              (SELECT count(*)::int FROM (
                 SELECT DISTINCT ON (provider_restriction_id)
                        provider_restriction_id, event_state
                 FROM commerce_stripe_financial_restriction_events
                 WHERE subscription_id = subscription.id AND restriction_kind = 'refund'
                 ORDER BY provider_restriction_id, observed_at DESC, id DESC
               ) latest WHERE event_state <> 'cleared') AS unresolved_refunds
       FROM commerce_subscriptions subscription
       JOIN commerce_provider_subscription_records provider_record
         ON provider_record.household_id = subscription.household_id
        AND provider_record.subscription_id = subscription.id
       WHERE subscription.id = $1`,
      [subscriptionId],
    );
    expect(closure.rows[0]).toEqual({
      lifecycle: 'refunded',
      financial_restriction: 'refunded',
      cleared_disputes: 3,
      unresolved_disputes: 0,
      unresolved_refunds: 2,
    });
  });

  it('denies a neutral non-billing member and holds an unbound signed event for attention', async () => {
    const samCookie = await login(app, 'trusted-terry');
    const denied = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers: {
        cookie: samCookie,
        origin: customerOrigin,
        'x-bb-household-id': 'household-sunrise',
        'idempotency-key': 'checkout_fixture_denied_0001',
      },
      payload: { offerId: 'founding_family_monthly_v1' },
    });
    expect(denied.statusCode).toBe(403);

    const event = JSON.stringify({
      id: 'evt_fixture_foreign_binding',
      type: 'customer.subscription.updated',
      created: Math.floor(clock.now().getTime() / 1_000),
      livemode: false,
      api_version: apiVersion,
      data: {
        object: {
          id: 'sub_foreign_fixture',
          object: 'subscription',
          livemode: false,
          customer: 'cus_foreign_fixture',
          status: 'active',
          metadata: {
            household_id: 'household-sunrise',
            canonical_subscription_id: 'subscription_foreign',
            plan_version_id: 'family_v1',
          },
        },
      },
    });
    const webhook = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signStripeFixture({
          rawBody: event,
          endpointSecret,
          timestampSeconds: Math.floor(clock.now().getTime() / 1_000),
        }),
      },
      payload: event,
    });
    expect(webhook.statusCode).toBe(202);
    expect(webhook.json()).toMatchObject({ application: 'reconciliation_queued' });
    const observed = Math.floor(clock.now().getTime() / 1_000);
    vi.mocked(transport.get).mockResolvedValue({
      id: 'sub_foreign_fixture',
      object: 'subscription',
      livemode: false,
      customer: 'cus_foreign_fixture',
      status: 'active',
      created: observed,
      current_period_start: observed,
      current_period_end: observed + 30 * 86_400,
      items: {
        data: [
          {
            price: {
              id: 'price_family_month_fixture',
              recurring: { interval: 'month' },
            },
          },
        ],
      },
    });
    await runReconciliation(database, transport, clock.now);
    const inbox = await database.query<
      { readonly application_state: string; readonly error_code: string | null } & Record<
        string,
        unknown
      >
    >(
      `SELECT application_state, error_code FROM commerce_event_inbox
       WHERE provider = 'stripe' AND environment = 'test' AND external_event_id = $1`,
      ['evt_fixture_foreign_binding'],
    );
    expect(inbox.rows[0]).toEqual({
      application_state: 'pending',
      error_code: null,
    });
    const reconciliation = await database.query(
      `SELECT state, failure_code FROM commerce_reconciliation_runs
       WHERE trigger_event_id = (
         SELECT id FROM commerce_event_inbox WHERE external_event_id = $1
       )`,
      ['evt_fixture_foreign_binding'],
    );
    expect(reconciliation.rows[0]).toMatchObject({
      state: 'attention',
      failure_code: 'stripe.checkout_binding_pending',
    });
  });
});

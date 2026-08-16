import type { AppConfig } from '@boomerbuddy/config';
import {
  signStripeFixture,
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
import { createMutableClock, testConfig } from './support';

const customerOrigin = 'https://customer.boomerbuddy.test';
const hqOrigin = 'https://hq.boomerbuddy.test';
const endpointSecret = 'whsec_fixture_12345678';
const apiVersion = '2026-07-29.fixture';

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
        secretKey: 'sk_test_fixture_12345678',
        webhookSecret: endpointSecret,
        apiVersion,
        cancelOnlyPortalConfigurationId: 'bpc_cancel_only_fixture',
        prices: {
          'plus_v1:month': 'price_plus_month_fixture',
          'plus_v1:year': 'price_plus_year_fixture',
          'family_v1:month': 'price_family_month_fixture',
          'family_v1:year': 'price_family_year_fixture',
        },
      },
    },
  };
}

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

async function runReconciliation(
  database: Awaited<ReturnType<typeof createPGliteDatabase>>,
  transport: StripeTransport,
  now: () => Date,
): Promise<void> {
  const worker = new PortableWorker(
    new DurableJobRepository(database),
    new OutboxDeliveryRepository(database),
    {
      'commerce.reconcile': createStripeReconciliationHandler({
        businessOs: new BusinessOsRepository(database),
        commerce: new CommerceOperationsRepository(database, Buffer.alloc(32, 11), 1),
        commerceRuntime: new CommerceRuntimeRepository(database),
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

describe('Stripe test-mode transaction path', () => {
  const clock = createMutableClock();
  let app: FastifyInstance;
  let database: Awaited<ReturnType<typeof createPGliteDatabase>>;
  let transport: StripeTransport;

  beforeEach(async () => {
    database = await createPGliteDatabase(':memory:');
    transport = {
      postForm: vi.fn(async ({ path }) =>
        path === '/v1/checkout/sessions'
          ? {
              id: 'cs_test_fixture_123',
              url: 'https://checkout.stripe.test/session-fixture',
              expires_at: Math.floor(clock.now().getTime() / 1_000) + 1_800,
            }
          : { id: 'bps_test_fixture', url: 'https://billing.stripe.test/portal-fixture' },
      ),
      get: vi.fn(async () => ({})),
    };
    app = await buildApp({
      config: stripeConfig(),
      database,
      closeDatabase: false,
      stripeTransport: transport,
      now: clock.now,
      logger: createLogger({ level: 'error', sink: () => undefined, clock: clock.now }),
    });
  });

  afterEach(async () => {
    await app.close();
    await database.close();
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
      payload: { planVersionId: 'family_v1', billingInterval: 'month' },
    });
    expect(checkout.statusCode).toBe(201);
    const checkoutBody = checkout.json<{
      checkout: { canonicalSubscriptionId: string; sessionId: string };
    }>();
    expect(checkoutBody.checkout.sessionId).toBe('cs_test_fixture_123');

    const repeated = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers,
      payload: { planVersionId: 'family_v1', billingInterval: 'month' },
    });
    expect(repeated.statusCode).toBe(201);
    const intents = await database.query<{ count: number } & Record<string, unknown>>(
      `SELECT count(*)::int AS count FROM commerce_checkout_intents
       WHERE household_id = 'household-sunrise'`,
    );
    expect(intents.rows[0]?.count).toBe(1);

    const parallelCheckout = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers: { ...headers, 'idempotency-key': 'checkout_fixture_request_0002' },
      payload: { planVersionId: 'family_v1', billingInterval: 'month' },
    });
    expect(parallelCheckout.statusCode).toBe(409);

    const event = JSON.stringify({
      id: 'evt_fixture_transaction_1',
      type: 'customer.subscription.updated',
      created: Math.floor(clock.now().getTime() / 1_000),
      livemode: false,
      api_version: apiVersion,
      data: {
        object: {
          id: 'sub_stripe_fixture_1',
          object: 'subscription',
          customer: 'cus_fixture_1',
          status: 'active',
          cancel_at_period_end: false,
          current_period_start: Math.floor(clock.now().getTime() / 1_000),
          current_period_end: Math.floor(clock.now().getTime() / 1_000) + 30 * 86_400,
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
          metadata: {
            household_id: 'household-sunrise',
            canonical_subscription_id: checkoutBody.checkout.canonicalSubscriptionId,
            plan_version_id: 'family_v1',
          },
        },
      },
    });
    const signature = signStripeFixture({
      rawBody: event,
      endpointSecret,
      timestampSeconds: Math.floor(clock.now().getTime() / 1_000),
    });
    for (const duplicate of [false, true]) {
      const webhook = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': signature },
        payload: event,
      });
      expect(webhook.statusCode).toBe(200);
      expect(webhook.json()).toMatchObject({ received: true, duplicate, application: 'applied' });
    }

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

    const portal = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/portal',
      headers: { ...headers, 'idempotency-key': 'portal_fixture_request_0001' },
    });
    expect(portal.statusCode).toBe(200);
    expect(transport.postForm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: '/v1/billing_portal/sessions',
        form: expect.objectContaining({ customer: 'cus_fixture_1' }),
      }),
    );
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
      payload: { planVersionId: 'family_v1', billingInterval: 'month' },
    });
    const subscriptionId = checkout.json<{ checkout: { canonicalSubscriptionId: string } }>()
      .checkout.canonicalSubscriptionId;
    const initialStart = Math.floor(clock.now().getTime() / 1_000);
    const initialEnd = initialStart + 30 * 86_400;
    const renewalEnd = initialEnd + 30 * 86_400;
    const subscriptionObject = (start: number, end: number) => ({
      id: 'sub_paid_period_proof',
      object: 'subscription',
      customer: 'cus_paid_period_proof',
      status: 'active',
      cancel_at_period_end: false,
      created: initialStart,
      current_period_start: start,
      current_period_end: end,
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
      id: 'evt_paid_period_initial_activation',
      type: 'customer.subscription.updated',
      created: initialStart,
      livemode: false,
      api_version: apiVersion,
      data: {
        object: {
          ...subscriptionObject(initialStart, initialEnd),
          metadata: {
            household_id: 'household-sunrise',
            canonical_subscription_id: subscriptionId,
            plan_version_id: 'family_v1',
          },
        },
      },
    });
    expect(activation.statusCode).toBe(200);

    clock.advance(30 * 86_400_000 + 1_000);
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
    const accessAfterStatus = await new EntitlementRepository(database).forHousehold(
      'household-sunrise',
      clock.now(),
    );
    expect(
      accessAfterStatus.portfolio.sources.find((source) => source.subscriptionId === subscriptionId)
        ?.accessState,
    ).toBe('expired');

    const paidInvoice = (id: string, start: number, end: number) => ({
      id,
      object: 'invoice',
      paid: true,
      status: 'paid',
      parent: { subscription_details: { subscription: 'sub_paid_period_proof' } },
      lines: {
        has_more: false,
        data: [
          {
            parent: {
              type: 'subscription_item_details',
              subscription_item_details: {
                subscription: 'sub_paid_period_proof',
                subscription_item: 'si_paid_period_proof',
                proration: false,
              },
            },
            pricing: { price_details: { price: 'price_family_month_fixture' } },
            period: { start, end },
          },
        ],
      },
    });
    vi.mocked(transport.get).mockImplementation(async ({ path }) => {
      if (path === '/v1/invoices/in_paid_period_old') {
        return paidInvoice('in_paid_period_old', initialStart, initialEnd);
      }
      if (path === '/v1/invoices/in_paid_period_renewal') {
        return paidInvoice('in_paid_period_renewal', initialEnd, renewalEnd);
      }
      if (path === '/v1/subscriptions/sub_paid_period_proof') {
        return subscriptionObject(initialEnd, renewalEnd);
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
        data: {
          object: {
            id: invoiceId,
            object: 'invoice',
            parent: { subscription_details: { subscription: 'sub_paid_period_proof' } },
          },
        },
      });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({ application: 'reconciliation_queued' });
      await runReconciliation(database, transport, clock.now);
    };

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
    const accessAfterOldInvoice = await new EntitlementRepository(database).forHousehold(
      'household-sunrise',
      clock.now(),
    );
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
    const accessAfterCurrentInvoice = await new EntitlementRepository(database).forHousehold(
      'household-sunrise',
      clock.now(),
    );
    expect(
      accessAfterCurrentInvoice.portfolio.sources.find(
        (source) => source.subscriptionId === subscriptionId,
      )?.accessState,
    ).toBe('effective');
  });

  it('queues and durably reconciles a large incomplete first subscription event', async () => {
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
      payload: { planVersionId: 'family_v1', billingInterval: 'month' },
    });
    expect(checkout.statusCode).toBe(201);
    const subscriptionId = checkout.json<{ checkout: { canonicalSubscriptionId: string } }>()
      .checkout.canonicalSubscriptionId;
    const periodStart = Math.floor(clock.now().getTime() / 1_000);
    const periodEnd = periodStart + 30 * 86_400;
    vi.mocked(transport.get).mockResolvedValue({
      id: 'sub_reconcile_fixture_1',
      object: 'subscription',
      customer: 'cus_reconcile_fixture_1',
      status: 'active',
      created: periodStart,
      current_period_start: periodStart,
      current_period_end: periodEnd,
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
      lifecycle: 'active',
      reconciliation_state: 'reconciled',
      job_state: 'succeeded',
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

  it('expires an abandoned checkout and permits a fresh server-authorized attempt', async () => {
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
      payload: { planVersionId: 'family_v1', billingInterval: 'month' },
    });
    expect(first.statusCode).toBe(201);
    expect(vi.mocked(transport.postForm).mock.calls[0]?.[0].form).toMatchObject({
      expires_at: String(Math.floor((clock.now().getTime() + 30 * 60_000) / 1_000)),
    });
    clock.advance(31 * 60_000);
    vi.mocked(transport.postForm).mockResolvedValueOnce({
      id: 'cs_test_fixture_replacement',
      url: 'https://checkout.stripe.test/session-replacement',
      expires_at: Math.floor(clock.now().getTime() / 1_000) + 1_800,
    });
    const replacement = await app.inject({
      method: 'POST',
      url: '/v1/commerce/stripe/checkout',
      headers: { ...baseHeaders, 'idempotency-key': 'checkout_abandoned_fixture_0002' },
      payload: { planVersionId: 'family_v1', billingInterval: 'month' },
    });
    expect(replacement.statusCode).toBe(201);
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
      payload: { planVersionId: 'family_v1', billingInterval: 'month' },
    });
    expect(checkout.statusCode).toBe(201);
    const rawBody = JSON.stringify({
      id: 'evt_checkout_expired_fixture',
      type: 'checkout.session.expired',
      created: Math.floor(clock.now().getTime() / 1_000),
      livemode: false,
      api_version: apiVersion,
      data: { object: { id: 'cs_test_fixture_123', object: 'checkout.session' } },
    });
    const response = await app.inject({
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
      payload: { planVersionId: 'family_v1', billingInterval: 'month' },
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
          customer: 'cus_revoked_authority_fixture',
          status: 'active',
          current_period_start: created,
          current_period_end: created + 30 * 86_400,
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

  it('quarantines ambiguous invoices and bounds the allowlisted payment-failure grace', async () => {
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
      payload: { planVersionId: 'family_v1', billingInterval: 'month' },
    });
    const subscriptionId = checkout.json<{ checkout: { canonicalSubscriptionId: string } }>()
      .checkout.canonicalSubscriptionId;
    const created = Math.floor(clock.now().getTime() / 1_000);
    const subscriptionObject = {
      id: 'sub_invoice_policy_fixture',
      object: 'subscription',
      customer: 'cus_invoice_policy_fixture',
      status: 'active',
      created,
      current_period_start: created,
      current_period_end: created + 30 * 86_400,
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
    };
    const activation = JSON.stringify({
      id: 'evt_invoice_policy_activation',
      type: 'customer.subscription.updated',
      created,
      livemode: false,
      api_version: apiVersion,
      data: {
        object: {
          ...subscriptionObject,
          metadata: {
            household_id: 'household-sunrise',
            canonical_subscription_id: subscriptionId,
            plan_version_id: 'family_v1',
          },
        },
      },
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/webhooks/stripe',
          headers: {
            'content-type': 'application/json',
            'stripe-signature': signStripeFixture({
              rawBody: activation,
              endpointSecret,
              timestampSeconds: created,
            }),
          },
          payload: activation,
        })
      ).statusCode,
    ).toBe(200);

    clock.advance(1_000);
    const sendInvoiceEvent = async (id: string, type: string, object: Record<string, unknown>) => {
      const rawBody = JSON.stringify({
        id,
        type,
        created: Math.floor(clock.now().getTime() / 1_000),
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
    );
    expect(ambiguous.statusCode).toBe(202);
    expect(ambiguous.json()).toMatchObject({ application: 'reconciliation_queued' });
    await runReconciliation(database, transport, clock.now);
    expect(transport.get).not.toHaveBeenCalled();
    const held = await database.query<
      { lifecycle: string; status: string; error_code: string } & Record<string, unknown>
    >(
      `SELECT subscription.lifecycle, inbox.status, inbox.error_code
       FROM commerce_subscriptions subscription
       JOIN commerce_event_inbox inbox ON inbox.external_event_id = 'evt_invoice_finalization_failed'
       WHERE subscription.id = $1`,
      [subscriptionId],
    );
    expect(held.rows[0]).toMatchObject({
      lifecycle: 'active',
      status: 'quarantined',
      error_code: 'stripe.invoice_event_not_allowlisted',
    });

    clock.advance(1_000);
    const observedAt = clock.now();
    vi.mocked(transport.get).mockImplementation(async ({ path }) => {
      if (path === '/v1/invoices/in_payment_failed_fixture') {
        return {
          id: 'in_payment_failed_fixture',
          parent: { subscription_details: { subscription: 'sub_invoice_policy_fixture' } },
        };
      }
      if (path === '/v1/subscriptions/sub_invoice_policy_fixture') {
        return { ...subscriptionObject, status: 'past_due', cancel_at_period_end: true };
      }
      return {};
    });
    const paymentFailed = await sendInvoiceEvent(
      'evt_invoice_payment_failed',
      'invoice.payment_failed',
      { id: 'in_payment_failed_fixture', object: 'invoice' },
    );
    expect(paymentFailed.statusCode).toBe(202);
    expect(paymentFailed.json()).toMatchObject({ application: 'reconciliation_queued' });
    await runReconciliation(database, transport, clock.now);
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
      new Date(observedAt.getTime() + 3 * 86_400_000).toISOString(),
    );

    clock.advance(1_000);
    vi.mocked(transport.get).mockImplementation(async ({ path }) => {
      if (path === '/v1/invoices/in_paid_fixture') {
        return {
          id: 'in_paid_fixture',
          paid: true,
          status: 'paid',
          parent: { subscription_details: { subscription: 'sub_invoice_policy_fixture' } },
          lines: {
            has_more: false,
            data: [
              {
                type: 'subscription',
                subscription: 'sub_invoice_policy_fixture',
                subscription_item: 'si_invoice_policy_fixture',
                proration: false,
                price: {
                  id: 'price_family_month_fixture',
                  recurring: { interval: 'month' },
                },
                period: { start: created, end: created + 30 * 86_400 },
              },
            ],
          },
        };
      }
      if (path === '/v1/subscriptions/sub_invoice_policy_fixture') return subscriptionObject;
      return {};
    });
    const paid = await sendInvoiceEvent('evt_invoice_paid', 'invoice.paid', {
      id: 'in_paid_fixture',
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
      payload: { planVersionId: 'family_v1', billingInterval: 'month' },
    });
    const subscriptionId = checkout.json<{ checkout: { canonicalSubscriptionId: string } }>()
      .checkout.canonicalSubscriptionId;
    const created = Math.floor(clock.now().getTime() / 1_000);
    const periodEnd = created + 30 * 86_400;
    const subscriptionObject = {
      id: 'sub_financial_fixture',
      object: 'subscription',
      customer: 'cus_financial_fixture',
      status: 'active',
      created,
      current_period_start: created,
      current_period_end: periodEnd,
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
    };
    const activation = JSON.stringify({
      id: 'evt_financial_activation',
      type: 'customer.subscription.updated',
      created,
      livemode: false,
      api_version: apiVersion,
      data: {
        object: {
          ...subscriptionObject,
          metadata: {
            household_id: 'household-sunrise',
            canonical_subscription_id: subscriptionId,
            plan_version_id: 'family_v1',
          },
        },
      },
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/webhooks/stripe',
          headers: {
            'content-type': 'application/json',
            'stripe-signature': signStripeFixture({
              rawBody: activation,
              endpointSecret,
              timestampSeconds: created,
            }),
          },
          payload: activation,
        })
      ).statusCode,
    ).toBe(200);

    vi.mocked(transport.get).mockImplementation(async ({ path }) => {
      if (path.startsWith('/v1/subscriptions/')) return subscriptionObject;
      if (path === '/v1/charges/ch_full_refund') {
        return {
          id: 'ch_full_refund',
          amount: 1_499,
          amount_refunded: 1_499,
          refunded: true,
          payment_intent: 'pi_financial_fixture',
        };
      }
      if (path === '/v1/charges/ch_partial_refund') {
        return {
          id: 'ch_partial_refund',
          amount: 1_499,
          amount_refunded: 500,
          refunded: false,
          payment_intent: 'pi_financial_fixture',
        };
      }
      if (path === '/v1/charges/ch_dispute_fixture') {
        return { id: 'ch_dispute_fixture', payment_intent: 'pi_financial_fixture' };
      }
      if (path === '/v1/payment_intents/pi_financial_fixture') {
        return { id: 'pi_financial_fixture', invoice: 'in_financial_fixture' };
      }
      if (path === '/v1/invoices/in_financial_fixture') {
        return {
          id: 'in_financial_fixture',
          parent: { subscription_details: { subscription: 'sub_financial_fixture' } },
        };
      }
      if (path === '/v1/disputes/dp_financial_fixture') {
        return { id: 'dp_financial_fixture', charge: 'ch_dispute_fixture' };
      }
      return {};
    });
    const sendFinancialEvent = async (id: string, type: string, objectId: string) => {
      const rawBody = JSON.stringify({
        id,
        type,
        created: Math.floor(clock.now().getTime() / 1_000),
        livemode: false,
        api_version: apiVersion,
        data: {
          object: {
            id: objectId,
            object: type.startsWith('charge.dispute') ? 'dispute' : 'charge',
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
        await sendFinancialEvent('evt_partial_refund', 'charge.refunded', 'ch_partial_refund')
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
    expect(
      (await sendFinancialEvent('evt_full_refund', 'charge.refunded', 'ch_full_refund')).json(),
    ).toMatchObject({ application: 'reconciliation_queued' });
    await runReconciliation(database, transport, clock.now);
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
    expect(state.rows[0]).toMatchObject({ lifecycle: 'disputed', attention: 2 });

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
  });

  it('denies a neutral non-billing member and quarantines a signed foreign binding', async () => {
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
      payload: { planVersionId: 'family_v1', billingInterval: 'year' },
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
    expect(webhook.json()).toMatchObject({ application: 'quarantined' });
  });
});

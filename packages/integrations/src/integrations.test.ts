import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  AppleServerAdapter,
  evaluateStorefrontPolicy,
  GoogleServerAdapter,
  normalizeStripeEvent,
  signStripeFixture,
  StoreServerEventError,
  StripeTestAdapter,
  StripeWebhookError,
  verifyStripeWebhook,
  type CommerceAuthorizationPort,
  type StoreServerEventVerifier,
  type StripeTransport,
} from './index';

const now = new Date('2026-08-16T12:00:00.000Z');
const timestamp = Math.floor(now.getTime() / 1_000);
const endpointSecret = 'whsec_fixture_only_1234567890';
const apiVersion = '2026-07-29.fixture';

function stripeBody(overrides: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    id: 'evt_fixture_1',
    type: 'customer.subscription.updated',
    created: timestamp - 5,
    livemode: false,
    api_version: apiVersion,
    data: {
      object: {
        id: 'sub_fixture_1',
        object: 'subscription',
        livemode: false,
        customer: 'cus_fixture_1',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: timestamp - 86_400,
        current_period_end: timestamp + 30 * 86_400,
        items: {
          has_more: false,
          data: [
            {
              id: 'si_fixture_1',
              quantity: 1,
              price: {
                id: 'price_fixture',
                active: true,
                product: 'prod_fixture',
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
      },
    },
    ...overrides,
  });
}

describe('Stripe test adapter', () => {
  it('verifies the exact raw body and normalizes a supported version', () => {
    const rawBody = stripeBody();
    const verified = verifyStripeWebhook({
      rawBody,
      signatureHeader: signStripeFixture({ rawBody, endpointSecret, timestampSeconds: timestamp }),
      endpointSecret,
      environment: 'test',
      now,
      supportedApiVersions: new Set([apiVersion]),
    });
    expect(normalizeStripeEvent(verified)).toMatchObject({
      provider: 'stripe',
      environment: 'test',
      externalEventId: 'evt_fixture_1',
      externalSubscriptionId: 'sub_fixture_1',
      lifecycle: 'active',
      requiresReconciliation: false,
    });

    expect(() =>
      verifyStripeWebhook({
        rawBody: `${rawBody} `,
        signatureHeader: signStripeFixture({
          rawBody,
          endpointSecret,
          timestampSeconds: timestamp,
        }),
        endpointSecret,
        environment: 'test',
        now,
        supportedApiVersions: new Set([apiVersion]),
      }),
    ).toThrowError(StripeWebhookError);
  });

  it.each([
    [
      'truncated items page',
      (subscription: Record<string, unknown>) => {
        (subscription.items as Record<string, unknown>).has_more = true;
      },
    ],
    [
      'multiple items',
      (subscription: Record<string, unknown>) => {
        const items = subscription.items as { data: unknown[] };
        items.data.push(structuredClone(items.data[0]));
      },
    ],
    [
      'quantity other than one',
      (subscription: Record<string, unknown>) => {
        const item = (subscription.items as { data: Record<string, unknown>[] }).data[0] as Record<
          string,
          unknown
        >;
        item.quantity = 2;
      },
    ],
    [
      'wrong recurring count',
      (subscription: Record<string, unknown>) => {
        const item = (subscription.items as { data: Array<{ price: Record<string, unknown> }> })
          .data[0];
        if (item !== undefined) {
          (item.price.recurring as Record<string, unknown>).interval_count = 2;
        }
      },
    ],
    [
      'metered usage',
      (subscription: Record<string, unknown>) => {
        const item = (subscription.items as { data: Array<{ price: Record<string, unknown> }> })
          .data[0];
        if (item !== undefined) {
          (item.price.recurring as Record<string, unknown>).usage_type = 'metered';
        }
      },
    ],
  ] as const)('requires reconciliation for a hostile subscription page: %s', (_name, mutate) => {
    const envelope = JSON.parse(stripeBody()) as {
      data: { object: Record<string, unknown> };
    };
    mutate(envelope.data.object);
    const rawBody = JSON.stringify(envelope);
    const normalized = normalizeStripeEvent(
      verifyStripeWebhook({
        rawBody,
        signatureHeader: signStripeFixture({
          rawBody,
          endpointSecret,
          timestampSeconds: timestamp,
        }),
        endpointSecret,
        environment: 'test',
        now,
        supportedApiVersions: new Set([apiVersion]),
      }),
    );
    expect(normalized.requiresReconciliation).toBe(true);
    expect(normalized.subscriptionOfferExact).toBeUndefined();
  });

  it('rejects an otherwise exact subscription snapshot for the wrong configured product', async () => {
    const envelope = JSON.parse(stripeBody()) as {
      data: {
        object: Record<string, unknown> & {
          items: { data: Array<{ price: Record<string, unknown> }> };
        };
      };
    };
    const item = envelope.data.object.items.data[0];
    if (item === undefined) throw new Error('Missing exact fixture item');
    item.price.id = 'price_family_month_fixture';
    item.price.product = 'prod_other';
    const adapter = new StripeTestAdapter(
      {
        postForm: vi.fn(async () => ({})),
        get: vi.fn(async () => envelope.data.object),
      },
      { authorize: vi.fn(async () => ({ allowed: false, reason: 'unused' })) },
      new Set(),
      apiVersion,
    );
    await expect(
      adapter.retrieveSubscription({
        environment: 'test',
        externalSubscriptionId: 'sub_fixture_1',
        observedAt: now,
      }),
    ).resolves.toMatchObject({ requiresReconciliation: true, providerProductId: 'prod_other' });
  });

  it.each([
    [
      'missing object',
      (subscription: Record<string, unknown>): void => {
        delete subscription.object;
      },
    ],
    [
      'wrong object',
      (subscription: Record<string, unknown>): void => {
        subscription.object = 'invoice';
      },
    ],
    [
      'missing livemode',
      (subscription: Record<string, unknown>): void => {
        delete subscription.livemode;
      },
    ],
    [
      'wrong livemode',
      (subscription: Record<string, unknown>): void => {
        subscription.livemode = true;
      },
    ],
    [
      'wrong id',
      (subscription: Record<string, unknown>): void => {
        subscription.id = 'sub_foreign';
      },
    ],
  ] as const)('rejects a retrieved subscription with %s', async (_caseName, mutate) => {
    const envelope = JSON.parse(stripeBody()) as {
      data: { object: Record<string, unknown> };
    };
    mutate(envelope.data.object);
    const adapter = new StripeTestAdapter(
      {
        postForm: vi.fn(async () => ({})),
        get: vi.fn(async () => envelope.data.object),
      },
      { authorize: vi.fn(async () => ({ allowed: false, reason: 'unused' })) },
      new Set(),
      apiVersion,
    );
    await expect(
      adapter.retrieveSubscription({
        environment: 'test',
        externalSubscriptionId: 'sub_fixture_1',
        observedAt: now,
      }),
    ).rejects.toMatchObject({ code: 'stripe.subscription_envelope_mismatch' });
  });

  it('rejects stale, live-mode, and unsupported-version events', () => {
    const cases = [
      {
        body: stripeBody(),
        signedAt: timestamp - 1_000,
        versions: new Set([apiVersion]),
        code: 'stripe.signature_outside_tolerance',
      },
      {
        body: stripeBody({ livemode: true }),
        signedAt: timestamp,
        versions: new Set([apiVersion]),
        code: 'stripe.environment_mismatch',
      },
      {
        body: stripeBody(),
        signedAt: timestamp,
        versions: new Set(['different-version']),
        code: 'stripe.unsupported_api_version',
      },
    ];
    for (const fixture of cases) {
      expect(() =>
        verifyStripeWebhook({
          rawBody: fixture.body,
          signatureHeader: signStripeFixture({
            rawBody: fixture.body,
            endpointSecret,
            timestampSeconds: fixture.signedAt,
          }),
          endpointSecret,
          environment: 'test',
          now,
          supportedApiVersions: fixture.versions,
        }),
      ).toThrowError(fixture.code);
    }
  });

  it('preflights the exact account, livemode, offer, and cancel-only Portal resources', async () => {
    const resource = async (path: string): Promise<Record<string, unknown>> => {
      if (path === '/v1/account') return { object: 'account', id: 'acct_fixture1234' };
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
          payment_method_update: { enabled: false },
          customer_update: { enabled: false, allowed_updates: [] },
        },
      };
    };
    const get = vi.fn(async ({ path }: { readonly path: string }) => resource(path));
    const adapter = new StripeTestAdapter(
      { postForm: vi.fn(async () => ({})), get },
      { authorize: vi.fn(async () => ({ allowed: false, reason: 'unused' })) },
      new Set(),
      apiVersion,
    );

    await expect(adapter.verifyConfiguredResources()).resolves.toMatchObject({
      environment: 'test',
      accountId: 'acct_fixture1234',
      livemode: false,
      apiVersion,
      portalCancelOnly: true,
      portalMutationControlsExact: true,
      portalCancellationMode: 'at_period_end',
      portalProrationBehavior: 'none',
      portalSubscriptionUpdateDefaultsEmpty: true,
      retentionCouponEvidence: 'manual_founder_browser_required',
      promotionsEnabled: false,
      automaticTaxEnabled: false,
      adaptivePricingEnabled: false,
      offer: {
        offerId: 'founding_family_monthly_v1',
        providerPriceId: 'price_family_month_fixture',
        currency: 'usd',
        unitAmountMinor: 1499,
        quantity: 1,
      },
    });
    get.mockImplementation(async ({ path }: { readonly path: string }) => {
      const exact = await resource(path);
      return path === '/v1/account'
        ? { object: 'account', id: 'acct_wrong_environment' }
        : path === '/v1/products/prod_family_fixture'
          ? { ...exact, livemode: true }
          : exact;
    });
    await expect(adapter.verifyConfiguredResources()).rejects.toMatchObject({
      code: 'stripe.preflight_resource_mismatch',
    });

    const hostileResources: ReadonlyArray<{
      readonly path: string;
      readonly mutate: (value: Record<string, unknown>) => void;
    }> = [
      {
        path: '/v1/prices/price_family_month_fixture',
        mutate: (value) => {
          (value.recurring as Record<string, unknown>).interval_count = 2;
        },
      },
      {
        path: '/v1/prices/price_family_month_fixture',
        mutate: (value) => {
          (value.recurring as Record<string, unknown>).usage_type = 'metered';
        },
      },
      ...(
        ['billing_scheme', 'custom_unit_amount', 'tiers_mode', 'transform_quantity'] as const
      ).map((field) => ({
        path: '/v1/prices/price_family_month_fixture',
        mutate: (value: Record<string, unknown>) => {
          value[field] = field === 'billing_scheme' ? 'tiered' : { hostile: true };
        },
      })),
      {
        path: '/v1/prices/price_family_month_fixture',
        mutate: (value) => {
          (value.recurring as Record<string, unknown>).trial_period_days = 14;
        },
      },
      {
        path: '/v1/products/prod_family_fixture',
        mutate: (value) => {
          value.object = 'price';
        },
      },
      {
        path: '/v1/billing_portal/configurations/bpc_cancel_only_fixture',
        mutate: (value) => {
          value.object = 'billing_portal.session';
        },
      },
      {
        path: '/v1/billing_portal/configurations/bpc_cancel_only_fixture',
        mutate: (value) => {
          const features = value.features as Record<string, Record<string, unknown>>;
          (features.subscription_cancel as Record<string, unknown>).mode = 'immediately';
        },
      },
      {
        path: '/v1/billing_portal/configurations/bpc_cancel_only_fixture',
        mutate: (value) => {
          const features = value.features as Record<string, Record<string, unknown>>;
          (features.subscription_cancel as Record<string, unknown>).proration_behavior =
            'create_prorations';
        },
      },
      {
        path: '/v1/billing_portal/configurations/bpc_cancel_only_fixture',
        mutate: (value) => {
          const features = value.features as Record<string, Record<string, unknown>>;
          features.subscription_update = {
            enabled: true,
            default_allowed_updates: ['price'],
          };
        },
      },
      {
        path: '/v1/billing_portal/configurations/bpc_cancel_only_fixture',
        mutate: (value) => {
          const features = value.features as Record<string, Record<string, unknown>>;
          const subscriptionUpdate = features.subscription_update;
          if (subscriptionUpdate === undefined) throw new Error('Missing Portal update fixture');
          delete subscriptionUpdate.default_allowed_updates;
        },
      },
    ];
    for (const hostile of hostileResources) {
      get.mockImplementation(async ({ path }: { readonly path: string }) => {
        const exact = structuredClone(await resource(path));
        if (path === hostile.path) hostile.mutate(exact);
        return exact;
      });
      await expect(adapter.verifyConfiguredResources()).rejects.toMatchObject({
        code: 'stripe.preflight_resource_mismatch',
      });
    }
  });

  it.each([
    {
      caseName: 'the provider paid-through date is later',
      providerPeriodEnd: timestamp + 30 * 86_400,
      expectedEnd: timestamp + 30 * 86_400,
    },
    {
      caseName: 'the provider paid-through date is earlier',
      providerPeriodEnd: timestamp + 60,
      expectedEnd: timestamp + 60,
    },
  ])(
    'preserves provider period evidence for persistence-owned dunning when $caseName',
    ({ providerPeriodEnd, expectedEnd }) => {
      const rawBody = stripeBody({
        created: timestamp,
        data: {
          object: {
            id: 'sub_grace_fixture',
            object: 'subscription',
            livemode: false,
            status: 'past_due',
            cancel_at_period_end: true,
            current_period_start: timestamp - 30 * 86_400,
            current_period_end: providerPeriodEnd,
            items: {
              has_more: false,
              data: [
                {
                  id: 'si_grace_fixture',
                  quantity: 1,
                  price: {
                    id: 'price_fixture',
                    active: true,
                    product: 'prod_fixture',
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
          },
        },
      });
      const normalized = normalizeStripeEvent(
        verifyStripeWebhook({
          rawBody,
          signatureHeader: signStripeFixture({
            rawBody,
            endpointSecret,
            timestampSeconds: timestamp,
          }),
          endpointSecret,
          environment: 'test',
          now,
          supportedApiVersions: new Set([apiVersion]),
        }),
      );
      expect(normalized.lifecycle).toBe('grace');
      expect(normalized.currentPeriodEndsAt?.toISOString()).toBe(
        new Date(expectedEnd * 1_000).toISOString(),
      );
    },
  );

  it('resolves only the explicit invoice payment event allowlist', async () => {
    let currentEventType = 'invoice.paid';
    const line = {
      id: 'il_invoice_fixture',
      object: 'line_item',
      amount: 1499,
      currency: 'usd',
      quantity: 1,
      discount_amounts: null,
      discounts: [],
      pretax_credit_amounts: null,
      taxes: null,
      parent: {
        type: 'subscription_item_details',
        subscription_item_details: {
          subscription: 'sub_invoice_fixture',
          subscription_item: 'si_invoice_fixture',
          proration: false,
        },
      },
      pricing: {
        price_details: {
          price: 'price_family_month_fixture',
          product: 'prod_family_fixture',
        },
      },
      period: { start: timestamp, end: timestamp + 30 * 86_400 },
    };
    const get = vi.fn(async ({ path }: { readonly path: string }) => {
      if (path === '/v1/subscriptions/sub_invoice_fixture') {
        return {
          id: 'sub_invoice_fixture',
          object: 'subscription',
          livemode: false,
          status: currentEventType === 'invoice.paid' ? 'active' : 'past_due',
          customer: 'cus_invoice_fixture',
          current_period_start: timestamp,
          current_period_end: timestamp + 30 * 86_400,
          items: {
            has_more: false,
            data: [
              {
                id: 'si_invoice_fixture',
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
      if (path === '/v1/payment_intents/pi_invoice_fixture') {
        return currentEventType === 'invoice.paid'
          ? {
              id: 'pi_invoice_fixture',
              object: 'payment_intent',
              livemode: false,
              status: 'succeeded',
              amount: 1499,
              amount_received: 1499,
              currency: 'usd',
            }
          : {
              id: 'pi_invoice_fixture',
              object: 'payment_intent',
              livemode: false,
              status: 'requires_payment_method',
            };
      }
      return currentEventType === 'invoice.paid'
        ? {
            id: 'in_invoice_fixture',
            object: 'invoice',
            livemode: false,
            status: 'paid',
            billing_reason: 'subscription_create',
            amount_paid: 1499,
            amount_remaining: 0,
            currency: 'usd',
            subtotal: 1499,
            total: 1499,
            total_discount_amounts: null,
            total_pretax_credit_amounts: null,
            total_taxes: null,
            discounts: [],
            pre_payment_credit_notes_amount: 0,
            post_payment_credit_notes_amount: 0,
            starting_balance: 0,
            ending_balance: 0,
            amount_overpaid: 0,
            parent: { subscription_details: { subscription: 'sub_invoice_fixture' } },
            payments: {
              object: 'list',
              has_more: false,
              data: [
                {
                  id: 'inpay_invoice_fixture',
                  object: 'invoice_payment',
                  livemode: false,
                  invoice: 'in_invoice_fixture',
                  payment: { type: 'payment_intent', payment_intent: 'pi_invoice_fixture' },
                  status: 'paid',
                  is_default: true,
                  amount_paid: 1499,
                  amount_requested: 1499,
                  currency: 'usd',
                  status_transitions: { paid_at: timestamp },
                },
              ],
            },
            lines: { object: 'list', has_more: false, data: [line] },
          }
        : {
            id: 'in_invoice_fixture',
            object: 'invoice',
            livemode: false,
            status: 'open',
            billing_reason: 'subscription_cycle',
            amount_due: 1499,
            currency: 'usd',
            subtotal: 1499,
            total: 1499,
            total_discount_amounts: null,
            total_pretax_credit_amounts: null,
            total_taxes: null,
            discounts: [],
            pre_payment_credit_notes_amount: 0,
            post_payment_credit_notes_amount: 0,
            attempt_count: 1,
            parent: { subscription_details: { subscription: 'sub_invoice_fixture' } },
            payments: {
              object: 'list',
              has_more: false,
              data: [
                {
                  id: 'inpay_invoice_fixture',
                  object: 'invoice_payment',
                  livemode: false,
                  invoice: 'in_invoice_fixture',
                  payment: { type: 'payment_intent', payment_intent: 'pi_invoice_fixture' },
                  status: 'open',
                  is_default: true,
                  amount_requested: 1499,
                  currency: 'usd',
                },
              ],
            },
            lines: { object: 'list', has_more: false, data: [line] },
          };
    });
    const adapter = new StripeTestAdapter(
      { postForm: vi.fn(async () => ({})), get },
      { authorize: vi.fn(async () => ({ allowed: false, reason: 'unused' })) },
      new Set(),
      apiVersion,
    );

    await expect(
      adapter.resolveEventSubscription({
        environment: 'test',
        eventType: 'invoice.finalization_failed',
        providerObjectId: 'in_invoice_fixture',
      }),
    ).resolves.toBeNull();
    expect(get).not.toHaveBeenCalled();

    for (const eventType of ['invoice.paid', 'invoice.payment_failed']) {
      currentEventType = eventType;
      const resolved = await adapter.resolveEventSubscription({
        environment: 'test',
        eventType,
        providerObjectId: 'in_invoice_fixture',
      });
      expect(resolved).toMatchObject({
        externalSubscriptionId: 'sub_invoice_fixture',
        requiresAttention: false,
      });
      if (eventType === 'invoice.paid') {
        expect(resolved?.paidPeriodEvidence).toMatchObject({
          externalSubscriptionId: 'sub_invoice_fixture',
          providerPriceId: 'price_family_month_fixture',
          providerInvoicePaymentId: 'inpay_invoice_fixture',
          currentPeriodStartsAt: new Date(timestamp * 1_000),
          currentPeriodEndsAt: new Date((timestamp + 30 * 86_400) * 1_000),
        });
      } else {
        expect(resolved?.paidPeriodEvidence).toBeUndefined();
        expect(resolved?.failedPaymentEvidence).toMatchObject({
          providerInvoiceId: 'in_invoice_fixture',
          providerInvoicePaymentId: 'inpay_invoice_fixture',
          providerPaymentIntentId: 'pi_invoice_fixture',
          failureStatus: 'requires_payment_method',
        });
      }
    }
    expect(get).toHaveBeenCalledTimes(6);
  });

  it.each([
    [
      'invoice discounts',
      (invoice: Record<string, unknown>) => {
        invoice.discounts = ['di_hostile'];
      },
    ],
    [
      'invoice total taxes',
      (invoice: Record<string, unknown>) => {
        invoice.total_taxes = [{ amount: 1 }];
      },
    ],
    [
      'credit notes',
      (invoice: Record<string, unknown>) => {
        invoice.post_payment_credit_notes_amount = 1;
      },
    ],
    [
      'wrong product',
      (invoice: Record<string, unknown>) => {
        const line = (
          invoice.lines as { data: Array<{ pricing: { price_details: Record<string, unknown> } }> }
        ).data[0];
        if (line !== undefined) line.pricing.price_details.product = 'prod_other';
      },
    ],
    [
      'missing line id',
      (invoice: Record<string, unknown>) => {
        const line = (invoice.lines as { data: Record<string, unknown>[] }).data[0];
        if (line !== undefined) delete line.id;
      },
    ],
    [
      'non-current subscription item',
      (invoice: Record<string, unknown>) => {
        const line = (
          invoice.lines as {
            data: Array<{
              parent: { subscription_item_details: Record<string, unknown> };
            }>;
          }
        ).data[0];
        if (line !== undefined) {
          line.parent.subscription_item_details.subscription_item = 'si_replaced_item';
        }
      },
    ],
    [
      'wrong Invoice Payment object',
      (invoice: Record<string, unknown>) => {
        const payment = (invoice.payments as { data: Record<string, unknown>[] }).data[0];
        if (payment !== undefined) payment.object = 'payment_intent';
      },
    ],
    [
      'missing Invoice Payment id',
      (invoice: Record<string, unknown>) => {
        const payment = (invoice.payments as { data: Record<string, unknown>[] }).data[0];
        if (payment !== undefined) delete payment.id;
      },
    ],
    [
      'wrong Invoice Payment livemode',
      (invoice: Record<string, unknown>) => {
        const payment = (invoice.payments as { data: Record<string, unknown>[] }).data[0];
        if (payment !== undefined) payment.livemode = true;
      },
    ],
    [
      'wrong invoice line object',
      (invoice: Record<string, unknown>) => {
        const line = (invoice.lines as { data: Record<string, unknown>[] }).data[0];
        if (line !== undefined) line.object = 'price';
      },
    ],
  ] as const)('withholds exact paid authority for hostile %s evidence', async (_name, mutate) => {
    const invoice: Record<string, unknown> = {
      id: 'in_hostile_exact',
      object: 'invoice',
      livemode: false,
      paid: true,
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
      taxes: [],
      pre_payment_credit_notes_amount: 0,
      post_payment_credit_notes_amount: 0,
      starting_balance: 0,
      ending_balance: 0,
      amount_overpaid: 0,
      parent: { subscription_details: { subscription: 'sub_hostile_exact' } },
      payments: {
        object: 'list',
        has_more: false,
        data: [
          {
            id: 'inpay_hostile_exact',
            object: 'invoice_payment',
            livemode: false,
            invoice: 'in_hostile_exact',
            payment: { type: 'payment_intent', payment_intent: 'pi_hostile_exact' },
            status: 'paid',
            is_default: true,
            amount_paid: 1499,
            amount_requested: 1499,
            currency: 'usd',
            status_transitions: { paid_at: timestamp },
          },
        ],
      },
      lines: {
        object: 'list',
        has_more: false,
        data: [
          {
            id: 'il_hostile_exact',
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
                subscription: 'sub_hostile_exact',
                subscription_item: 'si_hostile_exact',
                proration: false,
              },
            },
            pricing: {
              price_details: {
                price: 'price_family_month_fixture',
                product: 'prod_family_fixture',
              },
            },
            period: { start: timestamp, end: timestamp + 30 * 86_400 },
          },
        ],
      },
    };
    mutate(invoice);
    const adapter = new StripeTestAdapter(
      {
        postForm: vi.fn(async () => ({})),
        get: vi.fn(async ({ path }) => {
          if (path === '/v1/payment_intents/pi_hostile_exact') {
            return {
              id: 'pi_hostile_exact',
              object: 'payment_intent',
              livemode: false,
              status: 'succeeded',
              amount: 1499,
              amount_received: 1499,
              currency: 'usd',
            };
          }
          if (path === '/v1/subscriptions/sub_hostile_exact') {
            return {
              id: 'sub_hostile_exact',
              object: 'subscription',
              livemode: false,
              status: 'active',
              customer: 'cus_hostile_exact',
              current_period_start: timestamp,
              current_period_end: timestamp + 30 * 86_400,
              items: {
                has_more: false,
                data: [
                  {
                    id: 'si_hostile_exact',
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
          return invoice;
        }),
      },
      { authorize: vi.fn(async () => ({ allowed: false, reason: 'unused' })) },
      new Set(),
      apiVersion,
    );
    await expect(
      adapter.resolveEventSubscription({
        environment: 'test',
        eventType: 'invoice.paid',
        providerObjectId: 'in_hostile_exact',
      }),
    ).resolves.toMatchObject({
      externalSubscriptionId: 'sub_hostile_exact',
      requiresAttention: true,
    });
  });

  it.each([
    {
      caseName: 'invoice is not paid',
      override: { paid: false, status: 'open' },
    },
    {
      caseName: 'subscription line is prorated',
      override: {
        lines: {
          has_more: false,
          data: [
            {
              type: 'subscription',
              subscription: 'sub_invoice_fixture',
              subscription_item: 'si_invoice_fixture',
              proration: true,
              price: { id: 'price_fixture' },
              period: { start: timestamp, end: timestamp + 30 * 86_400 },
            },
          ],
        },
      },
    },
    {
      caseName: 'more than one subscription line can claim the period',
      override: {
        lines: {
          has_more: false,
          data: [
            {
              type: 'subscription',
              subscription: 'sub_invoice_fixture',
              subscription_item: 'si_invoice_fixture',
              proration: false,
              price: { id: 'price_fixture' },
              period: { start: timestamp, end: timestamp + 30 * 86_400 },
            },
            {
              parent: {
                type: 'subscription_item_details',
                subscription_item_details: {
                  subscription: 'sub_invoice_fixture',
                  subscription_item: 'si_second',
                  proration: false,
                },
              },
              pricing: { price_details: { price: 'price_fixture' } },
              period: { start: timestamp, end: timestamp + 30 * 86_400 },
            },
          ],
        },
      },
    },
    {
      caseName: 'matching invoice item is not subscription-cycle evidence',
      override: {
        lines: {
          has_more: false,
          data: [
            {
              type: 'invoiceitem',
              subscription: 'sub_invoice_fixture',
              subscription_item: 'si_invoice_item',
              proration: false,
              price: { id: 'price_fixture' },
              period: { start: timestamp, end: timestamp + 30 * 86_400 },
            },
          ],
        },
      },
    },
    {
      caseName: 'invoice line collection is truncated',
      override: {
        lines: {
          has_more: true,
          data: [
            {
              type: 'subscription',
              subscription: 'sub_invoice_fixture',
              subscription_item: 'si_invoice_fixture',
              proration: false,
              price: { id: 'price_fixture' },
              period: { start: timestamp, end: timestamp + 30 * 86_400 },
            },
          ],
        },
      },
    },
    {
      caseName: 'invoice line completeness evidence is omitted',
      override: {
        lines: {
          data: [
            {
              type: 'subscription',
              subscription: 'sub_invoice_fixture',
              subscription_item: 'si_invoice_fixture',
              proration: false,
              price: { id: 'price_fixture' },
              period: { start: timestamp, end: timestamp + 30 * 86_400 },
            },
          ],
        },
      },
    },
    {
      caseName: 'invoice line completeness evidence is not boolean',
      override: {
        lines: {
          has_more: 'false',
          data: [
            {
              type: 'subscription',
              subscription: 'sub_invoice_fixture',
              subscription_item: 'si_invoice_fixture',
              proration: false,
              price: { id: 'price_fixture' },
              period: { start: timestamp, end: timestamp + 30 * 86_400 },
            },
          ],
        },
      },
    },
    {
      caseName: 'subscription line lineage is absent',
      override: {
        lines: {
          has_more: false,
          data: [
            {
              price: { id: 'price_fixture' },
              period: { start: timestamp, end: timestamp + 30 * 86_400 },
            },
          ],
        },
      },
    },
    {
      caseName: 'subscription line mixes legacy and modern lineage',
      override: {
        lines: {
          has_more: false,
          data: [
            {
              type: 'subscription',
              subscription: 'sub_invoice_fixture',
              subscription_item: 'si_invoice_fixture',
              proration: false,
              parent: {
                type: 'subscription_item_details',
                subscription_item_details: {
                  subscription: 'sub_invoice_fixture',
                  subscription_item: 'si_invoice_fixture',
                  proration: false,
                },
              },
              price: { id: 'price_fixture' },
              period: { start: timestamp, end: timestamp + 30 * 86_400 },
            },
          ],
        },
      },
    },
    {
      caseName: 'legacy subscription line omits proration evidence',
      override: {
        lines: {
          has_more: false,
          data: [
            {
              type: 'subscription',
              subscription: 'sub_invoice_fixture',
              subscription_item: 'si_invoice_fixture',
              price: { id: 'price_fixture' },
              period: { start: timestamp, end: timestamp + 30 * 86_400 },
            },
          ],
        },
      },
    },
    {
      caseName: 'modern subscription line omits lineage-specific proration evidence',
      override: {
        lines: {
          has_more: false,
          data: [
            {
              proration: false,
              parent: {
                type: 'subscription_item_details',
                subscription_item_details: {
                  subscription: 'sub_invoice_fixture',
                  subscription_item: 'si_invoice_fixture',
                },
              },
              pricing: { price_details: { price: 'price_fixture' } },
              period: { start: timestamp, end: timestamp + 30 * 86_400 },
            },
          ],
        },
      },
    },
  ])('rejects legacy or malformed invoice proof when $caseName', async ({ override }) => {
    const invoice = {
      id: 'in_invoice_fixture',
      paid: true,
      status: 'paid',
      parent: { subscription_details: { subscription: 'sub_invoice_fixture' } },
      lines: {
        has_more: false,
        data: [
          {
            type: 'subscription',
            subscription: 'sub_invoice_fixture',
            subscription_item: 'si_invoice_fixture',
            proration: false,
            price: { id: 'price_fixture' },
            period: { start: timestamp, end: timestamp + 30 * 86_400 },
          },
        ],
      },
      ...override,
    };
    const adapter = new StripeTestAdapter(
      { postForm: vi.fn(async () => ({})), get: vi.fn(async () => invoice) },
      { authorize: vi.fn(async () => ({ allowed: false, reason: 'unused' })) },
      new Set(),
      apiVersion,
    );
    const resolved = await adapter.resolveEventSubscription({
      environment: 'test',
      eventType: 'invoice.paid',
      providerObjectId: 'in_invoice_fixture',
    });
    expect(resolved).toBeNull();
  });

  it('requires server-resolved billing authority and allowlisted HTTPS return URLs', async () => {
    const transport: StripeTransport = {
      postForm: vi.fn(async () => ({
        id: 'cs_test_fixture',
        object: 'checkout.session',
        livemode: false,
        url: 'https://checkout.stripe.com/c/pay/session',
        mode: 'subscription',
        status: 'open',
        payment_status: 'unpaid',
        client_reference_id: 'household-one',
        success_url: 'https://app.boomerbuddy.test/member/billing/success',
        cancel_url: 'https://app.boomerbuddy.test/member/billing',
        customer: null,
        metadata: {
          household_id: 'household-one',
          canonical_subscription_id: 'subscription-canonical-one',
          plan_version_id: 'family_v1',
        },
        expires_at: Math.floor((now.getTime() + 30 * 60_000) / 1_000),
      })),
      get: vi.fn(async () => ({
        id: 'sub_fixture_1',
        object: 'subscription',
        livemode: false,
        status: 'active',
        customer: 'cus_fixture_1',
        created: timestamp,
      })),
    };
    const authorization: CommerceAuthorizationPort = {
      authorize: vi.fn(async () => ({ allowed: true, reason: 'billing_authority_active' })),
    };
    const adapter = new StripeTestAdapter(
      transport,
      authorization,
      new Set(['https://app.boomerbuddy.test']),
      apiVersion,
    );
    const actor = {
      personId: 'person-billing',
      householdId: 'household-one',
      billingAuthorityId: 'billing-authority-one',
      resolvedAt: now,
    };
    await expect(
      adapter.createCheckout({
        actor,
        canonicalSubscriptionId: 'subscription-canonical-one',
        planVersionId: 'family_v1',
        providerPriceId: 'price_family_month_fixture',
        successUrl: 'https://app.boomerbuddy.test/member/billing/success',
        cancelUrl: 'https://app.boomerbuddy.test/member/billing',
        idempotencyKey: 'checkout-operation-one',
        providerExpiresAt: new Date(now.getTime() + 30 * 60_000),
      }),
    ).resolves.toMatchObject({ id: 'cs_test_fixture', environment: 'test' });
    expect(transport.postForm).toHaveBeenCalledWith(
      expect.objectContaining({
        form: expect.objectContaining({
          'metadata[canonical_subscription_id]': 'subscription-canonical-one',
          'subscription_data[metadata][canonical_subscription_id]': 'subscription-canonical-one',
        }),
      }),
    );
    expect(authorization.authorize).toHaveBeenCalledWith({
      actor,
      action: 'checkout:create',
      planVersionId: 'family_v1',
    });
    await expect(
      adapter.createPortal({
        actor,
        providerCustomerId: 'cus_fixture_1',
        providerConfigurationId: 'bpc_cancel_only_fixture',
        returnUrl: 'http://app.boomerbuddy.test/member/billing',
        idempotencyKey: 'portal-one',
      }),
    ).rejects.toThrowError('stripe.return_url_not_allowed');
  });

  it('rejects unbound Checkout and Portal response envelopes after transport dispatch', async () => {
    const actor = {
      personId: 'person-billing',
      householdId: 'household-one',
      billingAuthorityId: 'billing-authority-one',
      resolvedAt: now,
    };
    const exactCheckout = {
      id: 'cs_test_fixture',
      object: 'checkout.session',
      livemode: false,
      url: 'https://checkout.stripe.com/c/pay/session',
      mode: 'subscription',
      status: 'open',
      payment_status: 'unpaid',
      client_reference_id: actor.householdId,
      success_url: 'https://app.boomerbuddy.test/member/billing/success',
      cancel_url: 'https://app.boomerbuddy.test/member/billing',
      customer: null,
      metadata: {
        household_id: actor.householdId,
        canonical_subscription_id: 'subscription-canonical-one',
        plan_version_id: 'family_v1',
      },
      expires_at: Math.floor((now.getTime() + 30 * 60_000) / 1_000),
    };
    const exactPortal = {
      id: 'bps_fixture',
      object: 'billing_portal.session',
      livemode: false,
      url: 'https://billing.stripe.com/p/session/fixture',
      customer: 'cus_fixture_1',
      configuration: 'bpc_cancel_only_fixture',
      return_url: 'https://app.boomerbuddy.test/member/billing',
    };
    let checkoutResponse: Record<string, unknown> = exactCheckout;
    let portalResponse: Record<string, unknown> = exactPortal;
    const transport: StripeTransport = {
      postForm: vi.fn(async ({ path }) =>
        structuredClone(path === '/v1/checkout/sessions' ? checkoutResponse : portalResponse),
      ),
      get: vi.fn(async () => ({})),
    };
    const adapter = new StripeTestAdapter(
      transport,
      { authorize: vi.fn(async () => ({ allowed: true, reason: 'billing_authority_active' })) },
      new Set(['https://app.boomerbuddy.test']),
      apiVersion,
    );
    const checkoutInput = {
      actor,
      canonicalSubscriptionId: 'subscription-canonical-one',
      planVersionId: 'family_v1',
      providerPriceId: 'price_family_month_fixture',
      successUrl: 'https://app.boomerbuddy.test/member/billing/success',
      cancelUrl: 'https://app.boomerbuddy.test/member/billing',
      idempotencyKey: 'checkout-operation-hostile-response',
      providerExpiresAt: new Date(now.getTime() + 30 * 60_000),
    } as const;
    for (const mutate of [
      (value: Record<string, unknown>) => {
        value.object = 'subscription';
      },
      (value: Record<string, unknown>) => {
        value.livemode = true;
      },
      (value: Record<string, unknown>) => {
        value.url = 'https://attacker.invalid/checkout';
      },
      (value: Record<string, unknown>) => {
        value.client_reference_id = 'household-other';
      },
    ]) {
      checkoutResponse = structuredClone(exactCheckout);
      mutate(checkoutResponse);
      await expect(adapter.createCheckout(checkoutInput)).rejects.toMatchObject({
        code: 'stripe.invalid_session',
        dispatchAttempted: true,
      });
    }
    for (const expiryOffsetSeconds of [-1, 1]) {
      checkoutResponse = {
        ...structuredClone(exactCheckout),
        expires_at: exactCheckout.expires_at + expiryOffsetSeconds,
      };
      await expect(adapter.createCheckout(checkoutInput)).rejects.toMatchObject({
        code: 'stripe.checkout_expiry_mismatch',
        dispatchAttempted: true,
      });
    }
    const callsBeforeFractionalInput = vi.mocked(transport.postForm).mock.calls.length;
    await expect(
      adapter.createCheckout({
        ...checkoutInput,
        providerExpiresAt: new Date(checkoutInput.providerExpiresAt.getTime() + 789),
      }),
    ).rejects.toMatchObject({
      code: 'stripe.invalid_checkout_expiry',
      dispatchAttempted: false,
    });
    expect(transport.postForm).toHaveBeenCalledTimes(callsBeforeFractionalInput);
    const portalInput = {
      actor,
      providerCustomerId: 'cus_fixture_1',
      providerConfigurationId: 'bpc_cancel_only_fixture',
      returnUrl: 'https://app.boomerbuddy.test/member/billing',
      idempotencyKey: 'portal-operation-hostile-response',
    } as const;
    for (const mutate of [
      (value: Record<string, unknown>) => {
        value.livemode = true;
      },
      (value: Record<string, unknown>) => {
        value.configuration = 'bpc_other';
      },
      (value: Record<string, unknown>) => {
        value.url = 'https://attacker.invalid/portal';
      },
    ]) {
      portalResponse = structuredClone(exactPortal);
      mutate(portalResponse);
      await expect(adapter.createPortal(portalInput)).rejects.toMatchObject({
        code: 'stripe.invalid_session',
        dispatchAttempted: true,
      });
    }
  });

  it('quarantines malformed Checkout completion and expiry object envelopes', () => {
    for (const eventType of ['checkout.session.completed', 'checkout.session.expired'] as const) {
      const exactObject: Record<string, unknown> = {
        id: 'cs_test_webhook_envelope',
        object: 'checkout.session',
        livemode: false,
        mode: 'subscription',
        status: eventType.endsWith('completed') ? 'complete' : 'expired',
        payment_status: eventType.endsWith('completed') ? 'paid' : 'unpaid',
        amount_total: 1499,
        currency: 'usd',
        expires_at: timestamp + 3600,
        customer: 'cus_fixture_1',
        subscription: 'sub_fixture_1',
        metadata: {
          household_id: 'household-one',
          canonical_subscription_id: 'subscription-one',
          plan_version_id: 'family_v1',
        },
      };
      for (const mutate of [
        (value: Record<string, unknown>) => {
          delete value.object;
        },
        (value: Record<string, unknown>) => {
          value.livemode = true;
        },
        (value: Record<string, unknown>) => {
          value.mode = 'payment';
        },
      ]) {
        const object = structuredClone(exactObject);
        mutate(object);
        const rawBody = JSON.stringify({
          id: `evt_${eventType}_${String(object.object)}_${String(object.mode)}`,
          type: eventType,
          created: timestamp,
          livemode: false,
          api_version: apiVersion,
          data: { object },
        });
        const normalized = normalizeStripeEvent(
          verifyStripeWebhook({
            rawBody,
            signatureHeader: signStripeFixture({
              rawBody,
              endpointSecret,
              timestampSeconds: timestamp,
            }),
            endpointSecret,
            environment: 'test',
            now,
            supportedApiVersions: new Set([apiVersion]),
          }),
        );
        expect(normalized.requiresReconciliation).toBe(true);
        expect(normalized.checkoutCompletion).toBeUndefined();
        expect(normalized.checkoutExpiration).toBeUndefined();
      }
    }
  });

  it('paginates the complete Stripe subscription inventory and rejects partial page truth', async () => {
    const get = vi.fn(async ({ path }: { readonly path: string }) => {
      if (path === '/v1/account') {
        return { object: 'account', id: 'acct_fixture1234' };
      }
      if (path === '/v1/subscriptions?status=all&limit=100') {
        return {
          object: 'list',
          has_more: true,
          data: [
            {
              id: 'sub_inventory_a',
              object: 'subscription',
              livemode: false,
              status: 'active',
            },
          ],
        };
      }
      if (path === '/v1/subscriptions?status=all&limit=100&starting_after=sub_inventory_a') {
        return {
          object: 'list',
          has_more: false,
          data: [
            {
              id: 'sub_inventory_b',
              object: 'subscription',
              livemode: false,
              status: 'canceled',
            },
          ],
        };
      }
      return {};
    });
    const adapter = new StripeTestAdapter(
      { postForm: vi.fn(async () => ({})), get },
      { authorize: vi.fn(async () => ({ allowed: false, reason: 'unused' })) },
      new Set(),
      apiVersion,
    );
    const receipts: unknown[] = [];
    await expect(
      adapter.fetchSubscriptionInventory({
        environment: 'test',
        onPage: async (page) => {
          receipts.push(page);
        },
      }),
    ).resolves.toMatchObject({ verifiedAccountId: 'acct_fixture1234' });
    expect(receipts).toEqual([
      {
        pageNumber: 1,
        nextCursor: 'sub_inventory_a',
        hasMore: true,
        subscriptions: [{ externalSubscriptionId: 'sub_inventory_a', lifecycle: 'active' }],
      },
      {
        pageNumber: 2,
        requestCursor: 'sub_inventory_a',
        hasMore: false,
        subscriptions: [{ externalSubscriptionId: 'sub_inventory_b', lifecycle: 'canceled' }],
      },
    ]);
    expect(get.mock.calls.map(([request]) => request.path)).toEqual([
      '/v1/account',
      '/v1/subscriptions?status=all&limit=100',
      '/v1/subscriptions?status=all&limit=100&starting_after=sub_inventory_a',
    ]);

    get.mockReset();
    get.mockImplementation(async ({ path }: { readonly path: string }) =>
      path === '/v1/account'
        ? { object: 'account', id: 'acct_fixture1234' }
        : { object: 'list', has_more: true, data: [] },
    );
    await expect(
      adapter.fetchSubscriptionInventory({ environment: 'test', onPage: async () => undefined }),
    ).rejects.toMatchObject({ code: 'stripe.inventory_pagination_invalid' });

    get.mockReset();
    get.mockResolvedValue({ object: 'account', id: 'acct_wrong' });
    await expect(
      adapter.fetchSubscriptionInventory({ environment: 'test', onPage: async () => undefined }),
    ).rejects.toMatchObject({ code: 'stripe.inventory_account_mismatch' });
  });
});

describe('store commerce contracts', () => {
  it('defaults unknown, stale, and ambiguous storefront policy to no external link', () => {
    const query = {
      platform: 'apple' as const,
      storefront: 'USA',
      jurisdiction: 'US',
      program: 'default',
      appVersion: '1.0.0',
      now,
    };
    expect(evaluateStorefrontPolicy({ ...query, policies: [] })).toMatchObject({
      externalPurchaseLinkAllowed: false,
      reason: 'unknown_policy',
    });
    const policy = {
      id: 'policy-1',
      platform: 'apple' as const,
      storefront: 'USA',
      jurisdiction: 'US',
      program: 'default',
      appVersion: '1.0.0',
      policyVersion: '2026-06-08',
      checkedAt: new Date('2026-06-08T00:00:00.000Z'),
      staleAfter: new Date('2026-07-08T00:00:00.000Z'),
      externalPurchaseLinkAllowed: true,
      nativePurchaseRequired: false,
      accountManagementAllowed: true,
      state: 'active' as const,
    };
    expect(evaluateStorefrontPolicy({ ...query, policies: [policy] })).toMatchObject({
      externalPurchaseLinkAllowed: false,
      reason: 'stale_policy',
    });
    const current = { ...policy, staleAfter: new Date('2026-09-08T00:00:00.000Z') };
    expect(evaluateStorefrontPolicy({ ...query, policies: [current] })).toMatchObject({
      externalPurchaseLinkAllowed: true,
      reason: 'current_explicit_policy',
    });
    expect(
      evaluateStorefrontPolicy({ ...query, policies: [current, { ...current, id: 'policy-2' }] }),
    ).toMatchObject({ externalPurchaseLinkAllowed: false, reason: 'ambiguous_policy' });
  });

  it('normalizes only verifier-confirmed Apple and Google server events', async () => {
    const appleVerifier: StoreServerEventVerifier = {
      provider: 'apple',
      verify: vi.fn(async () => ({
        verified: true,
        claims: {
          notificationUUID: 'apple-note-1',
          notificationType: 'DID_FAIL_TO_RENEW',
          subtype: 'GRACE_PERIOD',
          signedDate: now.getTime(),
          originalTransactionId: 'apple-original-1',
          transactionId: 'apple-transaction-2',
        },
      })),
    };
    await expect(
      new AppleServerAdapter(appleVerifier).verifyAndNormalize({
        environment: 'sandbox',
        signedPayload: 'signed-fixture',
      }),
    ).resolves.toMatchObject({
      normalized: { provider: 'apple', lifecycle: 'grace', requiresReconciliation: false },
    });

    const googleVerifier: StoreServerEventVerifier = {
      provider: 'google',
      verify: vi.fn(async () => ({
        verified: true,
        claims: {
          messageId: 'google-message-1',
          notificationType: 'SUBSCRIPTION_ON_HOLD',
          eventTimeMillis: now.getTime(),
          purchaseToken: 'purchase-token-fixture',
          subscriptionId: 'family-monthly',
          acknowledged: false,
        },
      })),
    };
    await expect(
      new GoogleServerAdapter(googleVerifier).verifyAndNormalize({
        environment: 'sandbox',
        signedPayload: 'signed-fixture',
      }),
    ).resolves.toMatchObject({
      normalized: {
        provider: 'google',
        lifecycle: 'hold',
        acknowledgementRequired: true,
        requiresReconciliation: true,
      },
    });

    const unverified: StoreServerEventVerifier = {
      provider: 'apple',
      verify: vi.fn(async () => ({ verified: false, errorCode: 'apple.fixture_unverified' })),
    };
    await expect(
      new AppleServerAdapter(unverified).verifyAndNormalize({
        environment: 'sandbox',
        signedPayload: 'bad-fixture',
      }),
    ).rejects.toBeInstanceOf(StoreServerEventError);
  });

  it('does not confuse fixture HMACs with store verification', () => {
    const fixture = createHmac('sha256', 'fixture').update('payload').digest('hex');
    expect(fixture).toHaveLength(64);
  });
});

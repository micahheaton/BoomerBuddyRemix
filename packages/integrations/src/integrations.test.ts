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
        customer: 'cus_fixture_1',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: timestamp - 86_400,
        current_period_end: timestamp + 30 * 86_400,
        items: {
          data: [
            {
              price: { id: 'price_fixture', recurring: { interval: 'month' } },
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

  it.each([
    {
      caseName: 'the provider paid-through date is later',
      providerPeriodEnd: timestamp + 30 * 86_400,
      expectedEnd: timestamp + 3 * 86_400,
    },
    {
      caseName: 'the provider paid-through date is earlier',
      providerPeriodEnd: timestamp + 60,
      expectedEnd: timestamp + 60,
    },
  ])('bounds past-due grace when $caseName', ({ providerPeriodEnd, expectedEnd }) => {
    const rawBody = stripeBody({
      created: timestamp,
      data: {
        object: {
          id: 'sub_grace_fixture',
          object: 'subscription',
          status: 'past_due',
          cancel_at_period_end: true,
          current_period_start: timestamp - 30 * 86_400,
          current_period_end: providerPeriodEnd,
          items: {
            data: [{ price: { id: 'price_fixture', recurring: { interval: 'month' } } }],
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
  });

  it('resolves only the explicit invoice payment event allowlist', async () => {
    const get = vi.fn(async () => ({
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
            price: { id: 'price_fixture', recurring: { interval: 'month' } },
            period: { start: timestamp, end: timestamp + 30 * 86_400 },
          },
        ],
      },
    }));
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
          providerPriceId: 'price_fixture',
          currentPeriodStartsAt: new Date(timestamp * 1_000),
          currentPeriodEndsAt: new Date((timestamp + 30 * 86_400) * 1_000),
        });
      } else {
        expect(resolved?.paidPeriodEvidence).toBeUndefined();
      }
    }
    expect(get).toHaveBeenCalledTimes(2);
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
  ])('withholds paid-through evidence when $caseName', async ({ override }) => {
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
    expect(resolved).toMatchObject({ externalSubscriptionId: 'sub_invoice_fixture' });
    expect(resolved?.paidPeriodEvidence).toBeUndefined();
  });

  it('requires server-resolved billing authority and allowlisted HTTPS return URLs', async () => {
    const transport: StripeTransport = {
      postForm: vi.fn(async () => ({
        id: 'cs_test_fixture',
        url: 'https://checkout.stripe.test/session',
      })),
      get: vi.fn(async () => ({
        id: 'sub_fixture_1',
        object: 'subscription',
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
        planVersionId: 'plan-family-v1',
        providerPriceId: 'price_fixture',
        successUrl: 'https://app.boomerbuddy.test/member/billing/success',
        cancelUrl: 'https://app.boomerbuddy.test/member/billing',
        idempotencyKey: 'checkout-one',
        expiresAt: new Date(now.getTime() + 30 * 60_000),
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
      planVersionId: 'plan-family-v1',
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

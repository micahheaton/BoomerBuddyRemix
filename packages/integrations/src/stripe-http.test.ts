import { describe, expect, it, vi } from 'vitest';
import type { StripeWebhookError } from './stripe';
import { StripeHttpTransport, supportedStripeApiVersion } from './stripe-http';

const restrictedLiveFixture = ['rk', 'live', 'fixture_12345678'].join('_');
const unrestrictedLiveFixture = ['sk', 'live', 'fixture_12345678'].join('_');

function response(input: {
  readonly ok: boolean;
  readonly status: number;
  readonly body: unknown;
}) {
  return {
    ok: input.ok,
    status: input.status,
    json: vi.fn().mockResolvedValue(input.body),
  } as unknown as Response;
}

describe('Stripe HTTP transport boundary', () => {
  it('uses one typed request with the pinned API version and exact idempotency key', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ ok: true, status: 200, body: { id: 'cs_fixture_001' } }));
    const transport = new StripeHttpTransport(
      'rk_test_fixture_12345678',
      supportedStripeApiVersion,
      fetchImplementation,
    );

    await expect(
      transport.postForm({
        path: '/v1/checkout/sessions',
        form: { mode: 'subscription' },
        idempotencyKey: 'checkout-operation-001',
      }),
    ).resolves.toEqual({ id: 'cs_fixture_001' });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://api.stripe.com/v1/checkout/sessions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer rk_test_fixture_12345678',
          'Stripe-Version': supportedStripeApiVersion,
          'Idempotency-Key': 'checkout-operation-001',
        }),
      }),
    );
  });

  it('rejects unrestricted keys and unpinned API versions before network access', () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    expect(
      () =>
        new StripeHttpTransport(
          unrestrictedLiveFixture,
          supportedStripeApiVersion,
          fetchImplementation,
        ),
    ).toThrow('restricted rk_ credential');
    expect(
      () =>
        new StripeHttpTransport(restrictedLiveFixture, '2025-09-30.clover', fetchImplementation),
    ).toThrow('Unsupported Stripe API version');
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('surfaces an unknown transport outcome after exactly one attempt', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('fixture network failure'));
    const transport = new StripeHttpTransport(
      restrictedLiveFixture,
      supportedStripeApiVersion,
      fetchImplementation,
    );

    await expect(
      transport.postForm({
        path: '/v1/checkout/sessions',
        form: { mode: 'subscription' },
        idempotencyKey: 'live-checkout-operation-001',
      }),
    ).rejects.toEqual(
      expect.objectContaining<StripeWebhookError>({
        name: 'StripeWebhookError',
        code: 'stripe.transport_failure',
        message: 'stripe.transport_failure',
      }),
    );
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
});

import { StripeWebhookError, type StripeTransport } from './stripe';

const stripeApiOrigin = 'https://api.stripe.com';

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new StripeWebhookError('stripe.invalid_provider_response');
  }
  return value as Readonly<Record<string, unknown>>;
}

/** Node-compatible Stripe transport shared by the API and durable worker. */
export class StripeHttpTransport implements StripeTransport {
  constructor(
    private readonly secretKey: string,
    private readonly apiVersion: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  private async request(input: {
    readonly method: 'GET' | 'POST';
    readonly path: string;
    readonly form?: Readonly<Record<string, string>>;
    readonly idempotencyKey?: string;
  }): Promise<Readonly<Record<string, unknown>>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    timer.unref();
    try {
      const response = await this.fetchImplementation(`${stripeApiOrigin}${input.path}`, {
        method: input.method,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Stripe-Version': this.apiVersion,
          ...(input.form === undefined
            ? {}
            : { 'Content-Type': 'application/x-www-form-urlencoded' }),
          ...(input.idempotencyKey === undefined
            ? {}
            : { 'Idempotency-Key': input.idempotencyKey }),
        },
        ...(input.form === undefined
          ? {}
          : { body: new URLSearchParams(Object.entries(input.form)).toString() }),
        signal: controller.signal,
      });
      const payload = record(await response.json());
      if (!response.ok) throw new StripeWebhookError(`stripe.http_${response.status}`);
      return payload;
    } catch (error) {
      if (error instanceof StripeWebhookError) throw error;
      throw new StripeWebhookError(
        error instanceof Error && error.name === 'AbortError'
          ? 'stripe.timeout'
          : 'stripe.transport_failure',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  postForm(input: {
    readonly path: string;
    readonly form: Readonly<Record<string, string>>;
    readonly idempotencyKey: string;
  }): Promise<Readonly<Record<string, unknown>>> {
    return this.request({ method: 'POST', ...input });
  }

  get(input: { readonly path: string }): Promise<Readonly<Record<string, unknown>>> {
    return this.request({ method: 'GET', path: input.path });
  }
}

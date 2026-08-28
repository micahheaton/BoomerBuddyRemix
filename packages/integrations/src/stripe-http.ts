import { StripeWebhookError, type StripeTransport } from './stripe';

const stripeApiOrigin = 'https://api.stripe.com';
export const supportedStripeApiVersion = '2026-07-29.dahlia';

function unrefTimer(timer: unknown): void {
  if (
    typeof timer === 'object' &&
    timer !== null &&
    'unref' in timer &&
    typeof timer.unref === 'function'
  ) {
    timer.unref();
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new StripeWebhookError('stripe.invalid_provider_response');
  }
  return value as Readonly<Record<string, unknown>>;
}

/**
 * Node-compatible, shape-validated Stripe transport shared by the API and durable worker.
 * It intentionally makes one HTTP attempt: durable operations own same-idempotency-key retry
 * policy, so an SDK migration must replace this adapter atomically without adding hidden retries.
 */
export class StripeHttpTransport implements StripeTransport {
  constructor(
    private readonly secretKey: string,
    private readonly apiVersion: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {
    if (!/^rk_(?:test|live)_[A-Za-z0-9_]{8,}$/u.test(secretKey)) {
      throw new TypeError('Stripe transport requires a restricted rk_ credential');
    }
    if (apiVersion !== supportedStripeApiVersion) {
      throw new TypeError(`Unsupported Stripe API version: ${apiVersion}`);
    }
  }

  private async request(input: {
    readonly method: 'GET' | 'POST';
    readonly path: string;
    readonly form?: Readonly<Record<string, string>>;
    readonly idempotencyKey?: string;
  }): Promise<Readonly<Record<string, unknown>>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    unrefTimer(timer);
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

import {
  StripeAdapter,
  type StripeAdapterConfiguration,
  type StripeTransport,
} from '@boomerbuddy/integrations';

/** Compose the online worker adapter from the same reviewed customer origins as the API. */
export function createWorkerStripeAdapter(input: {
  readonly transport: StripeTransport;
  readonly customerOrigins: readonly string[];
  readonly configuration: StripeAdapterConfiguration;
}): StripeAdapter {
  return new StripeAdapter(
    input.transport,
    {
      authorize: async () => ({
        allowed: true,
        reason: 'durable_repository_claimed_same_key_retry_only',
      }),
    },
    new Set(input.customerOrigins),
    input.configuration,
  );
}

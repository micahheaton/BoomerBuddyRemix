import type {
  CommerceCheckoutPort,
  CommercePortalPort,
  StripePreflightPort,
} from '@boomerbuddy/integrations';
import type {
  BusinessOsRepository,
  CommerceRuntimeRepository,
  DurableJob,
} from '@boomerbuddy/persistence';
import type { JobExecutionError } from '@boomerbuddy/platform';
import { describe, expect, it, vi } from 'vitest';
import {
  createStripeSessionRetryHandler,
  stripeSessionRetryJobType,
} from '../../apps/worker/src/stripe-session-retry';

const now = new Date('2026-08-25T18:00:00.000Z');

function retryJob(action: 'checkout' | 'portal'): DurableJob {
  return {
    id: `stripe-live-retry-${action}`,
    type: stripeSessionRetryJobType,
    version: 1,
    householdId: 'household-sunrise',
    classification: 'internal',
    payload: {
      householdId: 'household-sunrise',
      environment: 'production',
      action,
      serverOperationId: `operation-${action}-001`,
    },
    idempotencyKey: `stripe-live-retry-${action}`,
    state: 'running',
    priority: 0,
    attempts: 1,
    maxAttempts: 1,
    nextAttemptAt: now,
    correlationId: `stripe-live-retry-${action}`,
  };
}

describe('live Stripe unknown-outcome retry', () => {
  it.each(['checkout', 'portal'] as const)(
    'holds a live %s operation without another provider call',
    async (action) => {
      const upsertOwnerAttention = vi.fn().mockResolvedValue(undefined);
      const stripeSessionRetryContext = vi.fn();
      const verifyConfiguredResources = vi.fn();
      const createCheckout = vi.fn();
      const createPortal = vi.fn();
      const handler = createStripeSessionRetryHandler({
        businessOs: { upsertOwnerAttention } as unknown as BusinessOsRepository,
        commerceRuntime: {
          stripeSessionRetryContext,
        } as unknown as CommerceRuntimeRepository,
        provider: {
          verifyConfiguredResources,
          createCheckout,
          createPortal,
        } as unknown as CommerceCheckoutPort & CommercePortalPort & StripePreflightPort,
        evidenceLevel: 'live_production',
        transportKind: 'stripe_https',
        runtimeRunId: 'live-worker-run-001',
        authenticityKind: 'provider_read',
        runtimeInitiationPermitted: true,
        clock: () => now,
      });

      await expect(
        handler({
          job: retryJob(action),
          idempotencyKey: `stripe-live-retry-${action}`,
          signal: new AbortController().signal,
          heartbeat: vi.fn().mockResolvedValue(true),
        }),
      ).rejects.toEqual(
        expect.objectContaining<JobExecutionError>({
          name: 'JobExecutionError',
          code: 'stripe_session_retry_live_outcome_held',
          message: 'stripe_session_retry_live_outcome_held',
          retryable: false,
        }),
      );
      expect(upsertOwnerAttention).toHaveBeenCalledWith(
        expect.objectContaining({
          dedupeKey: `stripe_session_unknown_production_${action}_operation-${action}-001`,
          now,
          sourceId: `operation-${action}-001`,
        }),
      );
      expect(stripeSessionRetryContext).not.toHaveBeenCalled();
      expect(verifyConfiguredResources).not.toHaveBeenCalled();
      expect(createCheckout).not.toHaveBeenCalled();
      expect(createPortal).not.toHaveBeenCalled();
    },
  );
});

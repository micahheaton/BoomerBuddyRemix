import { DomainError } from '@boomerbuddy/domain';
import {
  StripeWebhookError,
  StripeSessionDispatchError,
  type CommerceCheckoutPort,
  type CommercePortalPort,
  type StripePreflightPort,
} from '@boomerbuddy/integrations';
import type { BusinessOsRepository, CommerceRuntimeRepository } from '@boomerbuddy/persistence';
import { JobExecutionError, type JobHandler } from '@boomerbuddy/platform';

export const stripeSessionRetryJobType = 'commerce.stripe-session-retry';

function text(payload: Readonly<Record<string, unknown>>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new JobExecutionError('stripe_session_retry_payload_invalid', false);
  }
  return value;
}

export function createStripeSessionRetryHandler(input: {
  readonly businessOs: BusinessOsRepository;
  readonly commerceRuntime: CommerceRuntimeRepository;
  readonly provider: CommerceCheckoutPort & CommercePortalPort & StripePreflightPort;
  readonly evidenceLevel: 'local_fixture' | 'stripe_test' | 'deployed_staging' | 'live_production';
  readonly transportKind: 'injected_fixture' | 'stripe_https';
  readonly runtimeRunId: string;
  readonly authenticityKind: 'fixture_assertion' | 'provider_read';
  readonly runtimeInitiationPermitted: boolean;
  readonly clock?: () => Date;
}): JobHandler {
  const clock = input.clock ?? (() => new Date());
  return async ({ job }) => {
    const householdId = text(job.payload, 'householdId');
    const environmentValue = text(job.payload, 'environment');
    const actionValue = text(job.payload, 'action');
    const serverOperationId = text(job.payload, 'serverOperationId');
    if (
      (environmentValue !== 'test' && environmentValue !== 'production') ||
      (actionValue !== 'checkout' && actionValue !== 'portal')
    ) {
      throw new JobExecutionError('stripe_session_retry_payload_invalid', false);
    }
    const environment = environmentValue;
    const action = actionValue;
    const now = clock();
    if (environment === 'production') {
      await input.businessOs.upsertOwnerAttention({
        attentionKind: 'billing_reconciliation',
        consequenceOfInaction:
          'The live provider outcome remains unknown and replacement billing stays blocked.',
        dedupeKey: `stripe_session_unknown_${environment}_${action}_${serverOperationId}`,
        now,
        recommendedAction:
          'Resolve the original operation from an authentic signed Stripe event or a bounded reconciliation read. Do not issue another POST.',
        sourceId: serverOperationId,
        sourceType: 'commerce_session_operation',
        whyFounderRequired:
          'Live same-key retry is intentionally held until its provider-read proof contract is enabled.',
      });
      throw new JobExecutionError('stripe_session_retry_live_outcome_held', false);
    }
    if (action === 'checkout' && !input.runtimeInitiationPermitted) {
      await input.businessOs.upsertOwnerAttention({
        attentionKind: 'billing_reconciliation',
        consequenceOfInaction:
          'The provider outcome remains unknown and replacement billing stays blocked.',
        dedupeKey: `stripe_session_unknown_${environment}_${action}_${serverOperationId}`,
        now,
        recommendedAction:
          'Keep Checkout disabled and review the same-key operation without starting a replacement.',
        sourceId: serverOperationId,
        sourceType: 'commerce_session_operation',
        whyFounderRequired: 'Runtime Stripe initiation is disabled.',
      });
      throw new JobExecutionError('stripe_session_retry_runtime_disabled', false);
    }
    const retry = await input.commerceRuntime.stripeSessionRetryContext({
      householdId,
      environment,
      action,
      serverOperationId,
      now,
    });
    if (retry.kind === 'terminal') return;
    if (retry.kind === 'not_due') {
      throw new JobExecutionError('stripe_session_retry_not_due', true);
    }
    if (retry.kind === 'attention') {
      await input.businessOs.upsertOwnerAttention({
        attentionKind: 'billing_reconciliation',
        consequenceOfInaction:
          'The provider outcome remains unknown and replacement billing stays blocked.',
        dedupeKey: `stripe_session_unknown_${environment}_${action}_${serverOperationId}`,
        now,
        recommendedAction:
          'Review the persisted same-key operation. A founder retry is allowed only when its projection explicitly reports repairAvailable; otherwise wait for authentic provider truth.',
        sourceId: serverOperationId,
        sourceType: 'commerce_session_operation',
        whyFounderRequired: `Automatic retry stopped: ${retry.reason}.`,
      });
      throw new JobExecutionError(`stripe_session_retry_${retry.reason}`, false);
    }
    const context = retry.context;
    let preflightRecordId: string | undefined;
    try {
      const preflight = await input.provider.verifyConfiguredResources();
      const receipt = await input.commerceRuntime.recordStripePreflight({
        evidence: preflight,
        evidenceLevel: input.evidenceLevel,
        transportKind: input.transportKind,
        runtimeRunId: input.runtimeRunId,
        authenticityKind: input.authenticityKind,
        now,
      });
      preflightRecordId = receipt.id;
    } catch (error) {
      const errorCode =
        error instanceof StripeWebhookError ? error.code : 'stripe.preflight_read_failed';
      await input.businessOs.upsertOwnerAttention({
        attentionKind: 'billing_reconciliation',
        consequenceOfInaction:
          'The same-key retry is held because current Stripe resource controls were not verified.',
        dedupeKey: `stripe_session_preflight_${environment}_${action}_${serverOperationId}`,
        now,
        recommendedAction:
          'Restore the exact restricted Stripe resources; keep this same-key operation blocked until a bounded retry or authentic provider event resolves it.',
        sourceId: serverOperationId,
        sourceType: 'commerce_session_operation',
        whyFounderRequired: `Stripe retry preflight failed closed: ${errorCode}.`,
      });
      throw new JobExecutionError(errorCode, true);
    }
    let dispatch;
    try {
      dispatch = await input.commerceRuntime.beginStripeSessionOperation({
        householdId,
        ...(context.action === 'checkout'
          ? {
              checkoutIntentId: context.checkoutIntentId,
              requestedExpiresAt: context.requestedExpiresAt,
              canonicalSubscriptionId: context.canonicalSubscriptionId,
              providerPriceId: context.providerPriceId,
              ...(context.providerCustomerId === undefined
                ? {}
                : { providerCustomerId: context.providerCustomerId }),
              successUrl: context.successUrl,
              cancelUrl: context.cancelUrl,
            }
          : {
              providerCustomerId: context.providerCustomerId,
              providerConfigurationId: context.providerConfigurationId,
              returnUrl: context.returnUrl,
            }),
        action: context.action,
        environment,
        serverOperationId,
        providerIdempotencyKey: context.providerIdempotencyKey,
        ...(preflightRecordId === undefined ? {} : { preflightRecordId }),
        actorPersonId: context.actor.personId,
        allowDueRetry: true,
        now,
      });
    } catch (error) {
      const errorCode =
        error instanceof DomainError
          ? `stripe_retry_dispatch_gate_${error.code}`
          : 'stripe_retry_dispatch_gate_failed';
      await input.businessOs.upsertOwnerAttention({
        attentionKind: 'billing_reconciliation',
        consequenceOfInaction:
          'The provider outcome remains unknown and replacement billing stays blocked.',
        dedupeKey: `stripe_session_unknown_${environment}_${action}_${serverOperationId}`,
        now,
        recommendedAction:
          'Review current cohort, initiation, and billing-authority controls before any same-key repair.',
        sourceId: serverOperationId,
        sourceType: 'commerce_session_operation',
        whyFounderRequired: `The retry dispatch gate closed: ${errorCode}.`,
      });
      throw new JobExecutionError(errorCode, false);
    }
    if (!dispatch.shouldDispatch) {
      if (
        (dispatch.state === 'dispatching' || dispatch.state === 'outcome_unknown') &&
        dispatch.attempt >= 6
      ) {
        await input.commerceRuntime.holdStripeSessionRetryExhausted({
          householdId,
          environment,
          action,
          serverOperationId,
          now,
        });
        await input.businessOs.upsertOwnerAttention({
          attentionKind: 'billing_reconciliation',
          consequenceOfInaction:
            'The provider outcome remains unknown and replacement billing stays blocked.',
          dedupeKey: `stripe_session_unknown_${environment}_${action}_${serverOperationId}`,
          now,
          recommendedAction:
            'Review the exact same-key Stripe operation; do not start a replacement payment.',
          sourceId: serverOperationId,
          sourceType: 'commerce_session_operation',
          whyFounderRequired:
            'The bounded automatic same-key POST budget was exhausted without provider truth.',
        });
      }
      return;
    }
    try {
      if (context.action === 'checkout') {
        const session = await input.provider.createCheckout({
          actor: context.actor,
          offerId: context.offerId,
          canonicalSubscriptionId: context.canonicalSubscriptionId,
          planVersionId: context.planVersionId,
          providerPriceId: context.providerPriceId,
          ...(context.providerCustomerId === undefined
            ? {}
            : { customerReference: context.providerCustomerId }),
          successUrl: context.successUrl,
          cancelUrl: context.cancelUrl,
          idempotencyKey: context.providerIdempotencyKey,
          providerExpiresAt: context.requestedExpiresAt,
        });
        if (session.expiresAt === undefined) {
          throw new JobExecutionError('stripe_checkout_expiry_missing', true);
        }
        await input.commerceRuntime.recordStripeCheckoutSession({
          householdId,
          intentId: context.checkoutIntentId,
          providerSessionId: session.id,
          providerSessionUrl: session.url,
          environment,
          serverOperationId,
          providerIdempotencyKey: context.providerIdempotencyKey,
          requestedExpiresAt: context.requestedExpiresAt,
          returnedExpiresAt: session.expiresAt,
          now: clock(),
        });
      } else {
        const session = await input.provider.createPortal({
          actor: context.actor,
          providerCustomerId: context.providerCustomerId,
          providerConfigurationId: context.providerConfigurationId,
          returnUrl: context.returnUrl,
          idempotencyKey: context.providerIdempotencyKey,
        });
        await input.commerceRuntime.recordStripePortalSession({
          householdId,
          environment,
          serverOperationId,
          providerIdempotencyKey: context.providerIdempotencyKey,
          providerSessionId: session.id,
          providerSessionUrl: session.url,
          now: clock(),
        });
      }
    } catch (error) {
      const stableErrorCode =
        error instanceof StripeWebhookError
          ? error.code
          : error instanceof DomainError
            ? `stripe_repository_${error.code}`
            : error instanceof JobExecutionError
              ? error.code
              : 'stripe_same_key_retry_outcome_unknown';
      if (error instanceof StripeSessionDispatchError && !error.dispatchAttempted) {
        const disposition = await input.commerceRuntime.markStripeSessionFailedNoEffect({
          householdId,
          action,
          environment,
          serverOperationId,
          ...(context.action === 'checkout' ? { checkoutIntentId: context.checkoutIntentId } : {}),
          errorCode: stableErrorCode,
          now: clock(),
        });
        if (disposition === 'ambiguity_preserved') {
          await input.businessOs.upsertOwnerAttention({
            attentionKind: 'billing_reconciliation',
            consequenceOfInaction:
              'An earlier provider dispatch remains unknown, so replacement billing stays blocked.',
            dedupeKey: `stripe_session_unknown_${environment}_${action}_${serverOperationId}`,
            now: clock(),
            recommendedAction:
              'Review the original same-key Stripe request; do not start a replacement payment.',
            sourceId: serverOperationId,
            sourceType: 'commerce_session_operation',
            whyFounderRequired:
              'This retry was proven not dispatched, but an earlier attempt may still have provider effect.',
          });
        }
        throw new JobExecutionError(stableErrorCode, false);
      }
      await input.commerceRuntime.markStripeSessionOutcomeUnknown({
        householdId,
        action,
        environment,
        serverOperationId,
        ...(context.action === 'checkout' ? { checkoutIntentId: context.checkoutIntentId } : {}),
        errorCode: stableErrorCode,
        now: clock(),
      });
      if (error instanceof JobExecutionError) throw error;
      throw new JobExecutionError(stableErrorCode, true);
    }
  };
}

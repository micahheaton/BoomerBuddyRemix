import type { ProviderReconciliationPort } from '@boomerbuddy/integrations';
import type {
  BusinessOsRepository,
  CommerceOperationsRepository,
  CommerceRuntimeRepository,
} from '@boomerbuddy/persistence';
import { JobExecutionError, type JobHandler } from '@boomerbuddy/platform';

function payloadText(payload: Readonly<Record<string, unknown>>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{2,199}$/u.test(value)) {
    throw new JobExecutionError('commerce_reconciliation_payload_invalid', false);
  }
  return value;
}

function optionalPayloadText(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  return payload[key] === undefined ? undefined : payloadText(payload, key);
}

function invoiceSnapshotIsCompatible(eventType: string, lifecycle: string | undefined): boolean {
  if (!eventType.startsWith('invoice.')) return true;
  if (eventType === 'invoice.paid') {
    return lifecycle === 'active' || lifecycle === 'cancel_at_period_end';
  }
  if (eventType === 'invoice.payment_failed') {
    return ['grace', 'delinquent', 'paused', 'hold', 'canceled', 'expired'].includes(
      lifecycle ?? '',
    );
  }
  return false;
}

export function createStripeReconciliationHandler(input: {
  readonly businessOs: BusinessOsRepository;
  readonly commerce: CommerceOperationsRepository;
  readonly commerceRuntime: CommerceRuntimeRepository;
  readonly provider: ProviderReconciliationPort;
  readonly clock?: () => Date;
}): JobHandler {
  const clock = input.clock ?? (() => new Date());
  return async ({ job }) => {
    const inboxId = payloadText(job.payload, 'inboxId');
    const suppliedExternalSubscriptionId = optionalPayloadText(
      job.payload,
      'externalSubscriptionId',
    );
    const reconciliationRunId = payloadText(job.payload, 'reconciliationRunId');
    const eventType = payloadText(job.payload, 'eventType');
    const providerObjectId = payloadText(job.payload, 'providerObjectId');
    const providerEventCreatedAt = new Date(payloadText(job.payload, 'providerEventCreatedAt'));
    if (!Number.isFinite(providerEventCreatedAt.getTime())) {
      throw new JobExecutionError('commerce_reconciliation_payload_invalid', false);
    }
    const householdId = optionalPayloadText(job.payload, 'householdId');
    const subscriptionId = optionalPayloadText(job.payload, 'subscriptionId');
    const planVersionId = optionalPayloadText(job.payload, 'planVersionId');
    const observedAt = clock();
    if (
      eventType.startsWith('invoice.') &&
      !['invoice.paid', 'invoice.payment_failed'].includes(eventType)
    ) {
      await input.commerce.quarantineProviderEvent({
        inboxId,
        errorCode: 'stripe.invoice_event_not_allowlisted',
        now: observedAt,
      });
      await input.commerce.completeReconciliation({
        id: reconciliationRunId,
        provider: 'stripe',
        environment: 'test',
        checkedCount: 1,
        mismatchCount: 1,
        now: observedAt,
      });
      await input.businessOs.upsertOwnerAttention({
        attentionKind: 'billing_reconciliation',
        consequenceOfInaction:
          'Canonical access remains unchanged until payment evidence is resolved.',
        dedupeKey: `billing_reconciliation_${inboxId}`,
        now: observedAt,
        recommendedAction: 'Review the unsupported invoice event in Stripe test mode.',
        sourceId: inboxId,
        sourceType: 'commerce_event',
        whyFounderRequired: 'The invoice event is not approved as payment truth.',
      });
      return;
    }
    const requiresEventResolution =
      suppliedExternalSubscriptionId === undefined ||
      eventType.startsWith('invoice.') ||
      eventType === 'charge.refunded' ||
      eventType === 'charge.dispute.created';
    const eventResolution = requiresEventResolution
      ? await input.provider.resolveEventSubscription({
          environment: 'test',
          eventType,
          providerObjectId,
        })
      : undefined;
    const subscriptionEvidenceConflicts =
      suppliedExternalSubscriptionId !== undefined &&
      eventResolution !== undefined &&
      eventResolution !== null &&
      suppliedExternalSubscriptionId !== eventResolution.externalSubscriptionId;
    const externalSubscriptionId = subscriptionEvidenceConflicts
      ? null
      : (eventResolution?.externalSubscriptionId ?? suppliedExternalSubscriptionId ?? null);
    if (externalSubscriptionId === null) {
      await input.commerce.quarantineProviderEvent({
        inboxId,
        errorCode: 'stripe.subscription_lookup_unresolved',
        now: observedAt,
      });
      await input.commerce.completeReconciliation({
        id: reconciliationRunId,
        provider: 'stripe',
        environment: 'test',
        checkedCount: 1,
        mismatchCount: 1,
        now: observedAt,
      });
      await input.businessOs.upsertOwnerAttention({
        attentionKind: 'billing_reconciliation',
        consequenceOfInaction: 'Canonical access remains unchanged until evidence is resolved.',
        dedupeKey: `billing_reconciliation_${inboxId}`,
        now: observedAt,
        recommendedAction: 'Resolve the provider event to its canonical subscription.',
        sourceId: inboxId,
        sourceType: 'commerce_event',
        whyFounderRequired: 'Stripe test evidence did not resolve to a subscription.',
      });
      return;
    }
    const snapshot = await input.provider.retrieveSubscription({
      environment: 'test',
      externalSubscriptionId,
      observedAt,
    });
    const hasCanonicalBinding =
      householdId !== undefined && subscriptionId !== undefined && planVersionId !== undefined;
    const binding = await input.commerceRuntime.resolveStripeEventBinding({
      externalSubscriptionId,
      providerEventCreatedAt,
      ...(hasCanonicalBinding
        ? {
            canonicalBinding: {
              householdId: householdId as string,
              subscriptionId: subscriptionId as string,
              planVersionId: planVersionId as string,
            },
          }
        : {}),
    });
    const effectiveLifecycle = eventResolution?.lifecycleOverride ?? snapshot.lifecycle;
    const paidPeriod = eventResolution?.paidPeriodEvidence;
    const appliedPeriodStartsAt =
      eventType === 'invoice.paid'
        ? paidPeriod?.currentPeriodStartsAt
        : snapshot.currentPeriodStartsAt;
    const appliedPeriodEndsAt =
      eventType === 'invoice.paid' ? paidPeriod?.currentPeriodEndsAt : snapshot.currentPeriodEndsAt;
    const paidEvidenceMatches =
      eventType !== 'invoice.paid' ||
      (paidPeriod !== undefined &&
        paidPeriod.externalSubscriptionId === externalSubscriptionId &&
        paidPeriod.providerPriceId === binding?.providerPriceId &&
        paidPeriod.currentPeriodStartsAt.getTime() === snapshot.currentPeriodStartsAt?.getTime() &&
        paidPeriod.currentPeriodEndsAt.getTime() === snapshot.currentPeriodEndsAt?.getTime());
    const evidenceMatches =
      binding !== null &&
      snapshot.externalSubscriptionId === externalSubscriptionId &&
      snapshot.providerObjectId === externalSubscriptionId &&
      effectiveLifecycle !== undefined &&
      snapshot.providerPriceId === binding.providerPriceId &&
      snapshot.billingInterval === binding.billingInterval &&
      appliedPeriodStartsAt !== undefined &&
      appliedPeriodEndsAt !== undefined &&
      appliedPeriodEndsAt > appliedPeriodStartsAt &&
      paidEvidenceMatches &&
      !snapshot.requiresReconciliation &&
      invoiceSnapshotIsCompatible(eventType, effectiveLifecycle);

    if (!evidenceMatches || binding === null || effectiveLifecycle === undefined) {
      await input.commerce.quarantineProviderEvent({
        inboxId,
        errorCode: 'stripe.reconciliation_evidence_mismatch',
        now: observedAt,
      });
      await input.commerce.completeReconciliation({
        id: reconciliationRunId,
        provider: 'stripe',
        environment: 'test',
        checkedCount: 1,
        mismatchCount: 1,
        now: observedAt,
      });
      await input.businessOs.upsertOwnerAttention({
        attentionKind: 'billing_reconciliation',
        consequenceOfInaction: 'Canonical access remains unchanged until evidence is resolved.',
        dedupeKey: `billing_reconciliation_${inboxId}`,
        now: observedAt,
        recommendedAction: 'Compare the checkout intent with the Stripe test subscription.',
        sourceId: inboxId,
        sourceType: 'commerce_event',
        whyFounderRequired: 'The authenticated provider snapshot conflicts with canonical billing.',
      });
      return;
    }

    const externalEventId = `reconciliation:${reconciliationRunId}:${job.attempts}`;
    const evidencePayload = JSON.stringify({
      provider: snapshot.provider,
      environment: snapshot.environment,
      externalSubscriptionId,
      providerPriceId: snapshot.providerPriceId,
      billingInterval: snapshot.billingInterval,
      currentPeriodStartsAt: appliedPeriodStartsAt?.toISOString(),
      currentPeriodEndsAt: appliedPeriodEndsAt?.toISOString(),
      accessEvidence: eventType === 'invoice.paid' ? 'payment_confirmed' : 'non_payment',
      lifecycle: effectiveLifecycle,
      observedAt: observedAt.toISOString(),
    });
    const captured = await input.commerce.captureVerifiedProviderEvent({
      provider: 'stripe',
      environment: 'test',
      externalEventId,
      eventType: 'subscription.reconciliation',
      rawPayload: evidencePayload,
      providerApiVersion: snapshot.providerApiVersion,
      providerObjectId: snapshot.providerObjectId,
      providerEventCreatedAt: observedAt,
      normalizedLifecycle: effectiveLifecycle,
      now: observedAt,
    });
    await input.commerce.applyProviderLifecycle({
      inboxId: captured.id,
      provider: 'stripe',
      environment: 'test',
      externalEventId,
      providerApiVersion: snapshot.providerApiVersion,
      providerObjectId: snapshot.providerObjectId,
      providerEventCreatedAt: observedAt,
      householdId: binding.householdId,
      subscriptionId: binding.subscriptionId,
      externalSubscriptionId,
      ...(snapshot.providerCustomerId === undefined
        ? {}
        : { providerCustomerId: snapshot.providerCustomerId }),
      lifecycle: effectiveLifecycle,
      currentPeriodStartsAt: appliedPeriodStartsAt as Date,
      currentPeriodEndsAt: appliedPeriodEndsAt as Date,
      accessEvidence:
        eventType === 'invoice.paid'
          ? { kind: 'payment_confirmed', sourceInboxId: inboxId }
          : binding.bindingState === 'active_checkout' &&
              eventType.startsWith('customer.subscription.')
            ? { kind: 'initial_server_binding', sourceInboxId: inboxId }
            : { kind: 'non_payment', sourceInboxId: inboxId },
      authoritativeSnapshot: true,
      now: observedAt,
    });
    await input.commerce.ignoreProviderEventAfterReconciliation({ inboxId, now: observedAt });
    if (eventResolution?.requiresAttention === true) {
      await input.businessOs.upsertOwnerAttention({
        attentionKind: 'billing_reconciliation',
        consequenceOfInaction:
          effectiveLifecycle === 'disputed'
            ? 'Access is suspended while the chargeback is reviewed.'
            : 'A partial or ambiguous refund requires a billing decision.',
        dedupeKey: `billing_reconciliation_${inboxId}`,
        now: observedAt,
        recommendedAction: 'Review the authenticated Stripe financial event and customer account.',
        sourceId: inboxId,
        sourceType: 'commerce_event',
        whyFounderRequired: 'The event requires a human billing or chargeback decision.',
      });
    }
    const completed = await input.commerce.completeReconciliation({
      id: reconciliationRunId,
      provider: 'stripe',
      environment: 'test',
      checkedCount: 1,
      mismatchCount: eventResolution?.requiresAttention === true ? 1 : 0,
      now: observedAt,
    });
    if (!completed) throw new JobExecutionError('commerce_reconciliation_run_lost', false);
  };
}

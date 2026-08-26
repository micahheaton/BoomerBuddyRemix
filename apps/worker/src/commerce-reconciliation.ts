import {
  isStripeFailedPaymentEventType,
  type ProviderReconciliationPort,
} from '@boomerbuddy/integrations';
import type {
  BusinessOsRepository,
  CommerceOperationsRepository,
  CommerceRuntimeRepository,
  DurableJobRepository,
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

function payloadInteger(payload: Readonly<Record<string, unknown>>, key: string): number {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 100) {
    throw new JobExecutionError('commerce_reconciliation_payload_invalid', false);
  }
  return value;
}

function invoiceSnapshotIsCompatible(eventType: string, lifecycle: string | undefined): boolean {
  if (!eventType.startsWith('invoice.')) return true;
  if (eventType === 'invoice.paid') {
    return lifecycle === 'active' || lifecycle === 'cancel_at_period_end';
  }
  if (isStripeFailedPaymentEventType(eventType)) {
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
  readonly jobs: DurableJobRepository;
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
    const environmentValue = optionalPayloadText(job.payload, 'environment') ?? 'test';
    if (environmentValue !== 'test' && environmentValue !== 'production') {
      throw new JobExecutionError('commerce_reconciliation_payload_invalid', false);
    }
    const environment = environmentValue;
    const evidenceTierValue = payloadText(job.payload, 'evidenceTier');
    if (
      evidenceTierValue !== 'local_fixture' &&
      evidenceTierValue !== 'stripe_test' &&
      evidenceTierValue !== 'deployed_staging' &&
      evidenceTierValue !== 'live_production'
    ) {
      throw new JobExecutionError('commerce_reconciliation_payload_invalid', false);
    }
    const transportKindValue = payloadText(job.payload, 'transportKind');
    if (
      (evidenceTierValue === 'local_fixture' && transportKindValue !== 'injected_fixture') ||
      (evidenceTierValue !== 'local_fixture' && transportKindValue !== 'stripe_https')
    ) {
      throw new JobExecutionError('commerce_reconciliation_payload_invalid', false);
    }
    const transportKind = transportKindValue as 'injected_fixture' | 'stripe_https';
    const runtimeRunId = payloadText(job.payload, 'runtimeRunId');
    const repairGeneration = payloadInteger(job.payload, 'repairGeneration');
    const observedAt = clock();
    if (
      eventType.startsWith('invoice.') &&
      eventType !== 'invoice.paid' &&
      eventType !== 'invoice.finalization_failed' &&
      !isStripeFailedPaymentEventType(eventType)
    ) {
      await input.commerce.quarantineProviderEvent({
        inboxId,
        errorCode: 'stripe.invoice_event_not_allowlisted',
        now: observedAt,
      });
      await input.commerce.completeReconciliation({
        id: reconciliationRunId,
        provider: 'stripe',
        environment,
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
    const automaticClaim = await input.commerce.claimProviderReconciliationAutomaticAttempt({
      id: reconciliationRunId,
      inboxId,
      provider: 'stripe',
      environment,
      repairGeneration,
      now: observedAt,
    });
    if (automaticClaim.kind === 'already_terminal') return;
    if (automaticClaim.kind === 'binding_invalid') {
      throw new JobExecutionError('commerce_reconciliation_payload_invalid', false);
    }
    if (automaticClaim.kind === 'unavailable') {
      await input.commerce.markProviderReconciliationAttention({
        id: reconciliationRunId,
        provider: 'stripe',
        environment,
        failureCode: 'stripe.automatic_reconciliation_budget_exhausted',
        repairGeneration,
        now: observedAt,
      });
      await input.businessOs.upsertOwnerAttention({
        attentionKind: 'billing_reconciliation',
        consequenceOfInaction:
          'Canonical access remains unchanged after the bounded automatic read budget.',
        dedupeKey: `billing_reconciliation_transport_${inboxId}`,
        now: observedAt,
        recommendedAction: 'Use the audited founder reconciliation repair after review.',
        sourceId: inboxId,
        sourceType: 'commerce_event',
        whyFounderRequired: 'Additional provider reads require an explicit manual decision.',
      });
      throw new JobExecutionError('stripe.automatic_reconciliation_budget_exhausted', false);
    }
    const automaticAttemptCount = automaticClaim.automaticAttemptCount;
    try {
      if (eventType === 'invoice.finalization_failed') {
        const hasCanonicalBinding =
          householdId !== undefined && subscriptionId !== undefined && planVersionId !== undefined;
        const binding =
          suppliedExternalSubscriptionId === undefined
            ? null
            : await input.commerceRuntime.resolveStripeEventBinding({
                environment,
                externalSubscriptionId: suppliedExternalSubscriptionId,
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
        const recordedRecoveryState = await input.commerce.recordStripeInvoiceFinalizationRecovery({
          environment,
          sourceInboxId: inboxId,
          providerInvoiceId: providerObjectId,
          ...(suppliedExternalSubscriptionId === undefined
            ? {}
            : { providerSubscriptionId: suppliedExternalSubscriptionId }),
          ...(binding === null
            ? {}
            : {
                householdId: binding.householdId,
                subscriptionId: binding.subscriptionId,
              }),
          observedAt,
        });
        const recoveryState =
          recordedRecoveryState === 'resolved'
            ? 'resolved'
            : await input.commerce.ensureStripeInvoiceFinalizationAttention({
                environment,
                sourceInboxId: inboxId,
                providerInvoiceId: providerObjectId,
                now: observedAt,
              });
        const sourceDispositionRecorded =
          await input.commerce.ignoreProviderEventAfterReconciliation({
            inboxId,
            now: observedAt,
          });
        if (!sourceDispositionRecorded) {
          throw new JobExecutionError('commerce_reconciliation_source_disposition_invalid', false);
        }
        const completed = await input.commerce.completeReconciliation({
          id: reconciliationRunId,
          provider: 'stripe',
          environment,
          checkedCount: 1,
          mismatchCount: recoveryState === 'attention' ? 1 : 0,
          now: observedAt,
        });
        if (!completed) throw new JobExecutionError('commerce_reconciliation_run_lost', false);
        return;
      }
      const requiresEventResolution =
        suppliedExternalSubscriptionId === undefined ||
        eventType.startsWith('invoice.') ||
        eventType === 'charge.refunded' ||
        eventType.startsWith('refund.') ||
        eventType === 'charge.dispute.created' ||
        eventType === 'charge.dispute.closed';
      const eventResolution = requiresEventResolution
        ? await input.provider.resolveEventSubscription({
            environment,
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
          environment,
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
      const hasCanonicalBinding =
        householdId !== undefined && subscriptionId !== undefined && planVersionId !== undefined;
      const binding = await input.commerceRuntime.resolveStripeEventBinding({
        environment,
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
      if (binding === null && !hasCanonicalBinding) {
        await input.commerce.markProviderReconciliationAttention({
          id: reconciliationRunId,
          provider: 'stripe',
          environment,
          failureCode: 'stripe.checkout_binding_pending',
          repairGeneration,
          now: observedAt,
        });
        await input.businessOs.upsertOwnerAttention({
          attentionKind: 'billing_reconciliation',
          consequenceOfInaction:
            'Canonical access remains pending until an authentic matching Checkout completion binds the subscription.',
          dedupeKey: `billing_reconciliation_${inboxId}`,
          now: observedAt,
          recommendedAction:
            'Confirm whether the matching Checkout completion is still pending; do not infer payment access.',
          sourceId: inboxId,
          sourceType: 'commerce_event',
          whyFounderRequired:
            'The authentic provider event arrived before its canonical Checkout binding.',
        });
        return;
      }
      const snapshot = await input.provider.retrieveSubscription({
        environment,
        externalSubscriptionId,
        observedAt,
      });
      const proposedLifecycle = eventResolution?.lifecycleOverride ?? snapshot.lifecycle;
      const paidPeriod = eventResolution?.paidPeriodEvidence;
      const failedPayment = eventResolution?.failedPaymentEvidence;
      const appliedPeriodStartsAt =
        eventType === 'invoice.paid'
          ? paidPeriod?.currentPeriodStartsAt
          : isStripeFailedPaymentEventType(eventType)
            ? failedPayment?.currentPeriodStartsAt
            : snapshot.currentPeriodStartsAt;
      const appliedPeriodEndsAt =
        eventType === 'invoice.paid'
          ? paidPeriod?.currentPeriodEndsAt
          : isStripeFailedPaymentEventType(eventType)
            ? failedPayment?.currentPeriodEndsAt
            : snapshot.currentPeriodEndsAt;
      const paidEvidenceMatches =
        eventType !== 'invoice.paid' ||
        (paidPeriod !== undefined &&
          paidPeriod.externalSubscriptionId === externalSubscriptionId &&
          paidPeriod.providerPriceId === binding?.providerPriceId &&
          paidPeriod.providerProductId === snapshot.providerProductId &&
          paidPeriod.providerSubscriptionItemId === snapshot.providerSubscriptionItemId &&
          paidPeriod.currentPeriodStartsAt.getTime() ===
            snapshot.currentPeriodStartsAt?.getTime() &&
          paidPeriod.currentPeriodEndsAt.getTime() === snapshot.currentPeriodEndsAt?.getTime());
      const failedEvidenceMatches =
        !isStripeFailedPaymentEventType(eventType) ||
        (failedPayment !== undefined &&
          failedPayment.externalSubscriptionId === externalSubscriptionId &&
          failedPayment.providerPriceId === binding?.providerPriceId &&
          failedPayment.providerProductId === snapshot.providerProductId &&
          failedPayment.providerSubscriptionItemId === snapshot.providerSubscriptionItemId);
      const evidenceMatches =
        binding !== null &&
        snapshot.externalSubscriptionId === externalSubscriptionId &&
        snapshot.providerObjectId === externalSubscriptionId &&
        proposedLifecycle !== undefined &&
        snapshot.providerPriceId === binding.providerPriceId &&
        snapshot.providerProductId !== undefined &&
        snapshot.providerSubscriptionItemId !== undefined &&
        snapshot.subscriptionOfferExact === true &&
        snapshot.billingInterval === binding.billingInterval &&
        appliedPeriodStartsAt !== undefined &&
        appliedPeriodEndsAt !== undefined &&
        appliedPeriodEndsAt > appliedPeriodStartsAt &&
        paidEvidenceMatches &&
        failedEvidenceMatches &&
        !snapshot.requiresReconciliation &&
        invoiceSnapshotIsCompatible(eventType, proposedLifecycle);

      if (!evidenceMatches || binding === null || proposedLifecycle === undefined) {
        await input.commerce.quarantineProviderEvent({
          inboxId,
          errorCode: 'stripe.reconciliation_evidence_mismatch',
          now: observedAt,
        });
        await input.commerce.completeReconciliation({
          id: reconciliationRunId,
          provider: 'stripe',
          environment,
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
          whyFounderRequired:
            'The authenticated provider snapshot conflicts with canonical billing.',
        });
        return;
      }

      const ledgerFinancialRestriction =
        eventResolution?.financialRestrictionEvidence === undefined
          ? null
          : await input.commerceRuntime.recordStripeFinancialRestrictionEvent({
              environment,
              householdId: binding.householdId,
              subscriptionId: binding.subscriptionId,
              sourceInboxId: inboxId,
              evidence: eventResolution.financialRestrictionEvidence,
              observedAt,
            });
      const isFinancialEvent =
        eventType === 'charge.refunded' ||
        eventType.startsWith('refund.') ||
        eventType.startsWith('charge.dispute.');
      const effectiveLifecycle = isFinancialEvent
        ? (ledgerFinancialRestriction ?? snapshot.lifecycle)
        : proposedLifecycle;
      if (effectiveLifecycle === undefined) {
        throw new JobExecutionError('commerce_reconciliation_lifecycle_unresolved', true);
      }

      const externalEventId = `reconciliation:${reconciliationRunId}:${String(automaticAttemptCount)}`;
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
        environment,
        externalEventId,
        eventType: 'subscription.reconciliation',
        rawPayload: evidencePayload,
        providerApiVersion: snapshot.providerApiVersion,
        providerObjectId: snapshot.providerObjectId,
        providerEventCreatedAt: observedAt,
        normalizedLifecycle: effectiveLifecycle,
        evidenceTier: evidenceTierValue,
        transportKind,
        transportLivemode: environment === 'production',
        runtimeRunId,
        now: observedAt,
      });
      const application = await input.commerce.applyProviderLifecycle({
        inboxId: captured.id,
        provider: 'stripe',
        environment,
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
            ? {
                kind: 'payment_confirmed',
                sourceInboxId: inboxId,
                evidence: paidPeriod as NonNullable<typeof paidPeriod>,
              }
            : isStripeFailedPaymentEventType(eventType)
              ? {
                  kind: 'payment_failed',
                  sourceInboxId: inboxId,
                  evidence: failedPayment as NonNullable<typeof failedPayment>,
                }
              : { kind: 'non_payment', sourceInboxId: inboxId },
        authoritativeSnapshot: true,
        now: observedAt,
      });
      if (application.outcome === 'quarantined') {
        await input.commerce.markProviderReconciliationAttention({
          id: reconciliationRunId,
          provider: 'stripe',
          environment,
          failureCode: 'stripe.canonical_application_quarantined',
          repairGeneration,
          now: observedAt,
        });
        await input.businessOs.upsertOwnerAttention({
          attentionKind: 'billing_reconciliation',
          consequenceOfInaction:
            'An authentic provider event did not satisfy the canonical access-period rules; access remains unchanged.',
          dedupeKey: `billing_reconciliation_${inboxId}`,
          now: observedAt,
          recommendedAction:
            'Review the paid-through period and canonical subscription before any further reconciliation.',
          sourceId: inboxId,
          sourceType: 'commerce_event',
          whyFounderRequired:
            'The verified snapshot was quarantined by a canonical billing invariant.',
        });
        return;
      }
      if (eventType === 'invoice.paid') {
        await input.commerce.resolveStripeInvoiceFinalizationAttentionFromPaidEvidence({
          environment,
          householdId: binding.householdId,
          subscriptionId: binding.subscriptionId,
          evidence: paidPeriod as NonNullable<typeof paidPeriod>,
          now: observedAt,
        });
      }
      const sourceDispositionRecorded = await input.commerce.ignoreProviderEventAfterReconciliation(
        { inboxId, now: observedAt },
      );
      if (!sourceDispositionRecorded) {
        throw new JobExecutionError('commerce_reconciliation_source_disposition_invalid', false);
      }
      if (eventResolution?.requiresAttention === true) {
        await input.businessOs.upsertOwnerAttention({
          attentionKind: 'billing_reconciliation',
          consequenceOfInaction:
            effectiveLifecycle === 'disputed'
              ? 'Access is suspended while the chargeback is reviewed.'
              : 'A partial or ambiguous refund requires a billing decision.',
          dedupeKey: `billing_reconciliation_${inboxId}`,
          now: observedAt,
          recommendedAction:
            'Review the authenticated Stripe financial event and customer account.',
          sourceId: inboxId,
          sourceType: 'commerce_event',
          whyFounderRequired: 'The event requires a human billing or chargeback decision.',
        });
      }
      const completed = await input.commerce.completeReconciliation({
        id: reconciliationRunId,
        provider: 'stripe',
        environment,
        checkedCount: 1,
        mismatchCount: eventResolution?.requiresAttention === true ? 1 : 0,
        now: observedAt,
      });
      if (!completed) throw new JobExecutionError('commerce_reconciliation_run_lost', false);
    } catch (error) {
      const failureCode =
        error instanceof JobExecutionError
          ? error.code
          : 'stripe.provider_read_or_lineage_unresolved';
      await input.commerce.markProviderReconciliationAttention({
        id: reconciliationRunId,
        provider: 'stripe',
        environment,
        failureCode,
        repairGeneration,
        now: clock(),
      });
      await input.businessOs.upsertOwnerAttention({
        attentionKind: 'billing_reconciliation',
        consequenceOfInaction:
          'Canonical access remains unchanged because provider truth was not observed completely.',
        dedupeKey: `billing_reconciliation_transport_${inboxId}`,
        now: clock(),
        recommendedAction:
          'Review the durable reconciliation receipts; do not infer payment or restriction state.',
        sourceId: inboxId,
        sourceType: 'commerce_event',
        whyFounderRequired:
          'Stripe reconciliation exhausted an attempt without complete provider lineage.',
      });
      if (job.attempts >= job.maxAttempts && repairGeneration < 1) {
        const nextGeneration = repairGeneration + 1;
        const repairKey = `stripe-reconcile-repair:${environment}:${inboxId}:${nextGeneration}`;
        await input.jobs.enqueue({
          type: 'commerce.reconcile',
          version: 1,
          classification: 'internal',
          payload: {
            inboxId,
            reconciliationRunId,
            eventType,
            providerObjectId,
            providerEventCreatedAt: providerEventCreatedAt.toISOString(),
            environment,
            evidenceTier: evidenceTierValue,
            transportKind,
            runtimeRunId,
            repairGeneration: nextGeneration,
            ...(suppliedExternalSubscriptionId === undefined
              ? {}
              : { externalSubscriptionId: suppliedExternalSubscriptionId }),
            ...(householdId === undefined ? {} : { householdId }),
            ...(subscriptionId === undefined ? {} : { subscriptionId }),
            ...(planVersionId === undefined ? {} : { planVersionId }),
          },
          idempotencyKey: repairKey,
          ...(householdId === undefined ? {} : { householdId }),
          scheduledAt: new Date(clock().getTime() + 5 * 60_000),
          maxAttempts: 4,
          correlationId: `stripe-reconcile:${inboxId}`,
          causationId: job.id,
        });
      }
      throw new JobExecutionError(failureCode, true);
    }
  };
}

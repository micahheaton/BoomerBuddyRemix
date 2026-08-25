import { DomainError } from '@boomerbuddy/domain';
import type {
  ProviderFailedPaymentEvidence,
  ProviderPaidPeriodEvidence,
} from '@boomerbuddy/integrations';
import {
  constantTimeEqual,
  fingerprintMinimized,
  minimizeRestrictedInput,
} from '@boomerbuddy/security';
import type { Database } from './database';
import {
  reconcileProtectedMemberAllowanceBindings,
  reconcileTrustedCircleAllowanceBindings,
  type EntitlementRuntimeEnvironment,
} from './entitlements';
import { writeAuditAndOutbox } from './events';
import { enqueueDurableJobWithExecutor, type DurableJobPayload } from './jobs';
import { assertStripeControlOperator } from './stripe-control-operator';
import { randomIdFactory, type IdFactory } from './values';

function jsonObject(value: unknown): Readonly<Record<string, unknown>> {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DomainError('conflict', 'Persisted job evidence is invalid');
  }
  return parsed as Readonly<Record<string, unknown>>;
}

interface InboxRow extends Record<string, unknown> {
  readonly id: string;
  readonly payload_hmac: string;
  readonly fingerprint_key_version: number;
  readonly status: 'received' | 'processing' | 'processed' | 'retry' | 'quarantined';
}

export type CommerceProvider = 'stripe' | 'apple' | 'google';
export type CommerceProviderEnvironment = 'test' | 'sandbox' | 'production';
export type NormalizedCommerceLifecycle =
  | 'pending'
  | 'trialing'
  | 'active'
  | 'grace'
  | 'delinquent'
  | 'paused'
  | 'hold'
  | 'cancel_at_period_end'
  | 'canceled'
  | 'expired'
  | 'refunded'
  | 'disputed'
  | 'restored';

interface ProviderInboxRow extends InboxRow {
  readonly provider: CommerceProvider;
  readonly environment: CommerceProviderEnvironment;
  readonly external_event_id: string;
  readonly event_type: string;
  readonly authenticity: 'verified';
  readonly provider_api_version: string | null;
  readonly provider_object_id: string | null;
  readonly provider_event_created_at: unknown;
  readonly application_state: 'pending' | 'applied' | 'superseded' | 'ignored' | 'quarantined';
  readonly evidence_tier:
    'local_fixture' | 'stripe_test' | 'deployed_staging' | 'live_production' | null;
  readonly transport_kind: 'injected_fixture' | 'stripe_https' | null;
  readonly transport_livemode: boolean | null;
  readonly runtime_run_id: string | null;
}

interface ProviderSubscriptionRow extends Record<string, unknown> {
  readonly id: string;
  readonly household_id: string;
  readonly subscription_id: string;
  readonly last_external_event_id: string | null;
  readonly last_provider_event_created_at: unknown;
  readonly provider_customer_id: string | null;
  readonly financial_restriction: 'refunded' | 'disputed' | null;
}

interface CanonicalSubscriptionRow extends Record<string, unknown> {
  readonly lifecycle: NormalizedCommerceLifecycle;
  readonly source_verified: boolean;
  readonly current_period_starts_at: unknown;
  readonly current_period_ends_at: unknown;
}

interface EntitlementGrantStateRow extends Record<string, unknown> {
  readonly id: string;
  readonly ends_at: unknown;
  readonly revoked_at: unknown;
}

export interface CapturedCommerceEvent {
  readonly id: string;
  readonly duplicate: boolean;
  readonly status: InboxRow['status'];
}

export interface CapturedProviderCommerceEvent extends CapturedCommerceEvent {
  readonly provider: CommerceProvider;
  readonly environment: CommerceProviderEnvironment;
  readonly evidenceTier?: 'local_fixture' | 'stripe_test' | 'deployed_staging' | 'live_production';
  readonly transportKind?: 'injected_fixture' | 'stripe_https';
  readonly transportLivemode?: boolean;
  readonly runtimeRunId?: string;
}

export interface AppliedProviderCommerceEvent {
  readonly eventId: string;
  readonly outcome: 'applied' | 'superseded' | 'quarantined';
  readonly lifecycle: NormalizedCommerceLifecycle;
}

export type ProviderAccessEvidence =
  | { readonly kind: 'non_payment'; readonly sourceInboxId?: string }
  | {
      readonly kind: 'payment_confirmed';
      readonly sourceInboxId: string;
      readonly evidence: ProviderPaidPeriodEvidence;
    }
  | {
      readonly kind: 'payment_failed';
      readonly sourceInboxId: string;
      readonly evidence: ProviderFailedPaymentEvidence;
    };

export interface StripeReconciliationRepairProjection {
  readonly reconciliationRunId: string;
  readonly inboxId: string;
  readonly environment: 'test' | 'production';
  readonly state: 'queued' | 'running' | 'completed' | 'attention' | 'failed';
  readonly failureCode?: string;
  readonly automaticAttemptCount: number;
  readonly authorizedAttemptLimit: number;
  readonly revision: number;
  readonly repairAvailable: boolean;
}

export interface StripeReconciliationRepairResult {
  readonly reconciliationRunId: string;
  readonly inboxId: string;
  readonly environment: 'test' | 'production';
  readonly revision: 1;
  readonly authorizedAttemptLimit: 16;
  readonly repairJobId: string;
  readonly duplicate: boolean;
}

export class CommerceOperationsRepository {
  constructor(
    private readonly database: Database,
    private readonly fingerprintKey: Uint8Array,
    private readonly fingerprintKeyVersion: number,
    private readonly idFactory: IdFactory = randomIdFactory,
    private readonly runtimeEnvironment: EntitlementRuntimeEnvironment = 'production',
  ) {}

  async captureLocalEvent(input: {
    readonly environment: 'local' | 'test';
    readonly externalEventId: string;
    readonly eventType: string;
    readonly canonicalPayload: string;
    readonly now: Date;
  }): Promise<CapturedCommerceEvent> {
    const minimized = minimizeRestrictedInput(input.canonicalPayload, 4_096);
    if (minimized.status === 'rejected') {
      throw new DomainError(
        'restricted_input',
        'Commerce event evidence must not contain credentials or payment details',
      );
    }
    const hmac = fingerprintMinimized(minimized.minimized, this.fingerprintKey, {
      tenantId: `commerce-${input.environment}`,
      purpose: `commerce-event:${input.eventType}`,
      keyVersion: this.fingerprintKeyVersion,
    });
    const id = this.idFactory.next('commerce-event');
    const inserted = await this.database.query(
      `INSERT INTO commerce_event_inbox(
         id, provider, environment, external_event_id, event_type, payload_hmac,
         fingerprint_key_version, authenticity, status, received_at
       ) VALUES ($1,'local',$2,$3,$4,$5,$6,'local_fixture','received',$7)
       ON CONFLICT (provider, environment, external_event_id) DO NOTHING`,
      [
        id,
        input.environment,
        input.externalEventId,
        input.eventType,
        hmac.value,
        hmac.keyVersion,
        input.now.toISOString(),
      ],
    );
    const receipt = await this.database.query<InboxRow>(
      `SELECT id, payload_hmac, fingerprint_key_version, status
       FROM commerce_event_inbox
       WHERE provider = 'local' AND environment = $1 AND external_event_id = $2`,
      [input.environment, input.externalEventId],
    );
    const row = receipt.rows[0];
    if (row === undefined) throw new Error('Commerce event capture did not persist');
    if (
      row.fingerprint_key_version !== hmac.keyVersion ||
      !constantTimeEqual(row.payload_hmac, hmac.value)
    ) {
      throw new DomainError('conflict', 'Commerce event identifier has conflicting evidence');
    }
    return { id: row.id, duplicate: inserted.rowCount === 0, status: row.status };
  }

  async captureVerifiedProviderEvent(input: {
    readonly provider: CommerceProvider;
    readonly environment: CommerceProviderEnvironment;
    readonly externalEventId: string;
    readonly eventType: string;
    readonly rawPayload: string | Uint8Array;
    readonly providerApiVersion: string;
    readonly providerObjectId: string;
    readonly providerEventCreatedAt: Date;
    readonly normalizedLifecycle?: NormalizedCommerceLifecycle;
    readonly evidenceTier?:
      'local_fixture' | 'stripe_test' | 'deployed_staging' | 'live_production';
    readonly transportKind?: 'injected_fixture' | 'stripe_https';
    readonly transportLivemode?: boolean;
    readonly runtimeRunId?: string;
    readonly signatureVerifiedAt?: Date;
    readonly now: Date;
  }): Promise<CapturedProviderCommerceEvent> {
    if (
      input.externalEventId.trim() === '' ||
      input.eventType.trim() === '' ||
      input.providerApiVersion.trim() === '' ||
      input.providerObjectId.trim() === '' ||
      !Number.isFinite(input.providerEventCreatedAt.getTime()) ||
      !Number.isFinite(input.now.getTime())
    ) {
      throw new DomainError('invalid_input', 'Invalid verified commerce event envelope');
    }
    const rawBytes =
      typeof input.rawPayload === 'string'
        ? Buffer.from(input.rawPayload, 'utf8')
        : input.rawPayload;
    if (rawBytes.byteLength === 0 || rawBytes.byteLength > 256 * 1_024) {
      throw new DomainError('invalid_input', 'Commerce event envelope size is invalid');
    }
    const hmac = fingerprintMinimized(rawBytes, this.fingerprintKey, {
      tenantId: `commerce-${input.provider}-${input.environment}`,
      purpose: `verified-commerce-event:${input.eventType}`,
      keyVersion: this.fingerprintKeyVersion,
    });
    const id = this.idFactory.next('commerce-event');
    const inserted = await this.database.query(
      `INSERT INTO commerce_event_inbox(
         id, provider, environment, external_event_id, event_type, payload_hmac,
         fingerprint_key_version, authenticity, status, received_at,
         provider_api_version, provider_object_id, provider_event_created_at,
         normalized_lifecycle, application_state, evidence_tier, transport_kind,
         transport_livemode, runtime_run_id, signature_verified_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'verified','received',$8,$9,$10,$11,$12,'pending',
                 $13,$14,$15,$16,$17)
       ON CONFLICT (provider, environment, external_event_id) DO NOTHING`,
      [
        id,
        input.provider,
        input.environment,
        input.externalEventId,
        input.eventType,
        hmac.value,
        hmac.keyVersion,
        input.now.toISOString(),
        input.providerApiVersion,
        input.providerObjectId,
        input.providerEventCreatedAt.toISOString(),
        input.normalizedLifecycle ?? null,
        input.evidenceTier ?? null,
        input.transportKind ?? null,
        input.transportLivemode ?? null,
        input.runtimeRunId ?? null,
        input.signatureVerifiedAt?.toISOString() ?? null,
      ],
    );
    const receipt = await this.database.query<ProviderInboxRow>(
      `SELECT id, provider, environment, external_event_id, event_type, payload_hmac,
              fingerprint_key_version, status, authenticity, provider_api_version,
              provider_object_id, provider_event_created_at, application_state
              , evidence_tier, transport_kind, transport_livemode, runtime_run_id
       FROM commerce_event_inbox
       WHERE provider = $1 AND environment = $2 AND external_event_id = $3`,
      [input.provider, input.environment, input.externalEventId],
    );
    const row = receipt.rows[0];
    if (row === undefined) throw new Error('Verified commerce event capture did not persist');
    if (
      row.fingerprint_key_version !== hmac.keyVersion ||
      !constantTimeEqual(row.payload_hmac, hmac.value) ||
      row.event_type !== input.eventType ||
      row.provider_api_version !== input.providerApiVersion ||
      row.provider_object_id !== input.providerObjectId
    ) {
      throw new DomainError('conflict', 'Commerce event identifier has conflicting evidence');
    }
    return {
      id: row.id,
      provider: row.provider,
      environment: row.environment,
      duplicate: inserted.rowCount === 0,
      status: row.status,
      ...(row.evidence_tier === null ? {} : { evidenceTier: row.evidence_tier }),
      ...(row.transport_kind === null ? {} : { transportKind: row.transport_kind }),
      ...(row.transport_livemode === null ? {} : { transportLivemode: row.transport_livemode }),
      ...(row.runtime_run_id === null ? {} : { runtimeRunId: row.runtime_run_id }),
    };
  }

  async applyProviderLifecycle(input: {
    readonly inboxId: string;
    readonly provider: CommerceProvider;
    readonly environment: CommerceProviderEnvironment;
    readonly externalEventId: string;
    readonly providerApiVersion: string;
    readonly providerObjectId: string;
    readonly providerEventCreatedAt: Date;
    readonly householdId: string;
    readonly subscriptionId: string;
    readonly externalSubscriptionId: string;
    readonly providerCustomerId?: string;
    readonly lifecycle: NormalizedCommerceLifecycle;
    readonly currentPeriodStartsAt: Date;
    readonly currentPeriodEndsAt: Date;
    readonly accessEvidence: ProviderAccessEvidence;
    readonly authoritativeSnapshot?: boolean;
    readonly now: Date;
  }): Promise<AppliedProviderCommerceEvent> {
    if (
      !Number.isFinite(input.currentPeriodStartsAt.getTime()) ||
      !Number.isFinite(input.currentPeriodEndsAt.getTime()) ||
      input.currentPeriodEndsAt <= input.currentPeriodStartsAt
    ) {
      throw new DomainError('invalid_input', 'Provider access period is invalid');
    }
    return this.database.transaction(async (transaction) => {
      const eventResult = await transaction.query<ProviderInboxRow>(
        `SELECT id, provider, environment, external_event_id, event_type, payload_hmac,
                fingerprint_key_version, status, authenticity, provider_api_version,
                provider_object_id, provider_event_created_at, application_state
         FROM commerce_event_inbox WHERE id = $1 FOR UPDATE`,
        [input.inboxId],
      );
      const event = eventResult.rows[0];
      if (
        event === undefined ||
        event.authenticity !== 'verified' ||
        event.provider !== input.provider ||
        event.environment !== input.environment ||
        event.external_event_id !== input.externalEventId ||
        event.provider_api_version !== input.providerApiVersion ||
        event.provider_object_id !== input.providerObjectId ||
        event.application_state === 'quarantined'
      ) {
        throw new DomainError('conflict', 'Verified commerce event linkage is invalid');
      }
      const evidenceEvent =
        input.accessEvidence.sourceInboxId === undefined
          ? event
          : (
              await transaction.query<ProviderInboxRow>(
                `SELECT id, provider, environment, external_event_id, event_type, payload_hmac,
                        fingerprint_key_version, status, authenticity, provider_api_version,
                        provider_object_id, provider_event_created_at, application_state
                 FROM commerce_event_inbox WHERE id = $1 FOR UPDATE`,
                [input.accessEvidence.sourceInboxId],
              )
            ).rows[0];
      if (
        evidenceEvent === undefined ||
        evidenceEvent.authenticity !== 'verified' ||
        evidenceEvent.provider !== input.provider ||
        evidenceEvent.environment !== input.environment ||
        evidenceEvent.application_state === 'quarantined' ||
        (input.accessEvidence.kind === 'payment_confirmed' &&
          evidenceEvent.event_type !== 'invoice.paid') ||
        (input.accessEvidence.kind === 'payment_failed' &&
          evidenceEvent.event_type !== 'invoice.payment_failed') ||
        (input.accessEvidence.kind !== 'payment_confirmed' &&
          evidenceEvent.event_type === 'invoice.paid') ||
        (input.accessEvidence.kind !== 'payment_failed' &&
          evidenceEvent.event_type === 'invoice.payment_failed')
      ) {
        throw new DomainError('conflict', 'Provider access evidence is invalid');
      }
      if (event.application_state === 'applied' || event.application_state === 'superseded') {
        return {
          eventId: event.id,
          outcome: event.application_state,
          lifecycle: input.lifecycle,
        };
      }
      const providerRecord = await transaction.query<ProviderSubscriptionRow>(
        `SELECT id, household_id, subscription_id, last_external_event_id, last_provider_event_created_at,
                provider_customer_id, financial_restriction
         FROM commerce_provider_subscription_records
         WHERE provider = $1 AND environment = $2 AND external_subscription_id = $3
         FOR UPDATE`,
        [input.provider, input.environment, input.externalSubscriptionId],
      );
      const previous = providerRecord.rows[0];
      if (input.provider === 'stripe' && previous === undefined) {
        const completedCheckout = await transaction.query<
          { readonly provider_customer_id: string } & Record<string, unknown>
        >(
          `SELECT provider_customer_id
           FROM commerce_stripe_checkout_completions
           WHERE environment = $1 AND household_id = $2 AND subscription_id = $3
             AND provider_subscription_id = $4`,
          [
            input.environment,
            input.householdId,
            input.subscriptionId,
            input.externalSubscriptionId,
          ],
        );
        const completedProviderCustomerId = completedCheckout.rows[0]?.provider_customer_id;
        if (
          completedProviderCustomerId === undefined ||
          (input.providerCustomerId !== undefined &&
            input.providerCustomerId !== completedProviderCustomerId)
        ) {
          throw new DomainError(
            'conflict',
            'Stripe subscription is not bound to an exact completed Checkout Session',
          );
        }
      }
      const newFinancialRestriction =
        input.lifecycle === 'refunded' || input.lifecycle === 'disputed' ? input.lifecycle : null;
      const stripeLedgerRestriction =
        input.provider !== 'stripe'
          ? undefined
          : (
              await transaction.query<
                { readonly restriction_kind: 'refund' | 'dispute' } & Record<string, unknown>
              >(
                `WITH latest AS (
                   SELECT DISTINCT ON (restriction_kind, provider_restriction_id)
                          restriction_kind, provider_restriction_id, provider_charge_id,
                          provider_charge_amount, restriction_amount, event_state
                   FROM commerce_stripe_financial_restriction_events
                   WHERE environment = $1 AND household_id = $2 AND subscription_id = $3
                   ORDER BY restriction_kind, provider_restriction_id, observed_at DESC,
                            CASE event_state WHEN 'retained' THEN 3
                              WHEN 'cleared' THEN 2 ELSE 1 END DESC, id DESC
                 ), unresolved AS (
                   SELECT 'dispute'::text AS restriction_kind
                   FROM latest WHERE restriction_kind = 'dispute' AND event_state <> 'cleared'
                   LIMIT 1
                 ), fully_refunded AS (
                   SELECT 'refund'::text AS restriction_kind
                   FROM latest
                   WHERE restriction_kind = 'refund' AND event_state <> 'cleared'
                   GROUP BY provider_charge_id
                   HAVING sum(restriction_amount) = max(provider_charge_amount)
                   LIMIT 1
                 ), candidates AS (
                   SELECT restriction_kind, 0 AS priority FROM unresolved
                   UNION ALL
                   SELECT restriction_kind, 1 AS priority FROM fully_refunded
                 )
                 SELECT restriction_kind FROM candidates
                 ORDER BY priority
                 LIMIT 1`,
                [input.environment, input.householdId, input.subscriptionId],
              )
            ).rows[0]?.restriction_kind;
      const effectiveFinancialRestriction =
        input.provider === 'stripe'
          ? stripeLedgerRestriction === 'dispute'
            ? ('disputed' as const)
            : stripeLedgerRestriction === 'refund'
              ? ('refunded' as const)
              : null
          : previous?.financial_restriction === 'disputed' || newFinancialRestriction === 'disputed'
            ? ('disputed' as const)
            : (newFinancialRestriction ?? previous?.financial_restriction);
      const effectiveLifecycle = effectiveFinancialRestriction ?? input.lifecycle;
      if (
        previous !== undefined &&
        (previous.household_id !== input.householdId ||
          previous.subscription_id !== input.subscriptionId)
      ) {
        throw new DomainError('conflict', 'Provider subscription binding cannot be changed');
      }
      if (
        previous?.provider_customer_id !== null &&
        previous?.provider_customer_id !== undefined &&
        input.providerCustomerId !== undefined &&
        previous.provider_customer_id !== input.providerCustomerId
      ) {
        throw new DomainError('conflict', 'Provider customer linkage cannot be changed');
      }
      const source = input.provider === 'stripe' ? 'web' : input.provider;
      const canonicalResult = await transaction.query<CanonicalSubscriptionRow>(
        `SELECT lifecycle, source_verified, current_period_starts_at, current_period_ends_at
         FROM commerce_subscriptions
         WHERE household_id = $1 AND id = $2 AND source = $3
         FOR UPDATE`,
        [input.householdId, input.subscriptionId, source],
      );
      const canonicalBefore = canonicalResult.rows[0];
      if (canonicalBefore === undefined) {
        throw new DomainError('conflict', 'Canonical commerce subscription linkage is invalid');
      }
      const canonicalStart = new Date(String(canonicalBefore.current_period_starts_at));
      const canonicalEnd =
        canonicalBefore.current_period_ends_at === null
          ? null
          : new Date(String(canonicalBefore.current_period_ends_at));
      if (
        !Number.isFinite(canonicalStart.getTime()) ||
        (canonicalEnd !== null && !Number.isFinite(canonicalEnd.getTime()))
      ) {
        throw new DomainError('conflict', 'Canonical commerce access period is invalid');
      }
      const activeDunning = await transaction.query<
        {
          readonly dunning_window_key: string;
          readonly paid_through_at: unknown;
          readonly grace_starts_at: unknown;
          readonly grace_ends_at: unknown;
        } & Record<string, unknown>
      >(
        `SELECT opened.dunning_window_key, opened.paid_through_at,
                opened.grace_starts_at, opened.grace_ends_at
         FROM commerce_stripe_dunning_events opened
         WHERE opened.environment = $1 AND opened.household_id = $2
           AND opened.subscription_id = $3 AND opened.event_kind = 'opened'
           AND NOT EXISTS (
             SELECT 1 FROM commerce_stripe_dunning_events closure
             WHERE closure.dunning_window_key = opened.dunning_window_key
               AND closure.event_kind IN ('recovered','expired')
           )
         ORDER BY opened.occurred_at DESC, opened.id DESC LIMIT 1
         FOR UPDATE`,
        [input.environment, input.householdId, input.subscriptionId],
      );
      const activeDunningWindow = activeDunning.rows[0];
      const paymentConfirmed = input.accessEvidence.kind === 'payment_confirmed';
      const paymentFailed = input.accessEvidence.kind === 'payment_failed';
      const dunningPaidThroughAt =
        activeDunningWindow === undefined
          ? null
          : new Date(String(activeDunningWindow.paid_through_at));
      const dunningGraceEndsAtFromLedger =
        activeDunningWindow === undefined
          ? null
          : new Date(String(activeDunningWindow.grace_ends_at));
      const paidComparisonEnd = dunningPaidThroughAt ?? canonicalEnd;
      const paymentWouldCrossUnprovedGap =
        paymentConfirmed &&
        paidComparisonEnd !== null &&
        input.currentPeriodEndsAt > paidComparisonEnd &&
        input.currentPeriodStartsAt > paidComparisonEnd;
      if (paymentWouldCrossUnprovedGap) {
        await transaction.query(
          `UPDATE commerce_event_inbox
           SET status = 'quarantined', application_state = 'quarantined',
               error_code = 'provider.payment_period_gap', processed_at = $2
           WHERE id = $1`,
          [input.inboxId, input.now.toISOString()],
        );
        await transaction.query(
          `UPDATE commerce_subscriptions
           SET reconciliation_state = 'attention', updated_at = $3
           WHERE household_id = $1 AND id = $2`,
          [input.householdId, input.subscriptionId, input.now.toISOString()],
        );
        return { eventId: input.inboxId, outcome: 'quarantined', lifecycle: input.lifecycle };
      }
      let checkoutIntentId: string | undefined;
      if (paymentConfirmed) {
        const proof = input.accessEvidence.evidence;
        const checkout = await transaction.query<
          { readonly checkout_intent_id: string } & Record<string, unknown>
        >(
          `SELECT checkout_intent_id
           FROM commerce_stripe_checkout_completions
           WHERE environment = $1 AND household_id = $2 AND subscription_id = $3
             AND provider_subscription_id = $4`,
          [
            input.environment,
            input.householdId,
            input.subscriptionId,
            input.externalSubscriptionId,
          ],
        );
        checkoutIntentId = checkout.rows[0]?.checkout_intent_id;
        if (
          checkoutIntentId === undefined ||
          proof.providerInvoiceId !== evidenceEvent.provider_object_id ||
          proof.externalSubscriptionId !== input.externalSubscriptionId ||
          proof.currentPeriodStartsAt.getTime() !== input.currentPeriodStartsAt.getTime() ||
          proof.currentPeriodEndsAt.getTime() !== input.currentPeriodEndsAt.getTime()
        ) {
          throw new DomainError('conflict', 'Paid invoice is not bound to the completed Checkout');
        }
        const recorded = await transaction.query(
          `INSERT INTO commerce_stripe_paid_invoice_evidence(
             provider_invoice_id, environment, household_id, subscription_id,
              checkout_intent_id, provider_subscription_id,
              provider_subscription_item_id, provider_payment_intent_id,
              provider_invoice_payment_id,
              source_inbox_id, billing_reason, amount_paid, amount_remaining,
             currency, quantity, discount_amount, tax_amount, period_starts_at,
             period_ends_at, provider_paid_at, recorded_at, evidence_digest
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
           ON CONFLICT (provider_invoice_id) DO NOTHING`,
          [
            proof.providerInvoiceId,
            input.environment,
            input.householdId,
            input.subscriptionId,
            checkoutIntentId,
            proof.externalSubscriptionId,
            proof.providerSubscriptionItemId,
            proof.providerPaymentIntentId,
            proof.providerInvoicePaymentId,
            input.accessEvidence.sourceInboxId,
            proof.billingReason,
            proof.amountPaid,
            proof.amountRemaining,
            proof.currency,
            proof.quantity,
            proof.discountAmount,
            proof.taxAmount,
            proof.currentPeriodStartsAt.toISOString(),
            proof.currentPeriodEndsAt.toISOString(),
            proof.providerPaidAt.toISOString(),
            input.now.toISOString(),
            evidenceEvent.payload_hmac,
          ],
        );
        if (recorded.rowCount === 0) {
          const exactExistingProof = await transaction.query(
            `SELECT 1 FROM commerce_stripe_paid_invoice_evidence
             WHERE provider_invoice_id = $1 AND environment = $2 AND household_id = $3
               AND subscription_id = $4 AND checkout_intent_id = $5
                AND provider_subscription_id = $6 AND provider_subscription_item_id = $7
                AND provider_payment_intent_id = $8 AND provider_invoice_payment_id = $9
                AND source_inbox_id = $10
                AND billing_reason = $11 AND amount_paid = $12 AND amount_remaining = $13
                AND currency = $14 AND quantity = $15 AND discount_amount = $16
                AND tax_amount = $17 AND period_starts_at = $18 AND period_ends_at = $19
                AND provider_paid_at = $20 AND evidence_digest = $21`,
            [
              proof.providerInvoiceId,
              input.environment,
              input.householdId,
              input.subscriptionId,
              checkoutIntentId,
              proof.externalSubscriptionId,
              proof.providerSubscriptionItemId,
              proof.providerPaymentIntentId,
              proof.providerInvoicePaymentId,
              input.accessEvidence.sourceInboxId,
              proof.billingReason,
              proof.amountPaid,
              proof.amountRemaining,
              proof.currency,
              proof.quantity,
              proof.discountAmount,
              proof.taxAmount,
              proof.currentPeriodStartsAt.toISOString(),
              proof.currentPeriodEndsAt.toISOString(),
              proof.providerPaidAt.toISOString(),
              evidenceEvent.payload_hmac,
            ],
          );
          if (exactExistingProof.rowCount !== 1) {
            throw new DomainError('conflict', 'Paid invoice evidence conflicts with prior proof');
          }
        }
        await transaction.query(
          `INSERT INTO commerce_stripe_invoice_authority_facts(
             provider_invoice_id, provider_invoice_line_id,
             provider_subscription_item_id, provider_product_id, provider_price_id,
             invoice_discounts_empty, invoice_taxes_empty, invoice_credits_empty,
             subscription_page_complete, recorded_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9)
           ON CONFLICT (provider_invoice_id) DO NOTHING`,
          [
            proof.providerInvoiceId,
            proof.providerInvoiceLineId,
            proof.providerSubscriptionItemId,
            proof.providerProductId,
            proof.providerPriceId,
            proof.invoiceDiscountsEmpty,
            proof.invoiceTaxesEmpty,
            proof.invoiceCreditsEmpty,
            input.now.toISOString(),
          ],
        );
        const immutableFacts = await transaction.query<
          {
            readonly provider_invoice_line_id: string;
            readonly provider_subscription_item_id: string;
            readonly provider_product_id: string;
            readonly provider_price_id: string;
          } & Record<string, unknown>
        >(
          `SELECT provider_invoice_line_id, provider_subscription_item_id,
                  provider_product_id, provider_price_id
           FROM commerce_stripe_invoice_authority_facts WHERE provider_invoice_id = $1`,
          [proof.providerInvoiceId],
        );
        const facts = immutableFacts.rows[0];
        if (
          facts === undefined ||
          facts.provider_invoice_line_id !== proof.providerInvoiceLineId ||
          facts.provider_subscription_item_id !== proof.providerSubscriptionItemId ||
          facts.provider_product_id !== proof.providerProductId ||
          facts.provider_price_id !== proof.providerPriceId
        ) {
          throw new DomainError('conflict', 'Paid invoice immutable authority facts conflict');
        }
        if (activeDunningWindow !== undefined) {
          await transaction.query(
            `INSERT INTO commerce_stripe_dunning_events(
               id, environment, household_id, subscription_id, provider_invoice_id,
               dunning_window_key,
               event_kind, paid_through_at, grace_starts_at, grace_ends_at,
               source_inbox_id, evidence_digest, occurred_at
             ) VALUES ($1,$2,$3,$4,$5,$6,'recovered',$7,$8,$9,$10,$11,$12)
             ON CONFLICT (dunning_window_key, event_kind) DO NOTHING`,
            [
              this.idFactory.next('stripe-dunning-event'),
              input.environment,
              input.householdId,
              input.subscriptionId,
              proof.providerInvoiceId,
              activeDunningWindow.dunning_window_key,
              new Date(String(activeDunningWindow.paid_through_at)).toISOString(),
              new Date(String(activeDunningWindow.grace_starts_at)).toISOString(),
              new Date(String(activeDunningWindow.grace_ends_at)).toISOString(),
              input.accessEvidence.sourceInboxId,
              evidenceEvent.payload_hmac,
              input.now.toISOString(),
            ],
          );
        }
      } else if (paymentFailed) {
        const proof = input.accessEvidence.evidence;
        if (
          proof.providerInvoiceId !== evidenceEvent.provider_object_id ||
          proof.externalSubscriptionId !== input.externalSubscriptionId ||
          proof.currentPeriodStartsAt.getTime() !== input.currentPeriodStartsAt.getTime() ||
          proof.currentPeriodEndsAt.getTime() !== input.currentPeriodEndsAt.getTime()
        ) {
          throw new DomainError('conflict', 'Failed invoice is not bound to the current period');
        }
        const failedRecorded = await transaction.query(
          `INSERT INTO commerce_stripe_failed_invoice_evidence(
             provider_invoice_id, environment, household_id, subscription_id,
              provider_subscription_id, provider_subscription_item_id, source_inbox_id,
              provider_payment_intent_id, provider_invoice_payment_id,
              billing_reason, amount_due, currency, quantity,
             attempt_count, failure_status, occurred_at, evidence_digest,
             provider_invoice_line_id, provider_product_id, provider_price_id,
             line_proration, period_starts_at, period_ends_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                      $18,$19,$20,$21,$22,$23)
           ON CONFLICT (provider_invoice_id) DO NOTHING`,
          [
            proof.providerInvoiceId,
            input.environment,
            input.householdId,
            input.subscriptionId,
            proof.externalSubscriptionId,
            proof.providerSubscriptionItemId,
            input.accessEvidence.sourceInboxId,
            proof.providerPaymentIntentId ?? null,
            proof.providerInvoicePaymentId,
            proof.billingReason,
            proof.amountDue,
            proof.currency,
            proof.quantity,
            proof.attemptCount,
            proof.failureStatus,
            input.now.toISOString(),
            evidenceEvent.payload_hmac,
            proof.providerInvoiceLineId,
            proof.providerProductId,
            proof.providerPriceId,
            proof.lineProration,
            proof.currentPeriodStartsAt.toISOString(),
            proof.currentPeriodEndsAt.toISOString(),
          ],
        );
        if (failedRecorded.rowCount === 0) {
          const exactExistingFailure = await transaction.query(
            `SELECT 1 FROM commerce_stripe_failed_invoice_evidence
             WHERE provider_invoice_id = $1 AND environment = $2 AND household_id = $3
               AND subscription_id = $4 AND provider_subscription_id = $5
               AND provider_subscription_item_id = $6 AND source_inbox_id = $7
               AND provider_payment_intent_id IS NOT DISTINCT FROM $8
               AND provider_invoice_payment_id = $9 AND billing_reason = $10
               AND amount_due = $11 AND currency = $12 AND quantity = $13
               AND attempt_count = $14 AND failure_status = $15
               AND evidence_digest = $16 AND provider_invoice_line_id = $17
               AND provider_product_id = $18 AND provider_price_id = $19
               AND line_proration = $20 AND period_starts_at = $21 AND period_ends_at = $22`,
            [
              proof.providerInvoiceId,
              input.environment,
              input.householdId,
              input.subscriptionId,
              proof.externalSubscriptionId,
              proof.providerSubscriptionItemId,
              input.accessEvidence.sourceInboxId,
              proof.providerPaymentIntentId ?? null,
              proof.providerInvoicePaymentId,
              proof.billingReason,
              proof.amountDue,
              proof.currency,
              proof.quantity,
              proof.attemptCount,
              proof.failureStatus,
              evidenceEvent.payload_hmac,
              proof.providerInvoiceLineId,
              proof.providerProductId,
              proof.providerPriceId,
              proof.lineProration,
              proof.currentPeriodStartsAt.toISOString(),
              proof.currentPeriodEndsAt.toISOString(),
            ],
          );
          if (exactExistingFailure.rowCount !== 1) {
            throw new DomainError('conflict', 'Failed invoice evidence conflicts with prior proof');
          }
        }
        if (
          canonicalBefore.source_verified &&
          canonicalEnd !== null &&
          activeDunningWindow === undefined
        ) {
          const graceEndsAt = new Date(canonicalEnd.getTime() + 3 * 24 * 60 * 60_000);
          await transaction.query(
            `INSERT INTO commerce_stripe_dunning_events(
               id, environment, household_id, subscription_id, provider_invoice_id,
               dunning_window_key,
               event_kind, paid_through_at, grace_starts_at, grace_ends_at,
               source_inbox_id, evidence_digest, occurred_at
             ) VALUES ($1,$2,$3,$4,$5,$5,'opened',$6,$6,$7,$8,$9,$10)
             ON CONFLICT (source_inbox_id, event_kind) DO NOTHING`,
            [
              this.idFactory.next('stripe-dunning-event'),
              input.environment,
              input.householdId,
              input.subscriptionId,
              proof.providerInvoiceId,
              canonicalEnd.toISOString(),
              graceEndsAt.toISOString(),
              input.accessEvidence.sourceInboxId,
              evidenceEvent.payload_hmac,
              input.now.toISOString(),
            ],
          );
        }
      }
      const paymentCoversCanonicalPeriod =
        paymentConfirmed &&
        input.currentPeriodEndsAt > input.now &&
        (paidComparisonEnd === null ||
          (input.currentPeriodEndsAt >= paidComparisonEnd &&
            input.currentPeriodStartsAt <= paidComparisonEnd));
      const mayActivateAccess = paymentCoversCanonicalPeriod;
      const dunningGraceEndsAt =
        paymentFailed && canonicalBefore.source_verified && canonicalEnd !== null
          ? (dunningGraceEndsAtFromLedger ??
            new Date(canonicalEnd.getTime() + 3 * 24 * 60 * 60_000))
          : null;
      const canonicalLifecycle =
        dunningGraceEndsAt !== null && dunningGraceEndsAt > input.now
          ? 'grace'
          : !canonicalBefore.source_verified &&
              !paymentConfirmed &&
              ['trialing', 'active', 'cancel_at_period_end', 'restored'].includes(
                effectiveLifecycle,
              )
            ? 'pending'
            : effectiveLifecycle;
      let canonicalPeriodStartsAt = input.currentPeriodStartsAt;
      let canonicalPeriodEndsAt: Date | null = input.currentPeriodEndsAt;
      if (!paymentConfirmed) {
        canonicalPeriodStartsAt = canonicalStart;
        if (paymentFailed && canonicalBefore.source_verified && canonicalEnd !== null) {
          canonicalPeriodEndsAt = dunningGraceEndsAt;
        } else if (canonicalEnd === null) {
          canonicalPeriodEndsAt = null;
        } else if (
          input.currentPeriodEndsAt < canonicalEnd &&
          input.currentPeriodEndsAt > canonicalStart
        ) {
          canonicalPeriodEndsAt = input.currentPeriodEndsAt;
        } else {
          canonicalPeriodEndsAt = canonicalEnd;
        }
      } else if (
        paymentConfirmed &&
        paidComparisonEnd !== null &&
        input.currentPeriodEndsAt <= paidComparisonEnd
      ) {
        canonicalPeriodStartsAt = canonicalStart;
        canonicalPeriodEndsAt = paidComparisonEnd;
      }
      if (input.providerCustomerId !== undefined) {
        await transaction.query(
          `INSERT INTO commerce_provider_customers(
             provider, environment, provider_customer_id, household_id, verified_at
           ) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (provider, environment, provider_customer_id) DO NOTHING`,
          [
            input.provider,
            input.environment,
            input.providerCustomerId,
            input.householdId,
            input.now.toISOString(),
          ],
        );
        const customerBinding = await transaction.query<
          { readonly household_id: string } & Record<string, unknown>
        >(
          `SELECT household_id FROM commerce_provider_customers
           WHERE provider = $1 AND environment = $2 AND provider_customer_id = $3
           FOR UPDATE`,
          [input.provider, input.environment, input.providerCustomerId],
        );
        if (customerBinding.rows[0]?.household_id !== input.householdId) {
          throw new DomainError('conflict', 'Provider customer belongs to another household');
        }
      }
      const previousTime =
        previous?.last_provider_event_created_at === null ||
        previous?.last_provider_event_created_at === undefined
          ? null
          : new Date(String(previous.last_provider_event_created_at));
      const sameSecondAmbiguous =
        !input.authoritativeSnapshot &&
        previousTime !== null &&
        previousTime.getTime() === input.providerEventCreatedAt.getTime() &&
        previous?.last_external_event_id !== input.externalEventId;
      if (sameSecondAmbiguous) {
        await transaction.query(
          `UPDATE commerce_event_inbox
           SET status = 'quarantined', application_state = 'quarantined',
               error_code = 'provider.same_second_order_ambiguous', processed_at = $2
           WHERE id = $1`,
          [input.inboxId, input.now.toISOString()],
        );
        await transaction.query(
          `UPDATE commerce_subscriptions
           SET reconciliation_state = 'attention', updated_at = $3
           WHERE household_id = $1 AND id = $2`,
          [input.householdId, input.subscriptionId, input.now.toISOString()],
        );
        return { eventId: input.inboxId, outcome: 'quarantined', lifecycle: input.lifecycle };
      }
      const superseded =
        !input.authoritativeSnapshot &&
        previousTime !== null &&
        previousTime.getTime() > input.providerEventCreatedAt.getTime();
      if (superseded) {
        await transaction.query(
          `UPDATE commerce_event_inbox
           SET status = 'processed', application_state = 'superseded', processed_at = $2
           WHERE id = $1`,
          [input.inboxId, input.now.toISOString()],
        );
        return { eventId: input.inboxId, outcome: 'superseded', lifecycle: input.lifecycle };
      }
      if (previous === undefined) {
        await transaction.query(
          `INSERT INTO commerce_provider_subscription_records(
             id, household_id, subscription_id, provider, environment,
             external_subscription_id, raw_state, provider_version, observed_at, verified_at,
             last_external_event_id, last_provider_event_created_at, last_provider_api_version,
             provider_customer_id, financial_restriction, financial_restriction_event_id,
             financial_restricted_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$8,$12,$13,$14,$15)`,
          [
            this.idFactory.next('provider-subscription'),
            input.householdId,
            input.subscriptionId,
            input.provider,
            input.environment,
            input.externalSubscriptionId,
            effectiveLifecycle,
            input.providerApiVersion,
            input.now.toISOString(),
            input.externalEventId,
            input.providerEventCreatedAt.toISOString(),
            input.providerCustomerId ?? null,
            effectiveFinancialRestriction,
            effectiveFinancialRestriction === null
              ? null
              : (input.accessEvidence.sourceInboxId ?? input.externalEventId),
            effectiveFinancialRestriction === null ? null : input.now.toISOString(),
          ],
        );
      } else {
        await transaction.query(
          `UPDATE commerce_provider_subscription_records
           SET household_id = $2, subscription_id = $3, raw_state = $4,
               provider_version = $5, observed_at = $6, verified_at = $6,
               last_external_event_id = $7, last_provider_event_created_at = $8,
               last_provider_api_version = $5,
               provider_customer_id = COALESCE(provider_customer_id, $9)
               , financial_restriction = $10
               , financial_restriction_event_id = $11
               , financial_restricted_at = $12
           WHERE id = $1`,
          [
            previous.id,
            input.householdId,
            input.subscriptionId,
            effectiveLifecycle,
            input.providerApiVersion,
            input.now.toISOString(),
            input.externalEventId,
            input.providerEventCreatedAt.toISOString(),
            input.providerCustomerId ?? null,
            effectiveFinancialRestriction,
            effectiveFinancialRestriction === null
              ? null
              : (input.accessEvidence.sourceInboxId ?? input.externalEventId),
            effectiveFinancialRestriction === null ? null : input.now.toISOString(),
          ],
        );
      }
      const canonical = await transaction.query(
        `UPDATE commerce_subscriptions
         SET lifecycle = $3, source_verified = (source_verified OR $8), reconciliation_state = 'reconciled',
             current_period_starts_at = $4, current_period_ends_at = $5, updated_at = $6
         WHERE household_id = $1 AND id = $2 AND source = $7`,
        [
          input.householdId,
          input.subscriptionId,
          canonicalLifecycle,
          canonicalPeriodStartsAt.toISOString(),
          canonicalPeriodEndsAt?.toISOString() ?? null,
          input.now.toISOString(),
          source,
          paymentConfirmed,
        ],
      );
      if (canonical.rowCount !== 1) {
        throw new DomainError('conflict', 'Canonical commerce subscription linkage is invalid');
      }
      const plan = await transaction.query<
        { readonly plan_version_id: string; readonly capabilities: unknown } & Record<
          string,
          unknown
        >
      >(
        `SELECT subscription.plan_version_id, plan.capabilities
         FROM commerce_subscriptions subscription
         JOIN commerce_plan_versions plan ON plan.id = subscription.plan_version_id
         WHERE subscription.household_id = $1 AND subscription.id = $2`,
        [input.householdId, input.subscriptionId],
      );
      const canonicalPlan = plan.rows[0];
      if (canonicalPlan === undefined || !Array.isArray(canonicalPlan.capabilities)) {
        throw new DomainError('conflict', 'Canonical commerce plan linkage is invalid');
      }
      const existingGrant = await transaction.query<EntitlementGrantStateRow>(
        `SELECT id, ends_at, revoked_at FROM entitlement_grants
         WHERE household_id = $1 AND subscription_id = $2 AND source = $3
         FOR UPDATE`,
        [input.householdId, input.subscriptionId, source],
      );
      if (existingGrant.rows.length > 1) {
        throw new DomainError('conflict', 'Canonical entitlement grant is ambiguous');
      }
      const accessEligible = [
        'trialing',
        'active',
        'grace',
        'cancel_at_period_end',
        'restored',
      ].includes(canonicalLifecycle);
      const grant = existingGrant.rows[0];
      const existingGrantIsActive =
        grant !== undefined && grant.ends_at === null && grant.revoked_at === null;
      const grantMayRemainActive = accessEligible && (mayActivateAccess || existingGrantIsActive);
      if (grant === undefined) {
        await transaction.query(
          `INSERT INTO entitlement_grants(
             household_id, id, source, capabilities, starts_at, ends_at, revoked_at,
             source_verified, precedence, plan_version_id, subscription_id,
             sponsorship_id, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$6,$9,300,$7,$8,NULL,$5)`,
          [
            input.householdId,
            this.idFactory.next('entitlement-grant'),
            source,
            JSON.stringify(canonicalPlan.capabilities),
            input.now.toISOString(),
            grantMayRemainActive ? null : input.now.toISOString(),
            canonicalPlan.plan_version_id,
            input.subscriptionId,
            paymentConfirmed || canonicalBefore.source_verified,
          ],
        );
      } else {
        await transaction.query(
          `UPDATE entitlement_grants
           SET capabilities = $3, source_verified = (source_verified OR $6), precedence = 300,
               plan_version_id = $4, ends_at = $5, revoked_at = $5
           WHERE household_id = $1 AND id = $2`,
          [
            input.householdId,
            grant.id,
            JSON.stringify(canonicalPlan.capabilities),
            canonicalPlan.plan_version_id,
            grantMayRemainActive ? null : input.now.toISOString(),
            paymentConfirmed || canonicalBefore.source_verified,
          ],
        );
      }
      await reconcileTrustedCircleAllowanceBindings(transaction, {
        householdId: input.householdId,
        now: input.now,
        runtimeEnvironment: this.runtimeEnvironment,
      });
      await reconcileProtectedMemberAllowanceBindings(transaction, {
        householdId: input.householdId,
        now: input.now,
        runtimeEnvironment: this.runtimeEnvironment,
      });
      await transaction.query(
        `UPDATE commerce_event_inbox
         SET status = 'processed', application_state = 'applied', normalized_lifecycle = $2,
             applied_at = $3, processed_at = $3
         WHERE id = $1`,
        [input.inboxId, input.lifecycle, input.now.toISOString()],
      );
      await writeAuditAndOutbox(
        transaction,
        this.idFactory,
        {
          householdId: input.householdId,
          correlationId: `commerce:${input.inboxId}`,
          now: input.now,
        },
        {
          action: 'commerce.lifecycle_applied',
          resourceType: 'subscription',
          resourceId: input.subscriptionId,
          outcome: 'completed',
          metadata: {
            lifecycle: canonicalLifecycle,
            previousLifecycle: canonicalBefore.lifecycle,
            providerEventKind: event.event_type,
          },
        },
        {
          eventType: 'commerce.lifecycle_applied.v1',
          aggregateType: 'subscription',
          aggregateId: input.subscriptionId,
          payload: {
            lifecycle: canonicalLifecycle,
            previousLifecycle: canonicalBefore.lifecycle,
            providerEventKind: event.event_type,
          },
        },
      );
      return { eventId: input.inboxId, outcome: 'applied', lifecycle: canonicalLifecycle };
    });
  }

  async quarantineProviderEvent(input: {
    readonly inboxId: string;
    readonly errorCode: string;
    readonly now: Date;
  }): Promise<boolean> {
    if (!/^[a-z][a-z0-9_.-]{1,79}$/u.test(input.errorCode)) {
      throw new DomainError('invalid_input', 'Commerce quarantine code is invalid');
    }
    const result = await this.database.query(
      `UPDATE commerce_event_inbox
       SET status = 'quarantined', application_state = 'quarantined', error_code = $2,
           processed_at = $3
       WHERE id = $1 AND application_state = 'pending'`,
      [input.inboxId, input.errorCode, input.now.toISOString()],
    );
    return result.rowCount === 1;
  }

  async ignoreProviderEventAfterReconciliation(input: {
    readonly inboxId: string;
    readonly now: Date;
  }): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE commerce_event_inbox
       SET status = 'processed', application_state = 'ignored',
           error_code = 'provider.reconciled_from_snapshot', processed_at = $2
       WHERE id = $1 AND application_state = 'pending'`,
      [input.inboxId, input.now.toISOString()],
    );
    if (result.rowCount === 1) return true;
    const existing = await this.database.query(
      `SELECT 1 FROM commerce_event_inbox
       WHERE id = $1 AND application_state = 'ignored'
         AND error_code = 'provider.reconciled_from_snapshot'`,
      [input.inboxId],
    );
    return existing.rowCount === 1;
  }

  async completeProviderOperationalEvent(input: {
    readonly inboxId: string;
    readonly now: Date;
  }): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE commerce_event_inbox
       SET status = 'processed', application_state = 'applied', applied_at = $2, processed_at = $2
       WHERE id = $1 AND application_state = 'pending'`,
      [input.inboxId, input.now.toISOString()],
    );
    return result.rowCount === 1;
  }

  async startLocalReconciliation(input: {
    readonly environment: 'local' | 'test';
    readonly now: Date;
  }): Promise<string> {
    return this.startReconciliation({ provider: 'local', ...input });
  }

  async startReconciliation(input: {
    readonly provider: 'local' | CommerceProvider;
    readonly environment: 'local' | CommerceProviderEnvironment;
    readonly now: Date;
  }): Promise<string> {
    const id = this.idFactory.next('reconciliation');
    await this.database.query(
      `INSERT INTO commerce_reconciliation_runs(
         id, provider, environment, state, created_at
       ) VALUES ($1,$2,$3,'queued',$4)`,
      [id, input.provider, input.environment, input.now.toISOString()],
    );
    return id;
  }

  async ensureProviderEventReconciliation(input: {
    readonly inboxId: string;
    readonly provider: CommerceProvider;
    readonly environment: CommerceProviderEnvironment;
    readonly now: Date;
  }): Promise<string> {
    const id = this.idFactory.next('reconciliation');
    const result = await this.database.query<{ id: string } & Record<string, unknown>>(
      `INSERT INTO commerce_reconciliation_runs(
         id, provider, environment, state, created_at, trigger_event_id
       ) VALUES ($1,$2,$3,'queued',$4,$5)
       ON CONFLICT (trigger_event_id) DO UPDATE SET trigger_event_id = excluded.trigger_event_id
       RETURNING id`,
      [id, input.provider, input.environment, input.now.toISOString(), input.inboxId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('Unable to persist provider reconciliation');
    return row.id;
  }

  async stripeReconciliationRepairProjection(input: {
    readonly reconciliationRunId: string;
    readonly actorPersonId: string;
    readonly configuredFounderPersonId?: string;
  }): Promise<StripeReconciliationRepairProjection> {
    await assertStripeControlOperator({
      executor: this.database,
      actorPersonId: input.actorPersonId,
      ...(input.configuredFounderPersonId === undefined
        ? {}
        : { configuredFounderPersonId: input.configuredFounderPersonId }),
    });
    const result = await this.database.query<
      {
        readonly id: string;
        readonly trigger_event_id: string;
        readonly environment: string;
        readonly state: StripeReconciliationRepairProjection['state'];
        readonly failure_code: string | null;
        readonly automatic_attempt_count: number;
        readonly authorized_attempt_limit: number;
        readonly manual_repair_revision: number;
        readonly application_state: string;
      } & Record<string, unknown>
    >(
      `SELECT run.id, run.trigger_event_id, run.environment, run.state, run.failure_code,
              run.automatic_attempt_count, run.authorized_attempt_limit,
              run.manual_repair_revision, inbox.application_state
       FROM commerce_reconciliation_runs run
       JOIN commerce_event_inbox inbox ON inbox.id = run.trigger_event_id
       WHERE run.id = $1 AND run.provider = 'stripe'
         AND run.environment IN ('test','production')`,
      [input.reconciliationRunId],
    );
    const row = result.rows[0];
    if (row === undefined || (row.environment !== 'test' && row.environment !== 'production')) {
      throw new DomainError('not_found', 'Stripe reconciliation run not found');
    }
    return {
      reconciliationRunId: row.id,
      inboxId: row.trigger_event_id,
      environment: row.environment,
      state: row.state,
      ...(row.failure_code === null ? {} : { failureCode: row.failure_code }),
      automaticAttemptCount: row.automatic_attempt_count,
      authorizedAttemptLimit: row.authorized_attempt_limit,
      revision: row.manual_repair_revision,
      repairAvailable:
        row.state === 'attention' &&
        row.application_state === 'pending' &&
        row.automatic_attempt_count >= row.authorized_attempt_limit &&
        row.authorized_attempt_limit === 12 &&
        row.manual_repair_revision === 0,
    };
  }

  async requestStripeReconciliationRepair(input: {
    readonly reconciliationRunId: string;
    readonly expectedRevision: 0;
    readonly reasonCode: 'founder_bounded_provider_repair';
    readonly correlationId: string;
    readonly actorPersonId: string;
    readonly configuredFounderPersonId?: string;
    readonly now: Date;
  }): Promise<StripeReconciliationRepairResult> {
    if (
      input.expectedRevision !== 0 ||
      input.reasonCode !== 'founder_bounded_provider_repair' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u.test(input.correlationId) ||
      !Number.isFinite(input.now.getTime())
    ) {
      throw new DomainError('invalid_input', 'Invalid Stripe reconciliation repair request');
    }
    return this.database.transaction(async (transaction) => {
      await assertStripeControlOperator({
        executor: transaction,
        actorPersonId: input.actorPersonId,
        ...(input.configuredFounderPersonId === undefined
          ? {}
          : { configuredFounderPersonId: input.configuredFounderPersonId }),
      });
      const runResult = await transaction.query<
        {
          readonly id: string;
          readonly trigger_event_id: string;
          readonly environment: 'test' | 'production';
          readonly state: StripeReconciliationRepairProjection['state'];
          readonly failure_code: string | null;
          readonly repair_generation: number;
          readonly automatic_attempt_count: number;
          readonly authorized_attempt_limit: number;
          readonly manual_repair_revision: number;
          readonly application_state: string;
        } & Record<string, unknown>
      >(
        `SELECT run.id, run.trigger_event_id, run.environment, run.state, run.failure_code,
                run.repair_generation, run.automatic_attempt_count,
                run.authorized_attempt_limit, run.manual_repair_revision,
                inbox.application_state
         FROM commerce_reconciliation_runs run
         JOIN commerce_event_inbox inbox ON inbox.id = run.trigger_event_id
         WHERE run.id = $1 AND run.provider = 'stripe'
           AND run.environment IN ('test','production')
         FOR UPDATE OF run, inbox`,
        [input.reconciliationRunId],
      );
      const run = runResult.rows[0];
      if (run === undefined) {
        throw new DomainError('not_found', 'Stripe reconciliation run not found');
      }
      const priorRepair = await transaction.query<
        {
          readonly actor_person_id: string;
          readonly correlation_id: string;
          readonly expected_revision: number;
          readonly next_revision: number;
          readonly next_attempt_limit: number;
          readonly repair_job_id: string;
        } & Record<string, unknown>
      >(
        `SELECT actor_person_id, correlation_id, expected_revision, next_revision,
                next_attempt_limit, repair_job_id
         FROM commerce_stripe_reconciliation_repair_events
         WHERE reconciliation_run_id = $1`,
        [input.reconciliationRunId],
      );
      const prior = priorRepair.rows[0];
      if (prior !== undefined) {
        if (
          prior.actor_person_id !== input.actorPersonId ||
          prior.correlation_id !== input.correlationId ||
          prior.expected_revision !== input.expectedRevision ||
          prior.next_revision !== 1 ||
          prior.next_attempt_limit !== 16
        ) {
          throw new DomainError('conflict', 'Stripe reconciliation repair already differs');
        }
        return {
          reconciliationRunId: run.id,
          inboxId: run.trigger_event_id,
          environment: run.environment,
          revision: 1,
          authorizedAttemptLimit: 16,
          repairJobId: prior.repair_job_id,
          duplicate: true,
        };
      }
      if (
        run.state !== 'attention' ||
        run.application_state !== 'pending' ||
        run.automatic_attempt_count !== 12 ||
        run.authorized_attempt_limit !== 12 ||
        run.manual_repair_revision !== input.expectedRevision ||
        run.repair_generation < 1 ||
        run.failure_code === null
      ) {
        throw new DomainError(
          'conflict',
          'Stripe reconciliation is not at the reviewed repair boundary',
        );
      }
      const originalJobResult = await transaction.query<
        {
          readonly id: string;
          readonly household_id: string | null;
          readonly payload: unknown;
        } & Record<string, unknown>
      >(
        `SELECT id, household_id, payload
         FROM durable_jobs
         WHERE job_type = 'commerce.reconcile' AND idempotency_key = $1
         FOR UPDATE`,
        [`stripe-reconcile:${run.environment}:${run.trigger_event_id}`],
      );
      const originalJob = originalJobResult.rows[0];
      if (originalJob === undefined) {
        throw new DomainError('conflict', 'Initial Stripe reconciliation job is missing');
      }
      const originalPayload = jsonObject(originalJob.payload);
      const requiredText = (key: string): string => {
        const value = originalPayload[key];
        if (typeof value !== 'string' || value.trim() === '' || value.length > 256) {
          throw new DomainError('conflict', 'Initial Stripe reconciliation evidence is invalid');
        }
        return value;
      };
      if (
        requiredText('inboxId') !== run.trigger_event_id ||
        requiredText('reconciliationRunId') !== run.id ||
        requiredText('environment') !== run.environment ||
        originalPayload.repairGeneration !== 0
      ) {
        throw new DomainError('conflict', 'Initial Stripe reconciliation lineage is invalid');
      }
      const repairPayload: Record<string, string | number> = {
        inboxId: run.trigger_event_id,
        reconciliationRunId: run.id,
        eventType: requiredText('eventType'),
        providerObjectId: requiredText('providerObjectId'),
        providerEventCreatedAt: requiredText('providerEventCreatedAt'),
        environment: run.environment,
        evidenceTier: requiredText('evidenceTier'),
        transportKind: requiredText('transportKind'),
        runtimeRunId: requiredText('runtimeRunId'),
        repairGeneration: 2,
      };
      for (const key of [
        'externalSubscriptionId',
        'householdId',
        'subscriptionId',
        'planVersionId',
      ] as const) {
        if (originalPayload[key] !== undefined) repairPayload[key] = requiredText(key);
      }
      if (
        (repairPayload.householdId ?? null) !== originalJob.household_id ||
        (repairPayload.subscriptionId === undefined) !==
          (repairPayload.householdId === undefined) ||
        (repairPayload.planVersionId === undefined) !== (repairPayload.householdId === undefined)
      ) {
        throw new DomainError('conflict', 'Initial Stripe reconciliation binding is invalid');
      }
      const advanced = await transaction.query(
        `UPDATE commerce_reconciliation_runs
         SET state = 'queued', failure_code = NULL, completed_at = NULL,
             authorized_attempt_limit = 16, manual_repair_revision = 1,
             repair_generation = 2, last_attempted_at = $2
         WHERE id = $1 AND provider = 'stripe' AND environment = $3
           AND state = 'attention' AND automatic_attempt_count = 12
           AND authorized_attempt_limit = 12 AND manual_repair_revision = 0`,
        [run.id, input.now.toISOString(), run.environment],
      );
      if (advanced.rowCount !== 1) {
        throw new DomainError('conflict', 'Stripe reconciliation repair revision changed');
      }
      const queued = await enqueueDurableJobWithExecutor(transaction, this.idFactory, {
        type: 'commerce.reconcile',
        version: 1,
        ...(originalJob.household_id === null ? {} : { householdId: originalJob.household_id }),
        classification: 'internal',
        payload: repairPayload as DurableJobPayload,
        idempotencyKey: `stripe-reconcile-founder-repair:${run.environment}:${run.id}:1`,
        scheduledAt: input.now,
        maxAttempts: 4,
        correlationId: input.correlationId,
        causationId: originalJob.id,
      });
      await transaction.query(
        `INSERT INTO commerce_stripe_reconciliation_repair_events(
           id, reconciliation_run_id, trigger_event_id, environment,
           expected_revision, next_revision, previous_attempt_limit, next_attempt_limit,
           actor_person_id, reason_code, correlation_id, repair_job_id, requested_at
         ) VALUES ($1,$2,$3,$4,0,1,12,16,$5,$6,$7,$8,$9)`,
        [
          this.idFactory.next('stripe-reconciliation-repair'),
          run.id,
          run.trigger_event_id,
          run.environment,
          input.actorPersonId,
          input.reasonCode,
          input.correlationId,
          queued.job.id,
          input.now.toISOString(),
        ],
      );
      await writeAuditAndOutbox(
        transaction,
        this.idFactory,
        {
          ...(originalJob.household_id === null ? {} : { householdId: originalJob.household_id }),
          actorPersonId: input.actorPersonId,
          audience: 'hq',
          correlationId: input.correlationId,
          now: input.now,
        },
        {
          action: 'commerce.stripe_reconciliation_repair_requested',
          resourceType: 'commerce_reconciliation',
          resourceId: run.id,
          outcome: 'completed',
          metadata: { revision: 1, authorizedAttemptLimit: 16 },
        },
        {
          eventType: 'commerce.stripe_reconciliation_repair_requested.v1',
          aggregateType: 'commerce_reconciliation',
          aggregateId: run.id,
          payload: { revision: 1, authorizedAttemptLimit: 16 },
        },
      );
      return {
        reconciliationRunId: run.id,
        inboxId: run.trigger_event_id,
        environment: run.environment,
        revision: 1,
        authorizedAttemptLimit: 16,
        repairJobId: queued.job.id,
        duplicate: false,
      };
    });
  }

  async completeLocalReconciliation(input: {
    readonly id: string;
    readonly environment: 'local' | 'test';
    readonly checkedCount: number;
    readonly mismatchCount: number;
    readonly now: Date;
  }): Promise<boolean> {
    return this.completeReconciliation({ provider: 'local', ...input });
  }

  async markProviderReconciliationAttention(input: {
    readonly id: string;
    readonly provider: CommerceProvider;
    readonly environment: CommerceProviderEnvironment;
    readonly failureCode: string;
    readonly repairGeneration: number;
    readonly now: Date;
  }): Promise<boolean> {
    if (
      input.failureCode.trim() === '' ||
      !Number.isSafeInteger(input.repairGeneration) ||
      input.repairGeneration < 0
    ) {
      throw new DomainError('invalid_input', 'Invalid provider reconciliation attention');
    }
    const result = await this.database.query(
      `UPDATE commerce_reconciliation_runs
       SET state = 'attention', failure_code = $4, last_attempted_at = $5,
           repair_generation = GREATEST(repair_generation, $6),
           started_at = COALESCE(started_at, created_at), completed_at = NULL
       WHERE id = $1 AND provider = $2 AND environment = $3
         AND state IN ('queued','running','attention')`,
      [
        input.id,
        input.provider,
        input.environment,
        input.failureCode,
        input.now.toISOString(),
        input.repairGeneration,
      ],
    );
    return result.rowCount === 1;
  }

  async claimProviderReconciliationAutomaticAttempt(input: {
    readonly id: string;
    readonly provider: CommerceProvider;
    readonly environment: CommerceProviderEnvironment;
    readonly repairGeneration: number;
    readonly now: Date;
  }): Promise<number | null> {
    if (!Number.isSafeInteger(input.repairGeneration) || input.repairGeneration < 0) {
      throw new DomainError('invalid_input', 'Invalid provider reconciliation generation');
    }
    const result = await this.database.query<
      { readonly automatic_attempt_count: number } & Record<string, unknown>
    >(
      `UPDATE commerce_reconciliation_runs
       SET state = 'running', started_at = COALESCE(started_at, $5),
           last_attempted_at = $5, repair_generation = GREATEST(repair_generation, $4),
           automatic_attempt_count = automatic_attempt_count + 1
       WHERE id = $1 AND provider = $2 AND environment = $3
         AND state IN ('queued','running','attention')
         AND automatic_attempt_count < authorized_attempt_limit
         AND $4 <= manual_repair_revision + 1
       RETURNING automatic_attempt_count`,
      [
        input.id,
        input.provider,
        input.environment,
        input.repairGeneration,
        input.now.toISOString(),
      ],
    );
    return result.rows[0]?.automatic_attempt_count ?? null;
  }

  async completeReconciliation(input: {
    readonly id: string;
    readonly provider: 'local' | CommerceProvider;
    readonly environment: 'local' | CommerceProviderEnvironment;
    readonly checkedCount: number;
    readonly mismatchCount: number;
    readonly now: Date;
  }): Promise<boolean> {
    if (
      !Number.isSafeInteger(input.checkedCount) ||
      input.checkedCount < 0 ||
      !Number.isSafeInteger(input.mismatchCount) ||
      input.mismatchCount < 0 ||
      input.mismatchCount > input.checkedCount
    ) {
      throw new DomainError('invalid_input', 'Invalid reconciliation counts');
    }
    const result = await this.database.query(
      `UPDATE commerce_reconciliation_runs
       SET state = $3, checked_count = $4, mismatch_count = $5,
           started_at = COALESCE(started_at, created_at), completed_at = $6,
           failure_code = NULL, last_attempted_at = $6
       WHERE id = $1 AND provider = $7 AND environment = $2
         AND (
           state IN ('queued','running')
           OR (state = 'attention' AND $7 <> 'local')
         )`,
      [
        input.id,
        input.environment,
        input.mismatchCount === 0 ? 'completed' : 'attention',
        input.checkedCount,
        input.mismatchCount,
        input.now.toISOString(),
        input.provider,
      ],
    );
    return result.rowCount === 1;
  }
}

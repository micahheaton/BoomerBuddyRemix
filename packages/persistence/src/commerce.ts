import { DomainError } from '@boomerbuddy/domain';
import {
  constantTimeEqual,
  fingerprintMinimized,
  minimizeRestrictedInput,
} from '@boomerbuddy/security';
import type { Database } from './database';
import {
  reconcileProtectedMemberAllowanceBindings,
  reconcileTrustedCircleAllowanceBindings,
} from './entitlements';
import { randomIdFactory, type IdFactory } from './values';

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
}

export interface AppliedProviderCommerceEvent {
  readonly eventId: string;
  readonly outcome: 'applied' | 'superseded' | 'quarantined';
  readonly lifecycle: NormalizedCommerceLifecycle;
}

export type ProviderAccessEvidence =
  | { readonly kind: 'initial_server_binding'; readonly sourceInboxId?: string }
  | { readonly kind: 'non_payment'; readonly sourceInboxId?: string }
  | { readonly kind: 'payment_confirmed'; readonly sourceInboxId: string };

export class CommerceOperationsRepository {
  constructor(
    private readonly database: Database,
    private readonly fingerprintKey: Uint8Array,
    private readonly fingerprintKeyVersion: number,
    private readonly idFactory: IdFactory = randomIdFactory,
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
         normalized_lifecycle, application_state
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'verified','received',$8,$9,$10,$11,$12,'pending')
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
      ],
    );
    const receipt = await this.database.query<ProviderInboxRow>(
      `SELECT id, provider, environment, external_event_id, event_type, payload_hmac,
              fingerprint_key_version, status, authenticity, provider_api_version,
              provider_object_id, provider_event_created_at, application_state
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
        (input.accessEvidence.kind === 'payment_confirmed' &&
          evidenceEvent.event_type !== 'invoice.paid') ||
        (input.accessEvidence.kind !== 'payment_confirmed' &&
          evidenceEvent.event_type === 'invoice.paid')
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
      const newFinancialRestriction =
        input.lifecycle === 'refunded' || input.lifecycle === 'disputed' ? input.lifecycle : null;
      const effectiveFinancialRestriction =
        previous?.financial_restriction === 'disputed' || newFinancialRestriction === 'disputed'
          ? 'disputed'
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
      const initialServerBoundActivation =
        previous === undefined &&
        input.accessEvidence.kind === 'initial_server_binding' &&
        evidenceEvent.event_type.startsWith('customer.subscription.') &&
        (effectiveLifecycle === 'active' || effectiveLifecycle === 'trialing');
      const paymentConfirmed = input.accessEvidence.kind === 'payment_confirmed';
      const paymentWouldCrossUnprovedGap =
        paymentConfirmed &&
        canonicalEnd !== null &&
        input.currentPeriodEndsAt > canonicalEnd &&
        input.currentPeriodStartsAt > canonicalEnd;
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
      const paymentCoversCanonicalPeriod =
        paymentConfirmed &&
        input.currentPeriodEndsAt > input.now &&
        (canonicalEnd === null ||
          (input.currentPeriodEndsAt >= canonicalEnd &&
            input.currentPeriodStartsAt <= canonicalEnd));
      const mayActivateAccess = initialServerBoundActivation || paymentCoversCanonicalPeriod;
      let canonicalPeriodStartsAt = input.currentPeriodStartsAt;
      let canonicalPeriodEndsAt: Date | null = input.currentPeriodEndsAt;
      if (!initialServerBoundActivation && !paymentConfirmed) {
        canonicalPeriodStartsAt = canonicalStart;
        if (canonicalEnd === null) {
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
        canonicalEnd !== null &&
        input.currentPeriodEndsAt <= canonicalEnd
      ) {
        canonicalPeriodStartsAt = canonicalStart;
        canonicalPeriodEndsAt = canonicalEnd;
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
            input.lifecycle,
            input.providerApiVersion,
            input.now.toISOString(),
            input.externalEventId,
            input.providerEventCreatedAt.toISOString(),
            input.providerCustomerId ?? null,
            newFinancialRestriction,
            newFinancialRestriction === null ? null : input.externalEventId,
            newFinancialRestriction === null ? null : input.now.toISOString(),
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
               , financial_restriction = COALESCE($10, financial_restriction)
               , financial_restriction_event_id = CASE WHEN $10 IS NULL
                   THEN financial_restriction_event_id ELSE $11 END
               , financial_restricted_at = CASE WHEN $10 IS NULL
                   THEN financial_restricted_at ELSE $12 END
           WHERE id = $1`,
          [
            previous.id,
            input.householdId,
            input.subscriptionId,
            input.lifecycle,
            input.providerApiVersion,
            input.now.toISOString(),
            input.externalEventId,
            input.providerEventCreatedAt.toISOString(),
            input.providerCustomerId ?? null,
            newFinancialRestriction,
            input.externalEventId,
            input.now.toISOString(),
          ],
        );
      }
      const canonical = await transaction.query(
        `UPDATE commerce_subscriptions
         SET lifecycle = $3, source_verified = true, reconciliation_state = 'reconciled',
             current_period_starts_at = $4, current_period_ends_at = $5, updated_at = $6
         WHERE household_id = $1 AND id = $2 AND source = $7`,
        [
          input.householdId,
          input.subscriptionId,
          effectiveLifecycle,
          canonicalPeriodStartsAt.toISOString(),
          canonicalPeriodEndsAt?.toISOString() ?? null,
          input.now.toISOString(),
          source,
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
      ].includes(effectiveLifecycle);
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
           ) VALUES ($1,$2,$3,$4,$5,$6,$6,true,300,$7,$8,NULL,$5)`,
          [
            input.householdId,
            this.idFactory.next('entitlement-grant'),
            source,
            JSON.stringify(canonicalPlan.capabilities),
            input.now.toISOString(),
            grantMayRemainActive ? null : input.now.toISOString(),
            canonicalPlan.plan_version_id,
            input.subscriptionId,
          ],
        );
      } else {
        await transaction.query(
          `UPDATE entitlement_grants
           SET capabilities = $3, source_verified = true, precedence = 300,
               plan_version_id = $4, ends_at = $5, revoked_at = $5
           WHERE household_id = $1 AND id = $2`,
          [
            input.householdId,
            grant.id,
            JSON.stringify(canonicalPlan.capabilities),
            canonicalPlan.plan_version_id,
            grantMayRemainActive ? null : input.now.toISOString(),
          ],
        );
      }
      await reconcileTrustedCircleAllowanceBindings(transaction, {
        householdId: input.householdId,
        now: input.now,
      });
      await reconcileProtectedMemberAllowanceBindings(transaction, {
        householdId: input.householdId,
        now: input.now,
      });
      await transaction.query(
        `UPDATE commerce_event_inbox
         SET status = 'processed', application_state = 'applied', normalized_lifecycle = $2,
             applied_at = $3, processed_at = $3
         WHERE id = $1`,
        [input.inboxId, input.lifecycle, input.now.toISOString()],
      );
      return { eventId: input.inboxId, outcome: 'applied', lifecycle: effectiveLifecycle };
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
    return result.rowCount === 1;
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

  async completeLocalReconciliation(input: {
    readonly id: string;
    readonly environment: 'local' | 'test';
    readonly checkedCount: number;
    readonly mismatchCount: number;
    readonly now: Date;
  }): Promise<boolean> {
    return this.completeReconciliation({ provider: 'local', ...input });
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
           started_at = COALESCE(started_at, created_at), completed_at = $6
       WHERE id = $1 AND provider = $7 AND environment = $2
         AND state IN ('queued','running')`,
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

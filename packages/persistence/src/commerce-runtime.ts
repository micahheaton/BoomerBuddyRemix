import { createHash, createHmac } from 'node:crypto';
import { DomainError } from '@boomerbuddy/domain';
import type {
  CommerceActor,
  ProviderFinancialRestrictionEvidence,
  ProviderFailedPaymentEvidence,
  StripeFoundingOffer,
  StripePreflightEvidence,
} from '@boomerbuddy/integrations';
import type { Database, SqlExecutor } from './database';
import { resolveActiveBillingAuthority } from './entitlements';
import { writeAuditAndOutbox } from './events';
import { enqueueDurableJobWithExecutor, type DurableJobPayload } from './jobs';
import { assertStripeControlOperator } from './stripe-control-operator';
import { jsonValue, randomIdFactory, type IdFactory } from './values';

interface CheckoutIntentRow extends Record<string, unknown> {
  readonly id: string;
  readonly household_id: string;
  readonly subscription_id: string;
  readonly requested_by_person_id: string;
  readonly billing_authority_person_id: string;
  readonly plan_version_id: string;
  readonly offer_id: string | null;
  readonly billing_interval: 'month' | 'year';
  readonly provider_price_id: string;
  readonly environment: 'test' | 'production';
  readonly state: 'prepared' | 'session_created' | 'expired';
  readonly provider_session_id: string | null;
  readonly expires_at: unknown;
  readonly provider_requested_expires_at: unknown;
  readonly provider_returned_expires_at: unknown;
  readonly server_operation_id: string | null;
  readonly provider_idempotency_key: string | null;
}

interface ProviderBindingRow extends Record<string, unknown> {
  readonly household_id: string;
  readonly subscription_id: string;
  readonly plan_version_id: string;
  readonly provider_customer_id: string | null;
  readonly billing_interval: 'month' | 'year';
  readonly provider_price_id: string;
}

export interface StripeSessionDispatchDecision {
  readonly shouldDispatch: boolean;
  readonly operationId: string;
  readonly attempt: number;
  readonly state: 'dispatching' | 'outcome_unknown' | 'succeeded' | 'failed_no_effect';
  readonly providerSessionId?: string;
  readonly providerSessionUrl?: string;
  readonly returnedExpiresAt?: Date;
}

export type StripeSessionRetryContext =
  | {
      readonly action: 'checkout';
      readonly householdId: string;
      readonly checkoutIntentId: string;
      readonly serverOperationId: string;
      readonly providerIdempotencyKey: string;
      readonly actor: CommerceActor;
      readonly canonicalSubscriptionId: string;
      readonly planVersionId: string;
      readonly providerPriceId: string;
      readonly providerCustomerId?: string;
      readonly successUrl: string;
      readonly cancelUrl: string;
      readonly requestedExpiresAt: Date;
    }
  | {
      readonly action: 'portal';
      readonly householdId: string;
      readonly serverOperationId: string;
      readonly providerIdempotencyKey: string;
      readonly actor: CommerceActor;
      readonly providerCustomerId: string;
      readonly providerConfigurationId: string;
      readonly returnUrl: string;
    };

export type StripeSessionRetryDisposition =
  | { readonly kind: 'ready'; readonly context: StripeSessionRetryContext }
  | { readonly kind: 'not_due' }
  | { readonly kind: 'terminal' }
  | {
      readonly kind: 'attention';
      readonly reason:
        'operation_missing' | 'authority_unavailable' | 'intent_expired' | 'evidence_incomplete';
    };

export interface StripeSessionRetryRepairProjection {
  readonly operationId: string;
  readonly householdId: string;
  readonly serverOperationId: string;
  readonly environment: 'test' | 'production';
  readonly action: 'checkout';
  readonly state: 'prepared' | 'outcome_unknown' | 'dispatching' | 'succeeded' | 'failed_no_effect';
  readonly attemptCount: number;
  readonly authorizedAttemptLimit: number;
  readonly revision: number;
  readonly providerDeadline: Date;
  readonly attentionState: 'open' | 'snoozed' | 'absent';
  readonly repairAvailable: boolean;
}

export interface StripeSessionRetryRepairResult {
  readonly operationId: string;
  readonly householdId: string;
  readonly serverOperationId: string;
  readonly environment: 'test' | 'production';
  readonly action: 'checkout';
  readonly revision: 1;
  readonly authorizedAttemptLimit: 7;
  readonly repairJobId: string;
  readonly duplicate: boolean;
}

export interface StripeCohortControlProjection {
  readonly environment: 'test' | 'production';
  readonly state: 'absent' | 'disabled' | 'active' | 'expired';
  readonly maxActive: number;
  readonly policyExpiresAt?: Date;
  readonly liveApproved: boolean;
  readonly revision: number;
  readonly changedAt?: Date;
}

export interface StripeControlStatusProjection {
  readonly environment: 'test' | 'production';
  readonly preflight:
    | { readonly state: 'unknown' }
    | {
        readonly state: 'configured' | 'verified' | 'unavailable';
        readonly checkedAt: Date;
        readonly evidenceLevel:
          'local_fixture' | 'stripe_test' | 'deployed_staging' | 'live_production';
        readonly authenticityKind: 'fixture_assertion' | 'provider_read';
        readonly transportKind: 'injected_fixture' | 'stripe_https';
        readonly evidenceDigest: string;
        readonly checks: {
          readonly accountReady: boolean;
          readonly offerReady: boolean;
          readonly portalReady: boolean;
          readonly checkoutPolicyReady: boolean;
        };
      };
  readonly eligibleHouseholds: readonly {
    readonly householdId: string;
    readonly state: 'eligible';
    readonly eligibilityExpiresAt: Date;
    readonly occurredAt: Date;
  }[];
  readonly evidence: readonly {
    readonly kind: 'preflight' | 'initiation_control' | 'cohort_control' | 'eligibility';
    readonly state: string;
    readonly occurredAt: Date;
    readonly subjectId?: string;
    readonly revision?: number;
    readonly reasonCode?: string;
    readonly evidenceLevel?:
      'local_fixture' | 'stripe_test' | 'deployed_staging' | 'live_production';
    readonly authenticityKind?: 'fixture_assertion' | 'provider_read';
    readonly transportKind?: 'injected_fixture' | 'stripe_https';
    readonly evidenceDigest?: string;
  }[];
}

export interface PreparedStripeCheckout {
  readonly intentId: string;
  readonly subscriptionId: string;
  readonly planVersionId: string;
  readonly actor: CommerceActor;
  readonly duplicate: boolean;
  readonly providerSessionId?: string;
  readonly providerIdempotencyKey: string;
  readonly serverOperationId: string;
  readonly providerExpiresAt: Date;
  readonly expiresAt: Date;
}

export interface CanonicalStripeBinding {
  readonly householdId: string;
  readonly subscriptionId: string;
  readonly planVersionId: string;
  readonly providerCustomerId?: string;
  readonly billingInterval: 'month' | 'year';
  readonly providerPriceId: string;
  readonly bindingState: 'completed_checkout' | 'existing_provider';
}

export interface StripeRuntimeResources {
  readonly environment: 'test' | 'production';
  readonly accountId: string;
  readonly apiVersion: string;
  readonly cancelOnlyPortalConfigurationId: string;
  readonly offer: StripeFoundingOffer;
}

export interface BillingReverificationBindingIntent {
  readonly personId: string;
  readonly householdId: string;
  readonly action: 'checkout' | 'portal';
  readonly environment: 'test' | 'production';
  readonly serverOperationId: string;
  readonly offerId: 'founding_family_monthly_v1' | 'cancel_only_portal_v1';
  readonly amountMinor: 0 | 1499;
  readonly currency: 'usd';
  readonly factorLevel: 'multi_factor';
}

export interface DerivedBillingReverificationBinding {
  readonly reverificationFingerprint: string;
  readonly bindingFingerprint: string;
  readonly fingerprintKeyVersion: 1;
}

export type BillingReverificationBindingDecision =
  | { readonly kind: 'bound'; readonly duplicate: boolean }
  | { readonly kind: 'reverification_reused' };

export function deriveBillingReverificationBinding(
  input: BillingReverificationBindingIntent & {
    readonly reverificationId: string;
    readonly key: Uint8Array;
  },
): DerivedBillingReverificationBinding {
  if (input.key.byteLength < 32) {
    throw new TypeError('Billing reverification HMAC key must contain at least 32 bytes');
  }
  if (!validIdempotencyKey(input.serverOperationId)) {
    throw new DomainError('invalid_input', 'A valid server operation identifier is required');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u.test(input.reverificationId)) {
    throw new DomainError('not_authorized', 'Billing reverification evidence is invalid');
  }
  const actionMatchesOffer =
    (input.action === 'checkout' &&
      input.offerId === 'founding_family_monthly_v1' &&
      input.amountMinor === 1499) ||
    (input.action === 'portal' &&
      input.offerId === 'cancel_only_portal_v1' &&
      input.amountMinor === 0);
  if (!actionMatchesOffer) {
    throw new DomainError('invalid_input', 'Billing reverification intent is invalid');
  }
  const digest = (purpose: string, components: readonly string[]) => {
    const hmac = createHmac('sha256', input.key).update(purpose).update('\0');
    for (const component of components) hmac.update(component).update('\0');
    return hmac.digest('base64url');
  };
  const reverificationFingerprint = digest('billing-reverification-id-v1', [
    input.reverificationId,
  ]);
  const bindingFingerprint = digest('billing-reverification-binding-v1', [
    input.reverificationId,
    input.personId,
    input.householdId,
    input.action,
    input.environment,
    input.serverOperationId,
    input.offerId,
    String(input.amountMinor),
    input.currency,
    input.factorLevel,
  ]);
  return { reverificationFingerprint, bindingFingerprint, fingerprintKeyVersion: 1 };
}

export function deriveStripeProviderIdempotencyKey(input: {
  readonly environment: 'test' | 'production';
  readonly action: 'checkout' | 'portal';
  readonly householdId: string;
  readonly serverOperationId: string;
  readonly key: Uint8Array;
}): string {
  if (!validIdempotencyKey(input.serverOperationId)) {
    throw new DomainError('invalid_input', 'A valid server operation identifier is required');
  }
  const digest = createHmac('sha256', input.key)
    .update('stripe-operation-v1\0')
    .update(input.environment)
    .update('\0')
    .update(input.action)
    .update('\0')
    .update(input.householdId)
    .update('\0')
    .update(input.serverOperationId)
    .digest('hex');
  return `bb:${input.environment}:${input.action}:${digest}`;
}

function validIdempotencyKey(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9:._-]{15,159}$/u.test(value);
}

function asDate(value: unknown): Date {
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new TypeError('Invalid commerce timestamp');
  return date;
}

function durableJobPayload(value: unknown): DurableJobPayload {
  const parsed = jsonValue(value);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DomainError('conflict', 'Persisted Stripe job evidence is invalid');
  }
  const payload: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(parsed)) {
    if (item !== null && !['string', 'number', 'boolean'].includes(typeof item)) {
      throw new DomainError('conflict', 'Persisted Stripe job evidence is invalid');
    }
    payload[key] = item as string | number | boolean | null;
  }
  return payload;
}

async function bindingFromSubscription(
  executor: SqlExecutor,
  externalSubscriptionId: string,
  providerEventCreatedAt: Date,
  environment: 'test' | 'production',
): Promise<ProviderBindingRow | undefined> {
  const result = await executor.query<ProviderBindingRow>(
    `SELECT s.household_id, s.id AS subscription_id, s.plan_version_id,
            completion.provider_customer_id, intent.billing_interval,
            intent.provider_price_id
     FROM commerce_stripe_checkout_completions completion
     JOIN commerce_checkout_intents intent
       ON intent.household_id = completion.household_id
      AND intent.id = completion.checkout_intent_id
     JOIN commerce_subscriptions s
       ON intent.household_id = s.household_id AND intent.subscription_id = s.id
    JOIN household_billing_authorities authority
      ON authority.household_id = intent.household_id
      AND authority.person_id = intent.billing_authority_person_id
      AND authority.status = 'active'
     WHERE completion.provider_subscription_id = $1
       AND completion.environment = $3
       AND completion.environment = intent.environment
       AND s.source = 'web' AND intent.state = 'session_created'
       AND completion.completed_at <= $2
       AND completion.provider_expires_at >= completion.completed_at
     LIMIT 1`,
    [externalSubscriptionId, providerEventCreatedAt.toISOString(), environment],
  );
  return result.rows[0];
}

export class CommerceRuntimeRepository {
  constructor(
    private readonly database: Database,
    private readonly idFactory: IdFactory = randomIdFactory,
  ) {}

  async resolveActor(input: {
    readonly householdId: string;
    readonly personId: string;
    readonly now: Date;
  }): Promise<CommerceActor> {
    const authority = await resolveActiveBillingAuthority(
      this.database,
      input.householdId,
      input.personId,
    );
    if (authority === null) {
      throw new DomainError('not_authorized', 'Active billing authority is required');
    }
    return {
      personId: authority.personId,
      householdId: authority.householdId,
      billingAuthorityId: authority.authorityReference,
      resolvedAt: input.now,
    };
  }

  async bindBillingReverification(
    input: BillingReverificationBindingIntent &
      DerivedBillingReverificationBinding & {
        readonly effectiveFactorAgeSeconds: number;
        readonly now: Date;
      },
  ): Promise<BillingReverificationBindingDecision> {
    if (
      !/^[A-Za-z0-9_-]{43}$/u.test(input.reverificationFingerprint) ||
      !/^[A-Za-z0-9_-]{43}$/u.test(input.bindingFingerprint) ||
      input.fingerprintKeyVersion !== 1 ||
      !Number.isSafeInteger(input.effectiveFactorAgeSeconds) ||
      input.effectiveFactorAgeSeconds < 0 ||
      input.effectiveFactorAgeSeconds >= 600 ||
      Number.isNaN(input.now.getTime())
    ) {
      throw new DomainError('not_authorized', 'Billing reverification evidence is invalid');
    }
    return this.database.transaction(async (transaction) => {
      await transaction.query(
        `SELECT mutex_key FROM commerce_billing_reverification_mutex
         WHERE mutex_key = 'global' FOR UPDATE`,
      );
      const byReverification = await transaction.query<
        {
          readonly person_id: string;
          readonly household_id: string;
          readonly action: 'checkout' | 'portal';
          readonly environment: 'test' | 'production';
          readonly server_operation_id: string;
          readonly offer_id: BillingReverificationBindingIntent['offerId'];
          readonly amount_minor: number;
          readonly currency: 'usd';
          readonly factor_level: 'multi_factor';
          readonly binding_fingerprint: string;
          readonly fingerprint_key_version: number;
        } & Record<string, unknown>
      >(
        `SELECT person_id, household_id, action, environment, server_operation_id,
                offer_id, amount_minor, currency, factor_level, binding_fingerprint,
                fingerprint_key_version
         FROM commerce_billing_reverification_bindings
         WHERE reverification_fingerprint = $1`,
        [input.reverificationFingerprint],
      );
      const priorReverification = byReverification.rows[0];
      if (priorReverification !== undefined) {
        const sameOperation =
          priorReverification.environment === input.environment &&
          priorReverification.action === input.action &&
          priorReverification.household_id === input.householdId &&
          priorReverification.server_operation_id === input.serverOperationId;
        if (!sameOperation) return { kind: 'reverification_reused' };
        if (
          priorReverification.person_id !== input.personId ||
          priorReverification.offer_id !== input.offerId ||
          priorReverification.amount_minor !== input.amountMinor ||
          priorReverification.currency !== input.currency ||
          priorReverification.factor_level !== input.factorLevel ||
          priorReverification.binding_fingerprint !== input.bindingFingerprint ||
          priorReverification.fingerprint_key_version !== input.fingerprintKeyVersion
        ) {
          throw new DomainError(
            'conflict',
            'Billing operation has conflicting reverification evidence',
          );
        }
        return { kind: 'bound', duplicate: true };
      }
      const byOperation = await transaction.query(
        `SELECT 1 FROM commerce_billing_reverification_bindings
         WHERE environment = $1 AND action = $2 AND household_id = $3
           AND server_operation_id = $4`,
        [input.environment, input.action, input.householdId, input.serverOperationId],
      );
      if (byOperation.rowCount !== 0) {
        throw new DomainError(
          'conflict',
          'Billing operation has conflicting reverification evidence',
        );
      }
      await transaction.query(
        `INSERT INTO commerce_billing_reverification_bindings(
           id, reverification_fingerprint, binding_fingerprint, fingerprint_key_version,
           person_id, household_id, action, environment, server_operation_id, offer_id,
           amount_minor, currency, factor_level, effective_factor_age_seconds, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          this.idFactory.next('billing-reverification'),
          input.reverificationFingerprint,
          input.bindingFingerprint,
          input.fingerprintKeyVersion,
          input.personId,
          input.householdId,
          input.action,
          input.environment,
          input.serverOperationId,
          input.offerId,
          input.amountMinor,
          input.currency,
          input.factorLevel,
          input.effectiveFactorAgeSeconds,
          input.now.toISOString(),
        ],
      );
      return { kind: 'bound', duplicate: false };
    });
  }

  async authorizeActor(input: {
    readonly actor: CommerceActor;
    readonly planVersionId?: string;
    readonly now: Date;
  }): Promise<{ readonly allowed: boolean; readonly reason: string }> {
    const authority = await resolveActiveBillingAuthority(
      this.database,
      input.actor.householdId,
      input.actor.personId,
    );
    if (
      authority === null ||
      authority.authorityReference !== input.actor.billingAuthorityId ||
      input.actor.resolvedAt.getTime() > input.now.getTime() ||
      input.actor.resolvedAt.getTime() < input.now.getTime() - 5 * 60_000
    ) {
      return { allowed: false, reason: 'billing_authority_inactive' };
    }
    if (input.planVersionId === undefined) {
      return { allowed: true, reason: 'billing_authority_active' };
    }
    const plan = await this.database.query(
      `SELECT 1 FROM commerce_plan_versions
       WHERE id = $1 AND plan_key IN ('plus','family')
         AND state IN ('hypothesis','active')
         AND available_from <= $2
         AND (available_until IS NULL OR available_until > $2)`,
      [input.planVersionId, input.now.toISOString()],
    );
    return plan.rowCount === 1
      ? { allowed: true, reason: 'billing_authority_active' }
      : { allowed: false, reason: 'plan_unavailable' };
  }

  async changeStripeInitiationControl(input: {
    readonly environment: 'test' | 'production';
    readonly nextState: 'enabled' | 'disabled';
    readonly reasonCode:
      | 'founder_test_activation'
      | 'founder_live_activation'
      | 'founder_disable'
      | 'incident_stop'
      | 'configuration_change';
    readonly expectedRevision: number;
    readonly actorPersonId: string;
    readonly configuredFounderPersonId?: string;
    readonly correlationId: string;
    readonly runtimeInitiationPermitted?: boolean;
    readonly now: Date;
  }): Promise<{ readonly state: 'enabled' | 'disabled'; readonly revision: number }> {
    const activationReason =
      input.environment === 'production' ? 'founder_live_activation' : 'founder_test_activation';
    if (
      (input.nextState === 'enabled' && input.reasonCode !== activationReason) ||
      (input.nextState === 'disabled' &&
        ['founder_test_activation', 'founder_live_activation'].includes(input.reasonCode))
    ) {
      throw new DomainError('invalid_input', 'Stripe initiation reason does not match its state');
    }
    const runtimePermitted = input.runtimeInitiationPermitted ?? input.environment === 'test';
    if (input.nextState === 'enabled' && !runtimePermitted) {
      throw new DomainError('not_authorized', 'Runtime Stripe initiation is disabled');
    }
    return this.database.transaction(async (transaction) => {
      await assertStripeControlOperator({
        executor: transaction,
        actorPersonId: input.actorPersonId,
        ...(input.configuredFounderPersonId === undefined
          ? {}
          : { configuredFounderPersonId: input.configuredFounderPersonId }),
      });
      const existing = await transaction.query<
        { readonly state: 'enabled' | 'disabled'; readonly revision: number } & Record<
          string,
          unknown
        >
      >(
        `SELECT state, revision FROM commerce_stripe_initiation_controls
         WHERE environment = $1 FOR UPDATE`,
        [input.environment],
      );
      const previous = existing.rows[0];
      const previousRevision = previous?.revision ?? 0;
      if (previousRevision !== input.expectedRevision) {
        throw new DomainError('conflict', 'Stripe initiation control revision changed');
      }
      const revision = previousRevision + 1;
      const changed = await transaction.query<{ readonly changed_at: unknown }>(
        `INSERT INTO commerce_stripe_initiation_controls(
           environment, state, revision, changed_by_person_id, reason_code, changed_at
         ) VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)
         ON CONFLICT (environment) DO UPDATE SET
           state = EXCLUDED.state, revision = EXCLUDED.revision,
           changed_by_person_id = EXCLUDED.changed_by_person_id,
           reason_code = EXCLUDED.reason_code, changed_at = EXCLUDED.changed_at
         WHERE commerce_stripe_initiation_controls.revision = $6
         RETURNING changed_at`,
        [
          input.environment,
          input.nextState,
          revision,
          input.actorPersonId,
          input.reasonCode,
          input.expectedRevision,
        ],
      );
      const changedAt = changed.rows[0]?.changed_at;
      if (changedAt === undefined) {
        throw new DomainError('conflict', 'Stripe initiation control revision changed');
      }
      await transaction.query(
        `INSERT INTO commerce_stripe_initiation_control_events(
           id, environment, previous_state, next_state, revision, actor_person_id,
           reason_code, correlation_id, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          this.idFactory.next('stripe-control-event'),
          input.environment,
          previous?.state ?? 'absent',
          input.nextState,
          revision,
          input.actorPersonId,
          input.reasonCode,
          input.correlationId,
          asDate(changedAt).toISOString(),
        ],
      );
      return { state: input.nextState, revision };
    });
  }

  async stripeInitiationControlProjection(input: {
    readonly environment: 'test' | 'production';
    readonly actorPersonId: string;
    readonly configuredFounderPersonId?: string;
    readonly runtimeInitiationPermitted?: boolean;
  }): Promise<{
    readonly environment: 'test' | 'production';
    readonly state: 'absent' | 'enabled' | 'disabled';
    readonly revision: number;
    readonly changedAt?: Date;
    readonly reasonCode?:
      | 'founder_test_activation'
      | 'founder_live_activation'
      | 'founder_disable'
      | 'incident_stop'
      | 'configuration_change';
    readonly liveEnableAvailable: boolean;
  }> {
    await assertStripeControlOperator({
      executor: this.database,
      actorPersonId: input.actorPersonId,
      ...(input.configuredFounderPersonId === undefined
        ? {}
        : { configuredFounderPersonId: input.configuredFounderPersonId }),
    });
    const result = await this.database.query<
      {
        readonly state: 'enabled' | 'disabled';
        readonly revision: number;
        readonly changed_at: unknown;
        readonly reason_code:
          | 'founder_test_activation'
          | 'founder_live_activation'
          | 'founder_disable'
          | 'incident_stop'
          | 'configuration_change';
      } & Record<string, unknown>
    >(
      `SELECT state, revision, changed_at, reason_code
       FROM commerce_stripe_initiation_controls WHERE environment = $1`,
      [input.environment],
    );
    const row = result.rows[0];
    return {
      environment: input.environment,
      state: row?.state ?? 'absent',
      revision: row?.revision ?? 0,
      ...(row === undefined
        ? {}
        : { changedAt: asDate(row.changed_at), reasonCode: row.reason_code }),
      liveEnableAvailable:
        input.environment === 'production' && input.runtimeInitiationPermitted === true,
    };
  }

  async stripeSessionRetryRepairProjection(input: {
    readonly householdId: string;
    readonly serverOperationId: string;
    readonly environment?: 'test' | 'production';
    readonly actorPersonId: string;
    readonly configuredFounderPersonId?: string;
    readonly now: Date;
  }): Promise<StripeSessionRetryRepairProjection> {
    await assertStripeControlOperator({
      executor: this.database,
      actorPersonId: input.actorPersonId,
      ...(input.configuredFounderPersonId === undefined
        ? {}
        : { configuredFounderPersonId: input.configuredFounderPersonId }),
    });
    const environment = input.environment ?? 'test';
    const result = await this.database.query<
      {
        readonly id: string;
        readonly household_id: string;
        readonly server_operation_id: string;
        readonly state: StripeSessionRetryRepairProjection['state'];
        readonly attempt_count: number;
        readonly authorized_attempt_limit: number;
        readonly manual_retry_revision: number;
        readonly requested_expires_at: unknown;
        readonly attention_state: 'open' | 'snoozed' | null;
        readonly gates_open: boolean;
        readonly intent_exact: boolean;
        readonly deadline_open: boolean;
        readonly exhausted_hold: boolean;
      } & Record<string, unknown>
    >(
      `SELECT operation.id, operation.household_id, operation.server_operation_id,
              operation.state, operation.attempt_count, operation.authorized_attempt_limit,
              operation.manual_retry_revision, operation.requested_expires_at,
              attention.state AS attention_state,
              (intent.state = 'prepared' AND intent.dispatch_state = 'outcome_unknown'
                AND intent.provider_session_id IS NULL
                AND intent.provider_requested_expires_at = operation.requested_expires_at
                AND intent.expires_at = intent.provider_requested_expires_at + interval '5 minutes')
                AS intent_exact,
              (operation.requested_expires_at > CURRENT_TIMESTAMP + interval '30 minutes') AS deadline_open,
              (operation.next_retry_at IS NULL AND operation.attempt_count = operation.authorized_attempt_limit)
                AS exhausted_hold,
              EXISTS (
                SELECT 1
                FROM household_billing_authorities authority
                JOIN household_memberships membership
                  ON membership.household_id = authority.household_id
                 AND membership.person_id = authority.person_id
                JOIN commerce_stripe_initiation_controls control
                  ON control.environment = operation.environment
                JOIN commerce_stripe_eligible_households eligible
                  ON eligible.environment = control.environment
                 AND eligible.household_id = operation.household_id
                JOIN commerce_stripe_cohort_policies policy
                  ON policy.environment = control.environment
                 AND policy.cohort_key = eligible.cohort_key
                WHERE authority.household_id = operation.household_id
                  AND authority.person_id = operation.actor_person_id
                  AND authority.status = 'active' AND membership.status = 'active'
                  AND control.state = 'enabled'
                  AND eligible.cohort_key = 'founding_household_v1'
                  AND eligible.benefit_key = 'family_v1_monthly_1499'
                  AND eligible.state = 'eligible'
                  AND eligible.eligibility_expires_at > CURRENT_TIMESTAMP
                  AND policy.state = 'active'
                  AND policy.policy_expires_at > CURRENT_TIMESTAMP
                  AND policy.benefit_key = eligible.benefit_key
                  AND (operation.environment <> 'production' OR policy.live_approved = true)
              ) AS gates_open
       FROM commerce_stripe_session_operations operation
       JOIN commerce_checkout_intents intent
         ON intent.household_id = operation.household_id
        AND intent.id = operation.checkout_intent_id
       LEFT JOIN owner_attention_items attention
         ON attention.dedupe_key =
              ('stripe_session_unknown_' || operation.environment || '_checkout_' ||
               operation.server_operation_id)
        AND attention.source_type = 'commerce_session_operation'
        AND attention.source_id = operation.server_operation_id
        AND attention.state IN ('open','snoozed')
       WHERE operation.environment = $3 AND operation.action = 'checkout'
         AND operation.household_id = $1 AND operation.server_operation_id = $2`,
      [input.householdId, input.serverOperationId, environment],
    );
    const row = result.rows[0];
    if (row === undefined) throw new DomainError('not_found', 'Stripe session operation not found');
    const attentionState = row.attention_state ?? 'absent';
    return {
      operationId: row.id,
      householdId: row.household_id,
      serverOperationId: row.server_operation_id,
      environment,
      action: 'checkout',
      state: row.state,
      attemptCount: row.attempt_count,
      authorizedAttemptLimit: row.authorized_attempt_limit,
      revision: row.manual_retry_revision,
      providerDeadline: asDate(row.requested_expires_at),
      attentionState,
      repairAvailable:
        environment === 'test' &&
        row.state === 'outcome_unknown' &&
        row.attempt_count === 6 &&
        row.authorized_attempt_limit === 6 &&
        row.manual_retry_revision === 0 &&
        attentionState !== 'absent' &&
        row.intent_exact &&
        row.deadline_open &&
        row.exhausted_hold &&
        row.gates_open,
    };
  }

  async requestStripeSessionRetryRepair(input: {
    readonly householdId: string;
    readonly serverOperationId: string;
    readonly environment?: 'test' | 'production';
    readonly expectedRevision: 0;
    readonly reasonCode: 'founder_bounded_same_key_retry';
    readonly correlationId: string;
    readonly actorPersonId: string;
    readonly configuredFounderPersonId?: string;
    readonly runtimeInitiationPermitted: boolean;
    readonly now: Date;
  }): Promise<StripeSessionRetryRepairResult> {
    await assertStripeControlOperator({
      executor: this.database,
      actorPersonId: input.actorPersonId,
      ...(input.configuredFounderPersonId === undefined
        ? {}
        : { configuredFounderPersonId: input.configuredFounderPersonId }),
    });
    const environment = input.environment ?? 'test';
    if (environment === 'production') {
      throw new DomainError(
        'not_authorized',
        'Live unknown Checkout outcomes remain held for authentic provider reconciliation',
      );
    }
    if (
      !input.runtimeInitiationPermitted ||
      input.expectedRevision !== 0 ||
      input.reasonCode !== 'founder_bounded_same_key_retry' ||
      !validIdempotencyKey(input.serverOperationId) ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u.test(input.correlationId) ||
      !Number.isFinite(input.now.getTime())
    ) {
      throw new DomainError('not_authorized', 'Stripe same-key repair is unavailable');
    }
    return this.database.transaction(async (transaction) => {
      const operationResult = await transaction.query<
        {
          readonly id: string;
          readonly household_id: string;
          readonly checkout_intent_id: string | null;
          readonly server_operation_id: string;
          readonly provider_idempotency_key: string;
          readonly state: StripeSessionRetryRepairProjection['state'];
          readonly attempt_count: number;
          readonly authorized_attempt_limit: number;
          readonly manual_retry_revision: number;
          readonly requested_expires_at: unknown;
          readonly next_retry_at: unknown;
          readonly provider_session_id: string | null;
          readonly actor_person_id: string | null;
        } & Record<string, unknown>
      >(
        `SELECT id, household_id, checkout_intent_id, server_operation_id,
                provider_idempotency_key, state, attempt_count, authorized_attempt_limit,
                manual_retry_revision, requested_expires_at, next_retry_at,
                provider_session_id, actor_person_id
         FROM commerce_stripe_session_operations
         WHERE environment = 'test' AND action = 'checkout'
           AND household_id = $1 AND server_operation_id = $2
         FOR UPDATE`,
        [input.householdId, input.serverOperationId],
      );
      const operation = operationResult.rows[0];
      if (operation === undefined || operation.checkout_intent_id === null) {
        throw new DomainError('not_found', 'Stripe session operation not found');
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
         FROM commerce_stripe_session_retry_repair_events WHERE operation_id = $1`,
        [operation.id],
      );
      const prior = priorRepair.rows[0];
      if (prior !== undefined) {
        if (
          prior.actor_person_id !== input.actorPersonId ||
          prior.correlation_id !== input.correlationId ||
          prior.expected_revision !== input.expectedRevision ||
          prior.next_revision !== 1 ||
          prior.next_attempt_limit !== 7
        ) {
          throw new DomainError('conflict', 'Stripe same-key repair already differs');
        }
        return {
          operationId: operation.id,
          householdId: operation.household_id,
          serverOperationId: operation.server_operation_id,
          environment: 'test',
          action: 'checkout',
          revision: 1,
          authorizedAttemptLimit: 7,
          repairJobId: prior.repair_job_id,
          duplicate: true,
        };
      }
      if (
        operation.state !== 'outcome_unknown' ||
        operation.attempt_count !== 6 ||
        operation.authorized_attempt_limit !== 6 ||
        operation.manual_retry_revision !== input.expectedRevision ||
        operation.next_retry_at !== null ||
        operation.provider_session_id !== null ||
        operation.actor_person_id === null ||
        asDate(operation.requested_expires_at).getTime() <= input.now.getTime() + 30 * 60_000
      ) {
        throw new DomainError('conflict', 'Stripe session is not at the reviewed repair boundary');
      }
      const intent = await transaction.query(
        `SELECT 1 FROM commerce_checkout_intents
         WHERE household_id = $1 AND id = $2 AND environment = 'test'
           AND state = 'prepared' AND dispatch_state = 'outcome_unknown'
           AND provider_session_id IS NULL
           AND provider_requested_expires_at = $3
           AND expires_at = provider_requested_expires_at + interval '5 minutes'
           AND provider_requested_expires_at > $4::timestamptz + interval '30 minutes'
         FOR UPDATE`,
        [
          operation.household_id,
          operation.checkout_intent_id,
          asDate(operation.requested_expires_at).toISOString(),
          input.now.toISOString(),
        ],
      );
      const attention = await transaction.query(
        `SELECT 1 FROM owner_attention_items
         WHERE dedupe_key = $1 AND source_type = 'commerce_session_operation'
           AND source_id = $2 AND state IN ('open','snoozed') FOR UPDATE`,
        [
          `stripe_session_unknown_test_checkout_${operation.server_operation_id}`,
          operation.server_operation_id,
        ],
      );
      const gates = await transaction.query(
        `SELECT 1
         FROM household_billing_authorities authority
         JOIN household_memberships membership
           ON membership.household_id = authority.household_id
          AND membership.person_id = authority.person_id
         JOIN commerce_stripe_initiation_controls control ON control.environment = 'test'
         JOIN commerce_stripe_eligible_households eligible
           ON eligible.environment = control.environment
          AND eligible.household_id = authority.household_id
         JOIN commerce_stripe_cohort_policies policy
           ON policy.environment = control.environment
          AND policy.cohort_key = eligible.cohort_key
         WHERE authority.household_id = $1 AND authority.person_id = $2
           AND authority.status = 'active' AND membership.status = 'active'
           AND control.state = 'enabled'
           AND eligible.cohort_key = 'founding_household_v1'
           AND eligible.benefit_key = 'family_v1_monthly_1499'
           AND eligible.state = 'eligible' AND eligible.eligibility_expires_at > CURRENT_TIMESTAMP
           AND policy.state = 'active' AND policy.policy_expires_at > CURRENT_TIMESTAMP
           AND policy.benefit_key = eligible.benefit_key AND policy.live_approved = false
         FOR UPDATE OF authority, membership, control, eligible, policy`,
        [operation.household_id, operation.actor_person_id],
      );
      if (intent.rowCount !== 1 || attention.rowCount !== 1 || gates.rowCount !== 1) {
        throw new DomainError('not_authorized', 'Stripe same-key repair controls are not open');
      }
      const advanced = await transaction.query(
        `UPDATE commerce_stripe_session_operations
         SET authorized_attempt_limit = 7, manual_retry_revision = 1,
             next_retry_at = $3, updated_at = $3
         WHERE id = $1 AND state = 'outcome_unknown' AND manual_retry_revision = $2
           AND attempt_count = 6 AND authorized_attempt_limit = 6
           AND provider_session_id IS NULL`,
        [operation.id, input.expectedRevision, input.now.toISOString()],
      );
      if (advanced.rowCount !== 1) {
        throw new DomainError('conflict', 'Stripe same-key repair revision changed');
      }
      const queued = await enqueueDurableJobWithExecutor(transaction, this.idFactory, {
        type: 'commerce.stripe-session-retry',
        version: 1,
        householdId: operation.household_id,
        classification: 'internal',
        payload: {
          householdId: operation.household_id,
          environment: 'test',
          action: 'checkout',
          serverOperationId: operation.server_operation_id,
          manualRepairRevision: 1,
        },
        idempotencyKey: `stripe-session-founder-retry:test:checkout:${operation.id}:1`,
        scheduledAt: input.now,
        maxAttempts: 4,
        correlationId: input.correlationId,
      });
      await transaction.query(
        `INSERT INTO commerce_stripe_session_retry_repair_events(
           id, operation_id, checkout_intent_id, household_id, environment, action,
           expected_revision, next_revision, previous_attempt_limit, next_attempt_limit,
           provider_idempotency_key, provider_deadline, actor_person_id, reason_code,
           correlation_id, repair_job_id, requested_at
         ) VALUES ($1,$2,$3,$4,'test','checkout',0,1,6,7,$5,$6,$7,$8,$9,$10,$11)`,
        [
          this.idFactory.next('stripe-session-retry-repair'),
          operation.id,
          operation.checkout_intent_id,
          operation.household_id,
          operation.provider_idempotency_key,
          asDate(operation.requested_expires_at).toISOString(),
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
          householdId: operation.household_id,
          actorPersonId: input.actorPersonId,
          audience: 'hq',
          correlationId: input.correlationId,
          now: input.now,
        },
        {
          action: 'commerce.stripe_session_same_key_repair_requested',
          resourceType: 'commerce_session_operation',
          resourceId: operation.id,
          outcome: 'completed',
          metadata: { revision: 1, authorizedAttemptLimit: 7 },
        },
        {
          eventType: 'commerce.stripe_session_same_key_repair_requested.v1',
          aggregateType: 'commerce_session_operation',
          aggregateId: operation.id,
          payload: { revision: 1, authorizedAttemptLimit: 7 },
        },
      );
      return {
        operationId: operation.id,
        householdId: operation.household_id,
        serverOperationId: operation.server_operation_id,
        environment: 'test',
        action: 'checkout',
        revision: 1,
        authorizedAttemptLimit: 7,
        repairJobId: queued.job.id,
        duplicate: false,
      };
    });
  }

  async changeStripeHouseholdEligibility(input: {
    readonly householdId: string;
    readonly environment?: 'test' | 'production';
    readonly nextState: 'eligible' | 'revoked';
    readonly actorPersonId: string;
    readonly configuredFounderPersonId?: string;
    readonly correlationId: string;
    readonly eligibilityExpiresAt?: Date;
    readonly now: Date;
  }): Promise<'eligible' | 'revoked'> {
    const environment = input.environment ?? 'test';
    return this.database.transaction(async (transaction) => {
      await assertStripeControlOperator({
        executor: transaction,
        actorPersonId: input.actorPersonId,
        ...(input.configuredFounderPersonId === undefined
          ? {}
          : { configuredFounderPersonId: input.configuredFounderPersonId }),
      });
      const databaseClock = await transaction.query<{ readonly database_now: unknown }>(
        'SELECT CURRENT_TIMESTAMP AS database_now',
      );
      const databaseNowValue = databaseClock.rows[0]?.database_now;
      if (databaseNowValue === undefined) throw new Error('Database clock is unavailable');
      const databaseNow = asDate(databaseNowValue);
      const household = await transaction.query(
        'SELECT id FROM households WHERE id = $1 FOR UPDATE',
        [input.householdId],
      );
      if (household.rowCount !== 1) throw new DomainError('not_found', 'Household not found');
      await transaction.query(
        `INSERT INTO commerce_stripe_cohort_policies(
           environment, cohort_key, benefit_key, state, max_active, policy_expires_at,
           live_approved, revision, changed_by_person_id, changed_at
         ) VALUES (
           $1,'founding_household_v1','family_v1_monthly_1499',
           CASE WHEN $1 = 'test' THEN 'active' ELSE 'disabled' END,
           CASE WHEN $1 = 'test' THEN 1 ELSE 0 END,
           $2,false,1,$3,$4
         ) ON CONFLICT (environment) DO NOTHING`,
        [
          environment,
          new Date(databaseNow.getTime() + 180 * 24 * 60 * 60_000).toISOString(),
          input.actorPersonId,
          databaseNow.toISOString(),
        ],
      );
      const policy = await transaction.query<
        {
          readonly state: 'disabled' | 'active' | 'expired';
          readonly max_active: number;
          readonly policy_expires_at: unknown;
          readonly live_approved: boolean;
        } & Record<string, unknown>
      >(
        `SELECT state, max_active, policy_expires_at, live_approved
         FROM commerce_stripe_cohort_policies WHERE environment = $1 FOR UPDATE`,
        [environment],
      );
      const cohort = policy.rows[0];
      const policyExpiresAt = cohort === undefined ? new Date(0) : asDate(cohort.policy_expires_at);
      if (
        input.nextState === 'eligible' &&
        (cohort === undefined ||
          cohort.state !== 'active' ||
          policyExpiresAt <= databaseNow ||
          (environment === 'production' && !cohort.live_approved))
      ) {
        throw new DomainError('not_authorized', 'The environment-specific cohort is not active');
      }
      const existing = await transaction.query<
        {
          readonly state: 'eligible' | 'revoked';
          readonly invited_at: unknown;
          readonly eligibility_expires_at: unknown;
        } & Record<string, unknown>
      >(
        `SELECT state, invited_at, eligibility_expires_at
         FROM commerce_stripe_eligible_households
         WHERE environment = $1 AND household_id = $2 FOR UPDATE`,
        [environment, input.householdId],
      );
      const existingEligibility = existing.rows[0];
      const alreadyConsumesCapacity =
        existingEligibility?.state === 'eligible' &&
        asDate(existingEligibility.eligibility_expires_at) > databaseNow;
      if (input.nextState === 'eligible' && !alreadyConsumesCapacity) {
        const maxActive = cohort?.max_active ?? 0;
        const capacity = await transaction.query<{ readonly active_count: number }>(
          `SELECT count(*)::int AS active_count
           FROM commerce_stripe_eligible_households
           WHERE environment = $1 AND state = 'eligible' AND eligibility_expires_at > $2`,
          [environment, databaseNow.toISOString()],
        );
        if ((capacity.rows[0]?.active_count ?? maxActive) >= maxActive) {
          throw new DomainError('conflict', 'The environment-specific cohort is at capacity');
        }
      }
      const requestedExpiry =
        input.eligibilityExpiresAt ?? new Date(databaseNow.getTime() + 30 * 24 * 60 * 60_000);
      const eligibilityExpiresAt =
        input.nextState === 'eligible'
          ? new Date(Math.min(requestedExpiry.getTime(), policyExpiresAt.getTime()))
          : existingEligibility === undefined
            ? new Date(databaseNow.getTime() + 1_000)
            : asDate(existingEligibility.eligibility_expires_at);
      if (input.nextState === 'eligible' && eligibilityExpiresAt <= databaseNow) {
        throw new DomainError('invalid_input', 'Cohort eligibility expiry must be in the future');
      }
      await transaction.query(
        `INSERT INTO commerce_stripe_eligible_households(
           environment, household_id, cohort_key, benefit_key, state,
           invited_by_person_id, invited_at, changed_at, correlation_id,
           eligibility_expires_at
         ) VALUES ($1,$2,'founding_household_v1','family_v1_monthly_1499',$3,$4,$5,$5,$6,$7)
         ON CONFLICT (environment, household_id) DO UPDATE SET state = EXCLUDED.state,
           changed_at = EXCLUDED.changed_at, correlation_id = EXCLUDED.correlation_id,
           eligibility_expires_at = EXCLUDED.eligibility_expires_at`,
        [
          environment,
          input.householdId,
          input.nextState,
          input.actorPersonId,
          databaseNow.toISOString(),
          input.correlationId,
          eligibilityExpiresAt.toISOString(),
        ],
      );
      await transaction.query(
        `INSERT INTO commerce_stripe_eligibility_events(
           id, environment, household_id, cohort_key, benefit_key,
           previous_state, next_state, actor_person_id, correlation_id,
           eligibility_expires_at, occurred_at
         ) VALUES ($1,$2,$3,'founding_household_v1','family_v1_monthly_1499',$4,$5,$6,$7,$8,$9)`,
        [
          this.idFactory.next('stripe-eligibility-event'),
          environment,
          input.householdId,
          existing.rows[0]?.state ?? 'absent',
          input.nextState,
          input.actorPersonId,
          input.correlationId,
          eligibilityExpiresAt.toISOString(),
          databaseNow.toISOString(),
        ],
      );
      return input.nextState;
    });
  }

  async assertStripeInitiationAllowed(input: {
    readonly householdId: string;
    readonly environment: 'test' | 'production';
    readonly runtimeInitiationPermitted: boolean;
    readonly now?: Date;
  }): Promise<void> {
    if (!input.runtimeInitiationPermitted) {
      throw new DomainError(
        'not_authorized',
        'Stripe initiation remains founder-gated and disabled',
      );
    }
    const result = await this.database.query(
      `SELECT 1
       FROM commerce_stripe_initiation_controls control
       JOIN commerce_stripe_eligible_households eligible
         ON eligible.environment = control.environment AND eligible.household_id = $1
        JOIN commerce_stripe_cohort_policies policy
          ON policy.environment = control.environment
       WHERE control.environment = $2 AND control.state = 'enabled'
         AND eligible.cohort_key = 'founding_household_v1'
         AND eligible.benefit_key = 'family_v1_monthly_1499'
         AND eligible.state = 'eligible' AND eligible.eligibility_expires_at > CURRENT_TIMESTAMP
         AND policy.state = 'active' AND policy.policy_expires_at > CURRENT_TIMESTAMP
         AND policy.max_active > 0
         AND policy.benefit_key = eligible.benefit_key
         AND ($2 <> 'production' OR policy.live_approved = true)
         AND (
           SELECT count(*)::int
           FROM commerce_stripe_eligible_households cohort_member
           WHERE cohort_member.environment = $2
             AND cohort_member.cohort_key = policy.cohort_key
             AND cohort_member.benefit_key = policy.benefit_key
             AND cohort_member.state = 'eligible'
             AND cohort_member.eligibility_expires_at > CURRENT_TIMESTAMP
         ) <= policy.max_active`,
      [input.householdId, input.environment],
    );
    if (result.rowCount !== 1) {
      throw new DomainError(
        'not_authorized',
        'Stripe initiation is disabled or this household is outside the invited cohort',
      );
    }
  }

  async stripeCohortControlProjection(input: {
    readonly environment: 'test' | 'production';
    readonly actorPersonId: string;
    readonly configuredFounderPersonId?: string;
  }): Promise<StripeCohortControlProjection> {
    await assertStripeControlOperator({
      executor: this.database,
      actorPersonId: input.actorPersonId,
      ...(input.configuredFounderPersonId === undefined
        ? {}
        : { configuredFounderPersonId: input.configuredFounderPersonId }),
    });
    const result = await this.database.query<
      {
        readonly state: 'disabled' | 'active' | 'expired';
        readonly max_active: number;
        readonly policy_expires_at: unknown;
        readonly live_approved: boolean;
        readonly revision: number;
        readonly changed_at: unknown;
      } & Record<string, unknown>
    >(
      `SELECT state, max_active, policy_expires_at, live_approved, revision, changed_at
       FROM commerce_stripe_cohort_policies WHERE environment = $1`,
      [input.environment],
    );
    const row = result.rows[0];
    return row === undefined
      ? {
          environment: input.environment,
          state: 'absent',
          maxActive: 0,
          liveApproved: false,
          revision: 0,
        }
      : {
          environment: input.environment,
          state: row.state,
          maxActive: row.max_active,
          policyExpiresAt: asDate(row.policy_expires_at),
          liveApproved: row.live_approved,
          revision: row.revision,
          changedAt: asDate(row.changed_at),
        };
  }

  async changeStripeCohortPolicy(input: {
    readonly environment: 'test' | 'production';
    readonly nextState: 'disabled' | 'active' | 'expired';
    readonly maxActive: number;
    readonly policyExpiresAt?: Date;
    readonly liveApproved: boolean;
    readonly expectedRevision: number;
    readonly reasonCode:
      | 'cohort_activation'
      | 'cohort_change'
      | 'cohort_expiration'
      | 'founder_disable'
      | 'incident_stop';
    readonly actorPersonId: string;
    readonly configuredFounderPersonId?: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<StripeCohortControlProjection> {
    if (
      !Number.isSafeInteger(input.maxActive) ||
      input.maxActive < 0 ||
      input.maxActive > 1 ||
      !Number.isFinite(input.now.getTime())
    ) {
      throw new DomainError('invalid_input', 'Stripe cohort control is invalid');
    }
    return this.database.transaction(async (transaction) => {
      await assertStripeControlOperator({
        executor: transaction,
        actorPersonId: input.actorPersonId,
        ...(input.configuredFounderPersonId === undefined
          ? {}
          : { configuredFounderPersonId: input.configuredFounderPersonId }),
      });
      const databaseClock = await transaction.query<{ readonly database_now: unknown }>(
        'SELECT CURRENT_TIMESTAMP AS database_now',
      );
      const databaseNowValue = databaseClock.rows[0]?.database_now;
      if (databaseNowValue === undefined) throw new Error('Database clock is unavailable');
      const databaseNow = asDate(databaseNowValue);
      const active = input.nextState === 'active';
      const policyExpiresAt = active ? input.policyExpiresAt : databaseNow;
      const activationReason =
        input.reasonCode === 'cohort_activation' || input.reasonCode === 'cohort_change';
      const disabledReason =
        input.reasonCode === 'cohort_change' ||
        input.reasonCode === 'founder_disable' ||
        input.reasonCode === 'incident_stop';
      const expiredReason =
        input.reasonCode === 'cohort_expiration' || input.reasonCode === 'incident_stop';
      if (
        (active &&
          (input.maxActive !== 1 ||
            policyExpiresAt === undefined ||
            !Number.isFinite(policyExpiresAt.getTime()) ||
            policyExpiresAt <= databaseNow ||
            !activationReason ||
            input.liveApproved !== (input.environment === 'production'))) ||
        (input.nextState === 'disabled' &&
          (input.maxActive !== 0 || input.liveApproved || !disabledReason)) ||
        (input.nextState === 'expired' &&
          (input.maxActive !== 0 || input.liveApproved || !expiredReason))
      ) {
        throw new DomainError('invalid_input', 'Stripe cohort state and approval are inconsistent');
      }
      const currentResult = await transaction.query<
        {
          readonly state: 'disabled' | 'active' | 'expired';
          readonly max_active: number;
          readonly policy_expires_at: unknown;
          readonly live_approved: boolean;
          readonly revision: number;
        } & Record<string, unknown>
      >(
        `SELECT state, max_active, policy_expires_at, live_approved, revision
         FROM commerce_stripe_cohort_policies WHERE environment = $1 FOR UPDATE`,
        [input.environment],
      );
      const current = currentResult.rows[0];
      const previousRevision = current?.revision ?? 0;
      if (previousRevision !== input.expectedRevision) {
        throw new DomainError('conflict', 'Stripe cohort policy revision changed');
      }
      const revision = previousRevision + 1;
      const changed = await transaction.query<
        {
          readonly state: 'disabled' | 'active' | 'expired';
          readonly max_active: number;
          readonly policy_expires_at: unknown;
          readonly live_approved: boolean;
          readonly revision: number;
          readonly changed_at: unknown;
        } & Record<string, unknown>
      >(
        `INSERT INTO commerce_stripe_cohort_policies(
           environment, cohort_key, benefit_key, state, max_active, policy_expires_at,
           live_approved, revision, changed_by_person_id, changed_at
         ) VALUES ($1,'founding_household_v1','family_v1_monthly_1499',$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (environment) DO UPDATE SET
           state = EXCLUDED.state, max_active = EXCLUDED.max_active,
           policy_expires_at = EXCLUDED.policy_expires_at,
           live_approved = EXCLUDED.live_approved, revision = EXCLUDED.revision,
           changed_by_person_id = EXCLUDED.changed_by_person_id,
           changed_at = EXCLUDED.changed_at
         WHERE commerce_stripe_cohort_policies.revision = $9
         RETURNING state, max_active, policy_expires_at, live_approved, revision, changed_at`,
        [
          input.environment,
          input.nextState,
          input.maxActive,
          (policyExpiresAt as Date).toISOString(),
          input.liveApproved,
          revision,
          input.actorPersonId,
          databaseNow.toISOString(),
          input.expectedRevision,
        ],
      );
      const row = changed.rows[0];
      if (row === undefined) throw new DomainError('conflict', 'Stripe cohort revision changed');
      await transaction.query(
        `INSERT INTO commerce_stripe_cohort_policy_events_v2(
           id, environment, previous_state, next_state, previous_max_active, next_max_active,
           previous_policy_expires_at, next_policy_expires_at,
           previous_live_approved, next_live_approved, expected_revision, next_revision,
           actor_person_id, reason_code, correlation_id, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          this.idFactory.next('stripe-cohort-control-event'),
          input.environment,
          current?.state ?? 'absent',
          row.state,
          current?.max_active ?? null,
          row.max_active,
          current === undefined ? null : asDate(current.policy_expires_at).toISOString(),
          asDate(row.policy_expires_at).toISOString(),
          current?.live_approved ?? null,
          row.live_approved,
          input.expectedRevision,
          row.revision,
          input.actorPersonId,
          input.reasonCode,
          input.correlationId,
          asDate(row.changed_at).toISOString(),
        ],
      );
      await writeAuditAndOutbox(
        transaction,
        this.idFactory,
        {
          actorPersonId: input.actorPersonId,
          audience: 'hq',
          correlationId: input.correlationId,
          now: asDate(row.changed_at),
        },
        {
          action: 'commerce.stripe_cohort_control_changed',
          resourceType: 'commerce_stripe_cohort_policy',
          resourceId: input.environment,
          outcome: 'completed',
          metadata: {
            state: row.state,
            maxActive: row.max_active,
            liveApproved: row.live_approved,
            revision: row.revision,
          },
        },
        {
          eventType: 'commerce.stripe_cohort_control_changed.v2',
          aggregateType: 'commerce_stripe_cohort_policy',
          aggregateId: input.environment,
          payload: {
            state: row.state,
            maxActive: row.max_active,
            liveApproved: row.live_approved,
            revision: row.revision,
          },
        },
      );
      return {
        environment: input.environment,
        state: row.state,
        maxActive: row.max_active,
        policyExpiresAt: asDate(row.policy_expires_at),
        liveApproved: row.live_approved,
        revision: row.revision,
        changedAt: asDate(row.changed_at),
      };
    });
  }

  /** Compatibility seam for the former approval-only test helper. */
  async changeStripeLiveCohortApproval(input: {
    readonly nextApproved: boolean;
    readonly expectedRevision: number;
    readonly actorPersonId: string;
    readonly configuredFounderPersonId?: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<{ readonly approved: boolean; readonly revision: number }> {
    const changed = await this.changeStripeCohortPolicy({
      environment: 'production',
      nextState: input.nextApproved ? 'active' : 'disabled',
      maxActive: input.nextApproved ? 1 : 0,
      ...(input.nextApproved
        ? { policyExpiresAt: new Date(input.now.getTime() + 30 * 24 * 60 * 60_000) }
        : {}),
      liveApproved: input.nextApproved,
      expectedRevision: input.expectedRevision,
      reasonCode: input.nextApproved ? 'cohort_activation' : 'founder_disable',
      actorPersonId: input.actorPersonId,
      ...(input.configuredFounderPersonId === undefined
        ? {}
        : { configuredFounderPersonId: input.configuredFounderPersonId }),
      correlationId: input.correlationId,
      now: input.now,
    });
    return { approved: changed.liveApproved, revision: changed.revision };
  }

  async stripeControlStatusProjection(input: {
    readonly environment: 'test' | 'production';
    readonly actorPersonId: string;
    readonly configuredFounderPersonId?: string;
    readonly now: Date;
  }): Promise<StripeControlStatusProjection> {
    if (!Number.isFinite(input.now.getTime())) {
      throw new DomainError('invalid_input', 'Stripe status time is invalid');
    }
    await assertStripeControlOperator({
      executor: this.database,
      actorPersonId: input.actorPersonId,
      ...(input.configuredFounderPersonId === undefined
        ? {}
        : { configuredFounderPersonId: input.configuredFounderPersonId }),
    });
    type PreflightRow = {
      readonly checked_at: unknown;
      readonly evidence_level:
        'local_fixture' | 'stripe_test' | 'deployed_staging' | 'live_production';
      readonly authenticity_kind: 'fixture_assertion' | 'provider_read';
      readonly transport_kind: 'injected_fixture' | 'stripe_https';
      readonly evidence_digest: string;
      readonly product_active: boolean;
      readonly price_active: boolean;
      readonly portal_cancel_only: boolean;
      readonly portal_mutation_controls_exact: boolean;
      readonly portal_subscription_update_defaults_empty: boolean;
      readonly portal_payment_method_update_enabled: boolean;
      readonly promotions_enabled: boolean;
      readonly automatic_tax_enabled: boolean;
      readonly adaptive_pricing_enabled: boolean;
      readonly account_charges_enabled: boolean | null;
      readonly account_payouts_enabled: boolean | null;
      readonly account_country: string | null;
      readonly account_business_type: string | null;
    } & Record<string, unknown>;
    const [preflights, initiationEvents, cohortEvents, eligibilityEvents, eligible] =
      await Promise.all([
        this.database.query<PreflightRow>(
          `SELECT checked_at, evidence_level, authenticity_kind, transport_kind,
                  evidence_digest, product_active, price_active, portal_cancel_only,
                  portal_mutation_controls_exact,
                  portal_subscription_update_defaults_empty,
                  portal_payment_method_update_enabled, promotions_enabled,
                  automatic_tax_enabled, adaptive_pricing_enabled,
                  account_charges_enabled, account_payouts_enabled,
                  account_country, account_business_type
           FROM commerce_stripe_preflight_records
           WHERE environment = $1
           ORDER BY checked_at DESC, id DESC LIMIT 50`,
          [input.environment],
        ),
        this.database.query<
          {
            readonly previous_state: string;
            readonly next_state: string;
            readonly revision: number;
            readonly reason_code: string;
            readonly occurred_at: unknown;
          } & Record<string, unknown>
        >(
          `SELECT previous_state, next_state, revision, reason_code, occurred_at
           FROM commerce_stripe_initiation_control_events
           WHERE environment = $1
           ORDER BY occurred_at DESC, id DESC LIMIT 50`,
          [input.environment],
        ),
        this.database.query<
          {
            readonly previous_state: string;
            readonly next_state: string;
            readonly next_revision: number;
            readonly reason_code: string;
            readonly occurred_at: unknown;
          } & Record<string, unknown>
        >(
          `SELECT previous_state, next_state, next_revision, reason_code, occurred_at
           FROM commerce_stripe_cohort_policy_events_v2
           WHERE environment = $1
           ORDER BY occurred_at DESC, id DESC LIMIT 50`,
          [input.environment],
        ),
        this.database.query<
          {
            readonly household_id: string;
            readonly previous_state: string;
            readonly next_state: string;
            readonly occurred_at: unknown;
          } & Record<string, unknown>
        >(
          `SELECT household_id, previous_state, next_state, occurred_at
           FROM commerce_stripe_eligibility_events
           WHERE environment = $1
           ORDER BY occurred_at DESC, id DESC LIMIT 50`,
          [input.environment],
        ),
        this.database.query<
          {
            readonly household_id: string;
            readonly eligibility_expires_at: unknown;
            readonly occurred_at: unknown;
          } & Record<string, unknown>
        >(
          `WITH latest AS (
             SELECT household_id, next_state, eligibility_expires_at, occurred_at,
                    row_number() OVER (
                      PARTITION BY household_id ORDER BY occurred_at DESC, id DESC
                    ) AS row_number
             FROM commerce_stripe_eligibility_events
             WHERE environment = $1
           )
           SELECT household_id, eligibility_expires_at, occurred_at
           FROM latest
           WHERE row_number = 1 AND next_state = 'eligible'
             AND eligibility_expires_at > $2
           ORDER BY occurred_at DESC, household_id LIMIT 2`,
          [input.environment, input.now.toISOString()],
        ),
      ]);
    if (eligible.rows.length > 1) {
      throw new DomainError('conflict', 'Stripe cohort evidence exceeds its one-household cap');
    }
    const preflightState = (row: PreflightRow) => {
      const accountReady =
        input.environment === 'test' ||
        (row.account_charges_enabled === true &&
          row.account_payouts_enabled === true &&
          row.account_country === 'US' &&
          row.account_business_type === 'company');
      const offerReady = row.product_active && row.price_active;
      const portalReady =
        row.portal_cancel_only &&
        row.portal_mutation_controls_exact &&
        row.portal_subscription_update_defaults_empty &&
        row.portal_payment_method_update_enabled;
      const checkoutPolicyReady =
        !row.promotions_enabled && !row.automatic_tax_enabled && !row.adaptive_pricing_enabled;
      return {
        state:
          accountReady && offerReady && portalReady && checkoutPolicyReady
            ? row.authenticity_kind === 'provider_read'
              ? ('verified' as const)
              : ('configured' as const)
            : ('unavailable' as const),
        checkedAt: asDate(row.checked_at),
        evidenceLevel: row.evidence_level,
        authenticityKind: row.authenticity_kind,
        transportKind: row.transport_kind,
        evidenceDigest: row.evidence_digest,
        checks: { accountReady, offerReady, portalReady, checkoutPolicyReady },
      };
    };
    const latestPreflight = preflights.rows[0];
    const evidence: StripeControlStatusProjection['evidence'][number][] = [
      ...preflights.rows.map((row) => ({
        kind: 'preflight' as const,
        state: preflightState(row).state,
        occurredAt: asDate(row.checked_at),
        evidenceLevel: row.evidence_level,
        authenticityKind: row.authenticity_kind,
        transportKind: row.transport_kind,
        evidenceDigest: row.evidence_digest,
      })),
      ...initiationEvents.rows.map((row) => ({
        kind: 'initiation_control' as const,
        state: `${row.previous_state}_to_${row.next_state}`,
        occurredAt: asDate(row.occurred_at),
        revision: row.revision,
        reasonCode: row.reason_code,
      })),
      ...cohortEvents.rows.map((row) => ({
        kind: 'cohort_control' as const,
        state: `${row.previous_state}_to_${row.next_state}`,
        occurredAt: asDate(row.occurred_at),
        revision: row.next_revision,
        reasonCode: row.reason_code,
      })),
      ...eligibilityEvents.rows.map((row) => ({
        kind: 'eligibility' as const,
        state: `${row.previous_state}_to_${row.next_state}`,
        occurredAt: asDate(row.occurred_at),
        subjectId: row.household_id,
      })),
    ];
    evidence.sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime());
    return {
      environment: input.environment,
      preflight:
        latestPreflight === undefined ? { state: 'unknown' } : preflightState(latestPreflight),
      eligibleHouseholds: eligible.rows.map((row) => ({
        householdId: row.household_id,
        state: 'eligible' as const,
        eligibilityExpiresAt: asDate(row.eligibility_expires_at),
        occurredAt: asDate(row.occurred_at),
      })),
      evidence: evidence.slice(0, 50),
    };
  }

  async recordStripePreflight(input: {
    readonly evidence: StripePreflightEvidence;
    readonly evidenceLevel:
      'local_fixture' | 'stripe_test' | 'deployed_staging' | 'live_production';
    readonly transportKind: 'injected_fixture' | 'stripe_https';
    readonly runtimeRunId: string;
    readonly authenticityKind: 'fixture_assertion' | 'provider_read';
    readonly now: Date;
  }): Promise<string> {
    const canonical = JSON.stringify({
      environment: input.evidence.environment,
      accountId: input.evidence.accountId,
      accountChargesEnabled: input.evidence.accountChargesEnabled,
      accountPayoutsEnabled: input.evidence.accountPayoutsEnabled,
      accountCountry: input.evidence.accountCountry,
      accountBusinessType: input.evidence.accountBusinessType,
      apiVersion: input.evidence.apiVersion,
      offer: input.evidence.offer,
      portalConfigurationId: input.evidence.portalConfigurationId,
      productActive: input.evidence.productActive,
      priceActive: input.evidence.priceActive,
      portalCancelOnly: input.evidence.portalCancelOnly,
      portalCancellationMode: input.evidence.portalCancellationMode,
      portalProrationBehavior: input.evidence.portalProrationBehavior,
      portalSubscriptionUpdateDefaultsEmpty: input.evidence.portalSubscriptionUpdateDefaultsEmpty,
      portalPaymentMethodUpdateEnabled: input.evidence.portalPaymentMethodUpdateEnabled,
      promotionsEnabled: input.evidence.promotionsEnabled,
      automaticTaxEnabled: input.evidence.automaticTaxEnabled,
      adaptivePricingEnabled: input.evidence.adaptivePricingEnabled,
      portalMutationControlsExact: input.evidence.portalMutationControlsExact,
      retentionCouponEvidence: input.evidence.retentionCouponEvidence,
      evidenceLevel: input.evidenceLevel,
      transportKind: input.transportKind,
      runtimeRunId: input.runtimeRunId,
      authenticityKind: input.authenticityKind,
      checkedAt: input.now.toISOString(),
    });
    const digest = createHash('sha256').update(canonical).digest('hex');
    const id = this.idFactory.next('stripe-preflight');
    await this.database.query(
      `INSERT INTO commerce_stripe_preflight_records(
         id, environment, account_id, livemode, api_version, offer_id,
         provider_product_id, provider_price_id, portal_configuration_id,
         currency, unit_amount_minor, quantity, product_active, price_active,
         recurring_interval, portal_cancel_only, promotions_enabled,
         automatic_tax_enabled, adaptive_pricing_enabled, evidence_level,
         evidence_digest, checked_at, transport_kind, runtime_run_id,
         authenticity_kind, portal_mutation_controls_exact, retention_coupon_evidence,
         portal_cancellation_mode, portal_proration_behavior,
         portal_subscription_update_defaults_empty,
         portal_payment_method_update_enabled, account_charges_enabled,
         account_payouts_enabled, account_country, account_business_type
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'month',$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34)`,
      [
        id,
        input.evidence.environment,
        input.evidence.accountId,
        input.evidence.livemode,
        input.evidence.apiVersion,
        input.evidence.offer.offerId,
        input.evidence.offer.providerProductId,
        input.evidence.offer.providerPriceId,
        input.evidence.portalConfigurationId,
        input.evidence.offer.currency,
        input.evidence.offer.unitAmountMinor,
        input.evidence.offer.quantity,
        input.evidence.productActive,
        input.evidence.priceActive,
        input.evidence.portalCancelOnly,
        input.evidence.promotionsEnabled,
        input.evidence.automaticTaxEnabled,
        input.evidence.adaptivePricingEnabled,
        input.evidenceLevel,
        digest,
        input.now.toISOString(),
        input.transportKind,
        input.runtimeRunId,
        input.authenticityKind,
        input.evidence.portalMutationControlsExact,
        input.evidence.retentionCouponEvidence,
        input.evidence.portalCancellationMode,
        input.evidence.portalProrationBehavior,
        input.evidence.portalSubscriptionUpdateDefaultsEmpty,
        input.evidence.portalPaymentMethodUpdateEnabled,
        input.evidence.accountChargesEnabled,
        input.evidence.accountPayoutsEnabled,
        input.evidence.accountCountry,
        input.evidence.accountBusinessType,
      ],
    );
    return digest;
  }

  async prepareStripeCheckout(input: {
    readonly actor: CommerceActor;
    readonly offerId: 'founding_family_monthly_v1';
    readonly planVersionId: string;
    readonly billingInterval: 'month' | 'year';
    readonly providerPriceId: string;
    readonly idempotencyKey: string;
    readonly providerIdempotencyKey?: string;
    readonly serverOperationId?: string;
    readonly environment?: 'test' | 'production';
    readonly now: Date;
  }): Promise<PreparedStripeCheckout> {
    const serverOperationId = input.serverOperationId ?? input.idempotencyKey;
    const providerIdempotencyKey = input.providerIdempotencyKey ?? input.idempotencyKey;
    const environment = input.environment ?? 'test';
    if (
      !validIdempotencyKey(input.idempotencyKey) ||
      !validIdempotencyKey(serverOperationId) ||
      !validIdempotencyKey(providerIdempotencyKey)
    ) {
      throw new DomainError('invalid_input', 'A valid checkout idempotency key is required');
    }
    return this.database.transaction(async (transaction) => {
      await transaction.query('SELECT id FROM households WHERE id = $1 FOR UPDATE', [
        input.actor.householdId,
      ]);
      await transaction.query(
        `UPDATE commerce_checkout_intents
         SET state = 'expired', updated_at = $2
         WHERE household_id = $1 AND state IN ('prepared','session_created')
           AND dispatch_state = 'not_dispatched' AND expires_at <= $2`,
        [input.actor.householdId, input.now.toISOString()],
      );
      await transaction.query(
        `UPDATE commerce_stripe_session_operations operation
         SET state = 'failed_no_effect', lease_expires_at = NULL, next_retry_at = NULL,
             last_error_code = 'stripe.checkout_original_expiry_elapsed',
             terminal_at = $2, updated_at = $2
         FROM commerce_checkout_intents intent
         WHERE intent.household_id = $1 AND intent.state = 'expired'
           AND intent.id = operation.checkout_intent_id
           AND operation.household_id = intent.household_id
           AND operation.state IN ('dispatching','outcome_unknown')
           AND operation.provider_session_id IS NULL
           AND intent.dispatch_state = 'not_dispatched'`,
        [input.actor.householdId, input.now.toISOString()],
      );
      await transaction.query(
        `UPDATE commerce_subscriptions subscription
         SET lifecycle = 'expired', reconciliation_state = 'not_required', updated_at = $2
         WHERE subscription.household_id = $1 AND subscription.source = 'web'
           AND subscription.lifecycle = 'pending'
           AND EXISTS (
             SELECT 1 FROM commerce_checkout_intents intent
             WHERE intent.household_id = subscription.household_id
               AND intent.subscription_id = subscription.id AND intent.state = 'expired'
           )`,
        [input.actor.householdId, input.now.toISOString()],
      );
      const authority = await resolveActiveBillingAuthority(
        transaction,
        input.actor.householdId,
        input.actor.personId,
      );
      if (authority === null || authority.authorityReference !== input.actor.billingAuthorityId) {
        throw new DomainError('not_authorized', 'Active billing authority is required');
      }
      const existing = await transaction.query<CheckoutIntentRow>(
        `SELECT id, household_id, subscription_id, requested_by_person_id,
                billing_authority_person_id, plan_version_id, billing_interval,
                offer_id, provider_price_id, environment, state,
                provider_session_id, expires_at, provider_requested_expires_at,
                provider_returned_expires_at, server_operation_id, provider_idempotency_key
         FROM commerce_checkout_intents
         WHERE household_id = $1 AND idempotency_key = $2
         FOR UPDATE`,
        [input.actor.householdId, input.idempotencyKey],
      );
      const prior = existing.rows[0];
      if (prior !== undefined) {
        if (prior.state === 'expired') {
          throw new DomainError('conflict', 'Checkout intent expired; use a new idempotency key');
        }
        if (
          prior.requested_by_person_id !== input.actor.personId ||
          prior.billing_authority_person_id !== input.actor.personId ||
          prior.offer_id !== input.offerId ||
          prior.plan_version_id !== input.planVersionId ||
          prior.billing_interval !== input.billingInterval ||
          prior.provider_price_id !== input.providerPriceId ||
          prior.environment !== environment ||
          prior.server_operation_id !== serverOperationId ||
          prior.provider_idempotency_key !== providerIdempotencyKey
        ) {
          throw new DomainError('conflict', 'Checkout idempotency key has conflicting intent');
        }
        return {
          intentId: prior.id,
          subscriptionId: prior.subscription_id,
          planVersionId: prior.plan_version_id,
          actor: input.actor,
          duplicate: true,
          ...(prior.provider_session_id === null
            ? {}
            : { providerSessionId: prior.provider_session_id }),
          providerIdempotencyKey,
          serverOperationId,
          providerExpiresAt: asDate(prior.provider_requested_expires_at),
          expiresAt: asDate(prior.expires_at),
        };
      }
      const openSubscription = await transaction.query(
        `SELECT 1 FROM commerce_subscriptions
         WHERE household_id = $1 AND source = 'web'
           AND lifecycle IN (
             'pending','trialing','active','grace','delinquent','paused','hold',
             'cancel_at_period_end'
           )
         LIMIT 1 FOR UPDATE`,
        [input.actor.householdId],
      );
      if (openSubscription.rowCount > 0) {
        throw new DomainError(
          'conflict',
          'This household already has an open web subscription or checkout',
        );
      }
      const plan = await transaction.query(
        `SELECT 1
         FROM commerce_stripe_offer_contracts offer
         JOIN commerce_plan_versions plan ON plan.id = offer.plan_version_id
         WHERE offer.offer_id = $1 AND offer.plan_version_id = $2
           AND offer.billing_interval = $3 AND offer.currency = 'usd'
           AND offer.unit_amount_minor = 1499 AND offer.quantity = 1
           AND offer.promotions_enabled = false
           AND offer.automatic_tax_enabled = false
           AND offer.adaptive_pricing_enabled = false
           AND plan.plan_key = 'family' AND plan.state IN ('hypothesis','active')
           AND plan.available_from <= $4
           AND (plan.available_until IS NULL OR plan.available_until > $4)
         FOR SHARE`,
        [input.offerId, input.planVersionId, input.billingInterval, input.now.toISOString()],
      );
      if (plan.rowCount !== 1) {
        throw new DomainError('not_found', 'Checkout plan is unavailable');
      }
      const intentId = this.idFactory.next('checkout-intent');
      const subscriptionId = this.idFactory.next('subscription');
      // Stripe permits a session expiry up to 24 hours. A 23-hour immutable window gives
      // the same-key ambiguity worker time to recover without silently moving the deadline.
      const providerExpiresAt = new Date(
        Math.floor((input.now.getTime() + 23 * 60 * 60_000) / 1_000) * 1_000,
      );
      const expiresAt = new Date(providerExpiresAt.getTime() + 5 * 60_000);
      await transaction.query(
        `INSERT INTO commerce_subscriptions(
           household_id, id, payer_person_id, plan_version_id, source, lifecycle,
           source_verified, precedence, current_period_starts_at, current_period_ends_at,
           reconciliation_state, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,'web','pending',false,300,$5,NULL,'pending',$5,$5)`,
        [
          input.actor.householdId,
          subscriptionId,
          input.actor.personId,
          input.planVersionId,
          input.now.toISOString(),
        ],
      );
      await transaction.query(
        `INSERT INTO commerce_checkout_intents(
           household_id, id, subscription_id, requested_by_person_id,
           billing_authority_person_id, plan_version_id, offer_id, billing_interval,
           provider_price_id, provider, environment,
           idempotency_key, state, created_at, updated_at, expires_at,
           server_operation_id, provider_idempotency_key, provider_requested_expires_at,
           dispatch_state
         ) VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,'stripe',$9,$10,'prepared',$11,$11,$12,
                   $13,$14,$15,'not_dispatched')`,
        [
          input.actor.householdId,
          intentId,
          subscriptionId,
          input.actor.personId,
          input.planVersionId,
          input.offerId,
          input.billingInterval,
          input.providerPriceId,
          environment,
          input.idempotencyKey,
          input.now.toISOString(),
          expiresAt.toISOString(),
          serverOperationId,
          providerIdempotencyKey,
          providerExpiresAt.toISOString(),
        ],
      );
      return {
        intentId,
        subscriptionId,
        planVersionId: input.planVersionId,
        actor: input.actor,
        duplicate: false,
        providerIdempotencyKey,
        serverOperationId,
        providerExpiresAt,
        expiresAt,
      };
    });
  }

  async recordStripeCheckoutSession(input: {
    readonly householdId: string;
    readonly intentId: string;
    readonly providerSessionId: string;
    readonly environment?: 'test' | 'production';
    readonly serverOperationId?: string;
    readonly providerIdempotencyKey?: string;
    readonly providerSessionUrl?: string;
    readonly requestedExpiresAt?: Date;
    readonly returnedExpiresAt?: Date;
    readonly now: Date;
  }): Promise<void> {
    const environment = input.environment ?? 'test';
    const expectedSession =
      environment === 'test' ? /^cs_test_[A-Za-z0-9_]+$/u : /^cs_live_[A-Za-z0-9_]+$/u;
    if (!expectedSession.test(input.providerSessionId)) {
      throw new DomainError('invalid_input', 'Stripe session identifier is invalid');
    }
    if (
      (input.requestedExpiresAt === undefined) !== (input.returnedExpiresAt === undefined) ||
      (input.requestedExpiresAt !== undefined &&
        (!Number.isFinite(input.requestedExpiresAt.getTime()) ||
          input.requestedExpiresAt.getTime() % 1_000 !== 0 ||
          input.returnedExpiresAt?.getTime() !== input.requestedExpiresAt.getTime()))
    ) {
      throw new DomainError('invalid_input', 'Stripe session expiry evidence is not exact');
    }
    await this.database.transaction(async (transaction) => {
      const updated = await transaction.query(
        `UPDATE commerce_checkout_intents
         SET state = 'session_created', provider_session_id = $3,
             provider_returned_expires_at = COALESCE($5, provider_returned_expires_at),
             dispatch_state = 'session_recorded', updated_at = $4
         WHERE household_id = $1 AND id = $2 AND environment = $6
           AND state IN ('prepared','session_created')
           AND (provider_session_id IS NULL OR provider_session_id = $3)
           AND ($5::timestamptz IS NULL OR provider_requested_expires_at = $5)`,
        [
          input.householdId,
          input.intentId,
          input.providerSessionId,
          input.now.toISOString(),
          input.returnedExpiresAt?.toISOString() ?? null,
          environment,
        ],
      );
      if (updated.rowCount !== 1) {
        throw new DomainError('conflict', 'Checkout session linkage is invalid');
      }
      if (
        input.serverOperationId !== undefined &&
        input.providerIdempotencyKey !== undefined &&
        input.requestedExpiresAt !== undefined &&
        input.returnedExpiresAt !== undefined
      ) {
        const operation = await transaction.query<
          {
            readonly id: string;
            readonly attempt_count: number;
            readonly provider_idempotency_key: string;
          } & Record<string, unknown>
        >(
          `UPDATE commerce_stripe_session_operations
           SET state = 'succeeded', provider_session_id = $5,
               provider_session_url = $10, returned_expires_at = $6, updated_at = $7,
               lease_expires_at = NULL, next_retry_at = NULL, terminal_at = $7
           WHERE environment = $1 AND action = 'checkout' AND household_id = $2
             AND checkout_intent_id = $3 AND server_operation_id = $4
             AND provider_idempotency_key = $8
             AND state IN ('dispatching','outcome_unknown','succeeded')
             AND requested_expires_at = $9
             AND (provider_session_id IS NULL OR provider_session_id = $5)
           RETURNING id, attempt_count, provider_idempotency_key`,
          [
            environment,
            input.householdId,
            input.intentId,
            input.serverOperationId,
            input.providerSessionId,
            input.returnedExpiresAt.toISOString(),
            input.now.toISOString(),
            input.providerIdempotencyKey,
            input.requestedExpiresAt.toISOString(),
            input.providerSessionUrl ?? null,
          ],
        );
        if (operation.rowCount !== 1) {
          throw new DomainError('conflict', 'Stripe dispatch operation linkage is invalid');
        }
        const operationRow = operation.rows[0];
        if (operationRow !== undefined) {
          await transaction.query(
            `INSERT INTO commerce_stripe_session_operation_attempts(
               id, operation_id, attempt, event_kind, provider_idempotency_key,
               provider_session_id, occurred_at
             ) VALUES ($1,$2,$3,'succeeded',$4,$5,$6)
             ON CONFLICT (operation_id, attempt, event_kind) DO NOTHING`,
            [
              this.idFactory.next('stripe-session-attempt'),
              operationRow.id,
              operationRow.attempt_count,
              operationRow.provider_idempotency_key,
              input.providerSessionId,
              input.now.toISOString(),
            ],
          );
        }
      }
    });
  }

  async stripeSessionRetryContext(input: {
    readonly householdId: string;
    readonly environment: 'test' | 'production';
    readonly action: 'checkout' | 'portal';
    readonly serverOperationId: string;
    readonly now: Date;
  }): Promise<StripeSessionRetryDisposition> {
    const result = await this.database.query<
      {
        readonly checkout_intent_id: string | null;
        readonly provider_idempotency_key: string;
        readonly actor_person_id: string | null;
        readonly canonical_subscription_id: string | null;
        readonly plan_version_id: string | null;
        readonly provider_price_id: string | null;
        readonly provider_customer_id: string | null;
        readonly provider_configuration_id: string | null;
        readonly success_url: string | null;
        readonly cancel_url: string | null;
        readonly return_url: string | null;
        readonly requested_expires_at: unknown;
        readonly operation_state: StripeSessionDispatchDecision['state'];
        readonly next_retry_at: unknown;
        readonly intent_state: string | null;
        readonly intent_expires_at: unknown;
      } & Record<string, unknown>
    >(
      `SELECT operation.checkout_intent_id, operation.provider_idempotency_key,
              operation.actor_person_id, operation.canonical_subscription_id,
              intent.plan_version_id, operation.provider_price_id,
              operation.provider_customer_id, operation.provider_configuration_id,
              operation.success_url, operation.cancel_url, operation.return_url,
              operation.requested_expires_at, operation.state AS operation_state,
              operation.next_retry_at, intent.state AS intent_state,
              intent.expires_at AS intent_expires_at
       FROM commerce_stripe_session_operations operation
       LEFT JOIN commerce_checkout_intents intent
         ON intent.household_id = operation.household_id
        AND intent.id = operation.checkout_intent_id
         WHERE operation.household_id = $1 AND operation.environment = $2
          AND operation.action = $3 AND operation.server_operation_id = $4`,
      [input.householdId, input.environment, input.action, input.serverOperationId],
    );
    const row = result.rows[0];
    if (row === undefined) return { kind: 'attention', reason: 'operation_missing' };
    if (row.operation_state !== 'dispatching' && row.operation_state !== 'outcome_unknown') {
      return { kind: 'terminal' };
    }
    if (row.next_retry_at === null || asDate(row.next_retry_at) > input.now) {
      return { kind: 'not_due' };
    }
    if (
      input.action === 'checkout' &&
      (row.intent_state !== 'prepared' ||
        row.intent_expires_at === null ||
        asDate(row.intent_expires_at) <= input.now)
    ) {
      return { kind: 'attention', reason: 'intent_expired' };
    }
    if (row.actor_person_id === null) {
      return { kind: 'attention', reason: 'evidence_incomplete' };
    }
    const authority = await resolveActiveBillingAuthority(
      this.database,
      input.householdId,
      row.actor_person_id,
    );
    if (authority === null) return { kind: 'attention', reason: 'authority_unavailable' };
    const actor: CommerceActor = {
      personId: authority.personId,
      householdId: authority.householdId,
      billingAuthorityId: authority.authorityReference,
      resolvedAt: input.now,
    };
    if (input.action === 'checkout') {
      if (
        row.checkout_intent_id === null ||
        row.canonical_subscription_id === null ||
        row.plan_version_id === null ||
        row.provider_price_id === null ||
        row.success_url === null ||
        row.cancel_url === null ||
        row.requested_expires_at === null
      ) {
        return { kind: 'attention', reason: 'evidence_incomplete' };
      }
      return {
        kind: 'ready',
        context: {
          action: 'checkout',
          householdId: input.householdId,
          checkoutIntentId: row.checkout_intent_id,
          serverOperationId: input.serverOperationId,
          providerIdempotencyKey: row.provider_idempotency_key,
          actor,
          canonicalSubscriptionId: row.canonical_subscription_id,
          planVersionId: row.plan_version_id,
          providerPriceId: row.provider_price_id,
          ...(row.provider_customer_id === null
            ? {}
            : { providerCustomerId: row.provider_customer_id }),
          successUrl: row.success_url,
          cancelUrl: row.cancel_url,
          requestedExpiresAt: asDate(row.requested_expires_at),
        },
      };
    }
    if (
      row.provider_customer_id === null ||
      row.provider_configuration_id === null ||
      row.return_url === null
    ) {
      return { kind: 'attention', reason: 'evidence_incomplete' };
    }
    return {
      kind: 'ready',
      context: {
        action: 'portal',
        householdId: input.householdId,
        serverOperationId: input.serverOperationId,
        providerIdempotencyKey: row.provider_idempotency_key,
        actor,
        providerCustomerId: row.provider_customer_id,
        providerConfigurationId: row.provider_configuration_id,
        returnUrl: row.return_url,
      },
    };
  }

  async holdStripeSessionRetryExhausted(input: {
    readonly householdId: string;
    readonly environment: 'test' | 'production';
    readonly action: 'checkout' | 'portal';
    readonly serverOperationId: string;
    readonly now: Date;
  }): Promise<boolean> {
    const held = await this.database.query(
      `UPDATE commerce_stripe_session_operations
       SET next_retry_at = NULL, lease_expires_at = NULL, updated_at = $5
       WHERE household_id = $1 AND environment = $2 AND action = $3
         AND server_operation_id = $4 AND state = 'outcome_unknown'
         AND attempt_count >= authorized_attempt_limit
         AND provider_session_id IS NULL`,
      [
        input.householdId,
        input.environment,
        input.action,
        input.serverOperationId,
        input.now.toISOString(),
      ],
    );
    return held.rowCount === 1;
  }

  async beginStripeSessionOperation(input: {
    readonly householdId: string;
    readonly checkoutIntentId?: string;
    readonly action: 'checkout' | 'portal';
    readonly environment: 'test' | 'production';
    readonly serverOperationId: string;
    readonly providerIdempotencyKey: string;
    readonly actorPersonId: string;
    readonly requestedExpiresAt?: Date;
    readonly canonicalSubscriptionId?: string;
    readonly providerPriceId?: string;
    readonly providerCustomerId?: string;
    readonly providerConfigurationId?: string;
    readonly successUrl?: string;
    readonly cancelUrl?: string;
    readonly returnUrl?: string;
    readonly allowDueRetry?: boolean;
    readonly now: Date;
  }): Promise<StripeSessionDispatchDecision> {
    return this.database.transaction(async (transaction) => {
      if (input.action === 'checkout' && input.checkoutIntentId === undefined) {
        throw new DomainError('invalid_input', 'Checkout dispatch requires an intent');
      }
      const household = await transaction.query(
        'SELECT id FROM households WHERE id = $1 FOR UPDATE',
        [input.householdId],
      );
      if (household.rowCount !== 1) throw new DomainError('not_found', 'Household not found');
      const existing = await transaction.query<
        {
          readonly id: string;
          readonly checkout_intent_id: string | null;
          readonly provider_idempotency_key: string;
          readonly state: StripeSessionDispatchDecision['state'];
          readonly attempt_count: number;
          readonly authorized_attempt_limit: number;
          readonly provider_session_id: string | null;
          readonly provider_session_url: string | null;
          readonly actor_person_id: string | null;
          readonly returned_expires_at: unknown;
          readonly next_retry_at: unknown;
          readonly canonical_subscription_id: string | null;
          readonly provider_price_id: string | null;
          readonly provider_customer_id: string | null;
          readonly provider_configuration_id: string | null;
          readonly success_url: string | null;
          readonly cancel_url: string | null;
          readonly return_url: string | null;
        } & Record<string, unknown>
      >(
        `SELECT id, checkout_intent_id, provider_idempotency_key, state, attempt_count,
                authorized_attempt_limit,
                provider_session_id, provider_session_url, actor_person_id,
                returned_expires_at, next_retry_at,
                canonical_subscription_id, provider_price_id, provider_customer_id,
                provider_configuration_id, success_url, cancel_url, return_url
         FROM commerce_stripe_session_operations
         WHERE environment = $1 AND action = $2 AND household_id = $3
           AND server_operation_id = $4 FOR UPDATE`,
        [input.environment, input.action, input.householdId, input.serverOperationId],
      );
      const prior = existing.rows[0];
      if (prior === undefined || input.allowDueRetry === true) {
        const authority = await transaction.query(
          `SELECT 1
           FROM household_billing_authorities authority
           JOIN household_memberships membership
             ON membership.household_id = authority.household_id
            AND membership.person_id = authority.person_id
           WHERE authority.household_id = $1 AND authority.person_id = $2
             AND authority.status = 'active' AND membership.status = 'active'
           FOR UPDATE OF authority, membership`,
          [input.householdId, input.actorPersonId],
        );
        if (authority.rowCount !== 1) {
          throw new DomainError(
            'not_authorized',
            'Billing authority closed before durable provider dispatch',
          );
        }
      }
      if (input.action === 'checkout' && (prior === undefined || input.allowDueRetry === true)) {
        const initiation = await transaction.query(
          `SELECT 1
           FROM commerce_stripe_initiation_controls control
           JOIN commerce_stripe_eligible_households eligible
             ON eligible.environment = control.environment AND eligible.household_id = $1
           JOIN commerce_stripe_cohort_policies policy
             ON policy.environment = control.environment
           WHERE control.environment = $2 AND control.state = 'enabled'
             AND policy.cohort_key = eligible.cohort_key
             AND eligible.cohort_key = 'founding_household_v1'
             AND eligible.benefit_key = 'family_v1_monthly_1499'
             AND eligible.state = 'eligible'
             AND eligible.eligibility_expires_at > CURRENT_TIMESTAMP
             AND policy.state = 'active' AND policy.policy_expires_at > CURRENT_TIMESTAMP
             AND policy.benefit_key = eligible.benefit_key
             AND ($2 <> 'production' OR policy.live_approved = true)
           FOR UPDATE OF control, eligible, policy`,
          [input.householdId, input.environment],
        );
        if (initiation.rowCount !== 1) {
          throw new DomainError(
            'not_authorized',
            'Stripe initiation closed before durable provider dispatch',
          );
        }
      }
      if (
        prior !== undefined &&
        (prior.provider_idempotency_key !== input.providerIdempotencyKey ||
          prior.checkout_intent_id !== (input.checkoutIntentId ?? null) ||
          prior.actor_person_id !== input.actorPersonId ||
          (input.canonicalSubscriptionId !== undefined &&
            prior.canonical_subscription_id !== input.canonicalSubscriptionId) ||
          (input.providerPriceId !== undefined &&
            prior.provider_price_id !== input.providerPriceId) ||
          (input.providerCustomerId !== undefined &&
            prior.provider_customer_id !== input.providerCustomerId) ||
          (input.providerConfigurationId !== undefined &&
            prior.provider_configuration_id !== input.providerConfigurationId) ||
          (input.successUrl !== undefined && prior.success_url !== input.successUrl) ||
          (input.cancelUrl !== undefined && prior.cancel_url !== input.cancelUrl) ||
          (input.returnUrl !== undefined && prior.return_url !== input.returnUrl))
      ) {
        throw new DomainError('conflict', 'Stripe operation id has conflicting request evidence');
      }
      const retryDue =
        prior !== undefined &&
        prior.attempt_count < prior.authorized_attempt_limit &&
        prior.next_retry_at !== null &&
        asDate(prior.next_retry_at) <= input.now &&
        input.allowDueRetry === true &&
        (prior.state === 'dispatching' || prior.state === 'outcome_unknown');
      if (prior !== undefined && !retryDue) {
        return {
          shouldDispatch: false,
          operationId: prior.id,
          attempt: prior.attempt_count,
          state: prior.state,
          ...(prior.provider_session_id === null
            ? {}
            : { providerSessionId: prior.provider_session_id }),
          ...(prior.provider_session_url === null
            ? {}
            : { providerSessionUrl: prior.provider_session_url }),
          ...(prior.returned_expires_at === null
            ? {}
            : { returnedExpiresAt: asDate(prior.returned_expires_at) }),
        };
      }
      const operationId = prior?.id ?? this.idFactory.next('stripe-session-operation');
      const attempt = (prior?.attempt_count ?? 0) + 1;
      const leaseExpiresAt = new Date(input.now.getTime() + 2 * 60_000);
      if (prior?.state === 'dispatching') {
        await transaction.query(
          `INSERT INTO commerce_stripe_session_operation_attempts(
             id, operation_id, attempt, event_kind, provider_idempotency_key,
             error_code, occurred_at
           ) VALUES ($1,$2,$3,'lease_expired',$4,'stripe.dispatch_lease_expired',$5)
           ON CONFLICT (operation_id, attempt, event_kind) DO NOTHING`,
          [
            this.idFactory.next('stripe-session-attempt'),
            operationId,
            prior.attempt_count,
            input.providerIdempotencyKey,
            input.now.toISOString(),
          ],
        );
      }
      const claimed = await transaction.query(
        `INSERT INTO commerce_stripe_session_operations(
           id, household_id, checkout_intent_id, action, environment,
           server_operation_id, provider_idempotency_key, state, attempt_count,
           requested_expires_at, created_at, updated_at, lease_expires_at, next_retry_at,
           actor_person_id, canonical_subscription_id, provider_price_id, provider_customer_id,
           provider_configuration_id, success_url, cancel_url, return_url
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'dispatching',1,$8,$9,$9,$10,$10,
                   $11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (environment, action, household_id, server_operation_id)
         DO UPDATE SET state = 'dispatching',
           attempt_count = commerce_stripe_session_operations.attempt_count + 1,
           lease_expires_at = EXCLUDED.lease_expires_at,
           next_retry_at = EXCLUDED.next_retry_at,
           updated_at = EXCLUDED.updated_at,
           last_error_code = NULL
         WHERE commerce_stripe_session_operations.provider_idempotency_key = EXCLUDED.provider_idempotency_key
           AND commerce_stripe_session_operations.checkout_intent_id IS NOT DISTINCT FROM EXCLUDED.checkout_intent_id
           AND $19::boolean
         RETURNING id`,
        [
          operationId,
          input.householdId,
          input.checkoutIntentId ?? null,
          input.action,
          input.environment,
          input.serverOperationId,
          input.providerIdempotencyKey,
          input.requestedExpiresAt?.toISOString() ?? null,
          input.now.toISOString(),
          leaseExpiresAt.toISOString(),
          input.actorPersonId,
          input.canonicalSubscriptionId ?? null,
          input.providerPriceId ?? null,
          input.providerCustomerId ?? null,
          input.providerConfigurationId ?? null,
          input.successUrl ?? null,
          input.cancelUrl ?? null,
          input.returnUrl ?? null,
          prior !== undefined,
        ],
      );
      if (claimed.rowCount !== 1) {
        throw new DomainError('conflict', 'Concurrent Stripe dispatch claim was refused');
      }
      await transaction.query(
        `INSERT INTO commerce_stripe_session_operation_attempts(
           id, operation_id, attempt, event_kind, provider_idempotency_key, occurred_at
         ) VALUES ($1,$2,$3,'dispatch_started',$4,$5)`,
        [
          this.idFactory.next('stripe-session-attempt'),
          operationId,
          attempt,
          input.providerIdempotencyKey,
          input.now.toISOString(),
        ],
      );
      await enqueueDurableJobWithExecutor(transaction, this.idFactory, {
        type: 'commerce.stripe-session-retry',
        version: 1,
        householdId: input.householdId,
        classification: 'internal',
        payload: {
          householdId: input.householdId,
          environment: input.environment,
          action: input.action,
          serverOperationId: input.serverOperationId,
        },
        idempotencyKey: `stripe-session-retry:${input.environment}:${input.action}:${input.serverOperationId}`,
        scheduledAt: leaseExpiresAt,
        maxAttempts: 12,
        correlationId: `stripe-session-retry:${input.serverOperationId}`,
      });
      if (input.checkoutIntentId !== undefined) {
        const updated = await transaction.query(
          `UPDATE commerce_checkout_intents
           SET dispatch_state = CASE WHEN state = 'session_created'
                 THEN dispatch_state ELSE 'dispatching' END,
               dispatch_started_at = COALESCE(dispatch_started_at,$3),
               updated_at = $3
           WHERE household_id = $1 AND id = $2 AND environment = $4
             AND provider_idempotency_key = $5
             AND state IN ('prepared','session_created')
             AND (state = 'prepared' OR dispatch_state = 'session_recorded')`,
          [
            input.householdId,
            input.checkoutIntentId,
            input.now.toISOString(),
            input.environment,
            input.providerIdempotencyKey,
          ],
        );
        if (updated.rowCount !== 1) {
          throw new DomainError('conflict', 'Checkout dispatch intent is unavailable');
        }
      }
      return {
        shouldDispatch: true,
        operationId,
        attempt,
        state: 'dispatching',
      };
    });
  }

  async markStripeSessionOutcomeUnknown(input: {
    readonly householdId: string;
    readonly action: 'checkout' | 'portal';
    readonly environment: 'test' | 'production';
    readonly serverOperationId: string;
    readonly checkoutIntentId?: string;
    readonly errorCode: string;
    readonly now: Date;
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const operation = await transaction.query<
        {
          readonly id: string;
          readonly attempt_count: number;
          readonly provider_idempotency_key: string;
        } & Record<string, unknown>
      >(
        `UPDATE commerce_stripe_session_operations
         SET state = 'outcome_unknown', last_error_code = $5, updated_at = $6,
             lease_expires_at = NULL, next_retry_at = $7
         WHERE environment = $1 AND action = $2 AND household_id = $3
           AND server_operation_id = $4 AND state = 'dispatching'
         RETURNING id, attempt_count, provider_idempotency_key`,
        [
          input.environment,
          input.action,
          input.householdId,
          input.serverOperationId,
          input.errorCode,
          input.now.toISOString(),
          new Date(input.now.getTime() + 30_000).toISOString(),
        ],
      );
      const row = operation.rows[0];
      if (row !== undefined) {
        await transaction.query(
          `INSERT INTO commerce_stripe_session_operation_attempts(
             id, operation_id, attempt, event_kind, provider_idempotency_key,
             error_code, occurred_at
           ) VALUES ($1,$2,$3,'outcome_unknown',$4,$5,$6)
           ON CONFLICT (operation_id, attempt, event_kind) DO NOTHING`,
          [
            this.idFactory.next('stripe-session-attempt'),
            row.id,
            row.attempt_count,
            row.provider_idempotency_key,
            input.errorCode,
            input.now.toISOString(),
          ],
        );
      }
      if (input.checkoutIntentId !== undefined) {
        await transaction.query(
          `UPDATE commerce_checkout_intents
           SET dispatch_state = 'outcome_unknown', dispatch_uncertain_at = $3, updated_at = $3
           WHERE household_id = $1 AND id = $2 AND environment = $4
             AND state = 'prepared'`,
          [input.householdId, input.checkoutIntentId, input.now.toISOString(), input.environment],
        );
      }
    });
  }

  async markStripeSessionFailedNoEffect(input: {
    readonly householdId: string;
    readonly action: 'checkout' | 'portal';
    readonly environment: 'test' | 'production';
    readonly serverOperationId: string;
    readonly checkoutIntentId?: string;
    readonly errorCode: string;
    readonly now: Date;
  }): Promise<'terminalized' | 'ambiguity_preserved'> {
    if (!/^[a-z][a-z0-9_.-]{2,119}$/u.test(input.errorCode)) {
      throw new DomainError('invalid_input', 'Invalid Stripe no-effect error code');
    }
    return this.database.transaction(async (transaction) => {
      const locked = await transaction.query<
        {
          readonly id: string;
          readonly checkout_intent_id: string | null;
          readonly attempt_count: number;
          readonly provider_idempotency_key: string;
          readonly last_error_code: string | null;
          readonly state: StripeSessionDispatchDecision['state'];
          readonly has_prior_dispatch_evidence: boolean;
        } & Record<string, unknown>
      >(
        `SELECT operation.id, operation.checkout_intent_id, operation.attempt_count,
                operation.provider_idempotency_key, operation.last_error_code, operation.state,
                EXISTS (
                  SELECT 1 FROM commerce_stripe_session_operation_attempts attempt
                  WHERE attempt.operation_id = operation.id
                    AND attempt.event_kind IN ('dispatch_started','lease_expired','outcome_unknown')
                    AND attempt.attempt < operation.attempt_count
                ) AS has_prior_dispatch_evidence
         FROM commerce_stripe_session_operations operation
         WHERE operation.environment = $1 AND operation.action = $2
           AND operation.household_id = $3 AND operation.server_operation_id = $4
           AND operation.provider_session_id IS NULL
         FOR UPDATE`,
        [input.environment, input.action, input.householdId, input.serverOperationId],
      );
      const operation = locked.rows[0];
      if (operation === undefined) {
        throw new DomainError('conflict', 'Stripe no-effect transition is unavailable');
      }
      if (operation.state === 'failed_no_effect') {
        if (operation.last_error_code !== input.errorCode) {
          throw new DomainError(
            'conflict',
            'Stripe no-effect evidence conflicts with terminal state',
          );
        }
        return 'terminalized';
      }
      if (operation.state !== 'dispatching') {
        throw new DomainError('conflict', 'Stripe no-effect transition is unavailable');
      }
      if (operation.checkout_intent_id !== (input.checkoutIntentId ?? null)) {
        throw new DomainError('conflict', 'Stripe no-effect intent linkage is invalid');
      }
      const preserveAmbiguity = operation.has_prior_dispatch_evidence;
      const transitioned = await transaction.query(
        `UPDATE commerce_stripe_session_operations
         SET state = $5, last_error_code = $6, lease_expires_at = NULL,
             next_retry_at = NULL,
             terminal_at = CASE WHEN $5::text = 'failed_no_effect'
               THEN $7::timestamptz ELSE NULL::timestamptz END,
             updated_at = $7
         WHERE environment = $1 AND action = $2 AND household_id = $3
           AND server_operation_id = $4 AND state = 'dispatching'
           AND provider_session_id IS NULL`,
        [
          input.environment,
          input.action,
          input.householdId,
          input.serverOperationId,
          preserveAmbiguity ? 'outcome_unknown' : 'failed_no_effect',
          input.errorCode,
          input.now.toISOString(),
        ],
      );
      if (transitioned.rowCount !== 1) {
        throw new DomainError('conflict', 'Concurrent Stripe no-effect transition was refused');
      }
      await transaction.query(
        `INSERT INTO commerce_stripe_session_operation_attempts(
           id, operation_id, attempt, event_kind, provider_idempotency_key,
           error_code, occurred_at
         ) VALUES ($1,$2,$3,'failed_no_effect',$4,$5,$6)
         ON CONFLICT (operation_id, attempt, event_kind) DO NOTHING`,
        [
          this.idFactory.next('stripe-session-attempt'),
          operation.id,
          operation.attempt_count,
          operation.provider_idempotency_key,
          input.errorCode,
          input.now.toISOString(),
        ],
      );
      if (input.checkoutIntentId !== undefined && !preserveAmbiguity) {
        const intent = await transaction.query<
          { readonly subscription_id: string } & Record<string, unknown>
        >(
          `UPDATE commerce_checkout_intents
           SET state = 'expired', dispatch_state = 'failed_no_effect', updated_at = $3
           WHERE household_id = $1 AND id = $2 AND environment = $4
             AND state IN ('prepared','expired') AND provider_session_id IS NULL
             AND server_operation_id = $5
           RETURNING subscription_id`,
          [
            input.householdId,
            input.checkoutIntentId,
            input.now.toISOString(),
            input.environment,
            input.serverOperationId,
          ],
        );
        const subscriptionId = intent.rows[0]?.subscription_id;
        if (subscriptionId === undefined) {
          throw new DomainError('conflict', 'Stripe no-effect checkout intent is unavailable');
        }
        await transaction.query(
          `UPDATE commerce_subscriptions
           SET lifecycle = 'expired', reconciliation_state = 'not_required', updated_at = $3
           WHERE household_id = $1 AND id = $2 AND source = 'web'
             AND lifecycle IN ('pending','expired')`,
          [input.householdId, subscriptionId, input.now.toISOString()],
        );
      } else if (input.checkoutIntentId !== undefined) {
        await transaction.query(
          `UPDATE commerce_checkout_intents
           SET dispatch_state = 'outcome_unknown', updated_at = $3
           WHERE household_id = $1 AND id = $2 AND environment = $4
             AND state = 'prepared' AND provider_session_id IS NULL
             AND server_operation_id = $5`,
          [
            input.householdId,
            input.checkoutIntentId,
            input.now.toISOString(),
            input.environment,
            input.serverOperationId,
          ],
        );
      }
      return preserveAmbiguity ? 'ambiguity_preserved' : 'terminalized';
    });
  }

  async recordStripePortalSession(input: {
    readonly householdId: string;
    readonly environment: 'test' | 'production';
    readonly serverOperationId: string;
    readonly providerIdempotencyKey: string;
    readonly providerSessionId: string;
    readonly providerSessionUrl?: string;
    readonly now: Date;
  }): Promise<void> {
    if (!/^bps_[A-Za-z0-9_]+$/u.test(input.providerSessionId)) {
      throw new DomainError('invalid_input', 'Stripe portal session identifier is invalid');
    }
    await this.database.transaction(async (transaction) => {
      const result = await transaction.query<
        {
          readonly id: string;
          readonly attempt_count: number;
          readonly provider_idempotency_key: string;
        } & Record<string, unknown>
      >(
        `UPDATE commerce_stripe_session_operations
         SET state = 'succeeded', provider_session_id = $5, provider_session_url = $7,
             updated_at = $6, lease_expires_at = NULL, next_retry_at = NULL, terminal_at = $6
         WHERE environment = $1 AND action = 'portal' AND household_id = $2
           AND server_operation_id = $3 AND provider_idempotency_key = $4
           AND state IN ('dispatching','outcome_unknown','succeeded')
           AND (provider_session_id IS NULL OR provider_session_id = $5)
         RETURNING id, attempt_count, provider_idempotency_key`,
        [
          input.environment,
          input.householdId,
          input.serverOperationId,
          input.providerIdempotencyKey,
          input.providerSessionId,
          input.now.toISOString(),
          input.providerSessionUrl ?? null,
        ],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new DomainError('conflict', 'Stripe portal operation linkage is invalid');
      }
      await transaction.query(
        `INSERT INTO commerce_stripe_session_operation_attempts(
           id, operation_id, attempt, event_kind, provider_idempotency_key,
           provider_session_id, occurred_at
         ) VALUES ($1,$2,$3,'succeeded',$4,$5,$6)
         ON CONFLICT (operation_id, attempt, event_kind) DO NOTHING`,
        [
          this.idFactory.next('stripe-session-attempt'),
          row.id,
          row.attempt_count,
          row.provider_idempotency_key,
          input.providerSessionId,
          input.now.toISOString(),
        ],
      );
    });
  }

  async expireStripeCheckoutSession(input: {
    readonly providerSessionId: string;
    readonly environment?: 'test' | 'production';
    readonly canonicalBinding: {
      readonly householdId: string;
      readonly subscriptionId: string;
      readonly planVersionId: string;
    };
    readonly providerExpiresAt: Date;
    readonly providerEventCreatedAt: Date;
    readonly now: Date;
  }): Promise<boolean> {
    const environment = input.environment ?? 'test';
    if (
      !Number.isFinite(input.providerExpiresAt.getTime()) ||
      !Number.isFinite(input.providerEventCreatedAt.getTime()) ||
      input.providerEventCreatedAt < input.providerExpiresAt ||
      input.providerEventCreatedAt.getTime() > input.now.getTime() + 5 * 60_000
    ) {
      return false;
    }
    return this.database.transaction(async (transaction) => {
      const expired = await transaction.query<
        { readonly household_id: string; readonly subscription_id: string } & Record<
          string,
          unknown
        >
      >(
        `UPDATE commerce_checkout_intents
         SET state = 'expired', updated_at = $3
         WHERE provider = 'stripe' AND environment = $4 AND provider_session_id = $1
           AND household_id = $5 AND subscription_id = $6 AND plan_version_id = $7
           AND state = 'session_created' AND created_at <= $2
           AND COALESCE(provider_returned_expires_at, provider_requested_expires_at) = $8
         RETURNING household_id, subscription_id`,
        [
          input.providerSessionId,
          input.providerEventCreatedAt.toISOString(),
          input.now.toISOString(),
          environment,
          input.canonicalBinding.householdId,
          input.canonicalBinding.subscriptionId,
          input.canonicalBinding.planVersionId,
          input.providerExpiresAt.toISOString(),
        ],
      );
      const intent = expired.rows[0];
      let resolvedIntent = intent;
      if (resolvedIntent === undefined) {
        const repaired = await transaction.query<
          { readonly household_id: string; readonly subscription_id: string } & Record<
            string,
            unknown
          >
        >(
          `UPDATE commerce_checkout_intents intent
           SET state = 'expired', provider_session_id = $1,
               dispatch_state = 'session_recorded', updated_at = $3
           WHERE intent.provider = 'stripe' AND intent.environment = $4
             AND intent.household_id = $5 AND intent.subscription_id = $6
             AND intent.plan_version_id = $7 AND intent.state = 'prepared'
             AND intent.provider_session_id IS NULL
             AND intent.dispatch_state IN ('dispatching','outcome_unknown')
             AND intent.created_at <= $2 AND intent.provider_requested_expires_at = $8
           RETURNING household_id, subscription_id`,
          [
            input.providerSessionId,
            input.providerEventCreatedAt.toISOString(),
            input.now.toISOString(),
            environment,
            input.canonicalBinding.householdId,
            input.canonicalBinding.subscriptionId,
            input.canonicalBinding.planVersionId,
            input.providerExpiresAt.toISOString(),
          ],
        );
        resolvedIntent = repaired.rows[0];
      }
      if (resolvedIntent === undefined) {
        const alreadyExpired = await transaction.query<
          { readonly household_id: string; readonly subscription_id: string } & Record<
            string,
            unknown
          >
        >(
          `SELECT intent.household_id, intent.subscription_id
           FROM commerce_checkout_intents intent
           JOIN commerce_stripe_session_operations operation
             ON operation.checkout_intent_id = intent.id
            AND operation.household_id = intent.household_id
            AND operation.environment = intent.environment
            AND operation.action = 'checkout'
           WHERE intent.provider = 'stripe' AND intent.environment = $2
             AND intent.provider_session_id = $1
             AND intent.household_id = $3 AND intent.subscription_id = $4
             AND intent.plan_version_id = $5 AND intent.state = 'expired'
             AND intent.created_at <= $6
             AND COALESCE(intent.provider_returned_expires_at,
                          intent.provider_requested_expires_at) = $7
             AND operation.provider_session_id = $1
             AND (
               operation.state = 'succeeded'
               OR (
                 operation.state = 'failed_no_effect'
                 AND operation.last_error_code = 'stripe.checkout_session_authentically_expired'
               )
             )`,
          [
            input.providerSessionId,
            environment,
            input.canonicalBinding.householdId,
            input.canonicalBinding.subscriptionId,
            input.canonicalBinding.planVersionId,
            input.providerEventCreatedAt.toISOString(),
            input.providerExpiresAt.toISOString(),
          ],
        );
        if (alreadyExpired.rowCount !== 1) return false;
        resolvedIntent = alreadyExpired.rows[0];
      }
      if (resolvedIntent === undefined) return false;
      const terminalized = await transaction.query<
        {
          readonly id: string;
          readonly attempt_count: number;
          readonly provider_idempotency_key: string;
        } & Record<string, unknown>
      >(
        `UPDATE commerce_stripe_session_operations operation
         SET state = 'failed_no_effect', provider_session_id = $1,
             lease_expires_at = NULL, next_retry_at = NULL,
             last_error_code = 'stripe.checkout_session_authentically_expired',
             terminal_at = $2, updated_at = $2
         FROM commerce_checkout_intents checkout
         WHERE checkout.household_id = $3 AND checkout.subscription_id = $4
           AND checkout.environment = $5 AND checkout.provider_session_id = $1
           AND operation.checkout_intent_id = checkout.id
           AND operation.state IN ('dispatching','outcome_unknown')
         RETURNING operation.id, operation.attempt_count, operation.provider_idempotency_key`,
        [
          input.providerSessionId,
          input.now.toISOString(),
          resolvedIntent.household_id,
          resolvedIntent.subscription_id,
          environment,
        ],
      );
      for (const operation of terminalized.rows) {
        await transaction.query(
          `INSERT INTO commerce_stripe_session_operation_attempts(
             id, operation_id, attempt, event_kind, provider_idempotency_key,
             provider_session_id, error_code, occurred_at
           ) VALUES ($1,$2,$3,'failed_no_effect',$4,$5,
                     'stripe.checkout_session_authentically_expired',$6)
           ON CONFLICT (operation_id, attempt, event_kind) DO NOTHING`,
          [
            this.idFactory.next('stripe-session-attempt'),
            operation.id,
            operation.attempt_count,
            operation.provider_idempotency_key,
            input.providerSessionId,
            input.now.toISOString(),
          ],
        );
      }
      await transaction.query(
        `UPDATE commerce_subscriptions
         SET lifecycle = 'expired', reconciliation_state = 'not_required', updated_at = $3
         WHERE household_id = $1 AND id = $2 AND source = 'web' AND lifecycle = 'pending'`,
        [resolvedIntent.household_id, resolvedIntent.subscription_id, input.now.toISOString()],
      );
      return true;
    });
  }

  async recordStripeCheckoutCompletion(input: {
    readonly inboxId: string;
    readonly externalEventId: string;
    readonly environment: 'test' | 'production';
    readonly providerSessionId: string;
    readonly providerSubscriptionId: string;
    readonly providerCustomerId: string;
    readonly providerPaymentIntentId?: string;
    readonly canonicalBinding: {
      readonly householdId: string;
      readonly subscriptionId: string;
      readonly planVersionId: string;
    };
    readonly amountTotal: 1499;
    readonly currency: 'usd';
    readonly providerExpiresAt: Date;
    readonly providerEventCreatedAt: Date;
    readonly now: Date;
  }): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      // An authentic completion may be the first response observed after the POST result was
      // lost. Bind it only to the single exact server-authored intent and immutable expiry.
      await transaction.query(
        `UPDATE commerce_checkout_intents intent
         SET state = 'session_created', provider_session_id = $1,
             provider_returned_expires_at = $2, dispatch_state = 'session_recorded',
             updated_at = $8
         WHERE intent.provider = 'stripe' AND intent.environment = $3
           AND intent.household_id = $4 AND intent.subscription_id = $5
           AND intent.plan_version_id = $6 AND intent.state = 'prepared'
           AND intent.provider_session_id IS NULL
           AND intent.dispatch_state IN ('dispatching','outcome_unknown')
           AND intent.created_at <= $7 AND $7 <= intent.provider_requested_expires_at
           AND $2 <= intent.provider_requested_expires_at
           AND EXISTS (
             SELECT 1 FROM commerce_stripe_session_operations operation
             WHERE operation.checkout_intent_id = intent.id
               AND operation.household_id = intent.household_id
               AND operation.environment = intent.environment
               AND operation.action = 'checkout'
                AND operation.state IN ('dispatching','outcome_unknown')
            )`,
        [
          input.providerSessionId,
          input.providerExpiresAt.toISOString(),
          input.environment,
          input.canonicalBinding.householdId,
          input.canonicalBinding.subscriptionId,
          input.canonicalBinding.planVersionId,
          input.providerEventCreatedAt.toISOString(),
          input.now.toISOString(),
        ],
      );
      const repaired = await transaction.query<
        {
          readonly id: string;
          readonly attempt_count: number;
          readonly provider_idempotency_key: string;
        } & Record<string, unknown>
      >(
        `UPDATE commerce_stripe_session_operations operation
         SET state = 'succeeded', provider_session_id = $1, returned_expires_at = $2,
             lease_expires_at = NULL, next_retry_at = NULL, terminal_at = $3, updated_at = $3
         FROM commerce_checkout_intents intent
         WHERE intent.household_id = $4 AND intent.subscription_id = $5
           AND intent.environment = $6 AND intent.provider_session_id = $1
           AND operation.checkout_intent_id = intent.id
           AND operation.household_id = intent.household_id
           AND operation.environment = intent.environment
           AND operation.action = 'checkout'
           AND operation.state IN ('dispatching','outcome_unknown')
         RETURNING operation.id, operation.attempt_count, operation.provider_idempotency_key`,
        [
          input.providerSessionId,
          input.providerExpiresAt.toISOString(),
          input.now.toISOString(),
          input.canonicalBinding.householdId,
          input.canonicalBinding.subscriptionId,
          input.environment,
        ],
      );
      for (const operation of repaired.rows) {
        await transaction.query(
          `INSERT INTO commerce_stripe_session_operation_attempts(
             id, operation_id, attempt, event_kind, provider_idempotency_key,
             provider_session_id, occurred_at
           ) VALUES ($1,$2,$3,'succeeded',$4,$5,$6)
           ON CONFLICT (operation_id, attempt, event_kind) DO NOTHING`,
          [
            this.idFactory.next('stripe-session-attempt'),
            operation.id,
            operation.attempt_count,
            operation.provider_idempotency_key,
            input.providerSessionId,
            input.now.toISOString(),
          ],
        );
      }
      const inserted = await transaction.query(
        `INSERT INTO commerce_stripe_checkout_completions(
           provider_session_id, environment, household_id, checkout_intent_id,
           subscription_id, provider_subscription_id, provider_customer_id,
           provider_payment_intent_id, source_inbox_id, provider_event_id,
           payment_status, session_status, amount_total, currency,
           completed_at, provider_expires_at
         )
         SELECT intent.provider_session_id, intent.environment, intent.household_id, intent.id,
                intent.subscription_id, $4, $5, $6, $1, $2,
                'paid', 'complete', $7, $8, $9, $10
         FROM commerce_checkout_intents intent
         JOIN commerce_event_inbox inbox
           ON inbox.id = $1 AND inbox.external_event_id = $2
          AND inbox.event_type IN (
            'checkout.session.completed',
            'checkout.session.async_payment_succeeded'
          )
          AND inbox.provider = 'stripe' AND inbox.environment = $3
          AND inbox.provider_object_id = $11 AND inbox.authenticity = 'verified'
         WHERE intent.provider = 'stripe' AND intent.environment = $3
           AND intent.provider_session_id = $11 AND intent.state = 'session_created'
           AND intent.household_id = $12 AND intent.subscription_id = $13
           AND intent.plan_version_id = $14
           AND intent.provider_returned_expires_at = $10
           AND $9 <= intent.provider_returned_expires_at
         ON CONFLICT (provider_session_id) DO NOTHING`,
        [
          input.inboxId,
          input.externalEventId,
          input.environment,
          input.providerSubscriptionId,
          input.providerCustomerId,
          input.providerPaymentIntentId ?? null,
          input.amountTotal,
          input.currency,
          input.providerEventCreatedAt.toISOString(),
          input.providerExpiresAt.toISOString(),
          input.providerSessionId,
          input.canonicalBinding.householdId,
          input.canonicalBinding.subscriptionId,
          input.canonicalBinding.planVersionId,
        ],
      );
      const completion = await transaction.query<
        {
          readonly environment: string;
          readonly household_id: string;
          readonly subscription_id: string;
          readonly provider_subscription_id: string;
          readonly provider_customer_id: string;
          readonly source_inbox_id: string;
        } & Record<string, unknown>
      >(
        `SELECT environment, household_id, subscription_id, provider_subscription_id,
                provider_customer_id, source_inbox_id
         FROM commerce_stripe_checkout_completions
         WHERE provider_session_id = $1`,
        [input.providerSessionId],
      );
      const row = completion.rows[0];
      if (
        row === undefined ||
        row.environment !== input.environment ||
        row.household_id !== input.canonicalBinding.householdId ||
        row.subscription_id !== input.canonicalBinding.subscriptionId ||
        row.provider_subscription_id !== input.providerSubscriptionId ||
        row.provider_customer_id !== input.providerCustomerId ||
        row.source_inbox_id !== input.inboxId
      ) {
        throw new DomainError('conflict', 'Checkout completion does not match the server intent');
      }
      await transaction.query(
        `INSERT INTO commerce_provider_customers(
           provider, environment, provider_customer_id, household_id, verified_at
         ) VALUES ('stripe',$1,$2,$3,$4)
         ON CONFLICT (provider, environment, provider_customer_id) DO NOTHING`,
        [
          input.environment,
          input.providerCustomerId,
          input.canonicalBinding.householdId,
          input.now.toISOString(),
        ],
      );
      const customer = await transaction.query<
        { readonly household_id: string } & Record<string, unknown>
      >(
        `SELECT household_id FROM commerce_provider_customers
         WHERE provider = 'stripe' AND environment = $1 AND provider_customer_id = $2`,
        [input.environment, input.providerCustomerId],
      );
      if (customer.rows[0]?.household_id !== input.canonicalBinding.householdId) {
        throw new DomainError('conflict', 'Stripe customer belongs to another household');
      }
      const waiting = await transaction.query<
        {
          readonly reconciliation_run_id: string;
          readonly trigger_event_id: string;
          readonly original_job_id: string;
          readonly household_id: string | null;
          readonly payload: unknown;
        } & Record<string, unknown>
      >(
        `SELECT run.id AS reconciliation_run_id, run.trigger_event_id,
                original_job.id AS original_job_id, original_job.household_id,
                original_job.payload
         FROM commerce_reconciliation_runs run
         JOIN commerce_event_inbox source ON source.id = run.trigger_event_id
         JOIN durable_jobs original_job
           ON original_job.job_type = 'commerce.reconcile'
          AND original_job.idempotency_key =
              ('stripe-reconcile:' || run.environment || ':' || run.trigger_event_id)
         WHERE run.provider = 'stripe' AND run.environment = $1
           AND run.state = 'attention'
           AND run.failure_code = 'stripe.checkout_binding_pending'
           AND source.application_state = 'pending'
           AND original_job.payload->>'externalSubscriptionId' = $2
         FOR UPDATE OF run, source, original_job`,
        [input.environment, input.providerSubscriptionId],
      );
      for (const dependency of waiting.rows) {
        const originalPayload = durableJobPayload(dependency.payload);
        if (
          originalPayload.inboxId !== dependency.trigger_event_id ||
          originalPayload.reconciliationRunId !== dependency.reconciliation_run_id ||
          originalPayload.environment !== input.environment ||
          originalPayload.externalSubscriptionId !== input.providerSubscriptionId ||
          originalPayload.repairGeneration !== 0 ||
          (originalPayload.householdId ?? null) !== dependency.household_id
        ) {
          throw new DomainError('conflict', 'Waiting Stripe reconciliation lineage is invalid');
        }
        const wakeKey =
          `stripe-reconcile-checkout-wake:${input.environment}:` +
          `${dependency.trigger_event_id}:${input.providerSessionId}`;
        const wake = await enqueueDurableJobWithExecutor(transaction, this.idFactory, {
          type: 'commerce.reconcile',
          version: 1,
          ...(dependency.household_id === null ? {} : { householdId: dependency.household_id }),
          classification: 'internal',
          payload: { ...originalPayload, repairGeneration: 0 },
          idempotencyKey: wakeKey,
          scheduledAt: input.now,
          maxAttempts: 4,
          correlationId: `stripe-reconcile-checkout-wake:${dependency.trigger_event_id}`,
          causationId: dependency.original_job_id,
        });
        const awakened = await transaction.query(
          `UPDATE commerce_reconciliation_runs
           SET state = 'queued', failure_code = NULL, completed_at = NULL,
               last_attempted_at = $2
           WHERE id = $1 AND provider = 'stripe' AND environment = $3
             AND state = 'attention'
             AND failure_code = 'stripe.checkout_binding_pending'`,
          [dependency.reconciliation_run_id, input.now.toISOString(), input.environment],
        );
        if (awakened.rowCount !== 1) {
          throw new DomainError('conflict', 'Waiting Stripe reconciliation changed');
        }
        await transaction.query(
          `INSERT INTO commerce_stripe_checkout_dependency_wakes(
             id, reconciliation_run_id, trigger_event_id, provider_session_id,
             wake_job_id, occurred_at
           ) VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            this.idFactory.next('stripe-checkout-dependency-wake'),
            dependency.reconciliation_run_id,
            dependency.trigger_event_id,
            input.providerSessionId,
            wake.job.id,
            input.now.toISOString(),
          ],
        );
      }
      return inserted.rowCount === 1;
    });
  }

  async recordStripeFailedInvoiceEvidence(input: {
    readonly environment: 'test' | 'production';
    readonly householdId: string;
    readonly subscriptionId: string;
    readonly sourceInboxId: string;
    readonly evidence: ProviderFailedPaymentEvidence;
    readonly occurredAt: Date;
  }): Promise<void> {
    const inbox = await this.database.query<
      {
        readonly payload_hmac: string;
        readonly event_type: string;
        readonly provider_object_id: string;
        readonly application_state: string;
      } & Record<string, unknown>
    >(
      `SELECT payload_hmac, event_type, provider_object_id, application_state
       FROM commerce_event_inbox
       WHERE id = $1 AND provider = 'stripe' AND environment = $2
         AND authenticity = 'verified'`,
      [input.sourceInboxId, input.environment],
    );
    const binding = await this.database.query(
      `SELECT 1
       FROM commerce_stripe_checkout_completions
       WHERE environment = $1 AND household_id = $2 AND subscription_id = $3
         AND provider_subscription_id = $4
       UNION ALL
       SELECT 1
       FROM commerce_provider_subscription_records
       WHERE provider = 'stripe' AND environment = $1 AND household_id = $2
         AND subscription_id = $3 AND external_subscription_id = $4
       LIMIT 1`,
      [
        input.environment,
        input.householdId,
        input.subscriptionId,
        input.evidence.externalSubscriptionId,
      ],
    );
    if (
      inbox.rows[0]?.event_type !== 'invoice.payment_failed' ||
      inbox.rows[0]?.provider_object_id !== input.evidence.providerInvoiceId ||
      inbox.rows[0]?.application_state === 'quarantined' ||
      binding.rowCount !== 1
    ) {
      throw new DomainError('conflict', 'Failed invoice evidence source is invalid');
    }
    await this.database.query(
      `INSERT INTO commerce_stripe_failed_invoice_evidence(
         provider_invoice_id, environment, household_id, subscription_id,
         provider_subscription_id, provider_subscription_item_id, source_inbox_id,
         provider_payment_intent_id, billing_reason, amount_due, currency, quantity,
         attempt_count, failure_status, occurred_at, evidence_digest,
         provider_invoice_line_id, provider_product_id, provider_price_id,
         line_proration, period_starts_at, period_ends_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                 $17,$18,$19,$20,$21,$22)
       ON CONFLICT (provider_invoice_id) DO NOTHING`,
      [
        input.evidence.providerInvoiceId,
        input.environment,
        input.householdId,
        input.subscriptionId,
        input.evidence.externalSubscriptionId,
        input.evidence.providerSubscriptionItemId,
        input.sourceInboxId,
        input.evidence.providerPaymentIntentId ?? null,
        input.evidence.billingReason,
        input.evidence.amountDue,
        input.evidence.currency,
        input.evidence.quantity,
        input.evidence.attemptCount,
        input.evidence.failureStatus,
        input.occurredAt.toISOString(),
        inbox.rows[0]?.payload_hmac,
        input.evidence.providerInvoiceLineId,
        input.evidence.providerProductId,
        input.evidence.providerPriceId,
        input.evidence.lineProration,
        input.evidence.currentPeriodStartsAt.toISOString(),
        input.evidence.currentPeriodEndsAt.toISOString(),
      ],
    );
  }

  async recordStripeFinancialRestrictionEvent(input: {
    readonly environment: 'test' | 'production';
    readonly householdId: string;
    readonly subscriptionId: string;
    readonly sourceInboxId: string;
    readonly evidence: readonly ProviderFinancialRestrictionEvidence[];
    readonly observedAt: Date;
  }): Promise<'disputed' | 'refunded' | null> {
    if (input.evidence.length === 0) {
      throw new DomainError('invalid_input', 'Stripe financial restriction evidence is empty');
    }
    return this.database.transaction(async (transaction) => {
      const inbox = await transaction.query<
        {
          readonly event_type: string;
          readonly provider_object_id: string;
          readonly payload_hmac: string;
          readonly provider_event_created_at: unknown;
          readonly application_state: string;
        } & Record<string, unknown>
      >(
        `SELECT event_type, provider_object_id, payload_hmac, provider_event_created_at,
                application_state
         FROM commerce_event_inbox
         WHERE id = $1 AND provider = 'stripe' AND environment = $2
           AND authenticity = 'verified' FOR UPDATE`,
        [input.sourceInboxId, input.environment],
      );
      const source = inbox.rows[0];
      const providerEventCreatedAt = new Date(String(source?.provider_event_created_at));
      if (
        source === undefined ||
        source.application_state === 'quarantined' ||
        !Number.isFinite(providerEventCreatedAt.getTime())
      ) {
        throw new DomainError('conflict', 'Stripe financial restriction lineage is invalid');
      }
      const seenRestrictionIds = new Set<string>();
      for (const evidence of input.evidence) {
        const expectedEvent =
          evidence.kind === 'dispute'
            ? source.event_type === 'charge.dispute.created' ||
              source.event_type === 'charge.dispute.closed'
            : source.event_type === 'charge.refunded' || source.event_type.startsWith('refund.');
        const objectMatches =
          source.event_type === 'charge.refunded'
            ? source.provider_object_id === evidence.providerChargeId
            : source.provider_object_id === evidence.providerRestrictionId;
        if (
          !expectedEvent ||
          !objectMatches ||
          seenRestrictionIds.has(evidence.providerRestrictionId) ||
          evidence.providerChargeAmount !== 1499 ||
          !Number.isSafeInteger(evidence.restrictionAmount) ||
          evidence.restrictionAmount < 1 ||
          evidence.restrictionAmount > evidence.providerChargeAmount ||
          evidence.currency !== 'usd'
        ) {
          throw new DomainError('conflict', 'Stripe financial restriction lineage is invalid');
        }
        seenRestrictionIds.add(evidence.providerRestrictionId);
        const paidLineage = await transaction.query(
          `SELECT 1 FROM commerce_stripe_paid_invoice_evidence paid
           WHERE paid.environment = $1 AND paid.household_id = $2
             AND paid.subscription_id = $3 AND paid.provider_subscription_id = $4
             AND paid.provider_invoice_id = $5 AND paid.provider_payment_intent_id = $6
           LIMIT 1 FOR UPDATE`,
          [
            input.environment,
            input.householdId,
            input.subscriptionId,
            evidence.externalSubscriptionId,
            evidence.providerInvoiceId,
            evidence.providerPaymentIntentId,
          ],
        );
        if (paidLineage.rowCount !== 1) {
          throw new DomainError(
            'conflict',
            'Stripe restriction is not bound to exact paid invoice evidence',
          );
        }
        if (evidence.eventState === 'cleared') {
          const opened = await transaction.query(
            `SELECT 1 FROM commerce_stripe_financial_restriction_events
             WHERE environment = $1 AND household_id = $2 AND subscription_id = $3
               AND restriction_kind = $4 AND provider_restriction_id = $5
               AND provider_charge_id = $6 AND provider_payment_intent_id = $7
               AND provider_invoice_id = $8 AND event_state = 'opened'
               AND provider_charge_amount IS NOT DISTINCT FROM $9
               AND restriction_amount IS NOT DISTINCT FROM $10
               AND currency IS NOT DISTINCT FROM $11
             LIMIT 1 FOR UPDATE`,
            [
              input.environment,
              input.householdId,
              input.subscriptionId,
              evidence.kind,
              evidence.providerRestrictionId,
              evidence.providerChargeId,
              evidence.providerPaymentIntentId,
              evidence.providerInvoiceId,
              evidence.providerChargeAmount,
              evidence.restrictionAmount,
              evidence.currency,
            ],
          );
          if (opened.rowCount !== 1) {
            throw new DomainError('conflict', 'Only the exact opened restriction can be closed');
          }
        }
        const inserted = await transaction.query(
          `INSERT INTO commerce_stripe_financial_restriction_events(
             id, environment, household_id, subscription_id, provider_subscription_id,
             restriction_kind, provider_restriction_id, provider_charge_id,
             provider_payment_intent_id, provider_invoice_id,
             provider_charge_amount, restriction_amount, currency,
             event_state, resolution, source_inbox_id, evidence_digest, observed_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           ON CONFLICT (source_inbox_id, provider_restriction_id) DO NOTHING`,
          [
            this.idFactory.next('stripe-restriction-event'),
            input.environment,
            input.householdId,
            input.subscriptionId,
            evidence.externalSubscriptionId,
            evidence.kind,
            evidence.providerRestrictionId,
            evidence.providerChargeId,
            evidence.providerPaymentIntentId,
            evidence.providerInvoiceId,
            evidence.providerChargeAmount,
            evidence.restrictionAmount,
            evidence.currency,
            evidence.eventState,
            evidence.resolution ?? null,
            input.sourceInboxId,
            source.payload_hmac,
            providerEventCreatedAt.toISOString(),
          ],
        );
        if (inserted.rowCount === 0) {
          const exactReplay = await transaction.query(
            `SELECT 1 FROM commerce_stripe_financial_restriction_events
             WHERE source_inbox_id = $1 AND provider_restriction_id = $2
               AND environment = $3 AND household_id = $4 AND subscription_id = $5
               AND provider_subscription_id = $6 AND restriction_kind = $7
               AND provider_charge_id = $8 AND provider_payment_intent_id = $9
               AND provider_invoice_id = $10 AND provider_charge_amount = $11
               AND restriction_amount = $12 AND currency = $13
               AND event_state = $14 AND resolution IS NOT DISTINCT FROM $15
               AND evidence_digest = $16 AND observed_at = $17`,
            [
              input.sourceInboxId,
              evidence.providerRestrictionId,
              input.environment,
              input.householdId,
              input.subscriptionId,
              evidence.externalSubscriptionId,
              evidence.kind,
              evidence.providerChargeId,
              evidence.providerPaymentIntentId,
              evidence.providerInvoiceId,
              evidence.providerChargeAmount,
              evidence.restrictionAmount,
              evidence.currency,
              evidence.eventState,
              evidence.resolution ?? null,
              source.payload_hmac,
              providerEventCreatedAt.toISOString(),
            ],
          );
          if (exactReplay.rowCount !== 1) {
            throw new DomainError('conflict', 'Stripe restriction replay conflicts with evidence');
          }
        }
      }
      const aggregate = await transaction.query<
        { readonly restriction_kind: 'refund' | 'dispute' } & Record<string, unknown>
      >(
        `WITH latest AS (
           SELECT DISTINCT ON (restriction_kind, provider_restriction_id)
                  restriction_kind, provider_restriction_id, provider_charge_id,
                  provider_charge_amount, restriction_amount, event_state
           FROM commerce_stripe_financial_restriction_events
           WHERE environment = $1 AND household_id = $2 AND subscription_id = $3
           ORDER BY restriction_kind, provider_restriction_id, observed_at DESC,
                    CASE event_state WHEN 'retained' THEN 3 WHEN 'cleared' THEN 2 ELSE 1 END DESC,
                    id DESC
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
      );
      const effective =
        aggregate.rows[0]?.restriction_kind === 'dispute'
          ? ('disputed' as const)
          : aggregate.rows[0]?.restriction_kind === 'refund'
            ? ('refunded' as const)
            : null;
      await transaction.query(
        `UPDATE commerce_provider_subscription_records
         SET financial_restriction = $4,
             financial_restriction_event_id = CASE WHEN $4::text IS NULL THEN NULL ELSE $5 END,
             financial_restricted_at = CASE WHEN $4::text IS NULL THEN NULL::timestamptz
                  ELSE $6::timestamptz END
         WHERE provider = 'stripe' AND environment = $1 AND household_id = $2
           AND subscription_id = $3`,
        [
          input.environment,
          input.householdId,
          input.subscriptionId,
          effective,
          input.sourceInboxId,
          input.observedAt.toISOString(),
        ],
      );
      return effective;
    });
  }

  async resolveStripeEventBinding(input: {
    readonly environment?: 'test' | 'production';
    readonly externalSubscriptionId: string;
    readonly providerEventCreatedAt: Date;
    readonly canonicalBinding?: {
      readonly householdId: string;
      readonly subscriptionId: string;
      readonly planVersionId: string;
    };
  }): Promise<CanonicalStripeBinding | null> {
    const environment = input.environment ?? 'test';
    const existing = await this.database.query<ProviderBindingRow>(
      `SELECT provider_record.household_id, provider_record.subscription_id,
              subscription.plan_version_id, provider_record.provider_customer_id,
              intent.billing_interval, intent.provider_price_id
       FROM commerce_provider_subscription_records provider_record
       JOIN commerce_subscriptions subscription
         ON subscription.household_id = provider_record.household_id
        AND subscription.id = provider_record.subscription_id
       JOIN commerce_checkout_intents intent
         ON intent.household_id = subscription.household_id
        AND intent.subscription_id = subscription.id
         AND intent.environment = $2 AND intent.state = 'session_created'
       WHERE provider_record.provider = 'stripe'
         AND provider_record.environment = $2
         AND provider_record.external_subscription_id = $1`,
      [input.externalSubscriptionId, environment],
    );
    const bound = existing.rows[0];
    if (bound !== undefined) {
      if (
        input.canonicalBinding !== undefined &&
        (input.canonicalBinding.householdId !== bound.household_id ||
          input.canonicalBinding.subscriptionId !== bound.subscription_id ||
          input.canonicalBinding.planVersionId !== bound.plan_version_id)
      ) {
        return null;
      }
      return {
        householdId: bound.household_id,
        subscriptionId: bound.subscription_id,
        planVersionId: bound.plan_version_id,
        billingInterval: bound.billing_interval,
        providerPriceId: bound.provider_price_id,
        bindingState: 'existing_provider',
        ...(bound.provider_customer_id === null
          ? {}
          : { providerCustomerId: bound.provider_customer_id }),
      };
    }
    const row = await bindingFromSubscription(
      this.database,
      input.externalSubscriptionId,
      input.providerEventCreatedAt,
      environment,
    );
    if (row !== undefined) {
      if (
        input.canonicalBinding !== undefined &&
        (row.household_id !== input.canonicalBinding.householdId ||
          row.subscription_id !== input.canonicalBinding.subscriptionId ||
          row.plan_version_id !== input.canonicalBinding.planVersionId)
      ) {
        return null;
      }
      return {
        householdId: row.household_id,
        subscriptionId: row.subscription_id,
        planVersionId: row.plan_version_id,
        billingInterval: row.billing_interval,
        providerPriceId: row.provider_price_id,
        bindingState: 'completed_checkout',
        ...(row.provider_customer_id === null
          ? {}
          : { providerCustomerId: row.provider_customer_id }),
      };
    }
    return null;
  }

  async resolveStripeCustomer(input: {
    readonly actor: CommerceActor;
    readonly environment?: 'test' | 'production';
  }): Promise<string | null> {
    const environment = input.environment ?? 'test';
    const authority = await resolveActiveBillingAuthority(
      this.database,
      input.actor.householdId,
      input.actor.personId,
    );
    if (authority === null || authority.authorityReference !== input.actor.billingAuthorityId) {
      return null;
    }
    const result = await this.database.query<
      { provider_customer_id: string } & Record<string, unknown>
    >(
      `SELECT provider_customer_id
       FROM commerce_provider_customers
       WHERE household_id = $1 AND provider = 'stripe' AND environment = $2
       ORDER BY verified_at DESC LIMIT 1`,
      [input.actor.householdId, environment],
    );
    return result.rows[0]?.provider_customer_id ?? null;
  }

  async stripeBillingStatus(input: {
    readonly actor: CommerceActor;
    readonly environment: 'test' | 'production';
    readonly runtimeInitiationPermitted: boolean;
    readonly runtimePortalPermitted?: boolean;
    readonly now: Date;
  }): Promise<{
    readonly checkoutState:
      | 'unavailable'
      | 'eligible_disabled'
      | 'ready'
      | 'pending_provider'
      | 'awaiting_payment_evidence'
      | 'active'
      | 'restricted';
    readonly canonicalAccessActive: boolean;
    readonly portalAvailable: boolean;
    readonly runtimeInitiationEnabled: boolean;
    readonly pendingOperation?: {
      readonly serverOperationId: string;
      readonly state: 'dispatching' | 'outcome_unknown';
      readonly attemptCount: number;
      readonly nextRetryAt?: Date;
      readonly expiresAt?: Date;
    };
  }> {
    const authority = await resolveActiveBillingAuthority(
      this.database,
      input.actor.householdId,
      input.actor.personId,
    );
    if (authority === null || authority.authorityReference !== input.actor.billingAuthorityId) {
      throw new DomainError('not_authorized', 'Active billing authority is required');
    }
    const result = await this.database.query<
      {
        readonly control_state: string | null;
        readonly eligible_state: string | null;
        readonly cohort_state: string | null;
        readonly intent_state: string | null;
        readonly dispatch_state: string | null;
        readonly completion_count: number;
        readonly active_grant_count: number;
        readonly restriction_count: number;
        readonly customer_count: number;
        readonly operation_server_id: string | null;
        readonly operation_state: string | null;
        readonly operation_attempt_count: number | null;
        readonly operation_next_retry_at: unknown;
        readonly operation_expires_at: unknown;
      } & Record<string, unknown>
    >(
      `SELECT
         (SELECT state FROM commerce_stripe_initiation_controls WHERE environment = $2) AS control_state,
         (SELECT state FROM commerce_stripe_eligible_households
          WHERE household_id = $1 AND environment = $2
            AND eligibility_expires_at > CURRENT_TIMESTAMP) AS eligible_state,
         (SELECT policy.state FROM commerce_stripe_cohort_policies policy
          JOIN commerce_stripe_eligible_households eligible
            ON eligible.environment = policy.environment AND eligible.household_id = $1
          WHERE policy.environment = $2 AND policy.state = 'active'
            AND policy.policy_expires_at > CURRENT_TIMESTAMP
            AND policy.max_active > 0
            AND policy.benefit_key = 'family_v1_monthly_1499'
            AND eligible.state = 'eligible'
            AND eligible.eligibility_expires_at > CURRENT_TIMESTAMP
            AND eligible.benefit_key = policy.benefit_key
            AND ($2 <> 'production' OR policy.live_approved = true)
            AND (
              SELECT count(*)::int FROM commerce_stripe_eligible_households cohort_member
              WHERE cohort_member.environment = $2
                AND cohort_member.cohort_key = policy.cohort_key
                AND cohort_member.benefit_key = policy.benefit_key
                AND cohort_member.state = 'eligible'
                AND cohort_member.eligibility_expires_at > CURRENT_TIMESTAMP
            ) <= policy.max_active) AS cohort_state,
         (SELECT state FROM commerce_checkout_intents
          WHERE household_id = $1 AND environment = $2
            AND state IN ('prepared','session_created')
            AND (expires_at > $3 OR dispatch_state <> 'not_dispatched')
          ORDER BY created_at DESC LIMIT 1) AS intent_state,
         (SELECT dispatch_state FROM commerce_checkout_intents
          WHERE household_id = $1 AND environment = $2
            AND state IN ('prepared','session_created')
            AND (expires_at > $3 OR dispatch_state <> 'not_dispatched')
          ORDER BY created_at DESC LIMIT 1) AS dispatch_state,
         (SELECT count(*)::int FROM commerce_stripe_checkout_completions
          WHERE household_id = $1 AND environment = $2) AS completion_count,
         (SELECT count(*)::int FROM entitlement_grants grant_record
          JOIN commerce_subscriptions subscription
            ON subscription.household_id = grant_record.household_id
           AND subscription.id = grant_record.subscription_id
          WHERE grant_record.household_id = $1 AND subscription.source = 'web'
            AND subscription.source_verified = true
            AND subscription.lifecycle IN ('active','grace','cancel_at_period_end','restored')
            AND subscription.current_period_starts_at <= $3
            AND subscription.current_period_ends_at > $3
            AND grant_record.source_verified = true AND grant_record.starts_at <= $3
            AND (grant_record.ends_at IS NULL OR grant_record.ends_at > $3)
            AND (grant_record.revoked_at IS NULL OR grant_record.revoked_at > $3)
            AND EXISTS (
              SELECT 1 FROM commerce_provider_subscription_records provider_record
              WHERE provider_record.household_id = subscription.household_id
                AND provider_record.subscription_id = subscription.id
                AND provider_record.provider = 'stripe' AND provider_record.environment = $2
                AND provider_record.verified_at IS NOT NULL
            )) AS active_grant_count,
         (SELECT count(*)::int FROM commerce_provider_subscription_records provider_record
          WHERE provider_record.household_id = $1 AND provider_record.environment = $2
            AND provider_record.provider = 'stripe'
            AND provider_record.financial_restriction IS NOT NULL) AS restriction_count,
         (SELECT count(*)::int FROM commerce_provider_customers
          WHERE household_id = $1 AND provider = 'stripe' AND environment = $2) AS customer_count,
         (SELECT operation.server_operation_id FROM commerce_stripe_session_operations operation
          JOIN commerce_checkout_intents intent
            ON intent.household_id = operation.household_id
           AND intent.id = operation.checkout_intent_id
          WHERE operation.household_id = $1
            AND operation.environment = $2
            AND operation.action = 'checkout'
            AND operation.state IN ('dispatching','outcome_unknown')
          ORDER BY operation.created_at DESC LIMIT 1) AS operation_server_id,
         (SELECT operation.state FROM commerce_stripe_session_operations operation
          JOIN commerce_checkout_intents intent
            ON intent.household_id = operation.household_id
           AND intent.id = operation.checkout_intent_id
          WHERE operation.household_id = $1
            AND operation.environment = $2
            AND operation.action = 'checkout'
            AND operation.state IN ('dispatching','outcome_unknown')
          ORDER BY operation.created_at DESC LIMIT 1) AS operation_state,
         (SELECT operation.attempt_count FROM commerce_stripe_session_operations operation
          JOIN commerce_checkout_intents intent
            ON intent.household_id = operation.household_id
           AND intent.id = operation.checkout_intent_id
          WHERE operation.household_id = $1
            AND operation.environment = $2
            AND operation.action = 'checkout'
            AND operation.state IN ('dispatching','outcome_unknown')
          ORDER BY operation.created_at DESC LIMIT 1) AS operation_attempt_count,
         (SELECT operation.next_retry_at FROM commerce_stripe_session_operations operation
          JOIN commerce_checkout_intents intent
            ON intent.household_id = operation.household_id
           AND intent.id = operation.checkout_intent_id
          WHERE operation.household_id = $1
            AND operation.environment = $2
            AND operation.action = 'checkout'
            AND operation.state IN ('dispatching','outcome_unknown')
          ORDER BY operation.created_at DESC LIMIT 1) AS operation_next_retry_at,
         (SELECT intent.expires_at FROM commerce_stripe_session_operations operation
          JOIN commerce_checkout_intents intent
            ON intent.household_id = operation.household_id
           AND intent.id = operation.checkout_intent_id
          WHERE operation.household_id = $1 AND operation.environment = $2
            AND operation.action = 'checkout'
            AND operation.state IN ('dispatching','outcome_unknown')
          ORDER BY operation.created_at DESC LIMIT 1) AS operation_expires_at`,
      [input.actor.householdId, input.environment, input.now.toISOString()],
    );
    const row = result.rows[0];
    if (row === undefined) throw new DomainError('conflict', 'Billing status is unavailable');
    const canonicalAccessActive = row.active_grant_count > 0;
    const checkoutState =
      row.restriction_count > 0
        ? 'restricted'
        : canonicalAccessActive
          ? 'active'
          : row.completion_count > 0
            ? 'awaiting_payment_evidence'
            : ['prepared', 'session_created'].includes(row.intent_state ?? '') ||
                row.operation_server_id !== null
              ? 'pending_provider'
              : input.runtimeInitiationPermitted &&
                  row.eligible_state === 'eligible' &&
                  row.cohort_state === 'active' &&
                  row.control_state === 'enabled'
                ? 'ready'
                : row.eligible_state === 'eligible'
                  ? 'eligible_disabled'
                  : 'unavailable';
    return {
      checkoutState,
      canonicalAccessActive,
      portalAvailable: input.runtimePortalPermitted === true && row.customer_count > 0,
      runtimeInitiationEnabled:
        input.runtimeInitiationPermitted &&
        row.cohort_state === 'active' &&
        row.control_state === 'enabled',
      ...(row.operation_server_id === null ||
      (row.operation_state !== 'dispatching' && row.operation_state !== 'outcome_unknown') ||
      row.operation_attempt_count === null
        ? {}
        : {
            pendingOperation: {
              serverOperationId: row.operation_server_id,
              state: row.operation_state,
              attemptCount: row.operation_attempt_count,
              ...(row.operation_next_retry_at === null
                ? {}
                : { nextRetryAt: asDate(row.operation_next_retry_at) }),
              ...(row.operation_expires_at === null
                ? {}
                : { expiresAt: asDate(row.operation_expires_at) }),
            },
          }),
    };
  }

  async reconcileStripeSubscriptionInventory(input: {
    readonly runId?: string;
    readonly environment: 'test' | 'production';
    readonly providerSubscriptions: readonly {
      readonly externalSubscriptionId: string;
      readonly lifecycle: string;
    }[];
    readonly cursorComplete: boolean;
    readonly accountId?: string;
    readonly verifiedAccountId?: string;
    readonly apiVersion?: string;
    readonly evidenceTier?:
      'local_fixture' | 'stripe_test' | 'deployed_staging' | 'live_production';
    readonly transportKind?: 'injected_fixture' | 'stripe_https';
    readonly runtimeRunId?: string;
    readonly now: Date;
  }): Promise<{
    readonly runId: string;
    readonly state: 'completed' | 'attention';
    readonly providerCount: number;
    readonly canonicalCount: number;
    readonly mismatchCount: number;
  }> {
    if (
      input.runId !== undefined &&
      (input.accountId === undefined ||
        input.verifiedAccountId === undefined ||
        input.verifiedAccountId !== input.accountId)
    ) {
      throw new DomainError('conflict', 'Stripe inventory account identity is not verified');
    }
    const providerIds = new Set<string>();
    for (const subscription of input.providerSubscriptions) {
      if (
        !/^sub_[A-Za-z0-9_]{3,200}$/u.test(subscription.externalSubscriptionId) ||
        subscription.lifecycle.trim() === '' ||
        providerIds.has(subscription.externalSubscriptionId)
      ) {
        throw new DomainError('invalid_input', 'Stripe inventory snapshot is invalid');
      }
      providerIds.add(subscription.externalSubscriptionId);
    }
    return this.database.transaction(async (transaction) => {
      const canonical = await transaction.query<
        {
          readonly external_subscription_id: string;
          readonly raw_state: string;
        } & Record<string, unknown>
      >(
        `SELECT external_subscription_id, raw_state
         FROM commerce_provider_subscription_records
         WHERE provider = 'stripe' AND environment = $1
         ORDER BY external_subscription_id`,
        [input.environment],
      );
      const canonicalById = new Map(
        canonical.rows.map((row) => [row.external_subscription_id, row.raw_state] as const),
      );
      const mismatches: Array<{
        readonly kind:
          'provider_only' | 'canonical_only' | 'state_mismatch' | 'pagination_incomplete';
        readonly providerSubscriptionId?: string;
        readonly evidence: string;
      }> = [];
      for (const subscription of input.providerSubscriptions) {
        const canonicalState = canonicalById.get(subscription.externalSubscriptionId);
        if (canonicalState === undefined) {
          mismatches.push({
            kind: 'provider_only',
            providerSubscriptionId: subscription.externalSubscriptionId,
            evidence: `provider_only\0${subscription.externalSubscriptionId}\0${subscription.lifecycle}`,
          });
        } else if (canonicalState !== subscription.lifecycle) {
          mismatches.push({
            kind: 'state_mismatch',
            providerSubscriptionId: subscription.externalSubscriptionId,
            evidence: `state_mismatch\0${subscription.externalSubscriptionId}\0${canonicalState}\0${subscription.lifecycle}`,
          });
        }
      }
      for (const [externalSubscriptionId, lifecycle] of canonicalById) {
        if (!providerIds.has(externalSubscriptionId)) {
          mismatches.push({
            kind: 'canonical_only',
            providerSubscriptionId: externalSubscriptionId,
            evidence: `canonical_only\0${externalSubscriptionId}\0${lifecycle}`,
          });
        }
      }
      if (!input.cursorComplete) {
        mismatches.push({
          kind: 'pagination_incomplete',
          evidence: `pagination_incomplete\0${input.environment}\0${input.providerSubscriptions.length}`,
        });
      }
      const runId = input.runId ?? this.idFactory.next('stripe-inventory');
      const state = mismatches.length === 0 ? 'completed' : 'attention';
      if (input.runId === undefined) {
        await transaction.query(
          `INSERT INTO commerce_stripe_inventory_reconciliation_runs(
             id, environment, state, provider_count, canonical_count, mismatch_count,
             cursor_complete, started_at, completed_at, account_id, api_version,
             evidence_tier, transport_kind, runtime_run_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13)`,
          [
            runId,
            input.environment,
            state,
            input.providerSubscriptions.length,
            canonical.rows.length,
            mismatches.length,
            input.cursorComplete,
            input.now.toISOString(),
            input.accountId ?? null,
            input.apiVersion ?? null,
            input.evidenceTier ?? null,
            input.transportKind ?? null,
            input.runtimeRunId ?? null,
          ],
        );
      } else {
        const updated = await transaction.query(
          `UPDATE commerce_stripe_inventory_reconciliation_runs
           SET state = $3, provider_count = $4, canonical_count = $5,
               mismatch_count = $6, cursor_complete = $7, completed_at = $8,
               failure_code = NULL, verified_account_id = $9, account_verified_at = $8
           WHERE id = $1 AND environment = $2 AND state = 'running'
             AND account_id = $9`,
          [
            runId,
            input.environment,
            state,
            input.providerSubscriptions.length,
            canonical.rows.length,
            mismatches.length,
            input.cursorComplete,
            input.now.toISOString(),
            input.verifiedAccountId,
          ],
        );
        if (updated.rowCount !== 1) {
          throw new DomainError('conflict', 'Stripe inventory run is not completable');
        }
      }
      for (const mismatch of mismatches) {
        await transaction.query(
          `INSERT INTO commerce_stripe_inventory_mismatches(
             id, run_id, mismatch_kind, provider_subscription_id,
             evidence_digest, observed_at
           ) VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            this.idFactory.next('stripe-inventory-mismatch'),
            runId,
            mismatch.kind,
            mismatch.providerSubscriptionId ?? null,
            createHash('sha256').update(mismatch.evidence).digest('hex'),
            input.now.toISOString(),
          ],
        );
      }
      return {
        runId,
        state,
        providerCount: input.providerSubscriptions.length,
        canonicalCount: canonical.rows.length,
        mismatchCount: mismatches.length,
      };
    });
  }

  async startStripeInventoryRun(input: {
    readonly environment: 'test' | 'production';
    readonly accountId: string;
    readonly apiVersion: string;
    readonly evidenceTier: 'local_fixture' | 'stripe_test' | 'deployed_staging' | 'live_production';
    readonly transportKind: 'injected_fixture' | 'stripe_https';
    readonly operationKey: string;
    readonly runtimeRunId: string;
    readonly now: Date;
  }): Promise<{
    readonly runId: string;
    readonly alreadyCompleted: boolean;
    readonly attempt: number;
  }> {
    return this.database.transaction(async (transaction) => {
      const existing = await transaction.query<
        {
          readonly id: string;
          readonly state: 'running' | 'completed' | 'attention';
          readonly account_id: string;
          readonly api_version: string;
          readonly evidence_tier: string;
          readonly transport_kind: string;
          readonly attempt_count: number;
        } & Record<string, unknown>
      >(
        `SELECT run.id, run.state, run.account_id, run.api_version,
                run.evidence_tier, run.transport_kind,
                (SELECT count(*)::int FROM commerce_stripe_inventory_run_attempts attempt
                 WHERE attempt.run_id = run.id) AS attempt_count
         FROM commerce_stripe_inventory_reconciliation_runs run
         WHERE run.environment = $1 AND run.operation_key = $2 FOR UPDATE`,
        [input.environment, input.operationKey],
      );
      let row = existing.rows[0];
      if (
        row !== undefined &&
        (row.account_id !== input.accountId ||
          row.api_version !== input.apiVersion ||
          row.evidence_tier !== input.evidenceTier ||
          row.transport_kind !== input.transportKind)
      ) {
        throw new DomainError('conflict', 'Stripe inventory operation provenance conflicts');
      }
      if (row?.state === 'completed') {
        return { runId: row.id, alreadyCompleted: true, attempt: row.attempt_count };
      }
      if (row === undefined) {
        const runId = this.idFactory.next('stripe-inventory');
        await transaction.query(
          `INSERT INTO commerce_stripe_inventory_reconciliation_runs(
             id, environment, state, provider_count, canonical_count, mismatch_count,
             cursor_complete, started_at, account_id, api_version, evidence_tier,
             transport_kind, runtime_run_id, operation_key
           ) VALUES ($1,$2,'running',0,0,0,false,$3,$4,$5,$6,$7,$8,$9)`,
          [
            runId,
            input.environment,
            input.now.toISOString(),
            input.accountId,
            input.apiVersion,
            input.evidenceTier,
            input.transportKind,
            input.runtimeRunId,
            input.operationKey,
          ],
        );
        row = {
          id: runId,
          state: 'running',
          account_id: input.accountId,
          api_version: input.apiVersion,
          evidence_tier: input.evidenceTier,
          transport_kind: input.transportKind,
          attempt_count: 0,
        };
      } else if (row.state === 'attention') {
        const reclaimed = await transaction.query(
          `UPDATE commerce_stripe_inventory_reconciliation_runs
           SET state = 'running', failure_code = NULL, completed_at = NULL
           WHERE id = $1 AND state = 'attention'`,
          [row.id],
        );
        if (reclaimed.rowCount !== 1) {
          throw new DomainError('conflict', 'Stripe inventory run could not be reclaimed');
        }
      }
      const attempt = row.attempt_count + 1;
      await transaction.query(
        `INSERT INTO commerce_stripe_inventory_run_attempts(
           id, run_id, runtime_run_id, attempt, attempted_at
         ) VALUES ($1,$2,$3,$4,$5)`,
        [
          this.idFactory.next('stripe-inventory-attempt'),
          row.id,
          input.runtimeRunId,
          attempt,
          input.now.toISOString(),
        ],
      );
      return { runId: row.id, alreadyCompleted: false, attempt };
    });
  }

  async recordStripeInventoryPage(input: {
    readonly runId: string;
    readonly environment: 'test' | 'production';
    readonly accountId: string;
    readonly pageNumber: number;
    readonly requestCursor?: string;
    readonly nextCursor?: string;
    readonly hasMore: boolean;
    readonly subscriptions: readonly {
      readonly externalSubscriptionId: string;
      readonly lifecycle: string;
    }[];
    readonly now: Date;
  }): Promise<void> {
    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          environment: input.environment,
          accountId: input.accountId,
          pageNumber: input.pageNumber,
          requestCursor: input.requestCursor ?? null,
          nextCursor: input.nextCursor ?? null,
          hasMore: input.hasMore,
          subscriptions: input.subscriptions,
        }),
      )
      .digest('hex');
    const inserted = await this.database.query(
      `INSERT INTO commerce_stripe_inventory_page_receipts(
         id, run_id, environment, account_id, page_number, request_cursor,
         next_cursor, has_more, subscription_count, evidence_digest, observed_at
       )
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
       FROM commerce_stripe_inventory_reconciliation_runs run
       WHERE run.id = $2 AND run.environment = $3 AND run.state = 'running'
         AND run.account_id = $4
       ON CONFLICT (run_id, page_number) DO NOTHING`,
      [
        this.idFactory.next('stripe-inventory-page'),
        input.runId,
        input.environment,
        input.accountId,
        input.pageNumber,
        input.requestCursor ?? null,
        input.nextCursor ?? null,
        input.hasMore,
        input.subscriptions.length,
        digest,
        input.now.toISOString(),
      ],
    );
    if (inserted.rowCount === 0) {
      const existing = await this.database.query<
        {
          readonly environment: string;
          readonly account_id: string;
          readonly request_cursor: string | null;
          readonly next_cursor: string | null;
          readonly has_more: boolean;
          readonly subscription_count: number;
          readonly evidence_digest: string;
        } & Record<string, unknown>
      >(
        `SELECT environment, account_id, request_cursor, next_cursor, has_more,
                subscription_count, evidence_digest
         FROM commerce_stripe_inventory_page_receipts
         WHERE run_id = $1 AND page_number = $2`,
        [input.runId, input.pageNumber],
      );
      const row = existing.rows[0];
      if (
        row === undefined ||
        row.environment !== input.environment ||
        row.account_id !== input.accountId ||
        row.request_cursor !== (input.requestCursor ?? null) ||
        row.next_cursor !== (input.nextCursor ?? null) ||
        row.has_more !== input.hasMore ||
        row.subscription_count !== input.subscriptions.length ||
        row.evidence_digest !== digest
      ) {
        throw new DomainError('conflict', 'Stripe inventory page receipt conflicts on retry');
      }
    }
  }

  async markStripeInventoryAttention(input: {
    readonly runId: string;
    readonly environment: 'test' | 'production';
    readonly failureCode: string;
    readonly now: Date;
  }): Promise<void> {
    await this.database.query(
      `UPDATE commerce_stripe_inventory_reconciliation_runs
       SET state = 'attention', cursor_complete = false, failure_code = $3,
           completed_at = $4
       WHERE id = $1 AND environment = $2 AND state = 'running'`,
      [input.runId, input.environment, input.failureCode, input.now.toISOString()],
    );
  }
}

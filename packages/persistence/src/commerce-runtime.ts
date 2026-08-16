import { DomainError } from '@boomerbuddy/domain';
import type { CommerceActor } from '@boomerbuddy/integrations';
import type { Database, SqlExecutor } from './database';
import { resolveActiveBillingAuthority } from './entitlements';
import { randomIdFactory, type IdFactory } from './values';

interface CheckoutIntentRow extends Record<string, unknown> {
  readonly id: string;
  readonly household_id: string;
  readonly subscription_id: string;
  readonly requested_by_person_id: string;
  readonly billing_authority_person_id: string;
  readonly plan_version_id: string;
  readonly billing_interval: 'month' | 'year';
  readonly provider_price_id: string;
  readonly environment: 'test';
  readonly state: 'prepared' | 'session_created' | 'expired';
  readonly provider_session_id: string | null;
  readonly expires_at: unknown;
}

interface ProviderBindingRow extends Record<string, unknown> {
  readonly household_id: string;
  readonly subscription_id: string;
  readonly plan_version_id: string;
  readonly provider_customer_id: string | null;
  readonly billing_interval: 'month' | 'year';
  readonly provider_price_id: string;
}

export interface PreparedStripeCheckout {
  readonly intentId: string;
  readonly subscriptionId: string;
  readonly planVersionId: string;
  readonly actor: CommerceActor;
  readonly duplicate: boolean;
  readonly providerSessionId?: string;
  readonly expiresAt: Date;
}

export interface CanonicalStripeBinding {
  readonly householdId: string;
  readonly subscriptionId: string;
  readonly planVersionId: string;
  readonly providerCustomerId?: string;
  readonly billingInterval: 'month' | 'year';
  readonly providerPriceId: string;
  readonly bindingState: 'active_checkout' | 'existing_provider';
}

function validIdempotencyKey(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9:._-]{15,159}$/u.test(value);
}

function asDate(value: unknown): Date {
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new TypeError('Invalid commerce timestamp');
  return date;
}

async function bindingFromSubscription(
  executor: SqlExecutor,
  householdId: string,
  subscriptionId: string,
  providerEventCreatedAt: Date,
): Promise<ProviderBindingRow | undefined> {
  const result = await executor.query<ProviderBindingRow>(
    `SELECT s.household_id, s.id AS subscription_id, s.plan_version_id,
            provider_record.provider_customer_id, intent.billing_interval,
            intent.provider_price_id
     FROM commerce_subscriptions s
     JOIN commerce_checkout_intents intent
       ON intent.household_id = s.household_id AND intent.subscription_id = s.id
     JOIN household_billing_authorities authority
       ON authority.household_id = intent.household_id
      AND authority.person_id = intent.billing_authority_person_id
      AND authority.status = 'active'
     LEFT JOIN commerce_provider_subscription_records provider_record
       ON provider_record.household_id = s.household_id
      AND provider_record.subscription_id = s.id
      AND provider_record.provider = 'stripe'
      AND provider_record.environment = 'test'
     WHERE s.household_id = $1 AND s.id = $2 AND s.source = 'web'
       AND intent.environment = 'test' AND intent.state = 'session_created'
       AND intent.created_at <= $3 AND intent.expires_at >= $3
     ORDER BY provider_record.observed_at DESC NULLS LAST
     LIMIT 1`,
    [householdId, subscriptionId, providerEventCreatedAt.toISOString()],
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

  async prepareStripeCheckout(input: {
    readonly actor: CommerceActor;
    readonly planVersionId: string;
    readonly billingInterval: 'month' | 'year';
    readonly providerPriceId: string;
    readonly idempotencyKey: string;
    readonly now: Date;
  }): Promise<PreparedStripeCheckout> {
    if (!validIdempotencyKey(input.idempotencyKey)) {
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
           AND expires_at <= $2`,
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
                provider_price_id, environment, state,
                provider_session_id, expires_at
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
          prior.plan_version_id !== input.planVersionId ||
          prior.billing_interval !== input.billingInterval ||
          prior.provider_price_id !== input.providerPriceId ||
          prior.environment !== 'test'
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
        `SELECT 1 FROM commerce_plan_versions
         WHERE id = $1 AND plan_key IN ('plus','family')
           AND state IN ('hypothesis','active')
           AND available_from <= $2
           AND (available_until IS NULL OR available_until > $2)
         FOR SHARE`,
        [input.planVersionId, input.now.toISOString()],
      );
      if (plan.rowCount !== 1) {
        throw new DomainError('not_found', 'Checkout plan is unavailable');
      }
      const intentId = this.idFactory.next('checkout-intent');
      const subscriptionId = this.idFactory.next('subscription');
      const expiresAt = new Date(input.now.getTime() + 30 * 60_000);
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
           billing_authority_person_id, plan_version_id, billing_interval,
           provider_price_id, provider, environment,
           idempotency_key, state, created_at, updated_at, expires_at
         ) VALUES ($1,$2,$3,$4,$4,$5,$6,$7,'stripe','test',$8,'prepared',$9,$9,$10)`,
        [
          input.actor.householdId,
          intentId,
          subscriptionId,
          input.actor.personId,
          input.planVersionId,
          input.billingInterval,
          input.providerPriceId,
          input.idempotencyKey,
          input.now.toISOString(),
          expiresAt.toISOString(),
        ],
      );
      return {
        intentId,
        subscriptionId,
        planVersionId: input.planVersionId,
        actor: input.actor,
        duplicate: false,
        expiresAt,
      };
    });
  }

  async recordStripeCheckoutSession(input: {
    readonly householdId: string;
    readonly intentId: string;
    readonly providerSessionId: string;
    readonly now: Date;
  }): Promise<void> {
    if (!/^cs_test_[A-Za-z0-9_]+$/u.test(input.providerSessionId)) {
      throw new DomainError('invalid_input', 'Stripe test session identifier is invalid');
    }
    const updated = await this.database.query(
      `UPDATE commerce_checkout_intents
       SET state = 'session_created', provider_session_id = $3, updated_at = $4
       WHERE household_id = $1 AND id = $2 AND environment = 'test'
         AND state IN ('prepared','session_created')
         AND (provider_session_id IS NULL OR provider_session_id = $3)`,
      [input.householdId, input.intentId, input.providerSessionId, input.now.toISOString()],
    );
    if (updated.rowCount !== 1) {
      throw new DomainError('conflict', 'Checkout session linkage is invalid');
    }
  }

  async expireStripeCheckoutSession(input: {
    readonly providerSessionId: string;
    readonly providerEventCreatedAt: Date;
    readonly now: Date;
  }): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const expired = await transaction.query<
        { readonly household_id: string; readonly subscription_id: string } & Record<
          string,
          unknown
        >
      >(
        `UPDATE commerce_checkout_intents
         SET state = 'expired', updated_at = $3
         WHERE provider = 'stripe' AND environment = 'test' AND provider_session_id = $1
           AND state = 'session_created' AND created_at <= $2
         RETURNING household_id, subscription_id`,
        [
          input.providerSessionId,
          input.providerEventCreatedAt.toISOString(),
          input.now.toISOString(),
        ],
      );
      const intent = expired.rows[0];
      if (intent === undefined) return false;
      await transaction.query(
        `UPDATE commerce_subscriptions
         SET lifecycle = 'expired', reconciliation_state = 'not_required', updated_at = $3
         WHERE household_id = $1 AND id = $2 AND source = 'web' AND lifecycle = 'pending'`,
        [intent.household_id, intent.subscription_id, input.now.toISOString()],
      );
      return true;
    });
  }

  async resolveStripeEventBinding(input: {
    readonly externalSubscriptionId: string;
    readonly providerEventCreatedAt: Date;
    readonly canonicalBinding?: {
      readonly householdId: string;
      readonly subscriptionId: string;
      readonly planVersionId: string;
    };
  }): Promise<CanonicalStripeBinding | null> {
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
        AND intent.environment = 'test' AND intent.state = 'session_created'
       WHERE provider_record.provider = 'stripe'
         AND provider_record.environment = 'test'
         AND provider_record.external_subscription_id = $1`,
      [input.externalSubscriptionId],
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
    if (input.canonicalBinding !== undefined) {
      const row = await bindingFromSubscription(
        this.database,
        input.canonicalBinding.householdId,
        input.canonicalBinding.subscriptionId,
        input.providerEventCreatedAt,
      );
      if (row === undefined || row.plan_version_id !== input.canonicalBinding.planVersionId) {
        return null;
      }
      return {
        householdId: row.household_id,
        subscriptionId: row.subscription_id,
        planVersionId: row.plan_version_id,
        billingInterval: row.billing_interval,
        providerPriceId: row.provider_price_id,
        bindingState: 'active_checkout',
        ...(row.provider_customer_id === null
          ? {}
          : { providerCustomerId: row.provider_customer_id }),
      };
    }
    return null;
  }

  async resolveStripeCustomer(input: { readonly actor: CommerceActor }): Promise<string | null> {
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
       WHERE household_id = $1 AND provider = 'stripe' AND environment = 'test'
       ORDER BY verified_at DESC LIMIT 1`,
      [input.actor.householdId],
    );
    return result.rows[0]?.provider_customer_id ?? null;
  }
}

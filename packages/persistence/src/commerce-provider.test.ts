import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSeededTestDatabase, fixedTestNow } from '@boomerbuddy/testkit';
import { CommerceOperationsRepository } from './commerce';
import { CommerceRuntimeRepository } from './commerce-runtime';
import type { Database } from './database';
import { GrowthRuntimeRepository } from './growth-runtime';
import type { IdFactory } from './values';

function sequentialIds(): IdFactory {
  let counter = 0;
  return { next: (prefix) => `${prefix}-commerce-test-${++counter}` };
}

async function recordCompletedStripeCheckout(
  database: Database,
  input: {
    readonly suffix: string;
    readonly householdId: 'household-sunrise' | 'household-harbor';
    readonly subscriptionId: string;
    readonly externalSubscriptionId: string;
    readonly providerCustomerId: string;
  },
): Promise<void> {
  const personId =
    input.householdId === 'household-sunrise' ? 'person-owner-alice' : 'person-owner-bob';
  const returnedExpiry = new Date(fixedTestNow.getTime() + 23 * 60 * 60_000);
  const localExpiry = new Date(returnedExpiry.getTime() + 5 * 60_000);
  await database.query(
    `INSERT INTO commerce_event_inbox(
       id, provider, environment, external_event_id, event_type, payload_hmac,
       fingerprint_key_version, authenticity, status, received_at,
       provider_api_version, provider_object_id, provider_event_created_at,
       application_state
     ) VALUES ($1,'stripe','test',$2,'checkout.session.completed',$3,1,
               'verified','processed',$4,'2026-02-25.clover',$5,$4,'applied')`,
    [
      `checkout-event-${input.suffix}`,
      `evt-checkout-${input.suffix}`,
      `fixture-hmac-${input.suffix}`,
      fixedTestNow.toISOString(),
      `cs_test_${input.suffix}`,
    ],
  );
  await database.query(
    `INSERT INTO commerce_checkout_intents(
       household_id, id, subscription_id, requested_by_person_id,
       billing_authority_person_id, plan_version_id, offer_id, billing_interval,
       provider_price_id, provider, environment, idempotency_key, state,
       provider_session_id, created_at, updated_at, expires_at,
       server_operation_id, provider_idempotency_key, provider_requested_expires_at,
       provider_returned_expires_at, dispatch_state
     ) VALUES ($1,$2,$3,$4,$4,'family_v1','founding_family_monthly_v1','month',
               'price_test_family_monthly','stripe','test',$5,'session_created',$6,
               $7,$7,$8,$5,$9,$10,$10,'session_recorded')`,
    [
      input.householdId,
      `checkout-intent-${input.suffix}`,
      input.subscriptionId,
      personId,
      `checkout-operation-${input.suffix}`,
      `cs_test_${input.suffix}`,
      fixedTestNow.toISOString(),
      localExpiry.toISOString(),
      `bb:test:checkout:${input.suffix}`,
      returnedExpiry.toISOString(),
    ],
  );
  await database.query(
    `INSERT INTO commerce_stripe_checkout_completions(
       provider_session_id, environment, household_id, checkout_intent_id,
       subscription_id, provider_subscription_id, provider_customer_id,
       provider_payment_intent_id, source_inbox_id, provider_event_id,
       payment_status, session_status, amount_total, currency, completed_at,
       provider_expires_at
     ) VALUES ($1,'test',$2,$3,$4,$5,$6,$7,$8,$9,'paid','complete',1499,
               'usd',$10,$11)`,
    [
      `cs_test_${input.suffix}`,
      input.householdId,
      `checkout-intent-${input.suffix}`,
      input.subscriptionId,
      input.externalSubscriptionId,
      input.providerCustomerId,
      `pi_${input.suffix}`,
      `checkout-event-${input.suffix}`,
      `evt-checkout-${input.suffix}`,
      fixedTestNow.toISOString(),
      returnedExpiry.toISOString(),
    ],
  );
}

describe('verified provider commerce inbox', () => {
  let database: Database;
  let repository: CommerceOperationsRepository;

  beforeEach(async () => {
    database = await createSeededTestDatabase();
    repository = new CommerceOperationsRepository(
      database,
      Buffer.alloc(32, 23),
      1,
      sequentialIds(),
      'local',
    );
    await database.query(
      `INSERT INTO commerce_subscriptions(
         household_id, id, payer_person_id, plan_version_id, source, lifecycle,
         source_verified, precedence, current_period_starts_at, current_period_ends_at,
         reconciliation_state, created_at, updated_at
       ) VALUES (
         'household-sunrise','subscription-stripe-test','person-owner-alice','family_v1','web',
         'pending',false,200,$1,$2,'pending',$1,$1
       )`,
      [fixedTestNow.toISOString(), new Date(fixedTestNow.getTime() + 86_400_000).toISOString()],
    );
  });

  afterEach(async () => database.close());

  it('deduplicates exact evidence and rejects conflicting payloads for one event id', async () => {
    const input = {
      provider: 'stripe' as const,
      environment: 'test' as const,
      externalEventId: 'evt-provider-one',
      eventType: 'customer.subscription.updated',
      rawPayload: '{"id":"evt-provider-one","status":"active"}',
      providerApiVersion: '2026-07-29.fixture',
      providerObjectId: 'sub-provider-one',
      providerEventCreatedAt: fixedTestNow,
      normalizedLifecycle: 'active' as const,
      now: fixedTestNow,
    };
    const first = await repository.captureVerifiedProviderEvent(input);
    const duplicate = await repository.captureVerifiedProviderEvent(input);
    expect(first.duplicate).toBe(false);
    expect(duplicate).toMatchObject({ id: first.id, duplicate: true });
    await expect(
      repository.captureVerifiedProviderEvent({ ...input, rawPayload: '{"different":true}' }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('rejects an active Stripe subscription that has no exact completed Checkout binding', async () => {
    const captured = await repository.captureVerifiedProviderEvent({
      provider: 'stripe',
      environment: 'test',
      externalEventId: 'evt-unbound-active-subscription',
      eventType: 'customer.subscription.updated',
      rawPayload: '{"id":"evt-unbound-active-subscription","status":"active"}',
      providerApiVersion: '2026-02-25.clover',
      providerObjectId: 'sub_unbound_active',
      providerEventCreatedAt: fixedTestNow,
      normalizedLifecycle: 'active',
      now: fixedTestNow,
    });

    await expect(
      repository.applyProviderLifecycle({
        inboxId: captured.id,
        provider: 'stripe',
        environment: 'test',
        externalEventId: 'evt-unbound-active-subscription',
        providerApiVersion: '2026-02-25.clover',
        providerObjectId: 'sub_unbound_active',
        providerEventCreatedAt: fixedTestNow,
        householdId: 'household-sunrise',
        subscriptionId: 'subscription-stripe-test',
        externalSubscriptionId: 'sub_unbound_active',
        lifecycle: 'active',
        currentPeriodStartsAt: fixedTestNow,
        currentPeriodEndsAt: new Date(fixedTestNow.getTime() + 86_400_000),
        accessEvidence: { kind: 'non_payment' },
        now: fixedTestNow,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const canonical = await database.query<
      { readonly lifecycle: string; readonly source_verified: boolean } & Record<string, unknown>
    >(
      `SELECT lifecycle, source_verified FROM commerce_subscriptions
       WHERE household_id = 'household-sunrise' AND id = 'subscription-stripe-test'`,
    );
    expect(canonical.rows[0]).toEqual({ lifecycle: 'pending', source_verified: false });
  });

  it('requires the exact operator for audited gates and defaults live initiation off', async () => {
    const runtime = new CommerceRuntimeRepository(database, sequentialIds());
    await expect(
      runtime.changeStripeInitiationControl({
        environment: 'test',
        nextState: 'enabled',
        reasonCode: 'founder_test_activation',
        expectedRevision: 0,
        actorPersonId: 'person-owner-alice',
        configuredFounderPersonId: 'person-hq-heidi',
        correlationId: 'stripe-control-wrong-actor',
        now: fixedTestNow,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' });
    await expect(
      runtime.changeStripeInitiationControl({
        environment: 'production',
        nextState: 'enabled',
        reasonCode: 'founder_live_activation',
        expectedRevision: 0,
        actorPersonId: 'person-hq-heidi',
        configuredFounderPersonId: 'person-hq-heidi',
        correlationId: 'stripe-control-live-refused',
        now: fixedTestNow,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' });
    await expect(
      runtime.changeStripeInitiationControl({
        environment: 'test',
        nextState: 'enabled',
        reasonCode: 'founder_test_activation',
        expectedRevision: 0,
        actorPersonId: 'person-hq-heidi',
        configuredFounderPersonId: 'person-hq-heidi',
        correlationId: 'stripe-control-test-enabled',
        now: fixedTestNow,
      }),
    ).resolves.toEqual({ state: 'enabled', revision: 1 });
    await expect(
      runtime.changeStripeHouseholdEligibility({
        householdId: 'household-sunrise',
        environment: 'test',
        nextState: 'eligible',
        actorPersonId: 'person-hq-heidi',
        configuredFounderPersonId: 'person-hq-heidi',
        correlationId: 'stripe-household-eligible',
        now: fixedTestNow,
      }),
    ).resolves.toBe('eligible');
    await expect(
      runtime.assertStripeInitiationAllowed({
        householdId: 'household-sunrise',
        environment: 'test',
        runtimeInitiationPermitted: true,
      }),
    ).resolves.toBeUndefined();
    await expect(
      runtime.assertStripeInitiationAllowed({
        householdId: 'household-sunrise',
        environment: 'production',
        runtimeInitiationPermitted: false,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' });
    const audit = await database.query<
      { readonly controls: number; readonly eligibility: number } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::int FROM commerce_stripe_initiation_control_events
          WHERE actor_person_id = 'person-hq-heidi') AS controls,
         (SELECT count(*)::int FROM commerce_stripe_eligibility_events
          WHERE actor_person_id = 'person-hq-heidi') AS eligibility`,
    );
    expect(audit.rows[0]).toEqual({ controls: 1, eligibility: 1 });
  });

  it('scopes cohort eligibility by environment and serializes capacity at one household', async () => {
    const runtime = new CommerceRuntimeRepository(database, sequentialIds());
    await database.query(
      `INSERT INTO commerce_stripe_cohort_policies(
         environment, cohort_key, benefit_key, state, max_active, policy_expires_at,
         live_approved, revision, changed_by_person_id, changed_at
       ) VALUES ('test','founding_household_v1','family_v1_monthly_1499','active',1,$1,
                 false,1,'person-hq-heidi',$2)`,
      [new Date('2099-01-01T00:00:00.000Z').toISOString(), fixedTestNow.toISOString()],
    );
    const databaseClock = await database.query<{ readonly database_now: unknown }>(
      'SELECT CURRENT_TIMESTAMP AS database_now',
    );
    const databaseNow = new Date(String(databaseClock.rows[0]?.database_now));
    const eligibilityExpiresAt = new Date(databaseNow.getTime() + 60 * 60_000);
    const invitations = await Promise.allSettled(
      (['household-sunrise', 'household-harbor'] as const).map((householdId) =>
        runtime.changeStripeHouseholdEligibility({
          householdId,
          environment: 'test',
          nextState: 'eligible',
          actorPersonId: 'person-hq-heidi',
          configuredFounderPersonId: 'person-hq-heidi',
          correlationId: `stripe-capacity-${householdId}`,
          eligibilityExpiresAt,
          now: fixedTestNow,
        }),
      ),
    );
    expect(invitations.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(invitations.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rows = await database.query<
      { readonly environment: string; readonly household_id: string } & Record<string, unknown>
    >(
      `SELECT environment, household_id FROM commerce_stripe_eligible_households
       WHERE state = 'eligible' ORDER BY environment, household_id`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.environment).toBe('test');
    const originallyEligible = rows.rows[0]?.household_id as
      'household-sunrise' | 'household-harbor';
    const waitingHousehold =
      originallyEligible === 'household-sunrise' ? 'household-harbor' : 'household-sunrise';
    await database.query(
      `UPDATE commerce_stripe_eligible_households
       SET invited_at = CURRENT_TIMESTAMP - interval '2 hours',
           eligibility_expires_at = CURRENT_TIMESTAMP - interval '1 hour'
       WHERE environment = 'test' AND household_id = $1`,
      [originallyEligible],
    );
    const afterExpiry = new Date();
    await expect(
      runtime.changeStripeHouseholdEligibility({
        householdId: waitingHousehold,
        environment: 'test',
        nextState: 'eligible',
        actorPersonId: 'person-hq-heidi',
        configuredFounderPersonId: 'person-hq-heidi',
        correlationId: 'stripe-capacity-reassigned-after-expiry',
        now: afterExpiry,
      }),
    ).resolves.toBe('eligible');
    await expect(
      runtime.changeStripeHouseholdEligibility({
        householdId: originallyEligible,
        environment: 'test',
        nextState: 'eligible',
        actorPersonId: 'person-hq-heidi',
        configuredFounderPersonId: 'person-hq-heidi',
        correlationId: 'stripe-expired-eligibility-cannot-bypass-capacity',
        now: afterExpiry,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      runtime.changeStripeLiveCohortApproval({
        nextApproved: true,
        expectedRevision: 0,
        actorPersonId: 'person-owner-alice',
        configuredFounderPersonId: 'person-hq-heidi',
        correlationId: 'stripe-live-approval-wrong-founder',
        now: fixedTestNow,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' });
    await expect(
      runtime.changeStripeLiveCohortApproval({
        nextApproved: true,
        expectedRevision: 0,
        actorPersonId: 'person-hq-heidi',
        configuredFounderPersonId: 'person-hq-heidi',
        correlationId: 'stripe-live-approval-explicit',
        now: fixedTestNow,
      }),
    ).resolves.toEqual({ approved: true, revision: 1 });
    await expect(
      runtime.changeStripeHouseholdEligibility({
        householdId: rows.rows[0]?.household_id as 'household-sunrise' | 'household-harbor',
        environment: 'production',
        nextState: 'eligible',
        actorPersonId: 'person-hq-heidi',
        configuredFounderPersonId: 'person-hq-heidi',
        correlationId: 'stripe-production-eligibility-enabled',
        now: fixedTestNow,
      }),
    ).resolves.toBe('eligible');
    await expect(
      runtime.changeStripeInitiationControl({
        environment: 'production',
        nextState: 'enabled',
        reasonCode: 'founder_live_activation',
        expectedRevision: 0,
        actorPersonId: 'person-hq-heidi',
        configuredFounderPersonId: 'person-hq-heidi',
        correlationId: 'stripe-live-initiation-enabled',
        runtimeInitiationPermitted: true,
        now: fixedTestNow,
      }),
    ).resolves.toEqual({ state: 'enabled', revision: 1 });
    await expect(
      runtime.assertStripeInitiationAllowed({
        householdId: rows.rows[0]?.household_id as string,
        environment: 'production',
        runtimeInitiationPermitted: true,
        now: fixedTestNow,
      }),
    ).resolves.toBeUndefined();
    const liveApprovalAudit = await database.query<
      { readonly next_live_approved: boolean; readonly correlation_id: string } & Record<
        string,
        unknown
      >
    >(
      `SELECT next_live_approved, correlation_id
       FROM commerce_stripe_cohort_policy_events_v2
       WHERE environment = 'production'`,
    );
    expect(liveApprovalAudit.rows).toEqual([
      {
        next_live_approved: true,
        correlation_id: 'stripe-live-approval-explicit',
      },
    ]);
  });

  it('derives billing readiness from runtime gates and never verifies expired canonical access', async () => {
    const runtime = new CommerceRuntimeRepository(database, sequentialIds());
    const actor = await runtime.resolveActor({
      householdId: 'household-sunrise',
      personId: 'person-owner-alice',
      now: fixedTestNow,
    });
    await runtime.changeStripeInitiationControl({
      environment: 'test',
      nextState: 'enabled',
      reasonCode: 'founder_test_activation',
      expectedRevision: 0,
      actorPersonId: 'person-hq-heidi',
      configuredFounderPersonId: 'person-hq-heidi',
      correlationId: 'stripe-billing-runtime-control',
      now: fixedTestNow,
    });
    await runtime.changeStripeHouseholdEligibility({
      householdId: 'household-sunrise',
      environment: 'test',
      nextState: 'eligible',
      actorPersonId: 'person-hq-heidi',
      configuredFounderPersonId: 'person-hq-heidi',
      correlationId: 'stripe-billing-runtime-eligibility',
      now: fixedTestNow,
    });
    await expect(
      runtime.stripeBillingStatus({
        actor,
        environment: 'test',
        runtimeInitiationPermitted: false,
        runtimePortalPermitted: true,
        now: fixedTestNow,
      }),
    ).resolves.toMatchObject({
      checkoutState: 'eligible_disabled',
      canonicalAccessActive: false,
      runtimeInitiationEnabled: false,
      portalAvailable: false,
    });
    await database.query(
      `INSERT INTO commerce_provider_customers(
         provider, environment, provider_customer_id, household_id, verified_at
       ) VALUES ('stripe','test','cus_portal_independent','household-sunrise',$1)`,
      [fixedTestNow.toISOString()],
    );
    await expect(
      runtime.stripeBillingStatus({
        actor,
        environment: 'test',
        runtimeInitiationPermitted: false,
        runtimePortalPermitted: true,
        now: fixedTestNow,
      }),
    ).resolves.toMatchObject({
      checkoutState: 'eligible_disabled',
      runtimeInitiationEnabled: false,
      portalAvailable: true,
    });
    await expect(
      runtime.stripeBillingStatus({
        actor,
        environment: 'test',
        runtimeInitiationPermitted: true,
        now: fixedTestNow,
      }),
    ).resolves.toMatchObject({
      checkoutState: 'ready',
      canonicalAccessActive: false,
      runtimeInitiationEnabled: true,
    });

    const expiredAt = new Date(fixedTestNow.getTime() - 1_000);
    await database.query(
      `UPDATE commerce_subscriptions
       SET lifecycle = 'active', source_verified = true,
           current_period_starts_at = $1, current_period_ends_at = $2,
           reconciliation_state = 'reconciled'
       WHERE household_id = 'household-sunrise' AND id = 'subscription-stripe-test'`,
      [new Date(fixedTestNow.getTime() - 86_400_000).toISOString(), expiredAt.toISOString()],
    );
    await database.query(
      `INSERT INTO commerce_provider_subscription_records(
         id, household_id, subscription_id, provider, environment,
         external_subscription_id, raw_state, provider_version, observed_at, verified_at
       ) VALUES ('provider-expired-billing','household-sunrise','subscription-stripe-test',
                 'stripe','test','sub_expired_billing','active','2026-02-25.clover',$1,$1)`,
      [expiredAt.toISOString()],
    );
    await database.query(
      `INSERT INTO entitlement_grants(
         household_id, id, source, capabilities, starts_at, ends_at,
         source_verified, precedence, plan_version_id, subscription_id
       ) VALUES ('household-sunrise','grant-expired-billing','web',
                 '["check:text"]'::jsonb,$1,$2,true,300,'family_v1',
                 'subscription-stripe-test')`,
      [new Date(fixedTestNow.getTime() - 86_400_000).toISOString(), expiredAt.toISOString()],
    );
    await expect(
      runtime.stripeBillingStatus({
        actor,
        environment: 'test',
        runtimeInitiationPermitted: false,
        now: fixedTestNow,
      }),
    ).resolves.toMatchObject({
      checkoutState: 'eligible_disabled',
      canonicalAccessActive: false,
      runtimeInitiationEnabled: false,
    });
  });

  it('serializes checkout dispatch and journals a stale lease retry under the same key', async () => {
    const runtime = new CommerceRuntimeRepository(database, sequentialIds());
    const actor = await runtime.resolveActor({
      householdId: 'household-harbor',
      personId: 'person-owner-bob',
      now: fixedTestNow,
    });
    await runtime.changeStripeInitiationControl({
      environment: 'test',
      nextState: 'enabled',
      reasonCode: 'founder_test_activation',
      expectedRevision: 0,
      actorPersonId: 'person-hq-heidi',
      configuredFounderPersonId: 'person-hq-heidi',
      correlationId: 'stripe-stale-lease-control',
      now: fixedTestNow,
    });
    await runtime.changeStripeHouseholdEligibility({
      householdId: 'household-harbor',
      environment: 'test',
      nextState: 'eligible',
      actorPersonId: 'person-hq-heidi',
      configuredFounderPersonId: 'person-hq-heidi',
      correlationId: 'stripe-stale-lease-eligibility',
      now: fixedTestNow,
    });
    const prepared = await runtime.prepareStripeCheckout({
      actor,
      offerId: 'founding_family_monthly_v1',
      planVersionId: 'family_v1',
      billingInterval: 'month',
      providerPriceId: 'price_test_family_monthly',
      idempotencyKey: 'checkout-stale-lease-operation-0001',
      serverOperationId: 'checkout-stale-lease-operation-0001',
      providerIdempotencyKey: 'bb:test:checkout:stale-lease-0001',
      environment: 'test',
      now: fixedTestNow,
    });
    const dispatchInput = {
      householdId: 'household-harbor',
      checkoutIntentId: prepared.intentId,
      action: 'checkout' as const,
      environment: 'test' as const,
      serverOperationId: prepared.serverOperationId,
      providerIdempotencyKey: prepared.providerIdempotencyKey,
      actorPersonId: actor.personId,
      requestedExpiresAt: prepared.providerExpiresAt,
      canonicalSubscriptionId: prepared.subscriptionId,
      providerPriceId: 'price_test_family_monthly',
      successUrl: 'https://customer.boomerbuddy.test/member/billing/success',
      cancelUrl: 'https://customer.boomerbuddy.test/member/billing',
      now: fixedTestNow,
    };
    const concurrent = await Promise.all([
      runtime.beginStripeSessionOperation(dispatchInput),
      runtime.beginStripeSessionOperation(dispatchInput),
    ]);
    expect(concurrent.filter((decision) => decision.shouldDispatch)).toHaveLength(1);
    expect(concurrent.filter((decision) => !decision.shouldDispatch)).toHaveLength(1);

    const retryAt = new Date(fixedTestNow.getTime() + 2 * 60_000 + 1_000);
    const context = await runtime.stripeSessionRetryContext({
      householdId: 'household-harbor',
      environment: 'test',
      action: 'checkout',
      serverOperationId: prepared.serverOperationId,
      now: retryAt,
    });
    expect(context).toMatchObject({
      kind: 'ready',
      context: {
        action: 'checkout',
        providerIdempotencyKey: prepared.providerIdempotencyKey,
        checkoutIntentId: prepared.intentId,
      },
    });
    await expect(
      runtime.beginStripeSessionOperation({
        ...dispatchInput,
        allowDueRetry: true,
        now: retryAt,
      }),
    ).resolves.toMatchObject({ shouldDispatch: true, attempt: 2, state: 'dispatching' });
    const attempts = await database.query<
      {
        readonly attempt: number;
        readonly event_kind: string;
        readonly provider_idempotency_key: string;
      } & Record<string, unknown>
    >(
      `SELECT attempt, event_kind, provider_idempotency_key
       FROM commerce_stripe_session_operation_attempts
       WHERE operation_id = (
         SELECT id FROM commerce_stripe_session_operations
         WHERE server_operation_id = $1
       ) ORDER BY attempt,
         CASE event_kind
           WHEN 'dispatch_started' THEN 1
           WHEN 'outcome_unknown' THEN 2
           WHEN 'lease_expired' THEN 3
           WHEN 'succeeded' THEN 4
           ELSE 5
         END`,
      [prepared.serverOperationId],
    );
    expect(attempts.rows).toEqual([
      {
        attempt: 1,
        event_kind: 'dispatch_started',
        provider_idempotency_key: prepared.providerIdempotencyKey,
      },
      {
        attempt: 1,
        event_kind: 'lease_expired',
        provider_idempotency_key: prepared.providerIdempotencyKey,
      },
      {
        attempt: 2,
        event_kind: 'dispatch_started',
        provider_idempotency_key: prepared.providerIdempotencyKey,
      },
    ]);
    await expect(
      database.query(`UPDATE commerce_checkout_intents SET expires_at = $2 WHERE id = $1`, [
        prepared.intentId,
        new Date(retryAt.getTime() + 86_400_000).toISOString(),
      ]),
    ).rejects.toThrow('original expiry is immutable');
    await expect(
      database.query(
        `UPDATE commerce_stripe_session_operation_attempts
         SET error_code = 'tampered' WHERE operation_id = (
           SELECT id FROM commerce_stripe_session_operations
           WHERE server_operation_id = $1
         )`,
        [prepared.serverOperationId],
      ),
    ).rejects.toThrow('history is append-only');
  });

  it('applies newer verified state and supersedes an out-of-order event', async () => {
    await recordCompletedStripeCheckout(database, {
      suffix: 'provider-one',
      householdId: 'household-sunrise',
      subscriptionId: 'subscription-stripe-test',
      externalSubscriptionId: 'sub-provider-one',
      providerCustomerId: 'cus-provider-one',
    });
    const newerAt = new Date(fixedTestNow.getTime() + 60_000);
    const newer = await repository.captureVerifiedProviderEvent({
      provider: 'stripe',
      environment: 'test',
      externalEventId: 'evt-provider-newer',
      eventType: 'customer.subscription.updated',
      rawPayload: '{"id":"evt-provider-newer","status":"active"}',
      providerApiVersion: '2026-07-29.fixture',
      providerObjectId: 'sub-provider-one',
      providerEventCreatedAt: newerAt,
      normalizedLifecycle: 'active',
      now: newerAt,
    });
    await expect(
      repository.applyProviderLifecycle({
        inboxId: newer.id,
        provider: 'stripe',
        environment: 'test',
        externalEventId: 'evt-provider-newer',
        providerApiVersion: '2026-07-29.fixture',
        providerObjectId: 'sub-provider-one',
        providerEventCreatedAt: newerAt,
        householdId: 'household-sunrise',
        subscriptionId: 'subscription-stripe-test',
        externalSubscriptionId: 'sub-provider-one',
        lifecycle: 'active',
        currentPeriodStartsAt: fixedTestNow,
        currentPeriodEndsAt: new Date(fixedTestNow.getTime() + 86_400_000),
        accessEvidence: { kind: 'non_payment' },
        now: newerAt,
      }),
    ).resolves.toMatchObject({ outcome: 'applied', lifecycle: 'pending' });

    const older = await repository.captureVerifiedProviderEvent({
      provider: 'stripe',
      environment: 'test',
      externalEventId: 'evt-provider-older',
      eventType: 'customer.subscription.updated',
      rawPayload: '{"id":"evt-provider-older","status":"delinquent"}',
      providerApiVersion: '2026-07-29.fixture',
      providerObjectId: 'sub-provider-one',
      providerEventCreatedAt: fixedTestNow,
      normalizedLifecycle: 'delinquent',
      now: new Date(newerAt.getTime() + 1_000),
    });
    await expect(
      repository.applyProviderLifecycle({
        inboxId: older.id,
        provider: 'stripe',
        environment: 'test',
        externalEventId: 'evt-provider-older',
        providerApiVersion: '2026-07-29.fixture',
        providerObjectId: 'sub-provider-one',
        providerEventCreatedAt: fixedTestNow,
        householdId: 'household-sunrise',
        subscriptionId: 'subscription-stripe-test',
        externalSubscriptionId: 'sub-provider-one',
        lifecycle: 'delinquent',
        currentPeriodStartsAt: fixedTestNow,
        currentPeriodEndsAt: new Date(fixedTestNow.getTime() + 86_400_000),
        accessEvidence: { kind: 'non_payment' },
        now: new Date(newerAt.getTime() + 1_000),
      }),
    ).resolves.toMatchObject({ outcome: 'superseded' });
    const canonical = await database.query<
      { readonly lifecycle: string; readonly source_verified: boolean } & Record<string, unknown>
    >(
      `SELECT lifecycle, source_verified FROM commerce_subscriptions
       WHERE household_id = 'household-sunrise' AND id = 'subscription-stripe-test'`,
    );
    expect(canonical.rows[0]).toMatchObject({ lifecycle: 'pending', source_verified: false });
    const growthEvent = await database.query<{ id: string; payload: unknown }>(
      `SELECT id, payload FROM outbox_events
       WHERE event_type = 'commerce.lifecycle_applied.v1'
         AND aggregate_id = 'subscription-stripe-test'`,
    );
    expect(growthEvent.rows[0]?.payload).toEqual({
      lifecycle: 'pending',
      previousLifecycle: 'pending',
      providerEventKind: 'customer.subscription.updated',
    });
    const growth = new GrowthRuntimeRepository(database, sequentialIds());
    await growth.projectPending({ limit: 100, now: new Date(newerAt.getTime() + 1_000) });
    const growthFacts = await database.query<{ paid: number; converted: number }>(
      `SELECT
         (SELECT count(*)::int FROM acquisition_touchpoints
          WHERE subject_kind = 'household' AND subject_id = 'household-sunrise'
            AND milestone = 'paid') AS paid,
         (SELECT count(*)::int FROM lifecycle_workflows
          WHERE trigger_event_id = $1 AND state = 'completed') AS converted`,
      [growthEvent.rows[0]?.id],
    );
    expect(growthFacts.rows[0]).toEqual({ paid: 0, converted: 0 });
  });

  it('binds one Stripe customer to exactly one household', async () => {
    const endsAt = new Date(fixedTestNow.getTime() + 86_400_000);
    await recordCompletedStripeCheckout(database, {
      suffix: 'customer-sunrise',
      householdId: 'household-sunrise',
      subscriptionId: 'subscription-stripe-test',
      externalSubscriptionId: 'sub-customer-sunrise',
      providerCustomerId: 'cus-household-bound',
    });
    const first = await repository.captureVerifiedProviderEvent({
      provider: 'stripe',
      environment: 'test',
      externalEventId: 'evt-customer-sunrise',
      eventType: 'customer.subscription.updated',
      rawPayload: '{"id":"evt-customer-sunrise"}',
      providerApiVersion: '2026-07-29.fixture',
      providerObjectId: 'sub-customer-sunrise',
      providerEventCreatedAt: fixedTestNow,
      normalizedLifecycle: 'active',
      now: fixedTestNow,
    });
    await repository.applyProviderLifecycle({
      inboxId: first.id,
      provider: 'stripe',
      environment: 'test',
      externalEventId: 'evt-customer-sunrise',
      providerApiVersion: '2026-07-29.fixture',
      providerObjectId: 'sub-customer-sunrise',
      providerEventCreatedAt: fixedTestNow,
      householdId: 'household-sunrise',
      subscriptionId: 'subscription-stripe-test',
      externalSubscriptionId: 'sub-customer-sunrise',
      providerCustomerId: 'cus-household-bound',
      lifecycle: 'active',
      currentPeriodStartsAt: fixedTestNow,
      currentPeriodEndsAt: endsAt,
      accessEvidence: { kind: 'non_payment' },
      now: fixedTestNow,
    });
    await database.query(
      `INSERT INTO commerce_subscriptions(
         household_id, id, payer_person_id, plan_version_id, source, lifecycle,
         source_verified, precedence, current_period_starts_at, current_period_ends_at,
         reconciliation_state, created_at, updated_at
       ) VALUES (
         'household-harbor','subscription-stripe-harbor','person-owner-bob','family_v1','web',
         'pending',false,200,$1,$2,'pending',$1,$1
       )`,
      [fixedTestNow.toISOString(), endsAt.toISOString()],
    );
    await recordCompletedStripeCheckout(database, {
      suffix: 'customer-harbor',
      householdId: 'household-harbor',
      subscriptionId: 'subscription-stripe-harbor',
      externalSubscriptionId: 'sub-customer-harbor',
      providerCustomerId: 'cus-household-bound',
    });
    const foreign = await repository.captureVerifiedProviderEvent({
      provider: 'stripe',
      environment: 'test',
      externalEventId: 'evt-customer-harbor',
      eventType: 'customer.subscription.updated',
      rawPayload: '{"id":"evt-customer-harbor"}',
      providerApiVersion: '2026-07-29.fixture',
      providerObjectId: 'sub-customer-harbor',
      providerEventCreatedAt: new Date(fixedTestNow.getTime() + 1_000),
      normalizedLifecycle: 'active',
      now: new Date(fixedTestNow.getTime() + 1_000),
    });
    await expect(
      repository.applyProviderLifecycle({
        inboxId: foreign.id,
        provider: 'stripe',
        environment: 'test',
        externalEventId: 'evt-customer-harbor',
        providerApiVersion: '2026-07-29.fixture',
        providerObjectId: 'sub-customer-harbor',
        providerEventCreatedAt: new Date(fixedTestNow.getTime() + 1_000),
        householdId: 'household-harbor',
        subscriptionId: 'subscription-stripe-harbor',
        externalSubscriptionId: 'sub-customer-harbor',
        providerCustomerId: 'cus-household-bound',
        lifecycle: 'active',
        currentPeriodStartsAt: fixedTestNow,
        currentPeriodEndsAt: endsAt,
        accessEvidence: { kind: 'non_payment' },
        now: new Date(fixedTestNow.getTime() + 1_000),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('quarantines a paid-period gap before recording payment authority or closing dunning', async () => {
    const externalSubscriptionId = 'sub-period-gap-proof';
    const initialPeriodEnd = new Date(fixedTestNow.getTime() + 86_400_000);
    await recordCompletedStripeCheckout(database, {
      suffix: 'period-gap-proof',
      householdId: 'household-sunrise',
      subscriptionId: 'subscription-stripe-test',
      externalSubscriptionId,
      providerCustomerId: 'cus-period-gap-proof',
    });

    const captureInvoice = async (input: {
      readonly eventId: string;
      readonly eventType: 'invoice.paid' | 'invoice.payment_failed';
      readonly invoiceId: string;
      readonly at: Date;
      readonly lifecycle: 'active' | 'delinquent';
    }) =>
      repository.captureVerifiedProviderEvent({
        provider: 'stripe',
        environment: 'test',
        externalEventId: input.eventId,
        eventType: input.eventType,
        rawPayload: JSON.stringify({ id: input.eventId, invoice: input.invoiceId }),
        providerApiVersion: '2026-02-25.clover',
        providerObjectId: input.invoiceId,
        providerEventCreatedAt: input.at,
        normalizedLifecycle: input.lifecycle,
        now: input.at,
      });
    const paidEvidence = (input: {
      readonly inboxId: string;
      readonly invoiceId: string;
      readonly suffix: string;
      readonly startsAt: Date;
      readonly endsAt: Date;
      readonly paidAt: Date;
    }) =>
      ({
        kind: 'payment_confirmed',
        sourceInboxId: input.inboxId,
        evidence: {
          providerInvoiceId: input.invoiceId,
          externalSubscriptionId,
          providerSubscriptionItemId: 'si-period-gap-proof',
          providerInvoiceLineId: `il-${input.suffix}`,
          providerInvoicePaymentId: `inpay-${input.suffix}`,
          providerProductId: 'prod_test_family',
          providerPaymentIntentId: `pi-${input.suffix}`,
          providerPriceId: 'price_test_family_monthly',
          billingReason: 'subscription_cycle',
          amountPaid: 1499,
          amountRemaining: 0,
          currency: 'usd',
          quantity: 1,
          discountAmount: 0,
          taxAmount: 0,
          invoiceDiscountsEmpty: true,
          invoiceTaxesEmpty: true,
          invoiceCreditsEmpty: true,
          currentPeriodStartsAt: input.startsAt,
          currentPeriodEndsAt: input.endsAt,
          providerPaidAt: input.paidAt,
        },
      }) as const;

    const initialAt = new Date(fixedTestNow.getTime() + 60_000);
    const initial = await captureInvoice({
      eventId: 'evt-period-gap-initial-paid',
      eventType: 'invoice.paid',
      invoiceId: 'in-period-gap-initial-paid',
      at: initialAt,
      lifecycle: 'active',
    });
    await repository.applyProviderLifecycle({
      inboxId: initial.id,
      provider: 'stripe',
      environment: 'test',
      externalEventId: 'evt-period-gap-initial-paid',
      providerApiVersion: '2026-02-25.clover',
      providerObjectId: 'in-period-gap-initial-paid',
      providerEventCreatedAt: initialAt,
      householdId: 'household-sunrise',
      subscriptionId: 'subscription-stripe-test',
      externalSubscriptionId,
      providerCustomerId: 'cus-period-gap-proof',
      lifecycle: 'active',
      currentPeriodStartsAt: fixedTestNow,
      currentPeriodEndsAt: initialPeriodEnd,
      accessEvidence: paidEvidence({
        inboxId: initial.id,
        invoiceId: 'in-period-gap-initial-paid',
        suffix: 'period-gap-initial-paid',
        startsAt: fixedTestNow,
        endsAt: initialPeriodEnd,
        paidAt: initialAt,
      }),
      now: initialAt,
    });

    const conflictingReplayAt = new Date(fixedTestNow.getTime() + 90_000);
    const conflictingReplay = await repository.captureVerifiedProviderEvent({
      provider: 'stripe',
      environment: 'test',
      externalEventId: 'reconciliation:period-gap-proof:invoice-payment-conflict',
      eventType: 'subscription.reconciliation',
      rawPayload: JSON.stringify({
        subscription: externalSubscriptionId,
        sourceInvoice: 'in-period-gap-initial-paid',
      }),
      providerApiVersion: '2026-02-25.clover',
      providerObjectId: externalSubscriptionId,
      providerEventCreatedAt: conflictingReplayAt,
      normalizedLifecycle: 'active',
      now: conflictingReplayAt,
    });
    await expect(
      repository.applyProviderLifecycle({
        inboxId: conflictingReplay.id,
        provider: 'stripe',
        environment: 'test',
        externalEventId: 'reconciliation:period-gap-proof:invoice-payment-conflict',
        providerApiVersion: '2026-02-25.clover',
        providerObjectId: externalSubscriptionId,
        providerEventCreatedAt: conflictingReplayAt,
        householdId: 'household-sunrise',
        subscriptionId: 'subscription-stripe-test',
        externalSubscriptionId,
        providerCustomerId: 'cus-period-gap-proof',
        lifecycle: 'active',
        currentPeriodStartsAt: fixedTestNow,
        currentPeriodEndsAt: initialPeriodEnd,
        accessEvidence: {
          ...paidEvidence({
            inboxId: initial.id,
            invoiceId: 'in-period-gap-initial-paid',
            suffix: 'period-gap-initial-paid',
            startsAt: fixedTestNow,
            endsAt: initialPeriodEnd,
            paidAt: initialAt,
          }),
          evidence: {
            ...paidEvidence({
              inboxId: initial.id,
              invoiceId: 'in-period-gap-initial-paid',
              suffix: 'period-gap-initial-paid',
              startsAt: fixedTestNow,
              endsAt: initialPeriodEnd,
              paidAt: initialAt,
            }).evidence,
            providerInvoicePaymentId: 'inpay-period-gap-conflicting-replay',
          },
        },
        now: conflictingReplayAt,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const immutableInvoicePayment = await database.query<
      { readonly provider_invoice_payment_id: string } & Record<string, unknown>
    >(
      `SELECT provider_invoice_payment_id
       FROM commerce_stripe_paid_invoice_evidence
       WHERE provider_invoice_id = 'in-period-gap-initial-paid'`,
    );
    expect(immutableInvoicePayment.rows[0]?.provider_invoice_payment_id).toBe(
      'inpay-period-gap-initial-paid',
    );

    const failedAt = new Date(fixedTestNow.getTime() + 120_000);
    const failed = await captureInvoice({
      eventId: 'evt-period-gap-failed',
      eventType: 'invoice.payment_failed',
      invoiceId: 'in-period-gap-failed',
      at: failedAt,
      lifecycle: 'delinquent',
    });
    await repository.applyProviderLifecycle({
      inboxId: failed.id,
      provider: 'stripe',
      environment: 'test',
      externalEventId: 'evt-period-gap-failed',
      providerApiVersion: '2026-02-25.clover',
      providerObjectId: 'in-period-gap-failed',
      providerEventCreatedAt: failedAt,
      householdId: 'household-sunrise',
      subscriptionId: 'subscription-stripe-test',
      externalSubscriptionId,
      providerCustomerId: 'cus-period-gap-proof',
      lifecycle: 'delinquent',
      currentPeriodStartsAt: fixedTestNow,
      currentPeriodEndsAt: initialPeriodEnd,
      accessEvidence: {
        kind: 'payment_failed',
        sourceInboxId: failed.id,
        evidence: {
          providerInvoiceId: 'in-period-gap-failed',
          externalSubscriptionId,
          providerSubscriptionItemId: 'si-period-gap-proof',
          providerInvoiceLineId: 'il-period-gap-failed',
          providerInvoicePaymentId: 'inpay-period-gap-failed',
          providerProductId: 'prod_test_family',
          providerPriceId: 'price_test_family_monthly',
          providerPaymentIntentId: 'pi-period-gap-failed',
          billingReason: 'subscription_cycle',
          amountDue: 1499,
          currency: 'usd',
          quantity: 1,
          attemptCount: 1,
          failureStatus: 'requires_payment_method',
          lineProration: false,
          currentPeriodStartsAt: fixedTestNow,
          currentPeriodEndsAt: initialPeriodEnd,
        },
      },
      now: failedAt,
    });
    const failedReplayAt = new Date(fixedTestNow.getTime() + 150_000);
    const failedReplay = await repository.captureVerifiedProviderEvent({
      provider: 'stripe',
      environment: 'test',
      externalEventId: 'reconciliation:period-gap-proof:failed-invoice-payment-conflict',
      eventType: 'subscription.reconciliation',
      rawPayload: JSON.stringify({
        subscription: externalSubscriptionId,
        sourceInvoice: 'in-period-gap-failed',
      }),
      providerApiVersion: '2026-02-25.clover',
      providerObjectId: externalSubscriptionId,
      providerEventCreatedAt: failedReplayAt,
      normalizedLifecycle: 'delinquent',
      now: failedReplayAt,
    });
    await expect(
      repository.applyProviderLifecycle({
        inboxId: failedReplay.id,
        provider: 'stripe',
        environment: 'test',
        externalEventId: 'reconciliation:period-gap-proof:failed-invoice-payment-conflict',
        providerApiVersion: '2026-02-25.clover',
        providerObjectId: externalSubscriptionId,
        providerEventCreatedAt: failedReplayAt,
        householdId: 'household-sunrise',
        subscriptionId: 'subscription-stripe-test',
        externalSubscriptionId,
        providerCustomerId: 'cus-period-gap-proof',
        lifecycle: 'delinquent',
        currentPeriodStartsAt: fixedTestNow,
        currentPeriodEndsAt: initialPeriodEnd,
        accessEvidence: {
          kind: 'payment_failed',
          sourceInboxId: failed.id,
          evidence: {
            providerInvoiceId: 'in-period-gap-failed',
            externalSubscriptionId,
            providerSubscriptionItemId: 'si-period-gap-proof',
            providerInvoiceLineId: 'il-period-gap-failed',
            providerInvoicePaymentId: 'inpay-period-gap-failed-conflict',
            providerProductId: 'prod_test_family',
            providerPriceId: 'price_test_family_monthly',
            providerPaymentIntentId: 'pi-period-gap-failed',
            billingReason: 'subscription_cycle',
            amountDue: 1499,
            currency: 'usd',
            quantity: 1,
            attemptCount: 1,
            failureStatus: 'requires_payment_method',
            lineProration: false,
            currentPeriodStartsAt: fixedTestNow,
            currentPeriodEndsAt: initialPeriodEnd,
          },
        },
        now: failedReplayAt,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const immutableFailedInvoicePayment = await database.query<
      { readonly provider_invoice_payment_id: string } & Record<string, unknown>
    >(
      `SELECT provider_invoice_payment_id
       FROM commerce_stripe_failed_invoice_evidence
       WHERE provider_invoice_id = 'in-period-gap-failed'`,
    );
    expect(immutableFailedInvoicePayment.rows[0]?.provider_invoice_payment_id).toBe(
      'inpay-period-gap-failed',
    );
    const beforeGap = await database.query<
      {
        readonly active_grants: number;
        readonly current_period_ends_at: unknown;
        readonly lifecycle: string;
      } & Record<string, unknown>
    >(
      `SELECT subscription.lifecycle, subscription.current_period_ends_at,
              (SELECT count(*)::int FROM entitlement_grants grant_record
               WHERE grant_record.household_id = subscription.household_id
                 AND grant_record.subscription_id = subscription.id
                 AND grant_record.revoked_at IS NULL) AS active_grants
       FROM commerce_subscriptions subscription
       WHERE subscription.household_id = 'household-sunrise'
         AND subscription.id = 'subscription-stripe-test'`,
    );

    const gapAt = new Date(fixedTestNow.getTime() + 180_000);
    const gapStartsAt = new Date(initialPeriodEnd.getTime() + 86_400_000);
    const gapEndsAt = new Date(gapStartsAt.getTime() + 30 * 86_400_000);
    const gap = await captureInvoice({
      eventId: 'evt-period-gap-paid',
      eventType: 'invoice.paid',
      invoiceId: 'in-period-gap-paid',
      at: gapAt,
      lifecycle: 'active',
    });
    await expect(
      repository.applyProviderLifecycle({
        inboxId: gap.id,
        provider: 'stripe',
        environment: 'test',
        externalEventId: 'evt-period-gap-paid',
        providerApiVersion: '2026-02-25.clover',
        providerObjectId: 'in-period-gap-paid',
        providerEventCreatedAt: gapAt,
        householdId: 'household-sunrise',
        subscriptionId: 'subscription-stripe-test',
        externalSubscriptionId,
        providerCustomerId: 'cus-period-gap-proof',
        lifecycle: 'active',
        currentPeriodStartsAt: gapStartsAt,
        currentPeriodEndsAt: gapEndsAt,
        accessEvidence: paidEvidence({
          inboxId: gap.id,
          invoiceId: 'in-period-gap-paid',
          suffix: 'period-gap-paid',
          startsAt: gapStartsAt,
          endsAt: gapEndsAt,
          paidAt: gapAt,
        }),
        now: gapAt,
      }),
    ).resolves.toMatchObject({ outcome: 'quarantined' });

    const afterGap = await database.query<
      {
        readonly active_grants: number;
        readonly authority_facts: number;
        readonly current_period_ends_at: unknown;
        readonly gap_paid_proofs: number;
        readonly lifecycle: string;
        readonly opened_dunning: number;
        readonly recovered_dunning: number;
      } & Record<string, unknown>
    >(
      `SELECT subscription.lifecycle, subscription.current_period_ends_at,
              (SELECT count(*)::int FROM entitlement_grants grant_record
               WHERE grant_record.household_id = subscription.household_id
                 AND grant_record.subscription_id = subscription.id
                 AND grant_record.revoked_at IS NULL) AS active_grants,
              (SELECT count(*)::int FROM commerce_stripe_paid_invoice_evidence
               WHERE provider_invoice_id = 'in-period-gap-paid') AS gap_paid_proofs,
              (SELECT count(*)::int FROM commerce_stripe_invoice_authority_facts
               WHERE provider_invoice_id = 'in-period-gap-paid') AS authority_facts,
              (SELECT count(*)::int FROM commerce_stripe_dunning_events
               WHERE dunning_window_key = 'in-period-gap-failed'
                 AND event_kind = 'opened') AS opened_dunning,
              (SELECT count(*)::int FROM commerce_stripe_dunning_events
               WHERE dunning_window_key = 'in-period-gap-failed'
                 AND event_kind = 'recovered') AS recovered_dunning
       FROM commerce_subscriptions subscription
       WHERE subscription.household_id = 'household-sunrise'
         AND subscription.id = 'subscription-stripe-test'`,
    );
    expect(afterGap.rows[0]).toMatchObject({
      lifecycle: beforeGap.rows[0]?.lifecycle,
      current_period_ends_at: beforeGap.rows[0]?.current_period_ends_at,
      active_grants: beforeGap.rows[0]?.active_grants,
      gap_paid_proofs: 0,
      authority_facts: 0,
      opened_dunning: 1,
      recovered_dunning: 0,
    });
  });

  it('records complete, state-mismatched, and incomplete Stripe inventory snapshots', async () => {
    await recordCompletedStripeCheckout(database, {
      suffix: 'inventory',
      householdId: 'household-sunrise',
      subscriptionId: 'subscription-stripe-test',
      externalSubscriptionId: 'sub_inventory_test',
      providerCustomerId: 'cus_inventory_test',
    });
    const captured = await repository.captureVerifiedProviderEvent({
      provider: 'stripe',
      environment: 'test',
      externalEventId: 'evt-inventory-active',
      eventType: 'customer.subscription.updated',
      rawPayload: '{"id":"evt-inventory-active","status":"active"}',
      providerApiVersion: '2026-02-25.clover',
      providerObjectId: 'sub_inventory_test',
      providerEventCreatedAt: fixedTestNow,
      normalizedLifecycle: 'active',
      now: fixedTestNow,
    });
    await repository.applyProviderLifecycle({
      inboxId: captured.id,
      provider: 'stripe',
      environment: 'test',
      externalEventId: 'evt-inventory-active',
      providerApiVersion: '2026-02-25.clover',
      providerObjectId: 'sub_inventory_test',
      providerEventCreatedAt: fixedTestNow,
      householdId: 'household-sunrise',
      subscriptionId: 'subscription-stripe-test',
      externalSubscriptionId: 'sub_inventory_test',
      providerCustomerId: 'cus_inventory_test',
      lifecycle: 'active',
      currentPeriodStartsAt: fixedTestNow,
      currentPeriodEndsAt: new Date(fixedTestNow.getTime() + 86_400_000),
      accessEvidence: { kind: 'non_payment' },
      now: fixedTestNow,
    });
    const runtime = new CommerceRuntimeRepository(database, sequentialIds());
    await expect(
      runtime.reconcileStripeSubscriptionInventory({
        environment: 'test',
        providerSubscriptions: [
          { externalSubscriptionId: 'sub_inventory_test', lifecycle: 'trialing' },
        ],
        cursorComplete: true,
        now: fixedTestNow,
      }),
    ).resolves.toMatchObject({ state: 'attention', mismatchCount: 1 });
    await expect(
      runtime.reconcileStripeSubscriptionInventory({
        environment: 'test',
        providerSubscriptions: [
          { externalSubscriptionId: 'sub_inventory_test', lifecycle: 'active' },
        ],
        cursorComplete: false,
        now: new Date(fixedTestNow.getTime() + 1_000),
      }),
    ).resolves.toMatchObject({ state: 'attention', mismatchCount: 1 });
    await expect(
      runtime.reconcileStripeSubscriptionInventory({
        environment: 'test',
        providerSubscriptions: [
          { externalSubscriptionId: 'sub_inventory_test', lifecycle: 'active' },
        ],
        cursorComplete: true,
        now: new Date(fixedTestNow.getTime() + 2_000),
      }),
    ).resolves.toMatchObject({
      state: 'completed',
      providerCount: 1,
      canonicalCount: 1,
      mismatchCount: 0,
    });
  });

  it('does not project an unpaid trial and projects exact paid recovery evidence', async () => {
    await recordCompletedStripeCheckout(database, {
      suffix: 'growth-lifecycle',
      householdId: 'household-sunrise',
      subscriptionId: 'subscription-stripe-test',
      externalSubscriptionId: 'sub-growth-lifecycle',
      providerCustomerId: 'cus-growth-lifecycle',
    });
    const apply = async (input: {
      externalEventId: string;
      eventType: string;
      lifecycle: 'trialing' | 'delinquent' | 'active';
      at: Date;
      accessEvidence: 'non_payment' | 'payment';
      periodEndsAt: Date;
    }): Promise<void> => {
      const providerObjectId =
        input.eventType === 'invoice.paid'
          ? 'in_growth_recovery'
          : input.eventType === 'invoice.payment_failed'
            ? 'in_growth_failure'
            : 'sub-growth-lifecycle';
      const captured = await repository.captureVerifiedProviderEvent({
        provider: 'stripe',
        environment: 'test',
        externalEventId: input.externalEventId,
        eventType: input.eventType,
        rawPayload: JSON.stringify({ id: input.externalEventId, status: input.lifecycle }),
        providerApiVersion: '2026-07-29.fixture',
        providerObjectId,
        providerEventCreatedAt: input.at,
        normalizedLifecycle: input.lifecycle,
        now: input.at,
      });
      const accessEvidence =
        input.accessEvidence === 'payment'
          ? ({
              kind: 'payment_confirmed',
              sourceInboxId: captured.id,
              evidence: {
                providerInvoiceId: 'in_growth_recovery',
                externalSubscriptionId: 'sub-growth-lifecycle',
                providerSubscriptionItemId: 'si_growth_lifecycle',
                providerInvoiceLineId: 'il_growth_lifecycle',
                providerInvoicePaymentId: 'inpay_growth_lifecycle',
                providerProductId: 'prod_test_family',
                providerPaymentIntentId: 'pi_growth_recovery',
                providerPriceId: 'price_test_family_monthly',
                billingReason: 'subscription_create',
                amountPaid: 1499,
                amountRemaining: 0,
                currency: 'usd',
                quantity: 1,
                discountAmount: 0,
                taxAmount: 0,
                invoiceDiscountsEmpty: true,
                invoiceTaxesEmpty: true,
                invoiceCreditsEmpty: true,
                currentPeriodStartsAt: fixedTestNow,
                currentPeriodEndsAt: input.periodEndsAt,
                providerPaidAt: input.at,
              },
            } as const)
          : input.eventType === 'invoice.payment_failed'
            ? ({
                kind: 'payment_failed',
                sourceInboxId: captured.id,
                evidence: {
                  providerInvoiceId: 'in_growth_failure',
                  externalSubscriptionId: 'sub-growth-lifecycle',
                  providerSubscriptionItemId: 'si_growth_lifecycle',
                  providerInvoiceLineId: 'il_growth_failure',
                  providerInvoicePaymentId: 'inpay_growth_failure',
                  providerProductId: 'prod_test_family',
                  providerPriceId: 'price_test_family_monthly',
                  billingReason: 'subscription_cycle',
                  amountDue: 1499,
                  currency: 'usd',
                  quantity: 1,
                  attemptCount: 1,
                  failureStatus: 'requires_payment_method',
                  lineProration: false,
                  currentPeriodStartsAt: fixedTestNow,
                  currentPeriodEndsAt: input.periodEndsAt,
                },
              } as const)
            : ({ kind: 'non_payment' } as const);
      await repository.applyProviderLifecycle({
        inboxId: captured.id,
        provider: 'stripe',
        environment: 'test',
        externalEventId: input.externalEventId,
        providerApiVersion: '2026-07-29.fixture',
        providerObjectId,
        providerEventCreatedAt: input.at,
        householdId: 'household-sunrise',
        subscriptionId: 'subscription-stripe-test',
        externalSubscriptionId: 'sub-growth-lifecycle',
        lifecycle: input.lifecycle,
        currentPeriodStartsAt: fixedTestNow,
        currentPeriodEndsAt: input.periodEndsAt,
        accessEvidence,
        now: input.at,
      });
    };
    await apply({
      externalEventId: 'evt-growth-trial',
      eventType: 'customer.subscription.updated',
      lifecycle: 'trialing',
      at: new Date(fixedTestNow.getTime() + 60_000),
      accessEvidence: 'non_payment',
      periodEndsAt: new Date(fixedTestNow.getTime() + 7 * 86_400_000),
    });
    await apply({
      externalEventId: 'evt-growth-payment-failed',
      eventType: 'invoice.payment_failed',
      lifecycle: 'delinquent',
      at: new Date(fixedTestNow.getTime() + 120_000),
      accessEvidence: 'non_payment',
      periodEndsAt: new Date(fixedTestNow.getTime() + 7 * 86_400_000),
    });
    await apply({
      externalEventId: 'evt-growth-payment-recovered',
      eventType: 'invoice.paid',
      lifecycle: 'active',
      at: new Date(fixedTestNow.getTime() + 180_000),
      accessEvidence: 'payment',
      periodEndsAt: new Date(fixedTestNow.getTime() + 14 * 86_400_000),
    });

    const growth = new GrowthRuntimeRepository(database, sequentialIds());
    await growth.projectPending({
      limit: 100,
      now: new Date(fixedTestNow.getTime() + 180_000),
    });
    const facts = await database.query<{
      trial: number;
      paid: number;
      trial_workflow: number;
      failed_payment_workflow: number;
      recovery_workflow: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM acquisition_touchpoints
          WHERE subject_id = 'household-sunrise' AND milestone = 'trial') AS trial,
         (SELECT count(*)::int FROM acquisition_touchpoints
          WHERE subject_id = 'household-sunrise' AND milestone = 'paid') AS paid,
         (SELECT count(*)::int FROM lifecycle_workflows workflow
          JOIN lifecycle_steps step ON step.workflow_id = workflow.id
          WHERE workflow.workflow_kind = 'trial' AND workflow.state = 'active'
            AND step.action_kind = 'wait' AND step.state = 'ready') AS trial_workflow,
         (SELECT count(*)::int FROM lifecycle_workflows workflow
          JOIN lifecycle_steps step ON step.workflow_id = workflow.id
          WHERE workflow.workflow_kind = 'payment_recovery' AND workflow.state = 'active'
            AND step.step_key = 'payment_recovery' AND step.state = 'ready') AS failed_payment_workflow,
         (SELECT count(*)::int FROM lifecycle_workflows workflow
          JOIN lifecycle_steps step ON step.workflow_id = workflow.id
          WHERE workflow.workflow_kind = 'payment_recovery' AND workflow.state = 'completed'
            AND step.step_key = 'payment_recovery_recorded'
            AND step.state = 'completed') AS recovery_workflow`,
    );
    expect(facts.rows[0]).toEqual({
      trial: 0,
      paid: 1,
      trial_workflow: 0,
      failed_payment_workflow: 1,
      recovery_workflow: 1,
    });
  });
});

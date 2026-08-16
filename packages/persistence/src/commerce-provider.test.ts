import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSeededTestDatabase, fixedTestNow } from '@boomerbuddy/testkit';
import { CommerceOperationsRepository } from './commerce';
import type { Database } from './database';
import type { IdFactory } from './values';

function sequentialIds(): IdFactory {
  let counter = 0;
  return { next: (prefix) => `${prefix}-commerce-test-${++counter}` };
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

  it('applies newer verified state and supersedes an out-of-order event', async () => {
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
        accessEvidence: { kind: 'initial_server_binding' },
        now: newerAt,
      }),
    ).resolves.toMatchObject({ outcome: 'applied', lifecycle: 'active' });

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
    expect(canonical.rows[0]).toMatchObject({ lifecycle: 'active', source_verified: true });
  });

  it('binds one Stripe customer to exactly one household', async () => {
    const endsAt = new Date(fixedTestNow.getTime() + 86_400_000);
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
      accessEvidence: { kind: 'initial_server_binding' },
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
        accessEvidence: { kind: 'initial_server_binding' },
        now: new Date(fixedTestNow.getTime() + 1_000),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});

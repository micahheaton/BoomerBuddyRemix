import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSeededTestDatabase, fixedTestNow } from '@boomerbuddy/testkit';
import { CommerceOperationsRepository } from './commerce';
import type { Database } from './database';
import { GrowthRuntimeRepository } from './growth-runtime';
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
    const growthEvent = await database.query<{ id: string; payload: unknown }>(
      `SELECT id, payload FROM outbox_events
       WHERE event_type = 'commerce.lifecycle_applied.v1'
         AND aggregate_id = 'subscription-stripe-test'`,
    );
    expect(growthEvent.rows[0]?.payload).toEqual({
      lifecycle: 'active',
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
    expect(growthFacts.rows[0]).toEqual({ paid: 1, converted: 1 });
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

  it('projects verified trial, failed-payment, and recovery states without sending customer contact', async () => {
    const apply = async (input: {
      externalEventId: string;
      eventType: string;
      lifecycle: 'trialing' | 'delinquent' | 'active';
      at: Date;
      accessEvidence: 'initial' | 'non_payment' | 'payment';
      periodEndsAt: Date;
    }): Promise<void> => {
      const captured = await repository.captureVerifiedProviderEvent({
        provider: 'stripe',
        environment: 'test',
        externalEventId: input.externalEventId,
        eventType: input.eventType,
        rawPayload: JSON.stringify({ id: input.externalEventId, status: input.lifecycle }),
        providerApiVersion: '2026-07-29.fixture',
        providerObjectId: 'sub-growth-lifecycle',
        providerEventCreatedAt: input.at,
        normalizedLifecycle: input.lifecycle,
        now: input.at,
      });
      const accessEvidence =
        input.accessEvidence === 'initial'
          ? ({ kind: 'initial_server_binding' } as const)
          : input.accessEvidence === 'payment'
            ? ({ kind: 'payment_confirmed', sourceInboxId: captured.id } as const)
            : ({ kind: 'non_payment' } as const);
      await repository.applyProviderLifecycle({
        inboxId: captured.id,
        provider: 'stripe',
        environment: 'test',
        externalEventId: input.externalEventId,
        providerApiVersion: '2026-07-29.fixture',
        providerObjectId: 'sub-growth-lifecycle',
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
      accessEvidence: 'initial',
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
      trial: 1,
      paid: 1,
      trial_workflow: 1,
      failed_payment_workflow: 1,
      recovery_workflow: 1,
    });
  });
});

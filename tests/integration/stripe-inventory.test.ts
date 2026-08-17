import { createSeededTestDatabase, fixedTestNow } from '@boomerbuddy/testkit';
import {
  BusinessOsRepository,
  CommerceRuntimeRepository,
  DurableJobRepository,
  type Database,
  type DurableJob,
} from '@boomerbuddy/persistence';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStripeInventoryHandler,
  enqueueStripeInventory,
} from '../../apps/worker/src/stripe-inventory';

function inventoryJob(): DurableJob {
  return {
    id: 'job-stripe-inventory-fixture',
    type: 'commerce.stripe-inventory',
    version: 1,
    classification: 'internal',
    payload: {
      environment: 'test',
      accountId: 'acct_fixture1234',
      apiVersion: '2026-02-25.clover',
      evidenceTier: 'local_fixture',
      transportKind: 'injected_fixture',
      operationKey: 'stripe-inventory:test:fixture',
      periodStartedAt: fixedTestNow.toISOString(),
    },
    idempotencyKey: 'stripe-inventory:test:fixture',
    state: 'running',
    priority: 0,
    attempts: 1,
    maxAttempts: 8,
    nextAttemptAt: fixedTestNow,
    correlationId: 'stripe-inventory:test:fixture',
  };
}

describe('durable Stripe subscription inventory', () => {
  let database: Database;
  let jobs: DurableJobRepository;

  beforeEach(async () => {
    database = await createSeededTestDatabase();
    jobs = new DurableJobRepository(database);
  });

  afterEach(async () => database.close());

  it('persists every cursor receipt and completes only after has_more=false', async () => {
    await database.query(
      `INSERT INTO commerce_subscriptions(
         household_id, id, payer_person_id, plan_version_id, source, lifecycle,
         source_verified, precedence, current_period_starts_at, current_period_ends_at,
         reconciliation_state, created_at, updated_at
       ) VALUES
         ('household-sunrise','subscription-inventory-a','person-owner-alice','family_v1',
          'web','active',true,300,$1,$2,'reconciled',$1,$1),
         ('household-sunrise','subscription-inventory-b','person-owner-alice','family_v1',
          'web','canceled',true,300,$1,$2,'reconciled',$1,$1)`,
      [fixedTestNow.toISOString(), new Date(fixedTestNow.getTime() + 86_400_000).toISOString()],
    );
    await database.query(
      `INSERT INTO commerce_provider_subscription_records(
         id, household_id, subscription_id, provider, environment,
         external_subscription_id, raw_state, provider_version, observed_at, verified_at
       ) VALUES
         ('provider-inventory-a','household-sunrise','subscription-inventory-a','stripe','test',
          'sub_inventory_a','active','2026-02-25.clover',$1,$1),
         ('provider-inventory-b','household-sunrise','subscription-inventory-b','stripe','test',
          'sub_inventory_b','canceled','2026-02-25.clover',$1,$1)`,
      [fixedTestNow.toISOString()],
    );
    const pages = [
      {
        pageNumber: 1,
        nextCursor: 'sub_inventory_a',
        hasMore: true,
        subscriptions: [{ externalSubscriptionId: 'sub_inventory_a', lifecycle: 'active' }],
      },
      {
        pageNumber: 2,
        requestCursor: 'sub_inventory_a',
        hasMore: false,
        subscriptions: [{ externalSubscriptionId: 'sub_inventory_b', lifecycle: 'canceled' }],
      },
    ] as const;
    const handler = createStripeInventoryHandler({
      businessOs: new BusinessOsRepository(database),
      commerceRuntime: new CommerceRuntimeRepository(database),
      jobs,
      provider: {
        fetchSubscriptionInventory: vi.fn(async ({ onPage }) => {
          for (const page of pages) await onPage(page);
          return { verifiedAccountId: 'acct_fixture1234', pages };
        }),
      },
      runtimeRunId: 'fixture-inventory-runtime-1',
      clock: () => fixedTestNow,
    });
    await handler({
      job: inventoryJob(),
      idempotencyKey: inventoryJob().idempotencyKey,
      signal: new AbortController().signal,
      heartbeat: async () => true,
    });

    const run = await database.query<
      {
        readonly state: string;
        readonly account_id: string;
        readonly evidence_tier: string;
        readonly transport_kind: string;
        readonly provider_count: number;
        readonly page_count: number;
        readonly final_has_more: boolean;
      } & Record<string, unknown>
    >(
      `SELECT run.state, run.account_id, run.evidence_tier, run.transport_kind,
              run.provider_count,
              (SELECT count(*)::int FROM commerce_stripe_inventory_page_receipts page
               WHERE page.run_id = run.id) AS page_count,
              (SELECT has_more FROM commerce_stripe_inventory_page_receipts page
               WHERE page.run_id = run.id ORDER BY page.page_number DESC LIMIT 1)
                AS final_has_more
       FROM commerce_stripe_inventory_reconciliation_runs run
       ORDER BY run.started_at DESC LIMIT 1`,
    );
    expect(run.rows[0]).toEqual({
      state: 'completed',
      account_id: 'acct_fixture1234',
      evidence_tier: 'local_fixture',
      transport_kind: 'injected_fixture',
      provider_count: 2,
      page_count: 2,
      final_has_more: false,
    });
    const next = await database.query<
      { readonly state: string; readonly next_attempt_at: unknown } & Record<string, unknown>
    >(
      `SELECT state, next_attempt_at FROM durable_jobs
       WHERE job_type = 'commerce.stripe-inventory'`,
    );
    expect(next.rows).toHaveLength(1);
    expect(next.rows[0]?.state).toBe('queued');
    expect(new Date(String(next.rows[0]?.next_attempt_at)).toISOString()).toBe(
      new Date(fixedTestNow.getTime() + 24 * 60 * 60_000).toISOString(),
    );
  });

  it('marks a partial page set attention and never calls it completed', async () => {
    const handler = createStripeInventoryHandler({
      businessOs: new BusinessOsRepository(database),
      commerceRuntime: new CommerceRuntimeRepository(database),
      jobs,
      provider: {
        fetchSubscriptionInventory: vi.fn(async ({ onPage }) => {
          await onPage({
            pageNumber: 1,
            nextCursor: 'sub_partial',
            hasMore: true,
            subscriptions: [{ externalSubscriptionId: 'sub_partial', lifecycle: 'active' }],
          });
          throw new Error('fixture_partial_page_failure');
        }),
      },
      runtimeRunId: 'fixture-inventory-runtime-failure',
      clock: () => fixedTestNow,
    });
    await expect(
      handler({
        job: inventoryJob(),
        idempotencyKey: inventoryJob().idempotencyKey,
        signal: new AbortController().signal,
        heartbeat: async () => true,
      }),
    ).rejects.toThrow('stripe_inventory_partial_or_failed');
    const run = await database.query<
      {
        readonly state: string;
        readonly failure_code: string | null;
        readonly page_count: number;
        readonly attention_count: number;
      } & Record<string, unknown>
    >(
      `SELECT run.state, run.failure_code,
              (SELECT count(*)::int FROM commerce_stripe_inventory_page_receipts page
               WHERE page.run_id = run.id) AS page_count,
              (SELECT count(*)::int FROM owner_attention_items attention
               WHERE attention.source_id = run.id AND attention.state = 'open') AS attention_count
       FROM commerce_stripe_inventory_reconciliation_runs run
       ORDER BY run.started_at DESC LIMIT 1`,
    );
    expect(run.rows[0]).toEqual({
      state: 'attention',
      failure_code: 'stripe.inventory_partial_or_failed',
      page_count: 1,
      attention_count: 1,
    });
  });

  it('enqueues an explicit manual run through the same durable schedule surface', async () => {
    await enqueueStripeInventory({
      jobs,
      environment: 'test',
      accountId: 'acct_fixture1234',
      apiVersion: '2026-02-25.clover',
      evidenceTier: 'local_fixture',
      transportKind: 'injected_fixture',
      operationKey: 'stripe-inventory-manual:test:fixture-run',
      scheduledAt: fixedTestNow,
    });
    const queued = await database.query<
      { readonly job_type: string; readonly state: string; readonly payload: unknown } & Record<
        string,
        unknown
      >
    >(
      `SELECT job_type, state, payload FROM durable_jobs
       WHERE job_type = 'commerce.stripe-inventory'`,
    );
    expect(queued.rows).toHaveLength(1);
    expect(queued.rows[0]).toMatchObject({
      job_type: 'commerce.stripe-inventory',
      state: 'queued',
    });
  });
});

import type { StripeInventoryPort } from '@boomerbuddy/integrations';
import type {
  BusinessOsRepository,
  CommerceRuntimeRepository,
  DurableJobRepository,
} from '@boomerbuddy/persistence';
import { JobExecutionError, type JobHandler } from '@boomerbuddy/platform';

export const stripeInventoryJobType = 'commerce.stripe-inventory';
const inventoryIntervalMs = 24 * 60 * 60_000;

function inventoryPeriodStart(at: Date): Date {
  return new Date(Math.floor(at.getTime() / inventoryIntervalMs) * inventoryIntervalMs);
}

function inventoryScheduleKey(
  environment: 'test' | 'production',
  accountId: string,
  apiVersion: string,
  at: Date,
): string {
  return `stripe-inventory:${environment}:${accountId}:${apiVersion}:${Math.floor(at.getTime() / inventoryIntervalMs)}`;
}

export async function enqueueStripeInventory(input: {
  readonly jobs: DurableJobRepository;
  readonly environment: 'test' | 'production';
  readonly accountId: string;
  readonly apiVersion: string;
  readonly evidenceTier: 'local_fixture' | 'stripe_test' | 'deployed_staging' | 'live_production';
  readonly transportKind: 'injected_fixture' | 'stripe_https';
  readonly operationKey?: string;
  readonly scheduledAt: Date;
}): Promise<void> {
  const periodStartedAt =
    input.operationKey === undefined ? inventoryPeriodStart(input.scheduledAt) : input.scheduledAt;
  const key =
    input.operationKey ??
    inventoryScheduleKey(input.environment, input.accountId, input.apiVersion, periodStartedAt);
  await input.jobs.enqueue({
    type: stripeInventoryJobType,
    version: 1,
    classification: 'internal',
    payload: {
      environment: input.environment,
      accountId: input.accountId,
      apiVersion: input.apiVersion,
      evidenceTier: input.evidenceTier,
      transportKind: input.transportKind,
      operationKey: key,
      periodStartedAt: periodStartedAt.toISOString(),
    },
    idempotencyKey: key,
    scheduledAt: input.scheduledAt,
    maxAttempts: 8,
    correlationId: key,
  });
}

function text(payload: Readonly<Record<string, unknown>>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.trim() === '') throw new Error('invalid_inventory_job');
  return value;
}

export function createStripeInventoryHandler(input: {
  readonly businessOs: BusinessOsRepository;
  readonly commerceRuntime: CommerceRuntimeRepository;
  readonly jobs: DurableJobRepository;
  readonly provider: StripeInventoryPort;
  readonly runtimeRunId: string;
  readonly clock?: () => Date;
}): JobHandler {
  const clock = input.clock ?? (() => new Date());
  return async ({ job }) => {
    const environmentValue = text(job.payload, 'environment');
    if (environmentValue !== 'test' && environmentValue !== 'production') {
      throw new Error('invalid_inventory_job');
    }
    const environment = environmentValue;
    const accountId = text(job.payload, 'accountId');
    const apiVersion = text(job.payload, 'apiVersion');
    const evidenceTierValue = text(job.payload, 'evidenceTier');
    if (
      evidenceTierValue !== 'local_fixture' &&
      evidenceTierValue !== 'stripe_test' &&
      evidenceTierValue !== 'deployed_staging' &&
      evidenceTierValue !== 'live_production'
    ) {
      throw new Error('invalid_inventory_job');
    }
    const transportKindValue = text(job.payload, 'transportKind');
    if (
      (evidenceTierValue === 'local_fixture' && transportKindValue !== 'injected_fixture') ||
      (evidenceTierValue !== 'local_fixture' && transportKindValue !== 'stripe_https')
    ) {
      throw new Error('invalid_inventory_job');
    }
    const transportKind = transportKindValue as 'injected_fixture' | 'stripe_https';
    const operationKey = text(job.payload, 'operationKey');
    if (operationKey !== job.idempotencyKey) throw new Error('invalid_inventory_job');
    const periodStartedAt = new Date(text(job.payload, 'periodStartedAt'));
    if (!Number.isFinite(periodStartedAt.getTime())) throw new Error('invalid_inventory_job');
    const startedAt = clock();
    const run = await input.commerceRuntime.startStripeInventoryRun({
      environment,
      accountId,
      apiVersion,
      evidenceTier: evidenceTierValue,
      transportKind,
      operationKey,
      runtimeRunId: input.runtimeRunId,
      now: startedAt,
    });
    const runId = run.runId;
    await enqueueStripeInventory({
      jobs: input.jobs,
      environment,
      accountId,
      apiVersion,
      evidenceTier: evidenceTierValue,
      transportKind,
      scheduledAt: new Date(periodStartedAt.getTime() + inventoryIntervalMs),
    });
    if (run.alreadyCompleted) return;
    const subscriptions: Array<{
      readonly externalSubscriptionId: string;
      readonly lifecycle: string;
    }> = [];
    try {
      const inventory = await input.provider.fetchSubscriptionInventory({
        environment,
        onPage: async (page) => {
          subscriptions.push(...page.subscriptions);
          await input.commerceRuntime.recordStripeInventoryPage({
            runId,
            environment,
            accountId,
            ...page,
            now: clock(),
          });
        },
      });
      if (inventory.verifiedAccountId !== accountId) {
        throw new Error('stripe_inventory_account_mismatch');
      }
      const cursorComplete =
        inventory.pages.length > 0 && inventory.pages.at(-1)?.hasMore === false;
      const reconciliation = await input.commerceRuntime.reconcileStripeSubscriptionInventory({
        runId,
        environment,
        providerSubscriptions: subscriptions,
        cursorComplete,
        accountId,
        verifiedAccountId: inventory.verifiedAccountId,
        apiVersion,
        evidenceTier: evidenceTierValue,
        transportKind,
        runtimeRunId: input.runtimeRunId,
        now: clock(),
      });
      if (reconciliation.state === 'attention') {
        await input.businessOs.upsertOwnerAttention({
          attentionKind: 'billing_reconciliation',
          consequenceOfInaction:
            'The complete Stripe inventory differs from canonical subscription state.',
          dedupeKey: `stripe_inventory_${runId}`,
          now: clock(),
          recommendedAction: `Review ${String(reconciliation.mismatchCount)} persisted inventory mismatch receipt(s).`,
          sourceId: runId,
          sourceType: 'commerce_inventory',
          whyFounderRequired: 'Complete provider truth requires a human reconciliation decision.',
        });
      }
    } catch (error) {
      await input.commerceRuntime.markStripeInventoryAttention({
        runId,
        environment,
        failureCode: 'stripe.inventory_partial_or_failed',
        now: clock(),
      });
      await input.businessOs.upsertOwnerAttention({
        attentionKind: 'billing_reconciliation',
        consequenceOfInaction: 'Provider inventory remains incomplete and cannot be called clean.',
        dedupeKey: `stripe_inventory_${runId}`,
        now: clock(),
        recommendedAction: 'Review the page receipts and rerun the complete Stripe inventory.',
        sourceId: runId,
        sourceType: 'commerce_inventory',
        whyFounderRequired: 'The complete provider page-set was not observed.',
      });
      throw new JobExecutionError(
        error instanceof Error && error.message === 'stripe_inventory_account_mismatch'
          ? 'stripe_inventory_account_mismatch'
          : 'stripe_inventory_partial_or_failed',
        true,
      );
    }
  };
}

import type { AutomationBudgetRepository, DurableJobRepository } from '@boomerbuddy/persistence';
import type { JobHandler } from '@boomerbuddy/platform';

export const automationBudgetMaintenanceJobType = 'automation-budget.maintain';
export const automationBudgetMaintenanceIntervalMs = 5 * 60_000;

export function automationBudgetMaintenanceIntervalKey(at: Date): string {
  if (!Number.isFinite(at.getTime())) throw new TypeError('Budget maintenance time is invalid');
  return `${automationBudgetMaintenanceJobType}:interval:${Math.floor(
    at.getTime() / automationBudgetMaintenanceIntervalMs,
  )}`;
}

function boundedBatch(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? Math.max(1, Math.min(value, 100))
    : 25;
}

export async function enqueueAutomationBudgetMaintenance(input: {
  readonly batch?: number;
  readonly jobs: Pick<DurableJobRepository, 'enqueue'>;
  readonly now: Date;
}): Promise<void> {
  const idempotencyKey = automationBudgetMaintenanceIntervalKey(input.now);
  await input.jobs.enqueue({
    type: automationBudgetMaintenanceJobType,
    payload: { batch: boundedBatch(input.batch) },
    idempotencyKey,
    scheduledAt: input.now,
    maxAttempts: 8,
    correlationId: idempotencyKey,
  });
}

export function createAutomationBudgetMaintenanceHandler(input: {
  readonly budgets: Pick<
    AutomationBudgetRepository,
    'recoverAcceptedExternalActions' | 'releaseExpired'
  >;
  readonly clock?: () => Date;
  readonly jobs: Pick<DurableJobRepository, 'enqueue'>;
}): JobHandler {
  const clock = input.clock ?? (() => new Date());
  return async ({ heartbeat, job }) => {
    const batch = boundedBatch(job.payload.batch);
    const observedAt = clock();
    const recovered = await input.budgets.recoverAcceptedExternalActions({
      context: {
        correlationId: `${automationBudgetMaintenanceJobType}:recover:${job.id}`,
        now: observedAt,
      },
      limit: batch,
    });
    const released = await input.budgets.releaseExpired({
      context: {
        correlationId: `${automationBudgetMaintenanceJobType}:release:${job.id}`,
        now: observedAt,
      },
      limit: batch,
    });
    await heartbeat();
    const workWasBounded = recovered === batch || released === batch;
    const scheduledAt = new Date(
      observedAt.getTime() + (workWasBounded ? 1_000 : automationBudgetMaintenanceIntervalMs),
    );
    const idempotencyKey = workWasBounded
      ? `${automationBudgetMaintenanceJobType}:continue:${job.id}`
      : automationBudgetMaintenanceIntervalKey(scheduledAt);
    await input.jobs.enqueue({
      type: automationBudgetMaintenanceJobType,
      payload: { batch },
      idempotencyKey,
      scheduledAt,
      maxAttempts: 8,
      correlationId: idempotencyKey,
    });
  };
}

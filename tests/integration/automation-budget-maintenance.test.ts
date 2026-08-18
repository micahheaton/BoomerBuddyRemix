import { describe, expect, it, vi } from 'vitest';

import {
  automationBudgetMaintenanceIntervalKey,
  automationBudgetMaintenanceIntervalMs,
  automationBudgetMaintenanceJobType,
  createAutomationBudgetMaintenanceHandler,
  enqueueAutomationBudgetMaintenance,
} from '../../apps/worker/src/automation-budget-maintenance';

const now = new Date('2026-08-16T12:34:56.000Z');

describe('automation budget maintenance job', () => {
  it('uses one deterministic bounded interval key', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    await enqueueAutomationBudgetMaintenance({ batch: 10_000, jobs: { enqueue }, now });
    await enqueueAutomationBudgetMaintenance({ batch: 10_000, jobs: { enqueue }, now });

    expect(automationBudgetMaintenanceIntervalKey(now)).toBe(
      `${automationBudgetMaintenanceJobType}:interval:${Math.floor(
        now.getTime() / automationBudgetMaintenanceIntervalMs,
      )}`,
    );
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({
      idempotencyKey: automationBudgetMaintenanceIntervalKey(now),
      payload: { batch: 100 },
      type: automationBudgetMaintenanceJobType,
    });
    expect(enqueue.mock.calls[1]?.[0]).toEqual(enqueue.mock.calls[0]?.[0]);
  });

  it('runs bounded recovery and expiry release before scheduling one continuation', async () => {
    const recoverAcceptedExternalActions = vi.fn().mockResolvedValue(25);
    const releaseExpired = vi.fn().mockResolvedValue(3);
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const heartbeat = vi.fn().mockResolvedValue(true);
    const handler = createAutomationBudgetMaintenanceHandler({
      budgets: { recoverAcceptedExternalActions, releaseExpired },
      clock: () => now,
      jobs: { enqueue },
    });

    await handler({
      heartbeat,
      idempotencyKey: 'maintenance-current',
      job: {
        attempts: 1,
        classification: 'internal',
        correlationId: 'maintenance-current',
        id: 'job-maintenance-current',
        idempotencyKey: 'maintenance-current',
        maxAttempts: 8,
        nextAttemptAt: now,
        payload: { batch: 25 },
        priority: 0,
        state: 'running',
        type: automationBudgetMaintenanceJobType,
        version: 1,
      },
      signal: new AbortController().signal,
    });

    expect(recoverAcceptedExternalActions).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25 }),
    );
    expect(releaseExpired).toHaveBeenCalledWith(expect.objectContaining({ limit: 25 }));
    expect(heartbeat).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'automation-budget.maintain:continue:job-maintenance-current',
        scheduledAt: new Date(now.getTime() + 1_000),
      }),
    );
  });
});

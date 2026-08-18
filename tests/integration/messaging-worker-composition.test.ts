import type { DurableJob } from '@boomerbuddy/persistence';
import type { JobExecutionError } from '@boomerbuddy/platform';
import { describe, expect, it, vi } from 'vitest';

import {
  composeProviderFreeMessagingWorker,
  messagingLocalSimulationJobType,
} from '../../apps/worker/src/messaging-composition';

const now = new Date('2026-08-17T19:00:00.000Z');

function job(payload: DurableJob['payload']): DurableJob {
  return {
    id: 'messaging-job-fixture-001',
    type: messagingLocalSimulationJobType,
    version: 1,
    classification: 'internal',
    payload,
    idempotencyKey: 'messaging-job-idempotency-001',
    state: 'running',
    priority: 0,
    attempts: 1,
    maxAttempts: 1,
    nextAttemptAt: now,
    correlationId: 'messaging-job-correlation-001',
  };
}

describe('provider-free messaging worker composition', () => {
  it('does not install any messaging handler in production', () => {
    const dispatchLocalSimulation = vi.fn();
    const composition = composeProviderFreeMessagingWorker({
      environment: 'production',
      messaging: { dispatchLocalSimulation },
      clock: () => now,
    });
    expect(composition).toEqual({ handlers: {}, installed: false });
    expect(dispatchLocalSimulation).not.toHaveBeenCalled();
  });

  it('dispatches only an exact content-free local job in a non-production runtime', async () => {
    const dispatchLocalSimulation = vi.fn().mockResolvedValue({
      intentId: 'messaging-intent-fixture-001',
      state: 'local_simulated',
      evidenceTier: 'local_simulation',
      providerNetworkPermitted: false,
    });
    const heartbeat = vi.fn().mockResolvedValue(true);
    const composition = composeProviderFreeMessagingWorker({
      environment: 'test',
      messaging: { dispatchLocalSimulation },
      clock: () => now,
    });
    expect(composition.installed).toBe(true);
    const handler = composition.handlers[messagingLocalSimulationJobType];
    expect(handler).toBeDefined();
    await handler!({
      job: job({ intentId: 'messaging-intent-fixture-001', localOnly: true }),
      idempotencyKey: 'messaging-job-idempotency-001',
      signal: new AbortController().signal,
      heartbeat,
    });
    expect(dispatchLocalSimulation).toHaveBeenCalledWith({
      intentId: 'messaging-intent-fixture-001',
      jobId: 'messaging-job-fixture-001',
      now,
    });
    expect(heartbeat).toHaveBeenCalledOnce();
  });

  it.each([
    { intentId: 'messaging-intent-fixture-001' },
    { intentId: 'messaging-intent-fixture-001', localOnly: false },
    { intentId: 'messaging-intent-fixture-001', localOnly: true, provider: 'twilio' },
    { intentId: 'messaging-intent-fixture-001', localOnly: true, message: 'content' },
    { intentId: 'messaging-intent-fixture-001', localOnly: true, url: 'https://example.test' },
  ])('rejects hostile or provider-shaped payload $o', async (payload) => {
    const dispatchLocalSimulation = vi.fn();
    const composition = composeProviderFreeMessagingWorker({
      environment: 'development',
      messaging: { dispatchLocalSimulation },
      clock: () => now,
    });
    await expect(
      composition.handlers[messagingLocalSimulationJobType]!({
        job: job(payload),
        idempotencyKey: 'messaging-job-idempotency-001',
        signal: new AbortController().signal,
        heartbeat: vi.fn().mockResolvedValue(true),
      }),
    ).rejects.toEqual(
      expect.objectContaining<JobExecutionError>({
        name: 'JobExecutionError',
        message: expect.any(String),
        code: 'messaging_local_payload_invalid',
        retryable: false,
      }),
    );
    expect(dispatchLocalSimulation).not.toHaveBeenCalled();
  });
});

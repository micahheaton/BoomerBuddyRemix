import { describe, expect, it } from 'vitest';
import { boundedRetryDelay, loadWorkerRuntimeConfig } from './index';

describe('portable worker policy', () => {
  it('applies bounded exponential backoff with jitter', () => {
    expect(
      boundedRetryDelay({ attempt: 1, baseMs: 1_000, maximumMs: 30_000, random: () => 0 }),
    ).toBe(1_000);
    expect(
      boundedRetryDelay({ attempt: 5, baseMs: 1_000, maximumMs: 10_000, random: () => 1 }),
    ).toBe(10_000);
    expect(
      boundedRetryDelay({ attempt: 50, baseMs: 1_000, maximumMs: 10_000, random: () => 1 }),
    ).toBe(10_000);
  });

  it('requires a stable worker identity and heartbeat shorter than half the lease', () => {
    expect(
      loadWorkerRuntimeConfig({
        BB_WORKER_ID: 'worker-test-1',
        BB_WORKER_LEASE_MS: '30000',
        BB_WORKER_HEARTBEAT_MS: '10000',
      }),
    ).toMatchObject({ workerId: 'worker-test-1', leaseDurationMs: 30_000 });
    expect(() =>
      loadWorkerRuntimeConfig({
        BB_WORKER_ID: 'worker-test-1',
        BB_WORKER_LEASE_MS: '10000',
        BB_WORKER_HEARTBEAT_MS: '5000',
      }),
    ).toThrowError('less than half');
  });
});

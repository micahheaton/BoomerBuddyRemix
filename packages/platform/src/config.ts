export interface WorkerRuntimeConfig {
  readonly workerId: string;
  readonly pollIntervalMs: number;
  readonly leaseDurationMs: number;
  readonly heartbeatIntervalMs: number;
  readonly shutdownTimeoutMs: number;
  readonly batchSize: number;
  readonly retryBaseMs: number;
  readonly retryMaxMs: number;
}

function integer(
  environment: NodeJS.ProcessEnv,
  key: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const text = environment[key];
  const value = text === undefined ? defaultValue : Number(text);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function loadWorkerRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WorkerRuntimeConfig {
  const workerId = environment.BB_WORKER_ID?.trim();
  if (workerId === undefined || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{1,199}$/u.test(workerId)) {
    throw new TypeError('BB_WORKER_ID must be a stable, content-free worker identifier');
  }
  const leaseDurationMs = integer(environment, 'BB_WORKER_LEASE_MS', 30_000, 5_000, 900_000);
  const heartbeatIntervalMs = integer(
    environment,
    'BB_WORKER_HEARTBEAT_MS',
    10_000,
    1_000,
    300_000,
  );
  if (heartbeatIntervalMs * 2 >= leaseDurationMs) {
    throw new TypeError('Worker heartbeat interval must be less than half of the lease duration');
  }
  return {
    workerId,
    pollIntervalMs: integer(environment, 'BB_WORKER_POLL_MS', 1_000, 50, 60_000),
    leaseDurationMs,
    heartbeatIntervalMs,
    shutdownTimeoutMs: integer(environment, 'BB_WORKER_SHUTDOWN_MS', 20_000, 1_000, 120_000),
    batchSize: integer(environment, 'BB_WORKER_BATCH_SIZE', 10, 1, 100),
    retryBaseMs: integer(environment, 'BB_WORKER_RETRY_BASE_MS', 1_000, 100, 60_000),
    retryMaxMs: integer(environment, 'BB_WORKER_RETRY_MAX_MS', 300_000, 1_000, 3_600_000),
  };
}

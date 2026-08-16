export interface RetentionSchedule {
  readonly idempotencyKey: string;
  readonly scheduledAt: Date;
}

export function retentionIntervalKey(date: Date, intervalMs: number): string {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1 || !Number.isFinite(date.getTime())) {
    throw new TypeError('Retention interval is invalid');
  }
  return `retention.sweep:interval:${Math.floor(date.getTime() / intervalMs)}`;
}

export function nextRetentionSchedule(input: {
  readonly currentJobId: string;
  readonly intervalMs: number;
  readonly now: Date;
  readonly workWasFound: boolean;
}): RetentionSchedule {
  if (input.currentJobId.trim() === '') throw new TypeError('Retention job identifier is required');
  const scheduledAt = new Date(
    input.now.getTime() + (input.workWasFound ? 1_000 : input.intervalMs),
  );
  return {
    scheduledAt,
    idempotencyKey: input.workWasFound
      ? `retention.sweep:continue:${input.currentJobId}`
      : retentionIntervalKey(scheduledAt, input.intervalMs),
  };
}

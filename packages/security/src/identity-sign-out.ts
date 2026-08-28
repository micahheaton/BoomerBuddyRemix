export const identitySignOutTimeoutMs = 2_000;

export type IdentitySignOutOutcome = 'cleared' | 'cleanup_failed' | 'cleanup_timed_out';

export async function settleIdentitySignOut(input: {
  readonly clearIdentitySession: () => Promise<void>;
  readonly timeoutMs?: number;
}): Promise<IdentitySignOutOutcome> {
  const timeoutMs =
    input.timeoutMs !== undefined && Number.isFinite(input.timeoutMs) && input.timeoutMs >= 0
      ? input.timeoutMs
      : identitySignOutTimeoutMs;
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  const cleanup = Promise.resolve()
    .then(input.clearIdentitySession)
    .then<IdentitySignOutOutcome, IdentitySignOutOutcome>(
      () => 'cleared',
      () => 'cleanup_failed',
    );
  const deadline = new Promise<IdentitySignOutOutcome>((resolve) => {
    timeout = globalThis.setTimeout(() => resolve('cleanup_timed_out'), timeoutMs);
  });
  try {
    return await Promise.race([cleanup, deadline]);
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout);
  }
}

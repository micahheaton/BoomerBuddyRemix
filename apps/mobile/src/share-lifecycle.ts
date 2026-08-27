import type { CheckShareLifecycle } from '@boomerbuddy/contracts';

export function canCloseSharedResult(
  lifecycle: Pick<CheckShareLifecycle, 'state'> | undefined,
): boolean {
  return lifecycle?.state === 'acknowledged';
}

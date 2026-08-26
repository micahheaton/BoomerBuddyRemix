export interface HistoryContinuation {
  readonly householdId: string;
  readonly householdGeneration: number;
  readonly requestId: number;
  readonly offset: number;
}

export interface HistoryContinuationContext {
  readonly householdId: string;
  readonly householdGeneration: number;
  readonly requestId: number;
}

export function historyContinuationIsCurrent(
  continuation: HistoryContinuation,
  context: HistoryContinuationContext,
): boolean {
  return (
    continuation.householdId === context.householdId &&
    continuation.householdGeneration === context.householdGeneration &&
    continuation.requestId === context.requestId
  );
}

export function mergeHistoryContinuation<T extends { readonly id: string }>(
  current: T[],
  incoming: readonly T[],
  responseOffset: number,
  continuation: HistoryContinuation,
  context: HistoryContinuationContext,
): T[] {
  if (
    responseOffset !== continuation.offset ||
    !historyContinuationIsCurrent(continuation, context)
  ) {
    return current;
  }
  const byId = new Map(current.map((record) => [record.id, record]));
  for (const record of incoming) byId.set(record.id, record);
  return [...byId.values()];
}

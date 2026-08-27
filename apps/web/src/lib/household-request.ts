export interface HouseholdRequestIdentity {
  readonly householdId: string;
  readonly generation: number;
}

export interface HouseholdBoundValue<T> {
  readonly householdId: string;
  readonly value: T;
}

export function householdRequestIsCurrent(
  attempt: HouseholdRequestIdentity,
  current: HouseholdRequestIdentity,
): boolean {
  return attempt.householdId === current.householdId && attempt.generation === current.generation;
}

export function householdBoundValue<T>(
  state: HouseholdBoundValue<T> | undefined,
  selectedHouseholdId: string,
): T | undefined {
  return state?.householdId === selectedHouseholdId ? state.value : undefined;
}

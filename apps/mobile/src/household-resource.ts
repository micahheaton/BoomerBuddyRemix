export type HouseholdResourceState<T> =
  | { readonly status: 'idle' }
  | {
      readonly status: 'loading';
      readonly householdId: string;
      readonly requestId: number;
    }
  | {
      readonly status: 'ready';
      readonly householdId: string;
      readonly requestId: number;
      readonly value: T;
    }
  | {
      readonly status: 'error';
      readonly householdId: string;
      readonly requestId: number;
      readonly message: string;
    };

export interface HouseholdBoundDraft<T> {
  readonly householdId: string;
  readonly value: T;
}

export type HouseholdResourceAction<T> =
  | { readonly type: 'reset' }
  | { readonly type: 'started'; readonly householdId: string; readonly requestId: number }
  | {
      readonly type: 'succeeded';
      readonly householdId: string;
      readonly requestId: number;
      readonly value: T;
    }
  | {
      readonly type: 'failed';
      readonly householdId: string;
      readonly requestId: number;
      readonly message: string;
    };

export function emptyHouseholdResource<T>(): HouseholdResourceState<T> {
  return { status: 'idle' };
}

export function householdResourceReducer<T>(
  state: HouseholdResourceState<T>,
  action: HouseholdResourceAction<T>,
): HouseholdResourceState<T> {
  if (action.type === 'reset') return emptyHouseholdResource<T>();
  if (action.type === 'started') {
    return {
      status: 'loading',
      householdId: action.householdId,
      requestId: action.requestId,
    };
  }
  if (
    state.status !== 'loading' ||
    state.householdId !== action.householdId ||
    state.requestId !== action.requestId
  ) {
    return state;
  }
  return action.type === 'succeeded'
    ? {
        status: 'ready',
        householdId: action.householdId,
        requestId: action.requestId,
        value: action.value,
      }
    : {
        status: 'error',
        householdId: action.householdId,
        requestId: action.requestId,
        message: action.message,
      };
}

export function householdResourceIsVisible<T>(
  state: HouseholdResourceState<T>,
  selectedHouseholdId: string,
): boolean {
  return state.status !== 'idle' && state.householdId === selectedHouseholdId;
}

export function householdBoundDraftValue<T>(
  draft: HouseholdBoundDraft<T> | undefined,
  selectedHouseholdId: string,
): T | undefined {
  return draft?.householdId === selectedHouseholdId ? draft.value : undefined;
}

import { describe, expect, it } from 'vitest';
import {
  emptyHouseholdResource,
  householdBoundDraftValue,
  householdResourceIsVisible,
  householdResourceReducer,
  type HouseholdResourceAction,
  type HouseholdResourceState,
} from '../../apps/mobile/src/household-resource';
import {
  emptyInvitationReview,
  invitationAcceptanceBinding,
  invitationReviewReducer,
  type InvitationReviewAction,
  type InvitationReviewState,
} from '../../apps/mobile/src/invitation-review';

type FamilyView = { readonly householdName: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('mobile Family household binding', () => {
  it('suppresses a delayed household A response after household B has loaded', async () => {
    let state: HouseholdResourceState<FamilyView> = emptyHouseholdResource();
    const dispatch = (action: HouseholdResourceAction<FamilyView>): void => {
      state = householdResourceReducer(state, action);
    };
    const householdA = deferred<FamilyView>();
    const householdB = deferred<FamilyView>();
    const load = async (
      householdId: string,
      requestId: number,
      response: Promise<FamilyView>,
    ): Promise<void> => {
      dispatch({ type: 'started', householdId, requestId });
      try {
        dispatch({ type: 'succeeded', householdId, requestId, value: await response });
      } catch {
        dispatch({ type: 'failed', householdId, requestId, message: 'load failed' });
      }
    };

    const loadingA = load('household-a', 1, householdA.promise);
    const loadingB = load('household-b', 2, householdB.promise);
    householdB.resolve({ householdName: 'Household B' });
    await loadingB;
    expect(state).toMatchObject({
      status: 'ready',
      householdId: 'household-b',
      value: { householdName: 'Household B' },
    });
    expect(householdResourceIsVisible(state, 'household-a')).toBe(false);
    expect(householdResourceIsVisible(state, 'household-b')).toBe(true);

    householdA.resolve({ householdName: 'Household A private data' });
    await loadingA;
    expect(state).toMatchObject({
      status: 'ready',
      householdId: 'household-b',
      value: { householdName: 'Household B' },
    });
  });

  it('shows a retryable current-household failure and ignores obsolete failures', async () => {
    let state: HouseholdResourceState<FamilyView> = emptyHouseholdResource();
    const dispatch = (action: HouseholdResourceAction<FamilyView>): void => {
      state = householdResourceReducer(state, action);
    };

    dispatch({ type: 'started', householdId: 'household-a', requestId: 1 });
    dispatch({ type: 'started', householdId: 'household-b', requestId: 2 });
    dispatch({
      type: 'failed',
      householdId: 'household-a',
      requestId: 1,
      message: 'obsolete household A failure',
    });
    expect(state).toMatchObject({
      status: 'loading',
      householdId: 'household-b',
      requestId: 2,
    });

    dispatch({
      type: 'failed',
      householdId: 'household-b',
      requestId: 2,
      message: 'Please try again.',
    });
    expect(state).toEqual({
      status: 'error',
      householdId: 'household-b',
      requestId: 2,
      message: 'Please try again.',
    });

    dispatch({ type: 'started', householdId: 'household-b', requestId: 3 });
    dispatch({
      type: 'succeeded',
      householdId: 'household-b',
      requestId: 3,
      value: { householdName: 'Household B recovered' },
    });
    expect(state).toEqual({
      status: 'ready',
      householdId: 'household-b',
      requestId: 3,
      value: { householdName: 'Household B recovered' },
    });
  });

  it('never exposes a development invitation draft under another household', () => {
    const draft = { householdId: 'household-a', value: 'Generated test display label' } as const;

    expect(householdBoundDraftValue(draft, 'household-b')).toBeUndefined();
    expect(householdBoundDraftValue(draft, 'household-a')).toBe(draft.value);
  });

  it('hides a Family error immediately when household selection changes', () => {
    const error = {
      householdId: 'household-a',
      value: 'Generated household-scoped failure',
    } as const;

    expect(householdBoundDraftValue(error, 'household-a')).toBe(error.value);
    expect(householdBoundDraftValue(error, 'household-b')).toBeUndefined();
  });

  it('suppresses obsolete invitation previews and preserves exact reviewed credentials', () => {
    type Preview = {
      readonly invitation: { readonly id: string; readonly previewVersion: string };
    };
    let state: InvitationReviewState<Preview> = emptyInvitationReview();
    const dispatch = (action: InvitationReviewAction<Preview>): void => {
      state = invitationReviewReducer(state, action);
    };
    const codeA = ['invitation-a', 'a'.repeat(24)].join('.');
    const codeB = ['invitation-b', 'b'.repeat(24)].join('.');

    dispatch({
      type: 'started',
      requestId: 1,
      invitationId: 'invitation-a',
      localInviteCode: codeA,
    });
    dispatch({ type: 'clear' });
    dispatch({
      type: 'succeeded',
      requestId: 1,
      invitationId: 'invitation-a',
      localInviteCode: codeA,
      value: { invitation: { id: 'invitation-a', previewVersion: 'preview-a' } },
    });
    expect(state).toEqual({ status: 'idle' });

    dispatch({
      type: 'started',
      requestId: 2,
      invitationId: 'invitation-a',
      localInviteCode: codeA,
    });
    dispatch({
      type: 'started',
      requestId: 3,
      invitationId: 'invitation-b',
      localInviteCode: codeB,
    });
    dispatch({
      type: 'succeeded',
      requestId: 2,
      invitationId: 'invitation-a',
      localInviteCode: codeA,
      value: { invitation: { id: 'invitation-a', previewVersion: 'preview-a' } },
    });
    expect(state).toMatchObject({
      status: 'loading',
      requestId: 3,
      invitationId: 'invitation-b',
      localInviteCode: codeB,
    });

    dispatch({
      type: 'succeeded',
      requestId: 3,
      invitationId: 'invitation-b',
      localInviteCode: codeB,
      value: { invitation: { id: 'invitation-b', previewVersion: 'preview-b' } },
    });
    expect(state).toEqual({
      status: 'ready',
      requestId: 3,
      invitationId: 'invitation-b',
      localInviteCode: codeB,
      value: { invitation: { id: 'invitation-b', previewVersion: 'preview-b' } },
    });
    if (state.status !== 'ready') throw new Error('Expected a completed invitation review');
    expect(invitationAcceptanceBinding(state)).toEqual({
      invitationId: 'invitation-b',
      localInviteCode: codeB,
      previewVersion: 'preview-b',
    });
    expect(
      invitationAcceptanceBinding({
        ...state,
        value: { invitation: { id: 'invitation-a', previewVersion: 'preview-a' } },
      }),
    ).toBeNull();
  });
});

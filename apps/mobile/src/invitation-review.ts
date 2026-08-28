export interface InvitationReviewCredentials {
  readonly invitationId: string;
  readonly localInviteCode: string;
}

export type InvitationReviewState<T> =
  | { readonly status: 'idle' }
  | ({ readonly status: 'loading'; readonly requestId: number } & InvitationReviewCredentials)
  | ({
      readonly status: 'ready';
      readonly requestId: number;
      readonly value: T;
    } & InvitationReviewCredentials);

export type InvitationReviewAction<T> =
  | { readonly type: 'clear' }
  | ({ readonly type: 'started'; readonly requestId: number } & InvitationReviewCredentials)
  | ({
      readonly type: 'succeeded';
      readonly requestId: number;
      readonly value: T;
    } & InvitationReviewCredentials);

export interface VersionedInvitationPreview {
  readonly invitation: {
    readonly id: string;
    readonly previewVersion: string;
  };
}

export interface InvitationAcceptanceBinding extends InvitationReviewCredentials {
  readonly previewVersion: string;
}

export function emptyInvitationReview<T>(): InvitationReviewState<T> {
  return { status: 'idle' };
}

export function invitationReviewReducer<T>(
  state: InvitationReviewState<T>,
  action: InvitationReviewAction<T>,
): InvitationReviewState<T> {
  if (action.type === 'clear') return emptyInvitationReview<T>();
  if (action.type === 'started') {
    return {
      status: 'loading',
      requestId: action.requestId,
      invitationId: action.invitationId,
      localInviteCode: action.localInviteCode,
    };
  }
  if (
    state.status !== 'loading' ||
    state.requestId !== action.requestId ||
    state.invitationId !== action.invitationId ||
    state.localInviteCode !== action.localInviteCode
  ) {
    return state;
  }
  return {
    status: 'ready',
    requestId: action.requestId,
    invitationId: action.invitationId,
    localInviteCode: action.localInviteCode,
    value: action.value,
  };
}

export function invitationAcceptanceBinding<T extends VersionedInvitationPreview>(
  review: Extract<InvitationReviewState<T>, { status: 'ready' }>,
): InvitationAcceptanceBinding | null {
  if (review.value.invitation.id !== review.invitationId) return null;
  return {
    invitationId: review.invitationId,
    localInviteCode: review.localInviteCode,
    previewVersion: review.value.invitation.previewVersion,
  };
}

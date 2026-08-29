import type { CheckKind } from '@boomerbuddy/contracts';

export type CheckRefreshDraft = {
  readonly checkId: string;
  readonly householdId: string;
  readonly kind: CheckKind;
  readonly content: string;
};

let currentDraft: CheckRefreshDraft | undefined;

export function retainCheckRefreshDraft(draft: CheckRefreshDraft): void {
  currentDraft = draft;
}

export function readCheckRefreshDraft(
  checkId: string,
  householdId: string,
): CheckRefreshDraft | undefined {
  if (currentDraft?.checkId !== checkId || currentDraft.householdId !== householdId) {
    return undefined;
  }
  return currentDraft;
}

export function clearCheckRefreshDraft(checkId?: string): void {
  if (checkId === undefined || currentDraft?.checkId === checkId) {
    currentDraft = undefined;
  }
}

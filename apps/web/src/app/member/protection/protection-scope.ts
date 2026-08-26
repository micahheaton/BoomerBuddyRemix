import type { ProtectedSelfEnrollmentStatusResponse } from '@boomerbuddy/contracts';

import { protectedSelfOperationStoragePrefix } from '../../../lib/auth-recovery';

export type ProtectedSelfAction = 'enroll' | 'withdraw';

export type ProtectedSelfScope = {
  readonly householdId: string;
  readonly personId: string;
};

export type BoundProtectedSelfOperation = ProtectedSelfScope & {
  readonly action: ProtectedSelfAction;
  readonly key: string;
};

export function protectedSelfScopeKey(scope: ProtectedSelfScope): string {
  return `${scope.personId}:${scope.householdId}`;
}

export function protectedSelfStatusMatchesScope(
  status: ProtectedSelfEnrollmentStatusResponse,
  scope: ProtectedSelfScope,
): boolean {
  return status.householdId === scope.householdId && status.personId === scope.personId;
}

export function protectedSelfOperationMatchesScope(
  operation: BoundProtectedSelfOperation | undefined,
  scope: ProtectedSelfScope,
  action: ProtectedSelfAction,
): operation is BoundProtectedSelfOperation {
  return (
    operation?.action === action &&
    operation.householdId === scope.householdId &&
    operation.personId === scope.personId
  );
}

export function bindProtectedSelfOperation(
  operation: BoundProtectedSelfOperation | undefined,
  scope: ProtectedSelfScope,
  action: ProtectedSelfAction,
  createKey: (action: ProtectedSelfAction) => string,
): BoundProtectedSelfOperation {
  return protectedSelfOperationMatchesScope(operation, scope, action)
    ? operation
    : { ...scope, action, key: createKey(action) };
}

export function protectedSelfOperationStorageKey(
  scope: ProtectedSelfScope,
  action: ProtectedSelfAction,
): string {
  return `${protectedSelfOperationStoragePrefix}${action}:${protectedSelfScopeKey(scope)}`;
}

export function shouldRetainProtectedSelfOperation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) return true;
  const status = (error as { readonly status?: unknown }).status;
  return typeof status !== 'number' || status < 400 || status >= 500 || status === 408;
}

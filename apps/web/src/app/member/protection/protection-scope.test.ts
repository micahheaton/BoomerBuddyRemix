import { describe, expect, it, vi } from 'vitest';

import {
  bindProtectedSelfOperation,
  protectedSelfOperationMatchesScope,
  protectedSelfOperationStorageKey,
  protectedSelfScopeKey,
  protectedSelfStatusMatchesScope,
  shouldRetainProtectedSelfOperation,
  type BoundProtectedSelfOperation,
  type ProtectedSelfScope,
} from './protection-scope';

const alpha: ProtectedSelfScope = { householdId: 'household-alpha', personId: 'person-one' };
const beta: ProtectedSelfScope = { householdId: 'household-beta', personId: 'person-one' };
const otherPerson: ProtectedSelfScope = {
  householdId: 'household-alpha',
  personId: 'person-two',
};

function status(householdId: string, personId: string) {
  return {
    householdId,
    personId,
    enrollment: { state: 'not_enrolled' as const, effectiveAccess: false },
    eligibility: 'available' as const,
    withdrawalAvailable: false,
    consent: {
      version: 'protected-self-enrollment-v1' as const,
      disclosure: { version: 'disclosure-v1', text: 'Disclosure', digest: '1'.repeat(64) },
      policy: { version: 'policy-v1', text: 'Policy', digest: '2'.repeat(64) },
    },
  };
}

describe('protected enrollment web scope binding', () => {
  it('accepts status only for the exact household and signed-in person', () => {
    expect(protectedSelfStatusMatchesScope(status(alpha.householdId, alpha.personId), alpha)).toBe(
      true,
    );
    expect(protectedSelfStatusMatchesScope(status(beta.householdId, alpha.personId), alpha)).toBe(
      false,
    );
    expect(
      protectedSelfStatusMatchesScope(status(alpha.householdId, otherPerson.personId), alpha),
    ).toBe(false);
    expect(protectedSelfScopeKey(alpha)).not.toBe(protectedSelfScopeKey(beta));
    expect(protectedSelfScopeKey(alpha)).not.toBe(protectedSelfScopeKey(otherPerson));
  });

  it('reuses an ambiguous operation only for the same action and exact scope', () => {
    const createKey = vi.fn(
      (action: 'enroll' | 'withdraw') => `protected-self-${action}:new-operation`,
    );
    const original: BoundProtectedSelfOperation = {
      ...alpha,
      action: 'enroll',
      key: 'protected-self-enroll:original-operation',
    };

    expect(bindProtectedSelfOperation(original, alpha, 'enroll', createKey)).toBe(original);
    expect(createKey).not.toHaveBeenCalled();

    const householdChange = bindProtectedSelfOperation(original, beta, 'enroll', createKey);
    const personChange = bindProtectedSelfOperation(original, otherPerson, 'enroll', createKey);
    const actionChange = bindProtectedSelfOperation(original, alpha, 'withdraw', createKey);
    expect(householdChange).toMatchObject(beta);
    expect(personChange).toMatchObject(otherPerson);
    expect(actionChange).toMatchObject({ ...alpha, action: 'withdraw' });
    expect(createKey).toHaveBeenCalledTimes(3);
    expect(protectedSelfOperationMatchesScope(original, beta, 'enroll')).toBe(false);
    expect(protectedSelfOperationMatchesScope(original, alpha, 'withdraw')).toBe(false);
  });

  it('names retry storage by person, household, and action', () => {
    expect(protectedSelfOperationStorageKey(alpha, 'enroll')).not.toBe(
      protectedSelfOperationStorageKey(beta, 'enroll'),
    );
    expect(protectedSelfOperationStorageKey(alpha, 'enroll')).not.toBe(
      protectedSelfOperationStorageKey(otherPerson, 'enroll'),
    );
    expect(protectedSelfOperationStorageKey(alpha, 'enroll')).not.toBe(
      protectedSelfOperationStorageKey(alpha, 'withdraw'),
    );
  });

  it('retains only ambiguous failures for exact retry', () => {
    expect(shouldRetainProtectedSelfOperation(new Error('connection lost'))).toBe(true);
    expect(shouldRetainProtectedSelfOperation({ status: 408 })).toBe(true);
    expect(shouldRetainProtectedSelfOperation({ status: 500 })).toBe(true);
    expect(shouldRetainProtectedSelfOperation({ status: 409 })).toBe(false);
    expect(shouldRetainProtectedSelfOperation({ status: 401 })).toBe(false);
  });
});

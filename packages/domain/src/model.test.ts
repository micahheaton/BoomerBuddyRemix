import { describe, expect, it } from 'vitest';
import { ids } from './identifiers';
import { hasActiveProtectedEnrollment, type HouseholdMembershipScope } from './model';

function membership(overrides: Partial<HouseholdMembershipScope> = {}): HouseholdMembershipScope {
  return {
    householdId: ids.household('household_home'),
    membershipId: ids.membership('membership_member'),
    role: 'protected_member',
    status: 'active',
    isProtectedMember: true,
    permissions: [],
    capabilities: [],
    ...overrides,
  };
}

describe('protected enrollment projection', () => {
  it('is independent from the exclusive household role', () => {
    expect(
      hasActiveProtectedEnrollment(
        membership({ role: 'household_owner', isProtectedMember: true }),
      ),
    ).toBe(true);
    expect(
      hasActiveProtectedEnrollment(
        membership({ role: 'protected_member', isProtectedMember: false }),
      ),
    ).toBe(false);
    expect(
      hasActiveProtectedEnrollment(
        membership({ role: 'trusted_circle', isProtectedMember: false }),
      ),
    ).toBe(false);
  });

  it('fails closed when the household membership is not active', () => {
    expect(
      hasActiveProtectedEnrollment(membership({ status: 'revoked', isProtectedMember: true })),
    ).toBe(false);
  });
});

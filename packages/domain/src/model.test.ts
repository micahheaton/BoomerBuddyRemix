import { describe, expect, it } from 'vitest';
import { ids } from './identifiers';
import {
  hasActiveProtectedEnrollment,
  hasTrustedCirclePermission,
  type HouseholdMembershipScope,
} from './model';

function membership(overrides: Partial<HouseholdMembershipScope> = {}): HouseholdMembershipScope {
  return {
    householdId: ids.household('household_home'),
    membershipId: ids.membership('membership_member'),
    membershipKind: 'member',
    status: 'active',
    isAdministrator: false,
    isProtectedMember: true,
    trustedCircleGrants: [],
    isPayer: false,
    isBillingManager: false,
    capabilities: [],
    ...overrides,
  };
}

describe('protected enrollment projection', () => {
  it('is independent from administration, payment, billing and pairwise trust', () => {
    expect(
      hasActiveProtectedEnrollment(
        membership({
          isAdministrator: true,
          isProtectedMember: true,
          isPayer: true,
          isBillingManager: true,
          trustedCircleGrants: [
            {
              relationshipId: ids.relationship('relationship_other_pair'),
              protectedPersonId: ids.person('person_other_protected'),
              permissions: ['view_shared_checks'],
            },
          ],
        }),
      ),
    ).toBe(true);
    expect(hasActiveProtectedEnrollment(membership({ isProtectedMember: false }))).toBe(false);
  });

  it('fails closed when the household membership is not active', () => {
    expect(
      hasActiveProtectedEnrollment(membership({ status: 'revoked', isProtectedMember: true })),
    ).toBe(false);
  });

  it('resolves trust only for the exact protected-person pair', () => {
    const scope = membership({
      isProtectedMember: false,
      trustedCircleGrants: [
        {
          relationshipId: ids.relationship('relationship_exact_pair'),
          protectedPersonId: ids.person('person_exact_protected'),
          permissions: ['view_shared_checks'],
        },
      ],
    });
    expect(
      hasTrustedCirclePermission(scope, ids.person('person_exact_protected'), 'view_shared_checks'),
    ).toBe(true);
    expect(
      hasTrustedCirclePermission(
        scope,
        ids.person('person_unrelated_protected'),
        'view_shared_checks',
      ),
    ).toBe(false);
  });
});

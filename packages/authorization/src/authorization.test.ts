import { describe, expect, it } from 'vitest';
import { ids, type Role } from '@boomerbuddy/domain';
import { assertAuthorized, authorize, type Principal, type Resource } from './index';

const home = ids.household('household_home');
const other = ids.household('household_other');
const person = ids.person('person_member');

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    personId: person,
    sessionId: ids.session('session_member'),
    audience: 'customer',
    roles: ['protected_member'],
    households: [
      {
        householdId: home,
        role: 'protected_member',
        isProtectedMember: true,
        permissions: [],
        capabilities: [
          'check:text',
          'check:url',
          'history:read',
          'family:manage',
          'orientation:use',
        ],
        status: 'active',
      },
    ],
    organizations: [],
    ...overrides,
  };
}

describe('deny-by-default authorization', () => {
  it('denies missing principals, wrong audience and cross-tenant requests', () => {
    const resource: Resource = {
      kind: 'check_collection',
      householdId: home,
      scope: {
        kind: 'list',
        ownerPersonId: person,
        includeOwned: true,
        includeExplicitlyShared: true,
      },
    };
    expect(authorize({ principal: null, action: 'check:list', resource })).toEqual({
      allowed: false,
      reason: 'missing_principal',
    });
    expect(
      authorize({
        principal: principal({ audience: 'hq' }),
        action: 'check:list',
        resource,
      }).reason,
    ).toBe('wrong_audience');
    expect(
      authorize({
        principal: principal(),
        action: 'check:list',
        resource: {
          kind: 'check_collection',
          householdId: other,
          scope: {
            kind: 'list',
            ownerPersonId: person,
            includeOwned: true,
            includeExplicitlyShared: true,
          },
        },
      }).reason,
    ).toBe('outside_tenant');
  });

  it('requires capability and object ownership for checks', () => {
    expect(
      authorize({
        principal: principal({
          households: [
            {
              householdId: home,
              role: 'protected_member',
              isProtectedMember: true,
              permissions: [],
              capabilities: [],
              status: 'active',
            },
          ],
        }),
        action: 'check:create',
        resource: {
          kind: 'check_collection',
          householdId: home,
          scope: { kind: 'create', artifactKind: 'text' },
        },
      }).reason,
    ).toBe('missing_capability');
    expect(
      authorize({
        principal: principal(),
        action: 'check:delete',
        resource: { kind: 'check', householdId: home, ownerPersonId: ids.person('someone_else') },
      }).reason,
    ).toBe('not_owner_or_shared');
  });

  it('requires URL capability and an actor-scoped list contract', () => {
    expect(
      authorize({
        principal: principal({
          households: [
            {
              householdId: home,
              role: 'protected_member',
              isProtectedMember: true,
              permissions: [],
              capabilities: ['check:text', 'history:read'],
              status: 'active',
            },
          ],
        }),
        action: 'check:create',
        resource: {
          kind: 'check_collection',
          householdId: home,
          scope: { kind: 'create', artifactKind: 'url' },
        },
      }).reason,
    ).toBe('missing_capability');
    expect(
      authorize({
        principal: principal(),
        action: 'check:list',
        resource: {
          kind: 'check_collection',
          householdId: home,
          scope: {
            kind: 'list',
            ownerPersonId: ids.person('different_person'),
            includeOwned: true,
            includeExplicitlyShared: true,
          },
        },
      }).reason,
    ).toBe('unsupported_action_resource');
  });

  it('denies protected workflows to an unprotected household owner but preserves deletion', () => {
    const owner = principal({
      roles: ['household_owner'],
      households: [
        {
          householdId: home,
          role: 'household_owner',
          isProtectedMember: false,
          permissions: [],
          capabilities: [
            'check:text',
            'check:url',
            'history:read',
            'family:manage',
            'orientation:use',
          ],
          status: 'active',
        },
      ],
    });
    const ownCheck: Resource = {
      kind: 'check',
      householdId: home,
      ownerPersonId: person,
    };

    expect(
      authorize({
        principal: owner,
        action: 'check:create',
        resource: {
          kind: 'check_collection',
          householdId: home,
          scope: { kind: 'create', artifactKind: 'text' },
        },
      }).allowed,
    ).toBe(false);
    expect(
      authorize({
        principal: owner,
        action: 'check:list',
        resource: {
          kind: 'check_collection',
          householdId: home,
          scope: {
            kind: 'list',
            ownerPersonId: person,
            includeOwned: true,
            includeExplicitlyShared: true,
          },
        },
      }).allowed,
    ).toBe(false);
    expect(authorize({ principal: owner, action: 'check:read', resource: ownCheck }).allowed).toBe(
      false,
    );
    expect(authorize({ principal: owner, action: 'check:share', resource: ownCheck }).allowed).toBe(
      false,
    );
    expect(
      authorize({ principal: owner, action: 'check:delete', resource: ownCheck }).allowed,
    ).toBe(true);
    expect(
      authorize({
        principal: owner,
        action: 'orientation:update',
        resource: { kind: 'orientation', householdId: home, subjectPersonId: person },
      }).allowed,
    ).toBe(false);
    expect(
      authorize({
        principal: owner,
        action: 'family:invite',
        resource: {
          kind: 'family',
          householdId: home,
          scope: { kind: 'subject_invitation', protectedPersonId: person },
        },
      }).allowed,
    ).toBe(false);
  });

  it('allows an independently protected household owner to use protected workflows', () => {
    const ownerAndProtected = principal({
      roles: ['household_owner'],
      households: [
        {
          householdId: home,
          role: 'household_owner',
          isProtectedMember: true,
          permissions: [],
          capabilities: ['check:text', 'history:read', 'family:manage', 'orientation:use'],
          status: 'active',
        },
      ],
    });
    const ownCheck: Resource = {
      kind: 'check',
      householdId: home,
      ownerPersonId: person,
    };

    expect(
      authorize({
        principal: ownerAndProtected,
        action: 'check:create',
        resource: {
          kind: 'check_collection',
          householdId: home,
          scope: { kind: 'create', artifactKind: 'text' },
        },
      }).allowed,
    ).toBe(true);
    expect(
      authorize({
        principal: ownerAndProtected,
        action: 'check:list',
        resource: {
          kind: 'check_collection',
          householdId: home,
          scope: {
            kind: 'list',
            ownerPersonId: person,
            includeOwned: true,
            includeExplicitlyShared: true,
          },
        },
      }).allowed,
    ).toBe(true);
    expect(
      authorize({ principal: ownerAndProtected, action: 'check:read', resource: ownCheck }).allowed,
    ).toBe(true);
    expect(
      authorize({ principal: ownerAndProtected, action: 'check:share', resource: ownCheck })
        .allowed,
    ).toBe(true);
    expect(
      authorize({
        principal: ownerAndProtected,
        action: 'orientation:view',
        resource: { kind: 'orientation', householdId: home, subjectPersonId: person },
      }).allowed,
    ).toBe(true);
    expect(
      authorize({
        principal: ownerAndProtected,
        action: 'family:invite',
        resource: {
          kind: 'family',
          householdId: home,
          scope: { kind: 'subject_invitation', protectedPersonId: person },
        },
      }).allowed,
    ).toBe(true);
  });

  it('does not infer protection from a legacy protected or Trusted Circle role', () => {
    const roleOnly = principal({
      households: [
        {
          householdId: home,
          role: 'protected_member',
          isProtectedMember: false,
          permissions: [],
          capabilities: ['check:text', 'history:read', 'family:manage', 'orientation:use'],
          status: 'active',
        },
      ],
    });
    expect(
      authorize({
        principal: roleOnly,
        action: 'check:create',
        resource: {
          kind: 'check_collection',
          householdId: home,
          scope: { kind: 'create', artifactKind: 'text' },
        },
      }).allowed,
    ).toBe(false);
    expect(
      authorize({
        principal: roleOnly,
        action: 'family:invite',
        resource: {
          kind: 'family',
          householdId: home,
          scope: { kind: 'subject_invitation', protectedPersonId: person },
        },
      }).allowed,
    ).toBe(false);
    expect(
      authorize({
        principal: roleOnly,
        action: 'orientation:update',
        resource: { kind: 'orientation', householdId: home, subjectPersonId: person },
      }).allowed,
    ).toBe(false);

    const trusted = principal({
      roles: ['trusted_circle'],
      households: [
        {
          householdId: home,
          role: 'trusted_circle',
          isProtectedMember: false,
          permissions: ['view_shared_checks'],
          capabilities: ['check:text', 'history:read', 'orientation:use'],
          status: 'active',
        },
      ],
    });
    expect(
      authorize({
        principal: trusted,
        action: 'check:create',
        resource: {
          kind: 'check_collection',
          householdId: home,
          scope: { kind: 'create', artifactKind: 'text' },
        },
      }).allowed,
    ).toBe(false);
    expect(
      authorize({
        principal: trusted,
        action: 'orientation:view',
        resource: { kind: 'orientation', householdId: home, subjectPersonId: person },
      }).allowed,
    ).toBe(false);
    expect(
      authorize({
        principal: trusted,
        action: 'check:list',
        resource: {
          kind: 'check_collection',
          householdId: home,
          scope: {
            kind: 'list',
            ownerPersonId: person,
            includeOwned: false,
            includeExplicitlyShared: true,
          },
        },
      }).allowed,
    ).toBe(true);
    expect(
      authorize({
        principal: trusted,
        action: 'check:list',
        resource: {
          kind: 'check_collection',
          householdId: home,
          scope: {
            kind: 'list',
            ownerPersonId: person,
            includeOwned: true,
            includeExplicitlyShared: true,
          },
        },
      }),
    ).toEqual({ allowed: false, reason: 'insufficient_role' });
    expect(
      authorize({
        principal: trusted,
        action: 'check:list',
        resource: {
          kind: 'check_collection',
          householdId: home,
          scope: {
            kind: 'list',
            ownerPersonId: person,
            includeOwned: false,
            includeExplicitlyShared: false,
          },
        },
      }),
    ).toEqual({ allowed: false, reason: 'unsupported_action_resource' });
    expect(
      authorize({
        principal: trusted,
        action: 'check:read',
        resource: {
          kind: 'check',
          householdId: home,
          ownerPersonId: ids.person('person_protected'),
          sharedWithPersonIds: [person],
        },
      }).allowed,
    ).toBe(true);
  });

  it('allows only the bound invitee to accept before household membership exists', () => {
    const invitee = principal({ households: [] });
    expect(
      authorize({
        principal: invitee,
        action: 'family:accept_invitation',
        resource: {
          kind: 'invitation',
          householdId: home,
          invitedPersonId: person,
          credentialPresented: true,
        },
      }).allowed,
    ).toBe(true);
    expect(
      authorize({
        principal: invitee,
        action: 'family:accept_invitation',
        resource: {
          kind: 'invitation',
          householdId: home,
          invitedPersonId: ids.person('another_invitee'),
          credentialPresented: true,
        },
      }).allowed,
    ).toBe(false);
    expect(
      authorize({
        principal: invitee,
        action: 'family:accept_invitation',
        resource: {
          kind: 'invitation',
          householdId: home,
          invitedPersonId: person,
          credentialPresented: false,
        },
      }).allowed,
    ).toBe(false);
  });

  it('allows only explicitly shared checks to permissioned trusted-circle members', () => {
    const trusted = principal({
      roles: ['trusted_circle'],
      households: [
        {
          householdId: home,
          role: 'trusted_circle',
          isProtectedMember: false,
          permissions: ['view_shared_checks'],
          capabilities: ['history:read'],
          status: 'active',
        },
      ],
    });
    const resource: Resource = {
      kind: 'check',
      householdId: home,
      ownerPersonId: ids.person('protected_person'),
      sharedWithPersonIds: [person],
    };
    expect(authorize({ principal: trusted, action: 'check:read', resource }).allowed).toBe(true);
    expect(authorize({ principal: trusted, action: 'check:share', resource }).allowed).toBe(false);
  });

  it('scopes Family views to owner roster, self, or a pairwise relationship', () => {
    const protectedMember = principal();
    expect(
      authorize({
        principal: protectedMember,
        action: 'family:view',
        resource: { kind: 'family', householdId: home, scope: { kind: 'roster' } },
      }).allowed,
    ).toBe(false);
    expect(
      authorize({
        principal: protectedMember,
        action: 'family:view',
        resource: {
          kind: 'family',
          householdId: home,
          scope: { kind: 'subject_relationships', subjectPersonId: person },
        },
      }).allowed,
    ).toBe(true);
    expect(
      authorize({
        principal: protectedMember,
        action: 'family:view',
        resource: {
          kind: 'family',
          householdId: home,
          scope: {
            kind: 'pairwise_relationship',
            protectedPersonId: ids.person('person_a'),
            trustedPersonId: ids.person('person_b'),
          },
        },
      }).allowed,
    ).toBe(false);
  });

  it('allows only a protected member to invite for their own subject', () => {
    const selfInvitation: Resource = {
      kind: 'family',
      householdId: home,
      scope: { kind: 'subject_invitation', protectedPersonId: person },
    };
    expect(
      authorize({ principal: principal(), action: 'family:invite', resource: selfInvitation }),
    ).toEqual({ allowed: true, reason: 'allowed_by_policy' });

    const anotherProtectedPerson = ids.person('person_other_protected');
    expect(
      authorize({
        principal: principal(),
        action: 'family:invite',
        resource: {
          kind: 'family',
          householdId: home,
          scope: {
            kind: 'subject_invitation',
            protectedPersonId: anotherProtectedPerson,
          },
        },
      }),
    ).toEqual({ allowed: false, reason: 'not_owner_or_shared' });

    const owner = principal({
      roles: ['household_owner'],
      households: [
        {
          householdId: home,
          role: 'household_owner',
          isProtectedMember: false,
          permissions: [],
          capabilities: ['family:manage'],
          status: 'active',
        },
      ],
    });
    expect(
      authorize({ principal: owner, action: 'family:invite', resource: selfInvitation }),
    ).toEqual({ allowed: false, reason: 'insufficient_role' });
  });

  it('allows protected-subject and exact owner safety cancellation without an entitlement', () => {
    const invitation: Resource = {
      kind: 'family',
      householdId: home,
      scope: { kind: 'subject_invitation', protectedPersonId: person },
    };
    const protectedMember = principal({
      households: [
        {
          householdId: home,
          role: 'protected_member',
          isProtectedMember: true,
          permissions: [],
          capabilities: [],
          status: 'active',
        },
      ],
    });
    expect(
      authorize({
        principal: protectedMember,
        action: 'family:revoke_invitation',
        resource: invitation,
      }),
    ).toEqual({ allowed: true, reason: 'allowed_by_policy' });

    const owner = principal({
      roles: ['household_owner'],
      households: [
        {
          householdId: home,
          role: 'household_owner',
          isProtectedMember: false,
          permissions: [],
          capabilities: [],
          status: 'active',
        },
      ],
    });
    expect(
      authorize({
        principal: owner,
        action: 'family:revoke_invitation',
        resource: invitation,
      }),
    ).toEqual({ allowed: true, reason: 'allowed_by_policy' });
  });

  it('denies unrelated invitation cancellation but preserves exact-subject withdrawal', () => {
    const protectedPerson = ids.person('person_invitation_subject');
    const invitation: Resource = {
      kind: 'family',
      householdId: home,
      scope: { kind: 'subject_invitation', protectedPersonId: protectedPerson },
    };
    expect(
      authorize({
        principal: principal(),
        action: 'family:revoke_invitation',
        resource: invitation,
      }),
    ).toEqual({ allowed: false, reason: 'not_owner_or_shared' });

    const trustedInSubjectSlot = principal({
      personId: protectedPerson,
      roles: ['trusted_circle'],
      households: [
        {
          householdId: home,
          role: 'trusted_circle',
          isProtectedMember: false,
          permissions: [],
          capabilities: [],
          status: 'active',
        },
      ],
    });
    expect(
      authorize({
        principal: trustedInSubjectSlot,
        action: 'family:revoke_invitation',
        resource: invitation,
      }),
    ).toEqual({ allowed: true, reason: 'allowed_by_policy' });

    const enrollmentMissing = principal({
      personId: protectedPerson,
      households: [
        {
          householdId: home,
          role: 'protected_member',
          isProtectedMember: false,
          permissions: [],
          capabilities: [],
          status: 'active',
        },
      ],
    });
    expect(
      authorize({
        principal: enrollmentMissing,
        action: 'family:revoke_invitation',
        resource: invitation,
      }),
    ).toEqual({ allowed: true, reason: 'allowed_by_policy' });

    expect(
      authorize({
        principal: principal(),
        action: 'family:revoke_invitation',
        resource: { kind: 'family', householdId: home, scope: { kind: 'roster' } },
      }),
    ).toEqual({ allowed: false, reason: 'unsupported_action_resource' });
  });

  it('allows either exact relationship participant or the household owner to revoke', () => {
    const protectedPerson = person;
    const trustedPerson = ids.person('person_trusted');
    const relationship: Resource = {
      kind: 'family',
      householdId: home,
      scope: {
        kind: 'pairwise_relationship',
        protectedPersonId: protectedPerson,
        trustedPersonId: trustedPerson,
      },
    };
    const protectedMember = principal({
      households: [
        {
          householdId: home,
          role: 'protected_member',
          isProtectedMember: true,
          permissions: [],
          capabilities: [],
          status: 'active',
        },
      ],
    });
    expect(
      authorize({ principal: protectedMember, action: 'family:revoke', resource: relationship }),
    ).toEqual({ allowed: true, reason: 'allowed_by_policy' });

    const trusted = principal({
      personId: trustedPerson,
      roles: ['trusted_circle'],
      households: [
        {
          householdId: home,
          role: 'trusted_circle',
          isProtectedMember: false,
          permissions: ['view_shared_checks'],
          capabilities: [],
          status: 'active',
        },
      ],
    });
    expect(
      authorize({ principal: trusted, action: 'family:revoke', resource: relationship }),
    ).toEqual({ allowed: true, reason: 'allowed_by_policy' });

    const owner = principal({
      roles: ['household_owner'],
      households: [
        {
          householdId: home,
          role: 'household_owner',
          isProtectedMember: false,
          permissions: [],
          capabilities: [],
          status: 'active',
        },
      ],
    });
    expect(
      authorize({ principal: owner, action: 'family:revoke', resource: relationship }),
    ).toEqual({ allowed: true, reason: 'allowed_by_policy' });
  });

  it('denies unrelated revocation but preserves exact protected-subject withdrawal', () => {
    const protectedPerson = ids.person('person_protected');
    const trustedPerson = ids.person('person_trusted');
    const relationship: Resource = {
      kind: 'family',
      householdId: home,
      scope: {
        kind: 'pairwise_relationship',
        protectedPersonId: protectedPerson,
        trustedPersonId: trustedPerson,
      },
    };
    expect(
      authorize({ principal: principal(), action: 'family:revoke', resource: relationship }),
    ).toEqual({ allowed: false, reason: 'not_owner_or_shared' });

    const trustedInProtectedSlot = principal({
      personId: protectedPerson,
      roles: ['trusted_circle'],
      households: [
        {
          householdId: home,
          role: 'trusted_circle',
          isProtectedMember: false,
          permissions: [],
          capabilities: ['family:manage'],
          status: 'active',
        },
      ],
    });
    expect(
      authorize({
        principal: trustedInProtectedSlot,
        action: 'family:revoke',
        resource: relationship,
      }),
    ).toEqual({ allowed: true, reason: 'allowed_by_policy' });

    const enrollmentMissing = principal({
      personId: protectedPerson,
      households: [
        {
          householdId: home,
          role: 'protected_member',
          isProtectedMember: false,
          permissions: [],
          capabilities: [],
          status: 'active',
        },
      ],
    });
    expect(
      authorize({
        principal: enrollmentMissing,
        action: 'family:revoke',
        resource: relationship,
      }),
    ).toEqual({ allowed: true, reason: 'allowed_by_policy' });
  });

  it('never lets a paid household capability authorize a different household', () => {
    const paid = ids.household('household_paid');
    const free = ids.household('household_free');
    const multiHousehold = principal({
      households: [
        {
          householdId: paid,
          role: 'household_owner',
          isProtectedMember: true,
          permissions: [],
          capabilities: ['check:text', 'check:url'],
          status: 'active',
        },
        {
          householdId: free,
          role: 'household_owner',
          isProtectedMember: true,
          permissions: [],
          capabilities: ['check:text'],
          status: 'active',
        },
      ],
    });
    expect(
      authorize({
        principal: multiHousehold,
        action: 'check:create',
        resource: {
          kind: 'check_collection',
          householdId: paid,
          scope: { kind: 'create', artifactKind: 'url' },
        },
      }).allowed,
    ).toBe(true);
    expect(
      authorize({
        principal: multiHousehold,
        action: 'check:create',
        resource: {
          kind: 'check_collection',
          householdId: free,
          scope: { kind: 'create', artifactKind: 'url' },
        },
      }).reason,
    ).toBe('missing_capability');
  });

  it.each([
    ['hq_owner', 'hq:overview', true],
    ['hq_reviewer', 'hq:reviews:list', true],
    ['hq_support', 'hq:households:list', true],
    ['hq_support', 'hq:audit:list', false],
  ] as const)('applies HQ role policy for %s', (role, action, allowed) => {
    const hq = principal({
      audience: 'hq',
      roles: [role as Role],
      households: [],
      organizations: [{ role, status: 'active' }],
    });
    expect(authorize({ principal: hq, action, resource: { kind: 'hq' } }).allowed).toBe(allowed);
  });

  it('denies unknown actions even for the HQ owner', () => {
    const owner = principal({
      audience: 'hq',
      roles: ['hq_owner'],
      households: [],
      organizations: [{ role: 'hq_owner', status: 'active' }],
    });
    expect(
      authorize({
        principal: owner,
        action: 'hq:unknown' as never,
        resource: { kind: 'hq' },
      }),
    ).toEqual({ allowed: false, reason: 'unsupported_action_resource' });
  });

  it('throws a content-free domain error from the assertion helper', () => {
    expect(() =>
      assertAuthorized({
        principal: principal(),
        action: 'family:revoke',
        resource: {
          kind: 'family',
          householdId: home,
          scope: {
            kind: 'pairwise_relationship',
            protectedPersonId: ids.person('person_other_protected'),
            trustedPersonId: ids.person('person_other_trusted'),
          },
        },
      }),
    ).toThrow('The requested action is not permitted');
  });
});

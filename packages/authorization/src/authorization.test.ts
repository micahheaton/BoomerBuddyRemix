import { describe, expect, it } from 'vitest';
import { ids, type Capability, type Role } from '@boomerbuddy/domain';
import { assertAuthorized, authorize, type Principal, type Resource } from './index';

const home = ids.household('household-home');
const other = ids.household('household-other');
const person = ids.person('person-member');
const protectedPerson = ids.person('person-protected');
const relationshipId = ids.relationship('relationship-exact');

function householdScope(
  overrides: Partial<Principal['households'][number]> = {},
): Principal['households'][number] {
  return {
    householdId: home,
    membershipKind: 'member',
    isAdministrator: false,
    isProtectedMember: true,
    trustedCircleGrants: [],
    isPayer: false,
    isBillingManager: false,
    capabilities: ['check:text', 'check:url', 'history:read', 'family:manage', 'orientation:use'],
    status: 'active',
    ...overrides,
  };
}

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    personId: person,
    sessionId: ids.session('session-member'),
    audience: 'customer',
    roles: ['protected_member'],
    households: [householdScope()],
    organizations: [],
    supportCases: [],
    restrictedAccess: [],
    ...overrides,
  };
}

function hqPrincipal(role: Extract<Role, 'hq_owner' | 'hq_reviewer' | 'hq_support'>): Principal {
  return principal({
    audience: 'hq',
    roles: [role],
    households: [],
    organizations: [{ employeeAssignmentId: 'employee-support', role, status: 'active' }],
  });
}

describe('deny-by-default authorization', () => {
  it('denies missing principals, wrong audiences, cross-tenant access, and missing capabilities', () => {
    const resource: Resource = {
      kind: 'check_collection',
      householdId: home,
      scope: {
        kind: 'list',
        ownerPersonId: person,
        includeOwned: true,
        includeExplicitlyShared: false,
      },
    };
    expect(authorize({ principal: null, action: 'check:list', resource }).reason).toBe(
      'missing_principal',
    );
    expect(
      authorize({ principal: principal({ audience: 'hq' }), action: 'check:list', resource })
        .reason,
    ).toBe('wrong_audience');
    expect(
      authorize({
        principal: principal(),
        action: 'check:list',
        resource: { ...resource, householdId: other },
      }).reason,
    ).toBe('outside_tenant');
    expect(
      authorize({
        principal: principal({ households: [householdScope({ capabilities: [] })] }),
        action: 'check:list',
        resource,
      }).reason,
    ).toBe('missing_capability');
  });

  it('keeps administrator and protected authority independent on one neutral membership', () => {
    const administratorAndProtected = principal({
      roles: ['household_administrator', 'protected_member'],
      households: [householdScope({ isAdministrator: true, isProtectedMember: true })],
    });
    expect(
      authorize({
        principal: administratorAndProtected,
        action: 'family:view',
        resource: { kind: 'family', householdId: home, scope: { kind: 'roster' } },
      }).allowed,
    ).toBe(true);
    expect(
      authorize({
        principal: administratorAndProtected,
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
        principal: administratorAndProtected,
        action: 'family:invite',
        resource: {
          kind: 'family',
          householdId: home,
          scope: { kind: 'subject_invitation', protectedPersonId: person },
        },
      }).allowed,
    ).toBe(true);
  });

  it('does not let administrator authority imply protected workflows', () => {
    const administrator = principal({
      roles: ['household_administrator'],
      households: [householdScope({ isAdministrator: true, isProtectedMember: false })],
    });
    expect(
      authorize({
        principal: administrator,
        action: 'family:view',
        resource: { kind: 'family', householdId: home, scope: { kind: 'roster' } },
      }).allowed,
    ).toBe(true);
    expect(
      authorize({
        principal: administrator,
        action: 'check:create',
        resource: {
          kind: 'check_collection',
          householdId: home,
          scope: { kind: 'create', artifactKind: 'text' },
        },
      }).reason,
    ).toBe('insufficient_role');
  });

  it('limits Trusted Circle reads and orientation help to the exact protected pair', () => {
    const trusted = principal({
      roles: ['trusted_circle'],
      households: [
        householdScope({
          isProtectedMember: false,
          trustedCircleGrants: [
            {
              relationshipId,
              protectedPersonId: protectedPerson,
              permissions: ['view_shared_checks', 'help_with_orientation'],
            },
          ],
          capabilities: ['history:read', 'orientation:use'],
        }),
      ],
    });
    const exactSharedCheck: Resource = {
      kind: 'check',
      householdId: home,
      ownerPersonId: protectedPerson,
      sharedWithPersonIds: [person],
    };
    expect(
      authorize({ principal: trusted, action: 'check:read', resource: exactSharedCheck }).allowed,
    ).toBe(true);
    expect(
      authorize({
        principal: trusted,
        action: 'check:read',
        resource: { ...exactSharedCheck, ownerPersonId: ids.person('person-unrelated') },
      }).reason,
    ).toBe('not_owner_or_shared');
    expect(
      authorize({
        principal: trusted,
        action: 'orientation:view',
        resource: { kind: 'orientation', householdId: home, subjectPersonId: protectedPerson },
      }).allowed,
    ).toBe(true);
    expect(
      authorize({
        principal: trusted,
        action: 'orientation:view',
        resource: {
          kind: 'orientation',
          householdId: home,
          subjectPersonId: ids.person('person-unrelated'),
        },
      }).reason,
    ).toBe('missing_relationship_permission');
  });

  it('keeps payer and billing authority from revealing Family or customer artifacts', () => {
    for (const scope of [
      householdScope({
        isProtectedMember: false,
        isPayer: true,
        capabilities: ['history:read'],
      }),
      householdScope({
        isProtectedMember: false,
        isBillingManager: true,
        capabilities: ['history:read'],
      }),
    ]) {
      const actor = principal({ households: [scope] });
      expect(
        authorize({
          principal: actor,
          action: 'family:view',
          resource: { kind: 'family', householdId: home, scope: { kind: 'roster' } },
        }).allowed,
      ).toBe(false);
      expect(
        authorize({
          principal: actor,
          action: 'family:view',
          resource: {
            kind: 'family',
            householdId: home,
            scope: { kind: 'subject_relationships', subjectPersonId: person },
          },
        }).allowed,
      ).toBe(false);
      expect(
        authorize({
          principal: actor,
          action: 'check:read',
          resource: { kind: 'check', householdId: home, ownerPersonId: protectedPerson },
        }).allowed,
      ).toBe(false);
    }
    const payer = principal({
      households: [householdScope({ isProtectedMember: false, isPayer: true })],
    });
    const billing = principal({
      households: [householdScope({ isProtectedMember: false, isBillingManager: true })],
    });
    const entitlement: Resource = { kind: 'entitlement', householdId: home };
    expect(
      authorize({ principal: payer, action: 'entitlement:view', resource: entitlement }).allowed,
    ).toBe(false);
    expect(
      authorize({ principal: billing, action: 'entitlement:view', resource: entitlement }).allowed,
    ).toBe(true);
  });

  it('models development invitations as unbound and production invitations as identity-bound', () => {
    const invitee = principal({ households: [] });
    expect(
      authorize({
        principal: invitee,
        action: 'family:accept_invitation',
        resource: {
          kind: 'invitation',
          householdId: home,
          identityBindingState: 'development_unbound',
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
          identityBindingState: 'development_unbound',
          invitedPersonId: person,
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
          identityBindingState: 'verified_identity',
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
          identityBindingState: 'verified_identity',
          invitedPersonId: ids.person('person-other'),
          credentialPresented: true,
        },
      }).allowed,
    ).toBe(false);
  });

  it('preserves participant withdrawal after entitlement lapse and distinguishes admin authority', () => {
    const pair: Resource = {
      kind: 'family',
      householdId: home,
      scope: {
        kind: 'pairwise_relationship',
        relationshipId,
        protectedPersonId: person,
        trustedPersonId: ids.person('person-trusted'),
      },
    };
    const lapsedProtected = principal({
      households: [householdScope({ isProtectedMember: false, capabilities: [] })],
    });
    expect(
      authorize({ principal: lapsedProtected, action: 'family:revoke', resource: pair }).allowed,
    ).toBe(true);
    const administrator = principal({
      personId: ids.person('person-admin'),
      roles: ['household_administrator'],
      households: [
        householdScope({ isAdministrator: true, isProtectedMember: false, capabilities: [] }),
      ],
    });
    expect(
      authorize({ principal: administrator, action: 'family:revoke', resource: pair }).allowed,
    ).toBe(true);
    const unrelated = principal({
      personId: ids.person('person-unrelated'),
      households: [householdScope({ isProtectedMember: false, capabilities: [] })],
    });
    expect(
      authorize({ principal: unrelated, action: 'family:revoke', resource: pair }).allowed,
    ).toBe(false);
  });

  it('lets an exact trusted participant relinquish even when entitlement projection lapses', () => {
    const trustedPerson = ids.person('person-trusted');
    const trusted = principal({
      personId: trustedPerson,
      households: [
        householdScope({
          isProtectedMember: false,
          trustedCircleGrants: [
            {
              relationshipId,
              protectedPersonId: protectedPerson,
              permissions: ['view_shared_checks'],
            },
          ],
        }),
      ],
    });
    const pair = (id: string): Resource => ({
      kind: 'family',
      householdId: home,
      scope: {
        kind: 'pairwise_relationship',
        relationshipId: ids.relationship(id),
        protectedPersonId: protectedPerson,
        trustedPersonId: trustedPerson,
      },
    });
    expect(
      authorize({
        principal: trusted,
        action: 'family:revoke',
        resource: pair('relationship-exact'),
      }).allowed,
    ).toBe(true);
    const unrelated = principal({
      personId: ids.person('person-other-trusted'),
      households: [householdScope({ isProtectedMember: false, trustedCircleGrants: [] })],
    });
    expect(
      authorize({
        principal: unrelated,
        action: 'family:revoke',
        resource: pair('relationship-other'),
      }).allowed,
    ).toBe(false);
  });

  it('requires active case assignment and a separate exact restricted-access grant for support', () => {
    const caseId = ids.supportCase('support-case-exact');
    const baseSupport = hqPrincipal('hq_support');
    const supportCase: Resource = { kind: 'support_case', householdId: home, caseId };
    const artifact: Resource = {
      kind: 'restricted_customer_resource',
      householdId: home,
      caseId,
      resourceType: 'artifact',
      resourceId: 'artifact-exact',
    };
    expect(
      authorize({ principal: baseSupport, action: 'hq:support_case:view', resource: supportCase })
        .allowed,
    ).toBe(false);
    const assigned = principal({
      ...baseSupport,
      supportCases: [
        {
          caseId,
          householdId: home,
          employeeAssignmentId: 'employee-support',
          purpose: 'Resolve customer request',
        },
      ],
    });
    expect(
      authorize({ principal: assigned, action: 'hq:support_case:view', resource: supportCase })
        .allowed,
    ).toBe(true);
    const nonSupport = principal({
      ...assigned,
      roles: ['hq_owner'],
      organizations: [
        { employeeAssignmentId: 'employee-support', role: 'hq_owner', status: 'active' },
      ],
    });
    expect(
      authorize({ principal: nonSupport, action: 'hq:support_case:view', resource: supportCase })
        .allowed,
    ).toBe(false);
    expect(
      authorize({ principal: assigned, action: 'hq:restricted_resource:read', resource: artifact })
        .allowed,
    ).toBe(false);
    const granted = principal({
      ...assigned,
      restrictedAccess: [
        {
          grantId: ids.restrictedAccessGrant('grant-exact'),
          caseId,
          householdId: home,
          employeeAssignmentId: 'employee-support',
          purpose: 'Inspect reported artifact',
          resourceType: 'artifact',
          resourceId: 'artifact-exact',
          expiresAt: new Date('2026-08-16T20:00:00.000Z'),
        },
      ],
    });
    expect(
      authorize({ principal: granted, action: 'hq:restricted_resource:read', resource: artifact })
        .allowed,
    ).toBe(true);
    expect(
      authorize({
        principal: granted,
        action: 'hq:restricted_resource:read',
        resource: { ...artifact, resourceId: 'artifact-other' },
      }).allowed,
    ).toBe(false);
  });

  it('exports central Business OS read and manage actions with distinct HQ policy', () => {
    expect(
      authorize({
        principal: hqPrincipal('hq_owner'),
        action: 'hq:business_os:read',
        resource: { kind: 'hq' },
      }).allowed,
    ).toBe(true);
    expect(
      authorize({
        principal: hqPrincipal('hq_owner'),
        action: 'hq:business_os:manage',
        resource: { kind: 'hq' },
      }).allowed,
    ).toBe(true);
    for (const role of ['hq_reviewer', 'hq_support'] as const) {
      expect(
        authorize({
          principal: hqPrincipal(role),
          action: 'hq:business_os:read',
          resource: { kind: 'hq' },
        }).allowed,
      ).toBe(false);
      expect(
        authorize({
          principal: hqPrincipal(role),
          action: 'hq:business_os:manage',
          resource: { kind: 'hq' },
        }).allowed,
      ).toBe(false);
    }
    expect(
      authorize({
        principal: principal(),
        action: 'hq:business_os:read',
        resource: { kind: 'hq' },
      }).reason,
    ).toBe('wrong_audience');
  });

  it('requires a matching capability for protected Check creation', () => {
    const resource: Resource = {
      kind: 'check_collection',
      householdId: home,
      scope: { kind: 'create', artifactKind: 'url' },
    };
    const capabilities: readonly Capability[] = ['check:text'];
    expect(
      authorize({
        principal: principal({ households: [householdScope({ capabilities })] }),
        action: 'check:create',
        resource,
      }).reason,
    ).toBe('missing_capability');
  });

  it('throws a content-free domain error from the assertion helper', () => {
    expect(() =>
      assertAuthorized({
        principal: principal(),
        action: 'family:view',
        resource: { kind: 'family', householdId: home, scope: { kind: 'roster' } },
      }),
    ).toThrow('The requested action is not permitted');
  });
});

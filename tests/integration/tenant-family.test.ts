import { EntitlementRepository } from '@boomerbuddy/persistence';
import { afterEach, describe, expect, it } from 'vitest';
import {
  browserHeaders,
  createApiHarness,
  customerOrigin,
  login,
  type ApiHarness,
} from './support';

describe('tenant and pairwise family boundaries', () => {
  let harness: ApiHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('lists only actor-owned or explicitly shared Checks and hides other tenants', async () => {
    harness = await createApiHarness();
    const alice = await login(harness.app, 'owner-alice');
    const terry = await login(harness.app, 'trusted-terry');
    const bob = await login(harness.app, 'owner-bob');

    const [aliceList, terryList, bobList] = await Promise.all([
      harness.app.inject({
        method: 'GET',
        url: '/v1/checks',
        headers: browserHeaders(alice.cookie as string),
      }),
      harness.app.inject({
        method: 'GET',
        url: '/v1/checks',
        headers: browserHeaders(terry.cookie as string),
      }),
      harness.app.inject({
        method: 'GET',
        url: '/v1/checks',
        headers: browserHeaders(bob.cookie as string),
      }),
    ]);
    expect(aliceList.json().checks.map((check: { id: string }) => check.id)).toEqual([
      'analysis-seed-sunrise-private',
    ]);
    expect(terryList.json().checks.map((check: { id: string }) => check.id)).toEqual([
      'analysis-seed-sunrise-shared',
    ]);
    expect(bobList.statusCode).toBe(403);
    for (const evidence of aliceList.json().checks[0].evidence as Array<{
      label: string;
      observation: string;
    }>) {
      expect(evidence.label).not.toBe(evidence.observation);
    }

    const crossTenant = await harness.app.inject({
      method: 'GET',
      url: '/v1/checks/analysis-seed-harbor-private',
      headers: browserHeaders(alice.cookie as string),
    });
    const unsharedSameTenant = await harness.app.inject({
      method: 'GET',
      url: '/v1/checks/analysis-seed-sunrise-private',
      headers: browserHeaders(terry.cookie as string),
    });
    expect(crossTenant.statusCode).toBe(404);
    expect(unsharedSameTenant.statusCode).toBe(404);
  }, 15_000);

  it('projects independent authority facts on neutral membership and denies an unprotected admin', async () => {
    harness = await createApiHarness();
    const alice = await login(harness.app, 'owner-alice');
    const pat = await login(harness.app, 'protected-pat');
    const bob = await login(harness.app, 'owner-bob');
    const household = (session: typeof alice, id: string) =>
      (session.body.principal as { households: Array<Record<string, unknown>> }).households.find(
        (candidate) => candidate.id === id,
      );
    expect(household(alice, 'household-sunrise')).toMatchObject({
      membershipKind: 'member',
      isAdministrator: true,
      isProtectedMember: true,
    });
    expect(household(pat, 'household-sunrise')).toMatchObject({
      membershipKind: 'member',
      isAdministrator: false,
      isProtectedMember: true,
    });
    expect(household(bob, 'household-harbor')).toMatchObject({
      membershipKind: 'member',
      isAdministrator: true,
      isProtectedMember: false,
      capabilities: [],
    });

    const family = await harness.app.inject({
      method: 'GET',
      url: '/v1/family',
      headers: browserHeaders(alice.cookie as string),
    });
    expect(family.statusCode).toBe(200);
    expect(
      family
        .json()
        .members.find((member: { personId: string }) => member.personId === 'person-owner-alice'),
    ).toMatchObject({
      membershipKind: 'member',
      isAdministrator: true,
      isProtectedMember: true,
    });
    expect(
      family
        .json()
        .members.find((member: { personId: string }) => member.personId === 'person-trusted-terry'),
    ).toMatchObject({
      membershipKind: 'member',
      isAdministrator: false,
      isProtectedMember: false,
    });

    for (const attempt of [
      harness.app.inject({
        method: 'POST',
        url: '/v1/checks',
        headers: browserHeaders(bob.cookie as string),
        payload: { kind: 'text', content: 'A harmless local test message.' },
      }),
      harness.app.inject({
        method: 'POST',
        url: '/v1/orientation/start',
        headers: browserHeaders(bob.cookie as string),
      }),
      harness.app.inject({
        method: 'POST',
        url: '/v1/family/invitations',
        headers: browserHeaders(bob.cookie as string),
        payload: { inviteeDisplayName: 'No allocation', permissions: ['view_shared_checks'] },
      }),
    ]) {
      expect((await attempt).statusCode).toBe(403);
    }
    const deniedMutations = await harness.database.query<{ orientations: number; checks: number }>(
      `SELECT
         (SELECT count(*)::int FROM orientation_states
          WHERE household_id = 'household-harbor' AND person_id = 'person-owner-bob')
            AS orientations,
         (SELECT count(*)::int FROM analyses
          WHERE household_id = 'household-harbor' AND requested_by = 'person-owner-bob') AS checks`,
    );
    expect(deniedMutations.rows[0]).toEqual({ orientations: 0, checks: 0 });
  }, 15_000);

  it('returns only explicit shares after protected enrollment lapses and preserves delete-own', async () => {
    harness = await createApiHarness();
    const entitlements = new EntitlementRepository(harness.database, undefined, 'local');
    await entitlements.testOnlyEnrollProtectedSelf({
      householdId: 'household-sunrise',
      personId: 'person-trusted-terry',
      actorPersonId: 'person-trusted-terry',
      consentVersion: 'test-protected-terry-v1',
      now: harness.clock.now(),
    });
    const terry = await login(harness.app, 'trusted-terry');
    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/checks',
      headers: browserHeaders(terry.cookie as string),
      payload: { kind: 'text', content: 'Please verify this ordinary local message.' },
    });
    expect(created.statusCode).toBe(201);
    const ownedCheckId = String(created.json().check.id);
    await expect(
      entitlements.testOnlyRevokeProtectedSelf({
        householdId: 'household-sunrise',
        personId: 'person-trusted-terry',
        actorPersonId: 'person-trusted-terry',
        now: harness.clock.now(),
      }),
    ).resolves.toBe(true);

    const me = await harness.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: browserHeaders(terry.cookie as string),
    });
    expect(me.json().principal.households[0]).toMatchObject({
      isProtectedMember: false,
      capabilities: ['history:read'],
    });
    const list = await harness.app.inject({
      method: 'GET',
      url: '/v1/checks',
      headers: browserHeaders(terry.cookie as string),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().checks.map((check: { id: string }) => check.id)).toEqual([
      'analysis-seed-sunrise-shared',
    ]);
    const lapsedRead = await harness.app.inject({
      method: 'GET',
      url: `/v1/checks/${ownedCheckId}`,
      headers: browserHeaders(terry.cookie as string),
    });
    expect(lapsedRead.statusCode).toBe(403);
    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: `/v1/checks/${ownedCheckId}`,
      headers: browserHeaders(terry.cookie as string),
    });
    expect(deleted.statusCode).toBe(200);
  }, 20_000);

  it('scopes capabilities to each household instead of unioning a paid tenant', async () => {
    harness = await createApiHarness();
    await harness.database.query(
      `INSERT INTO households(id, name, created_at) VALUES ('household-free','Free Household',$1)`,
      [harness.clock.now().toISOString()],
    );
    await harness.database.query(
      `INSERT INTO household_memberships(
         household_id, id, person_id, membership_kind, status, created_at
       ) VALUES ('household-free','membership-free-alice','person-owner-alice',
                 'member','active',$1)`,
      [harness.clock.now().toISOString()],
    );
    const alice = await login(harness.app, 'owner-alice');
    const me = await harness.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: alice.cookie as string, origin: customerOrigin },
    });
    const households = me.json().principal.households as Array<{
      id: string;
      capabilities: string[];
    }>;
    expect(households.find((item) => item.id === 'household-sunrise')?.capabilities).toContain(
      'check:text',
    );
    expect(households.find((item) => item.id === 'household-free')?.capabilities).toEqual([]);

    const freeCreate = await harness.app.inject({
      method: 'POST',
      url: '/v1/checks',
      headers: {
        ...browserHeaders(alice.cookie as string),
        'x-bb-household-id': 'household-free',
      },
      payload: { kind: 'text', content: 'A harmless local test message.' },
    });
    const paidCreate = await harness.app.inject({
      method: 'POST',
      url: '/v1/checks',
      headers: {
        ...browserHeaders(alice.cookie as string),
        'x-bb-household-id': 'household-sunrise',
      },
      payload: { kind: 'text', content: 'A separate harmless local test message.' },
    });
    expect(freeCreate.statusCode).toBe(403);
    expect(freeCreate.json().error.details.reason).toBe('missing_capability');
    expect(paidCreate.statusCode).toBe(201);
  });

  it('reports the true visible Check count and makes records beyond 50 discoverable', async () => {
    harness = await createApiHarness();
    const alice = await login(harness.app, 'owner-alice');
    const headers = browserHeaders(alice.cookie as string);
    for (let index = 0; index < 51; index += 1) {
      const created = await harness.app.inject({
        method: 'POST',
        url: '/v1/checks',
        headers,
        payload: { kind: 'text', content: `Local pagination example number ${index}.` },
      });
      expect(created.statusCode).toBe(201);
    }

    const pages = await Promise.all(
      [0, 25, 50].map((offset) =>
        harness!.app.inject({
          method: 'GET',
          url: `/v1/checks?limit=25&offset=${offset}`,
          headers,
        }),
      ),
    );
    for (const page of pages) {
      expect(page.statusCode).toBe(200);
      expect(page.json().total).toBe(52);
    }
    expect(pages.map((page) => page.json().checks.length)).toEqual([25, 25, 2]);
    expect(pages.map((page) => page.json().page.hasMore)).toEqual([true, true, false]);
    const ids = pages.flatMap((page) =>
      page.json().checks.map((check: { id: string }) => check.id),
    );
    expect(new Set(ids).size).toBe(52);

    const invalidPage = await harness.app.inject({
      method: 'GET',
      url: '/v1/checks?limit=101',
      headers,
    });
    expect(invalidPage.statusCode).toBe(400);
  });

  it('returns pairwise family views and accepts a credential-bound invite for an unassigned persona', async () => {
    harness = await createApiHarness();
    const alice = await login(harness.app, 'owner-alice');
    const pat = await login(harness.app, 'protected-pat');
    const terry = await login(harness.app, 'trusted-terry');
    const jordan = await login(harness.app, 'trusted-jordan');
    const bob = await login(harness.app, 'owner-bob');

    const ownerFamily = await harness.app.inject({
      method: 'GET',
      url: '/v1/family',
      headers: browserHeaders(alice.cookie as string),
    });
    const protectedFamily = await harness.app.inject({
      method: 'GET',
      url: '/v1/family',
      headers: browserHeaders(pat.cookie as string),
    });
    const trustedFamily = await harness.app.inject({
      method: 'GET',
      url: '/v1/family',
      headers: browserHeaders(terry.cookie as string),
    });
    expect(ownerFamily.json().members).toHaveLength(3);
    expect(
      protectedFamily
        .json()
        .members.map((member: { personId: string }) => member.personId)
        .sort(),
    ).toEqual(['person-protected-pat', 'person-trusted-terry']);
    expect(
      trustedFamily
        .json()
        .members.map((member: { personId: string }) => member.personId)
        .sort(),
    ).toEqual(['person-protected-pat', 'person-trusted-terry']);
    expect(protectedFamily.json().invitations).toEqual([]);
    expect(trustedFamily.json().invitations).toEqual([]);

    const unallocatedOwner = await harness.app.inject({
      method: 'POST',
      url: '/v1/family/invitations',
      headers: browserHeaders(bob.cookie as string),
      payload: {
        inviteeDisplayName: 'Jordan Unassigned',
        permissions: ['view_shared_checks'],
      },
    });
    expect(unallocatedOwner.statusCode).toBe(403);
    for (const unavailablePermission of ['receive_escalations', 'help_with_orientation']) {
      const unavailable = await harness.app.inject({
        method: 'POST',
        url: '/v1/family/invitations',
        headers: browserHeaders(pat.cookie as string),
        payload: {
          inviteeDisplayName: 'Unavailable permission',
          permissions: [unavailablePermission],
        },
      });
      expect(unavailable.statusCode).toBe(400);
      expect(unavailable.body).not.toContain('person-protected-pat');
    }
    const invited = await harness.app.inject({
      method: 'POST',
      url: '/v1/family/invitations',
      headers: browserHeaders(pat.cookie as string),
      payload: {
        inviteeDisplayName: 'Jordan Unassigned',
        permissions: ['view_shared_checks'],
      },
    });
    expect(invited.statusCode).toBe(201);
    const invitationId = String(invited.json().invitation.id);
    const pendingForPat = await harness.app.inject({
      method: 'GET',
      url: '/v1/family',
      headers: browserHeaders(pat.cookie as string),
    });
    expect(pendingForPat.json().invitations.map((item: { id: string }) => item.id)).toContain(
      invitationId,
    );
    const preview = await harness.app.inject({
      method: 'POST',
      url: `/v1/family/invitations/${invitationId}/preview`,
      headers: browserHeaders(jordan.cookie as string),
      payload: { localInviteCode: invited.json().localInviteCode },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().invitation).toMatchObject({
      household: { id: 'household-sunrise', name: 'Sunrise Household' },
      protectedPerson: { id: 'person-protected-pat', displayName: 'Pat Protected' },
      permissions: ['view_shared_checks'],
      state: 'pending',
      identityBindingState: 'development_unbound',
      previewVersion: expect.any(String),
    });
    expect(preview.body).not.toContain(String(invited.json().localInviteCode));
    const accepted = await harness.app.inject({
      method: 'POST',
      url: `/v1/family/invitations/${invitationId}/accept`,
      headers: browserHeaders(jordan.cookie as string),
      payload: {
        localInviteCode: invited.json().localInviteCode,
        previewVersion: preview.json().invitation.previewVersion,
      },
    });
    expect(accepted.statusCode).toBe(201);
    const relationshipId = String(accepted.json().relationship.id);
    const acceptedAgain = await harness.app.inject({
      method: 'POST',
      url: `/v1/family/invitations/${invitationId}/accept`,
      headers: browserHeaders(jordan.cookie as string),
      payload: {
        localInviteCode: invited.json().localInviteCode,
        previewVersion: preview.json().invitation.previewVersion,
      },
    });
    expect(acceptedAgain.statusCode).toBe(200);
    expect(acceptedAgain.json()).toMatchObject({
      relationship: { id: relationshipId },
      reused: true,
    });

    const jordanFamily = await harness.app.inject({
      method: 'GET',
      url: '/v1/family',
      headers: browserHeaders(jordan.cookie as string),
    });
    expect(jordanFamily.statusCode).toBe(200);
    expect(
      jordanFamily
        .json()
        .members.map((member: { personId: string }) => member.personId)
        .sort(),
    ).toEqual(['person-protected-pat', 'person-trusted-jordan']);
    expect(jordanFamily.body).not.toContain('person-trusted-terry');

    const patCheck = await harness.app.inject({
      method: 'POST',
      url: '/v1/checks',
      headers: browserHeaders(pat.cookie as string),
      payload: { kind: 'text', content: 'A local household message for access projection.' },
    });
    expect(patCheck.statusCode).toBe(201);
    expect(patCheck.json().check.access).toEqual({
      kind: 'owned',
      canDelete: true,
      canShare: true,
    });
    const checkId = String(patCheck.json().check.id);
    const shared = await harness.app.inject({
      method: 'POST',
      url: `/v1/checks/${checkId}/shares`,
      headers: browserHeaders(pat.cookie as string),
      payload: { sharedWithPersonId: 'person-trusted-jordan' },
    });
    expect(shared.statusCode).toBe(201);
    const jordanCheck = await harness.app.inject({
      method: 'GET',
      url: `/v1/checks/${checkId}`,
      headers: browserHeaders(jordan.cookie as string),
    });
    expect(jordanCheck.statusCode).toBe(200);
    expect(jordanCheck.json().check.access).toEqual({
      kind: 'shared',
      canDelete: false,
      canShare: false,
    });
    const jordanDelete = await harness.app.inject({
      method: 'DELETE',
      url: `/v1/checks/${checkId}`,
      headers: browserHeaders(jordan.cookie as string),
    });
    const jordanShare = await harness.app.inject({
      method: 'POST',
      url: `/v1/checks/${checkId}/shares`,
      headers: browserHeaders(jordan.cookie as string),
      payload: { sharedWithPersonId: 'person-trusted-terry' },
    });
    expect(jordanDelete.statusCode).toBe(403);
    expect(jordanShare.statusCode).toBe(403);

    const unrelatedRevoke = await harness.app.inject({
      method: 'DELETE',
      url: `/v1/family/relationships/${relationshipId}`,
      headers: browserHeaders(terry.cookie as string),
    });
    expect(unrelatedRevoke.statusCode).toBe(403);

    await harness.database.query(
      `UPDATE entitlement_grants SET capabilities = '[]'::jsonb
       WHERE household_id = 'household-sunrise'`,
    );
    const revoked = await harness.app.inject({
      method: 'DELETE',
      url: `/v1/family/relationships/${relationshipId}`,
      headers: browserHeaders(pat.cookie as string),
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({ state: 'withdrawn' });
    const afterRevocation = await harness.app.inject({
      method: 'GET',
      url: '/v1/family',
      headers: browserHeaders(jordan.cookie as string),
    });
    expect(afterRevocation.statusCode).toBe(200);
    expect(afterRevocation.json()).toMatchObject({
      members: expect.arrayContaining([
        expect.objectContaining({
          personId: 'person-trusted-jordan',
          isProtectedMember: false,
        }),
      ]),
      relationships: [
        expect.objectContaining({
          id: relationshipId,
          state: 'withdrawn',
          trustedPersonId: 'person-trusted-jordan',
        }),
      ],
      invitations: [],
      memberInvitations: [],
    });
  });

  it('lets an existing administrator and protected member accept a pair without losing authority', async () => {
    harness = await createApiHarness();
    const alice = await login(harness.app, 'owner-alice');
    const pat = await login(harness.app, 'protected-pat');
    const invited = await harness.app.inject({
      method: 'POST',
      url: '/v1/family/invitations',
      headers: browserHeaders(pat.cookie as string),
      payload: { inviteeDisplayName: 'Alice Owner', permissions: ['view_shared_checks'] },
    });
    expect(invited.statusCode).toBe(201);
    const invitationId = String(invited.json().invitation.id);
    const localInviteCode = String(invited.json().localInviteCode);
    const preview = await harness.app.inject({
      method: 'POST',
      url: `/v1/family/invitations/${invitationId}/preview`,
      headers: browserHeaders(alice.cookie as string),
      payload: { localInviteCode },
    });
    expect(preview.statusCode).toBe(200);
    const accepted = await harness.app.inject({
      method: 'POST',
      url: `/v1/family/invitations/${invitationId}/accept`,
      headers: browserHeaders(alice.cookie as string),
      payload: {
        localInviteCode,
        previewVersion: preview.json().invitation.previewVersion,
      },
    });
    expect(accepted.statusCode).toBe(201);
    const me = await harness.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: browserHeaders(alice.cookie as string),
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().principal.households[0]).toMatchObject({
      membershipKind: 'member',
      isAdministrator: true,
      isProtectedMember: true,
      trustedCircleGrants: [
        {
          relationshipId: accepted.json().relationship.id,
          protectedPersonId: 'person-protected-pat',
          permissions: ['view_shared_checks'],
        },
      ],
    });
    const authority = await harness.database.query<{
      memberships: number;
      administrators: number;
      protected_members: number;
      active_pairs: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM household_memberships
          WHERE household_id = 'household-sunrise' AND person_id = 'person-owner-alice'
            AND membership_kind = 'member' AND status = 'active') AS memberships,
         (SELECT count(*)::int FROM household_administrator_assignments
          WHERE household_id = 'household-sunrise' AND person_id = 'person-owner-alice'
            AND status = 'active') AS administrators,
         (SELECT count(*)::int FROM protected_members
          WHERE household_id = 'household-sunrise' AND person_id = 'person-owner-alice'
            AND status = 'accepted') AS protected_members,
         (SELECT count(*)::int FROM trusted_circle_relationships
          WHERE household_id = 'household-sunrise' AND trusted_person_id = 'person-owner-alice'
            AND state = 'active') AS active_pairs`,
    );
    expect(authority.rows[0]).toEqual({
      memberships: 1,
      administrators: 1,
      protected_members: 1,
      active_pairs: 1,
    });
  });

  it('does not reactivate a revoked household membership through a Trusted Circle invite', async () => {
    harness = await createApiHarness();
    const pat = await login(harness.app, 'protected-pat');
    const jordan = await login(harness.app, 'trusted-jordan');
    await harness.database.query(
      `INSERT INTO household_memberships(
         household_id, id, person_id, membership_kind, status, created_at, revoked_at
       ) VALUES (
         'household-sunrise', 'membership-revoked-jordan', 'person-trusted-jordan',
         'member', 'revoked', $1, $1
       )`,
      [harness.clock.now().toISOString()],
    );
    const invitation = await harness.app.inject({
      method: 'POST',
      url: '/v1/family/invitations',
      headers: browserHeaders(pat.cookie as string),
      payload: {
        inviteeDisplayName: 'Jordan Former Member',
        permissions: ['view_shared_checks'],
      },
    });
    expect(invitation.statusCode, invitation.body).toBe(201);
    const invitationId = String(invitation.json().invitation.id);
    const localInviteCode = String(invitation.json().localInviteCode);
    const preview = await harness.app.inject({
      method: 'POST',
      url: `/v1/family/invitations/${invitationId}/preview`,
      headers: browserHeaders(jordan.cookie as string),
      payload: { localInviteCode },
    });
    expect(preview.statusCode, preview.body).toBe(200);
    const retainedState = () =>
      harness!.database.query<{
        membership_status: string;
        invitation_state: string;
        latest_consent_evidence_id: string;
        relationships: number;
        allocations: number;
        consent_evidence: number;
        audit_events: number;
        outbox_events: number;
      }>(
        `SELECT
           membership.status AS membership_status,
           invitation.state AS invitation_state,
           invitation.latest_consent_evidence_id,
           (SELECT count(*)::int FROM trusted_circle_relationships relationship
            WHERE relationship.household_id = invitation.household_id
              AND relationship.protected_person_id = invitation.protected_person_id
              AND relationship.trusted_person_id = membership.person_id) AS relationships,
           (SELECT count(*)::int FROM commerce_allowance_allocations allocation
            WHERE allocation.household_id = invitation.household_id
              AND allocation.subject_id = membership.person_id) AS allocations,
           (SELECT count(*)::int FROM consent_evidence evidence
            WHERE evidence.household_id = invitation.household_id
              AND evidence.consent_id = invitation.consent_id) AS consent_evidence,
           (SELECT count(*)::int FROM audit_events) AS audit_events,
           (SELECT count(*)::int FROM outbox_events) AS outbox_events
         FROM invitations invitation
         JOIN household_memberships membership
           ON membership.household_id = invitation.household_id
          AND membership.person_id = 'person-trusted-jordan'
         WHERE invitation.id = $1`,
        [invitationId],
      );
    const before = await retainedState();
    expect(before.rows[0]).toMatchObject({
      membership_status: 'revoked',
      invitation_state: 'pending',
      relationships: 0,
      allocations: 0,
      consent_evidence: 1,
    });
    const denied = await harness.app.inject({
      method: 'POST',
      url: `/v1/family/invitations/${invitationId}/accept`,
      headers: browserHeaders(jordan.cookie as string),
      payload: {
        localInviteCode,
        previewVersion: preview.json().invitation.previewVersion,
      },
    });
    expect(denied.statusCode, denied.body).toBe(409);
    expect((await retainedState()).rows).toEqual(before.rows);
  });

  it('previews and cancels pending invitations with exact scope and no credential leakage', async () => {
    harness = await createApiHarness();
    const alice = await login(harness.app, 'owner-alice');
    const pat = await login(harness.app, 'protected-pat');
    const terry = await login(harness.app, 'trusted-terry');
    const jordan = await login(harness.app, 'trusted-jordan');
    const olivia = await login(harness.app, 'protected-olivia');

    const createInvitation = async (name: string) => {
      const response = await harness!.app.inject({
        method: 'POST',
        url: '/v1/family/invitations',
        headers: browserHeaders(pat.cookie as string),
        payload: {
          inviteeDisplayName: name,
          permissions: ['view_shared_checks'],
        },
      });
      expect(response.statusCode).toBe(201);
      return response;
    };

    const ownerCancelledInvite = await createInvitation('Owner safety cancellation');
    const invitationId = String(ownerCancelledInvite.json().invitation.id);
    const localInviteCode = String(ownerCancelledInvite.json().localInviteCode);
    const wrongPreview = await harness.app.inject({
      method: 'POST',
      url: `/v1/family/invitations/${invitationId}/preview`,
      headers: browserHeaders(jordan.cookie as string),
      payload: { localInviteCode: `${invitationId}.${'x'.repeat(32)}` },
    });
    expect(wrongPreview.statusCode).toBe(404);
    expect(wrongPreview.body).not.toMatch(/sunrise|pat protected|view_shared_checks|fingerprint/iu);

    const preview = await harness.app.inject({
      method: 'POST',
      url: `/v1/family/invitations/${invitationId}/preview`,
      headers: browserHeaders(jordan.cookie as string),
      payload: { localInviteCode },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.body).not.toContain(localInviteCode);
    const ownerFamily = await harness.app.inject({
      method: 'GET',
      url: '/v1/family',
      headers: browserHeaders(alice.cookie as string),
    });
    const trustedFamily = await harness.app.inject({
      method: 'GET',
      url: '/v1/family',
      headers: browserHeaders(terry.cookie as string),
    });
    expect(ownerFamily.json().invitations.map((item: { id: string }) => item.id)).toContain(
      invitationId,
    );
    expect(trustedFamily.json().invitations).toEqual([]);

    const unrelated = await harness.app.inject({
      method: 'DELETE',
      url: `/v1/family/invitations/${invitationId}`,
      headers: browserHeaders(terry.cookie as string),
    });
    const crossTenant = await harness.app.inject({
      method: 'DELETE',
      url: `/v1/family/invitations/${invitationId}`,
      headers: browserHeaders(olivia.cookie as string),
    });
    expect(unrelated.statusCode).toBe(403);
    expect(crossTenant.statusCode).toBe(404);

    const ownerCancelled = await harness.app.inject({
      method: 'DELETE',
      url: `/v1/family/invitations/${invitationId}`,
      headers: browserHeaders(alice.cookie as string),
    });
    expect(ownerCancelled.statusCode).toBe(200);
    expect(ownerCancelled.json()).toMatchObject({ id: invitationId, state: 'revoked' });
    expect(ownerCancelled.body).not.toContain(localInviteCode);
    const revokedPreview = await harness.app.inject({
      method: 'POST',
      url: `/v1/family/invitations/${invitationId}/preview`,
      headers: browserHeaders(jordan.cookie as string),
      payload: { localInviteCode },
    });
    const revokedAccept = await harness.app.inject({
      method: 'POST',
      url: `/v1/family/invitations/${invitationId}/accept`,
      headers: browserHeaders(jordan.cookie as string),
      payload: {
        localInviteCode,
        previewVersion: preview.json().invitation.previewVersion,
      },
    });
    const cancelledAgain = await harness.app.inject({
      method: 'DELETE',
      url: `/v1/family/invitations/${invitationId}`,
      headers: browserHeaders(alice.cookie as string),
    });
    expect(revokedPreview.statusCode).toBe(404);
    expect(revokedAccept.statusCode).toBe(404);
    expect(cancelledAgain.statusCode).toBe(404);

    const selfCancelledInvite = await createInvitation('Protected self cancellation');
    const selfCancelledId = String(selfCancelledInvite.json().invitation.id);
    const selfCancelled = await harness.app.inject({
      method: 'DELETE',
      url: `/v1/family/invitations/${selfCancelledId}`,
      headers: browserHeaders(pat.cookie as string),
    });
    expect(selfCancelled.statusCode).toBe(200);
    expect(selfCancelled.json()).toMatchObject({ id: selfCancelledId, state: 'withdrawn' });

    const expiredInvite = await createInvitation('Expired credential');
    const expiredId = String(expiredInvite.json().invitation.id);
    const expiredCode = String(expiredInvite.json().localInviteCode);
    const beforeExpiry = await harness.app.inject({
      method: 'POST',
      url: `/v1/family/invitations/${expiredId}/preview`,
      headers: browserHeaders(jordan.cookie as string),
      payload: { localInviteCode: expiredCode },
    });
    expect(beforeExpiry.statusCode).toBe(200);
    await harness.database.query(`UPDATE invitations SET expires_at = $2 WHERE id = $1`, [
      expiredId,
      new Date(harness.clock.now().getTime() - 1).toISOString(),
    ]);
    const expiredPreview = await harness.app.inject({
      method: 'POST',
      url: `/v1/family/invitations/${expiredId}/preview`,
      headers: browserHeaders(jordan.cookie as string),
      payload: { localInviteCode: expiredCode },
    });
    const expiredAccept = await harness.app.inject({
      method: 'POST',
      url: `/v1/family/invitations/${expiredId}/accept`,
      headers: browserHeaders(jordan.cookie as string),
      payload: {
        localInviteCode: expiredCode,
        previewVersion: beforeExpiry.json().invitation.previewVersion,
      },
    });
    const expiredCancel = await harness.app.inject({
      method: 'DELETE',
      url: `/v1/family/invitations/${expiredId}`,
      headers: browserHeaders(pat.cookie as string),
    });
    expect(expiredPreview.statusCode).toBe(404);
    expect(expiredAccept.statusCode).toBe(404);
    expect(expiredCancel.statusCode).toBe(404);

    const lifecycleFacts = await harness.database.query<{ action: string }>(
      `SELECT action FROM audit_events
       WHERE resource_id IN ($1, $2) ORDER BY occurred_at`,
      [invitationId, selfCancelledId],
    );
    expect(lifecycleFacts.rows.map((row) => row.action)).toEqual([
      'family.invitation_created',
      'family.invitation_revoked',
      'family.invitation_created',
      'family.invitation_withdrawn',
    ]);
    const eventPayloads = await harness.database.query<{ payload: unknown }>(
      `SELECT payload FROM outbox_events
       WHERE aggregate_id IN ($1, $2) ORDER BY occurred_at`,
      [invitationId, selfCancelledId],
    );
    expect(JSON.stringify(eventPayloads.rows)).not.toContain(localInviteCode);
  });

  it('keeps shared-result acknowledgement and closure pairwise, monotonic, and idempotent', async () => {
    harness = await createApiHarness();
    const pat = await login(harness.app, 'protected-pat');
    const terry = await login(harness.app, 'trusted-terry');
    const alice = await login(harness.app, 'owner-alice');
    const checkId = 'analysis-seed-sunrise-shared';

    const closeBeforeAcknowledgement = await harness.app.inject({
      method: 'POST',
      url: `/v1/checks/${checkId}/shares/person-trusted-terry/closure`,
      headers: browserHeaders(pat.cookie as string),
      payload: { resolution: 'safer_action_completed' },
    });
    expect(closeBeforeAcknowledgement.statusCode).toBe(409);
    const wrongActor = await harness.app.inject({
      method: 'POST',
      url: `/v1/checks/${checkId}/share-acknowledgement`,
      headers: browserHeaders(alice.cookie as string),
      payload: {},
    });
    expect(wrongActor.statusCode).toBe(404);
    await expect(
      harness.database.query(
        `UPDATE check_shares
         SET lifecycle_state = 'acknowledged',
             acknowledged_by_person_id = 'person-owner-alice', acknowledged_at = $2
         WHERE household_id = 'household-sunrise' AND analysis_id = $1
           AND shared_with_person_id = 'person-trusted-terry'`,
        [checkId, harness.clock.now().toISOString()],
      ),
    ).rejects.toThrow();
    await expect(
      harness.database.query(
        `INSERT INTO check_share_lifecycle_events(
           id, household_id, analysis_id, shared_with_person_id, actor_person_id,
           event_kind, state_after, created_at
         ) VALUES (
           'share-event-forged-ack','household-sunrise',$1,'person-trusted-terry',
           'person-trusted-terry','acknowledged','acknowledged',$2
         )`,
        [checkId, harness.clock.now().toISOString()],
      ),
    ).rejects.toThrow('does not match the retained share state');

    const acknowledge = () =>
      harness!.app.inject({
        method: 'POST',
        url: `/v1/checks/${checkId}/share-acknowledgement`,
        headers: browserHeaders(terry.cookie as string),
        payload: {},
      });
    const acknowledged = await acknowledge();
    const acknowledgedAgain = await acknowledge();
    expect(acknowledged.statusCode, acknowledged.body).toBe(200);
    expect(acknowledgedAgain.statusCode, acknowledgedAgain.body).toBe(200);
    expect(acknowledged.json().share).toMatchObject({
      checkId,
      sharedWithPersonId: 'person-trusted-terry',
      state: 'acknowledged',
    });
    expect(acknowledgedAgain.json().share.acknowledgedAt).toBe(
      acknowledged.json().share.acknowledgedAt,
    );
    await expect(
      harness.database.query(
        `UPDATE check_shares
         SET lifecycle_state = 'closed', closed_by_person_id = 'person-trusted-terry',
             closed_at = $2, closure_reason = 'safer_action_completed'
         WHERE household_id = 'household-sunrise' AND analysis_id = $1
           AND shared_with_person_id = 'person-trusted-terry'`,
        [checkId, harness.clock.now().toISOString()],
      ),
    ).rejects.toThrow();
    await expect(
      harness.database.query(
        `INSERT INTO check_share_lifecycle_events(
           id, household_id, analysis_id, shared_with_person_id, actor_person_id,
           event_kind, state_after, closure_reason, created_at
         ) VALUES (
           'share-event-forged-close','household-sunrise',$1,'person-trusted-terry',
           'person-trusted-terry','closed','closed','safer_action_completed',$2
         )`,
        [checkId, harness.clock.now().toISOString()],
      ),
    ).rejects.toThrow('exact participant');

    const close = (resolution: 'safer_action_completed' | 'no_longer_needs_help') =>
      harness!.app.inject({
        method: 'POST',
        url: `/v1/checks/${checkId}/shares/person-trusted-terry/closure`,
        headers: browserHeaders(pat.cookie as string),
        payload: { resolution },
      });
    const closed = await close('safer_action_completed');
    const closedAgain = await close('safer_action_completed');
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closedAgain.statusCode, closedAgain.body).toBe(200);
    expect(closed.json().share).toMatchObject({
      state: 'closed',
      closureReason: 'safer_action_completed',
    });
    expect(closedAgain.json().share.closedAt).toBe(closed.json().share.closedAt);
    expect((await close('no_longer_needs_help')).statusCode).toBe(409);
    const listed = await harness.app.inject({
      method: 'GET',
      url: `/v1/checks/${checkId}/shares`,
      headers: browserHeaders(terry.cookie as string),
    });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().shares).toEqual([
      expect.objectContaining({ state: 'closed', closureReason: 'safer_action_completed' }),
    ]);

    const lifecycleEvents = await harness.database.query<{ event_kind: string }>(
      `SELECT event_kind FROM check_share_lifecycle_events
       WHERE analysis_id = $1 ORDER BY created_at, event_kind`,
      [checkId],
    );
    expect(lifecycleEvents.rows.map((row) => row.event_kind)).toEqual([
      'acknowledged',
      'closed',
      'shared',
    ]);
    await expect(
      harness.database.query(
        `UPDATE check_share_lifecycle_events SET created_at = $2
         WHERE analysis_id = $1 AND event_kind = 'acknowledged'`,
        [checkId, new Date(harness.clock.now().getTime() + 1).toISOString()],
      ),
    ).rejects.toThrow('append-only');
    await expect(
      harness.database.query(
        `DELETE FROM check_share_lifecycle_events
         WHERE analysis_id = $1 AND event_kind = 'closed'`,
        [checkId],
      ),
    ).rejects.toThrow('append-only');
  });

  it('ties Check sharing to the protected owner pair and removes access on revocation', async () => {
    harness = await createApiHarness();
    const alice = await login(harness.app, 'owner-alice');
    const pat = await login(harness.app, 'protected-pat');
    const terry = await login(harness.app, 'trusted-terry');
    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/checks',
      headers: browserHeaders(pat.cookie as string),
      payload: { kind: 'text', content: 'Please act now and verify independently.' },
    });
    const checkId = String(created.json().check.id);
    const shared = await harness.app.inject({
      method: 'POST',
      url: `/v1/checks/${checkId}/shares`,
      headers: browserHeaders(pat.cookie as string),
      payload: { sharedWithPersonId: 'person-trusted-terry' },
    });
    expect(shared.statusCode).toBe(201);
    const visible = await harness.app.inject({
      method: 'GET',
      url: `/v1/checks/${checkId}`,
      headers: browserHeaders(terry.cookie as string),
    });
    expect(visible.statusCode).toBe(200);
    await expect(
      harness.database.query(
        `UPDATE trusted_circle_relationships SET permissions = '[]'::jsonb
         WHERE household_id = 'household-sunrise'
           AND id = 'relationship-sunrise-pat-terry'`,
      ),
    ).rejects.toThrow('relationship authority changes require new consent evidence');

    const invalidOwnerShare = await harness.app.inject({
      method: 'POST',
      url: '/v1/checks/analysis-seed-sunrise-private/shares',
      headers: browserHeaders(alice.cookie as string),
      payload: { sharedWithPersonId: 'person-trusted-terry' },
    });
    expect(invalidOwnerShare.statusCode).toBe(403);

    const revoked = await harness.app.inject({
      method: 'DELETE',
      url: '/v1/family/relationships/relationship-sunrise-pat-terry',
      headers: browserHeaders(alice.cookie as string),
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({ state: 'suspended' });
    const noLongerVisible = await harness.app.inject({
      method: 'GET',
      url: `/v1/checks/${checkId}`,
      headers: browserHeaders(terry.cookie as string),
    });
    expect(noLongerVisible.statusCode).toBe(404);

    const reconsentInvite = await harness.app.inject({
      method: 'POST',
      url: '/v1/family/invitations',
      headers: browserHeaders(pat.cookie as string),
      payload: { inviteeDisplayName: 'Terry re-consent', permissions: ['view_shared_checks'] },
    });
    const reconsentId = String(reconsentInvite.json().invitation.id);
    const reconsentCode = String(reconsentInvite.json().localInviteCode);
    const reconsentPreview = await harness.app.inject({
      method: 'POST',
      url: `/v1/family/invitations/${reconsentId}/preview`,
      headers: browserHeaders(terry.cookie as string),
      payload: { localInviteCode: reconsentCode },
    });
    const reaccepted = await harness.app.inject({
      method: 'POST',
      url: `/v1/family/invitations/${reconsentId}/accept`,
      headers: browserHeaders(terry.cookie as string),
      payload: {
        localInviteCode: reconsentCode,
        previewVersion: reconsentPreview.json().invitation.previewVersion,
      },
    });
    expect(reaccepted.statusCode).toBe(201);
    expect(reaccepted.json()).toMatchObject({
      householdId: 'household-sunrise',
      relationship: { id: 'relationship-sunrise-pat-terry', state: 'active' },
    });
    const reshared = await harness.app.inject({
      method: 'POST',
      url: `/v1/checks/${checkId}/shares`,
      headers: browserHeaders(pat.cookie as string),
      payload: { sharedWithPersonId: 'person-trusted-terry' },
    });
    expect(reshared.statusCode).toBe(201);
    const visibleAgain = await harness.app.inject({
      method: 'GET',
      url: `/v1/checks/${checkId}`,
      headers: browserHeaders(terry.cookie as string),
    });
    expect(visibleAgain.statusCode).toBe(200);
  });

  it('lets the exact Trusted Circle participant revoke after entitlement lapse', async () => {
    harness = await createApiHarness();
    const terry = await login(harness.app, 'trusted-terry');
    await harness.database.query(
      `UPDATE entitlement_grants SET capabilities = '[]'::jsonb
       WHERE household_id = 'household-sunrise'`,
    );
    const revoked = await harness.app.inject({
      method: 'DELETE',
      url: '/v1/family/relationships/relationship-sunrise-pat-terry',
      headers: browserHeaders(terry.cookie as string),
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({ state: 'relinquished' });
    const membership = await harness.database.query<{ status: string }>(
      `SELECT status FROM household_memberships
       WHERE household_id = 'household-sunrise' AND person_id = 'person-trusted-terry'`,
    );
    expect(membership.rows[0]?.status).toBe('active');
    const afterRevocation = await harness.app.inject({
      method: 'GET',
      url: '/v1/family',
      headers: browserHeaders(terry.cookie as string),
    });
    expect(afterRevocation.statusCode).toBe(200);
    expect(afterRevocation.json()).toMatchObject({
      members: expect.arrayContaining([
        expect.objectContaining({
          personId: 'person-trusted-terry',
          isProtectedMember: false,
        }),
      ]),
      relationships: [
        expect.objectContaining({
          id: 'relationship-sunrise-pat-terry',
          state: 'relinquished',
          trustedPersonId: 'person-trusted-terry',
        }),
      ],
      invitations: [],
      memberInvitations: [],
    });
  });
});

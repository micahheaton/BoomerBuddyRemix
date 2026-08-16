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
    const entitlements = new EntitlementRepository(harness.database);
    await entitlements.enrollProtectedSelf({
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
      entitlements.revokeProtectedSelf({
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
    expect(acceptedAgain.statusCode).toBe(404);

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
    expect(afterRevocation.statusCode).toBe(403);
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
    expect(afterRevocation.statusCode).toBe(403);
  });
});

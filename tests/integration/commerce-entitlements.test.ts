import { CommerceOperationsRepository, EntitlementRepository } from '@boomerbuddy/persistence';
import { afterEach, describe, expect, it } from 'vitest';
import { browserHeaders, createApiHarness, hqOrigin, login, type ApiHarness } from './support';

describe('provider-neutral commerce and household allowances', () => {
  let harness: ApiHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('projects canonical plans and removes authorization when the backing source stops qualifying', async () => {
    harness = await createApiHarness();
    const alice = await login(harness.app, 'owner-alice');
    const bob = await login(harness.app, 'owner-bob');
    const heidi = await login(harness.app, 'hq-heidi', 'hq');

    const publicConfig = await harness.app.inject({ method: 'GET', url: '/v1/public/config' });
    expect(publicConfig.statusCode).toBe(200);
    expect(publicConfig.json().pricing).toEqual([
      expect.objectContaining({ key: 'free', monthlyUsd: 0, annualUsd: 0, hypothesis: true }),
      expect.objectContaining({ key: 'plus', monthlyUsd: 8.99, annualUsd: 89 }),
      expect.objectContaining({
        key: 'family',
        monthlyUsd: 14.99,
        annualUsd: 149,
        foundingAnnualUsd: 119,
      }),
    ]);

    const aliceEntitlements = await harness.app.inject({
      method: 'GET',
      url: '/v1/entitlements',
      headers: browserHeaders(alice.cookie as string),
    });
    expect(aliceEntitlements.statusCode).toBe(200);
    expect(aliceEntitlements.json()).toMatchObject({
      environment: 'test',
      commerce: {
        accessState: 'effective',
        mode: 'local_mock',
        hypothesis: true,
        primary: {
          source: 'local',
          lifecycle: 'active',
          sourceVerified: true,
          reconciliationState: 'not_required',
          plan: { key: 'family', version: 1, state: 'hypothesis' },
        },
        allowances: expect.arrayContaining([
          expect.objectContaining({
            kind: 'protected_members',
            limit: 3,
            used: 2,
            remaining: 1,
            state: 'available',
          }),
          expect.objectContaining({
            kind: 'trusted_circle_participants',
            limit: 6,
            used: 1,
            remaining: 5,
            state: 'available',
          }),
        ]),
      },
    });
    expect(aliceEntitlements.body).not.toMatch(/payer|external_subscription/iu);

    const bobEntitlements = await harness.app.inject({
      method: 'GET',
      url: '/v1/entitlements',
      headers: browserHeaders(bob.cookie as string),
    });
    expect(bobEntitlements.statusCode).toBe(200);
    expect(bobEntitlements.json().commerce.primary.plan.key).toBe('free');
    expect(
      bobEntitlements
        .json()
        .commerce.sources.filter((source: { accessState: string }) =>
          ['unverified_source', 'expired', 'inactive_lifecycle'].includes(source.accessState),
        ).length,
    ).toBeGreaterThanOrEqual(3);

    const overviewBefore = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/overview',
      headers: { cookie: heidi.cookie as string, origin: hqOrigin },
    });
    expect(
      overviewBefore
        .json()
        .metrics.find((metric: { key: string }) => metric.key === 'entitled_households').value,
    ).toBe(2);

    await harness.database.query(
      `UPDATE commerce_subscriptions SET source_verified = false
       WHERE household_id = 'household-harbor' AND id = 'subscription-local-harbor'`,
    );
    const unverifiedMe = await harness.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: browserHeaders(bob.cookie as string),
    });
    expect(unverifiedMe.json().principal.households[0].capabilities).toEqual([]);
    await harness.database.query(
      `UPDATE commerce_subscriptions SET source_verified = true, lifecycle = 'expired'
       WHERE household_id = 'household-harbor' AND id = 'subscription-local-harbor'`,
    );
    const expiredMe = await harness.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: browserHeaders(bob.cookie as string),
    });
    expect(expiredMe.json().principal.households[0].capabilities).toEqual([]);
    const deniedCheck = await harness.app.inject({
      method: 'POST',
      url: '/v1/checks',
      headers: browserHeaders(bob.cookie as string),
      payload: { kind: 'text', content: 'A harmless local commerce authorization check.' },
    });
    expect(deniedCheck.statusCode).toBe(403);
    expect(deniedCheck.json().error.details.reason).toBe('missing_capability');

    const overviewAfter = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/overview',
      headers: { cookie: heidi.cookie as string, origin: hqOrigin },
    });
    const householdsAfter = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/households',
      headers: { cookie: heidi.cookie as string, origin: hqOrigin },
    });
    expect(
      overviewAfter
        .json()
        .metrics.find((metric: { key: string }) => metric.key === 'entitled_households').value,
    ).toBe(1);
    expect(
      householdsAfter
        .json()
        .households.find((item: { id: string }) => item.id === 'household-sunrise')
        .entitlementState,
    ).toBe('active');
    expect(
      householdsAfter
        .json()
        .households.find((item: { id: string }) => item.id === 'household-harbor').entitlementState,
    ).toBe('inactive');
  }, 30_000);

  it('enforces immutable plan linkage and idempotent content-minimized commerce evidence', async () => {
    harness = await createApiHarness();
    await expect(
      harness.database.query(
        `INSERT INTO entitlement_grants(
           household_id, id, source, capabilities, starts_at, source_verified,
           precedence, plan_version_id, subscription_id
         ) VALUES ('household-sunrise','grant-invalid-plan','local','[]'::jsonb,$1,true,
           1,'plus_v1','subscription-local-sunrise')`,
        [harness.clock.now().toISOString()],
      ),
    ).rejects.toThrow();
    await harness.database.query(
      `INSERT INTO persons(id, display_name, created_at)
       VALUES ('person-db-protected-subject','DB protected subject',$1)`,
      [harness.clock.now().toISOString()],
    );
    await harness.database.query(
      `INSERT INTO household_memberships(
         household_id, id, person_id, role, status, permissions, created_at
       ) VALUES ('household-sunrise','membership-db-protected-subject',
         'person-db-protected-subject','household_owner','active','[]'::jsonb,$1)`,
      [harness.clock.now().toISOString()],
    );
    await expect(
      harness.database.query(
        `INSERT INTO commerce_allowance_allocations(
           household_id, id, entitlement_grant_id, allowance_key, subject_kind,
           subject_id, state, allocated_at
         ) VALUES ('household-sunrise','allocation-invalid-pair','grant-local-sunrise',
           'protected_members','trusted_circle_person','person-db-protected-subject','active',$1)`,
        [harness.clock.now().toISOString()],
      ),
    ).rejects.toThrow();
    await harness.database.query(
      `INSERT INTO commerce_allowance_allocations(
         household_id, id, entitlement_grant_id, allowance_key, subject_kind,
         subject_id, state, allocated_at
       ) VALUES ('household-sunrise','allocation-db-protected','grant-local-sunrise',
         'protected_members','protected_member','person-db-protected-subject','active',$1)`,
      [harness.clock.now().toISOString()],
    );
    await expect(
      harness.database.query(
        `INSERT INTO protected_members(
           household_id, person_id, status, consented_by_person_id, consent_version,
           allowance_allocation_id, accepted_at, created_at, updated_at
         ) VALUES ('household-sunrise','person-trusted-terry','accepted','person-trusted-terry',
           'invalid-subject-proof','allocation-db-protected',$1,$1,$1)`,
        [harness.clock.now().toISOString()],
      ),
    ).rejects.toThrow(/active protected allowance/iu);
    await expect(
      harness.database.query(
        `UPDATE commerce_plan_versions SET display_name = 'Mutable'
         WHERE id = 'family_v1'`,
      ),
    ).rejects.toThrow(/immutable/iu);

    await harness.database.query(
      `INSERT INTO commerce_plan_versions(
         id, product_version_id, plan_key, version, display_name, state,
         capabilities, allowances, prices, available_from, created_at
       ) SELECT 'family_retired_v2', product_version_id, plan_key, 2, 'Retired Family',
           'retired', capabilities, allowances, prices, available_from, $1
         FROM commerce_plan_versions WHERE id = 'family_v1'`,
      [harness.clock.now().toISOString()],
    );
    await harness.database.query(
      `INSERT INTO commerce_subscriptions(
         household_id, id, plan_version_id, source, lifecycle, source_verified, precedence,
         current_period_starts_at, current_period_ends_at, reconciliation_state,
         created_at, updated_at
       ) VALUES ('household-sunrise','subscription-retired-local','family_retired_v2',
         'local','active',true,999,$1,$2,'not_required',$1,$1),
         ('household-sunrise','subscription-web-hypothesis','plus_v1',
         'web','active',true,998,$1,$2,'pending',$1,$1)`,
      [
        harness.clock.now().toISOString(),
        new Date(harness.clock.now().getTime() + 86_400_000).toISOString(),
      ],
    );
    await harness.database.query(
      `INSERT INTO commerce_provider_subscription_records(
         id, household_id, subscription_id, provider, environment,
         external_subscription_id, raw_state, observed_at, verified_at
       ) VALUES ('provider-retired-local','household-sunrise','subscription-retired-local',
         'local','local','retired-local','active',$1,$1)`,
      [harness.clock.now().toISOString()],
    );
    await harness.database.query(
      `INSERT INTO entitlement_grants(
         household_id, id, source, capabilities, starts_at, source_verified, precedence,
         plan_version_id, subscription_id
       ) VALUES
         ('household-sunrise','grant-retired-local','local',
          '["check:text","family:manage"]'::jsonb,$1,true,999,
          'family_retired_v2','subscription-retired-local'),
         ('household-sunrise','grant-web-hypothesis','web',
          '["check:text","family:manage"]'::jsonb,$1,true,998,
          'plus_v1','subscription-web-hypothesis')`,
      [harness.clock.now().toISOString()],
    );
    const entitlements = await new EntitlementRepository(harness.database).forHousehold(
      'household-sunrise',
      harness.clock.now(),
    );
    expect(entitlements.portfolio.primarySource?.subscriptionId).toBe('subscription-local-sunrise');
    expect(
      entitlements.portfolio.sources
        .filter((source) =>
          ['subscription-retired-local', 'subscription-web-hypothesis'].includes(
            source.subscriptionId,
          ),
        )
        .every((source) => source.accessState !== 'effective'),
    ).toBe(true);

    const commerce = new CommerceOperationsRepository(harness.database, Buffer.alloc(32, 11), 1);
    const first = await commerce.captureLocalEvent({
      environment: 'test',
      externalEventId: 'event-local-1',
      eventType: 'subscription.observed',
      canonicalPayload: '{"state":"active"}',
      now: harness.clock.now(),
    });
    const duplicate = await commerce.captureLocalEvent({
      environment: 'test',
      externalEventId: 'event-local-1',
      eventType: 'subscription.observed',
      canonicalPayload: '{"state":"active"}',
      now: harness.clock.now(),
    });
    expect(first.duplicate).toBe(false);
    expect(duplicate).toMatchObject({ id: first.id, duplicate: true });
    await expect(
      commerce.captureLocalEvent({
        environment: 'test',
        externalEventId: 'event-local-1',
        eventType: 'subscription.observed',
        canonicalPayload: '{"state":"expired"}',
        now: harness.clock.now(),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const inbox = await harness.database.query<{
      payload_hmac: string;
      fingerprint_key_version: number;
    }>(
      `SELECT payload_hmac, fingerprint_key_version FROM commerce_event_inbox
       WHERE external_event_id = 'event-local-1'`,
    );
    expect(inbox.rows[0]?.payload_hmac).not.toContain('active');
    expect(inbox.rows[0]?.fingerprint_key_version).toBe(1);
    const rawPayloadColumn = await harness.database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM information_schema.columns
       WHERE table_name = 'commerce_event_inbox' AND column_name = 'payload'`,
    );
    expect(rawPayloadColumn.rows[0]?.count).toBe(0);
    const reconciliationId = await commerce.startLocalReconciliation({
      environment: 'test',
      now: harness.clock.now(),
    });
    await expect(
      commerce.completeLocalReconciliation({
        id: reconciliationId,
        environment: 'test',
        checkedCount: 4,
        mismatchCount: 1,
        now: harness.clock.now(),
      }),
    ).resolves.toBe(true);
    await expect(
      commerce.completeLocalReconciliation({
        id: reconciliationId,
        environment: 'test',
        checkedCount: 4,
        mismatchCount: 0,
        now: harness.clock.now(),
      }),
    ).resolves.toBe(false);
  });

  it('combines sponsor and personal sources without double-counting usage and survives sponsor loss', async () => {
    harness = await createApiHarness();
    const bob = await login(harness.app, 'owner-bob');
    const future = new Date(harness.clock.now().getTime() + 86_400_000).toISOString();
    await harness.database.query(
      `UPDATE commerce_sponsorships SET state = 'active', ends_at = $1
       WHERE id = 'sponsorship-synthetic-expired'`,
      [future],
    );
    await harness.database.query(
      `UPDATE commerce_sponsorship_allocations
       SET state = 'active', source_verified = true, ends_at = $1
       WHERE household_id = 'household-harbor'
         AND id = 'sponsorship-allocation-harbor-expired'`,
      [future],
    );
    await harness.database.query(
      `UPDATE commerce_subscriptions
       SET lifecycle = 'active', current_period_starts_at = $1,
           current_period_ends_at = $2, source_verified = true
       WHERE household_id = 'household-harbor'
         AND id = 'subscription-sponsor-harbor-expired'`,
      [harness.clock.now().toISOString(), future],
    );
    await harness.database.query(
      `UPDATE entitlement_grants SET starts_at = $1, ends_at = $2, revoked_at = NULL
       WHERE household_id = 'household-harbor'
         AND id = 'grant-sponsor-harbor-expired'`,
      [harness.clock.now().toISOString(), future],
    );
    const overlapped = await harness.app.inject({
      method: 'GET',
      url: '/v1/entitlements',
      headers: browserHeaders(bob.cookie as string),
    });
    expect(overlapped.statusCode).toBe(200);
    expect(overlapped.json().commerce.primary).toMatchObject({
      source: 'sponsor',
      lifecycle: 'active',
      plan: { key: 'plus' },
    });
    expect(overlapped.json().capabilities).toContain('family:manage');
    expect(overlapped.json().commerce.allowances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'protected_members', limit: 1, used: 1 }),
        expect.objectContaining({ kind: 'trusted_circle_participants', limit: 2, used: 0 }),
      ]),
    );
    const allocations = await harness.database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM commerce_allowance_allocations
       WHERE household_id = 'household-harbor' AND state = 'active'`,
    );
    expect(allocations.rows[0]?.count).toBe(1);

    await harness.database.query(
      `UPDATE commerce_sponsorships SET state = 'ended'
       WHERE id = 'sponsorship-synthetic-expired'`,
    );
    const afterLoss = await harness.app.inject({
      method: 'GET',
      url: '/v1/entitlements',
      headers: browserHeaders(bob.cookie as string),
    });
    expect(afterLoss.json().commerce.primary.plan.key).toBe('free');
    expect(afterLoss.json().capabilities).toContain('check:text');
    expect(afterLoss.json().capabilities).not.toContain('family:manage');
  });

  it('enforces exact participant limits at acceptance and reuses a released seat', async () => {
    harness = await createApiHarness();
    const entitlements = new EntitlementRepository(harness.database);
    await expect(
      entitlements.enrollProtectedSelf({
        householdId: 'household-harbor',
        personId: 'person-owner-bob',
        actorPersonId: 'person-owner-bob',
        consentVersion: 'test-bob-over-limit',
        now: harness.clock.now(),
      }),
    ).rejects.toMatchObject({
      code: 'not_authorized',
      safeDetails: { allowance: 'protected_members', reason: 'limit_exceeded' },
    });
    await expect(
      entitlements.allocate({
        householdId: 'household-harbor',
        kind: 'protected_members',
        subjectKind: 'protected_member',
        subjectId: 'person-over-limit-protected',
        now: harness.clock.now(),
      }),
    ).rejects.toMatchObject({
      code: 'not_authorized',
      safeDetails: { allowance: 'protected_members', reason: 'limit_exceeded' },
    });

    for (let index = 1; index <= 5; index += 1) {
      const personId = `person-cap-${index}`;
      await harness.database.query(
        `INSERT INTO persons(id, display_name, created_at) VALUES ($1,$2,$3)`,
        [personId, `Capacity ${index}`, harness.clock.now().toISOString()],
      );
      await harness.database.query(
        `INSERT INTO household_memberships(
           household_id, id, person_id, role, status, permissions, created_at
         ) VALUES ('household-sunrise',$1,$2,'trusted_circle','active',
           '["view_shared_checks"]'::jsonb,$3)`,
        [`membership-cap-${index}`, personId, harness.clock.now().toISOString()],
      );
      await entitlements.allocate({
        householdId: 'household-sunrise',
        kind: 'trusted_circle_participants',
        subjectKind: 'trusted_circle_person',
        subjectId: personId,
        now: harness.clock.now(),
      });
    }
    const full = await entitlements.forHousehold('household-sunrise', harness.clock.now());
    expect(
      full.portfolio.allowances.find(
        (allowance) => allowance.kind === 'trusted_circle_participants',
      ),
    ).toMatchObject({ limit: 6, used: 6, remaining: 0, state: 'exhausted' });

    const pat = await login(harness.app, 'protected-pat');
    const jordan = await login(harness.app, 'trusted-jordan');
    const invited = await harness.app.inject({
      method: 'POST',
      url: '/v1/family/invitations',
      headers: browserHeaders(pat.cookie as string),
      payload: { inviteeDisplayName: 'Jordan at limit', permissions: ['view_shared_checks'] },
    });
    const invitationId = String(invited.json().invitation.id);
    const localInviteCode = String(invited.json().localInviteCode);
    const preview = await harness.app.inject({
      method: 'POST',
      url: `/v1/family/invitations/${invitationId}/preview`,
      headers: browserHeaders(jordan.cookie as string),
      payload: { localInviteCode },
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
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.details).toMatchObject({
      allowance: 'trusted_circle_participants',
      reason: 'limit_exceeded',
    });
    const stillPending = await harness.database.query<{ state: string; memberships: number }>(
      `SELECT i.state,
         (SELECT count(*)::int FROM household_memberships
          WHERE household_id = i.household_id AND person_id = 'person-trusted-jordan')
           AS memberships
       FROM invitations i WHERE i.id = $1`,
      [invitationId],
    );
    expect(stillPending.rows[0]).toEqual({ state: 'pending', memberships: 0 });

    const released = await harness.app.inject({
      method: 'DELETE',
      url: '/v1/family/relationships/relationship-sunrise-pat-terry',
      headers: browserHeaders(pat.cookie as string),
    });
    expect(released.statusCode).toBe(200);
    const accepted = await harness.app.inject({
      method: 'POST',
      url: `/v1/family/invitations/${invitationId}/accept`,
      headers: browserHeaders(jordan.cookie as string),
      payload: {
        localInviteCode,
        previewVersion: preview.json().invitation.previewVersion,
      },
    });
    expect(accepted.statusCode).toBe(201);
    const finalAllocations = await harness.database.query<{ active: number; released: number }>(
      `SELECT
         count(*) FILTER (WHERE state = 'active')::int AS active,
         count(*) FILTER (WHERE state = 'released')::int AS released
       FROM commerce_allowance_allocations
       WHERE household_id = 'household-sunrise'
         AND allowance_key = 'trusted_circle_participants'`,
    );
    expect(finalAllocations.rows[0]).toEqual({ active: 6, released: 1 });
  }, 30_000);

  it('reuses one active Trusted Circle membership across separately consented protected pairs', async () => {
    harness = await createApiHarness();
    const entitlements = new EntitlementRepository(harness.database);
    await harness.database.query(
      `INSERT INTO household_memberships(
         household_id, id, person_id, role, status, permissions, created_at
       ) VALUES ('household-sunrise','membership-sunrise-olivia','person-protected-olivia',
         'protected_member','active','[]'::jsonb,$1)`,
      [harness.clock.now().toISOString()],
    );
    await entitlements.enrollProtectedSelf({
      householdId: 'household-sunrise',
      personId: 'person-protected-olivia',
      actorPersonId: 'person-protected-olivia',
      consentVersion: 'test-protected-self-v1',
      now: harness.clock.now(),
    });
    const alice = await login(harness.app, 'owner-alice');
    const pat = await login(harness.app, 'protected-pat');
    const olivia = await login(harness.app, 'protected-olivia');
    const terry = await login(harness.app, 'trusted-terry');
    const oliviaHeaders = {
      ...browserHeaders(olivia.cookie as string),
      'x-bb-household-id': 'household-sunrise',
    };
    const invited = await harness.app.inject({
      method: 'POST',
      url: '/v1/family/invitations',
      headers: oliviaHeaders,
      payload: { inviteeDisplayName: 'Terry for Olivia', permissions: ['view_shared_checks'] },
    });
    expect(invited.statusCode).toBe(201);
    const invitationId = String(invited.json().invitation.id);
    const localInviteCode = String(invited.json().localInviteCode);

    for (const conflicted of [alice, pat]) {
      const preview = await harness.app.inject({
        method: 'POST',
        url: `/v1/family/invitations/${invitationId}/preview`,
        headers: browserHeaders(conflicted.cookie as string),
        payload: { localInviteCode },
      });
      expect(preview.statusCode).toBe(200);
      const rejected = await harness.app.inject({
        method: 'POST',
        url: `/v1/family/invitations/${invitationId}/accept`,
        headers: browserHeaders(conflicted.cookie as string),
        payload: {
          localInviteCode,
          previewVersion: preview.json().invitation.previewVersion,
        },
      });
      expect(rejected.statusCode).toBe(409);
    }
    const terryPreview = await harness.app.inject({
      method: 'POST',
      url: `/v1/family/invitations/${invitationId}/preview`,
      headers: browserHeaders(terry.cookie as string),
      payload: { localInviteCode },
    });
    const accepted = await harness.app.inject({
      method: 'POST',
      url: `/v1/family/invitations/${invitationId}/accept`,
      headers: browserHeaders(terry.cookie as string),
      payload: {
        localInviteCode,
        previewVersion: terryPreview.json().invitation.previewVersion,
      },
    });
    expect(accepted.statusCode).toBe(201);
    const relationshipId = String(accepted.json().relationship.id);
    const facts = await harness.database.query<{
      relationships: number;
      memberships: number;
      allocations: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM trusted_circle_relationships
          WHERE household_id = 'household-sunrise'
            AND trusted_person_id = 'person-trusted-terry' AND state = 'active') AS relationships,
         (SELECT count(*)::int FROM household_memberships
          WHERE household_id = 'household-sunrise'
            AND person_id = 'person-trusted-terry' AND status = 'active') AS memberships,
         (SELECT count(*)::int FROM commerce_allowance_allocations
          WHERE household_id = 'household-sunrise'
            AND subject_id = 'person-trusted-terry' AND state = 'active') AS allocations`,
    );
    expect(facts.rows[0]).toEqual({ relationships: 2, memberships: 1, allocations: 1 });

    const duplicateInvite = await harness.app.inject({
      method: 'POST',
      url: '/v1/family/invitations',
      headers: oliviaHeaders,
      payload: { inviteeDisplayName: 'Duplicate Terry', permissions: ['view_shared_checks'] },
    });
    const duplicatePreview = await harness.app.inject({
      method: 'POST',
      url: `/v1/family/invitations/${String(duplicateInvite.json().invitation.id)}/preview`,
      headers: browserHeaders(terry.cookie as string),
      payload: { localInviteCode: duplicateInvite.json().localInviteCode },
    });
    const duplicateAccept = await harness.app.inject({
      method: 'POST',
      url: `/v1/family/invitations/${String(duplicateInvite.json().invitation.id)}/accept`,
      headers: browserHeaders(terry.cookie as string),
      payload: {
        localInviteCode: duplicateInvite.json().localInviteCode,
        previewVersion: duplicatePreview.json().invitation.previewVersion,
      },
    });
    expect(duplicateAccept.statusCode).toBe(409);

    const revoked = await harness.app.inject({
      method: 'DELETE',
      url: `/v1/family/relationships/${relationshipId}`,
      headers: oliviaHeaders,
    });
    expect(revoked.statusCode).toBe(200);
    const remaining = await harness.database.query<{
      membership_status: string;
      allocation_state: string;
    }>(
      `SELECT m.status AS membership_status, a.state AS allocation_state
       FROM household_memberships m
       JOIN commerce_allowance_allocations a
         ON a.household_id = m.household_id AND a.subject_id = m.person_id
       WHERE m.household_id = 'household-sunrise'
         AND m.person_id = 'person-trusted-terry'
         AND a.allowance_key = 'trusted_circle_participants'`,
    );
    expect(remaining.rows[0]).toEqual({
      membership_status: 'active',
      allocation_state: 'active',
    });
    const terryFamily = await harness.app.inject({
      method: 'GET',
      url: '/v1/family',
      headers: browserHeaders(terry.cookie as string),
    });
    expect(
      terryFamily
        .json()
        .relationships.filter((relationship: { state: string }) => relationship.state === 'active'),
    ).toEqual([expect.objectContaining({ protectedPersonId: 'person-protected-pat' })]);
    expect(terryFamily.json().relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          protectedPersonId: 'person-protected-olivia',
          state: 'revoked',
        }),
      ]),
    );
  });
});

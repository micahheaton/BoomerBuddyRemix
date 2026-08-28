import {
  CommerceOperationsRepository,
  EntitlementRepository,
  resolveActiveBillingAuthority,
  resolveActivePayerFact,
} from '@boomerbuddy/persistence';
import { afterEach, describe, expect, it } from 'vitest';
import { browserHeaders, createApiHarness, hqOrigin, login, type ApiHarness } from './support';

describe('provider-neutral commerce and household allowances', () => {
  let harness: ApiHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('rejects the test-only protected enrollment seam outside the local runtime', async () => {
    harness = await createApiHarness();
    const productionRepository = new EntitlementRepository(harness.database);
    const now = harness.clock.now();
    expect(() =>
      productionRepository.testOnlyEnrollProtectedSelf({
        householdId: 'household-sunrise',
        personId: 'person-trusted-terry',
        actorPersonId: 'person-trusted-terry',
        consentVersion: 'must-not-enroll-outside-local',
        now,
      }),
    ).toThrowError(expect.objectContaining({ code: 'not_authorized' }));
    expect(() =>
      productionRepository.testOnlyRevokeProtectedSelf({
        householdId: 'household-sunrise',
        personId: 'person-owner-alice',
        actorPersonId: 'person-owner-alice',
        now,
      }),
    ).toThrowError(expect.objectContaining({ code: 'not_authorized' }));
    const state = await harness.database.query<
      { readonly terry: number; readonly alice_status: string } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::int FROM protected_members
          WHERE household_id = 'household-sunrise'
            AND person_id = 'person-trusted-terry') AS terry,
         (SELECT status FROM protected_members
          WHERE household_id = 'household-sunrise'
            AND person_id = 'person-owner-alice') AS alice_status`,
    );
    expect(state.rows[0]).toEqual({ terry: 0, alice_status: 'accepted' });
  });

  it('resolves billing authority and payer facts independently and refuses admin-only actors', async () => {
    harness = await createApiHarness();
    const aliceAuthority = await resolveActiveBillingAuthority(
      harness.database,
      'household-sunrise',
      'person-owner-alice',
    );
    expect(aliceAuthority).toEqual({
      authorityReference: 'billing-authority:household-sunrise:person-owner-alice',
      householdId: 'household-sunrise',
      personId: 'person-owner-alice',
      isPayer: true,
    });
    await harness.database.query(
      `INSERT INTO household_administrator_assignments(
         household_id, person_id, status, granted_by_person_id, granted_at
       ) VALUES ('household-sunrise','person-protected-pat','active',
         'person-owner-alice',$1)`,
      [harness.clock.now().toISOString()],
    );
    await expect(
      resolveActiveBillingAuthority(harness.database, 'household-sunrise', 'person-protected-pat'),
    ).resolves.toBeNull();
    await expect(
      resolveActivePayerFact(harness.database, 'household-sunrise', 'person-protected-pat'),
    ).resolves.toBeNull();

    await harness.database.query(
      `INSERT INTO household_payers(
         household_id, person_id, source, status, effective_at
       ) VALUES ('household-sunrise','person-trusted-terry','local','active',$1)`,
      [harness.clock.now().toISOString()],
    );
    await expect(
      resolveActiveBillingAuthority(harness.database, 'household-sunrise', 'person-trusted-terry'),
    ).resolves.toBeNull();
    await expect(
      resolveActivePayerFact(harness.database, 'household-sunrise', 'person-trusted-terry'),
    ).resolves.toEqual({
      payerReference: 'payer:household-sunrise:person-trusted-terry',
      householdId: 'household-sunrise',
      personId: 'person-trusted-terry',
      source: 'local',
    });
    await expect(
      resolveActiveBillingAuthority(harness.database, 'household-sunrise', 'person-owner-alice'),
    ).resolves.toEqual(aliceAuthority);
  });

  it('projects canonical plans and removes authorization when the backing source stops qualifying', async () => {
    harness = await createApiHarness();
    const alice = await login(harness.app, 'owner-alice');
    const bob = await login(harness.app, 'owner-bob');
    const heidi = await login(harness.app, 'hq-heidi', 'hq');

    const publicConfig = await harness.app.inject({ method: 'GET', url: '/v1/public/config' });
    expect(publicConfig.statusCode).toBe(200);
    expect(publicConfig.json()).toMatchObject({
      liveProvidersEnabled: false,
      pricing: [
        {
          key: 'family',
          name: 'Family',
          monthlyUsd: 14.99,
          annualUsd: 149.9,
          hypothesis: false,
        },
      ],
      commerceCatalog: {
        defaultOfferId: 'family_annual_v2',
      },
    });

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
         household_id, id, person_id, membership_kind, status, created_at
       ) VALUES ('household-sunrise','membership-db-protected-subject',
         'person-db-protected-subject','member','active',$1)`,
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
    await harness.database.query(
      `INSERT INTO consents(
         household_id, id, protected_person_id, granted_by_person_id, purpose,
         consent_version, state, granted_at
       ) VALUES ('household-sunrise','consent-test-invalid-terry','person-trusted-terry',
         'person-trusted-terry','protected_enrollment','test-invalid-proof','active',$1)`,
      [harness.clock.now().toISOString()],
    );
    await harness.database.query(
      `INSERT INTO consent_evidence(
         household_id, id, consent_id, actor_person_id, subject_person_id,
         purpose, scope, action, disclosure_version, disclosure_digest,
         policy_version, policy_digest, source_interaction, actor_identity_id,
         actor_identity_issuer, actor_identity_subject, assurance, effective_at, recorded_at
       ) VALUES ('household-sunrise','evidence-test-invalid-terry',
         'consent-test-invalid-terry','person-trusted-terry','person-trusted-terry',
         'protected_enrollment','{"protectedEnrollment":true}'::jsonb,'accept',
         'test-disclosure',repeat('1',64),'test-policy',repeat('2',64),'integration_test',
         'identity-trusted-terry','boomerbuddy-dev','trusted-terry','development',$1,$1)`,
      [harness.clock.now().toISOString()],
    );
    await harness.database.query(
      `INSERT INTO consent_current_projections(
         household_id, consent_id, latest_evidence_id, actor_person_id,
         subject_person_id, purpose, scope, state, effective_at, updated_at
       ) VALUES ('household-sunrise','consent-test-invalid-terry',
         'evidence-test-invalid-terry','person-trusted-terry','person-trusted-terry',
         'protected_enrollment','{"protectedEnrollment":true}'::jsonb,'active',$1,$1)`,
      [harness.clock.now().toISOString()],
    );
    await expect(
      harness.database.query(
        `INSERT INTO protected_members(
           household_id, person_id, status, consented_by_person_id, consent_version,
           allowance_allocation_id, accepted_at, created_at, updated_at,
           consent_id, latest_consent_evidence_id
         ) VALUES ('household-sunrise','person-trusted-terry','accepted','person-trusted-terry',
           'invalid-subject-proof','allocation-db-protected',$1,$1,$1,
           'consent-test-invalid-terry','evidence-test-invalid-terry')`,
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
       ) SELECT 'family_retired_v4', product_version_id, plan_key, 4, 'Retired Family',
           'retired', capabilities, allowances, prices, available_from, $1
         FROM commerce_plan_versions WHERE id = 'family_v1'`,
      [harness.clock.now().toISOString()],
    );
    await harness.database.query(
      `INSERT INTO commerce_subscriptions(
         household_id, id, plan_version_id, source, lifecycle, source_verified, precedence,
         current_period_starts_at, current_period_ends_at, reconciliation_state,
         created_at, updated_at
       ) VALUES ('household-sunrise','subscription-retired-local','family_retired_v4',
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
          'family_retired_v4','subscription-retired-local'),
         ('household-sunrise','grant-web-hypothesis','web',
          '["check:text","family:manage"]'::jsonb,$1,true,998,
          'plus_v1','subscription-web-hypothesis')`,
      [harness.clock.now().toISOString()],
    );
    const entitlements = await new EntitlementRepository(
      harness.database,
      undefined,
      'local',
    ).forHousehold('household-sunrise', harness.clock.now());
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

    const commerce = new CommerceOperationsRepository(
      harness.database,
      Buffer.alloc(32, 11),
      1,
      undefined,
      'local',
    );
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
    const entitlements = new EntitlementRepository(harness.database, undefined, 'local');
    await expect(
      entitlements.testOnlyEnrollProtectedSelf({
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
           household_id, id, person_id, membership_kind, status, created_at
         ) VALUES ('household-sunrise',$1,$2,'member','active',$3)`,
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
    const entitlements = new EntitlementRepository(harness.database, undefined, 'local');
    await harness.database.query(
      `INSERT INTO household_memberships(
         household_id, id, person_id, membership_kind, status, created_at
       ) VALUES ('household-sunrise','membership-sunrise-olivia','person-protected-olivia',
         'member','active',$1)`,
      [harness.clock.now().toISOString()],
    );
    await entitlements.testOnlyEnrollProtectedSelf({
      householdId: 'household-sunrise',
      personId: 'person-protected-olivia',
      actorPersonId: 'person-protected-olivia',
      consentVersion: 'test-protected-self-v1',
      now: harness.clock.now(),
    });
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
          state: 'withdrawn',
        }),
      ]),
    );
  });

  it('fails closed on Family cancellation and rebinds one accepted protected seat to Free', async () => {
    harness = await createApiHarness();
    const now = harness.clock.now();
    const future = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000);
    await harness.database.query(
      `UPDATE commerce_subscriptions
       SET source = 'web', precedence = 300, updated_at = $1
       WHERE household_id = 'household-sunrise' AND id = 'subscription-local-sunrise'`,
      [now.toISOString()],
    );
    await harness.database.query(
      `UPDATE entitlement_grants SET source = 'web', precedence = 300
       WHERE household_id = 'household-sunrise' AND id = 'grant-local-sunrise'`,
    );
    await harness.database.query(
      `UPDATE commerce_provider_subscription_records
       SET provider = 'stripe', environment = 'test',
           external_subscription_id = 'sub_sunrise_family_test'
       WHERE id = 'provider-record-sunrise'`,
    );
    await harness.database.query(
      `INSERT INTO commerce_subscriptions(
         household_id, id, payer_person_id, plan_version_id, source, lifecycle,
         source_verified, precedence, current_period_starts_at, current_period_ends_at,
         reconciliation_state, created_at, updated_at
       ) VALUES ('household-sunrise','subscription-sunrise-free-fallback',
         'person-owner-alice','free_v1','local','active',true,10,$1,$2,
         'not_required',$1,$1)`,
      [now.toISOString(), future.toISOString()],
    );
    await harness.database.query(
      `INSERT INTO commerce_provider_subscription_records(
         id, household_id, subscription_id, provider, environment,
         external_subscription_id, raw_state, provider_version, observed_at, verified_at
       ) VALUES ('provider-sunrise-free-fallback','household-sunrise',
         'subscription-sunrise-free-fallback','local','local','local-sunrise-free-fallback',
         'active','fixture-v1',$1,$1)`,
      [now.toISOString()],
    );
    await harness.database.query(
      `INSERT INTO entitlement_grants(
         household_id, id, source, capabilities, starts_at, source_verified, precedence,
         plan_version_id, subscription_id
       ) VALUES ('household-sunrise','grant-sunrise-free-fallback','local',
         '["check:text","check:url","history:read","orientation:use"]'::jsonb,
         $1,true,10,'free_v1','subscription-sunrise-free-fallback')`,
      [now.toISOString()],
    );

    const productionEntitlements = new EntitlementRepository(harness.database);
    const entitlements = new EntitlementRepository(harness.database, undefined, 'local');
    const testOnlyEntitlements = entitlements;
    const productionOverlapped = await productionEntitlements.forHousehold(
      'household-sunrise',
      now,
    );
    expect(productionOverlapped.portfolio.primarySource).toBeNull();
    const overlapped = await entitlements.forHousehold('household-sunrise', now);
    expect(overlapped.portfolio.primarySource?.planKey).toBe('family');
    expect(
      overlapped.portfolio.allowances.find((allowance) => allowance.kind === 'protected_members'),
    ).toMatchObject({ limit: 3, used: 2, remaining: 1 });
    expect(
      overlapped.portfolio.allowances.find(
        (allowance) => allowance.kind === 'trusted_circle_participants',
      ),
    ).toMatchObject({ limit: 6, used: 1, remaining: 5 });

    const alice = await login(harness.app, 'owner-alice');
    const pat = await login(harness.app, 'protected-pat');
    const terry = await login(harness.app, 'trusted-terry');
    const commerce = new CommerceOperationsRepository(
      harness.database,
      Buffer.alloc(32, 17),
      1,
      undefined,
      'local',
    );
    const eventCreatedAt = new Date(now.getTime() + 1_000);
    const captured = await commerce.captureVerifiedProviderEvent({
      provider: 'stripe',
      environment: 'test',
      externalEventId: 'evt_sunrise_family_canceled',
      eventType: 'customer.subscription.deleted',
      rawPayload: '{"id":"evt_sunrise_family_canceled","type":"customer.subscription.deleted"}',
      providerApiVersion: '2026-06-30.basil',
      providerObjectId: 'sub_sunrise_family_test',
      providerEventCreatedAt: eventCreatedAt,
      normalizedLifecycle: 'canceled',
      now: eventCreatedAt,
    });
    await expect(
      commerce.applyProviderLifecycle({
        inboxId: captured.id,
        provider: 'stripe',
        environment: 'test',
        externalEventId: 'evt_sunrise_family_canceled',
        providerApiVersion: '2026-06-30.basil',
        providerObjectId: 'sub_sunrise_family_test',
        providerEventCreatedAt: eventCreatedAt,
        householdId: 'household-sunrise',
        subscriptionId: 'subscription-local-sunrise',
        externalSubscriptionId: 'sub_sunrise_family_test',
        lifecycle: 'canceled',
        currentPeriodStartsAt: now,
        currentPeriodEndsAt: future,
        accessEvidence: { kind: 'non_payment' },
        now: eventCreatedAt,
      }),
    ).resolves.toMatchObject({ outcome: 'applied', lifecycle: 'canceled' });

    const downgraded = await entitlements.forHousehold('household-sunrise', eventCreatedAt);
    expect(downgraded.portfolio.primarySource?.planKey).toBe('free');
    expect(
      downgraded.portfolio.allowances.find((allowance) => allowance.kind === 'protected_members'),
    ).toMatchObject({ limit: 1, used: 0, remaining: 1, state: 'available' });
    expect(
      downgraded.portfolio.allowances.find(
        (allowance) => allowance.kind === 'trusted_circle_participants',
      ),
    ).toMatchObject({ limit: 0, used: 0, remaining: 0, state: 'exhausted' });

    const getHousehold = async (cookie: string) => {
      const response = await harness!.app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: browserHeaders(cookie),
      });
      expect(response.statusCode).toBe(200);
      return (response.json().principal.households as Array<Record<string, unknown>>).find(
        (household) => household.id === 'household-sunrise',
      );
    };
    await expect(getHousehold(alice.cookie as string)).resolves.toMatchObject({
      isProtectedMember: false,
    });
    await expect(getHousehold(pat.cookie as string)).resolves.toMatchObject({
      isProtectedMember: false,
    });
    await expect(getHousehold(terry.cookie as string)).resolves.toMatchObject({
      isProtectedMember: false,
      trustedCircleGrants: [],
      capabilities: [],
    });
    const deniedSharedCheck = await harness.app.inject({
      method: 'GET',
      url: '/v1/checks/analysis-seed-sunrise-shared',
      headers: browserHeaders(terry.cookie as string),
    });
    expect(deniedSharedCheck.statusCode).toBe(403);

    const unchangedBeforeRecovery = await harness.database.query<{
      accepted_protected: number;
      active_relationships: number;
      active_consents: number;
      consent_evidence: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM protected_members
          WHERE household_id = 'household-sunrise' AND status = 'accepted')
           AS accepted_protected,
         (SELECT count(*)::int FROM trusted_circle_relationships
          WHERE household_id = 'household-sunrise' AND state = 'active')
           AS active_relationships,
         (SELECT count(*)::int FROM consent_current_projections
          WHERE household_id = 'household-sunrise' AND state = 'active') AS active_consents,
         (SELECT count(*)::int FROM consent_evidence
          WHERE household_id = 'household-sunrise') AS consent_evidence`,
    );
    expect(unchangedBeforeRecovery.rows[0]).toEqual({
      accepted_protected: 2,
      active_relationships: 1,
      active_consents: 3,
      consent_evidence: 3,
    });

    await expect(
      testOnlyEntitlements.testOnlyEnrollProtectedSelf({
        householdId: 'household-sunrise',
        personId: 'person-owner-alice',
        actorPersonId: 'person-owner-alice',
        consentVersion: 'must-not-replace-original-consent',
        now: eventCreatedAt,
      }),
    ).resolves.toEqual({
      householdId: 'household-sunrise',
      personId: 'person-owner-alice',
      status: 'accepted',
      consentVersion: 'protected-self-v1',
      allowanceAllocationId: 'allocation-sunrise-alice',
    });
    await expect(getHousehold(alice.cookie as string)).resolves.toMatchObject({
      isProtectedMember: true,
    });
    await expect(
      testOnlyEntitlements.testOnlyEnrollProtectedSelf({
        householdId: 'household-sunrise',
        personId: 'person-protected-pat',
        actorPersonId: 'person-protected-pat',
        consentVersion: 'must-not-replace-original-consent',
        now: eventCreatedAt,
      }),
    ).rejects.toMatchObject({
      code: 'not_authorized',
      safeDetails: { allowance: 'protected_members', reason: 'limit_exceeded' },
    });
    await expect(getHousehold(pat.cookie as string)).resolves.toMatchObject({
      isProtectedMember: false,
    });

    const finalFacts = await harness.database.query<{
      alice_grant: string;
      pat_grant: string;
      accepted_protected: number;
      active_relationships: number;
      active_consents: number;
      consent_evidence: number;
    }>(
      `SELECT
         (SELECT entitlement_grant_id FROM commerce_allowance_allocations
          WHERE id = 'allocation-sunrise-alice') AS alice_grant,
         (SELECT entitlement_grant_id FROM commerce_allowance_allocations
          WHERE id = 'allocation-sunrise-pat') AS pat_grant,
         (SELECT count(*)::int FROM protected_members
          WHERE household_id = 'household-sunrise' AND status = 'accepted')
           AS accepted_protected,
         (SELECT count(*)::int FROM trusted_circle_relationships
          WHERE household_id = 'household-sunrise' AND state = 'active')
           AS active_relationships,
         (SELECT count(*)::int FROM consent_current_projections
          WHERE household_id = 'household-sunrise' AND state = 'active') AS active_consents,
         (SELECT count(*)::int FROM consent_evidence
          WHERE household_id = 'household-sunrise') AS consent_evidence`,
    );
    expect(finalFacts.rows[0]).toEqual({
      alice_grant: 'grant-sunrise-free-fallback',
      pat_grant: 'grant-local-sunrise',
      accepted_protected: 2,
      active_relationships: 1,
      active_consents: 3,
      consent_evidence: 3,
    });

    await harness.database.query(
      `INSERT INTO commerce_subscriptions(
         household_id, id, payer_person_id, plan_version_id, source, lifecycle,
         source_verified, precedence, current_period_starts_at, current_period_ends_at,
         reconciliation_state, created_at, updated_at
       ) VALUES ('household-sunrise','subscription-sunrise-family-replacement',
         'person-owner-alice','family_v1','web','pending',false,400,$1,$2,
         'pending',$1,$1)`,
      [now.toISOString(), future.toISOString()],
    );
    await expect(getHousehold(terry.cookie as string)).resolves.toMatchObject({
      trustedCircleGrants: [],
      capabilities: [],
    });
    const checkoutExpiry = new Date(now.getTime() + 23 * 60 * 60_000 + 5 * 60_000);
    const localCheckoutExpiry = new Date(checkoutExpiry.getTime() + 5 * 60_000);
    await harness.database.query(
      `INSERT INTO commerce_event_inbox(
         id, provider, environment, external_event_id, event_type, payload_hmac,
         fingerprint_key_version, authenticity, status, received_at,
         provider_api_version, provider_object_id, provider_event_created_at,
         application_state
       ) VALUES (
         'checkout-event-sunrise-family-replacement','stripe','test',
         'evt_checkout_sunrise_family_replacement','checkout.session.completed',
         'fixture-checkout-hmac',1,'verified','processed',$1,'2026-02-25.clover',
         'cs_test_sunrise_family_replacement',$1,'applied'
       )`,
      [now.toISOString()],
    );
    await harness.database.query(
      `INSERT INTO commerce_checkout_intents(
         household_id, id, subscription_id, requested_by_person_id,
         billing_authority_person_id, plan_version_id, offer_id, billing_interval,
         provider_price_id, provider, environment, idempotency_key, state,
         provider_session_id, created_at, updated_at, expires_at,
         server_operation_id, provider_idempotency_key, provider_requested_expires_at,
         provider_returned_expires_at, dispatch_state
       ) VALUES (
         'household-sunrise','checkout-intent-sunrise-family-replacement',
         'subscription-sunrise-family-replacement','person-owner-alice','person-owner-alice',
         'family_v1','founding_family_monthly_v1','month','price_test_family_monthly',
         'stripe','test','checkout-operation-sunrise-family-replacement','session_created',
         'cs_test_sunrise_family_replacement',$1,$1,$2,
         'checkout-operation-sunrise-family-replacement',
         'bb:test:checkout:sunrise-family-replacement',$3,$3,'session_recorded'
       )`,
      [now.toISOString(), localCheckoutExpiry.toISOString(), checkoutExpiry.toISOString()],
    );
    await harness.database.query(
      `INSERT INTO commerce_stripe_checkout_completions(
         provider_session_id, environment, household_id, checkout_intent_id,
         subscription_id, provider_subscription_id, provider_customer_id,
         provider_payment_intent_id, source_inbox_id, provider_event_id,
         payment_status, session_status, amount_total, currency, completed_at,
         provider_expires_at
       ) VALUES (
         'cs_test_sunrise_family_replacement','test','household-sunrise',
         'checkout-intent-sunrise-family-replacement','subscription-sunrise-family-replacement',
         'sub_sunrise_family_replacement_test','cus_sunrise_family_replacement',
         'pi_checkout_sunrise_family_replacement','checkout-event-sunrise-family-replacement',
         'evt_checkout_sunrise_family_replacement','paid','complete',1499,'usd',$1,$2
       )`,
      [now.toISOString(), checkoutExpiry.toISOString()],
    );
    const replacementEvent = await commerce.captureVerifiedProviderEvent({
      provider: 'stripe',
      environment: 'test',
      externalEventId: 'evt_sunrise_family_replacement_paid',
      eventType: 'invoice.paid',
      rawPayload: '{"id":"in_sunrise_family_replacement","type":"invoice.paid"}',
      providerApiVersion: '2026-02-25.clover',
      providerObjectId: 'in_sunrise_family_replacement',
      providerEventCreatedAt: now,
      normalizedLifecycle: 'active',
      now,
    });
    await expect(
      commerce.applyProviderLifecycle({
        inboxId: replacementEvent.id,
        provider: 'stripe',
        environment: 'test',
        externalEventId: 'evt_sunrise_family_replacement_paid',
        providerApiVersion: '2026-02-25.clover',
        providerObjectId: 'in_sunrise_family_replacement',
        providerEventCreatedAt: now,
        householdId: 'household-sunrise',
        subscriptionId: 'subscription-sunrise-family-replacement',
        externalSubscriptionId: 'sub_sunrise_family_replacement_test',
        lifecycle: 'active',
        currentPeriodStartsAt: now,
        currentPeriodEndsAt: future,
        accessEvidence: {
          kind: 'payment_confirmed',
          sourceInboxId: replacementEvent.id,
          evidence: {
            offerId: 'founding_family_monthly_v1',
            providerInvoiceId: 'in_sunrise_family_replacement',
            externalSubscriptionId: 'sub_sunrise_family_replacement_test',
            providerSubscriptionItemId: 'si_sunrise_family_replacement',
            providerInvoiceLineId: 'il_sunrise_family_replacement',
            providerInvoicePaymentId: 'inpay_sunrise_family_replacement',
            providerProductId: 'prod_test_family',
            providerPaymentIntentId: 'pi_invoice_sunrise_family_replacement',
            providerPriceId: 'price_test_family_monthly',
            billingReason: 'subscription_create',
            amountPaid: 1499,
            amountRemaining: 0,
            currency: 'usd',
            quantity: 1,
            discountAmount: 0,
            taxAmount: 0,
            invoiceDiscountsEmpty: true,
            invoiceTaxesEmpty: true,
            invoiceCreditsEmpty: true,
            currentPeriodStartsAt: now,
            currentPeriodEndsAt: future,
            providerPaidAt: now,
          },
        },
        now,
      }),
    ).resolves.toMatchObject({ outcome: 'applied', lifecycle: 'active' });
    await expect(getHousehold(terry.cookie as string)).resolves.toMatchObject({
      trustedCircleGrants: [
        {
          relationshipId: 'relationship-sunrise-pat-terry',
          protectedPersonId: 'person-protected-pat',
          permissions: ['view_shared_checks'],
        },
      ],
      capabilities: ['history:read'],
    });
    await expect(getHousehold(pat.cookie as string)).resolves.toMatchObject({
      isProtectedMember: true,
    });
    const trustedRecoveryFacts = await harness.database.query<{
      trusted_subscription: string;
      pat_subscription: string;
      active_relationships: number;
      active_consents: number;
      consent_evidence: number;
    }>(
      `SELECT
         (SELECT entitlement_grant.subscription_id
          FROM commerce_allowance_allocations allocation
          JOIN entitlement_grants entitlement_grant
            ON entitlement_grant.household_id = allocation.household_id
           AND entitlement_grant.id = allocation.entitlement_grant_id
          WHERE allocation.id = 'allocation-sunrise-terry') AS trusted_subscription,
         (SELECT entitlement_grant.subscription_id
          FROM commerce_allowance_allocations allocation
          JOIN entitlement_grants entitlement_grant
            ON entitlement_grant.household_id = allocation.household_id
           AND entitlement_grant.id = allocation.entitlement_grant_id
          WHERE allocation.id = 'allocation-sunrise-pat') AS pat_subscription,
         (SELECT count(*)::int FROM trusted_circle_relationships
          WHERE household_id = 'household-sunrise' AND state = 'active')
           AS active_relationships,
         (SELECT count(*)::int FROM consent_current_projections
          WHERE household_id = 'household-sunrise' AND state = 'active') AS active_consents,
         (SELECT count(*)::int FROM consent_evidence
          WHERE household_id = 'household-sunrise') AS consent_evidence`,
    );
    expect(trustedRecoveryFacts.rows[0]).toEqual({
      trusted_subscription: 'subscription-sunrise-family-replacement',
      pat_subscription: 'subscription-sunrise-family-replacement',
      active_relationships: 1,
      active_consents: 3,
      consent_evidence: 3,
    });
  }, 30_000);
});

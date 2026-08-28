import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

import {
  foundingHouseholdFounderConsoleResponseSchema,
  foundingHouseholdInvitationPreviewResponseSchema,
  foundingHouseholdMemberStatusResponseSchema,
  type ProtectedSelfEnrollmentStatusResponse,
} from '@boomerbuddy/contracts';
import {
  foundingHouseholdProtectedEnrollmentConsentVersion,
  foundingHouseholdServiceConsentVersion,
} from '@boomerbuddy/domain';

import {
  browserHeaders,
  createApiHarness,
  createMutableClock,
  hqOrigin,
  login,
  type ApiHarness,
} from './support';
import { installSyntheticLocalFamilyEntitlement } from './protected-enrollment-fixture';

const clockStart = new Date();
const programEndsAt = new Date(clockStart.getTime() + 45 * 86_400_000).toISOString();

function operation(kind: 'policy' | 'invite' | 'accept' | 'invite-revoke' | 'offboard', n: number) {
  return `founding-${kind}:00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function protectedOperation(action: 'enroll' | 'withdraw', n: number) {
  return `protected-self-${action}:30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function generalProtectedEnrollmentPayload(status: ProtectedSelfEnrollmentStatusResponse) {
  return {
    consentVersion: status.consent.version,
    disclosureVersion: status.consent.disclosure.version,
    disclosureDigest: status.consent.disclosure.digest,
    policyVersion: status.consent.policy.version,
    policyDigest: status.consent.policy.digest,
    consentAccepted: true,
  } as const;
}

function expectPrivateNoStore(
  headers: Record<string, string | string[] | number | undefined>,
): void {
  expect(headers['cache-control']).toBe('private, no-store, max-age=0');
  expect(headers.pragma).toBe('no-cache');
  expect(headers.expires).toBe('0');
}

describe('Founding Household local no-card API', () => {
  let harness: ApiHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  async function founderHeaders() {
    if (harness === undefined) throw new Error('Harness is unavailable');
    const founder = await login(harness.app, 'hq-heidi', 'hq');
    return browserHeaders(founder.cookie as string, hqOrigin);
  }

  async function activateAndInvite(maxHouseholds = 2) {
    if (harness === undefined) throw new Error('Harness is unavailable');
    const headers = await founderHeaders();
    const policy = await harness.app.inject({
      method: 'POST',
      url: '/v1/hq/founding-households/policy',
      headers: { ...headers, 'idempotency-key': operation('policy', 1) },
      payload: {
        state: 'active',
        expectedRevision: 1,
        benefitKey: 'family_beta_v1',
        maxHouseholds,
        invitationTtlDays: 7,
        accessDurationDays: 30,
        programEndsAt,
      },
    });
    const invitation = await harness.app.inject({
      method: 'POST',
      url: '/v1/hq/founding-households/invitations',
      headers: { ...headers, 'idempotency-key': operation('invite', 2) },
    });
    const invitationReplay = await harness.app.inject({
      method: 'POST',
      url: '/v1/hq/founding-households/invitations',
      headers: { ...headers, 'idempotency-key': operation('invite', 2) },
    });
    expect(policy.statusCode, policy.body).toBe(200);
    expect(invitation.statusCode, invitation.body).toBe(201);
    expect(invitation.json()).toMatchObject({
      credentialState: 'created_credential_returned',
      reused: false,
    });
    expect(invitationReplay.statusCode, invitationReplay.body).toBe(200);
    expect(invitationReplay.json()).toMatchObject({
      invitation: { id: invitation.json<{ invitation: { id: string } }>().invitation.id },
      credentialState: 'created_credential_unavailable',
      reused: true,
    });
    expect(invitationReplay.json()).not.toHaveProperty('invitationCredential');
    expectPrivateNoStore(policy.headers);
    expectPrivateNoStore(invitation.headers);
    expectPrivateNoStore(invitationReplay.headers);
    return {
      founderHeaders: headers,
      invitationId: invitation.json<{ invitation: { id: string } }>().invitation.id,
      credential: invitation.json<{ invitationCredential: string }>().invitationCredential,
    };
  }

  it('is disabled by default and visible only to the exact configured internal founder', async () => {
    harness = await createApiHarness(createMutableClock(clockStart));
    const founder = await founderHeaders();
    const reviewer = await login(harness.app, 'hq-riley', 'hq');
    const customer = await login(harness.app, 'owner-bob', 'customer');

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/founding-households',
      headers: founder,
    });
    const reviewerResponse = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/founding-households',
      headers: browserHeaders(reviewer.cookie as string, hqOrigin),
    });
    const customerResponse = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/founding-households',
      headers: browserHeaders(customer.cookie as string),
    });
    const body = foundingHouseholdFounderConsoleResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      authority: 'configured_founder_active_internal_owner',
      evidenceTier: 'local_simulation',
      productionIdentityReady: false,
      paymentCollected: false,
      externalActionExecuted: false,
      policy: { revision: 1, state: 'disabled' },
      capacity: { maxHouseholds: 0, activeHouseholds: 0, reservedInvitations: 0, remaining: 0 },
      invitations: [],
      enrollments: [],
    });
    expect(reviewerResponse.statusCode).toBe(403);
    expect(customerResponse.statusCode).toBe(401);
    expectPrivateNoStore(response.headers);
    expectPrivateNoStore(reviewerResponse.headers);
    expectPrivateNoStore(customerResponse.headers);
  });

  it('completes the founder-to-household no-card journey with explicit service-only consent', async () => {
    harness = await createApiHarness(createMutableClock(clockStart));
    const issued = await activateAndInvite();
    const bob = await login(harness.app, 'owner-bob', 'customer');
    const customerHeaders = {
      ...browserHeaders(bob.cookie as string),
      'x-bb-household-id': 'household-harbor',
    };
    const requestBody = { invitationCredential: issued.credential };

    const preview = await harness.app.inject({
      method: 'POST',
      url: `/v1/founding-households/invitations/${issued.invitationId}/preview`,
      headers: customerHeaders,
      payload: requestBody,
    });
    const previewBody = foundingHouseholdInvitationPreviewResponseSchema.parse(preview.json());
    const accepted = await harness.app.inject({
      method: 'POST',
      url: `/v1/founding-households/invitations/${issued.invitationId}/accept`,
      headers: { ...customerHeaders, 'idempotency-key': operation('accept', 3) },
      payload: {
        ...requestBody,
        serviceConsentVersion: foundingHouseholdServiceConsentVersion,
        serviceDisclosureDigest: previewBody.serviceDisclosureDigest,
        servicePolicyDigest: previewBody.servicePolicyDigest,
        serviceConsentAccepted: true,
        protectedEnrollmentConsentVersion: foundingHouseholdProtectedEnrollmentConsentVersion,
        protectedEnrollmentDisclosureDigest: previewBody.protectedEnrollmentDisclosureDigest,
        protectedEnrollmentPolicyDigest: previewBody.protectedEnrollmentPolicyDigest,
        protectedEnrollmentConsentAccepted: true,
      },
    });
    const retry = await harness.app.inject({
      method: 'POST',
      url: `/v1/founding-households/invitations/${issued.invitationId}/accept`,
      headers: { ...customerHeaders, 'idempotency-key': operation('accept', 3) },
      payload: {
        ...requestBody,
        serviceConsentVersion: foundingHouseholdServiceConsentVersion,
        serviceDisclosureDigest: previewBody.serviceDisclosureDigest,
        servicePolicyDigest: previewBody.servicePolicyDigest,
        serviceConsentAccepted: true,
        protectedEnrollmentConsentVersion: foundingHouseholdProtectedEnrollmentConsentVersion,
        protectedEnrollmentDisclosureDigest: previewBody.protectedEnrollmentDisclosureDigest,
        protectedEnrollmentPolicyDigest: previewBody.protectedEnrollmentPolicyDigest,
        protectedEnrollmentConsentAccepted: true,
      },
    });
    const status = await harness.app.inject({
      method: 'GET',
      url: '/v1/founding-households',
      headers: customerHeaders,
    });
    const statusBody = foundingHouseholdMemberStatusResponseSchema.parse(status.json());
    const payer = await harness.database.query(
      `SELECT 1 FROM founding_household_enrollments enrollment
       JOIN commerce_subscriptions subscription
         ON subscription.household_id = enrollment.household_id
        AND subscription.id = enrollment.subscription_id
       WHERE subscription.payer_person_id IS NOT NULL`,
    );

    expect(preview.statusCode, preview.body).toBe(200);
    expectPrivateNoStore(preview.headers);
    expect(previewBody).toMatchObject({
      invitationId: issued.invitationId,
      householdId: 'household-harbor',
      researchConsentRequested: false,
      marketingConsentRequested: false,
      followUpConsentRequested: false,
      paymentRequired: false,
      evidenceTier: 'local_simulation',
    });
    expect(createHash('sha256').update(previewBody.serviceDisclosureText).digest('hex')).toBe(
      previewBody.serviceDisclosureDigest,
    );
    expect(createHash('sha256').update(previewBody.servicePolicyText).digest('hex')).toBe(
      previewBody.servicePolicyDigest,
    );
    expect(accepted.statusCode, accepted.body).toBe(201);
    expectPrivateNoStore(accepted.headers);
    expect(accepted.json()).toMatchObject({
      protectedEnrollment: 'created',
      reused: false,
      paymentCollected: false,
      externalActionExecuted: false,
      enrollment: {
        state: 'active',
        paymentState: 'not_paid_sponsored_beta',
        researchConsent: false,
        marketingConsent: false,
        followUpConsent: false,
      },
    });
    expect(retry.statusCode, retry.body).toBe(200);
    expectPrivateNoStore(retry.headers);
    expect(retry.json()).toMatchObject({ protectedEnrollment: 'created', reused: true });
    expect(status.statusCode, status.body).toBe(200);
    expectPrivateNoStore(status.headers);
    expect(statusBody.enrollment).toMatchObject({
      householdId: 'household-harbor',
      state: 'active',
      serviceConsentState: 'active',
      paymentState: 'not_paid_sponsored_beta',
    });
    expect(statusBody.enrollment).not.toHaveProperty('acceptedByPersonId');
    for (const milestone of statusBody.enrollment?.funnel ?? []) {
      expect(milestone).not.toHaveProperty('observedAt');
    }
    expect(payer.rows).toHaveLength(0);
  });

  it('rejects secret-like extra fields, missing idempotency, cross-household claims, and nonadmins', async () => {
    harness = await createApiHarness(createMutableClock(clockStart));
    const issued = await activateAndInvite();
    const bob = await login(harness.app, 'owner-bob', 'customer');
    const terry = await login(harness.app, 'trusted-terry', 'customer');
    const bobHeaders = {
      ...browserHeaders(bob.cookie as string),
      'x-bb-household-id': 'household-harbor',
    };
    const previewResponse = await harness.app.inject({
      method: 'POST',
      url: `/v1/founding-households/invitations/${issued.invitationId}/preview`,
      headers: bobHeaders,
      payload: { invitationCredential: issued.credential },
    });
    const previewBody = foundingHouseholdInvitationPreviewResponseSchema.parse(
      previewResponse.json(),
    );

    const crossHousehold = await harness.app.inject({
      method: 'POST',
      url: `/v1/founding-households/invitations/${issued.invitationId}/preview`,
      headers: {
        ...browserHeaders(bob.cookie as string),
        'x-bb-household-id': 'household-sunrise',
      },
      payload: { invitationCredential: issued.credential },
    });
    const extraConsent = await harness.app.inject({
      method: 'POST',
      url: `/v1/founding-households/invitations/${issued.invitationId}/accept`,
      headers: { ...bobHeaders, 'idempotency-key': operation('accept', 3) },
      payload: {
        invitationCredential: issued.credential,
        serviceConsentVersion: foundingHouseholdServiceConsentVersion,
        serviceDisclosureDigest: previewBody.serviceDisclosureDigest,
        servicePolicyDigest: previewBody.servicePolicyDigest,
        serviceConsentAccepted: true,
        protectedEnrollmentConsentVersion: foundingHouseholdProtectedEnrollmentConsentVersion,
        protectedEnrollmentDisclosureDigest: previewBody.protectedEnrollmentDisclosureDigest,
        protectedEnrollmentPolicyDigest: previewBody.protectedEnrollmentPolicyDigest,
        protectedEnrollmentConsentAccepted: true,
        marketingConsent: true,
        inviteSecret: 'must-not-be-accepted',
      },
    });
    const missingKey = await harness.app.inject({
      method: 'POST',
      url: `/v1/founding-households/invitations/${issued.invitationId}/accept`,
      headers: bobHeaders,
      payload: {
        invitationCredential: issued.credential,
        serviceConsentVersion: foundingHouseholdServiceConsentVersion,
        serviceDisclosureDigest: previewBody.serviceDisclosureDigest,
        servicePolicyDigest: previewBody.servicePolicyDigest,
        serviceConsentAccepted: true,
        protectedEnrollmentConsentVersion: foundingHouseholdProtectedEnrollmentConsentVersion,
        protectedEnrollmentDisclosureDigest: previewBody.protectedEnrollmentDisclosureDigest,
        protectedEnrollmentPolicyDigest: previewBody.protectedEnrollmentPolicyDigest,
        protectedEnrollmentConsentAccepted: true,
      },
    });
    const nonAdmin = await harness.app.inject({
      method: 'POST',
      url: `/v1/founding-households/invitations/${issued.invitationId}/preview`,
      headers: {
        ...browserHeaders(terry.cookie as string),
        'x-bb-household-id': 'household-sunrise',
      },
      payload: { invitationCredential: issued.credential },
    });
    const enrollments = await harness.database.query(
      'SELECT 1 FROM founding_household_enrollments',
    );

    expect(crossHousehold.statusCode).toBe(403);
    expect(extraConsent.statusCode).toBe(400);
    expect(missingKey.statusCode).toBe(400);
    expect(nonAdmin.statusCode).toBe(403);
    expectPrivateNoStore(crossHousehold.headers);
    expectPrivateNoStore(extraConsent.headers);
    expectPrivateNoStore(missingKey.headers);
    expectPrivateNoStore(nonAdmin.headers);
    expect(enrollments.rows).toHaveLength(0);
    expect(extraConsent.body).not.toContain('must-not-be-accepted');
  });

  it('allows household withdrawal while preserving unrelated grants and append-only history', async () => {
    harness = await createApiHarness(createMutableClock(clockStart));
    const issued = await activateAndInvite();
    const bob = await login(harness.app, 'owner-bob', 'customer');
    const customerHeaders = {
      ...browserHeaders(bob.cookie as string),
      'x-bb-household-id': 'household-harbor',
    };
    const previewResponse = await harness.app.inject({
      method: 'POST',
      url: `/v1/founding-households/invitations/${issued.invitationId}/preview`,
      headers: customerHeaders,
      payload: { invitationCredential: issued.credential },
    });
    const previewBody = foundingHouseholdInvitationPreviewResponseSchema.parse(
      previewResponse.json(),
    );
    await harness.app.inject({
      method: 'POST',
      url: `/v1/founding-households/invitations/${issued.invitationId}/accept`,
      headers: { ...customerHeaders, 'idempotency-key': operation('accept', 3) },
      payload: {
        invitationCredential: issued.credential,
        serviceConsentVersion: foundingHouseholdServiceConsentVersion,
        serviceDisclosureDigest: previewBody.serviceDisclosureDigest,
        servicePolicyDigest: previewBody.servicePolicyDigest,
        serviceConsentAccepted: true,
        protectedEnrollmentConsentVersion: foundingHouseholdProtectedEnrollmentConsentVersion,
        protectedEnrollmentDisclosureDigest: previewBody.protectedEnrollmentDisclosureDigest,
        protectedEnrollmentPolicyDigest: previewBody.protectedEnrollmentPolicyDigest,
        protectedEnrollmentConsentAccepted: true,
      },
    });
    const unrelatedBefore = await harness.database.query<Record<string, unknown>>(
      `SELECT id, revoked_at FROM entitlement_grants
       WHERE household_id = 'household-harbor'
         AND id NOT IN (SELECT entitlement_grant_id FROM founding_household_enrollments)
       ORDER BY id`,
    );
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/founding-households/offboard',
      headers: { ...customerHeaders, 'idempotency-key': operation('offboard', 4) },
    });
    const unrelatedAfter = await harness.database.query<Record<string, unknown>>(
      `SELECT id, revoked_at FROM entitlement_grants
       WHERE household_id = 'household-harbor'
         AND id NOT IN (SELECT entitlement_grant_id FROM founding_household_enrollments)
       ORDER BY id`,
    );
    const history = await harness.database.query<
      {
        invitation_count: number;
        enrollment_count: number;
      } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::integer FROM founding_household_invitations) AS invitation_count,
         (SELECT count(*)::integer FROM founding_household_enrollments) AS enrollment_count`,
    );

    expect(response.statusCode, response.body).toBe(200);
    expectPrivateNoStore(response.headers);
    expect(response.json()).toMatchObject({
      enrollment: { state: 'revoked' },
      reason: 'household_withdrew',
      unrelatedGrantsChanged: false,
      externalActionExecuted: false,
    });
    expect(unrelatedAfter.rows).toEqual(unrelatedBefore.rows);
    expect(history.rows[0]).toEqual({ invitation_count: 1, enrollment_count: 1 });
  });

  it('uses immutable Founding transition evidence for general self re-enrollment after offboarding', async () => {
    harness = await createApiHarness(createMutableClock(clockStart));
    const issued = await activateAndInvite();
    const bob = await login(harness.app, 'owner-bob', 'customer');
    const customerHeaders = {
      ...browserHeaders(bob.cookie as string),
      'x-bb-household-id': 'household-harbor',
    };
    const olivia = await login(harness.app, 'protected-olivia', 'customer');
    const oliviaWithdrawal = await harness.app.inject({
      method: 'POST',
      url: '/v1/protected-enrollment/withdraw',
      headers: {
        ...browserHeaders(olivia.cookie as string),
        'x-bb-household-id': 'household-harbor',
        'idempotency-key': protectedOperation('withdraw', 29),
      },
      payload: { withdrawalAcknowledged: true },
    });
    expect(oliviaWithdrawal.statusCode, oliviaWithdrawal.body).toBe(200);
    expect(oliviaWithdrawal.json().changed).toBe(true);
    const previewResponse = await harness.app.inject({
      method: 'POST',
      url: `/v1/founding-households/invitations/${issued.invitationId}/preview`,
      headers: customerHeaders,
      payload: { invitationCredential: issued.credential },
    });
    const preview = foundingHouseholdInvitationPreviewResponseSchema.parse(previewResponse.json());
    const acceptance = await harness.app.inject({
      method: 'POST',
      url: `/v1/founding-households/invitations/${issued.invitationId}/accept`,
      headers: { ...customerHeaders, 'idempotency-key': operation('accept', 30) },
      payload: {
        invitationCredential: issued.credential,
        serviceConsentVersion: foundingHouseholdServiceConsentVersion,
        serviceDisclosureDigest: preview.serviceDisclosureDigest,
        servicePolicyDigest: preview.servicePolicyDigest,
        serviceConsentAccepted: true,
        protectedEnrollmentConsentVersion: foundingHouseholdProtectedEnrollmentConsentVersion,
        protectedEnrollmentDisclosureDigest: preview.protectedEnrollmentDisclosureDigest,
        protectedEnrollmentPolicyDigest: preview.protectedEnrollmentPolicyDigest,
        protectedEnrollmentConsentAccepted: true,
      },
    });
    expect(acceptance.statusCode, acceptance.body).toBe(201);

    await installSyntheticLocalFamilyEntitlement(harness, {
      householdId: 'household-harbor',
      payerPersonId: 'person-owner-bob',
      suffix: 'founding-interop-local-family',
      precedence: 300,
    });
    const preOffboardAllocation = await harness.database.query<
      {
        readonly entitlement_grant_id: string;
        readonly founding_grant_id: string;
      } & Record<string, unknown>
    >(
      `SELECT allowance.entitlement_grant_id,
              enrollment.entitlement_grant_id AS founding_grant_id
       FROM protected_members protected
       JOIN commerce_allowance_allocations allowance
         ON allowance.household_id = protected.household_id
        AND allowance.id = protected.allowance_allocation_id
       JOIN founding_household_enrollments enrollment
         ON enrollment.household_id = protected.household_id
        AND enrollment.state = 'active'
       WHERE protected.household_id = 'household-harbor'
         AND protected.person_id = 'person-owner-bob'
         AND protected.status = 'accepted'
         AND allowance.state = 'active'`,
    );
    expect(preOffboardAllocation.rows[0]?.entitlement_grant_id).toBe(
      preOffboardAllocation.rows[0]?.founding_grant_id,
    );
    const offboarded = await harness.app.inject({
      method: 'POST',
      url: '/v1/founding-households/offboard',
      headers: { ...customerHeaders, 'idempotency-key': operation('offboard', 34) },
    });
    expect(offboarded.statusCode, offboarded.body).toBe(200);
    expect(offboarded.json().enrollment.state).toBe('revoked');
    expect(offboarded.json().reboundProtectedAllocations).toBe(1);

    const postOffboardWithdrawal = await harness.app.inject({
      method: 'POST',
      url: '/v1/protected-enrollment/withdraw',
      headers: {
        ...customerHeaders,
        'idempotency-key': protectedOperation('withdraw', 35),
      },
      payload: { withdrawalAcknowledged: true },
    });
    expect(postOffboardWithdrawal.statusCode, postOffboardWithdrawal.body).toBe(200);
    expect(postOffboardWithdrawal.json().changed).toBe(true);

    const postOffboardStatusResponse = await harness.app.inject({
      method: 'GET',
      url: '/v1/protected-enrollment',
      headers: customerHeaders,
    });
    const postOffboardStatus =
      postOffboardStatusResponse.json<ProtectedSelfEnrollmentStatusResponse>();
    expect(postOffboardStatus.eligibility).toBe('available');
    const postOffboardReenrollment = await harness.app.inject({
      method: 'POST',
      url: '/v1/protected-enrollment',
      headers: { ...customerHeaders, 'idempotency-key': protectedOperation('enroll', 36) },
      payload: generalProtectedEnrollmentPayload(postOffboardStatus),
    });
    expect(postOffboardReenrollment.statusCode, postOffboardReenrollment.body).toBe(201);

    const evidence = await harness.database.query<
      {
        readonly historical_founding_acceptances: number;
        readonly historical_founding_transitions: number;
        readonly current_general_acceptances: number;
        readonly founding_state: string;
        readonly current_consent_version: string;
      } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::int FROM consent_evidence
          WHERE household_id = 'household-harbor'
            AND actor_person_id = 'person-owner-bob'
            AND action = 'accept'
            AND source_interaction = 'founding_household_protected_enrollment'
            AND disclosure_version = 'founding-household-protected-self-v1'
            AND supersedes_evidence_id IS NULL) AS historical_founding_acceptances,
         (SELECT count(*)::int
          FROM founding_household_allowance_transitions transition
          JOIN founding_household_enrollments enrollment
            ON enrollment.id = transition.enrollment_id
          JOIN commerce_allowance_allocations allowance
            ON allowance.household_id = transition.household_id
           AND allowance.id = transition.allowance_allocation_id
          WHERE enrollment.household_id = 'household-harbor'
            AND transition.allowance_key = 'protected_members'
            AND transition.from_grant_id = enrollment.entitlement_grant_id
            AND allowance.subject_id = 'person-owner-bob')
           AS historical_founding_transitions,
         (SELECT count(*)::int FROM consent_evidence
          WHERE household_id = 'household-harbor'
            AND actor_person_id = 'person-owner-bob'
            AND action = 'accept'
            AND source_interaction = 'protected_enrollment_accept'
            AND disclosure_version = 'protected-self-enrollment-disclosure-v1')
           AS current_general_acceptances,
         (SELECT state FROM founding_household_enrollments
          WHERE household_id = 'household-harbor') AS founding_state,
         (SELECT consent_version FROM protected_members
          WHERE household_id = 'household-harbor'
            AND person_id = 'person-owner-bob') AS current_consent_version`,
    );
    expect(evidence.rows[0]).toEqual({
      historical_founding_acceptances: 1,
      historical_founding_transitions: 1,
      current_general_acceptances: 1,
      founding_state: 'revoked',
      current_consent_version: 'protected-self-enrollment-v1',
    });
  }, 30_000);

  it('preserves exact Founding acceptance while allowing general self re-enrollment during active service', async () => {
    harness = await createApiHarness(createMutableClock(clockStart));
    const issued = await activateAndInvite();
    const bob = await login(harness.app, 'owner-bob', 'customer');
    const customerHeaders = {
      ...browserHeaders(bob.cookie as string),
      'x-bb-household-id': 'household-harbor',
    };
    const previewResponse = await harness.app.inject({
      method: 'POST',
      url: `/v1/founding-households/invitations/${issued.invitationId}/preview`,
      headers: customerHeaders,
      payload: { invitationCredential: issued.credential },
    });
    const preview = foundingHouseholdInvitationPreviewResponseSchema.parse(previewResponse.json());
    const acceptance = await harness.app.inject({
      method: 'POST',
      url: `/v1/founding-households/invitations/${issued.invitationId}/accept`,
      headers: { ...customerHeaders, 'idempotency-key': operation('accept', 40) },
      payload: {
        invitationCredential: issued.credential,
        serviceConsentVersion: foundingHouseholdServiceConsentVersion,
        serviceDisclosureDigest: preview.serviceDisclosureDigest,
        servicePolicyDigest: preview.servicePolicyDigest,
        serviceConsentAccepted: true,
        protectedEnrollmentConsentVersion: foundingHouseholdProtectedEnrollmentConsentVersion,
        protectedEnrollmentDisclosureDigest: preview.protectedEnrollmentDisclosureDigest,
        protectedEnrollmentPolicyDigest: preview.protectedEnrollmentPolicyDigest,
        protectedEnrollmentConsentAccepted: true,
      },
    });
    expect(acceptance.statusCode, acceptance.body).toBe(201);

    const withdrawn = await harness.app.inject({
      method: 'POST',
      url: '/v1/protected-enrollment/withdraw',
      headers: {
        ...customerHeaders,
        'idempotency-key': protectedOperation('withdraw', 41),
      },
      payload: { withdrawalAcknowledged: true },
    });
    expect(withdrawn.statusCode, withdrawn.body).toBe(200);
    const statusResponse = await harness.app.inject({
      method: 'GET',
      url: '/v1/protected-enrollment',
      headers: customerHeaders,
    });
    const enrollmentStatus = statusResponse.json<ProtectedSelfEnrollmentStatusResponse>();
    expect(enrollmentStatus.eligibility).toBe('available');
    const reenrolled = await harness.app.inject({
      method: 'POST',
      url: '/v1/protected-enrollment',
      headers: { ...customerHeaders, 'idempotency-key': protectedOperation('enroll', 42) },
      payload: generalProtectedEnrollmentPayload(enrollmentStatus),
    });
    expect(reenrolled.statusCode, reenrolled.body).toBe(201);
    expect(reenrolled.json().consentVersion).toBe('protected-self-enrollment-v1');

    const evidence = await harness.database.query<
      {
        readonly historical_founding_acceptances: number;
        readonly current_general_acceptances: number;
        readonly founding_state: string;
      } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::int FROM consent_evidence
          WHERE household_id = 'household-harbor'
            AND actor_person_id = 'person-owner-bob'
            AND action = 'accept'
            AND source_interaction = 'founding_household_protected_enrollment')
           AS historical_founding_acceptances,
         (SELECT count(*)::int FROM consent_evidence
          WHERE household_id = 'household-harbor'
            AND actor_person_id = 'person-owner-bob'
            AND action = 'accept'
            AND source_interaction = 'protected_enrollment_accept')
           AS current_general_acceptances,
         (SELECT state FROM founding_household_enrollments
          WHERE household_id = 'household-harbor') AS founding_state`,
    );
    expect(evidence.rows[0]).toEqual({
      historical_founding_acceptances: 1,
      current_general_acceptances: 1,
      founding_state: 'active',
    });
  }, 30_000);
});

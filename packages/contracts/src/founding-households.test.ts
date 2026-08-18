import { describe, expect, it } from 'vitest';
import { foundingHouseholdFunnelStages } from '@boomerbuddy/domain';

import {
  acceptFoundingHouseholdInvitationRequestSchema,
  configureFoundingHouseholdPolicyRequestSchema,
  createFoundingHouseholdInvitationRequestSchema,
  createFoundingHouseholdInvitationResponseSchema,
  foundingHouseholdInvitationCredentialSchema,
  foundingHouseholdInvitationPreviewRequestSchema,
  foundingHouseholdEnrollmentSchema,
  foundingHouseholdOperationKeySchema,
} from './founding-households';

describe('Founding Household contracts', () => {
  it('requires action-bound idempotency keys and bounded invitation credentials', () => {
    expect(
      foundingHouseholdOperationKeySchema.safeParse(
        'founding-accept:11111111-1111-4111-8111-111111111111',
      ).success,
    ).toBe(true);
    expect(
      foundingHouseholdOperationKeySchema.safeParse(
        'provisioning:accept:11111111-1111-4111-8111-111111111111',
      ).success,
    ).toBe(false);
    expect(
      foundingHouseholdInvitationCredentialSchema.safeParse(`invitation-local.${'a'.repeat(43)}`)
        .success,
    ).toBe(true);
    expect(foundingHouseholdInvitationCredentialSchema.safeParse('invite.secret').success).toBe(
      false,
    );
  });

  it('does not let an active policy omit capacity, expiry, or code-owned benefits', () => {
    expect(
      configureFoundingHouseholdPolicyRequestSchema.safeParse({
        state: 'active',
        expectedRevision: 1,
        benefitKey: 'plus_beta_v1',
        maxHouseholds: 5,
        invitationTtlDays: 7,
        accessDurationDays: 45,
        programEndsAt: '2026-10-01T00:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      configureFoundingHouseholdPolicyRequestSchema.safeParse({
        state: 'active',
        expectedRevision: 1,
        benefitKey: 'free_forever',
      }).success,
    ).toBe(false);
  });

  it('requires exact service and protected-self consent without research or marketing fields', () => {
    const request = {
      invitationCredential: `invitation-local.${'a'.repeat(43)}`,
      serviceConsentVersion: 'founding-household-service-beta-v1',
      serviceDisclosureDigest: '1'.repeat(64),
      servicePolicyDigest: '2'.repeat(64),
      serviceConsentAccepted: true,
      protectedEnrollmentConsentVersion: 'founding-household-protected-self-v1',
      protectedEnrollmentDisclosureDigest: '3'.repeat(64),
      protectedEnrollmentPolicyDigest: '4'.repeat(64),
      protectedEnrollmentConsentAccepted: true,
    };
    expect(acceptFoundingHouseholdInvitationRequestSchema.safeParse(request).success).toBe(true);
    expect(
      acceptFoundingHouseholdInvitationRequestSchema.safeParse({
        ...request,
        serviceConsentVersion: 'founding-household-service-beta-v2',
      }).success,
    ).toBe(true);
    expect(
      acceptFoundingHouseholdInvitationRequestSchema.safeParse({
        ...request,
        marketingConsent: true,
      }).success,
    ).toBe(false);
    expect(
      acceptFoundingHouseholdInvitationRequestSchema.safeParse({
        ...request,
        serviceConsentAccepted: false,
      }).success,
    ).toBe(false);
    expect(
      acceptFoundingHouseholdInvitationRequestSchema.safeParse({
        ...request,
        householdId: 'household-client-selected',
      }).success,
    ).toBe(false);
    expect(
      foundingHouseholdInvitationPreviewRequestSchema.safeParse({
        invitationCredential: request.invitationCredential,
      }).success,
    ).toBe(true);
    expect(
      foundingHouseholdInvitationPreviewRequestSchema.safeParse({
        invitationCredential: request.invitationCredential,
        householdId: 'household-client-selected',
      }).success,
    ).toBe(false);
  });

  it('accepts only an exact provider subject for founder-issued production invitations', () => {
    expect(
      createFoundingHouseholdInvitationRequestSchema.parse({
        intendedCustomerSubject: 'user_2abcDEF123',
      }),
    ).toEqual({ intendedCustomerSubject: 'user_2abcDEF123' });
    expect(
      createFoundingHouseholdInvitationRequestSchema.safeParse({
        intendedCustomerSubject: 'person@example.test',
      }).success,
    ).toBe(false);
    expect(
      createFoundingHouseholdInvitationRequestSchema.safeParse({
        householdId: 'household-attacker-selected',
        intendedCustomerSubject: 'user_2abcDEF123',
      }).success,
    ).toBe(false);
  });

  it('returns a production one-time credential only with immutable identity binding', () => {
    const response = {
      invitation: {
        id: 'founding-invitation-1',
        environment: 'production',
        policyRevision: 2,
        benefitKey: 'family_beta_v1',
        state: 'pending',
        createdAt: '2026-08-17T12:00:00.000Z',
        expiresAt: '2026-08-24T12:00:00.000Z',
        identityBindingState: 'verified_identity',
        intendedCustomerSubject: 'user_2abcDEF123',
        householdId: 'household-production-1',
      },
      invitationCredential: `founding-invitation-1.${'a'.repeat(43)}`,
      credentialState: 'created_credential_returned',
      reused: false,
      credentialRecoverable: false,
      delivery: 'founder_manual_only',
      externalActionExecuted: false,
    };
    expect(createFoundingHouseholdInvitationResponseSchema.safeParse(response).success).toBe(true);
    expect(
      createFoundingHouseholdInvitationResponseSchema.safeParse({
        ...response,
        invitation: {
          ...response.invitation,
          identityBindingState: 'development_unbound',
          intendedCustomerSubject: undefined,
          householdId: undefined,
        },
      }).success,
    ).toBe(false);
  });

  it('projects boolean cohort milestones without actor identifiers or precise event times', () => {
    const enrollment = {
      id: 'enrollment-example',
      environment: 'local',
      householdId: 'household-example',
      invitationId: 'invitation-example',
      benefitKey: 'family_beta_v1',
      state: 'active',
      ledgerState: 'active',
      serviceConsentState: 'active',
      startsAt: '2026-08-17T12:00:00.000Z',
      endsAt: '2026-09-16T12:00:00.000Z',
      effectiveEndsAt: '2026-09-16T12:00:00.000Z',
      paymentState: 'not_paid_sponsored_beta',
      evidenceTier: 'local_simulation',
      researchConsent: false,
      marketingConsent: false,
      followUpConsent: false,
      funnel: foundingHouseholdFunnelStages.map((stage) => ({
        stage,
        state: 'not_observed',
        evidenceSource: 'not_implemented',
      })),
    };
    expect(foundingHouseholdEnrollmentSchema.safeParse(enrollment).success).toBe(true);
    for (const serviceConsentState of [
      'proposed',
      'deferred',
      'withdrawn',
      'relinquished',
      'suspended',
      'revoked',
      'expired',
      'missing',
    ]) {
      expect(
        foundingHouseholdEnrollmentSchema.safeParse({ ...enrollment, serviceConsentState }).success,
      ).toBe(true);
    }
    expect(
      foundingHouseholdEnrollmentSchema.safeParse({
        ...enrollment,
        acceptedByPersonId: 'person-example',
      }).success,
    ).toBe(false);
    expect(
      foundingHouseholdEnrollmentSchema.safeParse({
        ...enrollment,
        funnel: enrollment.funnel.map((milestone, index) =>
          index === 0 ? { ...milestone, observedAt: '2026-08-17T12:00:00.000Z' } : milestone,
        ),
      }).success,
    ).toBe(false);
  });
});

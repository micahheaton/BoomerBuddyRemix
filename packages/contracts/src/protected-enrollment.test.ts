import { describe, expect, it } from 'vitest';

import {
  enrollProtectedSelfRequestSchema,
  protectedSelfEnrollmentOperationKeySchema,
  protectedSelfEnrollmentStatusResponseSchema,
  withdrawProtectedSelfRequestSchema,
} from './protected-enrollment';

const enrollmentRequest = {
  consentVersion: 'protected-self-enrollment-v1',
  disclosureVersion: 'protected-self-enrollment-disclosure-v1',
  disclosureDigest: '1'.repeat(64),
  policyVersion: 'protected-self-enrollment-policy-v1',
  policyDigest: '2'.repeat(64),
  consentAccepted: true,
} as const;

describe('protected-self enrollment contracts', () => {
  it('requires action-bound UUID operation keys', () => {
    expect(
      protectedSelfEnrollmentOperationKeySchema.safeParse(
        'protected-self-enroll:11111111-1111-4111-8111-111111111111',
      ).success,
    ).toBe(true);
    expect(
      protectedSelfEnrollmentOperationKeySchema.safeParse(
        'protected-self-withdraw:22222222-2222-4222-8222-222222222222',
      ).success,
    ).toBe(true);
    expect(
      protectedSelfEnrollmentOperationKeySchema.safeParse('protected-self-enroll:not-a-uuid')
        .success,
    ).toBe(false);
  });

  it('accepts only exact self-consent evidence and no client-selected authority target', () => {
    expect(enrollProtectedSelfRequestSchema.safeParse(enrollmentRequest).success).toBe(true);
    expect(
      enrollProtectedSelfRequestSchema.safeParse({
        ...enrollmentRequest,
        consentAccepted: false,
      }).success,
    ).toBe(false);
    for (const authorityField of [
      { personId: 'person-someone-else' },
      { householdId: 'household-somewhere-else' },
      { actorPersonId: 'person-manager' },
    ]) {
      expect(
        enrollProtectedSelfRequestSchema.safeParse({
          ...enrollmentRequest,
          ...authorityField,
        }).success,
      ).toBe(false);
    }
    expect(
      withdrawProtectedSelfRequestSchema.safeParse({ withdrawalAcknowledged: true }).success,
    ).toBe(true);
    expect(
      withdrawProtectedSelfRequestSchema.safeParse({
        withdrawalAcknowledged: true,
        personId: 'person-someone-else',
      }).success,
    ).toBe(false);
  });

  it('keeps current enrollment, effective access, and withdrawal state consistent', () => {
    const base = {
      householdId: 'household-test',
      personId: 'person-test',
      eligibility: 'available',
      withdrawalAvailable: false,
      consent: {
        version: 'protected-self-enrollment-v1',
        disclosure: {
          version: 'protected-self-enrollment-disclosure-v1',
          text: 'Exact disclosure.',
          digest: '1'.repeat(64),
        },
        policy: {
          version: 'protected-self-enrollment-policy-v1',
          text: 'Exact policy.',
          digest: '2'.repeat(64),
        },
      },
    } as const;
    expect(
      protectedSelfEnrollmentStatusResponseSchema.safeParse({
        ...base,
        enrollment: { state: 'not_enrolled', effectiveAccess: false },
      }).success,
    ).toBe(true);
    expect(
      protectedSelfEnrollmentStatusResponseSchema.safeParse({
        ...base,
        eligibility: 'already_enrolled',
        withdrawalAvailable: false,
        enrollment: {
          state: 'enrolled',
          effectiveAccess: true,
          consentVersion: 'protected-self-enrollment-v1',
        },
      }).success,
    ).toBe(false);
    expect(
      protectedSelfEnrollmentStatusResponseSchema.safeParse({
        ...base,
        enrollment: { state: 'not_enrolled', effectiveAccess: true },
      }).success,
    ).toBe(false);
  });
});

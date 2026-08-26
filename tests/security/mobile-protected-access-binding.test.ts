import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ProtectedSelfEnrollmentStatusResponse } from '@boomerbuddy/contracts';
import { protectedSelfEnrollmentConsentVersion } from '@boomerbuddy/domain';
import { describe, expect, it } from 'vitest';
import {
  createProtectedAccessEnrollmentOperation,
  createProtectedAccessWithdrawalOperation,
  isDefinitiveProtectedAccessMutationFailure,
  parseProtectedAccessStatus,
  protectedAccessAttemptIsCurrent,
  protectedAccessOperationIsResolvedByStatus,
  protectedAccessTruthAnnouncement,
} from '../../apps/mobile/src/protected-access-resource';

const repositoryRoot = resolve(import.meta.dirname, '../..');

function source(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

function status(
  overrides: Partial<ProtectedSelfEnrollmentStatusResponse> = {},
): ProtectedSelfEnrollmentStatusResponse {
  return {
    householdId: 'household-alpha',
    personId: 'person-member',
    enrollment: { state: 'not_enrolled', effectiveAccess: false },
    eligibility: 'available',
    withdrawalAvailable: false,
    consent: {
      version: protectedSelfEnrollmentConsentVersion,
      disclosure: {
        version: 'disclosure-v1',
        text: 'Generated disclosure text with no customer data.',
        digest: 'a'.repeat(64),
      },
      policy: {
        version: 'policy-v1',
        text: 'Generated policy text with no customer data.',
        digest: 'b'.repeat(64),
      },
    },
    ...overrides,
  };
}

describe('mobile protected-access binding', () => {
  it('captures one exact reviewed enrollment request and action-bound idempotency key', () => {
    const reviewed = status();
    const operation = createProtectedAccessEnrollmentOperation(
      reviewed.householdId,
      reviewed,
      '10000000-0000-4000-8000-000000000001',
    );

    expect(operation).toEqual({
      action: 'enroll',
      householdId: 'household-alpha',
      key: 'protected-self-enroll:10000000-0000-4000-8000-000000000001',
      request: {
        consentVersion: protectedSelfEnrollmentConsentVersion,
        disclosureVersion: 'disclosure-v1',
        disclosureDigest: 'a'.repeat(64),
        policyVersion: 'policy-v1',
        policyDigest: 'b'.repeat(64),
        consentAccepted: true,
      },
      reviewedConsent: reviewed.consent,
    });

    const laterStatus = status({
      consent: {
        ...reviewed.consent,
        disclosure: {
          ...reviewed.consent.disclosure,
          version: 'disclosure-v2',
          digest: 'c'.repeat(64),
        },
      },
    });
    expect(operation.request.disclosureVersion).not.toBe(laterStatus.consent.disclosure.version);
    expect(operation.reviewedConsent).toBe(reviewed.consent);
  });

  it('requires the exact selected household and signed-in person for status and mutations', () => {
    const response = status();

    expect(parseProtectedAccessStatus(response, response.householdId, response.personId)).toEqual(
      response,
    );
    expect(() => parseProtectedAccessStatus(response, 'household-beta', response.personId)).toThrow(
      'selected household member',
    );
    expect(() =>
      parseProtectedAccessStatus(response, response.householdId, 'person-other'),
    ).toThrow('selected household member');
    expect(() =>
      createProtectedAccessEnrollmentOperation(
        'household-beta',
        response,
        '10000000-0000-4000-8000-000000000002',
      ),
    ).toThrow('not available for this household');
  });

  it('suppresses obsolete household, generation, and request attempts', () => {
    const attempt = {
      householdId: 'household-alpha',
      householdGeneration: 4,
      requestId: 7,
      action: 'enroll',
      operationKey: 'protected-self-enroll:10000000-0000-4000-8000-000000000003',
    } as const;

    expect(
      protectedAccessAttemptIsCurrent(attempt, {
        householdId: 'household-alpha',
        householdGeneration: 4,
        requestId: 7,
      }),
    ).toBe(true);
    expect(
      protectedAccessAttemptIsCurrent(attempt, {
        householdId: 'household-beta',
        householdGeneration: 4,
        requestId: 7,
      }),
    ).toBe(false);
    expect(
      protectedAccessAttemptIsCurrent(attempt, {
        householdId: 'household-alpha',
        householdGeneration: 5,
        requestId: 7,
      }),
    ).toBe(false);
    expect(
      protectedAccessAttemptIsCurrent(attempt, {
        householdId: 'household-alpha',
        householdGeneration: 4,
        requestId: 8,
      }),
    ).toBe(false);
  });

  it('retains keys only when a mutation outcome can still be ambiguous', () => {
    for (const ambiguous of [undefined, 408, 429, 500, 503]) {
      expect(isDefinitiveProtectedAccessMutationFailure(ambiguous)).toBe(false);
    }
    for (const definitive of [400, 401, 403, 404, 409, 422]) {
      expect(isDefinitiveProtectedAccessMutationFailure(definitive)).toBe(true);
    }
  });

  it('reconciles uncertain operations only after status proves the action resolved', () => {
    const notEnrolled = status();
    const enrollment = createProtectedAccessEnrollmentOperation(
      notEnrolled.householdId,
      notEnrolled,
      '10000000-0000-4000-8000-000000000004',
    );
    const enrolled = status({
      enrollment: {
        state: 'enrolled',
        effectiveAccess: true,
        consentVersion: protectedSelfEnrollmentConsentVersion,
      },
      eligibility: 'already_enrolled',
      withdrawalAvailable: true,
    });
    const withdrawal = createProtectedAccessWithdrawalOperation(
      enrolled.householdId,
      enrolled,
      '10000000-0000-4000-8000-000000000005',
    );

    expect(protectedAccessOperationIsResolvedByStatus(enrollment, notEnrolled)).toBe(false);
    expect(protectedAccessOperationIsResolvedByStatus(enrollment, enrolled)).toBe(true);
    expect(protectedAccessOperationIsResolvedByStatus(withdrawal, enrolled)).toBe(false);
    expect(protectedAccessOperationIsResolvedByStatus(withdrawal, notEnrolled)).toBe(true);
  });

  it('derives temporal-replay messaging only from refreshed current status', () => {
    const notEnrolled = status();
    const enrolledInactive = status({
      enrollment: {
        state: 'enrolled',
        effectiveAccess: false,
        consentVersion: protectedSelfEnrollmentConsentVersion,
      },
      eligibility: 'already_enrolled',
      withdrawalAvailable: true,
    });

    expect(protectedAccessTruthAnnouncement('enroll', notEnrolled)).toBe(
      'Current status: not enrolled. No protected-adult enrollment is currently recorded for this household.',
    );
    expect(protectedAccessTruthAnnouncement('withdraw', enrolledInactive)).toBe(
      'Current status: enrolled. Your protected-adult consent remains recorded for this household.',
    );
    expect(protectedAccessTruthAnnouncement('enroll', enrolledInactive)).toContain(
      'features are unavailable while household access is inactive',
    );
  });

  it('keeps the protected-self flow reachable and explicit on the production mobile surface', () => {
    const app = source('apps/mobile/App.tsx');
    const navigation = source('apps/mobile/src/navigation.ts');
    const screens = source('apps/mobile/src/screens.tsx');

    expect(navigation).toContain('ProtectedAccess: undefined;');
    expect(app).toContain('name="ProtectedAccess"');
    expect(app).toContain('component={ProtectedAccessScreen}');
    expect(screens).toContain("navigation.navigate('ProtectedAccess')");
    expect(screens).toContain('I am choosing protected-adult access for myself');
    expect(screens).toContain('I understand these effects and want to withdraw my own');
    expect(screens).toContain("'Idempotency-Key': operation.key");
    expect(screens).toContain("'X-BB-Household-Id': operation.householdId");
    expect(screens).toContain('This screen does not charge a card');
    expect(screens).toContain(
      'protectedAccessTruthAnnouncement(operation.action, refreshedStatus)',
    );
    expect(screens).not.toContain('response.changed');
  });
});

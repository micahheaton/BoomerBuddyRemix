import {
  enrollProtectedSelfRequestSchema,
  enrollProtectedSelfResponseSchema,
  protectedSelfEnrollmentOperationKeySchema,
  protectedSelfEnrollmentStatusResponseSchema,
  withdrawProtectedSelfRequestSchema,
  withdrawProtectedSelfResponseSchema,
  type EnrollProtectedSelfRequest,
  type EnrollProtectedSelfResponse,
  type ProtectedSelfEnrollmentStatusResponse,
  type WithdrawProtectedSelfResponse,
} from '@boomerbuddy/contracts';

export type ProtectedAccessAction = 'enroll' | 'withdraw';

export type ProtectedAccessOperation =
  | {
      readonly action: 'enroll';
      readonly householdId: string;
      readonly key: string;
      readonly request: EnrollProtectedSelfRequest;
      readonly reviewedConsent: ProtectedSelfEnrollmentStatusResponse['consent'];
    }
  | {
      readonly action: 'withdraw';
      readonly householdId: string;
      readonly key: string;
      readonly request: { readonly withdrawalAcknowledged: true };
    };

export type ProtectedAccessAttempt = {
  readonly householdId: string;
  readonly householdGeneration: number;
  readonly requestId: number;
  readonly action: ProtectedAccessAction;
  readonly operationKey: string;
};

export type ProtectedAccessAttemptContext = {
  readonly householdId: string;
  readonly householdGeneration: number;
  readonly requestId: number;
};

export const protectedAccessEligibilityMessage: Readonly<
  Record<ProtectedSelfEnrollmentStatusResponse['eligibility'], string>
> = {
  available: 'One protected-adult seat is available in this household.',
  already_enrolled: 'Your protected-adult enrollment is already recorded.',
  entitlement_inactive:
    'This household does not currently have effective access for a protected-adult enrollment.',
  allowance_exhausted:
    'Every protected-adult seat is currently in use. Another adult must manage their own consent.',
  allowance_usage_unknown:
    'BoomerBuddy cannot safely confirm an available protected-adult seat right now. No enrollment will be recorded.',
};

export function protectedAccessOperationSlot(
  householdId: string,
  action: ProtectedAccessAction,
): string {
  return `${householdId}:${action}`;
}

function protectedAccessOperationKey(action: ProtectedAccessAction, uuid: string): string {
  return protectedSelfEnrollmentOperationKeySchema.parse(`protected-self-${action}:${uuid}`);
}

export function createProtectedAccessEnrollmentOperation(
  householdId: string,
  status: ProtectedSelfEnrollmentStatusResponse,
  uuid: string,
): ProtectedAccessOperation & { readonly action: 'enroll' } {
  if (
    status.householdId !== householdId ||
    status.enrollment.state !== 'not_enrolled' ||
    status.eligibility !== 'available'
  ) {
    throw new TypeError('Protected access enrollment is not available for this household');
  }
  const request = enrollProtectedSelfRequestSchema.parse({
    consentVersion: status.consent.version,
    disclosureVersion: status.consent.disclosure.version,
    disclosureDigest: status.consent.disclosure.digest,
    policyVersion: status.consent.policy.version,
    policyDigest: status.consent.policy.digest,
    consentAccepted: true,
  });
  return {
    action: 'enroll',
    householdId,
    key: protectedAccessOperationKey('enroll', uuid),
    request,
    reviewedConsent: status.consent,
  };
}

export function createProtectedAccessWithdrawalOperation(
  householdId: string,
  status: ProtectedSelfEnrollmentStatusResponse,
  uuid: string,
): ProtectedAccessOperation & { readonly action: 'withdraw' } {
  if (
    status.householdId !== householdId ||
    status.enrollment.state !== 'enrolled' ||
    !status.withdrawalAvailable
  ) {
    throw new TypeError('Protected access withdrawal is not available for this household');
  }
  return {
    action: 'withdraw',
    householdId,
    key: protectedAccessOperationKey('withdraw', uuid),
    request: withdrawProtectedSelfRequestSchema.parse({ withdrawalAcknowledged: true }),
  };
}

export function parseProtectedAccessStatus(
  value: unknown,
  householdId: string,
  personId: string,
): ProtectedSelfEnrollmentStatusResponse {
  const status = protectedSelfEnrollmentStatusResponseSchema.parse(value);
  if (status.householdId !== householdId || status.personId !== personId) {
    throw new TypeError('Protected access status did not match the selected household member');
  }
  return status;
}

export function parseProtectedAccessEnrollment(value: unknown): EnrollProtectedSelfResponse {
  return enrollProtectedSelfResponseSchema.parse(value);
}

export function parseProtectedAccessWithdrawal(value: unknown): WithdrawProtectedSelfResponse {
  return withdrawProtectedSelfResponseSchema.parse(value);
}

export function protectedAccessAttemptIsCurrent(
  attempt: ProtectedAccessAttempt,
  context: ProtectedAccessAttemptContext,
): boolean {
  return (
    attempt.householdId === context.householdId &&
    attempt.householdGeneration === context.householdGeneration &&
    attempt.requestId === context.requestId
  );
}

export function isDefinitiveProtectedAccessMutationFailure(status: number | undefined): boolean {
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export function protectedAccessOperationIsResolvedByStatus(
  operation: ProtectedAccessOperation,
  status: ProtectedSelfEnrollmentStatusResponse,
): boolean {
  if (operation.householdId !== status.householdId) return false;
  return operation.action === 'enroll'
    ? status.enrollment.state === 'enrolled'
    : status.enrollment.state === 'not_enrolled';
}

export function protectedAccessTruthAnnouncement(
  action: ProtectedAccessAction,
  status: ProtectedSelfEnrollmentStatusResponse,
): string {
  if (status.enrollment.state === 'enrolled') {
    if (action === 'withdraw') {
      return 'Current status: enrolled. Your protected-adult consent remains recorded for this household.';
    }
    return status.enrollment.effectiveAccess
      ? 'Current status: enrolled. Protected-adult features are available for this household.'
      : 'Current status: enrolled. Consent is recorded, but protected-adult features are unavailable while household access is inactive.';
  }
  return action === 'enroll'
    ? 'Current status: not enrolled. No protected-adult enrollment is currently recorded for this household.'
    : 'Current status: not enrolled. Your protected-adult consent is not currently recorded for this household.';
}

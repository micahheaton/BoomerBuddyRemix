'use client';

import {
  enrollProtectedSelfResponseSchema,
  protectedSelfEnrollmentOperationKeySchema,
  protectedSelfEnrollmentStatusResponseSchema,
  withdrawProtectedSelfResponseSchema,
  type ProtectedSelfEnrollmentStatusResponse,
} from '@boomerbuddy/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useHousehold } from '../../../components/household-context';
import { apiRequest, readableError } from '../../../lib/api';
import {
  bindProtectedSelfOperation,
  protectedSelfOperationMatchesScope,
  protectedSelfOperationStorageKey,
  protectedSelfScopeKey,
  protectedSelfStatusMatchesScope,
  shouldRetainProtectedSelfOperation,
  type BoundProtectedSelfOperation,
  type ProtectedSelfAction,
  type ProtectedSelfScope,
} from './protection-scope';

function operationKey(action: 'enroll' | 'withdraw'): string {
  return `protected-self-${action}:${crypto.randomUUID()}`;
}

const eligibilityMessage: Readonly<
  Record<ProtectedSelfEnrollmentStatusResponse['eligibility'], string>
> = {
  available: 'A protected-adult seat is available in this household.',
  already_enrolled: 'Your protected-adult enrollment is already active.',
  entitlement_inactive:
    'This household does not currently have effective access for a protected-adult enrollment.',
  allowance_exhausted:
    'Every protected-adult seat is currently in use. A payer or administrator cannot withdraw another adult’s consent to free a seat.',
  allowance_usage_unknown:
    'BoomerBuddy cannot safely confirm an available protected-adult seat right now. No enrollment has been recorded.',
};

type HouseholdContextValue = ReturnType<typeof useHousehold>;
type HouseholdProtectionPageProps = Pick<
  HouseholdContextValue,
  'refreshPrincipal' | 'selectedHouseholdId' | 'selectedHouseholdName' | 'selectedScope'
> & { readonly personId: string };

function restoreOperation(
  scope: ProtectedSelfScope,
  action: ProtectedSelfAction,
): BoundProtectedSelfOperation | undefined {
  const stored = window.sessionStorage.getItem(protectedSelfOperationStorageKey(scope, action));
  const parsed = protectedSelfEnrollmentOperationKeySchema.safeParse(stored);
  return parsed.success ? { ...scope, action, key: parsed.data } : undefined;
}

function HouseholdProtectionPage({
  personId,
  refreshPrincipal,
  selectedHouseholdId,
  selectedHouseholdName,
  selectedScope,
}: HouseholdProtectionPageProps) {
  const [status, setStatus] = useState<ProtectedSelfEnrollmentStatusResponse>();
  const [loading, setLoading] = useState(true);
  const [enrollmentAccepted, setEnrollmentAccepted] = useState(false);
  const [withdrawalAcknowledged, setWithdrawalAcknowledged] = useState(false);
  const [busy, setBusy] = useState<'enroll' | 'withdraw' | ''>('');
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const enrollOperation = useRef<BoundProtectedSelfOperation | undefined>(undefined);
  const withdrawOperation = useRef<BoundProtectedSelfOperation | undefined>(undefined);
  const active = useRef(false);
  const statusController = useRef<AbortController | undefined>(undefined);
  const statusGeneration = useRef(0);

  const scope: ProtectedSelfScope = { householdId: selectedHouseholdId, personId };

  function retainOperation(
    reference: React.MutableRefObject<BoundProtectedSelfOperation | undefined>,
    action: ProtectedSelfAction,
  ): BoundProtectedSelfOperation {
    const restored = protectedSelfOperationMatchesScope(reference.current, scope, action)
      ? reference.current
      : restoreOperation(scope, action);
    const operation = bindProtectedSelfOperation(restored, scope, action, operationKey);
    reference.current = operation;
    window.sessionStorage.setItem(protectedSelfOperationStorageKey(scope, action), operation.key);
    return operation;
  }

  function clearOperation(
    reference: React.MutableRefObject<BoundProtectedSelfOperation | undefined>,
    operation: BoundProtectedSelfOperation,
  ): void {
    window.sessionStorage.removeItem(protectedSelfOperationStorageKey(operation, operation.action));
    if (reference.current === operation) reference.current = undefined;
  }

  const loadStatus = useCallback(async () => {
    const generation = ++statusGeneration.current;
    statusController.current?.abort();
    if (!selectedHouseholdId) {
      if (active.current) {
        setStatus(undefined);
        setLoading(false);
      }
      return undefined;
    }
    const controller = new AbortController();
    statusController.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 15_000);
    setLoading(true);
    setStatus(undefined);
    try {
      const response = protectedSelfEnrollmentStatusResponseSchema.parse(
        await apiRequest<ProtectedSelfEnrollmentStatusResponse>('/v1/protected-enrollment', {
          headers: { 'X-BB-Household-Id': selectedHouseholdId },
          signal: controller.signal,
        }),
      );
      if (!active.current || generation !== statusGeneration.current || controller.signal.aborted) {
        return undefined;
      }
      if (
        !protectedSelfStatusMatchesScope(response, { householdId: selectedHouseholdId, personId })
      ) {
        throw new Error(
          'BoomerBuddy returned protected-adult status for a different account scope. Nothing was changed.',
        );
      }
      const satisfiedAction = response.enrollment.state === 'enrolled' ? 'enroll' : 'withdraw';
      const satisfiedReference = satisfiedAction === 'enroll' ? enrollOperation : withdrawOperation;
      const satisfiedScope = { householdId: selectedHouseholdId, personId };
      const satisfiedOperation = protectedSelfOperationMatchesScope(
        satisfiedReference.current,
        satisfiedScope,
        satisfiedAction,
      )
        ? satisfiedReference.current
        : restoreOperation(satisfiedScope, satisfiedAction);
      if (satisfiedOperation !== undefined) {
        window.sessionStorage.removeItem(
          protectedSelfOperationStorageKey(satisfiedOperation, satisfiedOperation.action),
        );
        if (satisfiedReference.current === satisfiedOperation) {
          satisfiedReference.current = undefined;
        }
      }
      setStatus(response);
      setError('');
      return response;
    } catch (caught) {
      if (
        !active.current ||
        generation !== statusGeneration.current ||
        (controller.signal.aborted && !timedOut)
      ) {
        return undefined;
      }
      setStatus(undefined);
      setError(
        timedOut
          ? 'BoomerBuddy did not respond in time while checking protected-adult status.'
          : readableError(caught),
      );
      return undefined;
    } finally {
      window.clearTimeout(timeout);
      if (statusController.current === controller) statusController.current = undefined;
      if (active.current && generation === statusGeneration.current) setLoading(false);
    }
  }, [personId, selectedHouseholdId]);

  useEffect(() => {
    active.current = true;
    const timer = window.setTimeout(() => {
      void loadStatus();
    }, 0);
    return () => {
      active.current = false;
      window.clearTimeout(timer);
      statusGeneration.current += 1;
      statusController.current?.abort();
      statusController.current = undefined;
    };
  }, [loadStatus]);

  async function enroll() {
    const operationScope = { householdId: selectedHouseholdId, personId };
    if (
      !status ||
      !protectedSelfStatusMatchesScope(status, operationScope) ||
      status.eligibility !== 'available' ||
      !enrollmentAccepted
    ) {
      return;
    }
    const statusSnapshot = status;
    const operation = retainOperation(enrollOperation, 'enroll');
    setBusy('enroll');
    setError('');
    setAnnouncement('');
    try {
      enrollProtectedSelfResponseSchema.parse(
        await apiRequest('/v1/protected-enrollment', {
          method: 'POST',
          headers: {
            'Idempotency-Key': operation.key,
            'X-BB-Household-Id': operation.householdId,
          },
          body: JSON.stringify({
            consentVersion: statusSnapshot.consent.version,
            disclosureVersion: statusSnapshot.consent.disclosure.version,
            disclosureDigest: statusSnapshot.consent.disclosure.digest,
            policyVersion: statusSnapshot.consent.policy.version,
            policyDigest: statusSnapshot.consent.policy.digest,
            consentAccepted: true,
          }),
        }),
      );
      clearOperation(enrollOperation, operation);
      if (!active.current) return;
      setEnrollmentAccepted(false);
      const principal = await refreshPrincipal(operation.householdId);
      if (
        !active.current ||
        principal.selectedHouseholdId !== operation.householdId ||
        principal.me.principal.personId !== operation.personId
      ) {
        return;
      }
      const current = await loadStatus();
      if (current !== undefined && protectedSelfStatusMatchesScope(current, operation)) {
        setAnnouncement(
          current.enrollment.state === 'enrolled'
            ? 'Your current protected-adult status is enrolled.'
            : 'Your current protected-adult status is not enrolled.',
        );
      }
    } catch (caught) {
      if (!shouldRetainProtectedSelfOperation(caught)) {
        clearOperation(enrollOperation, operation);
      }
      if (active.current) setError(readableError(caught));
    } finally {
      if (active.current) setBusy('');
    }
  }

  async function withdraw() {
    const operationScope = { householdId: selectedHouseholdId, personId };
    if (
      !status?.withdrawalAvailable ||
      !protectedSelfStatusMatchesScope(status, operationScope) ||
      !withdrawalAcknowledged
    ) {
      return;
    }
    const operation = retainOperation(withdrawOperation, 'withdraw');
    setBusy('withdraw');
    setError('');
    setAnnouncement('');
    try {
      withdrawProtectedSelfResponseSchema.parse(
        await apiRequest('/v1/protected-enrollment/withdraw', {
          method: 'POST',
          headers: {
            'Idempotency-Key': operation.key,
            'X-BB-Household-Id': operation.householdId,
          },
          body: JSON.stringify({ withdrawalAcknowledged: true }),
        }),
      );
      clearOperation(withdrawOperation, operation);
      if (!active.current) return;
      setWithdrawalAcknowledged(false);
      const principal = await refreshPrincipal(operation.householdId);
      if (
        !active.current ||
        principal.selectedHouseholdId !== operation.householdId ||
        principal.me.principal.personId !== operation.personId
      ) {
        return;
      }
      const current = await loadStatus();
      if (current !== undefined && protectedSelfStatusMatchesScope(current, operation)) {
        setAnnouncement(
          current.enrollment.state === 'not_enrolled'
            ? 'Your current protected-adult status is not enrolled.'
            : 'Your current protected-adult status is enrolled.',
        );
      }
    } catch (caught) {
      if (!shouldRetainProtectedSelfOperation(caught)) {
        clearOperation(withdrawOperation, operation);
      }
      if (active.current) setError(readableError(caught));
    } finally {
      if (active.current) setBusy('');
    }
  }

  return (
    <main id="main-content" className="member-shell member-main">
      <span className="eyebrow">Your consent</span>
      <h1 className="member-heading">Protected-adult access</h1>
      <p className="lede">
        Review and choose protected-adult access for yourself in{' '}
        <strong>{selectedHouseholdName || 'the selected household'}</strong>. Paying for or managing
        a household never lets someone accept this consent for another adult.
      </p>
      {announcement ? (
        <p className="notice" role="status">
          {announcement}
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p role="status">Checking your protected-adult enrollment…</p> : null}

      {!loading && !selectedHouseholdId ? (
        <section className="notice notice-warning">
          <h2>An active household is required</h2>
          <p>You need an active household membership before you can make this choice.</p>
        </section>
      ) : null}

      {!loading && status ? (
        <>
          <section className="card" aria-labelledby="protected-access-status">
            <h2 id="protected-access-status">Current status</h2>
            {status.enrollment.state === 'enrolled' ? (
              <>
                <p>
                  <strong>Enrolled for this household.</strong>{' '}
                  {status.enrollment.effectiveAccess
                    ? 'Protected-adult features are available under the household’s current access.'
                    : 'Enrollment remains recorded, but protected-adult features are unavailable while household access is inactive.'}
                </p>
                <p className="meta">Recorded consent version: {status.enrollment.consentVersion}</p>
              </>
            ) : (
              <p>
                <strong>Not enrolled.</strong> {eligibilityMessage[status.eligibility]}
              </p>
            )}
            {status.eligibility === 'entitlement_inactive' &&
            selectedScope?.isBillingManager === true ? (
              <p>
                <Link href="/member/billing">Review household billing and recovery</Link>. Billing
                access and protected-adult consent remain separate choices.
              </p>
            ) : null}
          </section>

          {status.enrollment.state === 'not_enrolled' ? (
            <section className="card" aria-labelledby="protected-consent-review">
              <h2 id="protected-consent-review">Review before enrolling</h2>
              <p className="meta">Consent version: {status.consent.version}</p>
              <section
                className="notice"
                aria-label={`Protected-adult disclosure ${status.consent.disclosure.version}`}
              >
                <h3>What enrollment does</h3>
                <p>{status.consent.disclosure.text}</p>
                <p className="meta">Disclosure version: {status.consent.disclosure.version}</p>
                <details className="meta">
                  <summary>Disclosure evidence fingerprint</summary>
                  <code>{status.consent.disclosure.digest}</code>
                </details>
              </section>
              <section
                className="notice"
                aria-label={`Protected-adult policy ${status.consent.policy.version}`}
              >
                <h3>Consent and withdrawal policy</h3>
                <p>{status.consent.policy.text}</p>
                <p className="meta">Policy version: {status.consent.policy.version}</p>
                <details className="meta">
                  <summary>Policy evidence fingerprint</summary>
                  <code>{status.consent.policy.digest}</code>
                </details>
              </section>
              <label className="choice">
                <input
                  type="checkbox"
                  checked={enrollmentAccepted}
                  onChange={(event) => setEnrollmentAccepted(event.target.checked)}
                />
                I am choosing protected-adult access for myself in this exact household, and I
                accept the disclosure and policy shown above.
              </label>
              <button
                className="button-primary"
                type="button"
                disabled={busy !== '' || !enrollmentAccepted || status.eligibility !== 'available'}
                onClick={() => void enroll()}
              >
                {busy === 'enroll' ? 'Recording consent…' : 'Enroll myself'}
              </button>
              <p className="help">
                This action does not charge a card, change the subscription, invite anyone, or send
                a message.
              </p>
            </section>
          ) : (
            <>
              <section className="card" aria-labelledby="protected-next-steps">
                <h2 id="protected-next-steps">Continue your safety setup</h2>
                {status.enrollment.effectiveAccess ? (
                  <div className="button-row">
                    <Link className="button button-primary" href="/member/orientation">
                      Continue to orientation
                    </Link>
                    <Link className="button button-secondary" href="/member/check">
                      Open Check
                    </Link>
                    <Link className="button button-secondary" href="/member/history">
                      View history
                    </Link>
                  </div>
                ) : (
                  <p>
                    These features remain unavailable until the household has effective access. You
                    can still withdraw below.
                  </p>
                )}
              </section>
              <section className="card" aria-labelledby="protected-withdrawal">
                <h2 id="protected-withdrawal">Withdraw protected-adult consent</h2>
                <p>
                  Withdrawal ends your protected-adult access in this household and releases your
                  seat. It does not cancel billing, remove your household membership, delete Check
                  records, or withdraw separate sponsored-program service consent.
                </p>
                <label className="choice">
                  <input
                    type="checkbox"
                    checked={withdrawalAcknowledged}
                    onChange={(event) => setWithdrawalAcknowledged(event.target.checked)}
                  />
                  I understand these effects and want to withdraw my own protected-adult consent.
                </label>
                <button
                  className="button-secondary"
                  type="button"
                  disabled={busy !== '' || !withdrawalAcknowledged}
                  onClick={() => void withdraw()}
                >
                  {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw my consent'}
                </button>
              </section>
            </>
          )}

          <p className="help">
            Sponsored Founding Household service withdrawal is separate. If that program applies to
            this household, use{' '}
            <Link href="/member/founding-household">Founding Household controls</Link>.
          </p>
        </>
      ) : null}
    </main>
  );
}

export default function MemberProtectionPageClient() {
  const household = useHousehold();
  const personId = household.me.principal.personId;
  const scope = { householdId: household.selectedHouseholdId, personId };
  return (
    <HouseholdProtectionPage
      key={protectedSelfScopeKey(scope)}
      personId={personId}
      refreshPrincipal={household.refreshPrincipal}
      selectedHouseholdId={household.selectedHouseholdId}
      selectedHouseholdName={household.selectedHouseholdName}
      selectedScope={household.selectedScope}
    />
  );
}

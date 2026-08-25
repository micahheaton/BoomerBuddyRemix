'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  AcceptFoundingHouseholdInvitationResponse,
  FoundingHouseholdInvitationPreviewResponse,
  FoundingHouseholdMemberStatusResponse,
  OffboardFoundingHouseholdResponse,
} from '@boomerbuddy/contracts';
import { apiPaths } from '@boomerbuddy/contracts';

import { useHousehold } from '../../../components/household-context';
import { ApiError, apiRequest, readableError } from '../../../lib/api';

function operation(kind: 'accept' | 'offboard'): string {
  return `founding-${kind}:${crypto.randomUUID()}`;
}

function label(value: string): string {
  return value.replaceAll('_', ' ');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

interface FoundingHouseholdProps {
  readonly selectedHouseholdId: string;
  readonly isAdministrator: boolean;
  readonly allowEnrollment: boolean;
  readonly refreshPrincipal: (preferredHouseholdId?: string) => Promise<unknown>;
}

function FoundingHousehold({
  selectedHouseholdId,
  isAdministrator,
  allowEnrollment,
  refreshPrincipal,
}: FoundingHouseholdProps) {
  const [status, setStatus] = useState<FoundingHouseholdMemberStatusResponse>();
  const [credential, setCredential] = useState('');
  const [preview, setPreview] = useState<FoundingHouseholdInvitationPreviewResponse>();
  const [serviceConsent, setServiceConsent] = useState(false);
  const [protectedConsent, setProtectedConsent] = useState(false);
  const [withdrawConfirmed, setWithdrawConfirmed] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [authorizationLost, setAuthorizationLost] = useState(false);
  const pendingOperations = useRef(
    new Map<string, { readonly signature: string; readonly operationKey: string }>(),
  );

  function operationFor(slot: string, kind: 'accept' | 'offboard', signature: string): string {
    const current = pendingOperations.current.get(slot);
    if (current?.signature === signature) return current.operationKey;
    const operationKey = operation(kind);
    pendingOperations.current.set(slot, { signature, operationKey });
    return operationKey;
  }

  function resolveOperation(slot: string): void {
    pendingOperations.current.delete(slot);
  }

  function clearPrivateState(): void {
    pendingOperations.current.clear();
    setStatus(undefined);
    setCredential('');
    setPreview(undefined);
    setServiceConsent(false);
    setProtectedConsent(false);
    setWithdrawConfirmed(false);
    setNotice('');
  }

  function handleFailure(caught: unknown, slot?: string): void {
    if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) {
      clearPrivateState();
      setAuthorizationLost(true);
    } else if (slot !== undefined && caught instanceof ApiError && caught.status === 409) {
      resolveOperation(slot);
    }
    setError(readableError(caught));
  }

  const load = useCallback(async () => {
    if (!selectedHouseholdId || !isAdministrator) return;
    const response = await apiRequest<FoundingHouseholdMemberStatusResponse>(
      apiPaths.foundingHouseholds,
      { cache: 'no-store', headers: { 'X-BB-Household-Id': selectedHouseholdId } },
    );
    setStatus(response);
    setAuthorizationLost(false);
  }, [isAdministrator, selectedHouseholdId]);

  useEffect(() => {
    let active = true;
    if (!selectedHouseholdId || !isAdministrator) return () => undefined;
    void apiRequest<FoundingHouseholdMemberStatusResponse>(apiPaths.foundingHouseholds, {
      cache: 'no-store',
      headers: { 'X-BB-Household-Id': selectedHouseholdId },
    })
      .then((response) => {
        if (active) {
          setStatus(response);
          setAuthorizationLost(false);
        }
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) {
          pendingOperations.current.clear();
          setStatus(undefined);
          setCredential('');
          setPreview(undefined);
          setServiceConsent(false);
          setProtectedConsent(false);
          setWithdrawConfirmed(false);
          setAuthorizationLost(true);
        }
        setError(readableError(caught));
      });
    return () => {
      active = false;
    };
  }, [isAdministrator, selectedHouseholdId]);

  async function review(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    setPreview(undefined);
    setServiceConsent(false);
    setProtectedConsent(false);
    try {
      const separator = credential.indexOf('.');
      if (separator < 1) throw new Error('Enter the complete one-time invitation credential.');
      const invitationId = credential.slice(0, separator);
      const response = await apiRequest<FoundingHouseholdInvitationPreviewResponse>(
        `${apiPaths.foundingHouseholds}/invitations/${encodeURIComponent(invitationId)}/preview`,
        {
          method: 'POST',
          cache: 'no-store',
          headers: { 'X-BB-Household-Id': selectedHouseholdId },
          body: JSON.stringify({ invitationCredential: credential }),
        },
      );
      if (response.householdId !== selectedHouseholdId) {
        throw new Error('The invitation preview is not bound to the selected household.');
      }
      setPreview(response);
      setNotice(
        'Invitation reviewed. No access, consent, payment, or external action has occurred.',
      );
    } catch (caught) {
      handleFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (
      !preview ||
      preview.householdId !== selectedHouseholdId ||
      !serviceConsent ||
      !protectedConsent
    )
      return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const [
        renderedServiceDisclosureDigest,
        renderedServicePolicyDigest,
        renderedProtectedDisclosureDigest,
        renderedProtectedPolicyDigest,
      ] = await Promise.all([
        sha256Hex(preview.serviceDisclosureText),
        sha256Hex(preview.servicePolicyText),
        sha256Hex(preview.protectedEnrollmentDisclosureText),
        sha256Hex(preview.protectedEnrollmentPolicyText),
      ]);
      if (
        renderedServiceDisclosureDigest !== preview.serviceDisclosureDigest ||
        renderedServicePolicyDigest !== preview.servicePolicyDigest ||
        renderedProtectedDisclosureDigest !== preview.protectedEnrollmentDisclosureDigest ||
        renderedProtectedPolicyDigest !== preview.protectedEnrollmentPolicyDigest
      ) {
        throw new Error('The rendered Founding Household consent documents failed verification.');
      }
      const signature = JSON.stringify({
        householdId: selectedHouseholdId,
        invitationId: preview.invitationId,
        serviceDisclosureDigest: renderedServiceDisclosureDigest,
        servicePolicyDigest: renderedServicePolicyDigest,
        protectedEnrollmentDisclosureDigest: renderedProtectedDisclosureDigest,
        protectedEnrollmentPolicyDigest: renderedProtectedPolicyDigest,
      });
      const result = await apiRequest<AcceptFoundingHouseholdInvitationResponse>(
        `${apiPaths.foundingHouseholds}/invitations/${encodeURIComponent(preview.invitationId)}/accept`,
        {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'X-BB-Household-Id': selectedHouseholdId,
            'Idempotency-Key': operationFor('accept', 'accept', signature),
          },
          body: JSON.stringify({
            invitationCredential: credential,
            serviceConsentVersion: preview.serviceConsentVersion,
            serviceDisclosureDigest: renderedServiceDisclosureDigest,
            servicePolicyDigest: renderedServicePolicyDigest,
            serviceConsentAccepted: true,
            protectedEnrollmentConsentVersion: preview.protectedEnrollmentConsentVersion,
            protectedEnrollmentDisclosureDigest: renderedProtectedDisclosureDigest,
            protectedEnrollmentPolicyDigest: renderedProtectedPolicyDigest,
            protectedEnrollmentConsentAccepted: true,
          }),
        },
      );
      resolveOperation('accept');
      setCredential('');
      setPreview(undefined);
      setServiceConsent(false);
      setProtectedConsent(false);
      setNotice(
        `Sponsored beta access is ${result.enrollment.state} through ${new Date(result.enrollment.effectiveEndsAt).toLocaleString()}. No card was used.`,
      );
      await refreshPrincipal(selectedHouseholdId);
      await load();
    } catch (caught) {
      handleFailure(caught, 'accept');
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!withdrawConfirmed) return;
    const consentOnly = status?.enrollment?.ledgerState === 'revoked';
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const signature = `${selectedHouseholdId}:${status?.enrollment?.id ?? 'none'}`;
      await apiRequest<OffboardFoundingHouseholdResponse>(
        `${apiPaths.foundingHouseholds}/offboard`,
        {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'X-BB-Household-Id': selectedHouseholdId,
            'Idempotency-Key': operationFor('offboard', 'offboard', signature),
          },
        },
      );
      resolveOperation('offboard');
      setWithdrawConfirmed(false);
      setNotice(
        consentOnly
          ? 'Your service consent was withdrawn. The sponsored access had already ended.'
          : 'Your service consent was withdrawn and this sponsored access ended.',
      );
      await refreshPrincipal(selectedHouseholdId);
      await load();
    } catch (caught) {
      handleFailure(caught, 'offboard');
    } finally {
      setBusy(false);
    }
  }

  if (authorizationLost) {
    return (
      <main id="main-content" className="member-shell member-main">
        <p className="error" role="alert">
          Household authorization was lost. Private status and any unsaved choices were cleared;
          sign in again before reopening this page.
        </p>
      </main>
    );
  }

  return (
    <main id="main-content" className="member-shell member-main">
      <span className="eyebrow">{allowEnrollment ? 'Founding Household' : 'Sponsored access'}</span>
      <h1 className="member-heading">
        {allowEnrollment ? 'Review finite sponsored beta access' : 'Manage sponsored access'}
      </h1>
      <p className="lede">
        {allowEnrollment
          ? 'This path uses no card and sends no message. The exact active household administrator must review the exact benefit and give separate service and protected-adult consent before access changes.'
          : 'New sponsored enrollment is unavailable. A household that enrolled previously can review its status and withdraw service consent here.'}
      </p>
      {status ? (
        <div className="notice" role="note">
          {allowEnrollment ? (
            <>
              <strong>{label(status.environment)} environment workflow.</strong> Evidence is labeled{' '}
              {label(status.evidenceTier)}. The credential is manually delivered; this screen never
              sends a message or collects payment.
            </>
          ) : (
            <>
              <strong>Historical access only.</strong> This page cannot create, preview, or accept a
              new sponsored enrollment.
            </>
          )}
        </div>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      {!isAdministrator ? (
        <section className="card">
          <h2>Administrator authority required</h2>
          <p>
            Only the active household administrator can manage this household&apos;s sponsored
            access.
          </p>
        </section>
      ) : status?.enrollment ? (
        <section className="card">
          <span className="dev-pill">{label(status.enrollment.state)}</span>
          <h2>
            {allowEnrollment ? label(status.enrollment.benefitKey) : 'Family sponsored access'}
          </h2>
          <p>
            Sponsored from {new Date(status.enrollment.startsAt).toLocaleString()} through{' '}
            {new Date(status.enrollment.effectiveEndsAt).toLocaleString()}.
          </p>
          {allowEnrollment ? (
            <ul className="plain-list">
              <li>Payment: {label(status.enrollment.paymentState)}</li>
              <li>Ledger: {label(status.enrollment.ledgerState)}</li>
              <li>Service consent: {label(status.enrollment.serviceConsentState)}</li>
              <li>Research consent: no</li>
              <li>Marketing consent: no</li>
              <li>Follow-up consent: no</li>
              <li>Evidence: {label(status.enrollment.evidenceTier)}</li>
            </ul>
          ) : (
            <p>
              Service consent is{' '}
              {status.enrollment.serviceConsentState === 'active' ? 'active' : 'withdrawn'}.
            </p>
          )}
          {status.enrollment.accessAttentionCode ? (
            <p className="error" role="alert">
              {allowEnrollment
                ? `Effective sponsored access is not active: ${label(status.enrollment.accessAttentionCode)}. The ledger record is retained for attention and makes no payment claim.`
                : 'Sponsored access is not currently active. Contact support if this does not match your records.'}
            </p>
          ) : null}
          {allowEnrollment ? (
            <>
              <h3>Observed bounded funnel facts</h3>
              <ul className="plain-list">
                {status.enrollment.funnel.map((milestone) => (
                  <li key={milestone.stage}>
                    {label(milestone.stage)}: {label(milestone.state)} (
                    {label(milestone.evidenceSource)})
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {status.enrollment.serviceConsentState === 'active' ? (
            <div className="form-stack">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={withdrawConfirmed}
                  onChange={(event) => setWithdrawConfirmed(event.target.checked)}
                />
                {status.enrollment.ledgerState === 'active'
                  ? 'Withdraw service consent and end this sponsored access.'
                  : 'Withdraw service consent; the sponsored access has already ended.'}
              </label>
              <button
                className="button button-secondary"
                type="button"
                disabled={busy || !withdrawConfirmed}
                onClick={() => void withdraw()}
              >
                {status.enrollment.ledgerState === 'active'
                  ? 'End sponsored access'
                  : 'Withdraw remaining service consent'}
              </button>
            </div>
          ) : null}
        </section>
      ) : allowEnrollment ? (
        <>
          <form className="card form-stack" onSubmit={review}>
            <h2>Enter the one-time invitation credential</h2>
            <label htmlFor="founding-credential">Complete invitation credential</label>
            <input
              id="founding-credential"
              type="password"
              autoComplete="off"
              value={credential}
              minLength={48}
              maxLength={180}
              onChange={(event) => {
                setCredential(event.target.value);
                setPreview(undefined);
                setServiceConsent(false);
                setProtectedConsent(false);
                resolveOperation('accept');
              }}
            />
            <p className="meta">
              It is held only in this form state. Do not put it in source, documentation, logs,
              prompts, tickets, or campaigns.
            </p>
            <button className="button button-primary" type="submit" disabled={busy || !credential}>
              Review invitation - grant nothing yet
            </button>
          </form>

          {preview ? (
            <section className="card">
              <span className="dev-pill">
                No card · {label(status?.evidenceTier ?? preview.evidenceTier)}
              </span>
              <h2>{preview.benefit.displayName}</h2>
              <p>
                If accepted now, access ends no later than{' '}
                {new Date(preview.accessEndsAtIfAcceptedNow).toLocaleString()}.
              </p>
              <ul className="plain-list">
                <li>Protected adults: up to {preview.benefit.protectedMemberLimit}</li>
                <li>Trusted Circle participants: up to {preview.benefit.trustedCircleLimit}</li>
                <li>Payment required: no</li>
                <li>Research requested: no</li>
                <li>Marketing requested: no</li>
                <li>Follow-up requested: no</li>
              </ul>
              <section aria-labelledby="founding-service-terms">
                <h3 id="founding-service-terms">
                  Service disclosure · {preview.serviceConsentVersion}
                </h3>
                <p>{preview.serviceDisclosureText}</p>
                <p>{preview.servicePolicyText}</p>
              </section>
              <section aria-labelledby="founding-protected-terms">
                <h3 id="founding-protected-terms">
                  Protected-adult disclosure · {preview.protectedEnrollmentConsentVersion}
                </h3>
                <p>{preview.protectedEnrollmentDisclosureText}</p>
                <p>{preview.protectedEnrollmentPolicyText}</p>
              </section>
              <div className="form-stack">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={serviceConsent}
                    onChange={(event) => setServiceConsent(event.target.checked)}
                  />
                  I accept the exact service disclosure and policy rendered above. This is service
                  and bounded operational-cohort telemetry consent only, not research, content
                  reuse, marketing, follow-up, referral, testimonial, or media consent.
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={protectedConsent}
                    onChange={(event) => setProtectedConsent(event.target.checked)}
                  />
                  I separately accept the exact protected-adult disclosure and policy rendered above
                  for my self-enrollment.
                </label>
                <button
                  className="button button-primary"
                  type="button"
                  disabled={busy || !serviceConsent || !protectedConsent}
                  onClick={() => void accept()}
                >
                  Accept finite sponsored beta - no card
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setCredential('');
                    setPreview(undefined);
                    setServiceConsent(false);
                    setProtectedConsent(false);
                    setNotice('Review cancelled. No access or consent was recorded.');
                  }}
                >
                  Cancel and forget credential
                </button>
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <section className="card">
          <h2>No historical sponsored access</h2>
          <p>This household does not have a sponsored enrollment to manage.</p>
          <Link href="/member">Return to member home</Link>
        </section>
      )}
    </main>
  );
}

export default function FoundingHouseholdPage() {
  const { selectedHouseholdId, selectedScope, refreshPrincipal } = useHousehold();
  const allowEnrollment = process.env.NODE_ENV !== 'production';
  return (
    <FoundingHousehold
      key={`${selectedHouseholdId}:${String(
        selectedScope?.isAdministrator === true,
      )}:${String(allowEnrollment)}`}
      selectedHouseholdId={selectedHouseholdId}
      isAdministrator={selectedScope?.isAdministrator === true}
      allowEnrollment={allowEnrollment}
      refreshPrincipal={refreshPrincipal}
    />
  );
}

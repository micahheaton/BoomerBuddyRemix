'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type {
  CheckListResponse,
  EntitlementResponse,
  OrientationStateDto,
} from '@boomerbuddy/contracts';
import { useHousehold } from '../../components/household-context';
import { apiRequest, readableError } from '../../lib/api';

export default function MemberHomePage() {
  const { me, selectedHouseholdId, selectedScope } = useHousehold();
  const [orientation, setOrientation] = useState<OrientationStateDto>();
  const [checkCount, setCheckCount] = useState(0);
  const [entitlements, setEntitlements] = useState<{
    householdId: string;
    value: EntitlementResponse;
  }>();
  const [entitlementsUnavailableFor, setEntitlementsUnavailableFor] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!selectedHouseholdId) return;
    const scopedHeaders = { 'X-BB-Household-Id': selectedHouseholdId };
    const tasks: Promise<void>[] = [];
    const isProtectedMember = selectedScope?.isProtectedMember === true;
    if (isProtectedMember && selectedScope.capabilities.includes('orientation:use')) {
      tasks.push(
        apiRequest<{ orientation: OrientationStateDto }>('/v1/orientation', {
          headers: scopedHeaders,
        }).then((response) => setOrientation(response.orientation)),
      );
    }
    if (
      selectedScope?.capabilities.includes('history:read') &&
      (isProtectedMember ||
        selectedScope.trustedCircleGrants.some((grant) =>
          grant.permissions.includes('view_shared_checks'),
        ))
    ) {
      tasks.push(
        apiRequest<CheckListResponse>('/v1/checks', { headers: scopedHeaders }).then((response) =>
          setCheckCount(response.total),
        ),
      );
    }
    if (selectedScope?.isBillingManager) {
      void apiRequest<EntitlementResponse>('/v1/entitlements', { headers: scopedHeaders })
        .then((response) => {
          setEntitlements({ householdId: selectedHouseholdId, value: response });
          setEntitlementsUnavailableFor('');
        })
        .catch(() => setEntitlementsUnavailableFor(selectedHouseholdId));
    }
    void Promise.all(tasks).catch((caught) => setError(readableError(caught)));
  }, [selectedHouseholdId, selectedScope]);

  const isUnassigned = me.principal.households.length === 0;
  const isProtectedMember = selectedScope?.isProtectedMember === true;
  const canCheck =
    isProtectedMember &&
    (selectedScope?.capabilities.includes('check:text') ||
      selectedScope?.capabilities.includes('check:url'));
  const canUseOrientation =
    isProtectedMember && selectedScope?.capabilities.includes('orientation:use');
  const canReadHistory =
    selectedScope?.capabilities.includes('history:read') &&
    (isProtectedMember ||
      selectedScope.trustedCircleGrants.some((grant) =>
        grant.permissions.includes('view_shared_checks'),
      ));
  const canUseFamily =
    isUnassigned ||
    selectedScope?.isAdministrator === true ||
    selectedScope?.isProtectedMember === true ||
    (selectedScope?.trustedCircleGrants.length ?? 0) > 0;
  const selectedEntitlements =
    entitlements?.householdId === selectedHouseholdId ? entitlements.value : undefined;
  const protectedAllowance = selectedEntitlements?.commerce.allowances.find(
    (allowance) => allowance.kind === 'protected_members',
  );
  const trustedAllowance = selectedEntitlements?.commerce.allowances.find(
    (allowance) => allowance.kind === 'trusted_circle_participants',
  );

  function allowanceSummary(label: string, allowance: typeof protectedAllowance): string {
    if (!allowance) return `${label}: unavailable in the local access projection.`;
    if (allowance.used === null) {
      return `${label}: usage unavailable; local limit ${allowance.limit}. State: ${allowance.state.replaceAll('_', ' ')}.`;
    }
    return `${label}: ${allowance.used} of ${allowance.limit} used; ${allowance.remaining} remaining. State: ${allowance.state.replaceAll('_', ' ')}.`;
  }

  return (
    <main id="main-content" className="member-shell member-main">
      <span className="eyebrow">Member home</span>
      <h1 className="member-heading">Hello, {me.principal.displayName}</h1>
      <p className="lede">
        {isUnassigned
          ? 'You are not connected to a household yet. A valid local invitation and your explicit consent are required before any household access appears.'
          : 'Take a breath. You can check something suspicious or ask a trusted person before you act.'}
      </p>
      {error && (
        <p className="error" role="alert">
          {error} <Link href="/sign-in">Return to sign in</Link>
        </p>
      )}
      {isUnassigned ? (
        <section className="card" style={{ marginTop: '1.5rem' }}>
          <span className="dev-pill">No household access</span>
          <h2>Accept an invitation when you are ready</h2>
          <p>
            Ask the protected member who initiated the invitation for the one-time ID and code, then
            review the requested relationship before accepting.
          </p>
          <Link className="button button-primary" href="/member/family">
            Open invitation acceptance
          </Link>
        </section>
      ) : (
        <div className="member-grid">
          <section className="card">
            <span className="dev-pill">Recommended next step</span>
            <h2>Check a message or link</h2>
            <p>
              Local rules-only analysis will show uncertainty and safer actions. Do not paste
              passwords or access codes.
            </p>
            {canCheck ? (
              <Link className="button button-primary" href="/member/check">
                Start a check
              </Link>
            ) : (
              <p className="meta">
                Checks require an active protected-adult enrollment in this household. Owner access
                alone does not grant this protected workflow.
              </p>
            )}
          </section>
          <section className="card">
            <h2>Orientation</h2>
            {canUseOrientation ? (
              <>
                <p>
                  {orientation?.status === 'ready'
                    ? 'Your guided setup is complete.'
                    : 'Review the short guided setup and product limits.'}
                </p>
                <div
                  className="progress"
                  role="progressbar"
                  aria-label="Orientation progress"
                  aria-valuemin={0}
                  aria-valuemax={6}
                  aria-valuenow={orientation?.completedSteps.length ?? 0}
                >
                  <span
                    style={{ width: `${((orientation?.completedSteps.length ?? 0) / 6) * 100}%` }}
                  />
                </div>
                <p className="meta">
                  {orientation?.completedSteps.length ?? 0} of 6 steps complete
                </p>
                <Link className="button button-secondary" href="/member/orientation">
                  {orientation?.status === 'ready' ? 'Review orientation' : 'Continue orientation'}
                </Link>
              </>
            ) : (
              <p className="meta">
                Orientation requires an active protected-adult enrollment in this household.
              </p>
            )}
          </section>
          <section className="card">
            <h2>Your recent checks</h2>
            {canReadHistory ? (
              <>
                <p>
                  <strong>{checkCount}</strong> minimized {checkCount === 1 ? 'record' : 'records'}{' '}
                  available in your history.
                </p>
                <Link href="/member/history">Open history</Link>
              </>
            ) : (
              <p className="meta">History is unavailable in this household scope.</p>
            )}
          </section>
          {selectedHouseholdId ? (
            <section className="card">
              <span className="dev-pill">
                {process.env.NODE_ENV === 'production'
                  ? 'Private beta · text only'
                  : 'Local text-only path'}
              </span>
              <h2>Share feedback</h2>
              <p>
                Record a product observation for this selected household. Media uploads and
                automatic outbound follow-up are disabled.
              </p>
              <Link href="/member/feedback">Open selected-household feedback</Link>
            </section>
          ) : null}
          {process.env.NODE_ENV !== 'production' ? (
            <section className="card">
              <span className="dev-pill">Provider-free local simulation</span>
              <h2>Messaging consent laboratory</h2>
              <p>
                Record a fictional test destination and review separate purpose choices. No SMS
                provider, contact upload, or delivery is available.
              </p>
              <Link href="/member/messaging">Open messaging consent laboratory</Link>
            </section>
          ) : null}
          {canUseFamily ? (
            <section className="card">
              <h2>Need another person?</h2>
              <p>See who is in your household and which Trusted Circle permissions are active.</p>
              <Link href="/member/family">Open Family</Link>
            </section>
          ) : null}
          {selectedScope?.isBillingManager ? (
            <section className="card">
              <h2>Billing</h2>
              <p>
                Review the founder-gated Founding Household offer and its payment-evidence state.
              </p>
              <Link href="/member/billing">Open billing</Link>
            </section>
          ) : null}
          {selectedScope?.isAdministrator ? (
            <section className="card">
              <span className="dev-pill">
                {process.env.NODE_ENV === 'production'
                  ? 'Founder-sponsored · no card'
                  : 'Local no-card path'}
              </span>
              <h2>Founding Household</h2>
              <p>
                Review a founder-issued, one-time invitation and finite sponsored beta terms. No
                payment or automatic message is sent.
              </p>
              <Link href="/member/founding-household">Open Founding Household review</Link>
            </section>
          ) : null}
          <section className="card" data-testid="local-access-summary">
            <span className="dev-pill">
              {process.env.NODE_ENV === 'production'
                ? 'Current access record'
                : 'Local access hypothesis'}
            </span>
            <h2>{selectedEntitlements?.commerce.primary?.plan.displayName ?? 'Access details'}</h2>
            <p>
              This access record is a product hypothesis. Billing initiation is a separate,
              founder-gated flow and may be unavailable for this household.
            </p>
            {!selectedScope?.isBillingManager ? (
              <p className="meta">
                Household plan totals are billing-manager-only. Your available actions still follow
                the permissions for this selected household.
              </p>
            ) : selectedEntitlements ? (
              <>
                <p className="meta">
                  Access state: {selectedEntitlements.commerce.accessState.replaceAll('_', ' ')}
                  {selectedEntitlements.commerce.primary
                    ? ` · Plan state: ${selectedEntitlements.commerce.primary.plan.state}`
                    : ''}
                </p>
                <ul className="plain-list">
                  <li>{allowanceSummary('Protected adults', protectedAllowance)}</li>
                  <li>{allowanceSummary('Trusted Circle participants', trustedAllowance)}</li>
                </ul>
              </>
            ) : entitlementsUnavailableFor === selectedHouseholdId ? (
              <p className="meta">
                Plan and allowance details are unavailable. The selected household permissions shown
                in the actions above still apply.
              </p>
            ) : (
              <p className="meta">Loading selected-household access details…</p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

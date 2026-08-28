'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type {
  CheckListResponse,
  EntitlementResponse,
  MemberLearningResponse,
  OrientationStateDto,
  TrustedCircleAttentionResponse,
} from '@boomerbuddy/contracts';
import { useHousehold } from '../../components/household-context';
import { apiRequest, readableError } from '../../lib/api';
import {
  householdBoundValue,
  householdRequestIsCurrent,
  type HouseholdBoundValue,
} from '../../lib/household-request';

export default function MemberHomePage() {
  const { me, selectedHouseholdId, selectedScope } = useHousehold();
  const [orientationState, setOrientationState] =
    useState<HouseholdBoundValue<OrientationStateDto>>();
  const [orientationErrorState, setOrientationErrorState] = useState<HouseholdBoundValue<string>>();
  const [checkCountState, setCheckCountState] = useState<HouseholdBoundValue<number>>();
  const [checkCountErrorState, setCheckCountErrorState] = useState<HouseholdBoundValue<string>>();
  const [attentionState, setAttentionState] =
    useState<HouseholdBoundValue<TrustedCircleAttentionResponse>>();
  const [attentionErrorState, setAttentionErrorState] = useState<HouseholdBoundValue<string>>();
  const [learningState, setLearningState] = useState<HouseholdBoundValue<MemberLearningResponse>>();
  const [learningErrorState, setLearningErrorState] = useState<HouseholdBoundValue<string>>();
  const [entitlements, setEntitlements] = useState<HouseholdBoundValue<EntitlementResponse>>();
  const [entitlementsErrorState, setEntitlementsErrorState] =
    useState<HouseholdBoundValue<string>>();
  const [reloadVersion, setReloadVersion] = useState(0);
  const selectedHouseholdIdRef = useRef(selectedHouseholdId);
  const loadGenerationRef = useRef(0);
  const hasTrustedCircleGrant =
    selectedScope?.trustedCircleGrants.some((grant) =>
      grant.permissions.includes('view_shared_checks'),
    ) === true;

  useEffect(() => {
    selectedHouseholdIdRef.current = selectedHouseholdId;
  }, [selectedHouseholdId]);

  useEffect(() => {
    const householdId = selectedHouseholdId;
    const generation = ++loadGenerationRef.current;
    if (!householdId) return;
    const controller = new AbortController();
    const requestIdentity = { householdId, generation };
    const requestIsCurrent = (): boolean =>
      !controller.signal.aborted &&
      householdRequestIsCurrent(requestIdentity, {
        householdId: selectedHouseholdIdRef.current,
        generation: loadGenerationRef.current,
      });
    const scopedRequest = {
      headers: { 'X-BB-Household-Id': householdId },
      signal: controller.signal,
    };
    const tasks: Promise<void>[] = [];
    const isProtectedMember = selectedScope?.isProtectedMember === true;
    if (isProtectedMember && selectedScope.capabilities.includes('orientation:use')) {
      tasks.push(
        apiRequest<{ orientation: OrientationStateDto }>('/v1/orientation', scopedRequest)
          .then((response) => {
            if (!requestIsCurrent()) return;
            setOrientationState({ householdId, value: response.orientation });
            setOrientationErrorState(undefined);
          })
          .catch((caught) => {
            if (!requestIsCurrent()) return;
            setOrientationErrorState({ householdId, value: readableError(caught) });
          }),
      );
      tasks.push(
        apiRequest<MemberLearningResponse>('/v1/member-learning', scopedRequest)
          .then((response) => {
            if (!requestIsCurrent()) return;
            setLearningState({ householdId, value: response });
            setLearningErrorState(undefined);
          })
          .catch((caught) => {
            if (!requestIsCurrent()) return;
            setLearningErrorState({ householdId, value: readableError(caught) });
          }),
      );
    }
    if (
      selectedScope?.capabilities.includes('history:read') &&
      (isProtectedMember || hasTrustedCircleGrant)
    ) {
      tasks.push(
        apiRequest<CheckListResponse>('/v1/checks', scopedRequest)
          .then((response) => {
            if (!requestIsCurrent()) return;
            setCheckCountState({ householdId, value: response.total });
            setCheckCountErrorState(undefined);
          })
          .catch((caught) => {
            if (!requestIsCurrent()) return;
            setCheckCountErrorState({ householdId, value: readableError(caught) });
          }),
      );
    }
    if (hasTrustedCircleGrant) {
      tasks.push(
        apiRequest<TrustedCircleAttentionResponse>('/v1/trusted-circle/attention', scopedRequest)
          .then((response) => {
            if (!requestIsCurrent()) return;
            setAttentionState({ householdId, value: response });
            setAttentionErrorState(undefined);
          })
          .catch((caught) => {
            if (!requestIsCurrent()) return;
            setAttentionErrorState({ householdId, value: readableError(caught) });
          }),
      );
    }
    if (selectedScope?.isBillingManager) {
      tasks.push(
        apiRequest<EntitlementResponse>('/v1/entitlements', scopedRequest)
          .then((response) => {
            if (!requestIsCurrent()) return;
            setEntitlements({ householdId, value: response });
            setEntitlementsErrorState(undefined);
          })
          .catch((caught) => {
            if (!requestIsCurrent()) return;
            setEntitlementsErrorState({ householdId, value: readableError(caught) });
          }),
      );
    }
    void Promise.all(tasks);
    return () => controller.abort();
  }, [hasTrustedCircleGrant, reloadVersion, selectedHouseholdId, selectedScope]);

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
  const canUseFamily = isUnassigned || selectedScope !== undefined;
  const canManageSponsoredAccess = selectedScope?.isAdministrator === true;
  const orientation = householdBoundValue(orientationState, selectedHouseholdId);
  const orientationError = householdBoundValue(orientationErrorState, selectedHouseholdId);
  const checkCount = householdBoundValue(checkCountState, selectedHouseholdId);
  const checkCountError = householdBoundValue(checkCountErrorState, selectedHouseholdId);
  const attention = householdBoundValue(attentionState, selectedHouseholdId);
  const attentionError = householdBoundValue(attentionErrorState, selectedHouseholdId);
  const learning = householdBoundValue(learningState, selectedHouseholdId);
  const learningError = householdBoundValue(learningErrorState, selectedHouseholdId);
  const selectedEntitlements = householdBoundValue(entitlements, selectedHouseholdId);
  const entitlementsError = householdBoundValue(entitlementsErrorState, selectedHouseholdId);
  const hasLoadError = Boolean(
    orientationError ||
    learningError ||
    checkCountError ||
    (hasTrustedCircleGrant && attentionError) ||
    entitlementsError,
  );
  const protectedAllowance = selectedEntitlements?.commerce.allowances.find(
    (allowance) => allowance.kind === 'protected_members',
  );
  const trustedAllowance = selectedEntitlements?.commerce.allowances.find(
    (allowance) => allowance.kind === 'trusted_circle_participants',
  );

  function allowanceSummary(label: string, allowance: typeof protectedAllowance): string {
    if (!allowance) return `${label}: details are not available right now.`;
    const status =
      allowance.state === 'available'
        ? 'Available.'
        : allowance.state === 'exhausted'
          ? 'The current plan limit has been reached.'
          : allowance.state === 'usage_unknown'
            ? 'Current use could not be confirmed.'
            : 'This allowance is not currently active.';
    if (allowance.used === null) {
      return `${label}: we could not load current use. The limit is ${allowance.limit}. ${status}`;
    }
    return `${label}: ${allowance.used} of ${allowance.limit} used; ${allowance.remaining} remaining. ${status}`;
  }

  function retryHome(): void {
    setOrientationErrorState(undefined);
    setLearningErrorState(undefined);
    setCheckCountErrorState(undefined);
    setAttentionErrorState(undefined);
    setEntitlementsErrorState(undefined);
    setReloadVersion((current) => current + 1);
  }

  return (
    <main id="main-content" className="member-shell member-main">
      <span className="eyebrow">Member home</span>
      <h1 className="member-heading">Hello, {me.principal.displayName}</h1>
      <p className="lede">
        {isUnassigned
          ? 'You are not connected to a household yet. A valid invitation and your explicit consent are required before any household access appears.'
          : 'Take a breath. You can check something suspicious or ask a trusted person before you act.'}
      </p>
      {hasLoadError ? (
        <section className="notice notice-warning" aria-labelledby="home-load-error-heading">
          <h2 id="home-load-error-heading">Some household details could not be loaded</h2>
          <p role="alert">
            Your role and available destinations are still shown. Try again before relying on a
            progress or record count.
          </p>
          <button className="button-secondary" type="button" onClick={retryHome}>
            Try loading household details again
          </button>
        </section>
      ) : null}
      {isUnassigned ? (
        <section className="card" style={{ marginTop: '1.5rem' }}>
          <span className="dev-pill">No household access</span>
          <h2>Accept an invitation when you are ready</h2>
          <p>
            {process.env.NODE_ENV === 'production'
              ? 'Create and keep your own temporary connection code in Family, then give it directly to the household organizer or protected member who is inviting you. They give you only the invitation ID. Use that ID with your own code to review whether this is neutral household membership or a Trusted Circle relationship before accepting.'
              : 'For this local test, ask the protected member for the invitation ID and separate one-time invitation credential, then review the requested Trusted Circle relationship before accepting.'}
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
              The result will show warning signs, uncertainty, and safer actions. Do not paste
              passwords or access codes.
            </p>
            {canCheck ? (
              <Link className="button button-primary" href="/member/check">
                Start a check
              </Link>
            ) : (
              <p className="meta">
                Only an enrolled protected adult can create a Check. Managing or paying for the
                household does not give you access to another adult&apos;s Checks.
              </p>
            )}
          </section>
          <section className="card">
            <h2>Orientation</h2>
            {canUseOrientation ? (
              <>
                <p>
                  {orientationError
                    ? 'Orientation progress is unavailable right now.'
                    : orientation?.status === 'ready'
                      ? 'Your guided setup is complete.'
                      : orientation
                        ? 'Review the short guided setup and product limits.'
                        : 'Loading orientation progress...'}
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
          {canUseOrientation ? (
            <section className="card">
              <span className="dev-pill">This week</span>
              <h2>Practice and reviewed updates</h2>
              {learning ? (
                <>
                  <p>
                    {learning.feed.unreadCount > 0
                      ? `${learning.feed.unreadCount} in-app update${
                          learning.feed.unreadCount === 1 ? '' : 's'
                        } ready to review.`
                      : 'You are caught up. A short lesson is always available when you want to practice.'}
                  </p>
                  <p className="meta">
                    {learning.curriculum.completedCount} of {learning.curriculum.totalCount} safety
                    lessons complete. Guidance is curated and dated, not live monitoring.
                  </p>
                </>
              ) : learningError ? (
                <p role="alert">Practice and update progress is unavailable right now.</p>
              ) : (
                <p>Loading this week&apos;s practice...</p>
              )}
              <Link href="/member/orientation#learn-updates">Open Learn &amp; updates</Link>
            </section>
          ) : null}
          {hasTrustedCircleGrant ? (
            <section className="card">
              <span className="dev-pill">Trusted Circle attention</span>
              <h2>Review requests</h2>
              {attentionError ? (
                <p role="alert">Trusted Circle requests are unavailable right now.</p>
              ) : attention ? (
                <p role="status">
                  {attention.pendingAcknowledgementCount > 0
                    ? `${attention.pendingAcknowledgementCount} shared ${
                        attention.pendingAcknowledgementCount === 1
                          ? 'result needs'
                          : 'results need'
                      } your acknowledgement.`
                    : 'No shared results are waiting for your acknowledgement.'}
                </p>
              ) : (
                <p role="status">Checking for Trusted Circle requests...</p>
              )}
              <p className="meta">
                BoomerBuddy does not send a text, email, or push alert. Open History here when a
                trusted person contacts you directly.
              </p>
              <Link href="/member/history">Open shared History</Link>
            </section>
          ) : null}
          <section className="card">
            <h2>Your recent checks</h2>
            {canReadHistory ? (
              <>
                {checkCountError ? (
                  <p role="alert">The current history count is unavailable right now.</p>
                ) : checkCount === undefined ? (
                  <p role="status">Loading your history count...</p>
                ) : (
                  <p>
                    <strong>{checkCount}</strong> minimized{' '}
                    {checkCount === 1 ? 'record' : 'records'} available in your history.
                  </p>
                )}
                <Link href="/member/history">Open history</Link>
              </>
            ) : (
              <p className="meta">History is unavailable for your role in this household.</p>
            )}
          </section>
          {selectedHouseholdId ? (
            <section className="card">
              <span className="dev-pill">Text feedback</span>
              <h2>Share feedback</h2>
              <p>
                Tell us what worked, what was confusing, or what went wrong. You can send text only,
                and BoomerBuddy will not contact you by email or text automatically.
              </p>
              <Link href="/member/feedback">Share feedback</Link>
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
              <p>Review your current plan, payment status, and available billing controls.</p>
              <Link href="/member/billing">Open billing</Link>
            </section>
          ) : null}
          {process.env.NODE_ENV !== 'production' && selectedScope?.isAdministrator ? (
            <section className="card">
              <span className="dev-pill">Local no-card path</span>
              <h2>Founding Household</h2>
              <p>
                Review a one-time invitation and finite sponsored access terms. No payment or
                automatic message is sent.
              </p>
              <Link href="/member/founding-household">Open Founding Household review</Link>
            </section>
          ) : null}
          {process.env.NODE_ENV === 'production' && canManageSponsoredAccess ? (
            <section className="card">
              <h2>Sponsored access</h2>
              <p>Review historical sponsored access or withdraw its service consent.</p>
              <Link href="/member/founding-household">Manage sponsored access</Link>
            </section>
          ) : null}
          <section className="card" data-testid="local-access-summary">
            <span className="dev-pill">
              {process.env.NODE_ENV === 'production'
                ? 'Current access and plan'
                : 'Local access hypothesis'}
            </span>
            <h2>{selectedEntitlements?.commerce.primary?.plan.displayName ?? 'Access details'}</h2>
            <p>
              The features you can use depend on this household, your role, and each person&apos;s
              consent. Billing controls are shown only to the person who manages billing.
            </p>
            {!selectedScope?.isBillingManager ? (
              <p className="meta">
                Only the person who manages billing can see household plan totals. You can still use
                every feature your role and permissions allow.
              </p>
            ) : selectedEntitlements ? (
              <>
                <p className="meta">
                  Membership access:{' '}
                  {selectedEntitlements.commerce.accessState === 'effective'
                    ? 'available'
                    : 'not currently active'}
                </p>
                <ul className="plain-list">
                  <li>{allowanceSummary('Protected adults', protectedAllowance)}</li>
                  <li>{allowanceSummary('Trusted Circle participants', trustedAllowance)}</li>
                </ul>
              </>
            ) : entitlementsError ? (
              <p className="meta">
                Plan and allowance details are unavailable. The selected household permissions shown
                in the actions above still apply.
              </p>
            ) : (
              <p className="meta">Loading access details...</p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

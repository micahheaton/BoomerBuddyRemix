'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type {
  CheckListResponse,
  CheckResult,
  CheckShareClosureReason,
  CheckShareLifecycle,
  CheckShareListResponse,
} from '@boomerbuddy/contracts';
import { useHousehold } from '../../../components/household-context';
import { apiRequest, readableError } from '../../../lib/api';
import {
  householdBoundValue,
  householdRequestIsCurrent,
  type HouseholdBoundValue,
  type HouseholdRequestIdentity,
} from '../../../lib/household-request';

const riskText: Record<CheckResult['risk'], string> = {
  caution: 'Use caution',
  high_concern: 'High concern',
  unknown: 'Unknown risk',
};

const sufficiencyText: Record<CheckResult['evidenceSufficiency'], string> = {
  limited: 'Limited information',
  moderate: 'Some information',
  strong: 'More information',
};

export default function HistoryPage() {
  const { selectedHouseholdId, selectedHouseholdName, selectedScope } = useHousehold();
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedHouseholdId, setLoadedHouseholdId] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [errorState, setErrorState] = useState<HouseholdBoundValue<string>>();
  const [confirming, setConfirming] = useState<string>();
  const [expanded, setExpanded] = useState<string>();
  const [sharesByCheck, setSharesByCheck] = useState<Record<string, CheckShareLifecycle[]>>({});
  const [shareLoadState, setShareLoadState] = useState<
    Record<string, { readonly status: 'loading' | 'ready' | 'error'; readonly message?: string }>
  >({});
  const [loadingMoreState, setLoadingMoreState] = useState<HouseholdBoundValue<boolean>>();
  const [shareBusyState, setShareBusyState] = useState<HouseholdBoundValue<string>>();
  const [announcementState, setAnnouncementState] = useState<HouseholdBoundValue<string>>();
  const [reloadVersion, setReloadVersion] = useState(0);
  const selectedHouseholdIdRef = useRef(selectedHouseholdId);
  const householdGenerationRef = useRef(0);
  const continuationRequestIdRef = useRef(0);
  const continuationControllerRef = useRef<AbortController | undefined>(undefined);
  const canReadHistory =
    selectedScope?.capabilities.includes('history:read') === true &&
    (selectedScope.isProtectedMember ||
      selectedScope.trustedCircleGrants.some((grant) =>
        grant.permissions.includes('view_shared_checks'),
      ));

  useEffect(() => {
    selectedHouseholdIdRef.current = selectedHouseholdId;
  }, [selectedHouseholdId]);

  const error = householdBoundValue(errorState, selectedHouseholdId) ?? '';
  const loadingMore = householdBoundValue(loadingMoreState, selectedHouseholdId) ?? false;
  const shareBusy = householdBoundValue(shareBusyState, selectedHouseholdId) ?? '';
  const announcement = householdBoundValue(announcementState, selectedHouseholdId) ?? '';

  function currentIdentity(): HouseholdRequestIdentity {
    return {
      householdId: selectedHouseholdIdRef.current,
      generation: householdGenerationRef.current,
    };
  }

  useEffect(() => {
    const householdId = selectedHouseholdId;
    const generation = ++householdGenerationRef.current;
    continuationRequestIdRef.current += 1;
    continuationControllerRef.current?.abort();
    continuationControllerRef.current = undefined;
    if (!canReadHistory || !householdId) return;
    const controller = new AbortController();
    const requestIdentity = { householdId, generation };
    const requestIsCurrent = (): boolean =>
      !controller.signal.aborted && householdRequestIsCurrent(requestIdentity, currentIdentity());
    apiRequest<CheckListResponse>('/v1/checks?limit=50&offset=0', {
      headers: { 'X-BB-Household-Id': householdId },
      signal: controller.signal,
    })
      .then((response) => {
        if (!requestIsCurrent()) return;
        setChecks(response.checks);
        setHasMore(response.page.hasMore);
        setNextOffset(response.page.offset + response.checks.length);
        setTotal(response.total);
        setSharesByCheck({});
        setShareLoadState({});
        setExpanded(undefined);
        setConfirming(undefined);
        setLoadedHouseholdId(householdId);
        setErrorState(undefined);
      })
      .catch((caught) => {
        if (!requestIsCurrent()) return;
        setChecks([]);
        setHasMore(false);
        setLoadedHouseholdId(householdId);
        setErrorState({ householdId, value: readableError(caught) });
      })
      .finally(() => {
        if (requestIsCurrent()) setLoading(false);
      });
    return () => {
      controller.abort();
      continuationRequestIdRef.current += 1;
      continuationControllerRef.current?.abort();
      continuationControllerRef.current = undefined;
    };
  }, [canReadHistory, reloadVersion, selectedHouseholdId]);

  async function loadMore() {
    if (loadingMore || !hasMore || loadedHouseholdId !== selectedHouseholdId) return;
    const attempt = {
      householdId: selectedHouseholdId,
      generation: householdGenerationRef.current,
      requestId: ++continuationRequestIdRef.current,
      offset: nextOffset,
    };
    continuationControllerRef.current?.abort();
    const controller = new AbortController();
    continuationControllerRef.current = controller;
    const attemptIsCurrent = (): boolean =>
      !controller.signal.aborted &&
      continuationControllerRef.current === controller &&
      continuationRequestIdRef.current === attempt.requestId &&
      householdRequestIsCurrent(attempt, currentIdentity());
    setLoadingMoreState({ householdId: attempt.householdId, value: true });
    setErrorState(undefined);
    try {
      const response = await apiRequest<CheckListResponse>(
        `/v1/checks?limit=50&offset=${attempt.offset}`,
        {
          headers: { 'X-BB-Household-Id': attempt.householdId },
          signal: controller.signal,
        },
      );
      if (!attemptIsCurrent()) return;
      if (response.page.offset !== attempt.offset) {
        throw new Error('History changed while loading. Please try again.');
      }
      setChecks((current) => {
        const byId = new Map(current.map((check) => [check.id, check]));
        for (const check of response.checks) byId.set(check.id, check);
        return [...byId.values()];
      });
      setHasMore(response.page.hasMore);
      setNextOffset(response.page.offset + response.checks.length);
      setTotal(response.total);
      setAnnouncementState({
        householdId: attempt.householdId,
        value: `Loaded ${response.checks.length} more check records.`,
      });
    } catch (caught) {
      if (attemptIsCurrent()) {
        setErrorState({ householdId: attempt.householdId, value: readableError(caught) });
      }
    } finally {
      if (attemptIsCurrent()) {
        continuationControllerRef.current = undefined;
        setLoadingMoreState(undefined);
      }
    }
  }

  async function remove(id: string) {
    const attempt = currentIdentity();
    setErrorState(undefined);
    try {
      await apiRequest(`/v1/checks/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'X-BB-Household-Id': attempt.householdId },
      });
      if (!householdRequestIsCurrent(attempt, currentIdentity())) return;
      setChecks((current) => current.filter((check) => check.id !== id));
      setTotal((current) => Math.max(0, current - 1));
      setNextOffset((current) => Math.max(0, current - 1));
      setConfirming(undefined);
      setExpanded((current) => (current === id ? undefined : current));
      setAnnouncementState({ householdId: attempt.householdId, value: 'Check record deleted.' });
    } catch (caught) {
      if (householdRequestIsCurrent(attempt, currentIdentity())) {
        setErrorState({ householdId: attempt.householdId, value: readableError(caught) });
      }
    }
  }

  async function loadShareLifecycle(checkId: string) {
    const attempt = currentIdentity();
    setShareLoadState((current) => ({
      ...current,
      [checkId]: { status: 'loading' },
    }));
    try {
      const response = await apiRequest<CheckShareListResponse>(
        `/v1/checks/${encodeURIComponent(checkId)}/shares`,
        { headers: { 'X-BB-Household-Id': attempt.householdId } },
      );
      if (!householdRequestIsCurrent(attempt, currentIdentity())) return;
      setSharesByCheck((current) => ({ ...current, [checkId]: response.shares }));
      setShareLoadState((current) => ({ ...current, [checkId]: { status: 'ready' } }));
    } catch (caught) {
      if (!householdRequestIsCurrent(attempt, currentIdentity())) return;
      setShareLoadState((current) => ({
        ...current,
        [checkId]: { status: 'error', message: readableError(caught) },
      }));
    }
  }

  async function toggleDetails(checkId: string) {
    const opening = expanded !== checkId;
    setExpanded(opening ? checkId : undefined);
    if (opening) await loadShareLifecycle(checkId);
  }

  async function acknowledgeShare(checkId: string) {
    const attempt = currentIdentity();
    setShareBusyState({ householdId: attempt.householdId, value: `acknowledge:${checkId}` });
    setErrorState(undefined);
    try {
      const response = await apiRequest<{ share: CheckShareLifecycle }>(
        `/v1/checks/${encodeURIComponent(checkId)}/share-acknowledgement`,
        {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'X-BB-Household-Id': attempt.householdId },
        },
      );
      if (!householdRequestIsCurrent(attempt, currentIdentity())) return;
      setSharesByCheck((current) => ({ ...current, [checkId]: [response.share] }));
      setShareLoadState((current) => ({ ...current, [checkId]: { status: 'ready' } }));
      setAnnouncementState({
        householdId: attempt.householdId,
        value:
          'You acknowledged the redacted result. No notification or submitted content was sent.',
      });
    } catch (caught) {
      if (householdRequestIsCurrent(attempt, currentIdentity())) {
        setErrorState({ householdId: attempt.householdId, value: readableError(caught) });
      }
    } finally {
      if (householdRequestIsCurrent(attempt, currentIdentity())) setShareBusyState(undefined);
    }
  }

  async function closeShare(
    checkId: string,
    sharedWithPersonId: string,
    resolution: CheckShareClosureReason,
  ) {
    const operation = `close:${checkId}:${sharedWithPersonId}`;
    const attempt = currentIdentity();
    setShareBusyState({ householdId: attempt.householdId, value: operation });
    setErrorState(undefined);
    try {
      const response = await apiRequest<{ share: CheckShareLifecycle }>(
        `/v1/checks/${encodeURIComponent(checkId)}/shares/${encodeURIComponent(sharedWithPersonId)}/closure`,
        {
          method: 'POST',
          body: JSON.stringify({ resolution }),
          headers: { 'X-BB-Household-Id': attempt.householdId },
        },
      );
      if (!householdRequestIsCurrent(attempt, currentIdentity())) return;
      setSharesByCheck((current) => ({
        ...current,
        [checkId]: (current[checkId] ?? []).map((share) =>
          share.sharedWithPersonId === sharedWithPersonId ? response.share : share,
        ),
      }));
      setAnnouncementState({
        householdId: attempt.householdId,
        value: 'The help request was closed. No notification was sent.',
      });
    } catch (caught) {
      if (householdRequestIsCurrent(attempt, currentIdentity())) {
        setErrorState({ householdId: attempt.householdId, value: readableError(caught) });
      }
    } finally {
      if (householdRequestIsCurrent(attempt, currentIdentity())) setShareBusyState(undefined);
    }
  }

  if (!canReadHistory) {
    return (
      <main id="main-content" className="member-shell member-main">
        <span className="eyebrow">History</span>
        <h1 className="member-heading">History unavailable in this household</h1>
        <section className="notice notice-warning">
          <h2>You do not have access to this history</h2>
          <p>
            An enrolled protected adult can see their own history. A Trusted Circle member can see
            only the results that person deliberately shared with them.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main id="main-content" className="member-shell member-main">
      <span className="eyebrow">History</span>
      <h1 className="member-heading">Your check records</h1>
      <p className="lede">
        History never displays the message text or website address you submitted. BoomerBuddy keeps
        a protected, minimized copy for up to 30 days unless you delete it sooner. After deletion,
        only limited records needed for security and service operation remain.
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading || loadedHouseholdId !== selectedHouseholdId ? (
        <p role="status">Loading history…</p>
      ) : error && checks.length === 0 ? (
        <section className="notice notice-warning" aria-labelledby="history-load-error-heading">
          <h2 id="history-load-error-heading">History could not be loaded</h2>
          <p>Do not rely on an empty list while this error is present.</p>
          <button
            className="button-secondary"
            type="button"
            onClick={() => {
              setErrorState(undefined);
              setLoading(true);
              setReloadVersion((current) => current + 1);
            }}
          >
            Try loading history again
          </button>
        </section>
      ) : checks.length === 0 ? (
        <div className="empty">
          <h2>No check records yet</h2>
          <p>Start with a message or website address that made you pause.</p>
          {selectedScope?.isProtectedMember ? (
            <Link className="button button-primary" href="/member/check">
              Start a check
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          <ul className="history-list" data-testid="check-history">
            {checks.map((check) => (
              <li
                className={`history-row risk risk-${check.risk}`}
                key={check.id}
                data-check-id={check.id}
              >
                <div>
                  <strong>{check.kind === 'text' ? 'Message text' : 'Website address'}</strong>
                  <span className="data-pill">
                    {check.access.kind === 'owned' ? 'Yours' : 'Shared with you'}
                  </span>
                  <p>
                    {riskText[check.risk]} · {sufficiencyText[check.evidenceSufficiency]}
                  </p>
                  <p className="meta">Checked {new Date(check.createdAt).toLocaleString()}</p>
                </div>
                <div className="history-actions">
                  <button
                    className="button-secondary"
                    type="button"
                    aria-expanded={expanded === check.id}
                    aria-controls={`history-detail-${check.id}`}
                    onClick={() => void toggleDetails(check.id)}
                  >
                    {expanded === check.id ? 'Hide result details' : 'View result details'}
                  </button>
                  {check.access.canDelete && confirming === check.id ? (
                    <div>
                      <p>
                        <strong>Delete this minimized record?</strong>
                      </p>
                      <div className="button-row">
                        <button
                          className="button-danger"
                          type="button"
                          onClick={() => void remove(check.id)}
                        >
                          Yes, delete
                        </button>
                        <button
                          className="button-secondary"
                          type="button"
                          onClick={() => setConfirming(undefined)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : check.access.canDelete ? (
                    <button
                      className="button-danger"
                      type="button"
                      onClick={() => setConfirming(check.id)}
                    >
                      Delete record
                    </button>
                  ) : (
                    <p className="meta">
                      Only the person who created this Check can delete it. To stop seeing shared
                      results, end the Trusted Circle connection in{' '}
                      <Link href="/member/family">Family</Link>.
                    </p>
                  )}
                </div>
                {expanded === check.id ? (
                  <section
                    className="history-detail"
                    id={`history-detail-${check.id}`}
                    aria-label="Redacted check result details"
                  >
                    <h2>Redacted result details</h2>
                    <p>{check.summary}</p>
                    <dl className="definition-grid">
                      <dt>Household</dt>
                      <dd>{selectedHouseholdName}</dd>
                      <dt>How much information was available</dt>
                      <dd>
                        {sufficiencyText[check.evidenceSufficiency]}. This describes what the check
                        could examine, not the chance that something is safe or harmful.
                      </dd>
                      <dt>Important limit</dt>
                      <dd>This result can be wrong and is not proof or certainty.</dd>
                      <dt>Retention</dt>
                      <dd>
                        Scheduled for deletion{' '}
                        {new Date(check.retention.deleteAfter).toLocaleString()} unless you delete
                        it sooner.
                      </dd>
                    </dl>
                    <h3>What the check noticed and its limits</h3>
                    {check.evidence.length ? (
                      <ul className="plain-list">
                        {check.evidence.map((item, index) => (
                          <li key={`${item.label}-${index}`}>
                            <strong>{item.label}:</strong> {item.observation}
                            {item.limitations ? ` Limit: ${item.limitations}` : ''}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No supporting observations were produced. Treat the risk as unknown.</p>
                    )}
                    <h3>Safer next actions</h3>
                    <ol className="plain-list">
                      {[...check.actions]
                        .sort((a, b) => a.priority - b.priority)
                        .map((action) => (
                          <li key={action.key}>
                            <strong>{action.title}</strong> - {action.detail}
                            {action.officialChannelOnly
                              ? ' Use an independently verified official channel.'
                              : ''}
                          </li>
                        ))}
                    </ol>
                    <p className="help">
                      The submitted message or URL is never included in this detail view.
                    </p>
                    <section className="card" aria-label="Trusted Circle help status">
                      <h3>Trusted Circle help status</h3>
                      {!shareLoadState[check.id] ||
                      shareLoadState[check.id]?.status === 'loading' ? (
                        <p role="status">Loading shared-result follow-up...</p>
                      ) : shareLoadState[check.id]?.status === 'error' ? (
                        <div className="notice notice-warning">
                          <p className="error" role="alert">
                            {shareLoadState[check.id]?.message}
                          </p>
                          <button
                            className="button-secondary"
                            type="button"
                            onClick={() => void loadShareLifecycle(check.id)}
                          >
                            Try loading help status again
                          </button>
                        </div>
                      ) : (sharesByCheck[check.id] ?? []).length === 0 ? (
                        <p className="meta">
                          {check.access.kind === 'owned'
                            ? 'This result has not been shared for help.'
                            : 'No active shared-result follow-up is available.'}
                        </p>
                      ) : (
                        <ul className="plain-list">
                          {(sharesByCheck[check.id] ?? []).map((share) => {
                            const closeOperation = `close:${check.id}:${share.sharedWithPersonId}`;
                            return (
                              <li key={share.sharedWithPersonId}>
                                <strong>{share.sharedWithDisplayName}</strong>
                                <p className="meta">
                                  {share.state === 'shared'
                                    ? 'Waiting for acknowledgement'
                                    : share.state === 'acknowledged'
                                      ? `Acknowledged ${new Date(share.acknowledgedAt ?? share.sharedAt).toLocaleString()}`
                                      : `Closed ${new Date(share.closedAt ?? share.sharedAt).toLocaleString()}`}
                                </p>
                                {check.access.kind === 'shared' && share.state === 'shared' ? (
                                  <button
                                    className="button-primary"
                                    type="button"
                                    disabled={shareBusy === `acknowledge:${check.id}`}
                                    onClick={() => void acknowledgeShare(check.id)}
                                  >
                                    {shareBusy === `acknowledge:${check.id}`
                                      ? 'Acknowledging…'
                                      : 'I saw this redacted result'}
                                  </button>
                                ) : null}
                                {check.access.kind === 'owned' && share.state === 'acknowledged' ? (
                                  <div className="form-stack">
                                    <p>
                                      Close this request only after you and your trusted person have
                                      finished the next step. Closing does not claim that fraud was
                                      prevented.
                                    </p>
                                    <div className="button-row">
                                      <button
                                        className="button-primary"
                                        type="button"
                                        disabled={shareBusy === closeOperation}
                                        onClick={() =>
                                          void closeShare(
                                            check.id,
                                            share.sharedWithPersonId,
                                            'safer_action_completed',
                                          )
                                        }
                                      >
                                        Safer action completed
                                      </button>
                                      <button
                                        className="button-secondary"
                                        type="button"
                                        disabled={shareBusy === closeOperation}
                                        onClick={() =>
                                          void closeShare(
                                            check.id,
                                            share.sharedWithPersonId,
                                            'no_longer_needs_help',
                                          )
                                        }
                                      >
                                        Help no longer needed
                                      </button>
                                    </div>
                                  </div>
                                ) : null}
                                {share.state === 'closed' ? (
                                  <p>
                                    {share.closureReason === 'safer_action_completed'
                                      ? 'The protected person recorded that a safer action was completed.'
                                      : 'The protected person recorded that help was no longer needed.'}
                                  </p>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      <p className="help">
                        Acknowledging and closing are in-app status updates only. BoomerBuddy sends
                        no email, text, or push notification.
                      </p>
                    </section>
                  </section>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="meta">
            Showing {checks.length} of {total} available check records.
          </p>
          {hasMore ? (
            <button
              className="button-secondary"
              type="button"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? 'Loading more…' : 'Load more history'}
            </button>
          ) : null}
        </>
      )}
    </main>
  );
}

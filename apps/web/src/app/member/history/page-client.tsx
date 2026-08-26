'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CheckListResponse, CheckResult } from '@boomerbuddy/contracts';
import { useHousehold } from '../../../components/household-context';
import { apiRequest, readableError } from '../../../lib/api';

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
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadedHouseholdId, setLoadedHouseholdId] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<string>();
  const [expanded, setExpanded] = useState<string>();
  const [announcement, setAnnouncement] = useState('');
  const canReadHistory =
    selectedScope?.capabilities.includes('history:read') === true &&
    (selectedScope.isProtectedMember ||
      selectedScope.trustedCircleGrants.some((grant) =>
        grant.permissions.includes('view_shared_checks'),
      ));

  useEffect(() => {
    if (!canReadHistory) return;
    let active = true;
    apiRequest<CheckListResponse>('/v1/checks?limit=50&offset=0')
      .then((response) => {
        if (!active) return;
        setChecks(response.checks);
        setHasMore(response.page.hasMore);
        setNextOffset(response.page.offset + response.checks.length);
        setTotal(response.total);
        setLoadedHouseholdId(selectedHouseholdId);
        setError('');
      })
      .catch((caught) => {
        if (!active) return;
        setChecks([]);
        setHasMore(false);
        setLoadedHouseholdId(selectedHouseholdId);
        setError(readableError(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canReadHistory, selectedHouseholdId]);

  async function loadMore() {
    if (loadingMore || !hasMore || loadedHouseholdId !== selectedHouseholdId) return;
    setLoadingMore(true);
    setError('');
    try {
      const response = await apiRequest<CheckListResponse>(
        `/v1/checks?limit=50&offset=${nextOffset}`,
      );
      setChecks((current) => {
        const byId = new Map(current.map((check) => [check.id, check]));
        for (const check of response.checks) byId.set(check.id, check);
        return [...byId.values()];
      });
      setHasMore(response.page.hasMore);
      setNextOffset(response.page.offset + response.checks.length);
      setTotal(response.total);
      setAnnouncement(`Loaded ${response.checks.length} more check records.`);
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setLoadingMore(false);
    }
  }

  async function remove(id: string) {
    setError('');
    try {
      await apiRequest(`/v1/checks/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setChecks((current) => current.filter((check) => check.id !== id));
      setTotal((current) => Math.max(0, current - 1));
      setNextOffset((current) => Math.max(0, current - 1));
      setConfirming(undefined);
      setExpanded((current) => (current === id ? undefined : current));
      setAnnouncement('Check record deleted.');
    } catch (caught) {
      setError(readableError(caught));
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
                    onClick={() =>
                      setExpanded((current) => (current === check.id ? undefined : check.id))
                    }
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

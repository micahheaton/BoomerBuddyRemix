'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { EditorialBoardResponse } from '../../../../packages/contracts/src/editorial-intelligence';
import { HqApiError, hqRequest, readableError } from '../lib/api';

function label(value: string): string {
  return value.replaceAll('_', ' ');
}

export function EditorialIntelligenceBoard() {
  const [data, setData] = useState<EditorialBoardResponse>();
  const [error, setError] = useState('');

  const refresh = useCallback(
    () => hqRequest<EditorialBoardResponse>('/v1/hq/editorial', { cache: 'no-store' }),
    [],
  );

  useEffect(() => {
    let active = true;
    void refresh()
      .then((response) => {
        if (!active) return;
        setData(response);
        setError('');
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof HqApiError && (caught.status === 401 || caught.status === 403)) {
          setData(undefined);
        }
        setError(readableError(caught));
      });
    return () => {
      active = false;
    };
  }, [refresh]);

  const sourceHealth = useMemo(() => {
    const counts = new Map<string, number>();
    for (const source of data?.sources ?? []) {
      counts.set(source.state, (counts.get(source.state) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [data]);

  if (error) {
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  }
  if (!data) return <p role="status">Loading role-scoped editorial metadata…</p>;

  return (
    <>
      <div className="control-boundary" role="note">
        <strong>This board is local metadata, not current public-source evidence.</strong> It has no
        fetcher, generator, provider, publisher, sender, destination, or public route. Queue rows do
        not include source locators, artifact text, claim text, draft text, or ciphertext.
      </div>

      <section className="metric-grid metric-grid-five section" aria-label="Editorial queue totals">
        <article className="hq-card metric-card">
          <span>Source versions</span>
          <strong className="metric-value">{data.sources.length}</strong>
          <small>Owner-only local health metadata</small>
        </article>
        <article className="hq-card metric-card">
          <span>Review assignments</span>
          <strong className="metric-value">{data.content.length}</strong>
          <small>Owner-global or exact assignee</small>
        </article>
        <article className="hq-card metric-card">
          <span>Calendar items</span>
          <strong className="metric-value">{data.calendar.length}</strong>
          <small>Internal review plans only</small>
        </article>
        <article className="hq-card metric-card">
          <span>Corrections</span>
          <strong className="metric-value">{data.corrections.length}</strong>
          <small>Immutable lineage records</small>
        </article>
        <article className="hq-card metric-card">
          <span>Withdrawn preferences</span>
          <strong className="metric-value">{data.preferences.withdrawnLocalFixtures}</strong>
          <small>Local fixtures; delivery disabled</small>
        </article>
      </section>

      <section className="section table-wrap">
        <table>
          <caption>Source health — no locators or source content</caption>
          <thead>
            <tr>
              <th>Source</th>
              <th>Class</th>
              <th>Local state</th>
              <th>Review due</th>
            </tr>
          </thead>
          <tbody>
            {data.sources.map((source) => (
              <tr key={source.sourceVersionId}>
                <td>
                  {source.sourceKey} v{source.version}
                  <div className="source">{source.sourceVersionId}</div>
                </td>
                <td>{label(source.sourceClass)}</td>
                <td>{label(source.state)}</td>
                <td>{new Date(source.reviewDueAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.sources.length === 0 ? (
          <p className="hq-card">No source-health metadata is visible to this HQ identity.</p>
        ) : null}
      </section>

      <section className="section table-wrap">
        <table>
          <caption>Role-scoped editorial review queue — no draft content</caption>
          <thead>
            <tr>
              <th>Content version</th>
              <th>Product</th>
              <th>State</th>
              <th>Assignment</th>
              <th>Evidence flags</th>
              <th>Expires</th>
            </tr>
          </thead>
          <tbody>
            {data.content.map((item, index) => (
              <tr key={`${item.contentVersionId}:${item.assignedRole ?? 'owner'}:${index}`}>
                <td>
                  {item.contentKey} v{item.version}
                  <div className="source">{item.contentVersionId}</div>
                </td>
                <td>{label(item.product)}</td>
                <td>{label(item.state)}</td>
                <td>{item.assignedRole ? label(item.assignedRole) : 'Owner metadata only'}</td>
                <td>
                  {item.unsupportedStatistics
                    ? 'Unsupported statistics blocked'
                    : 'Statistics clear'}
                  <div className="source">
                    {item.unverifiedUrgency ? 'Urgency unverified' : 'Urgency clear'}
                  </div>
                </td>
                <td>{new Date(item.expiresAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.content.length === 0 ? (
          <p className="hq-card">No editorial assignments are visible to this HQ identity.</p>
        ) : null}
      </section>

      <section className="metric-grid section" aria-label="Source health state totals">
        {sourceHealth.map(([state, count]) => (
          <article className="hq-card metric-card" key={state}>
            <span>{label(state)}</span>
            <strong className="metric-value">{count}</strong>
            <small>Local simulation</small>
          </article>
        ))}
      </section>

      <section className="section table-wrap">
        <table>
          <caption>Internal calendar and correction queue</caption>
          <thead>
            <tr>
              <th>Kind</th>
              <th>Content</th>
              <th>Status</th>
              <th>Time or lineage</th>
            </tr>
          </thead>
          <tbody>
            {data.calendar.map((item) => (
              <tr key={item.calendarEventId}>
                <td>Internal review plan</td>
                <td>{item.contentVersionId}</td>
                <td>{label(item.state)}</td>
                <td>{new Date(item.plannedFor).toLocaleString()}</td>
              </tr>
            ))}
            {data.corrections.map((item) => (
              <tr key={item.correctionId}>
                <td>{label(item.disposition)}</td>
                <td>{item.originalContentVersionId}</td>
                <td>{label(item.reasonCode)}</td>
                <td>{item.replacementContentVersionId ?? 'Retraction without replacement'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="source section">
        Generated {new Date(data.generatedAt).toLocaleString()} · {data.evidenceTier} · external
        delivery {data.preferences.externalDeliveryEnabled ? 'enabled' : 'disabled'}
      </p>
    </>
  );
}

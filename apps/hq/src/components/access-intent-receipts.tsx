'use client';

import { useEffect, useState } from 'react';
import type { HqAccessIntentResponse } from '@boomerbuddy/contracts';
import { apiPaths } from '@boomerbuddy/contracts';
import { hqRequest, readableError } from '../lib/api';

const lifecycleLabels: Record<HqAccessIntentResponse['intents'][number]['lifecycle'], string> = {
  intent_created: 'Receipt active',
  expired: 'Receipt expired',
};

function displayLabel(value: string): string {
  return value.replaceAll('_', ' ');
}

export function AccessIntentReceipts() {
  const [data, setData] = useState<HqAccessIntentResponse>();
  const [error, setError] = useState('');

  useEffect(() => {
    hqRequest<HqAccessIntentResponse>(apiPaths.hqAccessIntents)
      .then(setData)
      .catch((caught) => setError(readableError(caught)));
  }, []);

  if (error) {
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  }
  if (!data) return <p role="status">Loading content-free intent receipts…</p>;

  const activeCount = data.intents.filter((intent) => intent.lifecycle === 'intent_created').length;
  const expiredCount = data.intents.length - activeCount;
  const attributionCounts = Array.from(
    data.intents.reduce((counts, intent) => {
      const key = `${intent.attribution.source}:${intent.attribution.campaign}`;
      const prior = counts.get(key);
      counts.set(key, {
        source: intent.attribution.source,
        campaign: intent.attribution.campaign,
        count: (prior?.count ?? 0) + 1,
      });
      return counts;
    }, new Map<string, { source: string; campaign: string; count: number }>()),
  )
    .map(([, count]) => count)
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.source.localeCompare(right.source) ||
        left.campaign.localeCompare(right.campaign),
    );

  return (
    <>
      <section className="notice" aria-labelledby="intent-receipt-boundary-heading">
        <h2 id="intent-receipt-boundary-heading">Intent receipts, not leads</h2>
        <p>
          A receipt proves only that the pricing page recorded an access intent. It does not prove
          that an email was sent or received, that a person was contacted or qualified, or that an
          account, subscription, or payment exists.
        </p>
        <p>
          This owner-only view contains a receipt code, recognized source and campaign labels,
          lifecycle, and creation and expiry times. It contains no name, email address, phone
          number, free-text message, household, or payment data.
        </p>
      </section>

      <section className="metric-grid section" aria-label="Shown intent receipt totals">
        <article className="hq-card">
          <span className="seed-label">Shown projection</span>
          <h2>Receipts shown</h2>
          <p className="metric-value">{data.intents.length}</p>
        </article>
        <article className="hq-card">
          <span className="seed-label">Shown projection</span>
          <h2>Active receipts</h2>
          <p className="metric-value">{activeCount}</p>
        </article>
        <article className="hq-card">
          <span className="seed-label">Shown projection</span>
          <h2>Expired receipts</h2>
          <p className="metric-value">{expiredCount}</p>
        </article>
      </section>

      <section className="section table-wrap" aria-labelledby="intent-attribution-heading">
        <h2 id="intent-attribution-heading">Attribution totals in this projection</h2>
        <table>
          <caption>Content-free receipt counts by recognized source and campaign</caption>
          <thead>
            <tr>
              <th>Source</th>
              <th>Campaign</th>
              <th>Receipts</th>
            </tr>
          </thead>
          <tbody>
            {attributionCounts.map((attribution) => (
              <tr key={`${attribution.source}:${attribution.campaign}`}>
                <td>{displayLabel(attribution.source)}</td>
                <td>{displayLabel(attribution.campaign)}</td>
                <td>{attribution.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {attributionCounts.length === 0 ? <p>No intent receipts are available.</p> : null}
      </section>

      <section className="section table-wrap" aria-labelledby="intent-receipt-list-heading">
        <h2 id="intent-receipt-list-heading">Content-free intent receipt list</h2>
        <table>
          <caption>Owner-only receipt metadata, newest first</caption>
          <thead>
            <tr>
              <th>Receipt</th>
              <th>Source</th>
              <th>Campaign</th>
              <th>Lifecycle</th>
              <th>Created</th>
              <th>Expires</th>
            </tr>
          </thead>
          <tbody>
            {data.intents.map((intent) => (
              <tr key={intent.receiptCode}>
                <td>
                  <code>{intent.receiptCode}</code>
                </td>
                <td>{displayLabel(intent.attribution.source)}</td>
                <td>{displayLabel(intent.attribution.campaign)}</td>
                <td>{lifecycleLabels[intent.lifecycle]}</td>
                <td>{new Date(intent.createdAt).toLocaleString()}</td>
                <td>{new Date(intent.expiresAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.intents.length === 0 ? <p>No intent receipts are available.</p> : null}
        {data.truncated ? (
          <p className="notice">
            This projection is limited to the first 100 receipts. The totals above describe only the
            records shown here.
          </p>
        ) : null}
      </section>
    </>
  );
}

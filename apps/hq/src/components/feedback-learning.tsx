'use client';

import type {
  AssignedFeedbackContentResponse,
  FeedbackReviewClaimResponse,
  HqFeedbackQueueResponse,
} from '@boomerbuddy/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { HqApiError, hqRequest, readableError } from '../lib/api';

function label(value: string): string {
  return value.replaceAll('_', ' ');
}

export function FeedbackLearning() {
  const [data, setData] = useState<HqFeedbackQueueResponse>();
  const [error, setError] = useState('');
  const [busyFeedbackId, setBusyFeedbackId] = useState<string>();
  const [openedContent, setOpenedContent] = useState<
    Readonly<Record<string, AssignedFeedbackContentResponse>>
  >({});

  const clearForAuthorizationLoss = useCallback((caught: unknown) => {
    if (caught instanceof HqApiError && (caught.status === 401 || caught.status === 403)) {
      setData(undefined);
      setOpenedContent({});
    }
    setError(readableError(caught));
  }, []);

  const fetchQueue = useCallback(
    () => hqRequest<HqFeedbackQueueResponse>('/v1/hq/feedback', { cache: 'no-store' }),
    [],
  );

  const acceptFreshQueue = useCallback((response: HqFeedbackQueueResponse) => {
    const stillReadable = new Set(
      response.feedback.filter((item) => item.contentReadAuthorized).map((item) => item.id),
    );
    setOpenedContent((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([feedbackId]) => stillReadable.has(feedbackId)),
      ),
    );
    setData(response);
  }, []);

  useEffect(() => {
    let active = true;
    void fetchQueue()
      .then((response) => {
        if (active) acceptFreshQueue(response);
      })
      .catch((caught: unknown) => {
        if (active) clearForAuthorizationLoss(caught);
      });
    return () => {
      active = false;
    };
  }, [acceptFreshQueue, clearForAuthorizationLoss, fetchQueue]);

  async function claim(feedbackId: string): Promise<void> {
    setBusyFeedbackId(feedbackId);
    setError('');
    try {
      await hqRequest<FeedbackReviewClaimResponse>(`/v1/hq/feedback/${feedbackId}/claim`, {
        cache: 'no-store',
        method: 'POST',
      });
      acceptFreshQueue(await fetchQueue());
    } catch (caught) {
      clearForAuthorizationLoss(caught);
    } finally {
      setBusyFeedbackId(undefined);
    }
  }

  async function openMinimizedText(feedbackId: string): Promise<void> {
    setBusyFeedbackId(feedbackId);
    setError('');
    try {
      const content = await hqRequest<AssignedFeedbackContentResponse>(
        `/v1/hq/feedback/${feedbackId}/content`,
        { cache: 'no-store' },
      );
      setOpenedContent((current) => ({ ...current, [feedbackId]: content }));
    } catch (caught) {
      setOpenedContent((current) => {
        const next = { ...current };
        delete next[feedbackId];
        return next;
      });
      clearForAuthorizationLoss(caught);
    } finally {
      setBusyFeedbackId(undefined);
    }
  }

  const queues = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of data?.feedback ?? []) {
      counts.set(item.queue, (counts.get(item.queue) ?? 0) + 1);
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
  if (!data) return <p role="status">Loading role-scoped feedback metadata…</p>;

  return (
    <>
      <div className="control-boundary" role="note">
        <strong>The queue contains no submitted content.</strong> This role-scoped view exposes
        structured metadata through the active founder-owner or exact-current-assignee projection.
        Minimized text can open only after an exact assignment and deterministic redaction
        verification. It cannot display unsafe/quarantined text, ciphertext, destinations, network
        keys, media, transcripts, or provider output, and it cannot contact a customer.
      </div>
      <section className="metric-grid section" aria-label="Assigned feedback queue totals">
        {queues.map(([queue, count]) => (
          <article className="metric-card" key={queue}>
            <span>{label(queue)}</span>
            <strong>{count}</strong>
            <small>Runtime-derived evidence</small>
          </article>
        ))}
        {queues.length === 0 ? <p>No feedback metadata is visible to this HQ identity.</p> : null}
      </section>
      <section className="section table-wrap">
        <table>
          <caption>Role-scoped feedback metadata — no submitted content</caption>
          <thead>
            <tr>
              <th>Received</th>
              <th>Feedback</th>
              <th>Source</th>
              <th>Routing</th>
              <th>Consent</th>
              <th>Outcome boundary</th>
            </tr>
          </thead>
          <tbody>
            {data.feedback.map((item) => (
              <tr key={item.id}>
                <td>{new Date(item.createdAt).toLocaleString()}</td>
                <td>
                  {item.id}
                  <div className="source">
                    {label(item.identityMode)} · {label(item.feedbackType)}
                  </div>
                </td>
                <td>
                  {label(item.sourceSurface)}
                  <div className="source">{item.householdId ?? 'No household association'}</div>
                </td>
                <td>
                  {label(item.queue)} · {label(item.routingState)} · {label(item.status)}
                  <div className="source">
                    {label(item.classification)} · severity {label(item.severity)}
                  </div>
                </td>
                <td>
                  Follow-up: {item.followUpConsented ? 'granted' : 'not granted'}
                  <div className="source">
                    Research retention:{' '}
                    {item.researchRetentionConsented ? 'granted' : 'not granted'}
                  </div>
                </td>
                <td>
                  {label(item.closeLoopState)}
                  <div className="source">
                    {item.resultingActionType
                      ? `${label(item.resultingActionType)} ${item.resultingActionId ?? ''}`
                      : 'No resulting action claimed'}
                  </div>
                  {item.selfClaimAvailable ? (
                    <button
                      className="button button-secondary"
                      disabled={busyFeedbackId === item.id}
                      onClick={() => void claim(item.id)}
                      type="button"
                    >
                      Claim exact review
                    </button>
                  ) : null}
                  {item.contentReadAuthorized ? (
                    <button
                      className="button button-secondary"
                      disabled={busyFeedbackId === item.id}
                      onClick={() => void openMinimizedText(item.id)}
                      type="button"
                    >
                      Open minimized text
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {Object.values(openedContent).map((content) => (
        <section className="card section" key={content.feedbackId}>
          <span className="dev-pill">{content.evidenceTier}</span>
          <h2>Assigned minimized feedback {content.feedbackId}</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{content.minimizedText}</p>
          <p className="source">
            {label(content.redactionStatus)} · deterministic redaction verification passed · no
            provider or external action
          </p>
        </section>
      ))}
    </>
  );
}

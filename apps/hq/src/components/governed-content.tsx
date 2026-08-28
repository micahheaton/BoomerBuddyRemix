'use client';

import type {
  GovernedContentBoardResponse,
  GovernedContentDraftResponse,
  GovernedContentReviewRole,
} from '@boomerbuddy/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { HqApiError, hqRequest, readableError } from '../lib/api';

const reviewRoles = ['skeptical', 'accessibility', 'privacy_rights', 'final_human'] as const;

function label(value: string): string {
  return value.replaceAll('_', ' ');
}

function operationKey(action: 'publish' | 'unpublish' | 'retract'): string {
  return `governed-content:${action}:${crypto.randomUUID()}`;
}

export function GovernedContentStudio() {
  const [board, setBoard] = useState<GovernedContentBoardResponse>();
  const [draft, setDraft] = useState<GovernedContentDraftResponse>();
  const [sourceId, setSourceId] = useState('');
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [reviewRole, setReviewRole] = useState<GovernedContentReviewRole>('skeptical');
  const [reviewReason, setReviewReason] = useState('Reviewed against the exact revision.');
  const [correction, setCorrection] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [reauthRequired, setReauthRequired] = useState(false);

  const fail = useCallback((caught: unknown) => {
    setError(readableError(caught));
    setStatus('');
    setReauthRequired(
      caught instanceof HqApiError && (caught.status === 401 || caught.status === 403),
    );
  }, []);

  const requestBoard = useCallback(
    () =>
      hqRequest<GovernedContentBoardResponse>('/v1/hq/content', {
        cache: 'no-store',
      }),
    [],
  );

  const applyBoard = useCallback((response: GovernedContentBoardResponse) => {
    setBoard(response);
    setSourceId((current) => current || response.facts[0]?.sourceId || '');
    setError('');
    setReauthRequired(false);
  }, []);

  const refresh = useCallback(async () => {
    const response = await requestBoard();
    applyBoard(response);
  }, [applyBoard, requestBoard]);

  useEffect(() => {
    let active = true;
    void requestBoard()
      .then((response) => {
        if (active) applyBoard(response);
      })
      .catch((caught: unknown) => {
        if (active) fail(caught);
      });
    return () => {
      active = false;
    };
  }, [applyBoard, fail, requestBoard]);

  const loadDraft = useCallback(
    async (revisionId: string) => {
      setBusy(true);
      try {
        const response = await hqRequest<GovernedContentDraftResponse>(
          `/v1/hq/content/drafts/${encodeURIComponent(revisionId)}/preview`,
          { cache: 'no-store' },
        );
        setDraft(response);
        setSlug(response.document.slug);
        setTitle(response.document.title);
        setSummary(response.document.summary);
        setBody(response.document.body);
        setError('');
        setStatus(`Loaded exact revision ${response.version}.`);
      } catch (caught) {
        fail(caught);
      } finally {
        setBusy(false);
      }
    },
    [fail],
  );

  async function generateDrafts() {
    setBusy(true);
    try {
      const generated = await hqRequest<{ generatedRevisionIds: string[] }>(
        '/v1/hq/content/generate',
        {
          method: 'POST',
          body: JSON.stringify({ scheduleDate: new Date().toISOString().slice(0, 10), limit: 5 }),
        },
      );
      setStatus(
        generated.generatedRevisionIds.length === 0
          ? 'No approved source facts need a new draft.'
          : `Created ${generated.generatedRevisionIds.length} encrypted draft(s). Nothing was published.`,
      );
      await refresh();
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await hqRequest<{ revisionId: string }>(
        draft === undefined
          ? '/v1/hq/content/drafts'
          : `/v1/hq/content/drafts/${encodeURIComponent(draft.revisionId)}/revisions`,
        {
          method: 'POST',
          body: JSON.stringify(
            draft === undefined
              ? { sourceId, slug, title, summary, body }
              : {
                  slug,
                  title,
                  summary,
                  body,
                  correction,
                  expectedDocumentDigest: draft.documentDigest,
                },
          ),
        },
      );
      setStatus('Saved a new immutable encrypted revision. Review decisions do not carry forward.');
      await refresh();
      await loadDraft(response.revisionId);
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  }

  async function claimReview(role: GovernedContentReviewRole) {
    if (!draft) return;
    setBusy(true);
    try {
      await hqRequest(`/v1/hq/content/drafts/${encodeURIComponent(draft.revisionId)}/assignments`, {
        method: 'POST',
        body: JSON.stringify({ role, expectedDocumentDigest: draft.documentDigest }),
      });
      setStatus(`Claimed the ${label(role)} review for this exact digest.`);
      await refresh();
      await loadDraft(draft.revisionId);
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  }

  async function recordReview(decision: 'approve' | 'changes_requested' | 'reject') {
    if (!draft) return;
    setBusy(true);
    try {
      await hqRequest(`/v1/hq/content/drafts/${encodeURIComponent(draft.revisionId)}/reviews`, {
        method: 'POST',
        body: JSON.stringify({
          role: reviewRole,
          decision,
          reason: reviewReason,
          expectedDocumentDigest: draft.documentDigest,
        }),
      });
      setStatus(`Recorded immutable ${label(decision)} outcome for ${label(reviewRole)}.`);
      await refresh();
      await loadDraft(draft.revisionId);
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  }

  async function publicationAction(action: 'publish' | 'unpublish' | 'retract') {
    if (!draft) return;
    setBusy(true);
    try {
      await hqRequest(`/v1/hq/content/drafts/${encodeURIComponent(draft.revisionId)}/${action}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': operationKey(action) },
        body: JSON.stringify({ expectedDocumentDigest: draft.documentDigest }),
      });
      setStatus(
        action === 'publish'
          ? 'Published this exact approved revision to the first-party Learn surface.'
          : `${label(action)} completed. The public article is no longer visible.`,
      );
      await refresh();
      await loadDraft(draft.revisionId);
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="control-boundary" role="note">
        <strong>Human-gated first-party publishing.</strong> Drafts are encrypted and can use only
        reviewed structured facts. No fetch, model, email, SMS, social, or video provider is called,
        and generation never publishes.
      </div>
      {reauthRequired ? (
        <p className="error" role="alert">
          Recent HQ MFA is required.{' '}
          <Link href="/sign-in?redirect_url=/editorial">Sign in again</Link>.
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {status ? <p role="status">{status}</p> : null}

      <section className="section hq-card">
        <div className="hq-title-row">
          <div>
            <h2>Approved source facts and draft generation</h2>
            <p>Only exact, reviewed public-official records are eligible inputs.</p>
          </div>
          <button
            className="hq-button"
            disabled={busy}
            onClick={() => void generateDrafts()}
            type="button"
          >
            Generate internal drafts
          </button>
        </div>
        <p className="source">
          {board?.facts.length ?? 0} current facts · {board?.drafts.length ?? 0} immutable revisions
          · auto-publish off
        </p>
      </section>

      <section className="section table-wrap">
        <table>
          <caption>Governed draft and publication queue</caption>
          <thead>
            <tr>
              <th>Draft</th>
              <th>Source</th>
              <th>Reviews</th>
              <th>Publication</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {(board?.drafts ?? []).map((item) => (
              <tr key={item.revisionId}>
                <td>
                  {item.slug} v{item.version}
                  <div className="source">{item.documentDigest.slice(0, 12)}…</div>
                </td>
                <td>{item.sourceId}</td>
                <td>
                  {item.reviews.filter((review) => review.decision === 'approve').length}/4 approved
                </td>
                <td>
                  {label(item.publication)}
                  {item.blockers.length ? (
                    <div className="source">{item.blockers.map(label).join(', ')}</div>
                  ) : null}
                </td>
                <td>
                  <button
                    className="hq-button secondary"
                    disabled={busy}
                    onClick={() => void loadDraft(item.revisionId)}
                    type="button"
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <form className="hq-card section" onSubmit={(event) => void saveDraft(event)}>
        <h2>{draft ? `Edit as revision ${draft.version + 1}` : 'Create a human draft'}</h2>
        {!draft ? (
          <label>
            Approved source
            <select onChange={(event) => setSourceId(event.target.value)} required value={sourceId}>
              {(board?.facts ?? []).map((fact) => (
                <option key={fact.sourceId} value={fact.sourceId}>
                  {fact.region}: {fact.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Slug
          <input
            maxLength={100}
            onChange={(event) => setSlug(event.target.value)}
            required
            value={slug}
          />
        </label>
        <label>
          Title
          <input
            maxLength={160}
            onChange={(event) => setTitle(event.target.value)}
            required
            value={title}
          />
        </label>
        <label>
          Summary
          <textarea
            maxLength={500}
            onChange={(event) => setSummary(event.target.value)}
            required
            rows={4}
            value={summary}
          />
        </label>
        <label>
          Article body
          <textarea
            maxLength={16000}
            onChange={(event) => setBody(event.target.value)}
            required
            rows={14}
            value={body}
          />
        </label>
        {draft ? (
          <label>
            <input
              checked={correction}
              onChange={(event) => setCorrection(event.target.checked)}
              type="checkbox"
            />{' '}
            This revision corrects the currently published article
          </label>
        ) : null}
        <button className="hq-button" disabled={busy || sourceId === ''} type="submit">
          Save immutable revision
        </button>
        {draft ? (
          <button
            className="hq-button secondary"
            onClick={() => {
              setDraft(undefined);
              setSlug('');
              setTitle('');
              setSummary('');
              setBody('');
            }}
            type="button"
          >
            Start new draft
          </button>
        ) : null}
      </form>

      {draft ? (
        <>
          <section className="hq-card section">
            <h2>Exact-revision preview</h2>
            <p className="source">
              Digest {draft.documentDigest} · expires {new Date(draft.expiresAt).toLocaleString()}
            </p>
            <h3>{draft.document.title}</h3>
            <p>{draft.document.summary}</p>
            <pre className="preview-copy">{draft.document.body}</pre>
            <p className="source">
              Source:{' '}
              <a href={draft.source.url} rel="noreferrer" target="_blank">
                {draft.source.title}
              </a>{' '}
              · reviewed {new Date(draft.source.reviewedAt).toLocaleDateString()}
            </p>
          </section>

          <section className="hq-card section">
            <h2>Review this exact digest</h2>
            <ul className="plain-list">
              {reviewRoles.map((role) => {
                const outcome = draft.reviews.find((review) => review.role === role);
                return (
                  <li key={role}>
                    {label(role)}:{' '}
                    {outcome?.decision
                      ? label(outcome.decision)
                      : outcome
                        ? 'assigned'
                        : 'unassigned'}
                  </li>
                );
              })}
            </ul>
            <div className="button-row">
              {reviewRoles.map((role) => (
                <button
                  className="hq-button secondary"
                  disabled={busy}
                  key={role}
                  onClick={() => void claimReview(role)}
                  type="button"
                >
                  Claim {label(role)}
                </button>
              ))}
            </div>
            <label>
              Review lane
              <select
                onChange={(event) => setReviewRole(event.target.value as GovernedContentReviewRole)}
                value={reviewRole}
              >
                {reviewRoles.map((role) => (
                  <option key={role} value={role}>
                    {label(role)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reason
              <textarea
                maxLength={500}
                minLength={3}
                onChange={(event) => setReviewReason(event.target.value)}
                rows={3}
                value={reviewReason}
              />
            </label>
            <div className="button-row">
              <button
                className="hq-button"
                disabled={busy}
                onClick={() => void recordReview('approve')}
                type="button"
              >
                Approve
              </button>
              <button
                className="hq-button secondary"
                disabled={busy}
                onClick={() => void recordReview('changes_requested')}
                type="button"
              >
                Request changes
              </button>
              <button
                className="hq-button secondary"
                disabled={busy}
                onClick={() => void recordReview('reject')}
                type="button"
              >
                Reject
              </button>
            </div>
          </section>

          <section className="hq-card section">
            <h2>Publication control</h2>
            <p>
              {draft.publicationEligible
                ? 'All four exact-digest reviews passed.'
                : `Blocked: ${draft.blockers.map(label).join(', ')}`}
            </p>
            <div className="button-row">
              <button
                className="hq-button"
                disabled={busy || !draft.publicationEligible || draft.publication === 'published'}
                onClick={() => void publicationAction('publish')}
                type="button"
              >
                Publish exact revision
              </button>
              <button
                className="hq-button secondary"
                disabled={busy || draft.publication !== 'published'}
                onClick={() => void publicationAction('unpublish')}
                type="button"
              >
                Unpublish
              </button>
              <button
                className="hq-button secondary"
                disabled={busy || draft.publication !== 'published'}
                onClick={() => void publicationAction('retract')}
                type="button"
              >
                Retract
              </button>
            </div>
          </section>

          <section className="hq-card section">
            <h2>Export-only platform drafts</h2>
            <p className="source">
              Copy for review. No account connection or provider action exists.
            </p>
            <h3>YouTube script</h3>
            <pre className="preview-copy">{draft.document.platformDrafts.youtubeScript}</pre>
            <h3>TikTok caption</h3>
            <pre className="preview-copy">{draft.document.platformDrafts.tiktokCaption}</pre>
            <h3>LinkedIn post</h3>
            <pre className="preview-copy">{draft.document.platformDrafts.linkedinPost}</pre>
          </section>
        </>
      ) : null}
    </>
  );
}

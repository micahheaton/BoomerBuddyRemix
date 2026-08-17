'use client';

import type { FeedbackIntakeResponse } from '@boomerbuddy/contracts';
import { useRef, useState, type FormEvent } from 'react';
import { apiBaseUrl, apiRequest, readableError } from '../lib/api';

type FeedbackType =
  | 'product_feedback'
  | 'bug_report'
  | 'safety_concern'
  | 'accessibility_issue'
  | 'support_request'
  | 'pricing_feedback'
  | 'feature_request';

const feedbackTypeLabels: Readonly<Record<FeedbackType, string>> = {
  product_feedback: 'General product feedback',
  bug_report: 'Something did not work',
  safety_concern: 'Safety or fraud-quality concern',
  accessibility_issue: 'Accessibility blocker',
  support_request: 'Possible support need',
  pricing_feedback: 'Pricing feedback',
  feature_request: 'Feature idea',
};

function operationKey(): string {
  return `feedback:${crypto.randomUUID()}`;
}

function deviceClass(): 'desktop' | 'tablet' | 'phone' | 'unknown' {
  if (typeof window === 'undefined') return 'unknown';
  if (window.matchMedia('(max-width: 639px)').matches) return 'phone';
  if (window.matchMedia('(max-width: 1023px)').matches) return 'tablet';
  return 'desktop';
}

async function anonymousRequest(payload: unknown): Promise<FeedbackIntakeResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${apiBaseUrl}/v1/public/feedback`, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      const value = (await response.json().catch(() => undefined)) as
        { error?: { message?: string } } | undefined;
      throw new Error(value?.error?.message ?? 'Anonymous feedback could not be submitted.');
    }
    return (await response.json()) as FeedbackIntakeResponse;
  } finally {
    clearTimeout(timeout);
  }
}

export function FeedbackForm({ mode }: { mode: 'anonymous' | 'authenticated' }) {
  const [text, setText] = useState('');
  const [feedbackType, setFeedbackType] = useState<FeedbackType>('product_feedback');
  const [followUp, setFollowUp] = useState(false);
  const [researchRetention, setResearchRetention] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<FeedbackIntakeResponse>();
  const operation = useRef<string | undefined>(undefined);

  async function submit(event: FormEvent) {
    event.preventDefault();
    operation.current ??= operationKey();
    setBusy(true);
    setError('');
    try {
      const payload = {
        operationKey: operation.current,
        text,
        feedbackType,
        source: {
          surface: mode === 'anonymous' ? 'web_feedback_form' : 'in_app_contextual',
          appVersion: 'web-run3-local',
          ...(typeof navigator === 'undefined' || !navigator.language
            ? {}
            : { locale: navigator.language }),
          deviceClass: deviceClass(),
        },
        link: { permitted: false },
        followUp:
          mode === 'authenticated' && followUp
            ? {
                granted: true,
                purpose: 'feedback_follow_up',
                consentVersion: 'feedback-follow-up-v1',
                channelClass: 'in_app',
              }
            : { granted: false },
        researchRetention: researchRetention
          ? {
              granted: true,
              purpose: 'product_feedback_research',
              consentVersion: 'feedback-research-v1',
              retainUntil: new Date(Date.now() + 23 * 60 * 60_000).toISOString(),
            }
          : { granted: false },
      };
      const response =
        mode === 'anonymous'
          ? await anonymousRequest(payload)
          : await apiRequest<FeedbackIntakeResponse>('/v1/feedback', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
      setResult(response);
      setText('');
      operation.current = undefined;
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="member-grid">
      <form className="card form-stack" onSubmit={submit}>
        <label htmlFor={`${mode}-feedback-type`}>What kind of feedback is this?</label>
        <select
          id={`${mode}-feedback-type`}
          value={feedbackType}
          onChange={(event) => setFeedbackType(event.target.value as FeedbackType)}
        >
          {Object.entries(feedbackTypeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label htmlFor={`${mode}-feedback-text`}>Your feedback</label>
        <textarea
          id={`${mode}-feedback-text`}
          value={text}
          minLength={4}
          maxLength={8_192}
          required
          placeholder="Describe what you noticed without copying sensitive account or scam content."
          onChange={(event) => setText(event.target.value)}
        />
        <p className="help">
          Do not enter passwords, one-time codes, payment-card or bank details, private keys, seed
          phrases, safe words, or an active emergency. Feedback is not emergency response and does
          not automatically open a support case.
        </p>
        {mode === 'authenticated' ? (
          <label className="choice">
            <input
              type="checkbox"
              checked={followUp}
              onChange={(event) => setFollowUp(event.target.checked)}
            />
            Allow an in-app follow-up for this feedback. This does not authorize email or SMS.
          </label>
        ) : (
          <p className="help">
            Anonymous feedback cannot authorize follow-up and is not attached to an account,
            household, campaign, or product object.
          </p>
        )}
        <label className="choice">
          <input
            type="checkbox"
            checked={researchRetention}
            onChange={(event) => setResearchRetention(event.target.checked)}
          />
          Allow the minimized text to be retained for product-feedback research for up to 23 hours
          in this local candidate.
        </label>
        <p className="help">
          Without research retention, minimized text is scheduled for erasure after one hour.
          Attachments, screenshots, audio, video, email ingestion, transcription, and external AI
          processing are unavailable.
        </p>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="button button-primary" type="submit" disabled={busy || !text.trim()}>
          {busy ? 'Recording local feedback…' : 'Submit local feedback'}
        </button>
      </form>
      <aside className="notice notice-warning">
        <h2>Local evidence boundary</h2>
        <ul className="plain-list">
          <li>Supported OTP, card, and explicit credential spans are removed before encryption.</li>
          <li>Unsafe or ambiguous secret material is discarded with metadata-only quarantine.</li>
          <li>No media, provider, message, issue, experiment, or customer action runs.</li>
          <li>Queued processing is not a completed classification or duplicate decision.</li>
          {mode === 'anonymous' ? (
            <li>
              This local form provides no post-submission anonymous management credential; bounded
              automatic expiry is the deletion path.
            </li>
          ) : (
            <li>Authenticated optional consent can be withdrawn through the account API.</li>
          )}
        </ul>
      </aside>
      {result ? (
        <section className="card full-span" aria-live="polite" data-testid="feedback-receipt">
          <span className="dev-pill">{result.feedback.evidenceTier}</span>
          <h2>Feedback recorded locally</h2>
          <p>
            Receipt {result.feedback.id} · {result.feedback.status.replaceAll('_', ' ')} ·{' '}
            {result.feedback.redactionStatus.replaceAll('_', ' ')}
          </p>
          <p>Media accepted: no · Provider processed: no · External action executed: no</p>
          {result.feedback.retainedUntil ? (
            <p className="help">
              Local ciphertext deadline: {new Date(result.feedback.retainedUntil).toLocaleString()}
            </p>
          ) : (
            <p className="help">Unsafe text was not retained as ciphertext.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}

'use client';

import type {
  FeedbackConsentWithdrawalResponse,
  FeedbackIntakeResponse,
} from '@boomerbuddy/contracts';
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
  const [grantedPurposes, setGrantedPurposes] = useState<Array<'follow_up' | 'research_retention'>>(
    [],
  );
  const [withdrawingPurpose, setWithdrawingPurpose] = useState<
    'follow_up' | 'research_retention'
  >();
  const [withdrawalNotice, setWithdrawalNotice] = useState('');
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
          appVersion: 'web-run3-1',
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
      setGrantedPurposes([
        ...(mode === 'authenticated' && followUp ? (['follow_up'] as const) : []),
        ...(mode === 'authenticated' && researchRetention ? (['research_retention'] as const) : []),
      ]);
      setWithdrawalNotice('');
      setText('');
      operation.current = undefined;
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function withdrawConsent(purpose: 'follow_up' | 'research_retention'): Promise<void> {
    if (mode !== 'authenticated' || result === undefined) return;
    setWithdrawingPurpose(purpose);
    setError('');
    setWithdrawalNotice('');
    try {
      const response = await apiRequest<FeedbackConsentWithdrawalResponse>(
        `/v1/feedback/${result.feedback.id}/consents/${purpose}/withdraw`,
        { method: 'POST' },
      );
      setGrantedPurposes((current) =>
        response.activeStoreCiphertextErased ? [] : current.filter((value) => value !== purpose),
      );
      setWithdrawalNotice(
        response.activeStoreCiphertextErased
          ? 'Consent withdrawn. The retained minimized text was erased.'
          : 'Consent withdrawn.',
      );
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setWithdrawingPurpose(undefined);
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
            Anonymous feedback cannot authorize follow-up and is not linked to an account or
            household.
          </p>
        )}
        <label className="choice">
          <input
            type="checkbox"
            checked={researchRetention}
            onChange={(event) => setResearchRetention(event.target.checked)}
          />
          Allow the minimized text to be retained for product-feedback research for up to 23 hours.
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
          {busy ? 'Recording feedback…' : 'Submit feedback'}
        </button>
      </form>
      <aside className="notice notice-warning">
        <h2>What happens when you submit</h2>
        <ul className="plain-list">
          <li>
            Common one-time codes, payment-card numbers, and passwords are removed before storage.
          </li>
          <li>Text that may contain unsafe secret information is discarded.</li>
          <li>
            Submitting feedback does not send a message, open a support case, or take action on your
            account.
          </li>
          <li>
            A recorded submission does not mean it has been reviewed or grouped with another report.
          </li>
          {mode === 'anonymous' ? (
            <li>
              Anonymous feedback cannot be managed after submission and is deleted automatically on
              the schedule described above.
            </li>
          ) : (
            <li>Optional follow-up or research permission can be withdrawn after submission.</li>
          )}
        </ul>
      </aside>
      {result ? (
        <section className="card full-span" aria-live="polite" data-testid="feedback-receipt">
          <span className="dev-pill">Private beta</span>
          <h2>Feedback recorded</h2>
          <p>Reference: {result.feedback.id}</p>
          <p>No media was accepted and no outside action was taken.</p>
          {result.feedback.retainedUntil ? (
            <p className="help">
              Feedback text is scheduled for deletion by{' '}
              {new Date(result.feedback.retainedUntil).toLocaleString()}.
            </p>
          ) : (
            <p className="help">
              Text that may contain unsafe secret information was not retained.
            </p>
          )}
          {mode === 'authenticated' && grantedPurposes.length > 0 ? (
            <div className="button-row" aria-label="Feedback consent controls">
              {grantedPurposes.map((purpose) => (
                <button
                  className="button button-secondary"
                  disabled={withdrawingPurpose !== undefined}
                  key={purpose}
                  onClick={() => void withdrawConsent(purpose)}
                  type="button"
                >
                  {withdrawingPurpose === purpose
                    ? 'Withdrawing…'
                    : `Withdraw ${purpose === 'follow_up' ? 'follow-up' : 'research retention'} consent`}
                </button>
              ))}
            </div>
          ) : null}
          {withdrawalNotice ? (
            <p className="help" role="status">
              {withdrawalNotice}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

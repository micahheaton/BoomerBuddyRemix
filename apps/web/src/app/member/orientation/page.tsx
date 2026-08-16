'use client';

import { useEffect, useState } from 'react';
import type { OrientationStateDto } from '@boomerbuddy/contracts';
import { useHousehold } from '../../../components/household-context';
import { apiRequest, readableError } from '../../../lib/api';

const steps = [
  {
    key: 'protection_subject',
    title: 'Confirm identity, enrollment, and consent',
    detail:
      'Confirm whose identity and safety plan this is. This review does not verify identity. The protected adult must hold an accepted self-enrollment; household administration or payment never substitutes for that person’s consent.',
  },
  {
    key: 'trusted_circle',
    title: 'Consent and Trusted Circle',
    detail:
      'Invite only people you know. Review the exact person, sharing permission, and withdrawal path. Each pairwise permission requires acceptance and can be ended independently. Notifications are unavailable in this build, so agree on a manual contact method instead.',
  },
  {
    key: 'safe_word',
    title: 'Plan a family safe word',
    detail:
      'Use a private phrase to challenge unexpected money or emergency requests. Do not reuse a password.',
  },
  {
    key: 'practice_check',
    title: 'Practice the Check and sharing workflow',
    detail:
      'Use a synthetic scenario to practice pausing, putting the suspicious text or URL into Check, reading evidence and limits, choosing a safe action, and sharing only the redacted result when you deliberately want help.',
  },
  {
    key: 'capabilities_and_limits',
    title: 'Understand limits and the recovery path',
    detail:
      'Local rules-only analysis can be wrong, does not fetch URLs or use a live reputation provider, and is not a monitoring or emergency service. If money, access, or credentials were already exposed, stop contact, use independently found official channels, secure the affected account, and seek qualified help; do not wait for another Check.',
  },
  {
    key: 'review',
    title: 'Review the plan',
    detail:
      'Confirm identity and protected-person scope, consent choices, pairwise permissions, manual notification/contact plan, safe-word choice, Check and sharing workflow, recovery contacts, and independent verification steps.',
  },
] as const;

type StepKey = (typeof steps)[number]['key'];

export default function OrientationPage() {
  const { selectedScope } = useHousehold();
  const [orientation, setOrientation] = useState<OrientationStateDto>();
  const [phrase, setPhrase] = useState('');
  const [practiceChoice, setPracticeChoice] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const canUseOrientation =
    selectedScope?.isProtectedMember === true &&
    selectedScope.capabilities.includes('orientation:use');

  useEffect(() => {
    if (!canUseOrientation) return;
    apiRequest<{ orientation: OrientationStateDto }>('/v1/orientation')
      .then((response) => setOrientation(response.orientation))
      .catch((caught) => setError(readableError(caught)));
  }, [canUseOrientation]);

  async function start() {
    setBusy('start');
    setError('');
    try {
      const response = await apiRequest<{ orientation: OrientationStateDto }>(
        '/v1/orientation/start',
        { method: 'POST', body: '{}' },
      );
      setOrientation(response.orientation);
      setAnnouncement('Orientation started.');
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy('');
    }
  }

  async function complete(stepKey: StepKey) {
    setBusy(stepKey);
    setError('');
    try {
      const response = await apiRequest<{ orientation: OrientationStateDto }>(
        `/v1/orientation/steps/${stepKey}`,
        { method: 'PUT', body: JSON.stringify({ complete: true }) },
      );
      setOrientation(response.orientation);
      setAnnouncement(`${steps.find((step) => step.key === stepKey)?.title} complete.`);
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy('');
    }
  }

  async function saveSafeWord(action: 'configure' | 'defer') {
    setBusy('safe_word');
    setError('');
    try {
      await apiRequest('/v1/orientation/safe-word', {
        method: 'PUT',
        body: JSON.stringify(action === 'configure' ? { action, phrase } : { action }),
      });
      const response = await apiRequest<{ orientation: OrientationStateDto }>(
        '/v1/orientation/steps/safe_word',
        { method: 'PUT', body: JSON.stringify({ complete: true }) },
      );
      setOrientation(response.orientation);
      setPhrase('');
      setAnnouncement(
        action === 'configure'
          ? 'Safe-word choice saved and step completed.'
          : 'Informed safe-word deferral saved and step completed.',
      );
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy('');
    }
  }

  const completed = orientation?.completedSteps.length ?? 0;
  const nextIncompleteStep = steps.find(
    (step) => !(orientation?.completedSteps.includes(step.key) ?? false),
  )?.key;
  if (!canUseOrientation) {
    return (
      <main id="main-content" className="member-shell member-main">
        <span className="eyebrow">Guided setup</span>
        <h1 className="member-heading">Orientation unavailable in this household</h1>
        <section className="notice notice-warning">
          <h2>Protected-adult enrollment required</h2>
          <p>
            Self-orientation and safe-word setup require an active protected-adult enrollment.
            Household administrator access alone does not grant these protected workflows.
          </p>
        </section>
      </main>
    );
  }
  return (
    <main id="main-content" className="member-shell member-main">
      <span className="eyebrow">Guided setup</span>
      <h1 className="member-heading">Orientation</h1>
      <p className="lede">
        Six guided stages cover identity, protected-person consent, Trusted Circle sharing,
        notification limits, a realistic Check, recovery, and product boundaries.
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="card" style={{ marginBlock: '1.5rem' }}>
        <div
          className="progress"
          role="progressbar"
          aria-label="Orientation progress"
          aria-valuemin={0}
          aria-valuemax={6}
          aria-valuenow={completed}
        >
          <span style={{ width: `${(completed / 6) * 100}%` }} />
        </div>
        <p>
          <strong>{completed} of 6 complete</strong> · Status:{' '}
          {orientation?.status?.replaceAll('_', ' ') ?? 'loading'}
        </p>
        {orientation ? (
          <p className="meta">
            Safe-word choice: {orientation.safeWordDisposition.replaceAll('_', ' ')} · Attention:{' '}
            {orientation.needsAttention
              ? 'setup still needs review'
              : 'no incomplete stage flagged'}
          </p>
        ) : null}
        {orientation?.status === 'not_started' && (
          <button
            className="button-primary"
            type="button"
            onClick={() => void start()}
            disabled={busy === 'start'}
          >
            {busy === 'start' ? 'Starting…' : 'Start orientation'}
          </button>
        )}
      </div>
      <ol className="history-list">
        {steps.map((step, index) => {
          const done = orientation?.completedSteps.includes(step.key) ?? false;
          const isCurrent =
            orientation?.status !== 'not_started' && nextIncompleteStep === step.key;
          return (
            <li className="card" key={step.key} data-orientation-step={step.key}>
              <span className="step-number">{done ? '✓' : index + 1}</span>
              <h2>
                {step.title} {done && <span className="checkmark">— complete</span>}
              </h2>
              <p>{step.detail}</p>
              {step.key === 'trusted_circle' ? (
                <p className="help">
                  Completing this stage records that you reviewed the consent model. It does not
                  create a relationship, grant a permission, or send a notification; those actions
                  remain explicit in Family.
                </p>
              ) : null}
              {!done && !isCurrent ? (
                <p className="meta">Complete the earlier steps before this one.</p>
              ) : !done && step.key === 'safe_word' ? (
                <form
                  className="form-stack"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveSafeWord('configure');
                  }}
                >
                  <label htmlFor="safe-phrase">Private family phrase</label>
                  <input
                    id="safe-phrase"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={200}
                    value={phrase}
                    onChange={(event) => setPhrase(event.target.value)}
                  />
                  <p className="help">
                    The phrase is normalized only in memory. The service stores a salted,
                    memory-hard verifier—not the phrase—and never displays it back here.
                  </p>
                  <div className="button-row">
                    <button
                      className="button-primary"
                      disabled={busy === step.key || phrase.length < 8 || !isCurrent}
                      type="submit"
                    >
                      Save choice and complete
                    </button>
                    <button
                      className="button-secondary"
                      disabled={busy === step.key || !isCurrent}
                      type="button"
                      onClick={() => void saveSafeWord('defer')}
                    >
                      Defer after reading this
                    </button>
                  </div>
                </form>
              ) : !done && step.key === 'practice_check' ? (
                <div className="form-stack">
                  <fieldset>
                    <legend>
                      Practice: a text says your bank account is locked and gives a link. What is
                      the safer response?
                    </legend>
                    <label className="choice">
                      <input
                        type="radio"
                        name="practice-response"
                        value="link"
                        checked={practiceChoice === 'link'}
                        onChange={(event) => setPracticeChoice(event.target.value)}
                      />
                      Open the link quickly before the account closes
                    </label>
                    <label className="choice">
                      <input
                        type="radio"
                        name="practice-response"
                        value="official"
                        checked={practiceChoice === 'official'}
                        onChange={(event) => setPracticeChoice(event.target.value)}
                      />
                      Do not use the link; find the bank’s official number independently
                    </label>
                  </fieldset>
                  {practiceChoice === 'link' && (
                    <p className="error" role="alert">
                      That link could be part of the scam. Pause and verify through a channel you
                      find independently.
                    </p>
                  )}
                  {practiceChoice === 'official' && (
                    <p className="notice" role="status">
                      That is the safer response: avoid the supplied link and verify independently.
                    </p>
                  )}
                  <button
                    className="button-primary"
                    type="button"
                    disabled={Boolean(busy) || practiceChoice !== 'official' || !isCurrent}
                    onClick={() => void complete(step.key)}
                  >
                    {busy === step.key ? 'Saving…' : 'Complete the practice step'}
                  </button>
                </div>
              ) : (
                !done && (
                  <button
                    className="button-primary"
                    type="button"
                    disabled={Boolean(busy) || !isCurrent}
                    onClick={() => void complete(step.key)}
                  >
                    {busy === step.key ? 'Saving…' : 'Mark this step complete'}
                  </button>
                )
              )}
            </li>
          );
        })}
      </ol>
      {orientation?.status === 'ready' && (
        <div className="notice" role="status">
          <h2>Orientation ready</h2>
          <p>
            You can review these steps any time. Readiness does not mean messages are monitored or
            guaranteed safe.
          </p>
        </div>
      )}
    </main>
  );
}

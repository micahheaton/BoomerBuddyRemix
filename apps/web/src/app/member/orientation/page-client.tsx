'use client';

import { useEffect, useRef, useState } from 'react';
import type { OrientationStateDto } from '@boomerbuddy/contracts';
import { useHousehold } from '../../../components/household-context';
import { apiRequest, readableError } from '../../../lib/api';
import {
  householdBoundValue,
  householdRequestIsCurrent,
  type HouseholdBoundValue,
} from '../../../lib/household-request';
import MemberLearningClient from './member-learning-client';

const steps = [
  {
    key: 'protection_subject',
    title: 'Confirm identity, enrollment, and consent',
    detail:
      'Confirm whose account and safety plan this is. BoomerBuddy does not verify identity. The protected adult must enroll and consent for themselves; managing or paying for the household does not replace their consent.',
  },
  {
    key: 'trusted_circle',
    title: 'Consent and Trusted Circle',
    detail:
      'Invite only people you know. Each person must accept their own sharing permission, and either person can end it. Sharing a Check does not notify them, so agree on how to contact each other.',
  },
  {
    key: 'safe_word',
    title: 'Plan a family safe word',
    detail:
      'Use a private phrase to challenge unexpected money or emergency requests. Do not reuse a password.',
  },
  {
    key: 'practice_check',
    title: 'Practice checking and sharing',
    detail:
      'Use a fictional scenario to practice pausing, putting the suspicious message or website address into Check, reading warning signs and limits, choosing a safe action, and sharing only the redacted result when you deliberately want help.',
  },
  {
    key: 'capabilities_and_limits',
    title: 'Understand limits and the recovery path',
    detail:
      'The result can be wrong, does not open website addresses or look them up with an outside service, and is not a monitoring or emergency service. If money, access, or passwords were already exposed, stop contact, use independently found official channels, secure the affected account, and seek qualified help; do not wait for another Check.',
  },
  {
    key: 'review',
    title: 'Review the plan',
    detail:
      "Confirm who the plan is for, each person's consent and sharing choices, how to contact one another, the safe word, recovery contacts, and how to verify urgent requests independently.",
  },
] as const;

const orientationStatusText: Readonly<Record<OrientationStateDto['status'], string>> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  ready: 'Complete',
};

const safeWordText: Readonly<Record<OrientationStateDto['safeWordDisposition'], string>> = {
  unanswered: 'Not answered',
  configured: 'Saved',
  informed_deferral: 'Deferred after review',
};

type StepKey = (typeof steps)[number]['key'];

export default function OrientationPage() {
  const { selectedHouseholdId, selectedScope } = useHousehold();
  const [orientationState, setOrientationState] =
    useState<HouseholdBoundValue<OrientationStateDto>>();
  const [phraseState, setPhraseState] = useState<HouseholdBoundValue<string>>();
  const [practiceChoiceState, setPracticeChoiceState] = useState<HouseholdBoundValue<string>>();
  const [busyState, setBusyState] = useState<HouseholdBoundValue<string>>();
  const [errorState, setErrorState] = useState<HouseholdBoundValue<string>>();
  const [announcementState, setAnnouncementState] = useState<HouseholdBoundValue<string>>();
  const [reloadVersion, setReloadVersion] = useState(0);
  const selectedHouseholdIdRef = useRef(selectedHouseholdId);
  const loadGenerationRef = useRef(0);
  const loadControllerRef = useRef<AbortController | undefined>(undefined);
  const actionControllerRef = useRef<AbortController | undefined>(undefined);
  const canUseOrientation =
    selectedScope?.isProtectedMember === true &&
    selectedScope.capabilities.includes('orientation:use');

  useEffect(() => {
    selectedHouseholdIdRef.current = selectedHouseholdId;
  }, [selectedHouseholdId]);

  useEffect(() => {
    const householdId = selectedHouseholdId;
    const generation = ++loadGenerationRef.current;
    if (!canUseOrientation || !householdId) return;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    const requestIdentity = { householdId, generation };
    const requestIsCurrent = (): boolean =>
      !controller.signal.aborted &&
      householdRequestIsCurrent(requestIdentity, {
        householdId: selectedHouseholdIdRef.current,
        generation: loadGenerationRef.current,
      });
    void apiRequest<{ orientation: OrientationStateDto }>('/v1/orientation', {
      headers: { 'X-BB-Household-Id': householdId },
      signal: controller.signal,
    })
      .then((response) => {
        if (!requestIsCurrent()) return;
        setOrientationState({ householdId, value: response.orientation });
        setErrorState(undefined);
      })
      .catch((caught) => {
        if (!requestIsCurrent()) return;
        setErrorState({ householdId, value: readableError(caught) });
      });
    return () => {
      controller.abort();
      if (loadControllerRef.current === controller) loadControllerRef.current = undefined;
    };
  }, [canUseOrientation, reloadVersion, selectedHouseholdId]);

  useEffect(
    () => () => {
      actionControllerRef.current?.abort();
    },
    [selectedHouseholdId],
  );

  const orientation = householdBoundValue(orientationState, selectedHouseholdId);
  const phrase = householdBoundValue(phraseState, selectedHouseholdId) ?? '';
  const practiceChoice = householdBoundValue(practiceChoiceState, selectedHouseholdId) ?? '';
  const busy = householdBoundValue(busyState, selectedHouseholdId) ?? '';
  const error = householdBoundValue(errorState, selectedHouseholdId) ?? '';
  const announcement = householdBoundValue(announcementState, selectedHouseholdId) ?? '';

  function beginAction(action: string) {
    const householdId = selectedHouseholdId;
    if (!householdId) return undefined;
    loadGenerationRef.current += 1;
    loadControllerRef.current?.abort();
    actionControllerRef.current?.abort();
    const controller = new AbortController();
    actionControllerRef.current = controller;
    setBusyState({ householdId, value: action });
    setErrorState(undefined);
    const isCurrent = (): boolean =>
      !controller.signal.aborted &&
      actionControllerRef.current === controller &&
      selectedHouseholdIdRef.current === householdId;
    return { controller, householdId, isCurrent };
  }

  async function start() {
    const action = beginAction('start');
    if (!action) return;
    try {
      const response = await apiRequest<{ orientation: OrientationStateDto }>(
        '/v1/orientation/start',
        {
          method: 'POST',
          body: '{}',
          headers: { 'X-BB-Household-Id': action.householdId },
          signal: action.controller.signal,
        },
      );
      if (!action.isCurrent()) return;
      setOrientationState({ householdId: action.householdId, value: response.orientation });
      setAnnouncementState({ householdId: action.householdId, value: 'Orientation started.' });
    } catch (caught) {
      if (action.isCurrent()) {
        setErrorState({ householdId: action.householdId, value: readableError(caught) });
      }
    } finally {
      if (action.isCurrent()) setBusyState(undefined);
    }
  }

  async function complete(stepKey: StepKey) {
    const action = beginAction(stepKey);
    if (!action) return;
    try {
      const response = await apiRequest<{ orientation: OrientationStateDto }>(
        `/v1/orientation/steps/${stepKey}`,
        {
          method: 'PUT',
          body: JSON.stringify({ complete: true }),
          headers: { 'X-BB-Household-Id': action.householdId },
          signal: action.controller.signal,
        },
      );
      if (!action.isCurrent()) return;
      setOrientationState({ householdId: action.householdId, value: response.orientation });
      setAnnouncementState({
        householdId: action.householdId,
        value: `${steps.find((step) => step.key === stepKey)?.title} complete.`,
      });
    } catch (caught) {
      if (action.isCurrent()) {
        setErrorState({ householdId: action.householdId, value: readableError(caught) });
      }
    } finally {
      if (action.isCurrent()) setBusyState(undefined);
    }
  }

  async function saveSafeWord(action: 'configure' | 'defer') {
    const actionAttempt = beginAction('safe_word');
    if (!actionAttempt) return;
    try {
      await apiRequest('/v1/orientation/safe-word', {
        method: 'PUT',
        body: JSON.stringify(action === 'configure' ? { action, phrase } : { action }),
        headers: { 'X-BB-Household-Id': actionAttempt.householdId },
        signal: actionAttempt.controller.signal,
      });
      if (!actionAttempt.isCurrent()) return;
      const response = await apiRequest<{ orientation: OrientationStateDto }>(
        '/v1/orientation/steps/safe_word',
        {
          method: 'PUT',
          body: JSON.stringify({ complete: true }),
          headers: { 'X-BB-Household-Id': actionAttempt.householdId },
          signal: actionAttempt.controller.signal,
        },
      );
      if (!actionAttempt.isCurrent()) return;
      setOrientationState({
        householdId: actionAttempt.householdId,
        value: response.orientation,
      });
      setPhraseState(undefined);
      setAnnouncementState({
        householdId: actionAttempt.householdId,
        value:
          action === 'configure'
            ? 'Safe-word choice saved and step completed.'
            : 'Informed safe-word deferral saved and step completed.',
      });
    } catch (caught) {
      if (actionAttempt.isCurrent()) {
        setErrorState({
          householdId: actionAttempt.householdId,
          value: readableError(caught),
        });
      }
    } finally {
      if (actionAttempt.isCurrent()) setBusyState(undefined);
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
          <h2>Protected adult access required</h2>
          <p>
            Only an enrolled protected adult can complete orientation and set a safe word. Managing
            or paying for the household does not replace that adult&apos;s consent.
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
        Six guided stages cover identity, consent, Trusted Circle sharing, a realistic Check,
        recovery, and what BoomerBuddy can and cannot do.
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {error && (
        <section className="notice notice-warning" aria-labelledby="orientation-load-error">
          <h2 id="orientation-load-error">Orientation could not be loaded</h2>
          <p className="error" role="alert">
            {error}
          </p>
          {!orientation ? (
            <button
              className="button-secondary"
              type="button"
              onClick={() => {
                setErrorState(undefined);
                setReloadVersion((current) => current + 1);
              }}
            >
              Try loading orientation again
            </button>
          ) : null}
        </section>
      )}
      {!orientation && !error ? <p role="status">Loading orientation...</p> : null}
      {orientation ? (
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
            {orientationStatusText[orientation.status]}
          </p>
          <p className="meta">
            Safe-word choice: {safeWordText[orientation.safeWordDisposition]} · Attention:{' '}
            {orientation.needsAttention
              ? 'setup still needs review'
              : 'no incomplete stage flagged'}
          </p>
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
      ) : null}
      {orientation ? (
        <ol className="history-list">
          {steps.map((step, index) => {
            const done = orientation?.completedSteps.includes(step.key) ?? false;
            const isCurrent =
              orientation?.status !== 'not_started' && nextIncompleteStep === step.key;
            return (
              <li className="card" key={step.key} data-orientation-step={step.key}>
                <span className="step-number">{done ? '✓' : index + 1}</span>
                <h2>
                  {step.title} {done && <span className="checkmark">- complete</span>}
                </h2>
                <p>{step.detail}</p>
                {step.key === 'trusted_circle' ? (
                  <p className="help">
                    Marking this step complete only records that you reviewed it. Add or remove
                    people and sharing permissions separately in Family. BoomerBuddy does not send a
                    notification when you finish this step.
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
                      onChange={(event) =>
                        setPhraseState({
                          householdId: selectedHouseholdId,
                          value: event.target.value,
                        })
                      }
                    />
                    <p className="help">
                      BoomerBuddy never stores the phrase itself. It stores only a one-way protected
                      value used to check it later, and it never displays the phrase here.
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
                          onChange={(event) =>
                            setPracticeChoiceState({
                              householdId: selectedHouseholdId,
                              value: event.target.value,
                            })
                          }
                        />
                        Open the link quickly before the account closes
                      </label>
                      <label className="choice">
                        <input
                          type="radio"
                          name="practice-response"
                          value="official"
                          checked={practiceChoice === 'official'}
                          onChange={(event) =>
                            setPracticeChoiceState({
                              householdId: selectedHouseholdId,
                              value: event.target.value,
                            })
                          }
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
                        That is the safer response: avoid the supplied link and verify
                        independently.
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
      ) : null}
      {orientation?.status === 'ready' && (
        <div className="notice" role="status">
          <h2>Orientation ready</h2>
          <p>
            You can review these steps any time. Readiness does not mean messages are monitored or
            guaranteed safe.
          </p>
        </div>
      )}
      <MemberLearningClient />
    </main>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  AnswerMemberLearningLessonResponse,
  AnswerWeeklyRehearsalResponse,
  MemberLearningFeedItemDto,
  MemberLearningLessonDto,
  MemberLearningMutationAction,
  MemberLearningResponse,
  DurableActionOperationKeys,
} from '@boomerbuddy/contracts';
import {
  memberLearningCoarseRegionCodes,
  memberLearningCoarseRegionLabels,
} from '@boomerbuddy/contracts';
import { useHousehold } from '../../../components/household-context';
import { apiRequest, readableError } from '../../../lib/api';
import {
  householdBoundValue,
  householdRequestIsCurrent,
  type HouseholdBoundValue,
} from '../../../lib/household-request';
import { createWebMemberLearningOperationKeys } from '../../../lib/member-learning-idempotency';

const regionOptions = memberLearningCoarseRegionCodes.map(
  (code) => [code, memberLearningCoarseRegionLabels[code]] as const,
);

function formatDate(value: string | undefined): string {
  if (!value) return 'Not scheduled';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

function lessonStatus(state: MemberLearningLessonDto['progress']['state']): string {
  switch (state) {
    case 'not_started':
      return 'Not started';
    case 'in_progress':
      return 'In progress';
    case 'completed':
      return 'Complete';
    case 'review_due':
      return 'Review due';
  }
}

export default function MemberLearningClient() {
  const { selectedHouseholdId, selectedScope } = useHousehold();
  const [learningState, setLearningState] = useState<HouseholdBoundValue<MemberLearningResponse>>();
  const [activeLessonKey, setActiveLessonKey] = useState('');
  const [selectedOption, setSelectedOption] = useState('');
  const [coarseRegion, setCoarseRegion] = useState('US');
  const [weeklyRehearsalEnabled, setWeeklyRehearsalEnabled] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [selectedRehearsalOption, setSelectedRehearsalOption] = useState('');
  const [rehearsalFeedback, setRehearsalFeedback] = useState('');
  const [announcementState, setAnnouncementState] = useState<HouseholdBoundValue<string>>();
  const [busyState, setBusyState] = useState<HouseholdBoundValue<string>>();
  const [errorState, setErrorState] = useState<HouseholdBoundValue<string>>();
  const [reloadVersion, setReloadVersion] = useState(0);
  const selectedHouseholdIdRef = useRef(selectedHouseholdId);
  const loadGenerationRef = useRef(0);
  const loadControllerRef = useRef<AbortController | undefined>(undefined);
  const actionControllerRef = useRef<AbortController | undefined>(undefined);
  const operationKeysRef = useRef<DurableActionOperationKeys | undefined>(undefined);
  const activeLessonHeadingRef = useRef<HTMLHeadingElement>(null);
  const canUseLearning =
    selectedScope?.isProtectedMember === true &&
    selectedScope.capabilities.includes('orientation:use');

  useEffect(() => {
    selectedHouseholdIdRef.current = selectedHouseholdId;
  }, [selectedHouseholdId]);

  useEffect(() => {
    const householdId = selectedHouseholdId;
    const generation = ++loadGenerationRef.current;
    if (!canUseLearning || !householdId) return;
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
    apiRequest<MemberLearningResponse>('/v1/member-learning', {
      signal: controller.signal,
      headers: { 'X-BB-Household-Id': householdId },
    })
      .then((response) => {
        if (!requestIsCurrent()) return;
        setLearningState({ householdId, value: response });
        setActiveLessonKey(
          response.curriculum.resume?.lessonKey ?? response.curriculum.lessons[0]?.key ?? '',
        );
        setSelectedOption('');
        setFeedback('');
        setSelectedRehearsalOption('');
        setRehearsalFeedback('');
        setCoarseRegion(response.preferences.coarseRegion);
        setWeeklyRehearsalEnabled(response.preferences.weeklyRehearsalEnabled);
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
  }, [canUseLearning, reloadVersion, selectedHouseholdId]);

  useEffect(
    () => () => {
      actionControllerRef.current?.abort();
    },
    [selectedHouseholdId],
  );

  const learning = householdBoundValue(learningState, selectedHouseholdId);
  const announcement = householdBoundValue(announcementState, selectedHouseholdId) ?? '';
  const busy = householdBoundValue(busyState, selectedHouseholdId) ?? '';
  const error = householdBoundValue(errorState, selectedHouseholdId) ?? '';
  const weeklyRehearsal = learning?.weeklyRehearsal ?? null;

  const activeLesson = learning?.curriculum.lessons.find(
    (lesson) => lesson.key === activeLessonKey,
  );

  function acceptLearning(
    householdId: string,
    response: MemberLearningResponse,
    message: string,
  ): void {
    setLearningState({ householdId, value: response });
    setCoarseRegion(response.preferences.coarseRegion);
    setWeeklyRehearsalEnabled(response.preferences.weeklyRehearsalEnabled);
    setAnnouncementState({ householdId, value: message });
  }

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

  function operationKeys(): DurableActionOperationKeys {
    operationKeysRef.current ??= createWebMemberLearningOperationKeys(window.sessionStorage);
    return operationKeysRef.current;
  }

  function mutationKey(
    householdId: string,
    action: MemberLearningMutationAction,
    signature: string,
  ): Promise<string> {
    return operationKeys().retain({
      scope: householdId,
      action,
      canonicalRequest: signature,
      keyPrefix: `member-learning:${action}`,
    });
  }

  function settleMutationKey(
    householdId: string,
    action: MemberLearningMutationAction,
    key: string,
  ): Promise<void> {
    return operationKeys().settle({ scope: householdId, action, key });
  }

  function selectLesson(lessonKey: string): void {
    setActiveLessonKey(lessonKey);
    setSelectedOption('');
    setFeedback('');
    window.requestAnimationFrame(() => activeLessonHeadingRef.current?.focus());
  }

  async function startLesson(lesson: MemberLearningLessonDto): Promise<void> {
    const action = beginAction(`lesson:${lesson.key}`);
    if (!action) return;
    const operationAction = 'lesson-start' as const;
    setFeedback('');
    try {
      const operationKey = await mutationKey(
        action.householdId,
        operationAction,
        JSON.stringify([lesson.key, lesson.version]),
      );
      const response = await apiRequest<MemberLearningResponse>(
        `/v1/member-learning/lessons/${lesson.key}/start`,
        {
          method: 'POST',
          body: JSON.stringify({ lessonVersion: lesson.version }),
          headers: {
            'X-BB-Household-Id': action.householdId,
            'Idempotency-Key': operationKey,
          },
          signal: action.controller.signal,
        },
      );
      await settleMutationKey(action.householdId, operationAction, operationKey);
      if (!action.isCurrent()) return;
      acceptLearning(action.householdId, response, `${lesson.title} started.`);
    } catch (caught) {
      if (action.isCurrent()) {
        setErrorState({ householdId: action.householdId, value: readableError(caught) });
      }
    } finally {
      if (action.isCurrent()) setBusyState(undefined);
    }
  }

  async function answerLesson(lesson: MemberLearningLessonDto): Promise<void> {
    if (!selectedOption) return;
    const optionKey = selectedOption;
    const action = beginAction(`answer:${lesson.key}`);
    if (!action) return;
    const operationAction = 'lesson-answer' as const;
    try {
      const operationKey = await mutationKey(
        action.householdId,
        operationAction,
        JSON.stringify([lesson.key, lesson.version, optionKey]),
      );
      const response = await apiRequest<AnswerMemberLearningLessonResponse>(
        `/v1/member-learning/lessons/${lesson.key}/answer`,
        {
          method: 'POST',
          body: JSON.stringify({
            lessonVersion: lesson.version,
            optionKey,
          }),
          headers: {
            'X-BB-Household-Id': action.householdId,
            'Idempotency-Key': operationKey,
          },
          signal: action.controller.signal,
        },
      );
      await settleMutationKey(action.householdId, operationAction, operationKey);
      if (!action.isCurrent()) return;
      setFeedback(response.feedback);
      setSelectedOption('');
      acceptLearning(
        action.householdId,
        response.learning,
        response.correct ? 'Lesson complete.' : 'Try the scenario again after reading the hint.',
      );
    } catch (caught) {
      if (action.isCurrent()) {
        setErrorState({ householdId: action.householdId, value: readableError(caught) });
      }
    } finally {
      if (action.isCurrent()) setBusyState(undefined);
    }
  }

  async function savePreferences(): Promise<void> {
    const action = beginAction('preferences');
    if (!action) return;
    const operationAction = 'preferences-update' as const;
    try {
      const operationKey = await mutationKey(
        action.householdId,
        operationAction,
        JSON.stringify([coarseRegion, weeklyRehearsalEnabled]),
      );
      const response = await apiRequest<MemberLearningResponse>('/v1/member-learning/preferences', {
        method: 'PUT',
        body: JSON.stringify({ coarseRegion, weeklyRehearsalEnabled }),
        headers: {
          'X-BB-Household-Id': action.householdId,
          'Idempotency-Key': operationKey,
        },
        signal: action.controller.signal,
      });
      await settleMutationKey(action.householdId, operationAction, operationKey);
      if (!action.isCurrent()) return;
      acceptLearning(action.householdId, response, 'Learning and in-app reminder choices saved.');
    } catch (caught) {
      if (action.isCurrent()) {
        setErrorState({ householdId: action.householdId, value: readableError(caught) });
      }
    } finally {
      if (action.isCurrent()) setBusyState(undefined);
    }
  }

  async function answerRehearsal(): Promise<void> {
    const rehearsal = weeklyRehearsal;
    if (!rehearsal || !selectedRehearsalOption) return;
    const optionKey = selectedRehearsalOption;
    const action = beginAction('rehearsal');
    if (!action) return;
    const operationAction = 'weekly-rehearsal-complete' as const;
    try {
      const operationKey = await mutationKey(
        action.householdId,
        operationAction,
        JSON.stringify([rehearsal.key, rehearsal.version, rehearsal.occurrenceVersion, optionKey]),
      );
      const response = await apiRequest<AnswerWeeklyRehearsalResponse>(
        '/v1/member-learning/rehearsal/answer',
        {
          method: 'POST',
          body: JSON.stringify({
            rehearsalKey: rehearsal.key,
            rehearsalVersion: rehearsal.version,
            occurrenceVersion: rehearsal.occurrenceVersion,
            optionKey,
          }),
          headers: {
            'X-BB-Household-Id': action.householdId,
            'Idempotency-Key': operationKey,
          },
          signal: action.controller.signal,
        },
      );
      await settleMutationKey(action.householdId, operationAction, operationKey);
      if (!action.isCurrent()) return;
      setSelectedRehearsalOption('');
      setRehearsalFeedback(`${response.feedback} Practice note: ${rehearsal.takeaway}`);
      acceptLearning(
        action.householdId,
        response.learning,
        'Weekly rehearsal complete. The next one is scheduled in a week.',
      );
    } catch (caught) {
      if (action.isCurrent()) {
        setErrorState({ householdId: action.householdId, value: readableError(caught) });
      }
    } finally {
      if (action.isCurrent()) setBusyState(undefined);
    }
  }

  async function updateFeedItem(
    item: MemberLearningFeedItemDto,
    state: 'read' | 'dismissed',
  ): Promise<void> {
    const action = beginAction(`feed:${item.key}`);
    if (!action) return;
    const operationAction = 'feed-item-update' as const;
    try {
      const operationKey = await mutationKey(
        action.householdId,
        operationAction,
        JSON.stringify([item.key, item.version, state]),
      );
      const response = await apiRequest<MemberLearningResponse>(
        `/v1/member-learning/feed/${encodeURIComponent(item.key)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ itemVersion: item.version, state }),
          headers: {
            'X-BB-Household-Id': action.householdId,
            'Idempotency-Key': operationKey,
          },
          signal: action.controller.signal,
        },
      );
      await settleMutationKey(action.householdId, operationAction, operationKey);
      if (!action.isCurrent()) return;
      acceptLearning(
        action.householdId,
        response,
        state === 'read' ? 'Update marked as read.' : 'Update dismissed.',
      );
      if (state === 'read' && item.lessonKey) selectLesson(item.lessonKey);
    } catch (caught) {
      if (action.isCurrent()) {
        setErrorState({ householdId: action.householdId, value: readableError(caught) });
      }
    } finally {
      if (action.isCurrent()) setBusyState(undefined);
    }
  }

  if (!canUseLearning) return null;

  return (
    <section
      id="learn-updates"
      aria-labelledby="learn-updates-heading"
      style={{ marginTop: '3rem' }}
    >
      <span className="eyebrow">Learn &amp; updates</span>
      <h2 id="learn-updates-heading" className="member-heading">
        A little practice each week
      </h2>
      <p className="lede">
        Short scenarios build safer habits. Reviewed guidance is dated and source-linked; it is not
        live monitoring or an exhaustive list of scams.
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {error && (
        <section className="notice notice-warning" aria-labelledby="learning-load-error-heading">
          <h3 id="learning-load-error-heading">Learn &amp; updates needs attention</h3>
          <p className="error" role="alert">
            {error}
          </p>
          {!learning ? (
            <button
              className="button-secondary"
              type="button"
              onClick={() => {
                setErrorState(undefined);
                setReloadVersion((current) => current + 1);
              }}
            >
              Try loading Learn &amp; updates again
            </button>
          ) : null}
        </section>
      )}
      {!learning && !error ? (
        <p role="status">Loading lessons and reviewed guidance...</p>
      ) : learning ? (
        <>
          <section className="card" aria-labelledby="this-week-heading">
            <span className="dev-pill">This week</span>
            <h3 id="this-week-heading">Your in-app updates</h3>
            {rehearsalFeedback && (
              <p className="notice" role="status">
                {rehearsalFeedback}
              </p>
            )}
            {learning.feed.items.length === 0 ? (
              <p>You are caught up. No in-app reminder or reviewed update needs attention.</p>
            ) : (
              <ul className="history-list">
                {learning.feed.items.map((item) => (
                  <li key={`${item.key}:${item.version}`}>
                    <p>
                      <strong>{item.title}</strong>
                    </p>
                    <p>{item.summary}</p>
                    <div className="button-row">
                      {item.kind === 'weekly_rehearsal' ? (
                        weeklyRehearsal ? (
                          <form
                            className="form-stack"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void answerRehearsal();
                            }}
                          >
                            <p>{weeklyRehearsal.scenario}</p>
                            <fieldset>
                              <legend>{weeklyRehearsal.prompt}</legend>
                              {weeklyRehearsal.options.map((option) => (
                                <label className="choice" key={option.key}>
                                  <input
                                    type="radio"
                                    name={`weekly-rehearsal-${weeklyRehearsal.occurrenceVersion}`}
                                    value={option.key}
                                    checked={selectedRehearsalOption === option.key}
                                    onChange={(event) => {
                                      setSelectedRehearsalOption(event.target.value);
                                      setRehearsalFeedback('');
                                    }}
                                  />
                                  {option.label}
                                </label>
                              ))}
                            </fieldset>
                            <button
                              className="button-primary"
                              type="submit"
                              disabled={Boolean(busy) || !selectedRehearsalOption}
                            >
                              Review my first step
                            </button>
                            <p className="meta">
                              Scenario reviewed {formatDate(weeklyRehearsal.reviewedAt)}.{' '}
                              <a href={weeklyRehearsal.source.url} target="_blank" rel="noreferrer">
                                {weeklyRehearsal.source.title} (opens in a new tab)
                              </a>
                            </p>
                          </form>
                        ) : (
                          <p className="notice notice-warning">
                            This rehearsal changed. Refresh Learn &amp; updates before answering.
                          </p>
                        )
                      ) : (
                        <button
                          className="button-secondary"
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => void updateFeedItem(item, 'read')}
                        >
                          {item.kind === 'lesson' ? 'Open lesson' : 'Mark reviewed'}
                        </button>
                      )}
                      {item.kind !== 'weekly_rehearsal' && (
                        <button
                          className="button-secondary"
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => void updateFeedItem(item, 'dismissed')}
                        >
                          Dismiss
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="meta">
              {learning.feed.unreadCount} unread. Delivery is in this app only. No email, text, or
              push message is sent.
            </p>
          </section>

          <section
            className="card"
            aria-labelledby="curriculum-heading"
            style={{ marginTop: '1.5rem' }}
          >
            <h3 id="curriculum-heading">Seven short safety lessons</h3>
            <div
              className="progress"
              role="progressbar"
              aria-label="Safety lesson progress"
              aria-valuemin={0}
              aria-valuemax={learning.curriculum.totalCount}
              aria-valuenow={learning.curriculum.completedCount}
            >
              <span
                style={{
                  width: `${
                    (learning.curriculum.completedCount / learning.curriculum.totalCount) * 100
                  }%`,
                }}
              />
            </div>
            <p>
              <strong>
                {learning.curriculum.completedCount} of {learning.curriculum.totalCount} complete
              </strong>
            </p>
            <ol className="plain-list">
              {learning.curriculum.lessons.map((lesson) => (
                <li key={lesson.key}>
                  <button
                    className="button-secondary"
                    type="button"
                    aria-pressed={activeLessonKey === lesson.key}
                    onClick={() => {
                      selectLesson(lesson.key);
                    }}
                  >
                    {lesson.order}. {lesson.title} - {lessonStatus(lesson.progress.state)}
                  </button>
                </li>
              ))}
            </ol>
          </section>

          {activeLesson && (
            <section
              className="card"
              aria-labelledby="active-lesson-heading"
              style={{ marginTop: '1.5rem' }}
            >
              <span className="dev-pill">About {activeLesson.estimatedMinutes} minutes</span>
              <h3 id="active-lesson-heading" ref={activeLessonHeadingRef} tabIndex={-1}>
                {activeLesson.title}
              </h3>
              <p>{activeLesson.objective}</p>
              {activeLesson.progress.state === 'not_started' ? (
                <button
                  className="button-primary"
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void startLesson(activeLesson)}
                >
                  Start this lesson
                </button>
              ) : (
                <form
                  className="form-stack"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void answerLesson(activeLesson);
                  }}
                >
                  <fieldset>
                    <legend>{activeLesson.scenario}</legend>
                    {activeLesson.options.map((option) => (
                      <label className="choice" key={option.key}>
                        <input
                          type="radio"
                          name={`member-learning-${activeLesson.key}`}
                          value={option.key}
                          checked={selectedOption === option.key}
                          onChange={(event) => setSelectedOption(event.target.value)}
                        />
                        {option.label}
                      </label>
                    ))}
                  </fieldset>
                  <button
                    className="button-primary"
                    type="submit"
                    disabled={Boolean(busy) || !selectedOption}
                  >
                    Check my answer
                  </button>
                </form>
              )}
              {feedback && (
                <p className="notice" role="status">
                  {feedback}
                </p>
              )}
              <p>
                <strong>Remember:</strong> {activeLesson.takeaway}
              </p>
              <p className="meta">Official learning sources:</p>
              <ul className="plain-list">
                {activeLesson.sources.map((source) => (
                  <li key={source.url}>
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {source.title} (opens in a new tab)
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section
            className="card"
            aria-labelledby="guidance-heading"
            style={{ marginTop: '1.5rem' }}
          >
            <span className="dev-pill">Human-curated, not live monitoring</span>
            <h3 id="guidance-heading">Reviewed scam guidance</h3>
            {learning.guidance.state === 'fallback_national' && (
              <p className="notice">
                No current state-specific brief is available, so national guidance is shown.
              </p>
            )}
            {learning.guidance.staleMessage && (
              <p className="notice notice-warning">{learning.guidance.staleMessage}</p>
            )}
            {learning.guidance.briefs.length === 0 ? (
              <p>
                No reviewed brief is current. Use official sources and the safer-action habits
                above.
              </p>
            ) : (
              learning.guidance.briefs.map((brief) => (
                <article key={`${brief.key}:${brief.version}`}>
                  <h4>{brief.title}</h4>
                  <p>{brief.summary}</p>
                  <ul>
                    {brief.safeActions.map((action) => (
                      <li key={action}>{action}</li>
                    ))}
                  </ul>
                  <p className="meta">
                    Source published {formatDate(brief.source.publishedAt)}. BoomerBuddy reviewed{' '}
                    {formatDate(brief.reviewedAt)}. Review expires {formatDate(brief.expiresAt)}.
                  </p>
                  <a href={brief.source.url} target="_blank" rel="noreferrer">
                    Open official source: {brief.source.title} (opens in a new tab)
                  </a>
                </article>
              ))
            )}
          </section>

          <section
            className="card"
            aria-labelledby="learning-preferences-heading"
            style={{ marginTop: '1.5rem' }}
          >
            <h3 id="learning-preferences-heading">Your learning choices</h3>
            <div className="form-stack">
              <label htmlFor="learning-region">Show guidance for</label>
              <select
                id="learning-region"
                value={coarseRegion}
                onChange={(event) => setCoarseRegion(event.target.value)}
              >
                {regionOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <p className="help">
                This stores only a country or state choice, never an address or precise location. If
                no state brief is current, national guidance appears instead.
              </p>
              <label className="choice">
                <input
                  type="checkbox"
                  checked={weeklyRehearsalEnabled}
                  onChange={(event) => setWeeklyRehearsalEnabled(event.target.checked)}
                />
                Show a weekly two-minute rehearsal in this in-app feed
              </label>
              <p className="help">
                This is off until you choose it. It never sends an email, text message, or push
                notification.
              </p>
              <button
                className="button-primary"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void savePreferences()}
              >
                Save learning choices
              </button>
              {learning.preferences.weeklyRehearsalEnabled && (
                <p className="meta">
                  Next rehearsal: {formatDate(learning.preferences.nextRehearsalAt)}
                </p>
              )}
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}

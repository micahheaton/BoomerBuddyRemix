import { afterEach, describe, expect, it } from 'vitest';
import {
  browserHeaders,
  createApiHarness,
  createMutableClock,
  login,
  type ApiHarness,
} from './support';

function operation(
  action:
    | 'lesson-start'
    | 'lesson-answer'
    | 'preferences-update'
    | 'weekly-rehearsal-complete'
    | 'feed-item-update',
  sequence: number,
): string {
  return `member-learning:${action}:30000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

describe('member learning API', () => {
  let harness: ApiHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('serves protected adults a durable curriculum, dated guidance, and in-app-only feed', async () => {
    const clock = createMutableClock(new Date('2026-08-27T12:00:00.000Z'));
    harness = await createApiHarness(clock);
    const alice = await login(harness.app, 'owner-alice');
    const headers = browserHeaders(alice.cookie as string);

    const initial = await harness.app.inject({
      method: 'GET',
      url: '/v1/member-learning',
      headers,
    });
    expect(initial.statusCode, initial.body).toBe(200);
    expect(initial.headers['cache-control']).toContain('no-store');
    expect(initial.body).not.toContain('correctOptionKey');
    expect(initial.json()).toMatchObject({
      curriculum: {
        version: 'beta-1',
        completedCount: 0,
        totalCount: 7,
        resume: { lessonKey: 'pause_under_pressure', reason: 'next' },
      },
      guidance: {
        requestedRegion: 'US',
        resolvedRegion: 'US',
        state: 'current',
        curated: true,
        liveMonitoring: false,
        exhaustive: false,
        externalFetch: false,
      },
      preferences: { coarseRegion: 'US', weeklyRehearsalEnabled: false },
      weeklyRehearsal: null,
      feed: { delivery: 'in_app_only', externalDelivery: 'disabled' },
      contentBoundary: 'repository_curated_in_app_only',
    });
    expect(initial.json<{ curriculum: { lessons: unknown[] } }>().curriculum.lessons).toHaveLength(
      7,
    );

    const started = await harness.app.inject({
      method: 'POST',
      url: '/v1/member-learning/lessons/pause_under_pressure/start',
      headers: { ...headers, 'idempotency-key': operation('lesson-start', 1) },
      payload: { lessonVersion: 1 },
    });
    expect(started.statusCode, started.body).toBe(200);
    expect(
      started.json<{
        curriculum: { lessons: { progress: { state: string } }[] };
      }>().curriculum.lessons[0]?.progress.state,
    ).toBe('in_progress');

    const wrong = await harness.app.inject({
      method: 'POST',
      url: '/v1/member-learning/lessons/pause_under_pressure/answer',
      headers: { ...headers, 'idempotency-key': operation('lesson-answer', 2) },
      payload: { lessonVersion: 1, optionKey: 'tap_now' },
    });
    expect(wrong.statusCode, wrong.body).toBe(200);
    const wrongBody = wrong.json<{
      correct: boolean;
      learning: {
        curriculum: { lessons: { progress: { state: string; attemptCount: number } }[] };
      };
    }>();
    expect(wrongBody.correct).toBe(false);
    expect(wrongBody.learning.curriculum.lessons[0]?.progress).toMatchObject({
      state: 'in_progress',
      attemptCount: 1,
    });

    const wrongRetry = await harness.app.inject({
      method: 'POST',
      url: '/v1/member-learning/lessons/pause_under_pressure/answer',
      headers: { ...headers, 'idempotency-key': operation('lesson-answer', 2) },
      payload: { lessonVersion: 1, optionKey: 'tap_now' },
    });
    expect(wrongRetry.statusCode, wrongRetry.body).toBe(200);
    expect(wrongRetry.json()).toEqual(wrong.json());
    const conflictingRetry = await harness.app.inject({
      method: 'POST',
      url: '/v1/member-learning/lessons/pause_under_pressure/answer',
      headers: { ...headers, 'idempotency-key': operation('lesson-answer', 2) },
      payload: { lessonVersion: 1, optionKey: 'pause' },
    });
    expect(conflictingRetry.statusCode, conflictingRetry.body).toBe(409);

    const completed = await harness.app.inject({
      method: 'POST',
      url: '/v1/member-learning/lessons/pause_under_pressure/answer',
      headers: { ...headers, 'idempotency-key': operation('lesson-answer', 3) },
      payload: { lessonVersion: 1, optionKey: 'pause' },
    });
    expect(completed.statusCode, completed.body).toBe(200);
    expect(completed.json()).toMatchObject({
      correct: true,
      learning: {
        curriculum: {
          completedCount: 1,
          resume: { lessonKey: 'verify_independently', reason: 'next' },
        },
      },
    });

    const preferences = await harness.app.inject({
      method: 'PUT',
      url: '/v1/member-learning/preferences',
      headers: { ...headers, 'idempotency-key': operation('preferences-update', 4) },
      payload: { coarseRegion: 'US-CA', weeklyRehearsalEnabled: true },
    });
    expect(preferences.statusCode, preferences.body).toBe(200);
    expect(preferences.json()).toMatchObject({
      guidance: { requestedRegion: 'US-CA', resolvedRegion: 'US-CA', state: 'current' },
      preferences: {
        coarseRegion: 'US-CA',
        weeklyRehearsalEnabled: true,
        nextRehearsalAt: '2026-09-03T12:00:00.000Z',
      },
    });

    clock.advance(7 * 24 * 60 * 60 * 1_000);
    const refreshedAlice = await login(harness.app, 'owner-alice');
    const refreshedHeaders = browserHeaders(refreshedAlice.cookie as string);
    const due = await harness.app.inject({
      method: 'GET',
      url: '/v1/member-learning',
      headers: refreshedHeaders,
    });
    expect(due.statusCode, due.body).toBe(200);
    const dueBody = due.json<{
      weeklyRehearsal: {
        key: string;
        version: number;
        occurrenceVersion: number;
        estimatedMinutes: number;
        options: { key: string }[];
      };
      feed: { items: { key: string; kind: string }[] };
    }>();
    expect(dueBody).toMatchObject({
      weeklyRehearsal: {
        version: 1,
        occurrenceVersion: expect.any(Number),
        estimatedMinutes: 2,
      },
      feed: {
        items: expect.arrayContaining([
          expect.objectContaining({ key: 'weekly-rehearsal', kind: 'weekly_rehearsal' }),
        ]),
      },
    });
    expect(due.body).not.toContain('saferOptionKey');

    const legacyCompletion = await harness.app.inject({
      method: 'POST',
      url: '/v1/member-learning/rehearsal/complete',
      headers: {
        ...refreshedHeaders,
        'idempotency-key': operation('weekly-rehearsal-complete', 5),
      },
      payload: { complete: true },
    });
    expect(legacyCompletion.statusCode, legacyCompletion.body).toBe(409);
    expect(legacyCompletion.body).toContain('require a response');
    const legacyCompletionRetry = await harness.app.inject({
      method: 'POST',
      url: '/v1/member-learning/rehearsal/complete',
      headers: {
        ...refreshedHeaders,
        'idempotency-key': operation('weekly-rehearsal-complete', 5),
      },
      payload: { complete: true },
    });
    expect(legacyCompletionRetry.statusCode, legacyCompletionRetry.body).toBe(409);
    expect(legacyCompletionRetry.json()).toMatchObject({
      error: {
        code: 'invalid_transition',
        message:
          'Weekly rehearsals now require a response. Refresh or update BoomerBuddy and answer the current two-minute scenario.',
      },
    });
    const legacyState = await harness.database.query<
      {
        readonly last_rehearsed_at: unknown | null;
        readonly rehearsal_receipts: number;
      } & Record<string, unknown>
    >(
      `SELECT preferences.last_rehearsed_at,
              (SELECT count(*)::integer
               FROM member_learning_operation_receipts receipt
               WHERE receipt.household_id = preferences.household_id
                 AND receipt.person_id = preferences.person_id
                 AND receipt.action_kind = 'weekly_rehearsal_complete') AS rehearsal_receipts
       FROM member_learning_preferences preferences
       WHERE preferences.household_id = 'household-sunrise'
         AND preferences.person_id = 'person-owner-alice'`,
    );
    expect(legacyState.rows[0]).toEqual({ last_rehearsed_at: null, rehearsal_receipts: 0 });
    const stillDueAfterLegacyRequest = await harness.app.inject({
      method: 'GET',
      url: '/v1/member-learning',
      headers: refreshedHeaders,
    });
    expect(stillDueAfterLegacyRequest.statusCode, stillDueAfterLegacyRequest.body).toBe(200);
    expect(stillDueAfterLegacyRequest.json()).toMatchObject({
      weeklyRehearsal: { occurrenceVersion: dueBody.weeklyRehearsal.occurrenceVersion },
    });

    const completionOnly = await harness.app.inject({
      method: 'POST',
      url: '/v1/member-learning/rehearsal/answer',
      headers: {
        ...refreshedHeaders,
        'idempotency-key': operation('weekly-rehearsal-complete', 6),
      },
      payload: { complete: true },
    });
    expect(completionOnly.statusCode, completionOnly.body).toBe(400);

    const dismissed = await harness.app.inject({
      method: 'PUT',
      url: '/v1/member-learning/feed/weekly-rehearsal',
      headers: {
        ...refreshedHeaders,
        'idempotency-key': operation('feed-item-update', 7),
      },
      payload: {
        itemVersion: dueBody.weeklyRehearsal.occurrenceVersion,
        state: 'dismissed',
      },
    });
    expect(dismissed.statusCode, dismissed.body).toBe(409);

    const answerPayload = {
      rehearsalKey: dueBody.weeklyRehearsal.key,
      rehearsalVersion: dueBody.weeklyRehearsal.version,
      occurrenceVersion: dueBody.weeklyRehearsal.occurrenceVersion,
      optionKey: dueBody.weeklyRehearsal.options[0]?.key,
    };
    const rehearsed = await harness.app.inject({
      method: 'POST',
      url: '/v1/member-learning/rehearsal/answer',
      headers: {
        ...refreshedHeaders,
        'idempotency-key': operation('weekly-rehearsal-complete', 8),
      },
      payload: answerPayload,
    });
    expect(rehearsed.statusCode, rehearsed.body).toBe(200);
    expect(rehearsed.json()).toMatchObject({
      saferChoice: expect.any(Boolean),
      feedback: expect.any(String),
      learning: { weeklyRehearsal: null },
    });
    expect(
      rehearsed
        .json<{ learning: { feed: { items: { kind: string }[] } } }>()
        .learning.feed.items.some((item) => item.kind === 'weekly_rehearsal'),
    ).toBe(false);
    const rehearsedRetry = await harness.app.inject({
      method: 'POST',
      url: '/v1/member-learning/rehearsal/answer',
      headers: {
        ...refreshedHeaders,
        'idempotency-key': operation('weekly-rehearsal-complete', 8),
      },
      payload: answerPayload,
    });
    expect(rehearsedRetry.statusCode, rehearsedRetry.body).toBe(200);
    expect(rehearsedRetry.json()).toEqual(rehearsed.json());
  }, 60_000);

  it('denies organizers, helpers, and cross-household selection without protected entitlement', async () => {
    harness = await createApiHarness(createMutableClock(new Date('2026-08-27T12:00:00.000Z')));
    const alice = await login(harness.app, 'owner-alice');
    const crossHousehold = await harness.app.inject({
      method: 'GET',
      url: '/v1/member-learning',
      headers: {
        ...browserHeaders(alice.cookie as string),
        'x-bb-household-id': 'household-harbor',
      },
    });
    expect(crossHousehold.statusCode).toBe(403);

    for (const persona of ['owner-bob', 'trusted-terry'] as const) {
      const session = await login(harness.app, persona);
      const denied = await harness.app.inject({
        method: 'GET',
        url: '/v1/member-learning',
        headers: browserHeaders(session.cookie as string),
      });
      expect(denied.statusCode, `${persona}: ${denied.body}`).toBe(403);
    }
  }, 60_000);

  it('rejects caller identity, precise location, stale versions, and forged feed keys', async () => {
    harness = await createApiHarness(createMutableClock(new Date('2026-08-27T12:00:00.000Z')));
    const alice = await login(harness.app, 'owner-alice');
    const headers = browserHeaders(alice.cookie as string);
    const missingIdempotencyKey = await harness.app.inject({
      method: 'POST',
      url: '/v1/member-learning/lessons/pause_under_pressure/start',
      headers,
      payload: { lessonVersion: 1 },
    });
    expect(missingIdempotencyKey.statusCode).toBe(400);
    const forgedAnswer = await harness.app.inject({
      method: 'POST',
      url: '/v1/member-learning/lessons/pause_under_pressure/answer',
      headers: { ...headers, 'idempotency-key': operation('lesson-answer', 10) },
      payload: {
        lessonVersion: 1,
        optionKey: 'pause',
        personId: 'person-protected-pat',
      },
    });
    expect(forgedAnswer.statusCode).toBe(400);
    const preciseRegion = await harness.app.inject({
      method: 'PUT',
      url: '/v1/member-learning/preferences',
      headers: { ...headers, 'idempotency-key': operation('preferences-update', 11) },
      payload: { coarseRegion: '94107', weeklyRehearsalEnabled: true },
    });
    expect(preciseRegion.statusCode).toBe(400);
    const unsupportedRegion = await harness.app.inject({
      method: 'PUT',
      url: '/v1/member-learning/preferences',
      headers: { ...headers, 'idempotency-key': operation('preferences-update', 12) },
      payload: { coarseRegion: 'US-ZZ', weeklyRehearsalEnabled: true },
    });
    expect(unsupportedRegion.statusCode).toBe(400);
    const staleVersion = await harness.app.inject({
      method: 'POST',
      url: '/v1/member-learning/lessons/pause_under_pressure/start',
      headers: { ...headers, 'idempotency-key': operation('lesson-start', 13) },
      payload: { lessonVersion: 2 },
    });
    expect(staleVersion.statusCode).toBe(409);
    const forgedFeed = await harness.app.inject({
      method: 'PUT',
      url: '/v1/member-learning/feed/guidance:forged',
      headers: { ...headers, 'idempotency-key': operation('feed-item-update', 14) },
      payload: { itemVersion: 1, state: 'read' },
    });
    expect(forgedFeed.statusCode).toBe(404);
  }, 60_000);
});

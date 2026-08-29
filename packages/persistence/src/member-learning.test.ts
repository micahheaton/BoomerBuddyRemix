import { createSeededTestDatabase } from '@boomerbuddy/testkit';
import { afterEach, describe, expect, it } from 'vitest';

import type { Database, SqlExecutor } from './database';
import { EntitlementRepository } from './entitlements';
import { MemberLearningRepository } from './member-learning';
import { SessionRepository } from './sessions';

const now = new Date('2026-08-27T12:00:00.000Z');

function operationKey(
  action:
    | 'lesson-start'
    | 'lesson-answer'
    | 'preferences-update'
    | 'weekly-rehearsal-complete'
    | 'feed-item-update',
  sequence: number,
): string {
  return `member-learning:${action}:10000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

async function withdrawAliceProtectedAccess(
  database: Database,
  operationKey: string,
): Promise<void> {
  const sessionId = await new SessionRepository(database).create({
    personId: 'person-owner-alice',
    audience: 'customer',
    issuedAt: now,
    expiresAt: new Date('2026-09-03T12:00:00.000Z'),
  });
  await new EntitlementRepository(database).withdrawProtectedSelfIdempotent({
    householdId: 'household-sunrise',
    personId: 'person-owner-alice',
    actorPersonId: 'person-owner-alice',
    operationKey,
    actorIdentityId: 'identity-owner-alice',
    actorIssuer: 'boomerbuddy-dev',
    actorIdentitySubject: 'owner-alice',
    sessionId,
    audience: 'customer',
    correlationId: `correlation-${operationKey}`,
    now,
  });
}

describe('member learning repository', () => {
  let database: Database | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  it('persists versioned progress, coarse guidance choices, and in-app-only rehearsal state', async () => {
    database = await createSeededTestDatabase(now);
    const repository = new MemberLearningRepository(database);
    const scope = {
      householdId: 'household-sunrise',
      personId: 'person-owner-alice',
      audience: 'customer' as const,
      correlationId: 'correlation-learning-repository-001',
      now,
    };

    const initial = await repository.getSnapshot(scope);
    expect(initial.curriculum).toMatchObject({
      version: 'beta-1',
      completedCount: 0,
      totalCount: 7,
      resume: {
        lessonKey: 'pause_under_pressure',
        lessonVersion: 1,
        reason: 'next',
      },
    });
    expect(initial.guidance).toMatchObject({
      requestedRegion: 'US',
      resolvedRegion: 'US',
      state: 'current',
    });
    expect(initial.preferences).toEqual({
      coarseRegion: 'US',
      weeklyRehearsalEnabled: false,
    });
    expect(initial.weeklyRehearsal).toBeNull();
    expect(initial.feed.items.map((item) => item.kind)).toEqual(['lesson', 'guidance']);
    await expect(
      repository.updatePreferences({
        ...scope,
        coarseRegion: 'US-ZZ',
        weeklyRehearsalEnabled: false,
        idempotencyKey: operationKey('preferences-update', 1),
      }),
    ).rejects.toThrow('supported coarse United States region');

    const startInput = {
      ...scope,
      lessonKey: 'pause_under_pressure' as const,
      lessonVersion: 1,
      idempotencyKey: operationKey('lesson-start', 2),
    };
    await repository.startLesson(startInput);
    await repository.startLesson({
      ...startInput,
      correlationId: 'correlation-learning-start-retry',
    });
    const wrong = await repository.answerLesson({
      ...scope,
      lessonKey: 'pause_under_pressure',
      lessonVersion: 1,
      optionKey: 'tap_now',
      idempotencyKey: operationKey('lesson-answer', 3),
    });
    expect(wrong.correct).toBe(false);
    expect(wrong.snapshot.curriculum.lessons[0]?.progress).toMatchObject({
      state: 'in_progress',
      attemptCount: 1,
    });
    const correct = await repository.answerLesson({
      ...scope,
      lessonKey: 'pause_under_pressure',
      lessonVersion: 1,
      optionKey: 'pause',
      idempotencyKey: operationKey('lesson-answer', 4),
    });
    expect(correct.correct).toBe(true);
    expect(correct.snapshot.curriculum.lessons[0]?.progress).toMatchObject({
      state: 'completed',
      attemptCount: 2,
    });
    expect(correct.snapshot.curriculum.resume).toMatchObject({
      lessonKey: 'verify_independently',
      reason: 'next',
    });

    const preferenceInput = {
      ...scope,
      coarseRegion: 'US-CA',
      weeklyRehearsalEnabled: true,
      idempotencyKey: operationKey('preferences-update', 5),
    };
    const preferences = await repository.updatePreferences(preferenceInput);
    await repository.updatePreferences({
      ...preferenceInput,
      correlationId: 'correlation-learning-preferences-retry',
    });
    expect(preferences.guidance).toMatchObject({
      requestedRegion: 'US-CA',
      resolvedRegion: 'US-CA',
      state: 'current',
    });
    expect(preferences.guidance.briefs.map((brief) => brief.region)).toEqual(['US-CA', 'US']);
    expect(preferences.preferences.nextRehearsalAt?.toISOString()).toBe('2026-09-03T12:00:00.000Z');
    expect(preferences.weeklyRehearsal).toBeNull();

    await expect(
      repository.answerWeeklyRehearsal({
        ...scope,
        rehearsalKey: 'bank_alert_callback',
        rehearsalVersion: 1,
        occurrenceVersion: 1,
        optionKey: 'use_official_bank_channel',
        idempotencyKey: operationKey('weekly-rehearsal-complete', 20),
      }),
    ).rejects.toThrow('No weekly rehearsal is due yet');

    const rehearsalDue = await repository.getSnapshot({
      ...scope,
      now: new Date('2026-09-03T12:00:00.000Z'),
    });
    expect(rehearsalDue.feed.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'weekly-rehearsal',
          kind: 'weekly_rehearsal',
          state: 'unread',
        }),
      ]),
    );
    expect(rehearsalDue.weeklyRehearsal).toMatchObject({
      occurrenceVersion: expect.any(Number),
      dueAt: new Date('2026-09-03T12:00:00.000Z'),
      rehearsal: { version: 1, estimatedMinutes: 2 },
    });
    const guidanceItem = rehearsalDue.feed.items.find((item) => item.kind === 'guidance');
    expect(guidanceItem).toBeDefined();
    const feedInput = {
      ...scope,
      now: new Date('2026-09-03T12:00:00.000Z'),
      itemKey: guidanceItem!.key,
      itemVersion: guidanceItem!.version,
      state: 'read',
      idempotencyKey: operationKey('feed-item-update', 6),
    } as const;
    const read = await repository.updateFeedItem(feedInput);
    await repository.updateFeedItem({
      ...feedInput,
      correlationId: 'correlation-learning-feed-retry',
    });
    expect(read.feed.items.find((item) => item.key === guidanceItem!.key)?.state).toBe('read');

    const rehearsalInput = {
      ...scope,
      now: new Date('2026-09-03T12:00:00.000Z'),
      rehearsalKey: rehearsalDue.weeklyRehearsal!.rehearsal.key,
      rehearsalVersion: rehearsalDue.weeklyRehearsal!.rehearsal.version,
      occurrenceVersion: rehearsalDue.weeklyRehearsal!.occurrenceVersion,
      optionKey: rehearsalDue.weeklyRehearsal!.rehearsal.saferOptionKey,
      idempotencyKey: operationKey('weekly-rehearsal-complete', 7),
    };
    const rehearsed = await repository.answerWeeklyRehearsal(rehearsalInput);
    const rehearsalRetry = await repository.answerWeeklyRehearsal({
      ...rehearsalInput,
      correlationId: 'correlation-learning-rehearsal-retry',
      now: new Date('2026-09-10T12:00:00.000Z'),
    });
    expect(rehearsed.saferChoice).toBe(true);
    expect(rehearsed.feedback.length).toBeGreaterThan(20);
    expect(rehearsed.snapshot.weeklyRehearsal).toBeNull();
    expect(rehearsed.snapshot.feed.items.some((item) => item.kind === 'weekly_rehearsal')).toBe(
      false,
    );
    expect(rehearsed.snapshot.preferences.nextRehearsalAt?.toISOString()).toBe(
      '2026-09-10T12:00:00.000Z',
    );
    expect(rehearsalRetry.snapshot.preferences.lastRehearsedAt?.toISOString()).toBe(
      '2026-09-03T12:00:00.000Z',
    );
    expect(rehearsalRetry).toMatchObject({
      saferChoice: rehearsed.saferChoice,
      feedback: rehearsed.feedback,
    });
    expect(rehearsalRetry.snapshot.weeklyRehearsal?.rehearsal.key).not.toBe(
      rehearsalInput.rehearsalKey,
    );
    const rehearsalReceipt = await database.query<
      { readonly canonical_result: unknown } & Record<string, unknown>
    >(
      `SELECT canonical_result
       FROM member_learning_operation_receipts
       WHERE household_id = 'household-sunrise'
         AND person_id = 'person-owner-alice'
         AND action_kind = 'weekly_rehearsal_complete'`,
    );
    expect(rehearsalReceipt.rows[0]?.canonical_result).toEqual({
      schemaVersion: 1,
      appliedAt: '2026-09-03T12:00:00.000Z',
      saferChoice: rehearsed.saferChoice,
      feedback: rehearsed.feedback,
    });
    expect(JSON.stringify(rehearsalReceipt.rows[0]?.canonical_result)).not.toContain(
      rehearsalInput.optionKey,
    );

    await database.query(
      `UPDATE member_learning_preferences
       SET last_rehearsed_at = $3, updated_at = $3
       WHERE household_id = $1 AND person_id = $2`,
      ['household-sunrise', 'person-owner-alice', '2026-09-24T12:00:00.000Z'],
    );
    const cycledRehearsal = await repository.getSnapshot({
      ...scope,
      now: new Date('2026-10-01T12:00:00.000Z'),
    });
    expect(cycledRehearsal.weeklyRehearsal).toMatchObject({
      rehearsal: { key: rehearsalInput.rehearsalKey },
      occurrenceVersion: rehearsalInput.occurrenceVersion + 4,
    });
    await expect(
      repository.answerWeeklyRehearsal({
        ...rehearsalInput,
        idempotencyKey: operationKey('weekly-rehearsal-complete', 8),
        now: new Date('2026-10-01T12:00:00.000Z'),
      }),
    ).rejects.toThrow('different weekly rehearsal');

    const events = await database.query<{ readonly count: number }>(
      `SELECT count(*)::integer AS count FROM audit_events
       WHERE household_id = 'household-sunrise'
         AND action LIKE 'member_learning.%'`,
    );
    expect(events.rows[0]?.count).toBe(6);
  }, 60_000);

  it('recovers legacy dismissed rehearsals and rejects new rehearsal dismissal', async () => {
    database = await createSeededTestDatabase(now);
    const repository = new MemberLearningRepository(database);
    const scope = {
      householdId: 'household-sunrise',
      personId: 'person-owner-alice',
      audience: 'customer' as const,
      correlationId: 'correlation-learning-rehearsal-dismissal',
    };
    await repository.updatePreferences({
      ...scope,
      now,
      coarseRegion: 'US',
      weeklyRehearsalEnabled: true,
      idempotencyKey: operationKey('preferences-update', 30),
    });
    const dueAt = new Date('2026-09-03T12:00:00.000Z');
    const due = await repository.getSnapshot({ ...scope, now: dueAt });
    const rehearsal = due.weeklyRehearsal;
    expect(rehearsal).not.toBeNull();
    await database.query(
      `INSERT INTO member_in_app_feed_receipts(
         household_id, person_id, item_key, item_version, state,
         read_at, dismissed_at, updated_at
       ) VALUES ($1,$2,'weekly-rehearsal',$3,'dismissed',NULL,$4,$4)`,
      [scope.householdId, scope.personId, rehearsal!.occurrenceVersion, dueAt.toISOString()],
    );

    const recovered = await repository.getSnapshot({ ...scope, now: dueAt });
    expect(recovered.weeklyRehearsal).not.toBeNull();
    expect(recovered.feed.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'weekly-rehearsal',
          version: rehearsal!.occurrenceVersion,
          state: 'unread',
        }),
      ]),
    );
    await expect(
      repository.updateFeedItem({
        ...scope,
        now: dueAt,
        itemKey: 'weekly-rehearsal',
        itemVersion: rehearsal!.occurrenceVersion,
        state: 'dismissed',
        idempotencyKey: operationKey('feed-item-update', 31),
      }),
    ).rejects.toThrow('stay available until a response is chosen');

    const read = await repository.updateFeedItem({
      ...scope,
      now: dueAt,
      itemKey: 'weekly-rehearsal',
      itemVersion: rehearsal!.occurrenceVersion,
      state: 'read',
      idempotencyKey: operationKey('feed-item-update', 32),
    });
    expect(read.feed.items.find((item) => item.key === 'weekly-rehearsal')?.state).toBe('read');
  }, 60_000);

  it('returns the committed snapshot atomically when protected access is revoked after commit', async () => {
    database = await createSeededTestDatabase(now);
    const underlying = database;
    let completedTransactions = 0;
    const revokeAfterFirstCommit: Database = {
      kind: underlying.kind,
      query: <Row extends Record<string, unknown>>(sql: string, parameters?: readonly unknown[]) =>
        underlying.query<Row>(sql, parameters),
      exec: (sql: string) => underlying.exec(sql),
      transaction: async <Result>(
        work: (transaction: SqlExecutor) => Promise<Result>,
      ): Promise<Result> => {
        const result = await underlying.transaction(work);
        completedTransactions += 1;
        if (completedTransactions === 1) {
          await withdrawAliceProtectedAccess(
            underlying,
            'protected-self-withdraw:10000000-0000-4000-8000-000000000001',
          );
        }
        return result;
      },
      close: async () => undefined,
    };
    const repository = new MemberLearningRepository(revokeAfterFirstCommit);
    const input = {
      householdId: 'household-sunrise',
      personId: 'person-owner-alice',
      lessonKey: 'pause_under_pressure' as const,
      lessonVersion: 1,
      idempotencyKey: operationKey('lesson-start', 8),
      audience: 'customer' as const,
      correlationId: 'correlation-learning-atomic-response',
      now,
    };

    const completed = await repository.startLesson(input);
    expect(completed.curriculum.lessons[0]?.progress.state).toBe('in_progress');
    expect(completedTransactions).toBe(1);
    await expect(repository.startLesson(input)).rejects.toThrow('effective protected access');

    const durableState = await underlying.query<
      { readonly progress: number; readonly audit: number; readonly outbox: number } & Record<
        string,
        unknown
      >
    >(
      `SELECT
         (SELECT count(*)::integer FROM member_learning_progress
           WHERE household_id = 'household-sunrise'
             AND person_id = 'person-owner-alice') AS progress,
         (SELECT count(*)::integer FROM audit_events
           WHERE action = 'member_learning.lesson_started'
             AND actor_person_id = 'person-owner-alice') AS audit,
         (SELECT count(*)::integer FROM outbox_events
           WHERE event_type = 'member_learning.lesson_started.v1'
             AND actor_person_id = 'person-owner-alice') AS outbox`,
    );
    expect(durableState.rows[0]).toEqual({ progress: 1, audit: 1, outbox: 1 });
  }, 60_000);

  it('serializes first use and replays one stored result without duplicate effects', async () => {
    database = await createSeededTestDatabase(now);
    const repository = new MemberLearningRepository(database);
    const idempotencyKey = operationKey('lesson-answer', 20);
    const input = {
      householdId: 'household-sunrise',
      personId: 'person-owner-alice',
      lessonKey: 'pause_under_pressure' as const,
      lessonVersion: 1,
      optionKey: 'tap_now',
      idempotencyKey,
      audience: 'customer' as const,
      correlationId: 'correlation-learning-concurrent-answer',
      now,
    };

    const [first, concurrentRetry] = await Promise.all([
      repository.answerLesson(input),
      repository.answerLesson({ ...input, correlationId: 'correlation-learning-concurrent-retry' }),
    ]);
    expect(concurrentRetry.correct).toBe(first.correct);
    expect(concurrentRetry.feedback).toBe(first.feedback);
    expect(concurrentRetry.snapshot.curriculum.lessons[0]?.progress.attemptCount).toBe(1);

    const afterConcurrent = await database.query<
      {
        readonly attempts: number;
        readonly receipts: number;
        readonly audit: number;
        readonly outbox: number;
        readonly canonical_result: unknown;
        readonly contains_customer_content: boolean;
      } & Record<string, unknown>
    >(
      `SELECT
         (SELECT attempt_count FROM member_learning_progress
           WHERE household_id = 'household-sunrise' AND person_id = 'person-owner-alice'
             AND lesson_key = 'pause_under_pressure' AND lesson_version = 1) AS attempts,
         (SELECT count(*)::integer FROM member_learning_operation_receipts
           WHERE household_id = 'household-sunrise' AND person_id = 'person-owner-alice') AS receipts,
         (SELECT count(*)::integer FROM audit_events
           WHERE action = 'member_learning.lesson_answered'
             AND actor_person_id = 'person-owner-alice') AS audit,
         (SELECT count(*)::integer FROM outbox_events
           WHERE event_type = 'member_learning.lesson_answered.v1'
             AND actor_person_id = 'person-owner-alice') AS outbox,
         receipt.canonical_result,
         receipt.contains_customer_content
       FROM member_learning_operation_receipts receipt
       WHERE receipt.household_id = 'household-sunrise'
         AND receipt.person_id = 'person-owner-alice'`,
    );
    expect(afterConcurrent.rows[0]).toMatchObject({
      attempts: 1,
      receipts: 1,
      audit: 1,
      outbox: 1,
      contains_customer_content: false,
      canonical_result: {
        schemaVersion: 1,
        appliedAt: now.toISOString(),
        correct: false,
        feedback: first.feedback,
      },
    });
    expect(JSON.stringify(afterConcurrent.rows[0]?.canonical_result)).not.toContain('tap_now');

    await expect(repository.answerLesson({ ...input, optionKey: 'pause' })).rejects.toThrow(
      'already bound to another request',
    );
    await expect(
      repository.answerLesson({
        ...input,
        householdId: 'household-harbor',
        personId: 'person-protected-olivia',
      }),
    ).rejects.toThrow('already bound to another request');
    await expect(
      repository.startLesson({
        ...input,
        idempotencyKey,
      }),
    ).rejects.toThrow('action-bound');

    const completed = await repository.answerLesson({
      ...input,
      optionKey: 'pause',
      idempotencyKey: operationKey('lesson-answer', 21),
    });
    expect(completed.correct).toBe(true);
    const lateRetry = await repository.answerLesson({
      ...input,
      correlationId: 'correlation-learning-late-retry',
    });
    expect(lateRetry).toMatchObject({
      correct: false,
      feedback: first.feedback,
    });
    expect(lateRetry.snapshot.curriculum.lessons[0]?.progress.attemptCount).toBe(2);
  }, 60_000);

  it('falls back to explicitly stale guidance and denies withdrawn protected enrollment', async () => {
    database = await createSeededTestDatabase(now);
    const repository = new MemberLearningRepository(database);
    const stale = await repository.getSnapshot({
      householdId: 'household-sunrise',
      personId: 'person-owner-alice',
      now: new Date('2026-11-25T12:00:00.000Z'),
    });
    expect(stale.guidance.state).toBe('stale');
    expect(stale.guidance.briefs[0]).toMatchObject({ freshness: 'stale' });
    expect(stale.guidance.staleMessage).toContain('passed its review window');

    await withdrawAliceProtectedAccess(
      database,
      'protected-self-withdraw:20000000-0000-4000-8000-000000000002',
    );
    await expect(
      repository.getSnapshot({
        householdId: 'household-sunrise',
        personId: 'person-owner-alice',
        now,
      }),
    ).rejects.toThrow('effective protected access');
  }, 60_000);

  it('resolves each reviewed regional brief before the national brief', async () => {
    const regionalNow = new Date('2026-08-28T12:00:00.000Z');
    database = await createSeededTestDatabase(regionalNow);
    const repository = new MemberLearningRepository(database);
    const expected = [
      ['US-AZ', 'az-crypto-atm-payment-demand'],
      ['US-IL', 'il-fake-traffic-toll-text'],
      ['US-NY', 'ny-gold-bar-account-emergency'],
      ['US-PA', 'pa-cash-courier-emergency'],
    ] as const;

    for (const [index, [coarseRegion, briefKey]] of expected.entries()) {
      const snapshot = await repository.updatePreferences({
        householdId: 'household-sunrise',
        personId: 'person-owner-alice',
        audience: 'customer',
        correlationId: `correlation-learning-regional-${index + 1}`,
        now: regionalNow,
        coarseRegion,
        weeklyRehearsalEnabled: false,
        idempotencyKey: operationKey('preferences-update', 30 + index),
      });

      expect(snapshot.guidance).toMatchObject({
        requestedRegion: coarseRegion,
        resolvedRegion: coarseRegion,
        state: 'current',
      });
      expect(snapshot.guidance.briefs.map((brief) => [brief.region, brief.key])).toEqual([
        [coarseRegion, briefKey],
        ['US', 'us-imposter-scam-trends'],
      ]);
      expect(snapshot.guidance.briefs[0]?.safeActions).toHaveLength(4);
      expect(snapshot.guidance.briefs[0]?.source.url).toMatch(/^https:\/\//u);
    }
  }, 60_000);

  it('denies neutral, cross-household, capability-lost, and entitlement-lost direct callers without side effects', async () => {
    database = await createSeededTestDatabase(now);
    const repository = new MemberLearningRepository(database);
    const neutralScope = {
      householdId: 'household-harbor',
      personId: 'person-owner-bob',
      audience: 'customer' as const,
      correlationId: 'correlation-learning-neutral-denied',
      now,
    };

    await expect(repository.getSnapshot(neutralScope)).rejects.toThrow(
      'effective protected access',
    );
    await expect(
      repository.startLesson({
        ...neutralScope,
        lessonKey: 'pause_under_pressure',
        lessonVersion: 1,
        idempotencyKey: operationKey('lesson-start', 9),
      }),
    ).rejects.toThrow('effective protected access');
    await expect(
      repository.getSnapshot({
        householdId: 'household-harbor',
        personId: 'person-owner-alice',
        now,
      }),
    ).rejects.toThrow('effective protected access');

    await database.query(
      `UPDATE entitlement_grants SET capabilities = '[]'::jsonb
       WHERE household_id = 'household-sunrise' AND id = 'grant-local-sunrise'`,
    );
    await expect(
      repository.startLesson({
        householdId: 'household-sunrise',
        personId: 'person-owner-alice',
        lessonKey: 'pause_under_pressure',
        lessonVersion: 1,
        audience: 'customer',
        idempotencyKey: operationKey('lesson-start', 10),
        correlationId: 'correlation-learning-capability-lost',
        now,
      }),
    ).rejects.toThrow('effective protected access');

    await database.query(
      `UPDATE entitlement_grants SET ends_at = $1
       WHERE household_id = 'household-harbor' AND id = 'grant-local-harbor'`,
      [now.toISOString()],
    );
    await expect(
      repository.startLesson({
        householdId: 'household-harbor',
        personId: 'person-protected-olivia',
        lessonKey: 'pause_under_pressure',
        lessonVersion: 1,
        audience: 'customer',
        idempotencyKey: operationKey('lesson-start', 11),
        correlationId: 'correlation-learning-entitlement-lost',
        now,
      }),
    ).rejects.toThrow('effective protected access');

    const sideEffects = await database.query<
      { readonly progress: number; readonly audit: number; readonly outbox: number } & Record<
        string,
        unknown
      >
    >(
      `SELECT
         (SELECT count(*)::integer FROM member_learning_progress) AS progress,
         (SELECT count(*)::integer FROM audit_events
           WHERE action LIKE 'member_learning.%') AS audit,
         (SELECT count(*)::integer FROM outbox_events
           WHERE event_type LIKE 'member_learning.%') AS outbox`,
    );
    expect(sideEffects.rows[0]).toEqual({ progress: 0, audit: 0, outbox: 0 });
  }, 60_000);
});

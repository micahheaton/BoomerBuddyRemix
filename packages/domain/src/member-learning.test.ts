import { describe, expect, it } from 'vitest';

import {
  answerMemberLearningLesson,
  currentMemberLearningLesson,
  memberLearningDisplayState,
  isMemberLearningCoarseRegion,
  memberLearningLessons,
  memberLearningReviewIntervalMs,
  nextWeeklyRehearsalAt,
  weeklyRehearsalIntervalMs,
} from './member-learning';

const now = new Date('2026-08-27T12:00:00.000Z');

describe('member learning curriculum', () => {
  it('keeps a seven-lesson, versioned, source-linked scenario curriculum', () => {
    expect(memberLearningLessons).toHaveLength(7);
    expect(new Set(memberLearningLessons.map((lesson) => lesson.key)).size).toBe(7);
    expect(memberLearningLessons.map((lesson) => lesson.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const lesson of memberLearningLessons) {
      expect(lesson.version).toBe(1);
      expect(lesson.estimatedMinutes).toBeGreaterThanOrEqual(3);
      expect(lesson.estimatedMinutes).toBeLessThanOrEqual(5);
      expect(lesson.options).toHaveLength(3);
      expect(lesson.options.some((option) => option.key === lesson.correctOptionKey)).toBe(true);
      expect(lesson.sources.every((source) => source.url.startsWith('https://'))).toBe(true);
    }
  });

  it('records wrong attempts, completion, and a durable review window', () => {
    const lesson = currentMemberLearningLesson('pause_under_pressure', 1);
    const wrong = answerMemberLearningLesson({
      lesson,
      optionKey: 'tap_now',
      now,
    });
    expect(wrong.correct).toBe(false);
    expect(wrong.progress).toMatchObject({
      state: 'in_progress',
      attemptCount: 1,
      reviewCount: 0,
      lastAnswerCorrect: false,
    });
    expect(memberLearningDisplayState(wrong.progress, now)).toBe('in_progress');

    const completedAt = new Date(now.getTime() + 60_000);
    const completed = answerMemberLearningLesson({
      lesson,
      progress: wrong.progress,
      optionKey: 'pause',
      now: completedAt,
    });
    expect(completed.correct).toBe(true);
    expect(completed.progress).toMatchObject({
      state: 'completed',
      attemptCount: 2,
      reviewCount: 0,
      lastAnswerCorrect: true,
    });
    expect(completed.progress.reviewDueAt?.getTime()).toBe(
      completedAt.getTime() + memberLearningReviewIntervalMs,
    );
    expect(memberLearningDisplayState(completed.progress, completedAt)).toBe('completed');
    expect(
      memberLearningDisplayState(
        completed.progress,
        new Date(completedAt.getTime() + memberLearningReviewIntervalMs),
      ),
    ).toBe('review_due');
  });

  it('rejects stale lesson versions and unknown answer keys', () => {
    expect(() => currentMemberLearningLesson('pause_under_pressure', 2)).toThrow(
      'newer lesson version',
    );
    const lesson = currentMemberLearningLesson('pause_under_pressure');
    expect(() => answerMemberLearningLesson({ lesson, optionKey: 'forged_option', now })).toThrow(
      'available lesson response',
    );
  });

  it('schedules an opted-in rehearsal seven days after the latest valid anchor', () => {
    expect(nextWeeklyRehearsalAt({})).toBeUndefined();
    expect(nextWeeklyRehearsalAt({ enabledAt: now })?.getTime()).toBe(
      now.getTime() + weeklyRehearsalIntervalMs,
    );
    const rehearsed = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1_000);
    expect(nextWeeklyRehearsalAt({ enabledAt: now, lastRehearsedAt: rehearsed })?.getTime()).toBe(
      rehearsed.getTime() + weeklyRehearsalIntervalMs,
    );
  });

  it('accepts only the shared national, state, and District of Columbia region set', () => {
    expect(isMemberLearningCoarseRegion('US')).toBe(true);
    expect(isMemberLearningCoarseRegion('US-CA')).toBe(true);
    expect(isMemberLearningCoarseRegion('US-DC')).toBe(true);
    expect(isMemberLearningCoarseRegion('US-ZZ')).toBe(false);
    expect(isMemberLearningCoarseRegion('94107')).toBe(false);
  });
});

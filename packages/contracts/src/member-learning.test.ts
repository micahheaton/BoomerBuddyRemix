import { describe, expect, it } from 'vitest';

import {
  answerMemberLearningLessonRequestSchema,
  answerWeeklyRehearsalRequestSchema,
  memberLearningCoarseRegionSchema,
  memberLearningLessonSchema,
  memberWeeklyRehearsalSchema,
  updateMemberLearningFeedItemRequestSchema,
  updateMemberLearningPreferencesRequestSchema,
} from './member-learning';

describe('member learning contracts', () => {
  it('accepts only version-bound, enumerated lesson answers without caller identity', () => {
    expect(
      answerMemberLearningLessonRequestSchema.parse({
        lessonVersion: 1,
        optionKey: 'pause',
      }),
    ).toEqual({ lessonVersion: 1, optionKey: 'pause' });
    for (const forbidden of ['personId', 'householdId', 'email', 'answerText']) {
      expect(() =>
        answerMemberLearningLessonRequestSchema.parse({
          lessonVersion: 1,
          optionKey: 'pause',
          [forbidden]: 'forbidden',
        }),
      ).toThrow();
    }
  });

  it('allows only national or coarse state guidance choices', () => {
    expect(memberLearningCoarseRegionSchema.parse('US')).toBe('US');
    expect(memberLearningCoarseRegionSchema.parse('US-CA')).toBe('US-CA');
    for (const preciseOrForeign of [
      '94107',
      'US-CA-San-Francisco',
      '37.7749,-122.4194',
      'CA',
      'US-ZZ',
      'GB-LND',
    ]) {
      expect(() => memberLearningCoarseRegionSchema.parse(preciseOrForeign)).toThrow();
    }
    expect(() =>
      updateMemberLearningPreferencesRequestSchema.parse({
        coarseRegion: 'US-CA',
        weeklyRehearsalEnabled: true,
        address: 'forbidden',
      }),
    ).toThrow();
  });

  it('never exposes the lesson answer key through the response contract', () => {
    const parsed = memberLearningLessonSchema.parse({
      key: 'pause_under_pressure',
      version: 1,
      order: 1,
      title: 'Pause first',
      objective: 'Practice a reversible pause.',
      estimatedMinutes: 3,
      scenario: 'An urgent message asks you to act. What do you do?',
      options: [
        { key: 'act', label: 'Act now' },
        { key: 'pause', label: 'Pause and verify' },
      ],
      correctOptionKey: 'pause',
      takeaway: 'Urgency is a reason to slow down.',
      sources: [{ title: 'Official source', url: 'https://example.gov/safety' }],
      progress: {
        state: 'not_started',
        attemptCount: 0,
        reviewCount: 0,
        priorVersionCompleted: false,
      },
    });
    expect(parsed).not.toHaveProperty('correctOptionKey');
  });

  it('binds feed receipts to a derived item version and closed state vocabulary', () => {
    expect(
      updateMemberLearningFeedItemRequestSchema.parse({ itemVersion: 1, state: 'read' }),
    ).toEqual({ itemVersion: 1, state: 'read' });
    expect(() =>
      updateMemberLearningFeedItemRequestSchema.parse({ itemVersion: 1, state: 'sent' }),
    ).toThrow();
    expect(() =>
      updateMemberLearningFeedItemRequestSchema.parse({
        itemVersion: 1,
        state: 'read',
        destination: 'forbidden',
      }),
    ).toThrow();
  });

  it('requires a version-bound weekly scenario choice without accepting customer content', () => {
    expect(
      answerWeeklyRehearsalRequestSchema.parse({
        rehearsalKey: 'bank_alert_callback',
        rehearsalVersion: 1,
        occurrenceVersion: 2_955,
        optionKey: 'use_official_bank_channel',
      }),
    ).toEqual({
      rehearsalKey: 'bank_alert_callback',
      rehearsalVersion: 1,
      occurrenceVersion: 2_955,
      optionKey: 'use_official_bank_channel',
    });
    for (const forbidden of ['complete', 'answerText', 'personId', 'householdId']) {
      expect(() =>
        answerWeeklyRehearsalRequestSchema.parse({
          rehearsalKey: 'bank_alert_callback',
          rehearsalVersion: 1,
          occurrenceVersion: 2_955,
          optionKey: 'use_official_bank_channel',
          [forbidden]: forbidden === 'complete' ? true : 'forbidden',
        }),
      ).toThrow();
    }
    expect(() =>
      answerWeeklyRehearsalRequestSchema.parse({
        rehearsalKey: 'bank_alert_callback',
        rehearsalVersion: 1,
        optionKey: 'use_official_bank_channel',
      }),
    ).toThrow();
  });

  it('does not expose a weekly rehearsal answer key through the response contract', () => {
    const parsed = memberWeeklyRehearsalSchema.parse({
      key: 'bank_alert_callback',
      version: 1,
      occurrenceVersion: 10,
      title: 'A bank alert asks you to act now',
      estimatedMinutes: 2,
      scenario: 'A message says your account is locked.',
      prompt: 'What is the safest first action?',
      options: [
        { key: 'open_message_link', label: 'Open the link' },
        { key: 'use_official_bank_channel', label: 'Use the official bank channel' },
      ],
      saferOptionKey: 'use_official_bank_channel',
      takeaway: 'Verify independently.',
      source: { title: 'Official source', url: 'https://example.gov/scams' },
      reviewedAt: '2026-08-28T12:00:00.000Z',
      dueAt: '2026-09-03T12:00:00.000Z',
    });
    expect(parsed).not.toHaveProperty('saferOptionKey');
  });
});

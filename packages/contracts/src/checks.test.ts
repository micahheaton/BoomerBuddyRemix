import { describe, expect, it } from 'vitest';
import {
  checkAnalysisDispositionSchema,
  checkShareLifecycleSchema,
  closeCheckShareRequestSchema,
  createCheckRequestSchema,
  shareCheckResponseSchema,
} from './checks';

const sharedAt = '2026-08-27T12:00:00.000Z';

describe('Check share lifecycle contracts', () => {
  it('requires monotonic evidence for each lifecycle state', () => {
    const base = {
      checkId: 'analysis-test-share',
      sharedWithPersonId: 'person-test-helper',
      sharedWithDisplayName: 'Test Helper',
      sharedAt,
    };
    expect(checkShareLifecycleSchema.parse({ ...base, state: 'shared' })).toMatchObject({
      state: 'shared',
    });
    expect(
      checkShareLifecycleSchema.parse({
        ...base,
        state: 'acknowledged',
        acknowledgedAt: '2026-08-27T12:01:00.000Z',
      }),
    ).toMatchObject({ state: 'acknowledged' });
    expect(
      checkShareLifecycleSchema.parse({
        ...base,
        state: 'closed',
        acknowledgedAt: '2026-08-27T12:01:00.000Z',
        closedAt: '2026-08-27T12:02:00.000Z',
        closureReason: 'safer_action_completed',
      }),
    ).toMatchObject({ state: 'closed' });
    expect(checkShareLifecycleSchema.safeParse({ ...base, state: 'acknowledged' }).success).toBe(
      false,
    );
    expect(
      checkShareLifecycleSchema.safeParse({
        ...base,
        state: 'closed',
        acknowledgedAt: '2026-08-27T12:01:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('keeps closure reasons bounded and includes lifecycle in share responses', () => {
    expect(closeCheckShareRequestSchema.safeParse({ resolution: 'fraud_prevented' }).success).toBe(
      false,
    );
    expect(
      shareCheckResponseSchema.parse({
        checkId: 'analysis-test-share',
        sharedWithPersonId: 'person-test-helper',
        state: 'active',
        lifecycle: {
          checkId: 'analysis-test-share',
          sharedWithPersonId: 'person-test-helper',
          sharedWithDisplayName: 'Test Helper',
          state: 'shared',
          sharedAt,
        },
      }).lifecycle.state,
    ).toBe('shared');
  });
});

describe('Check freshness contracts', () => {
  it('keeps refresh optional on the wire and defaults it after parsing', () => {
    expect(createCheckRequestSchema.parse({ kind: 'url', content: 'example.com' })).toEqual({
      kind: 'url',
      content: 'example.com',
      refresh: false,
    });
  });

  it('binds reuse state to its source and a forward freshness deadline', () => {
    const analyzedAt = '2026-08-15T12:00:00.000Z';
    const refreshAfter = '2026-08-16T12:00:00.000Z';
    expect(
      checkAnalysisDispositionSchema.parse({
        source: 'recent_owned',
        reused: true,
        analyzedAt,
        refreshAfter,
      }),
    ).toMatchObject({ source: 'recent_owned', reused: true });
    expect(
      checkAnalysisDispositionSchema.parse({
        source: 'new',
        reused: false,
        analyzedAt,
        refreshAfter: null,
      }),
    ).toMatchObject({ source: 'new', reused: false, refreshAfter: null });

    expect(() =>
      checkAnalysisDispositionSchema.parse({
        source: 'recent_owned',
        reused: false,
        analyzedAt,
        refreshAfter,
      }),
    ).toThrow();
    expect(() =>
      checkAnalysisDispositionSchema.parse({
        source: 'recent_owned',
        reused: true,
        analyzedAt,
        refreshAfter: analyzedAt,
      }),
    ).toThrow();
  });
});

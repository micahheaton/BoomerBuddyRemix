import { describe, expect, it } from 'vitest';
import {
  checkShareLifecycleSchema,
  closeCheckShareRequestSchema,
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

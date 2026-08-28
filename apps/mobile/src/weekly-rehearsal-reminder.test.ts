import { describe, expect, it } from 'vitest';
import {
  disableWeeklyRehearsalReminder,
  enableWeeklyRehearsalReminder,
  prepareWeeklyReminderBoundary,
  readWeeklyReminderState,
  weeklyReminderPermissionIsGranted,
  type WeeklyReminderGateway,
} from './weekly-rehearsal-reminder';

function fakeGateway(input?: {
  readonly granted?: boolean;
  readonly canAskAgain?: boolean;
  readonly requestedGranted?: boolean;
  readonly iosStatus?: number;
}) {
  const calls: string[] = [];
  const scheduled = [
    { identifier: 'ours', content: { data: { kind: 'weekly_rehearsal' } } },
    { identifier: 'someone-else', content: { data: { kind: 'different' } } },
  ];
  const gateway: WeeklyReminderGateway = {
    platform: 'android',
    disableRemoteRegistration: () => {
      calls.push('remote-disabled');
      return Promise.resolve();
    },
    configureForegroundPresentation: () => calls.push('foreground-configured'),
    ensureQuietChannel: () => {
      calls.push('quiet-channel');
      return Promise.resolve();
    },
    getPermissions: () => {
      calls.push('permission-read');
      return Promise.resolve({
        granted: input?.granted ?? true,
        canAskAgain: input?.canAskAgain ?? true,
        ...(input?.iosStatus === undefined ? {} : { ios: { status: input.iosStatus } }),
      });
    },
    requestPermissions: () => {
      calls.push('permission-requested');
      return Promise.resolve({
        granted: input?.requestedGranted ?? false,
        canAskAgain: false,
      });
    },
    listScheduled: () => {
      calls.push('scheduled-read');
      return Promise.resolve(scheduled);
    },
    cancelScheduled: (identifier) => {
      calls.push(`cancel:${identifier}`);
      return Promise.resolve();
    },
    scheduleWeekly: () => {
      calls.push('scheduled-weekly');
      return Promise.resolve('new-reminder');
    },
  };
  return { calls, gateway };
}

describe('mobile weekly rehearsal reminder boundary', () => {
  it('treats authorized, provisional, and ephemeral iOS permission as granted', () => {
    expect(weeklyReminderPermissionIsGranted({ granted: true, canAskAgain: false })).toBe(true);
    for (const status of [2, 3, 4]) {
      expect(
        weeklyReminderPermissionIsGranted({
          granted: false,
          canAskAgain: false,
          ios: { status },
        }),
      ).toBe(true);
    }
    expect(
      weeklyReminderPermissionIsGranted({
        granted: false,
        canAskAgain: true,
        ios: { status: 1 },
      }),
    ).toBe(false);
  });

  it('disables remote registration before configuring local presentation', async () => {
    const { calls, gateway } = fakeGateway();
    await prepareWeeklyReminderBoundary(gateway);
    expect(calls).toEqual(['remote-disabled', 'foreground-configured']);
  });

  it('replaces only its own marker and schedules after permission', async () => {
    const { calls, gateway } = fakeGateway();
    const state = await enableWeeklyRehearsalReminder(gateway);
    expect(state.state).toBe('scheduled');
    expect(calls).toContain('remote-disabled');
    expect(calls).toContain('quiet-channel');
    expect(calls).not.toContain('permission-requested');
    expect(calls).toContain('cancel:ours');
    expect(calls).not.toContain('cancel:someone-else');
    expect(calls.at(-1)).toBe('scheduled-weekly');
  });

  it('does not schedule after permission denial and removes an old marker', async () => {
    const { calls, gateway } = fakeGateway({
      granted: false,
      canAskAgain: true,
      requestedGranted: false,
    });
    const state = await enableWeeklyRehearsalReminder(gateway);
    expect(state).toEqual({
      state: 'permission_denied',
      deviceProof: 'pending',
      canAskAgain: false,
    });
    expect(calls).toContain('permission-requested');
    expect(calls).toContain('cancel:ours');
    expect(calls).not.toContain('scheduled-weekly');
  });

  it('cancels only the generic weekly marker when disabled', async () => {
    const { calls, gateway } = fakeGateway();
    const state = await disableWeeklyRehearsalReminder(gateway);
    expect(state.state).toBe('not_scheduled');
    expect(calls).toContain('cancel:ours');
    expect(calls).not.toContain('cancel:someone-else');
  });

  it('reports an existing schedule without prompting', async () => {
    const { calls, gateway } = fakeGateway({
      granted: false,
      canAskAgain: false,
      iosStatus: 3,
    });
    const state = await readWeeklyReminderState(gateway);
    expect(state.state).toBe('scheduled');
    expect(calls).not.toContain('permission-requested');
  });
});

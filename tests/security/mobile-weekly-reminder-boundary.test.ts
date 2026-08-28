import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const source = (path: string): string => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('mobile weekly rehearsal reminder boundary', () => {
  it('pins the Expo SDK 57-compatible local notification package and disables remote background mode', () => {
    const mobilePackage = JSON.parse(source('apps/mobile/package.json')) as {
      dependencies: Record<string, string>;
    };
    const app = JSON.parse(source('apps/mobile/app.json')) as {
      expo: { plugins: Array<string | [string, Record<string, unknown>]> };
    };

    expect(mobilePackage.dependencies['expo-notifications']).toBe('~57.0.14');
    expect(app.expo.plugins).toContainEqual([
      'expo-notifications',
      { color: '#255B57', enableBackgroundRemoteNotifications: false },
    ]);
  });

  it('uses marker-scoped, quiet, generic local reminders without push tokens or exact alarms', () => {
    const reminder = source('apps/mobile/src/weekly-rehearsal-reminder.ts');
    const app = source('apps/mobile/App.tsx');
    const household = source('apps/mobile/src/household.tsx');

    expect(reminder).toContain("weeklyRehearsalReminderMarker = 'weekly_rehearsal'");
    expect(reminder).toContain("title: 'A quick safety practice is ready'");
    expect(reminder).toContain("body: 'Open BoomerBuddy when you are ready.'");
    expect(reminder).toContain('data: { kind: weeklyRehearsalReminderMarker }');
    expect(reminder).toContain('sound: false');
    expect(reminder).toContain('AndroidImportance.LOW');
    expect(reminder).toContain('setAutoServerRegistrationEnabledAsync(false)');
    expect(reminder).toContain('.filter(isWeeklyRehearsalReminder)');
    expect(reminder).toContain('SchedulableTriggerInputTypes.TIME_INTERVAL');
    expect(reminder).not.toContain('getExpoPushTokenAsync');
    expect(reminder).not.toContain('getDevicePushTokenAsync');
    expect(reminder).not.toContain('SCHEDULE_EXACT_ALARM');
    expect(reminder).not.toContain('registerTaskAsync');
    expect(reminder).not.toContain('remote-notification');
    expect(app).toContain('await disableWeeklyRehearsalReminder();');
    expect(household).toContain('previousSelectedHouseholdId.current === selectedHouseholdId');
    expect(household).toContain('void disableWeeklyRehearsalReminder();');
  });
});

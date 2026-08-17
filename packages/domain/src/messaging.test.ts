import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  evaluateLocalMessagingEligibility,
  messagingFrequencyLimits,
  messagingTemplates,
} from './messaging';

const zeroCounts = {
  purposeDaily: 0,
  purposeWeekly: 0,
  globalDaily: 0,
  globalWeekly: 0,
};

describe('provider-free messaging policy', () => {
  it('allows only a code-owned purpose-matched template in the conservative local window', () => {
    expect(
      evaluateLocalMessagingEligibility({
        at: new Date('2026-08-15T19:00:00.000Z'),
        counts: zeroCounts,
        globalStop: false,
        purpose: 'account_service',
        templateKey: 'account.service.v1',
        timeZone: 'America/Los_Angeles',
      }),
    ).toEqual({
      allowed: true,
      dailyWindowKey: '2026-08-15',
      weeklyWindowKey: '2026-W33',
      policyVersion: 'messaging-local-safety-v1',
      quietHoursPolicyVersion: 'messaging-local-quiet-hours-v1',
    });
    expect(
      evaluateLocalMessagingEligibility({
        at: new Date('2026-08-15T19:00:00.000Z'),
        counts: zeroCounts,
        globalStop: false,
        purpose: 'fraud_safety',
        templateKey: 'account.service.v1',
        timeZone: 'America/Los_Angeles',
      }),
    ).toEqual({ allowed: false, reason: 'wrong_template' });
  });

  it('fails closed for stop, unknown timezone, quiet hours, and each cumulative limit', () => {
    const base = {
      at: new Date('2026-08-15T19:00:00.000Z'),
      counts: zeroCounts,
      globalStop: false,
      purpose: 'account_service' as const,
      templateKey: 'account.service.v1' as const,
      timeZone: 'America/Los_Angeles',
    };
    expect(evaluateLocalMessagingEligibility({ ...base, globalStop: true })).toEqual({
      allowed: false,
      reason: 'global_stop',
    });
    expect(
      evaluateLocalMessagingEligibility({
        at: base.at,
        counts: base.counts,
        globalStop: base.globalStop,
        purpose: base.purpose,
        templateKey: base.templateKey,
      }),
    ).toEqual({
      allowed: false,
      reason: 'timezone_unknown',
    });
    expect(
      evaluateLocalMessagingEligibility({
        ...base,
        at: new Date('2026-08-15T15:59:59.000Z'),
      }),
    ).toEqual({ allowed: false, reason: 'quiet_hours' });
    for (const [field, reason] of [
      ['purposeDaily', 'purpose_daily_limit'],
      ['purposeWeekly', 'purpose_weekly_limit'],
      ['globalDaily', 'global_daily_limit'],
      ['globalWeekly', 'global_weekly_limit'],
    ] as const) {
      expect(
        evaluateLocalMessagingEligibility({
          ...base,
          counts: { ...zeroCounts, [field]: messagingFrequencyLimits.account_service[field] },
        }),
      ).toEqual({ allowed: false, reason });
    }
  });

  it('keeps every local template fixed, non-urgent, identified, and opt-out aware', () => {
    for (const [key, value] of Object.entries(messagingTemplates)) {
      expect(value.key).toBe(key);
      expect(value.version).toBe(1);
      expect(value.urgency).toBe('non_urgent');
      expect(value.content).toContain('BoomerBuddy');
      expect(value.content).toContain('STOP');
      expect(value.content).toContain('HELP');
      expect(value.digest).toMatch(/^[a-f0-9]{64}$/u);
      expect(value.digest).toBe(createHash('sha256').update(value.content, 'utf8').digest('hex'));
    }
  });
});

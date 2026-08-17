export const messagingPurposes = ['customer_care', 'account_service', 'fraud_safety'] as const;
export type MessagingPurpose = (typeof messagingPurposes)[number];

export const messagingEvidenceTier = 'local_simulation' as const;
export const messagingChannel = 'sms' as const;
export const messagingFrequencyPolicyVersion = 'messaging-local-safety-v1' as const;
export const messagingQuietHoursPolicyVersion = 'messaging-local-quiet-hours-v1' as const;

export interface MessagingTemplate {
  readonly key: string;
  readonly version: 1;
  readonly purpose: MessagingPurpose;
  readonly urgency: 'non_urgent';
  readonly content: string;
  readonly digest: string;
}

function template(
  key: string,
  purpose: MessagingPurpose,
  content: string,
  digest: string,
): MessagingTemplate {
  return {
    key,
    version: 1,
    purpose,
    urgency: 'non_urgent',
    content,
    digest,
  };
}

export const messagingTemplates = {
  'account.service.v1': template(
    'account.service.v1',
    'account_service',
    'BoomerBuddy account notice. Open BoomerBuddy directly to review it. Reply STOP to stop texts or HELP for help.',
    '1336eaa9d740008631e8aa4806e3dfd28398a811f25e471e040aa25c853a3362',
  ),
  'customer_care.help.v1': template(
    'customer_care.help.v1',
    'customer_care',
    'BoomerBuddy support. Open BoomerBuddy directly for account help. Reply STOP to stop texts or HELP for help.',
    'aa9ba67475045dacd608bd5c3c1b79aac388fabd81582e669402de5286536c70',
  ),
  'customer_care.reply.v1': template(
    'customer_care.reply.v1',
    'customer_care',
    'BoomerBuddy support has an update. Open BoomerBuddy directly to review it. Reply STOP to stop texts or HELP for help.',
    'dcda873e974d760ebf17934b15290838acfda5c99535315646d21fa1f469f372',
  ),
  'fraud_safety.pause_verify.v1': template(
    'fraud_safety.pause_verify.v1',
    'fraud_safety',
    'BoomerBuddy safety reminder: pause contact and verify through an official channel you find independently. Reply STOP to stop texts or HELP for help.',
    'adb7fd81c5e6bd97881b9f06999f27cff5728163c54e220499d5354f72054725',
  ),
} as const satisfies Readonly<Record<string, MessagingTemplate>>;

export type MessagingTemplateKey = keyof typeof messagingTemplates;

export interface MessagingFrequencyLimits {
  readonly purposeDaily: number;
  readonly purposeWeekly: number;
  readonly globalDaily: number;
  readonly globalWeekly: number;
}

export const messagingFrequencyLimits: Readonly<
  Record<MessagingPurpose, MessagingFrequencyLimits>
> = {
  customer_care: {
    purposeDaily: 4,
    purposeWeekly: 12,
    globalDaily: 5,
    globalWeekly: 15,
  },
  account_service: {
    purposeDaily: 2,
    purposeWeekly: 5,
    globalDaily: 5,
    globalWeekly: 15,
  },
  fraud_safety: {
    purposeDaily: 2,
    purposeWeekly: 5,
    globalDaily: 5,
    globalWeekly: 15,
  },
};

export interface MessagingFrequencyCounts {
  readonly purposeDaily: number;
  readonly purposeWeekly: number;
  readonly globalDaily: number;
  readonly globalWeekly: number;
}

export type MessagingEligibilityDenial =
  | 'global_stop'
  | 'timezone_unknown'
  | 'quiet_hours'
  | 'wrong_template'
  | 'purpose_daily_limit'
  | 'purpose_weekly_limit'
  | 'global_daily_limit'
  | 'global_weekly_limit';

export type MessagingEligibility =
  | {
      readonly allowed: true;
      readonly dailyWindowKey: string;
      readonly weeklyWindowKey: string;
      readonly policyVersion: typeof messagingFrequencyPolicyVersion;
      readonly quietHoursPolicyVersion: typeof messagingQuietHoursPolicyVersion;
    }
  | { readonly allowed: false; readonly reason: MessagingEligibilityDenial };

interface LocalParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
}

function localParts(at: Date, timeZone: string): LocalParts | undefined {
  if (
    !Number.isFinite(at.getTime()) ||
    timeZone.length < 1 ||
    timeZone.length > 80 ||
    !/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)*$/u.test(timeZone)
  ) {
    return undefined;
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
    const value = (type: Intl.DateTimeFormatPartTypes): number | undefined => {
      const part = parts.find((candidate) => candidate.type === type)?.value;
      if (part === undefined || !/^\d+$/u.test(part)) return undefined;
      return Number(part);
    };
    const year = value('year');
    const month = value('month');
    const day = value('day');
    const hour = value('hour');
    if (year === undefined || month === undefined || day === undefined || hour === undefined) {
      return undefined;
    }
    return { year, month, day, hour };
  } catch {
    return undefined;
  }
}

function isoWeekKey(parts: LocalParts): string {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const weekYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${String(weekYear).padStart(4, '0')}-W${String(week).padStart(2, '0')}`;
}

function countsAreValid(counts: MessagingFrequencyCounts): boolean {
  return Object.values(counts).every((count) => Number.isSafeInteger(count) && count >= 0);
}

export function evaluateLocalMessagingEligibility(input: {
  readonly at: Date;
  readonly counts: MessagingFrequencyCounts;
  readonly globalStop: boolean;
  readonly purpose: MessagingPurpose;
  readonly templateKey: MessagingTemplateKey;
  readonly timeZone?: string;
}): MessagingEligibility {
  if (input.globalStop) return { allowed: false, reason: 'global_stop' };
  const definition = messagingTemplates[input.templateKey];
  if (definition.purpose !== input.purpose) return { allowed: false, reason: 'wrong_template' };
  const parts = input.timeZone === undefined ? undefined : localParts(input.at, input.timeZone);
  if (parts === undefined) return { allowed: false, reason: 'timezone_unknown' };
  if (parts.hour < 9 || parts.hour >= 20) return { allowed: false, reason: 'quiet_hours' };
  if (!countsAreValid(input.counts)) throw new TypeError('Messaging frequency counts are invalid');
  const limits = messagingFrequencyLimits[input.purpose];
  if (input.counts.purposeDaily >= limits.purposeDaily) {
    return { allowed: false, reason: 'purpose_daily_limit' };
  }
  if (input.counts.purposeWeekly >= limits.purposeWeekly) {
    return { allowed: false, reason: 'purpose_weekly_limit' };
  }
  if (input.counts.globalDaily >= limits.globalDaily) {
    return { allowed: false, reason: 'global_daily_limit' };
  }
  if (input.counts.globalWeekly >= limits.globalWeekly) {
    return { allowed: false, reason: 'global_weekly_limit' };
  }
  const dailyWindowKey = `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  return {
    allowed: true,
    dailyWindowKey,
    weeklyWindowKey: isoWeekKey(parts),
    policyVersion: messagingFrequencyPolicyVersion,
    quietHoursPolicyVersion: messagingQuietHoursPolicyVersion,
  };
}

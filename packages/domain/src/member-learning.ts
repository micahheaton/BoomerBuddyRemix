import { DomainError } from './errors';

export const memberLearningCoarseRegionCodes = [
  'US',
  'US-AL',
  'US-AK',
  'US-AZ',
  'US-AR',
  'US-CA',
  'US-CO',
  'US-CT',
  'US-DE',
  'US-DC',
  'US-FL',
  'US-GA',
  'US-HI',
  'US-ID',
  'US-IL',
  'US-IN',
  'US-IA',
  'US-KS',
  'US-KY',
  'US-LA',
  'US-ME',
  'US-MD',
  'US-MA',
  'US-MI',
  'US-MN',
  'US-MS',
  'US-MO',
  'US-MT',
  'US-NE',
  'US-NV',
  'US-NH',
  'US-NJ',
  'US-NM',
  'US-NY',
  'US-NC',
  'US-ND',
  'US-OH',
  'US-OK',
  'US-OR',
  'US-PA',
  'US-RI',
  'US-SC',
  'US-SD',
  'US-TN',
  'US-TX',
  'US-UT',
  'US-VT',
  'US-VA',
  'US-WA',
  'US-WV',
  'US-WI',
  'US-WY',
] as const;

export type MemberLearningCoarseRegion = (typeof memberLearningCoarseRegionCodes)[number];

export const memberLearningCoarseRegionLabels: Readonly<
  Record<MemberLearningCoarseRegion, string>
> = {
  US: 'United States',
  'US-AL': 'Alabama',
  'US-AK': 'Alaska',
  'US-AZ': 'Arizona',
  'US-AR': 'Arkansas',
  'US-CA': 'California',
  'US-CO': 'Colorado',
  'US-CT': 'Connecticut',
  'US-DE': 'Delaware',
  'US-DC': 'District of Columbia',
  'US-FL': 'Florida',
  'US-GA': 'Georgia',
  'US-HI': 'Hawaii',
  'US-ID': 'Idaho',
  'US-IL': 'Illinois',
  'US-IN': 'Indiana',
  'US-IA': 'Iowa',
  'US-KS': 'Kansas',
  'US-KY': 'Kentucky',
  'US-LA': 'Louisiana',
  'US-ME': 'Maine',
  'US-MD': 'Maryland',
  'US-MA': 'Massachusetts',
  'US-MI': 'Michigan',
  'US-MN': 'Minnesota',
  'US-MS': 'Mississippi',
  'US-MO': 'Missouri',
  'US-MT': 'Montana',
  'US-NE': 'Nebraska',
  'US-NV': 'Nevada',
  'US-NH': 'New Hampshire',
  'US-NJ': 'New Jersey',
  'US-NM': 'New Mexico',
  'US-NY': 'New York',
  'US-NC': 'North Carolina',
  'US-ND': 'North Dakota',
  'US-OH': 'Ohio',
  'US-OK': 'Oklahoma',
  'US-OR': 'Oregon',
  'US-PA': 'Pennsylvania',
  'US-RI': 'Rhode Island',
  'US-SC': 'South Carolina',
  'US-SD': 'South Dakota',
  'US-TN': 'Tennessee',
  'US-TX': 'Texas',
  'US-UT': 'Utah',
  'US-VT': 'Vermont',
  'US-VA': 'Virginia',
  'US-WA': 'Washington',
  'US-WV': 'West Virginia',
  'US-WI': 'Wisconsin',
  'US-WY': 'Wyoming',
};

export function isMemberLearningCoarseRegion(value: string): value is MemberLearningCoarseRegion {
  return (memberLearningCoarseRegionCodes as readonly string[]).includes(value);
}

export const memberLearningLessonKeys = [
  'pause_under_pressure',
  'verify_independently',
  'protect_codes_and_passwords',
  'question_unusual_payments',
  'confirm_family_emergencies',
  'refuse_remote_access',
  'recover_after_a_mistake',
] as const;

export type MemberLearningLessonKey = (typeof memberLearningLessonKeys)[number];

export interface MemberLearningSource {
  readonly title: string;
  readonly url: string;
}

export interface MemberLearningOption {
  readonly key: string;
  readonly label: string;
}

export interface MemberLearningLesson {
  readonly key: MemberLearningLessonKey;
  readonly version: number;
  readonly order: number;
  readonly title: string;
  readonly objective: string;
  readonly estimatedMinutes: number;
  readonly scenario: string;
  readonly options: readonly MemberLearningOption[];
  readonly correctOptionKey: string;
  readonly correctFeedback: string;
  readonly incorrectFeedback: string;
  readonly takeaway: string;
  readonly sources: readonly MemberLearningSource[];
}

const ftcAvoidScams: MemberLearningSource = {
  title: 'FTC: How to avoid a scam',
  url: 'https://consumer.ftc.gov/articles/how-avoid-scam',
};

const ftcRecovery: MemberLearningSource = {
  title: 'FTC: What to do if you were scammed',
  url: 'https://consumer.ftc.gov/articles/what-do-if-you-were-scammed',
};

export const memberLearningLessons = [
  {
    key: 'pause_under_pressure',
    version: 1,
    order: 1,
    title: 'Pause when someone creates urgency',
    objective: 'Practice slowing down before a threat or deadline controls the next step.',
    estimatedMinutes: 3,
    scenario:
      'A message says your account will close in 20 minutes unless you tap its link and confirm your details. What is the safer first step?',
    options: [
      { key: 'tap_now', label: 'Tap the link before the deadline passes' },
      { key: 'pause', label: 'Stop, take a breath, and do not use the message link' },
      { key: 'reply', label: 'Reply and ask whether the warning is real' },
    ],
    correctOptionKey: 'pause',
    correctFeedback:
      'Good choice. A reversible pause gives you time to verify without using the contact details the sender supplied.',
    incorrectFeedback:
      'The deadline may be designed to prevent careful thought. Do not reply or use the supplied link. Pause first.',
    takeaway: 'Urgency is a reason to slow down, not a reason to skip verification.',
    sources: [ftcAvoidScams],
  },
  {
    key: 'verify_independently',
    version: 1,
    order: 2,
    title: 'Verify through a channel you find yourself',
    objective: 'Separate a claim from the phone number, link, or caller that delivered it.',
    estimatedMinutes: 4,
    scenario:
      'A caller who says they are from your bank reports a suspicious charge and offers to transfer you to the fraud team. What should you do?',
    options: [
      { key: 'accept_transfer', label: 'Accept the transfer so the problem is handled quickly' },
      { key: 'call_back_number', label: 'Call the number the caller gives you' },
      {
        key: 'official_channel',
        label: 'Hang up and contact the bank using its official app, card, or website',
      },
    ],
    correctOptionKey: 'official_channel',
    correctFeedback:
      'Correct. Independently finding the official channel prevents the original caller from controlling the verification.',
    incorrectFeedback:
      'A transfer or callback number supplied by the caller can keep you inside the same scam. Find the official channel independently.',
    takeaway: 'Do not let the person making a claim choose how you verify it.',
    sources: [ftcAvoidScams],
  },
  {
    key: 'protect_codes_and_passwords',
    version: 1,
    order: 3,
    title: 'Keep sign-in codes and passwords private',
    objective:
      'Recognize that a one-time code can unlock an account even when a caller sounds helpful.',
    estimatedMinutes: 3,
    scenario:
      'A support agent says they sent a six-digit code to prove you own the account and asks you to read it aloud. What is safer?',
    options: [
      { key: 'share_code', label: 'Read the code because it came to your own phone' },
      { key: 'share_partial', label: 'Read only part of the code' },
      { key: 'keep_private', label: 'Do not share it; end the contact and use official support' },
    ],
    correctOptionKey: 'keep_private',
    correctFeedback:
      'Correct. A code sent to you may authorize a sign-in or account change. Keep the entire code private.',
    incorrectFeedback:
      'Even part of a code can help an attacker. Never read a sign-in or verification code to someone who contacted you.',
    takeaway:
      'A verification code is a key. The person asking for it may be trying to enter your account.',
    sources: [ftcAvoidScams],
  },
  {
    key: 'question_unusual_payments',
    version: 1,
    order: 4,
    title: 'Question unusual ways to pay',
    objective: 'Spot payment methods that make recovery difficult and pause before money moves.',
    estimatedMinutes: 4,
    scenario:
      'Someone says you owe a government fee today and must pay with gift cards or cryptocurrency. What is the safest response?',
    options: [
      { key: 'small_payment', label: 'Send a small amount first to show good faith' },
      { key: 'ask_discount', label: 'Ask whether they will accept a smaller payment' },
      { key: 'stop_verify', label: 'Do not pay and verify the claim through the agency itself' },
    ],
    correctOptionKey: 'stop_verify',
    correctFeedback:
      'Correct. Do not pay through a method chosen to create pressure or make recovery difficult. Verify independently.',
    incorrectFeedback:
      'Negotiating still treats the demand as real. Stop before paying and verify the claim through an official channel.',
    takeaway:
      'Gift cards, cryptocurrency, wire transfers, and cash demands deserve an immediate pause.',
    sources: [ftcAvoidScams],
  },
  {
    key: 'confirm_family_emergencies',
    version: 1,
    order: 5,
    title: 'Confirm an urgent family request',
    objective:
      'Use a second channel and a family verification plan when a voice or message could be imitated.',
    estimatedMinutes: 4,
    scenario:
      'A familiar-sounding voice says a family member is in trouble, asks for secrecy, and needs money immediately. What should you do?',
    options: [
      { key: 'send_secretly', label: 'Send money and keep the emergency private' },
      {
        key: 'call_family',
        label: 'End the call and contact the family member or trusted person another way',
      },
      { key: 'ask_caller', label: 'Ask the caller for a different payment method' },
    ],
    correctOptionKey: 'call_family',
    correctFeedback:
      'Correct. A familiar voice is not proof of identity. Use a separate contact method and your family verification plan.',
    incorrectFeedback:
      'Secrecy and urgency block independent confirmation. End the contact and reach the person or another trusted family member separately.',
    takeaway: 'Verify the person, not just the story or the sound of a voice.',
    sources: [ftcAvoidScams],
  },
  {
    key: 'refuse_remote_access',
    version: 1,
    order: 6,
    title: 'Do not give unexpected callers remote access',
    objective:
      'Recognize when supposed support would let another person control your device or view accounts.',
    estimatedMinutes: 3,
    scenario:
      'An unexpected caller says your computer is infected and asks you to install a screen-sharing app. What is safer?',
    options: [
      { key: 'install', label: 'Install it while the caller guides you' },
      { key: 'watch_only', label: 'Install it but do not open your bank account' },
      { key: 'decline', label: 'Decline, end the call, and contact trusted support yourself' },
    ],
    correctOptionKey: 'decline',
    correctFeedback:
      'Correct. Remote-access software can expose the device and everything shown on it. Unexpected callers should not control your screen.',
    incorrectFeedback:
      'Installing the software may give the caller control even if you avoid one account. End the call and seek support independently.',
    takeaway:
      'Unexpected technical support should never direct you to install remote-control software.',
    sources: [ftcAvoidScams],
  },
  {
    key: 'recover_after_a_mistake',
    version: 1,
    order: 7,
    title: 'Act quickly after money or access is exposed',
    objective: 'Practice a calm recovery order without shame or delay.',
    estimatedMinutes: 5,
    scenario:
      'You realize you sent money and shared an account password with someone who may be a scammer. What should happen first?',
    options: [
      { key: 'wait', label: 'Wait to see whether anything else happens' },
      { key: 'delete', label: 'Delete the messages so no one sees the mistake' },
      {
        key: 'secure_report',
        label: 'Stop contact, call the financial institution, secure the account, and report it',
      },
    ],
    correctOptionKey: 'secure_report',
    correctFeedback:
      'Correct. Fast, official action can limit harm. Preserve useful evidence and ask for help without blame.',
    incorrectFeedback:
      'Waiting or deleting evidence can make recovery harder. Stop contact and use official recovery channels now.',
    takeaway: 'A mistake is not a reason for shame. Quick recovery steps matter more than blame.',
    sources: [
      ftcRecovery,
      { title: 'IdentityTheft.gov recovery plans', url: 'https://www.identitytheft.gov/' },
    ],
  },
] as const satisfies readonly MemberLearningLesson[];

export const memberLearningReviewIntervalMs = 30 * 24 * 60 * 60 * 1_000;
export const weeklyRehearsalIntervalMs = 7 * 24 * 60 * 60 * 1_000;

export type StoredMemberLearningState = 'in_progress' | 'completed';
export type MemberLearningDisplayState = 'not_started' | 'in_progress' | 'completed' | 'review_due';

export interface StoredMemberLearningProgress {
  readonly lessonKey: MemberLearningLessonKey;
  readonly lessonVersion: number;
  readonly state: StoredMemberLearningState;
  readonly attemptCount: number;
  readonly reviewCount: number;
  readonly lastAnswerCorrect?: boolean;
  readonly startedAt: Date;
  readonly completedAt?: Date;
  readonly lastReviewedAt?: Date;
  readonly reviewDueAt?: Date;
  readonly updatedAt: Date;
}

export function currentMemberLearningLesson(
  lessonKey: MemberLearningLessonKey,
  lessonVersion?: number,
): MemberLearningLesson {
  const lesson = memberLearningLessons.find((candidate) => candidate.key === lessonKey);
  if (lesson === undefined) throw new DomainError('not_found', 'Learning lesson is unavailable');
  if (lessonVersion !== undefined && lesson.version !== lessonVersion) {
    throw new DomainError('conflict', 'A newer lesson version is available', {
      currentVersion: lesson.version,
    });
  }
  return lesson;
}

export function memberLearningDisplayState(
  progress: StoredMemberLearningProgress | undefined,
  now: Date,
): MemberLearningDisplayState {
  if (progress === undefined) return 'not_started';
  if (progress.state === 'in_progress') return 'in_progress';
  if (progress.lastAnswerCorrect === false) return 'review_due';
  return progress.reviewDueAt !== undefined && progress.reviewDueAt <= now
    ? 'review_due'
    : 'completed';
}

export function answerMemberLearningLesson(input: {
  readonly lesson: MemberLearningLesson;
  readonly progress?: StoredMemberLearningProgress;
  readonly optionKey: string;
  readonly now: Date;
}): { readonly correct: boolean; readonly progress: StoredMemberLearningProgress } {
  if (!input.lesson.options.some((option) => option.key === input.optionKey)) {
    throw new DomainError('invalid_input', 'Choose one available lesson response');
  }
  const correct = input.optionKey === input.lesson.correctOptionKey;
  const existing = input.progress;
  const startedAt = existing?.startedAt ?? input.now;
  const attemptCount = (existing?.attemptCount ?? 0) + 1;
  if (!correct) {
    return {
      correct,
      progress: {
        lessonKey: input.lesson.key,
        lessonVersion: input.lesson.version,
        state: existing?.state ?? 'in_progress',
        attemptCount,
        reviewCount: existing?.reviewCount ?? 0,
        lastAnswerCorrect: false,
        startedAt,
        ...(existing?.completedAt === undefined ? {} : { completedAt: existing.completedAt }),
        ...(existing?.lastReviewedAt === undefined
          ? {}
          : { lastReviewedAt: existing.lastReviewedAt }),
        ...(existing?.state === 'completed' ? { reviewDueAt: input.now } : {}),
        updatedAt: input.now,
      },
    };
  }
  const wasCompleted = existing?.state === 'completed';
  return {
    correct,
    progress: {
      lessonKey: input.lesson.key,
      lessonVersion: input.lesson.version,
      state: 'completed',
      attemptCount,
      reviewCount: (existing?.reviewCount ?? 0) + (wasCompleted ? 1 : 0),
      lastAnswerCorrect: true,
      startedAt,
      completedAt: existing?.completedAt ?? input.now,
      lastReviewedAt: input.now,
      reviewDueAt: new Date(input.now.getTime() + memberLearningReviewIntervalMs),
      updatedAt: input.now,
    },
  };
}

export function nextWeeklyRehearsalAt(input: {
  readonly enabledAt?: Date;
  readonly lastRehearsedAt?: Date;
}): Date | undefined {
  if (input.enabledAt === undefined) return undefined;
  const anchor =
    input.lastRehearsedAt !== undefined && input.lastRehearsedAt > input.enabledAt
      ? input.lastRehearsedAt
      : input.enabledAt;
  return new Date(anchor.getTime() + weeklyRehearsalIntervalMs);
}

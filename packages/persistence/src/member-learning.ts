import { createHash } from 'node:crypto';
import {
  answerMemberLearningLesson,
  currentMemberLearningLesson,
  DomainError,
  isMemberLearningCoarseRegion,
  memberLearningDisplayState,
  memberLearningLessons,
  nextWeeklyRehearsalAt,
  type Audience,
  type MemberLearningDisplayState,
  type MemberLearningCoarseRegion,
  type MemberLearningLesson,
  type MemberLearningLessonKey,
  type StoredMemberLearningProgress,
} from '@boomerbuddy/domain';
import { constantTimeEqual, lengthPrefixed } from '@boomerbuddy/security';
import type { Database, SqlExecutor } from './database';
import {
  hasEffectiveProtectedEnrollment,
  type EntitlementRuntimeEnvironment,
} from './entitlements';
import { writeAuditAndOutbox } from './events';
import {
  asDate,
  jsonParameter,
  jsonValue,
  randomIdFactory,
  stringArray,
  type IdFactory,
} from './values';

const curriculumPublishedAt = new Date('2026-08-27T12:00:00.000Z');

interface ProgressRow extends Record<string, unknown> {
  readonly lesson_key: MemberLearningLessonKey;
  readonly lesson_version: number;
  readonly state: StoredMemberLearningProgress['state'];
  readonly attempt_count: number;
  readonly review_count: number;
  readonly last_answer_correct: boolean | null;
  readonly started_at: unknown;
  readonly completed_at: unknown | null;
  readonly last_reviewed_at: unknown | null;
  readonly review_due_at: unknown | null;
  readonly updated_at: unknown;
}

interface PreferenceRow extends Record<string, unknown> {
  readonly coarse_region: string;
  readonly weekly_rehearsal_enabled: boolean;
  readonly weekly_rehearsal_enabled_at: unknown | null;
  readonly last_rehearsed_at: unknown | null;
  readonly updated_at: unknown;
}

interface BriefRow extends Record<string, unknown> {
  readonly brief_key: string;
  readonly version: number;
  readonly region_code: string;
  readonly title: string;
  readonly summary: string;
  readonly safe_actions: unknown;
  readonly source_title: string;
  readonly source_url: string;
  readonly source_published_at: unknown;
  readonly reviewed_at: unknown;
  readonly published_at: unknown;
  readonly expires_at: unknown;
}

interface FeedReceiptRow extends Record<string, unknown> {
  readonly item_key: string;
  readonly item_version: number;
  readonly state: 'read' | 'dismissed';
}

type MemberLearningMutationAction =
  | 'lesson_start'
  | 'lesson_answer'
  | 'preferences_update'
  | 'weekly_rehearsal_complete'
  | 'feed_item_update';

interface OperationReceiptRow extends Record<string, unknown> {
  readonly household_id: string;
  readonly person_id: string;
  readonly action_kind: MemberLearningMutationAction;
  readonly request_fingerprint: string;
  readonly canonical_result: unknown;
}

interface OperationEvidence {
  readonly operationKeyHash: string;
  readonly action: MemberLearningMutationAction;
  readonly requestFingerprint: string;
}

interface StoredOperationResult {
  readonly appliedAt: Date;
  readonly correct?: boolean;
  readonly feedback?: string;
}

const operationKeyActionNames: Readonly<Record<MemberLearningMutationAction, string>> = {
  lesson_start: 'lesson-start',
  lesson_answer: 'lesson-answer',
  preferences_update: 'preferences-update',
  weekly_rehearsal_complete: 'weekly-rehearsal-complete',
  feed_item_update: 'feed-item-update',
};
const operationUuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

export interface MemberLearningProgressView {
  readonly state: MemberLearningDisplayState;
  readonly attemptCount: number;
  readonly reviewCount: number;
  readonly priorVersionCompleted: boolean;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly lastReviewedAt?: Date;
  readonly reviewDueAt?: Date;
  readonly updatedAt?: Date;
}

export interface MemberLearningLessonView {
  readonly lesson: MemberLearningLesson;
  readonly progress: MemberLearningProgressView;
}

export interface StoredMemberScamGuidanceBrief {
  readonly key: string;
  readonly version: number;
  readonly region: MemberLearningCoarseRegion;
  readonly title: string;
  readonly summary: string;
  readonly safeActions: readonly string[];
  readonly source: {
    readonly title: string;
    readonly url: string;
    readonly publishedAt: Date;
  };
  readonly publishedAt: Date;
  readonly reviewedAt: Date;
  readonly expiresAt: Date;
  readonly freshness: 'current' | 'stale';
}

export interface MemberScamGuidanceView {
  readonly requestedRegion: MemberLearningCoarseRegion;
  readonly resolvedRegion: MemberLearningCoarseRegion | null;
  readonly state: 'current' | 'fallback_national' | 'stale' | 'none';
  readonly briefs: readonly StoredMemberScamGuidanceBrief[];
  readonly staleMessage?: string;
}

export interface MemberLearningPreferencesView {
  readonly coarseRegion: MemberLearningCoarseRegion;
  readonly weeklyRehearsalEnabled: boolean;
  readonly weeklyRehearsalEnabledAt?: Date;
  readonly lastRehearsedAt?: Date;
  readonly nextRehearsalAt?: Date;
  readonly updatedAt?: Date;
}

export interface MemberLearningFeedItemView {
  readonly key: string;
  readonly version: number;
  readonly kind: 'lesson' | 'guidance' | 'weekly_rehearsal';
  readonly state: 'unread' | 'read';
  readonly title: string;
  readonly summary: string;
  readonly action: 'resume_lesson' | 'review_lesson' | 'read_guidance' | 'weekly_rehearsal';
  readonly lessonKey?: MemberLearningLessonKey;
  readonly dueAt?: Date;
  readonly createdAt: Date;
}

export interface MemberLearningSnapshot {
  readonly curriculum: {
    readonly version: 'beta-1';
    readonly completedCount: number;
    readonly totalCount: number;
    readonly resume: {
      readonly lessonKey: MemberLearningLessonKey;
      readonly lessonVersion: number;
      readonly reason: 'continue' | 'next' | 'review';
    } | null;
    readonly lessons: readonly MemberLearningLessonView[];
  };
  readonly guidance: MemberScamGuidanceView;
  readonly preferences: MemberLearningPreferencesView;
  readonly feed: {
    readonly items: readonly MemberLearningFeedItemView[];
    readonly unreadCount: number;
  };
}

function sha256(fields: readonly string[]): string {
  return createHash('sha256').update(lengthPrefixed(fields)).digest('hex');
}

function advisoryLockParts(hexDigest: string): readonly [number, number] {
  return [
    Number.parseInt(hexDigest.slice(0, 8), 16) | 0,
    Number.parseInt(hexDigest.slice(8, 16), 16) | 0,
  ];
}

function operationEvidence(input: {
  readonly action: MemberLearningMutationAction;
  readonly operationKey: string;
  readonly householdId: string;
  readonly personId: string;
  readonly requestFields: readonly string[];
}): OperationEvidence {
  const actionName = operationKeyActionNames[input.action];
  const operationKeyPattern = new RegExp(
    `^member-learning:${actionName}:${operationUuidPattern}$`,
    'u',
  );
  if (!operationKeyPattern.test(input.operationKey)) {
    throw new DomainError(
      'invalid_input',
      `One action-bound member-learning ${actionName} Idempotency-Key is required`,
    );
  }
  return {
    operationKeyHash: sha256(['boomerbuddy:member-learning:operation-key:v1', input.operationKey]),
    action: input.action,
    requestFingerprint: sha256([
      'boomerbuddy:member-learning:request:v1',
      input.householdId,
      input.personId,
      input.action,
      ...input.requestFields,
    ]),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function storedOperationResult(value: unknown): StoredOperationResult {
  const result = jsonValue(value);
  if (!isRecord(result) || result.schemaVersion !== 1 || typeof result.appliedAt !== 'string') {
    throw new TypeError('Invalid member learning operation receipt');
  }
  const appliedAt = new Date(result.appliedAt);
  if (Number.isNaN(appliedAt.getTime())) {
    throw new TypeError('Invalid member learning receipt time');
  }
  const correct = result.correct;
  if (correct !== undefined && typeof correct !== 'boolean') {
    throw new TypeError('Invalid member learning answer receipt');
  }
  const feedback = result.feedback;
  if (feedback !== undefined && typeof feedback !== 'string') {
    throw new TypeError('Invalid member learning answer feedback receipt');
  }
  return {
    appliedAt,
    ...(correct === undefined ? {} : { correct }),
    ...(feedback === undefined ? {} : { feedback }),
  };
}

function operationResultParameter(result: StoredOperationResult): string {
  return jsonParameter({
    schemaVersion: 1,
    appliedAt: result.appliedAt.toISOString(),
    ...(result.correct === undefined ? {} : { correct: result.correct }),
    ...(result.feedback === undefined ? {} : { feedback: result.feedback }),
  });
}

function nullableDate(value: unknown | null, field: string): Date | undefined {
  return value === null ? undefined : asDate(value, field);
}

function parseProgress(row: ProgressRow): StoredMemberLearningProgress {
  return {
    lessonKey: row.lesson_key,
    lessonVersion: row.lesson_version,
    state: row.state,
    attemptCount: row.attempt_count,
    reviewCount: row.review_count,
    ...(row.last_answer_correct === null ? {} : { lastAnswerCorrect: row.last_answer_correct }),
    startedAt: asDate(row.started_at, 'member_learning_progress.started_at'),
    ...(row.completed_at === null
      ? {}
      : { completedAt: asDate(row.completed_at, 'member_learning_progress.completed_at') }),
    ...(row.last_reviewed_at === null
      ? {}
      : {
          lastReviewedAt: asDate(row.last_reviewed_at, 'member_learning_progress.last_reviewed_at'),
        }),
    ...(row.review_due_at === null
      ? {}
      : { reviewDueAt: asDate(row.review_due_at, 'member_learning_progress.review_due_at') }),
    updatedAt: asDate(row.updated_at, 'member_learning_progress.updated_at'),
  };
}

function parseBrief(row: BriefRow, now: Date): StoredMemberScamGuidanceBrief {
  const expiresAt = asDate(row.expires_at, 'member_scam_guidance_briefs.expires_at');
  if (!isMemberLearningCoarseRegion(row.region_code)) {
    throw new TypeError('Invalid member scam guidance region');
  }
  return {
    key: row.brief_key,
    version: row.version,
    region: row.region_code,
    title: row.title,
    summary: row.summary,
    safeActions: stringArray(
      jsonValue(row.safe_actions),
      'member_scam_guidance_briefs.safe_actions',
    ),
    source: {
      title: row.source_title,
      url: row.source_url,
      publishedAt: asDate(
        row.source_published_at,
        'member_scam_guidance_briefs.source_published_at',
      ),
    },
    publishedAt: asDate(row.published_at, 'member_scam_guidance_briefs.published_at'),
    reviewedAt: asDate(row.reviewed_at, 'member_scam_guidance_briefs.reviewed_at'),
    expiresAt,
    freshness: expiresAt > now ? 'current' : 'stale',
  };
}

async function assertEffectiveProtectedLearningAccess(
  executor: SqlExecutor,
  householdId: string,
  personId: string,
  now: Date,
  runtimeEnvironment: EntitlementRuntimeEnvironment,
  lock = false,
): Promise<void> {
  const hasEnrollment = await hasEffectiveProtectedEnrollment(
    executor,
    householdId,
    personId,
    now,
    lock,
    runtimeEnvironment,
  );
  const learningCapability = hasEnrollment
    ? await executor.query<Record<string, unknown>>(
        `SELECT 1
         FROM protected_members protected
         JOIN commerce_allowance_allocations allocation
           ON allocation.household_id = protected.household_id
          AND allocation.id = protected.allowance_allocation_id
          AND allocation.state = 'active'
         JOIN entitlement_grants grant_record
           ON grant_record.household_id = allocation.household_id
          AND grant_record.id = allocation.entitlement_grant_id
         WHERE protected.household_id = $1 AND protected.person_id = $2
           AND protected.status = 'accepted'
           AND grant_record.capabilities @> '["orientation:use"]'::jsonb
         ${lock ? 'FOR UPDATE OF protected, allocation, grant_record' : ''}`,
        [householdId, personId],
      )
    : undefined;
  if (!hasEnrollment || learningCapability?.rows[0] === undefined) {
    throw new DomainError('not_authorized', 'Member learning requires effective protected access');
  }
}

async function selectProgress(
  executor: SqlExecutor,
  householdId: string,
  personId: string,
  lessonKey?: MemberLearningLessonKey,
  lessonVersion?: number,
  lock = false,
): Promise<readonly StoredMemberLearningProgress[]> {
  const scoped = lessonKey === undefined ? '' : ' AND lesson_key = $3 AND lesson_version = $4';
  const result = await executor.query<ProgressRow>(
    `SELECT lesson_key, lesson_version, state, attempt_count, review_count,
            last_answer_correct, started_at, completed_at, last_reviewed_at,
            review_due_at, updated_at
     FROM member_learning_progress
     WHERE household_id = $1 AND person_id = $2${scoped}
     ORDER BY lesson_key, lesson_version${lock ? ' FOR UPDATE' : ''}`,
    lessonKey === undefined
      ? [householdId, personId]
      : [householdId, personId, lessonKey, lessonVersion],
  );
  return result.rows.map(parseProgress);
}

function progressView(
  lesson: MemberLearningLesson,
  allProgress: readonly StoredMemberLearningProgress[],
  now: Date,
): MemberLearningProgressView {
  const current = allProgress.find(
    (progress) => progress.lessonKey === lesson.key && progress.lessonVersion === lesson.version,
  );
  return {
    state: memberLearningDisplayState(current, now),
    attemptCount: current?.attemptCount ?? 0,
    reviewCount: current?.reviewCount ?? 0,
    priorVersionCompleted: allProgress.some(
      (progress) =>
        progress.lessonKey === lesson.key &&
        progress.lessonVersion < lesson.version &&
        progress.state === 'completed',
    ),
    ...(current === undefined
      ? {}
      : {
          startedAt: current.startedAt,
          ...(current.completedAt === undefined ? {} : { completedAt: current.completedAt }),
          ...(current.lastReviewedAt === undefined
            ? {}
            : { lastReviewedAt: current.lastReviewedAt }),
          ...(current.reviewDueAt === undefined ? {} : { reviewDueAt: current.reviewDueAt }),
          updatedAt: current.updatedAt,
        }),
  };
}

function latestBriefVersions(
  briefs: readonly StoredMemberScamGuidanceBrief[],
): readonly StoredMemberScamGuidanceBrief[] {
  const latest = new Map<string, StoredMemberScamGuidanceBrief>();
  for (const brief of briefs) {
    const existing = latest.get(brief.key);
    if (existing === undefined || brief.version > existing.version) latest.set(brief.key, brief);
  }
  return [...latest.values()].sort(
    (left, right) =>
      right.publishedAt.getTime() - left.publishedAt.getTime() || left.key.localeCompare(right.key),
  );
}

function guidanceView(
  requestedRegion: MemberLearningCoarseRegion,
  rows: readonly BriefRow[],
  now: Date,
): MemberScamGuidanceView {
  const briefs = latestBriefVersions(rows.map((row) => parseBrief(row, now)));
  const current = briefs.filter((brief) => brief.freshness === 'current');
  const exactCurrent = current.filter((brief) => brief.region === requestedRegion);
  const nationalCurrent = current.filter((brief) => brief.region === 'US');
  if (requestedRegion !== 'US' && exactCurrent.length > 0) {
    return {
      requestedRegion,
      resolvedRegion: requestedRegion,
      state: 'current',
      briefs: [...exactCurrent, ...nationalCurrent].slice(0, 5),
    };
  }
  if (nationalCurrent.length > 0) {
    return {
      requestedRegion,
      resolvedRegion: 'US',
      state: requestedRegion === 'US' ? 'current' : 'fallback_national',
      briefs: nationalCurrent.slice(0, 5),
    };
  }
  const exactStale = briefs.filter(
    (brief) => brief.freshness === 'stale' && brief.region === requestedRegion,
  );
  const nationalStale = briefs.filter(
    (brief) => brief.freshness === 'stale' && brief.region === 'US',
  );
  const stale = (
    requestedRegion === 'US' ? nationalStale : [...exactStale, ...nationalStale]
  ).slice(0, 1);
  if (stale.length > 0) {
    return {
      requestedRegion,
      resolvedRegion: stale[0]?.region ?? null,
      state: 'stale',
      briefs: stale,
      staleMessage:
        'This brief has passed its review window. Treat it as background only and verify current details with the linked official source.',
    };
  }
  return {
    requestedRegion,
    resolvedRegion: null,
    state: 'none',
    briefs: [],
    staleMessage:
      'No reviewed brief is current for this region. BoomerBuddy is not a live or exhaustive scam alert service.',
  };
}

function feedReceiptKey(itemKey: string, itemVersion: number): string {
  return `${itemKey}:${itemVersion}`;
}

function weeklyFeedVersion(dueAt: Date): number {
  return Math.max(1, Math.floor(dueAt.getTime() / (7 * 24 * 60 * 60 * 1_000)));
}

export class MemberLearningRepository {
  constructor(
    private readonly database: Database,
    private readonly idFactory: IdFactory = randomIdFactory,
    private readonly runtimeEnvironment: EntitlementRuntimeEnvironment = 'local',
  ) {}

  private async priorOperation(
    executor: SqlExecutor,
    scope: { readonly householdId: string; readonly personId: string },
    evidence: OperationEvidence,
  ): Promise<StoredOperationResult | undefined> {
    const lockParts = advisoryLockParts(evidence.operationKeyHash);
    await executor.query('SELECT pg_advisory_xact_lock($1, $2)', lockParts);
    const result = await executor.query<OperationReceiptRow>(
      `SELECT household_id, person_id, action_kind, request_fingerprint, canonical_result
       FROM member_learning_operation_receipts
       WHERE operation_key_hash = $1
       FOR UPDATE`,
      [evidence.operationKeyHash],
    );
    const receipt = result.rows[0];
    if (receipt === undefined) return undefined;
    if (
      receipt.household_id !== scope.householdId ||
      receipt.person_id !== scope.personId ||
      receipt.action_kind !== evidence.action ||
      !constantTimeEqual(receipt.request_fingerprint, evidence.requestFingerprint)
    ) {
      throw new DomainError(
        'conflict',
        'The member-learning Idempotency-Key is already bound to another request',
      );
    }
    return storedOperationResult(receipt.canonical_result);
  }

  private async recordOperation(
    executor: SqlExecutor,
    input: {
      readonly householdId: string;
      readonly personId: string;
      readonly now: Date;
      readonly evidence: OperationEvidence;
      readonly result: StoredOperationResult;
    },
  ): Promise<void> {
    await executor.query(
      `INSERT INTO member_learning_operation_receipts(
         household_id, person_id, operation_key_hash, action_kind,
         request_fingerprint, canonical_result, contains_customer_content,
         created_at, completed_at
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,false,$7,$7)`,
      [
        input.householdId,
        input.personId,
        input.evidence.operationKeyHash,
        input.evidence.action,
        input.evidence.requestFingerprint,
        operationResultParameter(input.result),
        input.now.toISOString(),
      ],
    );
  }

  async getSnapshot(input: {
    readonly householdId: string;
    readonly personId: string;
    readonly now: Date;
  }): Promise<MemberLearningSnapshot> {
    return this.database.transaction(async (transaction) => {
      await assertEffectiveProtectedLearningAccess(
        transaction,
        input.householdId,
        input.personId,
        input.now,
        this.runtimeEnvironment,
        true,
      );
      return this.readSnapshot(transaction, input);
    });
  }

  private async readSnapshot(
    executor: SqlExecutor,
    input: {
      readonly householdId: string;
      readonly personId: string;
      readonly now: Date;
    },
  ): Promise<MemberLearningSnapshot> {
    const allProgress = await selectProgress(executor, input.householdId, input.personId);
    const preferenceResult = await executor.query<PreferenceRow>(
      `SELECT coarse_region, weekly_rehearsal_enabled, weekly_rehearsal_enabled_at,
              last_rehearsed_at, updated_at
       FROM member_learning_preferences
       WHERE household_id = $1 AND person_id = $2`,
      [input.householdId, input.personId],
    );
    const preferenceRow = preferenceResult.rows[0];
    const coarseRegion = preferenceRow?.coarse_region ?? 'US';
    if (!isMemberLearningCoarseRegion(coarseRegion)) {
      throw new TypeError('Invalid member learning preference region');
    }
    const enabledAt =
      preferenceRow === undefined
        ? undefined
        : nullableDate(
            preferenceRow.weekly_rehearsal_enabled_at,
            'member_learning_preferences.weekly_rehearsal_enabled_at',
          );
    const lastRehearsedAt =
      preferenceRow === undefined
        ? undefined
        : nullableDate(
            preferenceRow.last_rehearsed_at,
            'member_learning_preferences.last_rehearsed_at',
          );
    const preferences: MemberLearningPreferencesView = {
      coarseRegion,
      weeklyRehearsalEnabled: preferenceRow?.weekly_rehearsal_enabled ?? false,
      ...(enabledAt === undefined ? {} : { weeklyRehearsalEnabledAt: enabledAt }),
      ...(lastRehearsedAt === undefined ? {} : { lastRehearsedAt }),
      ...(preferenceRow === undefined
        ? {}
        : {
            updatedAt: asDate(preferenceRow.updated_at, 'member_learning_preferences.updated_at'),
          }),
    };
    const nextRehearsalAt = nextWeeklyRehearsalAt({
      ...(enabledAt === undefined ? {} : { enabledAt }),
      ...(lastRehearsedAt === undefined ? {} : { lastRehearsedAt }),
    });
    if (nextRehearsalAt !== undefined) {
      Object.assign(preferences, { nextRehearsalAt });
    }

    const briefResult = await executor.query<BriefRow>(
      `SELECT brief_key, version, region_code, title, summary, safe_actions,
              source_title, source_url, source_published_at, reviewed_at,
              published_at, expires_at
       FROM member_scam_guidance_briefs
       WHERE published_at <= $1 AND region_code IN ('US', $2)
       ORDER BY published_at DESC, brief_key, version DESC`,
      [input.now.toISOString(), preferences.coarseRegion],
    );
    const guidance = guidanceView(preferences.coarseRegion, briefResult.rows, input.now);
    const lessons = memberLearningLessons.map((lesson) => ({
      lesson,
      progress: progressView(lesson, allProgress, input.now),
    }));
    const resumeLesson =
      lessons.find(({ progress }) => progress.state === 'review_due') ??
      lessons.find(({ progress }) => progress.state === 'in_progress') ??
      lessons.find(({ progress }) => progress.state === 'not_started');
    const resume =
      resumeLesson === undefined
        ? null
        : {
            lessonKey: resumeLesson.lesson.key,
            lessonVersion: resumeLesson.lesson.version,
            reason:
              resumeLesson.progress.state === 'review_due'
                ? ('review' as const)
                : resumeLesson.progress.state === 'in_progress'
                  ? ('continue' as const)
                  : ('next' as const),
          };

    const candidateFeed: MemberLearningFeedItemView[] = [];
    if (resumeLesson !== undefined && resume !== null) {
      candidateFeed.push({
        key: `lesson:${resumeLesson.lesson.key}`,
        version: resumeLesson.lesson.version,
        kind: 'lesson',
        state: 'unread',
        title:
          resume.reason === 'review'
            ? `Review: ${resumeLesson.lesson.title}`
            : `Continue learning: ${resumeLesson.lesson.title}`,
        summary: resumeLesson.lesson.objective,
        action: resume.reason === 'review' ? 'review_lesson' : 'resume_lesson',
        lessonKey: resumeLesson.lesson.key,
        ...(resumeLesson.progress.reviewDueAt === undefined
          ? {}
          : { dueAt: resumeLesson.progress.reviewDueAt }),
        createdAt: resumeLesson.progress.updatedAt ?? curriculumPublishedAt,
      });
    }
    const leadBrief = guidance.briefs[0];
    if (leadBrief !== undefined) {
      candidateFeed.push({
        key: `guidance:${leadBrief.key}`,
        version: leadBrief.version,
        kind: 'guidance',
        state: 'unread',
        title:
          leadBrief.freshness === 'current' ? 'Reviewed scam guidance' : 'Guidance review expired',
        summary: leadBrief.title,
        action: 'read_guidance',
        createdAt: leadBrief.publishedAt,
      });
    }
    if (nextRehearsalAt !== undefined && nextRehearsalAt <= input.now) {
      candidateFeed.push({
        key: 'weekly-rehearsal',
        version: weeklyFeedVersion(nextRehearsalAt),
        kind: 'weekly_rehearsal',
        state: 'unread',
        title: 'Weekly two-minute safety rehearsal',
        summary: 'Practice pausing, verifying independently, and calling a trusted person.',
        action: 'weekly_rehearsal',
        dueAt: nextRehearsalAt,
        createdAt: nextRehearsalAt,
      });
    }

    const receiptResult = await executor.query<FeedReceiptRow>(
      `SELECT item_key, item_version, state
       FROM member_in_app_feed_receipts
       WHERE household_id = $1 AND person_id = $2`,
      [input.householdId, input.personId],
    );
    const receipts = new Map(
      receiptResult.rows.map((receipt) => [
        feedReceiptKey(receipt.item_key, receipt.item_version),
        receipt.state,
      ]),
    );
    const feedItems = candidateFeed
      .filter((item) => receipts.get(feedReceiptKey(item.key, item.version)) !== 'dismissed')
      .map((item) => ({
        ...item,
        state:
          receipts.get(feedReceiptKey(item.key, item.version)) === 'read'
            ? ('read' as const)
            : ('unread' as const),
      }));

    return {
      curriculum: {
        version: 'beta-1',
        completedCount: lessons.filter(({ progress }) =>
          ['completed', 'review_due'].includes(progress.state),
        ).length,
        totalCount: lessons.length,
        resume,
        lessons,
      },
      guidance,
      preferences,
      feed: {
        items: feedItems,
        unreadCount: feedItems.filter((item) => item.state === 'unread').length,
      },
    };
  }

  async startLesson(input: {
    readonly householdId: string;
    readonly personId: string;
    readonly lessonKey: MemberLearningLessonKey;
    readonly lessonVersion: number;
    readonly idempotencyKey: string;
    readonly audience: Audience;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<MemberLearningSnapshot> {
    const evidence = operationEvidence({
      action: 'lesson_start',
      operationKey: input.idempotencyKey,
      householdId: input.householdId,
      personId: input.personId,
      requestFields: [input.lessonKey, String(input.lessonVersion)],
    });
    return this.database.transaction(async (transaction) => {
      await assertEffectiveProtectedLearningAccess(
        transaction,
        input.householdId,
        input.personId,
        input.now,
        this.runtimeEnvironment,
        true,
      );
      const prior = await this.priorOperation(transaction, input, evidence);
      if (prior !== undefined) return this.readSnapshot(transaction, input);
      const lesson = currentMemberLearningLesson(input.lessonKey, input.lessonVersion);
      const inserted = await transaction.query(
        `INSERT INTO member_learning_progress(
           household_id, person_id, lesson_key, lesson_version, state,
           attempt_count, review_count, started_at, updated_at
         ) VALUES ($1,$2,$3,$4,'in_progress',0,0,$5,$5)
         ON CONFLICT (household_id, person_id, lesson_key, lesson_version) DO NOTHING`,
        [input.householdId, input.personId, lesson.key, lesson.version, input.now.toISOString()],
      );
      if (inserted.rowCount === 1) {
        await writeAuditAndOutbox(
          transaction,
          this.idFactory,
          {
            householdId: input.householdId,
            actorPersonId: input.personId,
            audience: input.audience,
            correlationId: input.correlationId,
            now: input.now,
          },
          {
            action: 'member_learning.lesson_started',
            resourceType: 'member_learning_lesson',
            resourceId: lesson.key,
            outcome: 'completed',
            metadata: { lessonKey: lesson.key, lessonVersion: lesson.version },
          },
          {
            eventType: 'member_learning.lesson_started.v1',
            aggregateType: 'member_learning',
            aggregateId: input.personId,
            payload: { lessonKey: lesson.key, lessonVersion: lesson.version },
          },
        );
      }
      const snapshot = await this.readSnapshot(transaction, input);
      await this.recordOperation(transaction, {
        ...input,
        evidence,
        result: { appliedAt: input.now },
      });
      return snapshot;
    });
  }

  async answerLesson(input: {
    readonly householdId: string;
    readonly personId: string;
    readonly lessonKey: MemberLearningLessonKey;
    readonly lessonVersion: number;
    readonly optionKey: string;
    readonly idempotencyKey: string;
    readonly audience: Audience;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<{
    readonly correct: boolean;
    readonly feedback: string;
    readonly snapshot: MemberLearningSnapshot;
  }> {
    const evidence = operationEvidence({
      action: 'lesson_answer',
      operationKey: input.idempotencyKey,
      householdId: input.householdId,
      personId: input.personId,
      requestFields: [input.lessonKey, String(input.lessonVersion), input.optionKey],
    });
    return this.database.transaction(async (transaction) => {
      await assertEffectiveProtectedLearningAccess(
        transaction,
        input.householdId,
        input.personId,
        input.now,
        this.runtimeEnvironment,
        true,
      );
      const prior = await this.priorOperation(transaction, input, evidence);
      if (prior !== undefined) {
        if (prior.correct === undefined || prior.feedback === undefined) {
          throw new TypeError('Invalid member learning answer operation receipt');
        }
        return {
          correct: prior.correct,
          feedback: prior.feedback,
          snapshot: await this.readSnapshot(transaction, input),
        };
      }
      const lesson = currentMemberLearningLesson(input.lessonKey, input.lessonVersion);
      const current = (
        await selectProgress(
          transaction,
          input.householdId,
          input.personId,
          lesson.key,
          lesson.version,
          true,
        )
      )[0];
      const answer = answerMemberLearningLesson({
        lesson,
        ...(current === undefined ? {} : { progress: current }),
        optionKey: input.optionKey,
        now: input.now,
      });
      const progress = answer.progress;
      await transaction.query(
        `INSERT INTO member_learning_progress(
           household_id, person_id, lesson_key, lesson_version, state,
           attempt_count, review_count, last_answer_correct, started_at,
           completed_at, last_reviewed_at, review_due_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (household_id, person_id, lesson_key, lesson_version) DO UPDATE
           SET state = EXCLUDED.state,
               attempt_count = EXCLUDED.attempt_count,
               review_count = EXCLUDED.review_count,
               last_answer_correct = EXCLUDED.last_answer_correct,
               completed_at = EXCLUDED.completed_at,
               last_reviewed_at = EXCLUDED.last_reviewed_at,
               review_due_at = EXCLUDED.review_due_at,
               updated_at = EXCLUDED.updated_at`,
        [
          input.householdId,
          input.personId,
          progress.lessonKey,
          progress.lessonVersion,
          progress.state,
          progress.attemptCount,
          progress.reviewCount,
          progress.lastAnswerCorrect ?? null,
          progress.startedAt.toISOString(),
          progress.completedAt?.toISOString() ?? null,
          progress.lastReviewedAt?.toISOString() ?? null,
          progress.reviewDueAt?.toISOString() ?? null,
          progress.updatedAt.toISOString(),
        ],
      );
      await writeAuditAndOutbox(
        transaction,
        this.idFactory,
        {
          householdId: input.householdId,
          actorPersonId: input.personId,
          audience: input.audience,
          correlationId: input.correlationId,
          now: input.now,
        },
        {
          action: 'member_learning.lesson_answered',
          resourceType: 'member_learning_lesson',
          resourceId: lesson.key,
          outcome: 'completed',
          metadata: {
            lessonKey: lesson.key,
            lessonVersion: lesson.version,
            correct: answer.correct,
          },
        },
        {
          eventType: 'member_learning.lesson_answered.v1',
          aggregateType: 'member_learning',
          aggregateId: input.personId,
          payload: {
            lessonKey: lesson.key,
            lessonVersion: lesson.version,
            correct: answer.correct,
          },
        },
      );
      const result = {
        correct: answer.correct,
        feedback: answer.correct ? lesson.correctFeedback : lesson.incorrectFeedback,
        snapshot: await this.readSnapshot(transaction, input),
      };
      await this.recordOperation(transaction, {
        ...input,
        evidence,
        result: {
          appliedAt: input.now,
          correct: result.correct,
          feedback: result.feedback,
        },
      });
      return result;
    });
  }

  async updatePreferences(input: {
    readonly householdId: string;
    readonly personId: string;
    readonly coarseRegion: string;
    readonly weeklyRehearsalEnabled: boolean;
    readonly idempotencyKey: string;
    readonly audience: Audience;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<MemberLearningSnapshot> {
    if (!isMemberLearningCoarseRegion(input.coarseRegion)) {
      throw new DomainError('invalid_input', 'Choose a supported coarse United States region');
    }
    const evidence = operationEvidence({
      action: 'preferences_update',
      operationKey: input.idempotencyKey,
      householdId: input.householdId,
      personId: input.personId,
      requestFields: [input.coarseRegion, String(input.weeklyRehearsalEnabled)],
    });
    return this.database.transaction(async (transaction) => {
      await assertEffectiveProtectedLearningAccess(
        transaction,
        input.householdId,
        input.personId,
        input.now,
        this.runtimeEnvironment,
        true,
      );
      const prior = await this.priorOperation(transaction, input, evidence);
      if (prior !== undefined) return this.readSnapshot(transaction, input);
      await transaction.query(
        `INSERT INTO member_learning_preferences(
           household_id, person_id, coarse_region, weekly_rehearsal_enabled,
           weekly_rehearsal_enabled_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (household_id, person_id) DO UPDATE
           SET coarse_region = EXCLUDED.coarse_region,
               weekly_rehearsal_enabled = EXCLUDED.weekly_rehearsal_enabled,
               weekly_rehearsal_enabled_at = CASE
                 WHEN EXCLUDED.weekly_rehearsal_enabled THEN
                   COALESCE(member_learning_preferences.weekly_rehearsal_enabled_at,
                            EXCLUDED.weekly_rehearsal_enabled_at)
                 ELSE NULL
               END,
               updated_at = EXCLUDED.updated_at`,
        [
          input.householdId,
          input.personId,
          input.coarseRegion,
          input.weeklyRehearsalEnabled,
          input.weeklyRehearsalEnabled ? input.now.toISOString() : null,
          input.now.toISOString(),
        ],
      );
      await writeAuditAndOutbox(
        transaction,
        this.idFactory,
        {
          householdId: input.householdId,
          actorPersonId: input.personId,
          audience: input.audience,
          correlationId: input.correlationId,
          now: input.now,
        },
        {
          action: 'member_learning.preferences_updated',
          resourceType: 'member_learning_preferences',
          resourceId: input.personId,
          outcome: 'completed',
          metadata: {
            coarseRegion: input.coarseRegion,
            weeklyRehearsalEnabled: input.weeklyRehearsalEnabled,
          },
        },
        {
          eventType: 'member_learning.preferences_updated.v1',
          aggregateType: 'member_learning',
          aggregateId: input.personId,
          payload: {
            coarseRegion: input.coarseRegion,
            weeklyRehearsalEnabled: input.weeklyRehearsalEnabled,
          },
        },
      );
      const snapshot = await this.readSnapshot(transaction, input);
      await this.recordOperation(transaction, {
        ...input,
        evidence,
        result: { appliedAt: input.now },
      });
      return snapshot;
    });
  }

  async completeWeeklyRehearsal(input: {
    readonly householdId: string;
    readonly personId: string;
    readonly idempotencyKey: string;
    readonly audience: Audience;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<MemberLearningSnapshot> {
    const evidence = operationEvidence({
      action: 'weekly_rehearsal_complete',
      operationKey: input.idempotencyKey,
      householdId: input.householdId,
      personId: input.personId,
      requestFields: ['complete'],
    });
    return this.database.transaction(async (transaction) => {
      await assertEffectiveProtectedLearningAccess(
        transaction,
        input.householdId,
        input.personId,
        input.now,
        this.runtimeEnvironment,
        true,
      );
      const prior = await this.priorOperation(transaction, input, evidence);
      if (prior !== undefined) return this.readSnapshot(transaction, input);
      const updated = await transaction.query(
        `UPDATE member_learning_preferences
         SET last_rehearsed_at = $3, updated_at = $3
         WHERE household_id = $1 AND person_id = $2
           AND weekly_rehearsal_enabled = true`,
        [input.householdId, input.personId, input.now.toISOString()],
      );
      if (updated.rowCount !== 1) {
        throw new DomainError(
          'invalid_transition',
          'Enable the in-app weekly rehearsal before completing it',
        );
      }
      await writeAuditAndOutbox(
        transaction,
        this.idFactory,
        {
          householdId: input.householdId,
          actorPersonId: input.personId,
          audience: input.audience,
          correlationId: input.correlationId,
          now: input.now,
        },
        {
          action: 'member_learning.weekly_rehearsal_completed',
          resourceType: 'member_learning_rehearsal',
          resourceId: input.personId,
          outcome: 'completed',
        },
        {
          eventType: 'member_learning.weekly_rehearsal_completed.v1',
          aggregateType: 'member_learning',
          aggregateId: input.personId,
          payload: { completed: true },
        },
      );
      const snapshot = await this.readSnapshot(transaction, input);
      await this.recordOperation(transaction, {
        ...input,
        evidence,
        result: { appliedAt: input.now },
      });
      return snapshot;
    });
  }

  async updateFeedItem(input: {
    readonly householdId: string;
    readonly personId: string;
    readonly itemKey: string;
    readonly itemVersion: number;
    readonly state: 'read' | 'dismissed';
    readonly idempotencyKey: string;
    readonly audience: Audience;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<MemberLearningSnapshot> {
    const evidence = operationEvidence({
      action: 'feed_item_update',
      operationKey: input.idempotencyKey,
      householdId: input.householdId,
      personId: input.personId,
      requestFields: [input.itemKey, String(input.itemVersion), input.state],
    });
    return this.database.transaction(async (transaction) => {
      await assertEffectiveProtectedLearningAccess(
        transaction,
        input.householdId,
        input.personId,
        input.now,
        this.runtimeEnvironment,
        true,
      );
      const prior = await this.priorOperation(transaction, input, evidence);
      if (prior !== undefined) return this.readSnapshot(transaction, input);
      const current = await this.readSnapshot(transaction, input);
      const item = current.feed.items.find(
        (candidate) => candidate.key === input.itemKey && candidate.version === input.itemVersion,
      );
      if (item === undefined) throw new DomainError('not_found', 'In-app feed item is unavailable');
      await transaction.query(
        `INSERT INTO member_in_app_feed_receipts(
           household_id, person_id, item_key, item_version, state,
           read_at, dismissed_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (household_id, person_id, item_key, item_version) DO UPDATE
           SET state = EXCLUDED.state,
               read_at = EXCLUDED.read_at,
               dismissed_at = EXCLUDED.dismissed_at,
               updated_at = EXCLUDED.updated_at`,
        [
          input.householdId,
          input.personId,
          input.itemKey,
          input.itemVersion,
          input.state,
          input.state === 'read' ? input.now.toISOString() : null,
          input.state === 'dismissed' ? input.now.toISOString() : null,
          input.now.toISOString(),
        ],
      );
      await writeAuditAndOutbox(
        transaction,
        this.idFactory,
        {
          householdId: input.householdId,
          actorPersonId: input.personId,
          audience: input.audience,
          correlationId: input.correlationId,
          now: input.now,
        },
        {
          action: 'member_learning.feed_item_updated',
          resourceType: 'member_in_app_feed_item',
          resourceId: input.itemKey,
          outcome: 'completed',
          metadata: { itemVersion: input.itemVersion, state: input.state },
        },
        {
          eventType: 'member_learning.feed_item_updated.v1',
          aggregateType: 'member_learning',
          aggregateId: input.personId,
          payload: { itemVersion: input.itemVersion, state: input.state },
        },
      );
      const snapshot = await this.readSnapshot(transaction, input);
      await this.recordOperation(transaction, {
        ...input,
        evidence,
        result: { appliedAt: input.now },
      });
      return snapshot;
    });
  }
}

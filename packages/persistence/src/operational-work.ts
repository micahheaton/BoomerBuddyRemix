import { DomainError } from '@boomerbuddy/domain';
import { detectRestrictedInput } from '@boomerbuddy/security';
import type { Database, SqlExecutor } from './database';
import { asDate, jsonParameter, jsonValue, randomIdFactory, type IdFactory } from './values';

export type NotificationChannel = 'local_test' | 'push' | 'email' | 'sms';
export type NotificationDispatchState = 'queued' | 'test_delivered' | 'blocked_external' | 'failed';
export type OperationalEvidenceKind =
  'notification_dispatch' | 'intelligence_refresh' | 'evaluation_run';
export type OperationalEvidenceOutcome =
  'completed' | 'test_delivered' | 'blocked_external' | 'attention';

export interface OperationalJobEvidence {
  readonly id: string;
  readonly jobId: string;
  readonly kind: OperationalEvidenceKind;
  readonly outcome: OperationalEvidenceOutcome;
  readonly summary: Readonly<Record<string, string | number | boolean>>;
  readonly observedAt: Date;
}

interface EvidenceRow extends Record<string, unknown> {
  readonly id: string;
  readonly job_id: string;
  readonly evidence_kind: OperationalEvidenceKind;
  readonly outcome: OperationalEvidenceOutcome;
  readonly summary: unknown;
  readonly observed_at: unknown;
}

interface NotificationRow extends Record<string, unknown> {
  readonly id: string;
  readonly household_id: string;
  readonly recipient_person_id: string;
  readonly template_key: string;
  readonly channel: NotificationChannel;
  readonly consent_basis: string;
  readonly state: NotificationDispatchState;
}

export interface NotificationRequestInput {
  readonly householdId: string;
  readonly recipientPersonId: string;
  readonly templateKey: string;
  readonly channel: NotificationChannel;
  readonly consentBasis: string;
  readonly now: Date;
}

const code = /^[a-z][a-z0-9_.:-]{1,119}$/u;
const stableNotificationId = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{1,199}$/u;
const approvedNotificationTemplates = new Set([
  'orientation.reminder.v1',
  'lifecycle.orientation_stalled.v1',
  'lifecycle.payment_recovery.v1',
]);
const forbiddenSummaryKey =
  /(?:content|artifact|cipher|fingerprint|token|secret|safe.?word|url|destination|email|phone|prompt)/iu;

function validateSummary(
  summary: Readonly<Record<string, string | number | boolean>>,
): Readonly<Record<string, string | number | boolean>> {
  const entries = Object.entries(summary).sort(([left], [right]) => left.localeCompare(right));
  for (const [key, value] of entries) {
    if (forbiddenSummaryKey.test(key) || !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new DomainError('invalid_input', 'Operational evidence must remain content-free');
    }
  }
  return Object.fromEntries(entries) as Readonly<Record<string, string | number | boolean>>;
}

function evidenceSummary(value: unknown): OperationalJobEvidence['summary'] {
  const parsed = jsonValue(value);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Invalid operational evidence summary');
  }
  for (const item of Object.values(parsed)) {
    if (!['string', 'number', 'boolean'].includes(typeof item)) {
      throw new TypeError('Operational evidence summary must contain scalar values');
    }
  }
  return validateSummary(parsed as Readonly<Record<string, string | number | boolean>>);
}

function mapEvidence(row: EvidenceRow): OperationalJobEvidence {
  return {
    id: row.id,
    jobId: row.job_id,
    kind: row.evidence_kind,
    outcome: row.outcome,
    summary: evidenceSummary(row.summary),
    observedAt: asDate(row.observed_at, 'operational_job_evidence.observed_at'),
  };
}

function summariesEqual(
  left: Readonly<Record<string, string | number | boolean>>,
  right: Readonly<Record<string, string | number | boolean>>,
): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

export async function createNotificationRequestWithExecutor(
  executor: SqlExecutor,
  requestId: string,
  input: NotificationRequestInput,
): Promise<{ readonly requestId: string; readonly duplicate: boolean }> {
  if (
    !stableNotificationId.test(requestId) ||
    !code.test(input.templateKey) ||
    !approvedNotificationTemplates.has(input.templateKey) ||
    !code.test(input.consentBasis) ||
    detectRestrictedInput(input.consentBasis).length > 0 ||
    !Number.isFinite(input.now.getTime())
  ) {
    throw new DomainError('invalid_input', 'Notification governance evidence is invalid');
  }
  const inserted = await executor.query(
    `INSERT INTO notification_dispatch_requests(
       id, household_id, recipient_person_id, template_key, channel, consent_basis,
       state, created_at, updated_at
     )
     SELECT $1, membership.household_id, membership.person_id, $4, $5, $6,
            'queued', $7, $7
     FROM household_memberships AS membership
     WHERE membership.household_id = $2 AND membership.person_id = $3
       AND membership.status = 'active'
     ON CONFLICT (id) DO NOTHING`,
    [
      requestId,
      input.householdId,
      input.recipientPersonId,
      input.templateKey,
      input.channel,
      input.consentBasis,
      input.now.toISOString(),
    ],
  );
  const result = await executor.query<NotificationRow>(
    `SELECT id, household_id, recipient_person_id, template_key, channel, consent_basis, state
     FROM notification_dispatch_requests WHERE id = $1`,
    [requestId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new DomainError('not_found', 'Notification recipient is unavailable');
  }
  if (
    row.household_id !== input.householdId ||
    row.recipient_person_id !== input.recipientPersonId ||
    row.template_key !== input.templateKey ||
    row.channel !== input.channel ||
    row.consent_basis !== input.consentBasis
  ) {
    throw new DomainError('conflict', 'Notification request conflicts with its first evidence');
  }
  return { requestId: row.id, duplicate: inserted.rowCount === 0 };
}

export class OperationalWorkRepository {
  constructor(
    private readonly database: Database,
    private readonly ids: IdFactory = randomIdFactory,
  ) {}

  async createNotificationRequest(input: NotificationRequestInput): Promise<string> {
    const id = this.ids.next('notification');
    const request = await createNotificationRequestWithExecutor(this.database, id, input);
    return request.requestId;
  }

  async dispatchNotification(input: {
    readonly requestId: string;
    readonly jobId: string;
    readonly now: Date;
  }): Promise<NotificationDispatchState> {
    return this.database.transaction(async (transaction) => {
      const result = await transaction.query<NotificationRow>(
        `SELECT id, household_id, recipient_person_id, template_key, channel,
                consent_basis, state
         FROM notification_dispatch_requests WHERE id = $1 FOR UPDATE`,
        [input.requestId],
      );
      const request = result.rows[0];
      if (request === undefined) {
        throw new DomainError('not_found', 'Notification request was not found');
      }
      let governanceFailure: 'communication_suppressed' | 'recipient_unavailable' | undefined;
      if (request.state === 'queued' && request.consent_basis === 'transactional_lifecycle') {
        const membership = await transaction.query(
          `SELECT 1 FROM household_memberships
           WHERE household_id = $1 AND person_id = $2 AND status = 'active'`,
          [request.household_id, request.recipient_person_id],
        );
        if (membership.rowCount !== 1) {
          governanceFailure = 'recipient_unavailable';
        } else {
          const suppression = await transaction.query(
            `SELECT 1 FROM communication_suppressions
             WHERE subject_kind = 'person' AND subject_id = $1
               AND scope IN ('lifecycle','all') AND revoked_at IS NULL
               AND effective_at <= $2
             LIMIT 1`,
            [request.recipient_person_id, input.now.toISOString()],
          );
          if (suppression.rowCount > 0) governanceFailure = 'communication_suppressed';
        }
      }
      const state: NotificationDispatchState =
        request.state === 'queued'
          ? governanceFailure !== undefined
            ? 'failed'
            : request.channel === 'local_test'
              ? 'test_delivered'
              : 'blocked_external'
          : request.state;
      if (request.state === 'queued') {
        await transaction.query(
          `UPDATE notification_dispatch_requests
           SET state = $2, updated_at = $3 WHERE id = $1 AND state = 'queued'`,
          [request.id, state, input.now.toISOString()],
        );
      }
      await this.recordEvidence(transaction, {
        jobId: input.jobId,
        kind: 'notification_dispatch',
        outcome:
          state === 'test_delivered'
            ? 'test_delivered'
            : state === 'blocked_external'
              ? 'blocked_external'
              : 'attention',
        summary: {
          channel: request.channel,
          deliveryMode:
            state === 'test_delivered'
              ? 'test_sink'
              : state === 'blocked_external'
                ? 'provider_not_configured'
                : 'governance_blocked',
          ...(governanceFailure === undefined ? {} : { governanceFailure }),
          requestId: request.id,
          templateKey: request.template_key,
        },
        observedAt: input.now,
      });
      return state;
    });
  }

  async recordIntelligenceRefresh(input: {
    readonly jobId: string;
    readonly locale: string;
    readonly jurisdiction: string;
    readonly freshnessDays: number;
    readonly now: Date;
  }): Promise<OperationalJobEvidence> {
    if (
      !Number.isSafeInteger(input.freshnessDays) ||
      input.freshnessDays < 1 ||
      input.freshnessDays > 365
    ) {
      throw new DomainError('invalid_input', 'Intelligence freshness window is invalid');
    }
    const freshnessBoundary = new Date(input.now.getTime() - input.freshnessDays * 86_400_000);
    const counts = await this.database.query<
      {
        readonly total_assets: number;
        readonly runtime_eligible_assets: number;
        readonly stale_sources: number;
      } & Record<string, unknown>
    >(
      `WITH latest AS (
         SELECT DISTINCT ON (asset_key) id, lifecycle, review_state, v1_runtime_import,
           source_retrieved_at
         FROM knowledge_assets
         WHERE locale = $1 AND jurisdiction = $2
         ORDER BY asset_key, version DESC
       )
       SELECT count(*)::int AS total_assets,
         count(*) FILTER (WHERE lifecycle = 'active' AND review_state = 'independently_reviewed'
           AND v1_runtime_import = false
           AND EXISTS (SELECT 1 FROM knowledge_asset_reviews review
             WHERE review.knowledge_asset_id = latest.id AND review.review_kind = 'source'
               AND review.decision = 'approve')
           AND EXISTS (SELECT 1 FROM knowledge_asset_reviews review
             WHERE review.knowledge_asset_id = latest.id AND review.review_kind = 'domain'
               AND review.decision = 'approve')
           AND EXISTS (SELECT 1 FROM knowledge_asset_reviews review
             WHERE review.knowledge_asset_id = latest.id AND review.review_kind = 'rights'
               AND review.decision = 'approve')
           AND (SELECT count(DISTINCT review.reviewer_reference)
             FROM knowledge_asset_reviews review
             WHERE review.knowledge_asset_id = latest.id AND review.decision = 'approve') >= 2
         )::int AS runtime_eligible_assets,
         count(*) FILTER (WHERE source_retrieved_at < $3)::int AS stale_sources
       FROM latest`,
      [input.locale, input.jurisdiction, freshnessBoundary.toISOString()],
    );
    const row = counts.rows[0] ?? {
      total_assets: 0,
      runtime_eligible_assets: 0,
      stale_sources: 0,
    };
    const summary = {
      autoPublished: false,
      blockedAssets: row.total_assets - row.runtime_eligible_assets,
      freshnessDays: input.freshnessDays,
      jurisdiction: input.jurisdiction,
      locale: input.locale,
      runtimeEligibleAssets: row.runtime_eligible_assets,
      staleSources: row.stale_sources,
      totalAssets: row.total_assets,
    };
    return this.database.transaction(async (transaction) =>
      this.recordEvidence(transaction, {
        jobId: input.jobId,
        kind: 'intelligence_refresh',
        outcome: row.stale_sources > 0 ? 'attention' : 'completed',
        summary,
        observedAt: input.now,
      }),
    );
  }

  async recordEvaluationRun(input: {
    readonly jobId: string;
    readonly corpusKey: string;
    readonly corpusVersion: number;
    readonly cases: number;
    readonly passed: number;
    readonly failed: number;
    readonly forbiddenActionViolations: number;
    readonly providerFailures: number;
    readonly calibration: 'not_calibrated';
    readonly now: Date;
  }): Promise<OperationalJobEvidence> {
    const counts = [
      input.corpusVersion,
      input.cases,
      input.passed,
      input.failed,
      input.forbiddenActionViolations,
      input.providerFailures,
    ];
    if (
      !code.test(input.corpusKey) ||
      counts.some((count) => !Number.isSafeInteger(count) || count < 0) ||
      input.corpusVersion < 1 ||
      input.cases < 1 ||
      input.passed + input.failed !== input.cases
    ) {
      throw new DomainError('invalid_input', 'Evaluation evidence is inconsistent');
    }
    return this.database.transaction(async (transaction) =>
      this.recordEvidence(transaction, {
        jobId: input.jobId,
        kind: 'evaluation_run',
        outcome:
          input.failed === 0 && input.forbiddenActionViolations === 0 ? 'completed' : 'attention',
        summary: {
          calibration: input.calibration,
          cases: input.cases,
          corpusKey: input.corpusKey,
          corpusVersion: input.corpusVersion,
          failed: input.failed,
          forbiddenActionViolations: input.forbiddenActionViolations,
          passed: input.passed,
          providerFailures: input.providerFailures,
        },
        observedAt: input.now,
      }),
    );
  }

  async listEvidence(kind?: OperationalEvidenceKind): Promise<readonly OperationalJobEvidence[]> {
    const result = await this.database.query<EvidenceRow>(
      `SELECT id, job_id, evidence_kind, outcome, summary, observed_at
       FROM operational_job_evidence
       ${kind === undefined ? '' : 'WHERE evidence_kind = $1'}
       ORDER BY observed_at, id`,
      kind === undefined ? [] : [kind],
    );
    return result.rows.map(mapEvidence);
  }

  private async recordEvidence(
    executor: SqlExecutor,
    input: {
      readonly jobId: string;
      readonly kind: OperationalEvidenceKind;
      readonly outcome: OperationalEvidenceOutcome;
      readonly summary: Readonly<Record<string, string | number | boolean>>;
      readonly observedAt: Date;
    },
  ): Promise<OperationalJobEvidence> {
    const summary = validateSummary(input.summary);
    const id = this.ids.next('operational_evidence');
    await executor.query(
      `INSERT INTO operational_job_evidence(
         id, job_id, evidence_kind, outcome, summary, observed_at
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6)
       ON CONFLICT (job_id, evidence_kind) DO NOTHING`,
      [
        id,
        input.jobId,
        input.kind,
        input.outcome,
        jsonParameter(summary),
        input.observedAt.toISOString(),
      ],
    );
    const result = await executor.query<EvidenceRow>(
      `SELECT id, job_id, evidence_kind, outcome, summary, observed_at
       FROM operational_job_evidence WHERE job_id = $1 AND evidence_kind = $2`,
      [input.jobId, input.kind],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('Operational evidence was not persisted');
    const evidence = mapEvidence(row);
    if (evidence.outcome !== input.outcome || !summariesEqual(evidence.summary, summary)) {
      throw new DomainError(
        'conflict',
        'Operational job evidence conflicts with its first receipt',
      );
    }
    return evidence;
  }
}

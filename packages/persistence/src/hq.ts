import { DomainError, type CorrelationId, type PersonId } from '@boomerbuddy/domain';
import type { AccessIntentProjection } from './access-intents';
import type { Database } from './database';
import { EntitlementRepository, type EntitlementRuntimeEnvironment } from './entitlements';
import { growthProjectionEventTypes } from './growth-runtime';
import { asDate, placeholders, randomIdFactory, type IdFactory } from './values';

interface OverviewRow extends Record<string, unknown> {
  readonly households: number;
  readonly active_members: number;
  readonly completed_checks: number;
  readonly ready_orientations: number;
}

interface HqHouseholdRow extends Record<string, unknown> {
  readonly id: string;
  readonly name: string;
  readonly member_count: number;
  readonly orientation_ready_count: number;
}

interface HqCheckRow extends Record<string, unknown> {
  readonly id: string;
  readonly household_id: string;
  readonly kind: 'text' | 'url';
  readonly risk: 'lower_concern' | 'caution' | 'high_concern' | 'unknown';
  readonly provider_state: 'mock' | 'unknown' | 'unavailable' | 'verified';
  readonly created_at: unknown;
}

interface HqSupportCaseRow extends Record<string, unknown> {
  readonly id: string;
  readonly household_id: string;
  readonly household_name: string;
  readonly status: 'open';
  readonly assigned_at: unknown;
}

interface HqReviewCaseRow extends Record<string, unknown> {
  readonly id: string;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly state: 'open' | 'triaged' | 'in_progress';
  readonly routing_class:
    | 'self_service'
    | 'ai_assisted'
    | 'l1_human'
    | 'trust_safety'
    | 'billing'
    | 'security_privacy'
    | 'founder';
  readonly due_at: unknown | null;
  readonly updated_at: unknown;
}

interface ProviderRow extends Record<string, unknown> {
  readonly key: string;
  readonly state: 'mock' | 'unknown' | 'unavailable' | 'verified';
  readonly detail: string;
  readonly checked_at: unknown;
}

interface OperationalWorkerRow extends Record<string, unknown> {
  readonly observed_count: number;
  readonly running_count: number;
  readonly draining_count: number;
  readonly stopped_count: number;
  readonly stale_count: number;
  readonly clock_skew_count: number;
  readonly oldest_last_seen_at: unknown | null;
  readonly freshest_last_seen_at: unknown | null;
  readonly count_saturated: boolean;
}

interface OperationalJobRow extends Record<string, unknown> {
  readonly queued_count: number;
  readonly retry_count: number;
  readonly running_count: number;
  readonly stale_running_count: number;
  readonly exhausted_count: number;
  readonly dead_letter_count: number;
  readonly actionable_count: number;
  readonly oldest_actionable_at: unknown | null;
  readonly oldest_stale_running_at: unknown | null;
  readonly oldest_exhausted_at: unknown | null;
  readonly oldest_dead_lettered_at: unknown | null;
  readonly count_saturated: boolean;
}

interface OperationalOutboxRow extends Record<string, unknown> {
  readonly unprocessed_count: number;
  readonly exhausted_count: number;
  readonly causally_blocked_count: number;
  readonly dead_letter_count: number;
  readonly actionable_count: number;
  readonly oldest_actionable_at: unknown | null;
  readonly oldest_exhausted_at: unknown | null;
  readonly oldest_causally_blocked_at: unknown | null;
  readonly oldest_dead_lettered_at: unknown | null;
  readonly count_saturated: boolean;
}

interface AuditRow extends Record<string, unknown> {
  readonly id: string;
  readonly action: string;
  readonly resource_type: string;
  readonly resource_id: string | null;
  readonly outcome: 'allowed' | 'denied' | 'completed';
  readonly actor_person_id: string | null;
  readonly occurred_at: unknown;
}

interface SavedSearchRow extends Record<string, unknown> {
  readonly id: string;
  readonly name: string;
  readonly source: string;
  readonly result_count: number;
}

interface TargetRow extends Record<string, unknown> {
  readonly id: string;
  readonly name: string;
  readonly segment: string;
  readonly verification_state: string;
}

interface OpportunityRow extends Record<string, unknown> {
  readonly id: string;
  readonly account_id: string;
  readonly stage: string;
  readonly owner: string;
  readonly next_action: string;
  readonly next_action_at: unknown;
}

export interface HqProjectionAccess {
  readonly actorPersonId: PersonId;
  readonly correlationId: CorrelationId;
  readonly now: Date;
}

export interface OperationalHealthProjectionAccess {
  readonly actorPersonId: PersonId;
  readonly correlationId: CorrelationId;
  readonly observeNow: () => Date;
}

type HqEmployeeRole = 'hq_owner' | 'hq_reviewer' | 'hq_support';
type HqProjection =
  | 'owner_households'
  | 'owner_checks'
  | 'owner_access_intents'
  | 'owner_operational_health'
  | 'assigned_review_queue'
  | 'assigned_support_queue';

export interface OperationalHealthThresholds {
  readonly workerStaleAfterSeconds: number;
  readonly backlogStaleAfterSeconds: number;
  readonly clockSkewToleranceSeconds: number;
  readonly aggregateCountCeiling: number;
}

export const defaultOperationalHealthThresholds = Object.freeze({
  workerStaleAfterSeconds: 60,
  backlogStaleAfterSeconds: 300,
  clockSkewToleranceSeconds: 5,
  aggregateCountCeiling: 1_000_000,
}) satisfies OperationalHealthThresholds;

export const operationalHealthAttentionCodes = [
  'worker_missing',
  'worker_stale',
  'worker_stopped',
  'worker_draining',
  'worker_clock_skew',
  'worker_count_saturated',
  'job_backlog_stale',
  'job_running_stale',
  'job_exhausted',
  'job_dead_letter',
  'job_clock_skew',
  'job_count_saturated',
  'outbox_backlog_stale',
  'outbox_exhausted',
  'outbox_causally_blocked',
  'outbox_dead_letter',
  'outbox_clock_skew',
  'outbox_count_saturated',
] as const;

export type OperationalHealthAttentionCode = (typeof operationalHealthAttentionCodes)[number];
type OperationalHealthStatus = 'healthy' | 'warning' | 'critical';

function assertOperationalHealthThresholds(
  thresholds: OperationalHealthThresholds,
): OperationalHealthThresholds {
  if (
    !Number.isSafeInteger(thresholds.workerStaleAfterSeconds) ||
    thresholds.workerStaleAfterSeconds < 10 ||
    thresholds.workerStaleAfterSeconds > 3_600 ||
    !Number.isSafeInteger(thresholds.backlogStaleAfterSeconds) ||
    thresholds.backlogStaleAfterSeconds < 30 ||
    thresholds.backlogStaleAfterSeconds > 86_400 ||
    !Number.isSafeInteger(thresholds.clockSkewToleranceSeconds) ||
    thresholds.clockSkewToleranceSeconds < 1 ||
    thresholds.clockSkewToleranceSeconds > 30 ||
    !Number.isSafeInteger(thresholds.aggregateCountCeiling) ||
    thresholds.aggregateCountCeiling < 1_000 ||
    thresholds.aggregateCountCeiling > 1_000_000
  ) {
    throw new TypeError('Operational-health thresholds are outside the fail-closed safety bounds');
  }
  return thresholds;
}

function operationalAge(
  value: unknown | null,
  now: Date,
  label: string,
  clockSkewToleranceSeconds: number,
): { readonly seconds: number | null; readonly clockSkew: boolean } {
  if (value === null) return { seconds: null, clockSkew: false };
  const timestamp = asDate(value, label);
  const ageMilliseconds = now.getTime() - timestamp.getTime();
  if (ageMilliseconds < -clockSkewToleranceSeconds * 1_000) {
    return { seconds: 0, clockSkew: true };
  }
  if (ageMilliseconds < 0) return { seconds: 0, clockSkew: false };
  return { seconds: Math.floor(ageMilliseconds / 1_000), clockSkew: false };
}

function combineOperationalStatus(
  statuses: readonly OperationalHealthStatus[],
): OperationalHealthStatus {
  if (statuses.includes('critical')) return 'critical';
  if (statuses.includes('warning')) return 'warning';
  return 'healthy';
}

export class HqRepository {
  constructor(
    private readonly database: Database,
    private readonly ids: IdFactory = randomIdFactory,
    private readonly runtimeEnvironment: EntitlementRuntimeEnvironment = 'production',
  ) {}

  private async assertActiveRole(actorPersonId: PersonId, role: HqEmployeeRole): Promise<void> {
    const result = await this.database.query<Record<string, unknown>>(
      `SELECT 1 FROM employee_assignments employee
       JOIN organizations organization ON organization.id = employee.organization_id
       WHERE employee.person_id = $1 AND employee.role = $2 AND employee.status = 'active'
         AND organization.kind = 'internal'
       LIMIT 1`,
      [actorPersonId, role],
    );
    if (result.rows.length === 0) {
      throw new DomainError(
        'not_authorized',
        'HQ projection access requires a current internal employee assignment',
      );
    }
  }

  private async auditProjectionAccess(
    access: HqProjectionAccess,
    projection: HqProjection,
  ): Promise<void> {
    await this.database.query(
      `INSERT INTO audit_events(
         id, household_id, actor_person_id, session_audience, action, resource_type,
         resource_id, outcome, metadata, correlation_id, occurred_at
       ) VALUES ($1,NULL,$2,'hq','hq.metadata_projection.read','hq_projection',
         $3,'allowed',$4::jsonb,$5,$6)`,
      [
        this.ids.next('audit'),
        access.actorPersonId,
        projection,
        JSON.stringify({ projection }),
        access.correlationId,
        access.now.toISOString(),
      ],
    );
  }

  async overview(now: Date): Promise<{
    readonly metrics: readonly {
      readonly key: string;
      readonly label: string;
      readonly value: number;
      readonly source: string;
      readonly updatedAt: Date;
    }[];
    readonly alerts: readonly {
      readonly key: string;
      readonly severity: 'info' | 'warning' | 'critical';
      readonly message: string;
    }[];
  }> {
    const [result, households] = await Promise.all([
      this.database.query<OverviewRow>(
        `
      SELECT
        (SELECT count(*)::int FROM households) AS households,
        (SELECT count(*)::int FROM household_memberships WHERE status = 'active') AS active_members,
        (SELECT count(*)::int FROM analyses a
          JOIN artifacts r ON r.household_id = a.household_id AND r.id = a.artifact_id
          WHERE a.state = 'completed' AND r.state = 'active' AND r.delete_after > $1
        ) AS completed_checks,
        (SELECT count(*)::int FROM orientation_states WHERE status = 'ready') AS ready_orientations
    `,
        [now.toISOString()],
      ),
      this.database.query<{ id: string } & Record<string, unknown>>(
        'SELECT id FROM households ORDER BY id',
      ),
    ]);
    const entitlementRepository = new EntitlementRepository(
      this.database,
      undefined,
      this.runtimeEnvironment,
    );
    const entitlementStates = await Promise.all(
      households.rows.map((household) => entitlementRepository.forHousehold(household.id, now)),
    );
    const activeEntitlements = entitlementStates.filter(
      (entitlements) => entitlements.portfolio.accessState === 'effective',
    ).length;
    const row = result.rows[0] ?? {
      households: 0,
      active_members: 0,
      completed_checks: 0,
      ready_orientations: 0,
    };
    return {
      metrics: [
        {
          key: 'households',
          label: 'Local households',
          value: row.households,
          source: 'local_development',
          updatedAt: now,
        },
        {
          key: 'members',
          label: 'Local active members',
          value: row.active_members,
          source: 'local_development',
          updatedAt: now,
        },
        {
          key: 'checks',
          label: 'Local completed Checks',
          value: row.completed_checks,
          source: 'local_development',
          updatedAt: now,
        },
        {
          key: 'orientation_ready',
          label: 'Local ready orientations',
          value: row.ready_orientations,
          source: 'local_development',
          updatedAt: now,
        },
        {
          key: 'entitled_households',
          label: 'Local entitled households',
          value: activeEntitlements,
          source: 'local_development',
          updatedAt: now,
        },
      ],
      alerts: [
        {
          key: 'development_data',
          severity: 'info',
          message:
            'Metrics combine synthetic seed fixtures with interactions from this local run; they are not production evidence.',
        },
      ],
    };
  }

  async ownerHouseholds(access: HqProjectionAccess): Promise<
    readonly {
      readonly id: string;
      readonly name: string;
      readonly memberCount: number;
      readonly orientationReadyCount: number;
      readonly entitlementState: 'active' | 'inactive';
    }[]
  > {
    await this.assertActiveRole(access.actorPersonId, 'hq_owner');
    await this.auditProjectionAccess(access, 'owner_households');
    const result = await this.database.query<HqHouseholdRow>(
      `
      SELECT h.id, h.name,
        count(DISTINCT m.id)::int AS member_count,
        count(DISTINCT o.person_id) FILTER (WHERE o.status = 'ready')::int AS orientation_ready_count
      FROM households h
      LEFT JOIN household_memberships m ON m.household_id = h.id AND m.status = 'active'
      LEFT JOIN orientation_states o ON o.household_id = h.id
      WHERE EXISTS (
        SELECT 1 FROM employee_assignments employee
        JOIN organizations organization ON organization.id = employee.organization_id
        WHERE employee.person_id = $1 AND employee.role = 'hq_owner'
          AND employee.status = 'active' AND organization.kind = 'internal'
      )
      GROUP BY h.id, h.name ORDER BY h.name
      LIMIT 101
    `,
      [access.actorPersonId],
    );
    const entitlementRepository = new EntitlementRepository(
      this.database,
      undefined,
      this.runtimeEnvironment,
    );
    return Promise.all(
      result.rows.map(async (row) => {
        const entitlements = await entitlementRepository.forHousehold(row.id, access.now);
        return {
          id: row.id,
          name: row.name,
          memberCount: row.member_count,
          orientationReadyCount: row.orientation_ready_count,
          entitlementState:
            entitlements.portfolio.accessState === 'effective'
              ? ('active' as const)
              : ('inactive' as const),
        };
      }),
    );
  }

  async ownerChecks(access: HqProjectionAccess): Promise<
    readonly {
      readonly id: string;
      readonly householdId: string;
      readonly kind: 'text' | 'url';
      readonly risk: HqCheckRow['risk'];
      readonly providerState: HqCheckRow['provider_state'];
      readonly createdAt: Date;
    }[]
  > {
    await this.assertActiveRole(access.actorPersonId, 'hq_owner');
    await this.auditProjectionAccess(access, 'owner_checks');
    const result = await this.database.query<HqCheckRow>(
      `
      SELECT a.id, a.household_id, r.kind, a.risk, a.provider_state, a.created_at
      FROM analyses a JOIN artifacts r ON r.household_id = a.household_id AND r.id = a.artifact_id
      WHERE a.state = 'completed' AND r.state = 'active' AND r.delete_after > $1
        AND EXISTS (
          SELECT 1 FROM employee_assignments employee
          JOIN organizations organization ON organization.id = employee.organization_id
          WHERE employee.person_id = $2 AND employee.role = 'hq_owner'
            AND employee.status = 'active' AND organization.kind = 'internal'
        )
      ORDER BY a.created_at DESC LIMIT 100
    `,
      [access.now.toISOString(), access.actorPersonId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      householdId: row.household_id,
      kind: row.kind,
      risk: row.risk,
      providerState: row.provider_state,
      createdAt: asDate(row.created_at, 'analyses.created_at'),
    }));
  }

  async ownerAccessIntents(
    access: HqProjectionAccess,
    limit = 100,
  ): Promise<{ readonly intents: readonly AccessIntentProjection[]; readonly truncated: boolean }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError('Access-intent projection limit must be between 1 and 100');
    }
    await this.assertActiveRole(access.actorPersonId, 'hq_owner');
    await this.auditProjectionAccess(access, 'owner_access_intents');
    const result = await this.database.query<
      {
        readonly receipt_code: string;
        readonly purpose: 'private_beta_access_request';
        readonly attribution_source: AccessIntentProjection['attribution']['source'];
        readonly attribution_campaign: AccessIntentProjection['attribution']['campaign'];
        readonly lifecycle_state: 'intent_created';
        readonly created_at: unknown;
        readonly expires_at: unknown;
      } & Record<string, unknown>
    >(
      `SELECT receipt_code, purpose, attribution_source, attribution_campaign,
              lifecycle_state, created_at, expires_at
       FROM private_beta_access_intent_receipts
       WHERE EXISTS (
         SELECT 1 FROM employee_assignments employee
         JOIN organizations organization ON organization.id = employee.organization_id
         WHERE employee.person_id = $1 AND employee.role = 'hq_owner'
           AND employee.status = 'active' AND organization.kind = 'internal'
       )
       ORDER BY created_at DESC, receipt_code
       LIMIT $2`,
      [access.actorPersonId, limit + 1],
    );
    return {
      intents: result.rows.slice(0, limit).map((row) => {
        const createdAt = asDate(row.created_at, 'access-intent creation');
        const expiresAt = asDate(row.expires_at, 'access-intent expiry');
        return {
          receiptCode: row.receipt_code,
          purpose: row.purpose,
          attribution: {
            source: row.attribution_source,
            campaign: row.attribution_campaign,
          },
          lifecycle: expiresAt <= access.now ? 'expired' : row.lifecycle_state,
          createdAt,
          expiresAt,
        };
      }),
      truncated: result.rows.length > limit,
    };
  }

  async assignedSupportCases(access: HqProjectionAccess): Promise<
    readonly {
      readonly id: string;
      readonly householdId: string;
      readonly householdName: string;
      readonly purposeCode: 'customer_support';
      readonly status: 'open';
      readonly assignedAt: Date;
    }[]
  > {
    await this.assertActiveRole(access.actorPersonId, 'hq_support');
    await this.auditProjectionAccess(access, 'assigned_support_queue');
    const result = await this.database.query<HqSupportCaseRow>(
      `SELECT support_case.id, support_case.household_id,
              household.name AS household_name, support_case.status,
              assignment.assigned_at
       FROM support_case_assignments assignment
       JOIN support_cases support_case
         ON support_case.household_id = assignment.household_id
        AND support_case.id = assignment.case_id
       JOIN households household ON household.id = support_case.household_id
       JOIN employee_assignments employee
         ON employee.id = assignment.employee_assignment_id
       JOIN organizations organization ON organization.id = employee.organization_id
       WHERE employee.person_id = $1 AND employee.role = 'hq_support'
         AND employee.status = 'active' AND assignment.status = 'active'
         AND support_case.status = 'open' AND organization.kind = 'internal'
       ORDER BY assignment.assigned_at, support_case.id
       LIMIT 101`,
      [access.actorPersonId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      householdId: row.household_id,
      householdName: row.household_name,
      purposeCode: 'customer_support',
      status: row.status,
      assignedAt: asDate(row.assigned_at, 'support_case_assignments.assigned_at'),
    }));
  }

  async assignedReviewCases(access: HqProjectionAccess): Promise<
    readonly {
      readonly id: string;
      readonly severity: HqReviewCaseRow['severity'];
      readonly state: HqReviewCaseRow['state'];
      readonly routingClass: HqReviewCaseRow['routing_class'];
      readonly dueAt?: Date;
      readonly updatedAt: Date;
    }[]
  > {
    await this.assertActiveRole(access.actorPersonId, 'hq_reviewer');
    await this.auditProjectionAccess(access, 'assigned_review_queue');
    const result = await this.database.query<HqReviewCaseRow>(
      `SELECT work_case.id, work_case.severity, work_case.state,
              work_case.routing_class, work_case.due_at, work_case.updated_at
       FROM hq_work_cases work_case
       WHERE work_case.assigned_person_id = $1 AND work_case.case_kind = 'fraud'
         AND work_case.state IN ('open','triaged','in_progress')
         AND EXISTS (
           SELECT 1 FROM employee_assignments employee
           JOIN organizations organization ON organization.id = employee.organization_id
           WHERE employee.person_id = $1 AND employee.role = 'hq_reviewer'
             AND employee.status = 'active' AND organization.kind = 'internal'
         )
       ORDER BY work_case.due_at NULLS LAST, work_case.updated_at, work_case.id
       LIMIT 101`,
      [access.actorPersonId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      severity: row.severity,
      state: row.state,
      routingClass: row.routing_class,
      ...(row.due_at === null ? {} : { dueAt: asDate(row.due_at, 'hq_work_cases.due_at') }),
      updatedAt: asDate(row.updated_at, 'hq_work_cases.updated_at'),
    }));
  }

  async ownerOperationalHealth(
    access: OperationalHealthProjectionAccess,
    configuredThresholds: OperationalHealthThresholds = defaultOperationalHealthThresholds,
  ): Promise<{
    readonly projection: 'content_free_operational_health';
    readonly generatedAt: Date;
    readonly status: OperationalHealthStatus;
    readonly thresholds: OperationalHealthThresholds;
    readonly workers: {
      readonly status: OperationalHealthStatus;
      readonly observedCount: number;
      readonly runningCount: number;
      readonly drainingCount: number;
      readonly stoppedCount: number;
      readonly staleCount: number;
      readonly clockSkewCount: number;
      readonly oldestActiveHeartbeatAgeSeconds: number | null;
      readonly freshestActiveHeartbeatAgeSeconds: number | null;
      readonly countSaturated: boolean;
    };
    readonly durableJobs: {
      readonly status: OperationalHealthStatus;
      readonly queuedCount: number;
      readonly retryCount: number;
      readonly runningCount: number;
      readonly staleRunningCount: number;
      readonly exhaustedCount: number;
      readonly deadLetterCount: number;
      readonly actionableCount: number;
      readonly oldestActionableAgeSeconds: number | null;
      readonly oldestStaleRunningAgeSeconds: number | null;
      readonly oldestExhaustedAgeSeconds: number | null;
      readonly oldestDeadLetterAgeSeconds: number | null;
      readonly countSaturated: boolean;
    };
    readonly outbox: {
      readonly status: OperationalHealthStatus;
      readonly unprocessedCount: number;
      readonly exhaustedCount: number;
      readonly causallyBlockedCount: number;
      readonly deadLetterCount: number;
      readonly actionableCount: number;
      readonly oldestActionableAgeSeconds: number | null;
      readonly oldestExhaustedAgeSeconds: number | null;
      readonly oldestCausallyBlockedAgeSeconds: number | null;
      readonly oldestDeadLetterAgeSeconds: number | null;
      readonly countSaturated: boolean;
    };
    readonly attentionCodes: readonly OperationalHealthAttentionCode[];
  }> {
    const thresholds = assertOperationalHealthThresholds(configuredThresholds);
    await this.assertActiveRole(access.actorPersonId, 'hq_owner');
    const observedAt = access.observeNow();
    if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
      throw new TypeError('Operational-health projection time is invalid');
    }
    const now = new Date(observedAt.getTime());
    await this.auditProjectionAccess(
      {
        actorPersonId: access.actorPersonId,
        correlationId: access.correlationId,
        now,
      },
      'owner_operational_health',
    );

    const nowIso = now.toISOString();
    const staleWorkerCutoff = new Date(
      now.getTime() - thresholds.workerStaleAfterSeconds * 1_000,
    ).toISOString();
    const futureTimestampCutoff = new Date(
      now.getTime() + thresholds.clockSkewToleranceSeconds * 1_000,
    ).toISOString();
    const ceiling = thresholds.aggregateCountCeiling;
    const handledEventTypeSlots = placeholders(3, growthProjectionEventTypes.length);
    const [workerResult, jobResult, outboxResult] = await Promise.all([
      this.database.query<OperationalWorkerRow>(
        `SELECT
           LEAST(count(*), $3::integer)::integer AS observed_count,
           LEAST(count(*) FILTER (WHERE state = 'running'), $3::integer)::integer AS running_count,
           LEAST(count(*) FILTER (WHERE state = 'draining'), $3::integer)::integer AS draining_count,
           LEAST(count(*) FILTER (WHERE state = 'stopped'), $3::integer)::integer AS stopped_count,
           LEAST(count(*) FILTER (
             WHERE state IN ('running','draining') AND last_seen_at < $1
           ), $3::integer)::integer AS stale_count,
           LEAST(count(*) FILTER (
             WHERE state IN ('running','draining') AND last_seen_at > $2
           ), $3::integer)::integer AS clock_skew_count,
           min(last_seen_at) FILTER (
             WHERE state IN ('running','draining')
           ) AS oldest_last_seen_at,
           max(last_seen_at) FILTER (
             WHERE state IN ('running','draining')
           ) AS freshest_last_seen_at,
           count(*) > $3::integer AS count_saturated
         FROM worker_heartbeats`,
        [staleWorkerCutoff, futureTimestampCutoff, ceiling],
      ),
      this.database.query<OperationalJobRow>(
        `WITH RECURSIVE resolved_job_replay_ids(id) AS (
           SELECT replay_of_job_id
           FROM durable_jobs
           WHERE state = 'succeeded' AND replay_of_job_id IS NOT NULL
           UNION
           SELECT ancestor.replay_of_job_id
           FROM durable_jobs AS ancestor
           JOIN resolved_job_replay_ids AS resolved ON ancestor.id = resolved.id
           WHERE ancestor.replay_of_job_id IS NOT NULL
         )
         SELECT
           LEAST(count(*) FILTER (WHERE job.state = 'queued'), $2::integer)::integer AS queued_count,
           LEAST(count(*) FILTER (WHERE job.state = 'retry'), $2::integer)::integer AS retry_count,
           LEAST(count(*) FILTER (WHERE job.state = 'running'), $2::integer)::integer AS running_count,
           LEAST(count(*) FILTER (
             WHERE job.state = 'running' AND job.lease_expires_at <= $1
           ), $2::integer)::integer AS stale_running_count,
           LEAST(count(*) FILTER (
             WHERE job.state IN ('queued','retry') AND job.attempts >= job.max_attempts
           ), $2::integer)::integer AS exhausted_count,
           LEAST(count(*) FILTER (
             WHERE job.state = 'dead_letter'
               AND NOT EXISTS (
                 SELECT 1 FROM resolved_job_replay_ids AS resolved WHERE resolved.id = job.id
               )
           ), $2::integer)::integer AS dead_letter_count,
           LEAST(count(*) FILTER (
             WHERE job.state IN ('queued','retry') AND job.next_attempt_at <= $1
               AND job.attempts < job.max_attempts
           ), $2::integer)::integer AS actionable_count,
           min(job.next_attempt_at) FILTER (
             WHERE job.state IN ('queued','retry') AND job.next_attempt_at <= $1
               AND job.attempts < job.max_attempts
           ) AS oldest_actionable_at,
           min(job.lease_expires_at) FILTER (
             WHERE job.state = 'running' AND job.lease_expires_at <= $1
           ) AS oldest_stale_running_at,
           min(job.created_at) FILTER (
             WHERE job.state IN ('queued','retry') AND job.attempts >= job.max_attempts
           ) AS oldest_exhausted_at,
           min(job.dead_lettered_at) FILTER (
             WHERE job.state = 'dead_letter'
               AND NOT EXISTS (
                 SELECT 1 FROM resolved_job_replay_ids AS resolved WHERE resolved.id = job.id
               )
           ) AS oldest_dead_lettered_at,
           (
             count(*) FILTER (WHERE job.state = 'queued') > $2::integer OR
             count(*) FILTER (WHERE job.state = 'retry') > $2::integer OR
             count(*) FILTER (WHERE job.state = 'running') > $2::integer OR
             count(*) FILTER (
               WHERE job.state = 'running' AND job.lease_expires_at <= $1
             ) > $2::integer OR
             count(*) FILTER (
               WHERE job.state IN ('queued','retry') AND job.attempts >= job.max_attempts
             ) > $2::integer OR
             count(*) FILTER (
               WHERE job.state = 'dead_letter'
                 AND NOT EXISTS (
                   SELECT 1 FROM resolved_job_replay_ids AS resolved WHERE resolved.id = job.id
                 )
             ) > $2::integer OR
             count(*) FILTER (
               WHERE job.state IN ('queued','retry') AND job.next_attempt_at <= $1
                 AND job.attempts < job.max_attempts
             ) > $2::integer
           ) AS count_saturated
         FROM durable_jobs AS job`,
        [nowIso, ceiling],
      ),
      this.database.query<OperationalOutboxRow>(
        `WITH handled_events AS (
           SELECT
             event.processed_at,
             event.dead_lettered_at,
             event.replay_resolved_at,
             event.attempts,
             event.max_attempts,
             event.lease_expires_at,
             event.next_attempt_at,
             event.occurred_at,
             EXISTS (
               SELECT 1 FROM outbox_events AS prior
               WHERE prior.aggregate_type = event.aggregate_type
                 AND prior.aggregate_id = event.aggregate_id
                 AND prior.household_id IS NOT DISTINCT FROM event.household_id
                 AND prior.processed_at IS NULL
                 AND (prior.dead_lettered_at IS NULL OR prior.replay_resolved_at IS NULL)
                 AND prior.causal_order_position < event.causal_order_position
             ) AS has_unresolved_predecessor,
             EXISTS (
               SELECT 1 FROM outbox_events AS prior
               WHERE prior.aggregate_type = event.aggregate_type
                 AND prior.aggregate_id = event.aggregate_id
                 AND prior.household_id IS NOT DISTINCT FROM event.household_id
                 AND prior.processed_at IS NULL
                 AND (prior.dead_lettered_at IS NULL OR prior.replay_resolved_at IS NULL)
                 AND prior.causal_order_position < event.causal_order_position
                 AND prior.event_type NOT IN (${handledEventTypeSlots})
             ) AS has_unhandled_predecessor
           FROM outbox_events AS event
           WHERE event.event_type IN (${handledEventTypeSlots})
         )
         SELECT
           LEAST(count(*) FILTER (
             WHERE event.processed_at IS NULL AND event.dead_lettered_at IS NULL
           ), $2::integer)::integer AS unprocessed_count,
           LEAST(count(*) FILTER (
             WHERE event.processed_at IS NULL AND event.dead_lettered_at IS NULL
               AND event.attempts >= event.max_attempts
               AND (event.lease_expires_at IS NULL OR event.lease_expires_at <= $1)
           ), $2::integer)::integer AS exhausted_count,
           LEAST(count(*) FILTER (
             WHERE event.processed_at IS NULL AND event.dead_lettered_at IS NULL
               AND event.next_attempt_at <= $1
               AND event.attempts < event.max_attempts
               AND (event.lease_expires_at IS NULL OR event.lease_expires_at <= $1)
               AND event.has_unhandled_predecessor
           ), $2::integer)::integer AS causally_blocked_count,
           LEAST(count(*) FILTER (
             WHERE event.processed_at IS NULL AND event.dead_lettered_at IS NOT NULL
               AND event.replay_resolved_at IS NULL
           ), $2::integer)::integer AS dead_letter_count,
           LEAST(count(*) FILTER (
             WHERE event.processed_at IS NULL AND event.dead_lettered_at IS NULL
               AND event.next_attempt_at <= $1
               AND event.attempts < event.max_attempts
               AND (event.lease_expires_at IS NULL OR event.lease_expires_at <= $1)
               AND NOT event.has_unresolved_predecessor
           ), $2::integer)::integer AS actionable_count,
           min(event.next_attempt_at) FILTER (
             WHERE event.processed_at IS NULL AND event.dead_lettered_at IS NULL
               AND event.next_attempt_at <= $1
               AND event.attempts < event.max_attempts
               AND (event.lease_expires_at IS NULL OR event.lease_expires_at <= $1)
               AND NOT event.has_unresolved_predecessor
           ) AS oldest_actionable_at,
           min(event.occurred_at) FILTER (
             WHERE event.processed_at IS NULL AND event.dead_lettered_at IS NULL
               AND event.attempts >= event.max_attempts
               AND (event.lease_expires_at IS NULL OR event.lease_expires_at <= $1)
           ) AS oldest_exhausted_at,
           min(event.next_attempt_at) FILTER (
             WHERE event.processed_at IS NULL AND event.dead_lettered_at IS NULL
               AND event.next_attempt_at <= $1
               AND event.attempts < event.max_attempts
               AND (event.lease_expires_at IS NULL OR event.lease_expires_at <= $1)
               AND event.has_unhandled_predecessor
           ) AS oldest_causally_blocked_at,
           min(event.dead_lettered_at) FILTER (
             WHERE event.processed_at IS NULL AND event.dead_lettered_at IS NOT NULL
               AND event.replay_resolved_at IS NULL
           ) AS oldest_dead_lettered_at,
           (
             count(*) FILTER (
               WHERE event.processed_at IS NULL AND event.dead_lettered_at IS NULL
             ) > $2::integer OR
             count(*) FILTER (
               WHERE event.processed_at IS NULL AND event.dead_lettered_at IS NULL
                 AND event.attempts >= event.max_attempts
                 AND (event.lease_expires_at IS NULL OR event.lease_expires_at <= $1)
             ) > $2::integer OR
             count(*) FILTER (
               WHERE event.processed_at IS NULL AND event.dead_lettered_at IS NULL
                 AND event.next_attempt_at <= $1
                 AND event.attempts < event.max_attempts
                 AND (event.lease_expires_at IS NULL OR event.lease_expires_at <= $1)
                 AND event.has_unhandled_predecessor
             ) > $2::integer OR
             count(*) FILTER (
               WHERE event.processed_at IS NULL AND event.dead_lettered_at IS NOT NULL
                 AND event.replay_resolved_at IS NULL
             ) > $2::integer OR
             count(*) FILTER (
               WHERE event.processed_at IS NULL AND event.dead_lettered_at IS NULL
                 AND event.next_attempt_at <= $1
                 AND event.attempts < event.max_attempts
                 AND (event.lease_expires_at IS NULL OR event.lease_expires_at <= $1)
                 AND NOT event.has_unresolved_predecessor
             ) > $2::integer
           ) AS count_saturated
         FROM handled_events AS event`,
        [nowIso, ceiling, ...growthProjectionEventTypes],
      ),
    ]);
    const worker = workerResult.rows[0];
    const jobs = jobResult.rows[0];
    const outbox = outboxResult.rows[0];
    if (worker === undefined || jobs === undefined || outbox === undefined) {
      throw new TypeError('Operational-health aggregate query returned no row');
    }

    const oldestWorker = operationalAge(
      worker.oldest_last_seen_at,
      now,
      'worker_heartbeats.oldest_last_seen_at',
      thresholds.clockSkewToleranceSeconds,
    );
    const freshestWorker = operationalAge(
      worker.freshest_last_seen_at,
      now,
      'worker_heartbeats.freshest_last_seen_at',
      thresholds.clockSkewToleranceSeconds,
    );
    const oldestJob = operationalAge(
      jobs.oldest_actionable_at,
      now,
      'durable_jobs.oldest_actionable_at',
      thresholds.clockSkewToleranceSeconds,
    );
    const oldestDeadLetterJob = operationalAge(
      jobs.oldest_dead_lettered_at,
      now,
      'durable_jobs.oldest_dead_lettered_at',
      thresholds.clockSkewToleranceSeconds,
    );
    const oldestStaleRunningJob = operationalAge(
      jobs.oldest_stale_running_at,
      now,
      'durable_jobs.oldest_stale_running_at',
      thresholds.clockSkewToleranceSeconds,
    );
    const oldestExhaustedJob = operationalAge(
      jobs.oldest_exhausted_at,
      now,
      'durable_jobs.oldest_exhausted_at',
      thresholds.clockSkewToleranceSeconds,
    );
    const oldestOutbox = operationalAge(
      outbox.oldest_actionable_at,
      now,
      'outbox_events.oldest_actionable_at',
      thresholds.clockSkewToleranceSeconds,
    );
    const oldestDeadLetterOutbox = operationalAge(
      outbox.oldest_dead_lettered_at,
      now,
      'outbox_events.oldest_dead_lettered_at',
      thresholds.clockSkewToleranceSeconds,
    );
    const oldestExhaustedOutbox = operationalAge(
      outbox.oldest_exhausted_at,
      now,
      'outbox_events.oldest_exhausted_at',
      thresholds.clockSkewToleranceSeconds,
    );
    const oldestCausallyBlockedOutbox = operationalAge(
      outbox.oldest_causally_blocked_at,
      now,
      'outbox_events.oldest_causally_blocked_at',
      thresholds.clockSkewToleranceSeconds,
    );

    const workerClockSkew =
      worker.clock_skew_count > 0 || oldestWorker.clockSkew || freshestWorker.clockSkew;
    const workerCritical =
      worker.observed_count === 0 ||
      worker.running_count === 0 ||
      worker.stale_count > 0 ||
      workerClockSkew ||
      worker.count_saturated;
    const workerStatus: OperationalHealthStatus = workerCritical
      ? 'critical'
      : worker.draining_count > 0
        ? 'warning'
        : 'healthy';

    const jobClockSkew =
      oldestJob.clockSkew ||
      oldestStaleRunningJob.clockSkew ||
      oldestExhaustedJob.clockSkew ||
      oldestDeadLetterJob.clockSkew;
    const jobBacklogStale =
      oldestJob.seconds !== null && oldestJob.seconds > thresholds.backlogStaleAfterSeconds;
    const jobStatus: OperationalHealthStatus =
      jobs.stale_running_count > 0 ||
      jobs.exhausted_count > 0 ||
      jobs.dead_letter_count > 0 ||
      jobClockSkew ||
      jobs.count_saturated
        ? 'critical'
        : jobBacklogStale
          ? 'warning'
          : 'healthy';

    const outboxClockSkew =
      oldestOutbox.clockSkew ||
      oldestExhaustedOutbox.clockSkew ||
      oldestCausallyBlockedOutbox.clockSkew ||
      oldestDeadLetterOutbox.clockSkew;
    const outboxBacklogStale =
      oldestOutbox.seconds !== null && oldestOutbox.seconds > thresholds.backlogStaleAfterSeconds;
    const outboxStatus: OperationalHealthStatus =
      outbox.exhausted_count > 0 ||
      outbox.causally_blocked_count > 0 ||
      outbox.dead_letter_count > 0 ||
      outboxClockSkew ||
      outbox.count_saturated
        ? 'critical'
        : outboxBacklogStale
          ? 'warning'
          : 'healthy';

    const attentionCodes: OperationalHealthAttentionCode[] = [];
    if (worker.observed_count === 0) attentionCodes.push('worker_missing');
    if (worker.stale_count > 0) attentionCodes.push('worker_stale');
    if (worker.observed_count > 0 && worker.running_count === 0 && worker.draining_count === 0) {
      attentionCodes.push('worker_stopped');
    }
    if (worker.draining_count > 0) attentionCodes.push('worker_draining');
    if (workerClockSkew) attentionCodes.push('worker_clock_skew');
    if (worker.count_saturated) attentionCodes.push('worker_count_saturated');
    if (jobBacklogStale) attentionCodes.push('job_backlog_stale');
    if (jobs.stale_running_count > 0) attentionCodes.push('job_running_stale');
    if (jobs.exhausted_count > 0) attentionCodes.push('job_exhausted');
    if (jobs.dead_letter_count > 0) attentionCodes.push('job_dead_letter');
    if (jobClockSkew) attentionCodes.push('job_clock_skew');
    if (jobs.count_saturated) attentionCodes.push('job_count_saturated');
    if (outboxBacklogStale) attentionCodes.push('outbox_backlog_stale');
    if (outbox.exhausted_count > 0) attentionCodes.push('outbox_exhausted');
    if (outbox.causally_blocked_count > 0) attentionCodes.push('outbox_causally_blocked');
    if (outbox.dead_letter_count > 0) attentionCodes.push('outbox_dead_letter');
    if (outboxClockSkew) attentionCodes.push('outbox_clock_skew');
    if (outbox.count_saturated) attentionCodes.push('outbox_count_saturated');

    return {
      projection: 'content_free_operational_health',
      generatedAt: new Date(now),
      status: combineOperationalStatus([workerStatus, jobStatus, outboxStatus]),
      thresholds,
      workers: {
        status: workerStatus,
        observedCount: worker.observed_count,
        runningCount: worker.running_count,
        drainingCount: worker.draining_count,
        stoppedCount: worker.stopped_count,
        staleCount: worker.stale_count,
        clockSkewCount: worker.clock_skew_count,
        oldestActiveHeartbeatAgeSeconds: oldestWorker.seconds,
        freshestActiveHeartbeatAgeSeconds: freshestWorker.seconds,
        countSaturated: worker.count_saturated,
      },
      durableJobs: {
        status: jobStatus,
        queuedCount: jobs.queued_count,
        retryCount: jobs.retry_count,
        runningCount: jobs.running_count,
        staleRunningCount: jobs.stale_running_count,
        exhaustedCount: jobs.exhausted_count,
        deadLetterCount: jobs.dead_letter_count,
        actionableCount: jobs.actionable_count,
        oldestActionableAgeSeconds: oldestJob.seconds,
        oldestStaleRunningAgeSeconds: oldestStaleRunningJob.seconds,
        oldestExhaustedAgeSeconds: oldestExhaustedJob.seconds,
        oldestDeadLetterAgeSeconds: oldestDeadLetterJob.seconds,
        countSaturated: jobs.count_saturated,
      },
      outbox: {
        status: outboxStatus,
        unprocessedCount: outbox.unprocessed_count,
        exhaustedCount: outbox.exhausted_count,
        causallyBlockedCount: outbox.causally_blocked_count,
        deadLetterCount: outbox.dead_letter_count,
        actionableCount: outbox.actionable_count,
        oldestActionableAgeSeconds: oldestOutbox.seconds,
        oldestExhaustedAgeSeconds: oldestExhaustedOutbox.seconds,
        oldestCausallyBlockedAgeSeconds: oldestCausallyBlockedOutbox.seconds,
        oldestDeadLetterAgeSeconds: oldestDeadLetterOutbox.seconds,
        countSaturated: outbox.count_saturated,
      },
      attentionCodes,
    };
  }

  async providerHealth(): Promise<
    readonly {
      readonly key: string;
      readonly state: ProviderRow['state'];
      readonly detail: string;
      readonly lastCheckedAt: Date;
    }[]
  > {
    const result = await this.database.query<ProviderRow>(
      'SELECT key, state, detail, checked_at FROM provider_health ORDER BY key',
    );
    return result.rows.map((row) => ({
      key: row.key,
      state: row.state,
      detail: row.detail,
      lastCheckedAt: asDate(row.checked_at, 'provider_health.checked_at'),
    }));
  }

  async audit(): Promise<
    readonly {
      readonly id: string;
      readonly action: string;
      readonly resourceType: string;
      readonly resourceId?: string;
      readonly outcome: AuditRow['outcome'];
      readonly actorPersonId?: string;
      readonly occurredAt: Date;
    }[]
  > {
    const result = await this.database.query<AuditRow>(`
      SELECT id, action, resource_type, resource_id, outcome, actor_person_id, occurred_at
      FROM audit_events ORDER BY occurred_at DESC LIMIT 100
    `);
    return result.rows.map((row) => ({
      id: row.id,
      action: row.action,
      resourceType: row.resource_type,
      ...(row.resource_id === null ? {} : { resourceId: row.resource_id }),
      outcome: row.outcome,
      ...(row.actor_person_id === null ? {} : { actorPersonId: row.actor_person_id }),
      occurredAt: asDate(row.occurred_at, 'audit_events.occurred_at'),
    }));
  }

  async revenue(now: Date): Promise<{
    readonly savedSearches: readonly {
      readonly id: string;
      readonly name: string;
      readonly source: string;
      readonly resultCount: number;
    }[];
    readonly targetAccounts: readonly {
      readonly id: string;
      readonly name: string;
      readonly segment: string;
      readonly verificationState: string;
    }[];
    readonly opportunities: readonly {
      readonly id: string;
      readonly accountId: string;
      readonly stage: string;
      readonly owner: string;
      readonly nextAction: string;
      readonly nextActionAt: Date;
      readonly stale: boolean;
    }[];
  }> {
    const [searches, targets, opportunities] = await Promise.all([
      this.database.query<SavedSearchRow>(
        'SELECT id, name, source, result_count FROM saved_searches ORDER BY name LIMIT 101',
      ),
      this.database.query<TargetRow>(
        'SELECT id, name, segment, verification_state FROM target_accounts ORDER BY name LIMIT 101',
      ),
      this.database.query<OpportunityRow>(
        'SELECT id, account_id, stage, owner, next_action, next_action_at FROM opportunities ORDER BY next_action_at LIMIT 101',
      ),
    ]);
    return {
      savedSearches: searches.rows.map((row) => ({
        id: row.id,
        name: row.name,
        source: row.source,
        resultCount: row.result_count,
      })),
      targetAccounts: targets.rows.map((row) => ({
        id: row.id,
        name: row.name,
        segment: row.segment,
        verificationState: row.verification_state,
      })),
      opportunities: opportunities.rows.map((row) => {
        const nextActionAt = asDate(row.next_action_at, 'opportunities.next_action_at');
        return {
          id: row.id,
          accountId: row.account_id,
          stage: row.stage,
          owner: row.owner,
          nextAction: row.next_action,
          nextActionAt,
          stale: nextActionAt.getTime() < now.getTime(),
        };
      }),
    };
  }
}

export class AuditRepository {
  constructor(private readonly database: Database) {}

  async serializedRows(): Promise<string> {
    const result = await this.database.query<Record<string, unknown>>(
      'SELECT metadata, payload FROM audit_events FULL JOIN outbox_events ON false',
    );
    return JSON.stringify(result.rows);
  }

  async counts(): Promise<{ readonly audits: number; readonly outbox: number }> {
    const result = await this.database.query<{ audits: number; outbox: number }>(`
      SELECT (SELECT count(*)::int FROM audit_events) AS audits,
             (SELECT count(*)::int FROM outbox_events) AS outbox
    `);
    return result.rows[0] ?? { audits: 0, outbox: 0 };
  }
}

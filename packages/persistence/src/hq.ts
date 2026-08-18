import { DomainError, type CorrelationId, type PersonId } from '@boomerbuddy/domain';
import type { Database } from './database';
import { EntitlementRepository, type EntitlementRuntimeEnvironment } from './entitlements';
import { asDate, randomIdFactory, type IdFactory } from './values';

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

type HqEmployeeRole = 'hq_owner' | 'hq_reviewer' | 'hq_support';
type HqProjection =
  'owner_households' | 'owner_checks' | 'assigned_review_queue' | 'assigned_support_queue';

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

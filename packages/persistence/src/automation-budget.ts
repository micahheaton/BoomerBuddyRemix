import { createHash } from 'node:crypto';
import {
  authorizeAutomation,
  type AutomationPolicy,
  type AutomationRequest,
} from '@boomerbuddy/business-os';

import type { Database, SqlExecutor } from './database';
import { writeAuditAndOutbox, type OperationalEventContext } from './events';
import { asDate, jsonParameter, randomIdFactory, stringArray, type IdFactory } from './values';

export type AutomationBudgetScopeKind = 'company' | 'agent' | 'action' | 'tool' | 'policy';
export type AutomationBudgetPeriodKind = 'day' | 'month';
export type AutomationBudgetReservationState = 'reserved' | 'committed' | 'released';

export interface AutomationBudgetCapStatus {
  readonly availableCents: number;
  readonly committedCents: number;
  readonly enabled: boolean;
  readonly id: string;
  readonly limitCents: number;
  readonly overrideCents: number;
  readonly periodEnd: Date;
  readonly periodKind: AutomationBudgetPeriodKind;
  readonly periodStart: Date;
  readonly reservedCents: number;
  readonly scopeKey: string;
  readonly scopeKind: AutomationBudgetScopeKind;
  readonly version: number;
}

export interface AutomationBudgetReservation {
  readonly actualCostCents?: number;
  readonly authorizationBreach?: boolean;
  readonly estimatedCostCents: number;
  readonly expiresAt: Date;
  readonly id: string;
  readonly operationKey: string;
  readonly state: AutomationBudgetReservationState;
}

export type AutomationBudgetReserveResult =
  | {
      readonly allowed: true;
      readonly executable: true;
      readonly reservation: AutomationBudgetReservation;
      readonly reused: boolean;
    }
  | {
      readonly allowed: false;
      readonly executable: false;
      readonly reasons: readonly string[];
      readonly reservation?: AutomationBudgetReservation;
      readonly reused?: boolean;
      readonly runId?: string;
    };

interface ControlRow extends Record<string, unknown> {
  readonly kill_switch: boolean;
  readonly version: number;
}

interface PolicyRow extends Record<string, unknown> {
  readonly action_key: string;
  readonly allowed_data_classes: unknown;
  readonly allowed_tools: unknown;
  readonly autonomy_class: AutomationPolicy['autonomy'];
  readonly enabled: boolean;
  readonly id: string;
  readonly max_cost_per_operation_cents: number;
  readonly requires_audit: boolean;
  readonly version: number;
}

interface CapRow extends Record<string, unknown> {
  readonly approved_by_person_id: string;
  readonly created_at: unknown;
  readonly enabled: boolean;
  readonly id: string;
  readonly limit_cents: number;
  readonly period_kind: AutomationBudgetPeriodKind;
  readonly scope_key: string;
  readonly scope_kind: AutomationBudgetScopeKind;
  readonly updated_at: unknown;
  readonly version: number;
}

interface WindowRow extends Record<string, unknown> {
  readonly cap_id: string;
  readonly committed_cents: unknown;
  readonly override_cents: unknown;
  readonly period_end: unknown;
  readonly period_start: unknown;
  readonly reserved_cents: number;
}

interface ReservationRow extends Record<string, unknown> {
  readonly actual_cost_cents: unknown | null;
  readonly action_key: string;
  readonly agent_key: string;
  readonly automation_run_id: string;
  readonly authorization_breach: boolean;
  readonly commit_evidence_kind: 'local_simulation' | 'external_action' | null;
  readonly commit_evidence_reference: string | null;
  readonly control_version: number | null;
  readonly correlation_id: string;
  readonly data_classes: unknown;
  readonly envelope_digest: string;
  readonly estimated_cost_cents: number;
  readonly execution_authorization_expires_at: unknown | null;
  readonly execution_rechecked_at: unknown | null;
  readonly expires_at: unknown;
  readonly id: string;
  readonly operation_key: string;
  readonly overrun_detected: boolean;
  readonly policy_id: string;
  readonly policy_version: number;
  readonly state: AutomationBudgetReservationState;
  readonly terminal_reason_code: string | null;
  readonly tool_key: string;
}

interface AllocationRow extends Record<string, unknown> {
  readonly cap_id: string;
  readonly cap_version: number;
  readonly period_start: unknown;
  readonly reserved_cents: number;
}

interface OverrideEventRow extends Record<string, unknown> {
  readonly amount_cents: unknown;
  readonly cap_id: string;
  readonly period_start: unknown;
  readonly reason_code: string;
}

const codePattern = /^[a-z][a-z0-9_.-]{1,79}$/u;
const operationPattern = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{1,199}$/u;
const maximumCents = 100_000_000;
const maximumReservationTtlMs = 15 * 60_000;
const executionAuthorizationMs = 5_000;

export type AutomationBudgetAuthorityClock = (
  transaction: SqlExecutor,
  observedAt: Date,
) => Promise<Date>;

const databaseAuthorityClock: AutomationBudgetAuthorityClock = async (transaction) => {
  const result = await transaction.query<{ authority_now: unknown } & Record<string, unknown>>(
    'SELECT clock_timestamp() AS authority_now',
  );
  return asDate(result.rows[0]?.authority_now, 'automation budget database authority time');
};

function assertCode(value: string, field: string): void {
  if (!codePattern.test(value)) throw new TypeError(`Invalid ${field}`);
}

function assertOperationKey(value: string, field: string): void {
  if (!operationPattern.test(value)) throw new TypeError(`Invalid ${field}`);
}

function assertCents(value: number, field: string, allowZero = true): void {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > maximumCents) {
    throw new TypeError(`Invalid ${field}`);
  }
}

function assertFiniteDate(value: Date, field: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`Invalid ${field}`);
  }
}

function asSafeCents(value: unknown, field: string): number {
  const integer =
    typeof value === 'bigint'
      ? value
      : typeof value === 'number' && Number.isSafeInteger(value)
        ? BigInt(value)
        : typeof value === 'string' && /^\d+$/u.test(value)
          ? BigInt(value)
          : undefined;
  if (integer === undefined || integer < 0n || integer > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError(`Automation budget amount exceeds safe serialization: ${field}`);
  }
  return Number(integer);
}

function assertFounderContext(personId: string, context: OperationalEventContext): void {
  if (context.actorPersonId !== personId || context.audience !== 'hq') {
    throw new TypeError('Automation budget founder context does not match the authenticated actor');
  }
}

async function lockConfiguredFounder(
  transaction: SqlExecutor,
  configuredFounderPersonId: string | undefined,
  actorPersonId: string,
): Promise<void> {
  if (configuredFounderPersonId === undefined || actorPersonId !== configuredFounderPersonId) {
    throw new TypeError('Automation budget mutation requires the configured founder identity');
  }
  const assignment = await transaction.query(
    `SELECT employee.id
     FROM employee_assignments employee
     JOIN organizations organization ON organization.id = employee.organization_id
     WHERE employee.person_id = $1
       AND employee.role = 'hq_owner' AND employee.status = 'active'
       AND organization.kind = 'internal'
     ORDER BY employee.id LIMIT 1
     FOR UPDATE OF employee, organization`,
    [actorPersonId],
  );
  if (assignment.rows[0] === undefined) {
    throw new TypeError('Automation budget mutation requires an active founder owner assignment');
  }
}

function canonicalDataClasses(values: readonly string[]): readonly string[] {
  const unique = [...new Set(values)];
  for (const value of unique) assertCode(value, 'automation data class');
  return unique.sort((left, right) => left.localeCompare(right));
}

function envelopeDigest(input: {
  readonly agentKey: string;
  readonly request: AutomationRequest;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        action: input.request.action,
        agentKey: input.agentKey,
        dataClasses: canonicalDataClasses(input.request.dataClasses),
        estimatedCostCents: input.request.estimatedCostCents,
        tool: input.request.tool,
      }),
    )
    .digest('hex');
}

function periodBounds(
  now: Date,
  periodKind: AutomationBudgetPeriodKind,
): { readonly end: Date; readonly start: Date } {
  const start =
    periodKind === 'day'
      ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end =
    periodKind === 'day'
      ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { end, start };
}

function mapPolicy(row: PolicyRow): AutomationPolicy {
  return {
    action: row.action_key,
    allowedDataClasses: [
      ...stringArray(row.allowed_data_classes, 'autonomy_policies.allowed_data_classes'),
    ],
    allowedTools: [...stringArray(row.allowed_tools, 'autonomy_policies.allowed_tools')],
    autonomy: row.autonomy_class,
    enabled: row.enabled,
    maxCostPerOperationCents: row.max_cost_per_operation_cents,
    requiresAudit: row.requires_audit,
  };
}

function mapReservation(row: ReservationRow): AutomationBudgetReservation {
  return {
    ...(row.actual_cost_cents === null
      ? {}
      : { actualCostCents: asSafeCents(row.actual_cost_cents, 'reservation actual cost') }),
    ...(row.state === 'committed' ? { authorizationBreach: row.authorization_breach } : {}),
    estimatedCostCents: row.estimated_cost_cents,
    expiresAt: asDate(row.expires_at, 'automation_budget_reservations.expires_at'),
    id: row.id,
    operationKey: row.operation_key,
    state: row.state,
  };
}

async function lockControl(transaction: SqlExecutor): Promise<ControlRow> {
  const result = await transaction.query<ControlRow>(
    `SELECT kill_switch, version
     FROM automation_global_control
     WHERE control_key = 'global'
     FOR UPDATE`,
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('Global automation control is unavailable');
  return row;
}

async function lockPolicy(
  transaction: SqlExecutor,
  action: string,
): Promise<PolicyRow | undefined> {
  const result = await transaction.query<PolicyRow>(
    `SELECT id, action_key, autonomy_class, allowed_data_classes, allowed_tools,
            max_cost_per_operation_cents, requires_audit, enabled, version
     FROM autonomy_policies
     WHERE action_key = $1
     FOR UPDATE`,
    [action],
  );
  return result.rows[0];
}

export class AutomationBudgetRepository {
  constructor(
    private readonly database: Database,
    private readonly ids: IdFactory = randomIdFactory,
    private readonly founderPersonId?: string,
    /** @internal Deterministic transaction clock seam for isolated repository tests only. */
    private readonly authorityClock: AutomationBudgetAuthorityClock = databaseAuthorityClock,
  ) {}

  private async recordEvent(
    transaction: SqlExecutor,
    input: {
      readonly actorPersonId?: string | undefined;
      readonly amountCents?: number;
      readonly capId?: string;
      readonly capVersion?: number;
      readonly controlVersion?: number;
      readonly correlationId: string;
      readonly eventKind:
        | 'cap_created'
        | 'cap_changed'
        | 'cap_disabled'
        | 'window_override'
        | 'reservation_denied'
        | 'reserved'
        | 'execution_rechecked'
        | 'committed'
        | 'released'
        | 'overrun'
        | 'authorization_breach';
      readonly now: Date;
      readonly operationKey?: string;
      readonly periodStart?: Date;
      readonly reasonCode?: string;
      readonly reservationId?: string;
    },
  ): Promise<void> {
    await transaction.query(
      `INSERT INTO automation_budget_events(
         id, event_kind, reservation_id, cap_id, period_start, operation_key,
         amount_cents, cap_version, control_version, actor_person_id, reason_code,
         correlation_id, recorded_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        this.ids.next('automation_budget_event'),
        input.eventKind,
        input.reservationId ?? null,
        input.capId ?? null,
        input.periodStart?.toISOString() ?? null,
        input.operationKey ?? null,
        input.amountCents ?? null,
        input.capVersion ?? null,
        input.controlVersion ?? null,
        input.actorPersonId ?? null,
        input.reasonCode ?? null,
        input.correlationId,
        input.now.toISOString(),
      ],
    );
  }

  async putCap(input: {
    readonly approvedByPersonId: string;
    readonly context: OperationalEventContext;
    readonly enabled: boolean;
    readonly limitCents: number;
    readonly periodKind: AutomationBudgetPeriodKind;
    readonly scopeKey: string;
    readonly scopeKind: AutomationBudgetScopeKind;
  }): Promise<string> {
    assertFounderContext(input.approvedByPersonId, input.context);
    assertCode(input.scopeKey, 'automation budget scope key');
    assertCents(input.limitCents, 'automation budget cap');
    if (input.scopeKind === 'company' && input.scopeKey !== 'global') {
      throw new TypeError('Company automation budget scope must be global');
    }
    return this.database.transaction(async (transaction) => {
      const control = await lockControl(transaction);
      await lockConfiguredFounder(transaction, this.founderPersonId, input.approvedByPersonId);
      const authorityNow = await this.authorityClock(transaction, input.context.now);
      const context = { ...input.context, now: authorityNow };
      if (!control.kill_switch) {
        throw new TypeError('Engage the global automation kill switch before changing budget caps');
      }
      if (input.scopeKind === 'policy') {
        const policy = await transaction.query('SELECT id FROM autonomy_policies WHERE id = $1', [
          input.scopeKey,
        ]);
        if (policy.rows[0] === undefined)
          throw new TypeError('Automation budget policy is unavailable');
      }
      const existing = await transaction.query<CapRow>(
        `SELECT * FROM automation_budget_caps
         WHERE scope_kind = $1 AND scope_key = $2 AND period_kind = $3
         FOR UPDATE`,
        [input.scopeKind, input.scopeKey, input.periodKind],
      );
      const current = existing.rows[0];
      if (current !== undefined) {
        const incompatible = await transaction.query(
          `SELECT cap_id FROM automation_budget_windows
           WHERE cap_id = $1 AND reserved_cents + committed_cents > $2 + override_cents
           LIMIT 1`,
          [current.id, input.limitCents],
        );
        if (incompatible.rows[0] !== undefined) {
          throw new TypeError('Automation budget cap cannot fall below reserved or committed use');
        }
      }
      const capId = current?.id ?? this.ids.next('automation_budget_cap');
      const version = (current?.version ?? 0) + 1;
      if (current === undefined) {
        await transaction.query(
          `INSERT INTO automation_budget_caps(
             id, scope_kind, scope_key, period_kind, limit_cents, enabled, version,
             approved_by_person_id, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
          [
            capId,
            input.scopeKind,
            input.scopeKey,
            input.periodKind,
            input.limitCents,
            input.enabled,
            version,
            input.approvedByPersonId,
            authorityNow.toISOString(),
          ],
        );
      } else {
        await transaction.query(
          `UPDATE automation_budget_caps
           SET limit_cents = $2, enabled = $3, version = $4,
               approved_by_person_id = $5, updated_at = $6
           WHERE id = $1`,
          [
            capId,
            input.limitCents,
            input.enabled,
            version,
            input.approvedByPersonId,
            authorityNow.toISOString(),
          ],
        );
      }
      const eventKind = !input.enabled
        ? 'cap_disabled'
        : current === undefined
          ? 'cap_created'
          : 'cap_changed';
      await this.recordEvent(transaction, {
        actorPersonId: input.approvedByPersonId,
        amountCents: input.limitCents,
        capId,
        capVersion: version,
        controlVersion: control.version,
        correlationId: context.correlationId,
        eventKind,
        now: authorityNow,
      });
      await writeAuditAndOutbox(
        transaction,
        this.ids,
        context,
        {
          action: 'business_os.automation_budget_cap_changed',
          resourceType: 'automation_budget_cap',
          resourceId: capId,
          outcome: 'completed',
          metadata: {
            enabled: input.enabled,
            limitCents: input.limitCents,
            periodKind: input.periodKind,
            scopeKind: input.scopeKind,
            version,
          },
        },
        {
          eventType: 'business_os.automation_budget_cap_changed',
          aggregateType: 'automation_budget_cap',
          aggregateId: capId,
          payload: { enabled: input.enabled, version },
        },
      );
      return capId;
    });
  }

  async status(now: Date): Promise<readonly AutomationBudgetCapStatus[]> {
    const caps = await this.database.query<CapRow>(
      `SELECT * FROM automation_budget_caps
       ORDER BY scope_kind, scope_key, period_kind`,
    );
    return Promise.all(
      caps.rows.map(async (cap) => {
        const bounds = periodBounds(now, cap.period_kind);
        const windowResult = await this.database.query<WindowRow>(
          `SELECT cap_id, period_start, period_end, reserved_cents, committed_cents,
                  override_cents
           FROM automation_budget_windows
           WHERE cap_id = $1 AND period_start = $2`,
          [cap.id, bounds.start.toISOString()],
        );
        const window = windowResult.rows[0];
        const reservedCents = window?.reserved_cents ?? 0;
        const committedCents =
          window === undefined
            ? 0
            : asSafeCents(window.committed_cents, 'budget window committed amount');
        const overrideCents =
          window === undefined
            ? 0
            : asSafeCents(window.override_cents, 'budget window override amount');
        return {
          availableCents: cap.limit_cents + overrideCents - reservedCents - committedCents,
          committedCents,
          enabled: cap.enabled,
          id: cap.id,
          limitCents: cap.limit_cents,
          overrideCents,
          periodEnd: bounds.end,
          periodKind: cap.period_kind,
          periodStart: bounds.start,
          reservedCents,
          scopeKey: cap.scope_key,
          scopeKind: cap.scope_kind,
          version: cap.version,
        };
      }),
    );
  }

  async overrideCurrentWindow(input: {
    readonly additionalCents: number;
    readonly approvedByPersonId: string;
    readonly capId: string;
    readonly context: OperationalEventContext;
    readonly overrideKey: string;
    readonly reasonCode: string;
  }): Promise<{ readonly reused: boolean }> {
    assertFounderContext(input.approvedByPersonId, input.context);
    assertCents(input.additionalCents, 'automation budget override', false);
    assertOperationKey(input.overrideKey, 'automation budget override key');
    assertCode(input.reasonCode, 'automation budget override reason');
    return this.database.transaction(async (transaction) => {
      const control = await lockControl(transaction);
      await lockConfiguredFounder(transaction, this.founderPersonId, input.approvedByPersonId);
      const authorityNow = await this.authorityClock(transaction, input.context.now);
      const context = { ...input.context, now: authorityNow };
      if (!control.kill_switch) {
        throw new TypeError('Founder budget override requires the global kill switch engaged');
      }
      const capResult = await transaction.query<CapRow>(
        'SELECT * FROM automation_budget_caps WHERE id = $1 FOR UPDATE',
        [input.capId],
      );
      const cap = capResult.rows[0];
      if (cap === undefined || !cap.enabled)
        throw new TypeError('Automation budget cap is unavailable');
      const bounds = periodBounds(authorityNow, cap.period_kind);
      const existing = await transaction.query<OverrideEventRow>(
        `SELECT cap_id, period_start, amount_cents, reason_code
         FROM automation_budget_events
         WHERE event_kind = 'window_override' AND operation_key = $1
         FOR UPDATE`,
        [input.overrideKey],
      );
      const prior = existing.rows[0];
      if (prior !== undefined) {
        if (
          prior.cap_id !== input.capId ||
          asSafeCents(prior.amount_cents, 'automation budget override amount') !==
            input.additionalCents ||
          prior.reason_code !== input.reasonCode ||
          asDate(prior.period_start, 'automation budget override period').getTime() !==
            bounds.start.getTime()
        ) {
          throw new TypeError(
            'Automation budget override key conflicts with its original envelope',
          );
        }
        return { reused: true };
      }
      await transaction.query(
        `INSERT INTO automation_budget_windows(
           cap_id, period_start, period_end, updated_at
         ) VALUES ($1,$2,$3,$4)
         ON CONFLICT (cap_id, period_start) DO NOTHING`,
        [cap.id, bounds.start.toISOString(), bounds.end.toISOString(), authorityNow.toISOString()],
      );
      await transaction.query(
        `SELECT cap_id FROM automation_budget_windows
         WHERE cap_id = $1 AND period_start = $2 FOR UPDATE`,
        [cap.id, bounds.start.toISOString()],
      );
      await transaction.query(
        `UPDATE automation_budget_windows
         SET override_cents = override_cents + $3, updated_at = $4
         WHERE cap_id = $1 AND period_start = $2`,
        [cap.id, bounds.start.toISOString(), input.additionalCents, authorityNow.toISOString()],
      );
      await this.recordEvent(transaction, {
        actorPersonId: input.approvedByPersonId,
        amountCents: input.additionalCents,
        capId: cap.id,
        capVersion: cap.version,
        controlVersion: control.version,
        correlationId: context.correlationId,
        eventKind: 'window_override',
        now: authorityNow,
        operationKey: input.overrideKey,
        periodStart: bounds.start,
        reasonCode: input.reasonCode,
      });
      await writeAuditAndOutbox(
        transaction,
        this.ids,
        context,
        {
          action: 'business_os.automation_budget_overridden',
          resourceType: 'automation_budget_cap',
          resourceId: cap.id,
          outcome: 'completed',
          metadata: {
            additionalCents: input.additionalCents,
            capVersion: cap.version,
            periodKind: cap.period_kind,
          },
        },
        {
          eventType: 'business_os.automation_budget_overridden',
          aggregateType: 'automation_budget_cap',
          aggregateId: cap.id,
          payload: { additionalCents: input.additionalCents, capVersion: cap.version },
        },
      );
      return { reused: false };
    });
  }

  private async recordDenied(
    transaction: SqlExecutor,
    input: {
      readonly context: OperationalEventContext;
      readonly operationKey: string;
      readonly policyId?: string;
      readonly reasonCode: string;
      readonly request: AutomationRequest;
    },
  ): Promise<string> {
    const runId = this.ids.next('automation_run');
    await transaction.query(
      `INSERT INTO automation_runs(
         id, policy_id, action_key, tool_key, data_classes, estimated_cost_cents,
         state, audit_reference, created_at, evaluation_only
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,'blocked',$7,$8,false)`,
      [
        runId,
        input.policyId ?? null,
        input.request.action,
        input.request.tool,
        jsonParameter(canonicalDataClasses(input.request.dataClasses)),
        input.request.estimatedCostCents,
        `automation:${runId}`,
        input.context.now.toISOString(),
      ],
    );
    await this.recordEvent(transaction, {
      actorPersonId: input.context.actorPersonId,
      amountCents: input.request.estimatedCostCents,
      correlationId: input.context.correlationId,
      eventKind: 'reservation_denied',
      now: input.context.now,
      operationKey: input.operationKey,
      reasonCode: input.reasonCode,
    });
    return runId;
  }

  async reserve(input: {
    readonly agentKey: string;
    readonly context: OperationalEventContext;
    readonly operationKey: string;
    readonly request: AutomationRequest;
    readonly ttlMs: number;
  }): Promise<AutomationBudgetReserveResult> {
    assertOperationKey(input.operationKey, 'automation operation key');
    assertCode(input.agentKey, 'automation agent key');
    assertCode(input.request.action, 'automation action');
    assertCode(input.request.tool, 'automation tool');
    assertCents(input.request.estimatedCostCents, 'estimated automation cost');
    if (
      !Number.isSafeInteger(input.ttlMs) ||
      input.ttlMs < 1_000 ||
      input.ttlMs > maximumReservationTtlMs
    ) {
      throw new TypeError('Invalid automation budget reservation TTL');
    }
    const digest = envelopeDigest(input);
    return this.database.transaction(async (transaction) => {
      const control = await lockControl(transaction);
      const authorityNow = await this.authorityClock(transaction, input.context.now);
      const context = { ...input.context, now: authorityNow };
      const existing = await transaction.query<ReservationRow>(
        `SELECT * FROM automation_budget_reservations
         WHERE operation_key = $1 FOR UPDATE`,
        [input.operationKey],
      );
      const prior = existing.rows[0];
      if (prior !== undefined) {
        if (prior.envelope_digest !== digest) {
          throw new TypeError('Automation operation key conflicts with its original envelope');
        }
        if (
          prior.state === 'reserved' &&
          authorityNow >= asDate(prior.expires_at, 'automation budget reservation expiry')
        ) {
          const released = await this.releaseLocked(transaction, prior, {
            context,
            reasonCode: 'reservation_expired',
          });
          return {
            allowed: false,
            executable: false,
            reasons: ['The original automation budget reservation expired.'],
            reservation: released,
            reused: true,
          };
        }
        if (prior.state !== 'reserved') {
          return {
            allowed: false,
            executable: false,
            reasons: [`The original automation budget reservation is ${prior.state}.`],
            reservation: mapReservation(prior),
            reused: true,
          };
        }
        return {
          allowed: true,
          executable: true,
          reservation: mapReservation(prior),
          reused: true,
        };
      }

      const policyRow = await lockPolicy(transaction, input.request.action);
      const decision = authorizeAutomation(
        policyRow === undefined ? undefined : mapPolicy(policyRow),
        input.request,
        control.kill_switch,
      );
      if (!decision.allowed || policyRow === undefined) {
        const runId = await this.recordDenied(transaction, {
          context,
          operationKey: input.operationKey,
          ...(policyRow === undefined ? {} : { policyId: policyRow.id }),
          reasonCode: 'policy_denied',
          request: input.request,
        });
        return { allowed: false, executable: false, reasons: decision.reasons, runId };
      }

      const capsResult = await transaction.query<CapRow>(
        `SELECT * FROM automation_budget_caps
         WHERE enabled = true AND (
           (scope_kind = 'company' AND scope_key = 'global') OR
           (scope_kind = 'agent' AND scope_key = $1) OR
           (scope_kind = 'action' AND scope_key = $2) OR
           (scope_kind = 'tool' AND scope_key = $3) OR
           (scope_kind = 'policy' AND scope_key = $4)
         )
         ORDER BY id
         FOR UPDATE`,
        [input.agentKey, input.request.action, input.request.tool, policyRow.id],
      );
      const caps = [...capsResult.rows];
      const companyPeriods = new Set(
        caps
          .filter((cap) => cap.scope_kind === 'company' && cap.scope_key === 'global')
          .map((cap) => cap.period_kind),
      );
      const missing = [
        ...(companyPeriods.has('day') ? [] : ['company_day']),
        ...(companyPeriods.has('month') ? [] : ['company_month']),
        ...(caps.some((cap) => cap.scope_kind === 'agent') ? [] : ['agent']),
        ...(caps.some((cap) => cap.scope_kind === 'action') ? [] : ['action']),
        ...(caps.some((cap) => cap.scope_kind === 'tool') ? [] : ['tool']),
        ...(caps.some((cap) => cap.scope_kind === 'policy') ? [] : ['policy']),
      ];
      if (missing.length > 0) {
        const runId = await this.recordDenied(transaction, {
          context,
          operationKey: input.operationKey,
          policyId: policyRow.id,
          reasonCode: 'required_cap_missing',
          request: input.request,
        });
        return {
          allowed: false,
          executable: false,
          reasons: [`Required cumulative budget caps are missing: ${missing.join(', ')}.`],
          runId,
        };
      }

      const windows: { readonly cap: CapRow; readonly row: WindowRow }[] = [];
      for (const cap of caps) {
        const bounds = periodBounds(authorityNow, cap.period_kind);
        await transaction.query(
          `INSERT INTO automation_budget_windows(
             cap_id, period_start, period_end, updated_at
           ) VALUES ($1,$2,$3,$4)
           ON CONFLICT (cap_id, period_start) DO NOTHING`,
          [
            cap.id,
            bounds.start.toISOString(),
            bounds.end.toISOString(),
            authorityNow.toISOString(),
          ],
        );
        const windowResult = await transaction.query<WindowRow>(
          `SELECT cap_id, period_start, period_end, reserved_cents, committed_cents,
                  override_cents
           FROM automation_budget_windows
           WHERE cap_id = $1 AND period_start = $2
           FOR UPDATE`,
          [cap.id, bounds.start.toISOString()],
        );
        const window = windowResult.rows[0];
        if (window === undefined) throw new Error('Automation budget window is unavailable');
        windows.push({ cap, row: window });
      }
      const exhausted = windows.filter(
        ({ cap, row }) =>
          row.reserved_cents +
            asSafeCents(row.committed_cents, 'budget window committed amount') +
            input.request.estimatedCostCents >
          cap.limit_cents + asSafeCents(row.override_cents, 'budget window override amount'),
      );
      if (exhausted.length > 0) {
        const runId = await this.recordDenied(transaction, {
          context,
          operationKey: input.operationKey,
          policyId: policyRow.id,
          reasonCode: 'cumulative_cap_exhausted',
          request: input.request,
        });
        return {
          allowed: false,
          executable: false,
          reasons: [
            `Cumulative budget unavailable for: ${exhausted
              .map(({ cap }) => `${cap.scope_kind}:${cap.scope_key}:${cap.period_kind}`)
              .join(', ')}.`,
          ],
          runId,
        };
      }

      const runId = this.ids.next('automation_run');
      await transaction.query(
        `INSERT INTO automation_runs(
           id, policy_id, action_key, tool_key, data_classes, estimated_cost_cents,
           state, audit_reference, created_at, evaluation_only
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,'approved',$7,$8,false)`,
        [
          runId,
          policyRow.id,
          input.request.action,
          input.request.tool,
          jsonParameter(canonicalDataClasses(input.request.dataClasses)),
          input.request.estimatedCostCents,
          `automation:${runId}`,
          authorityNow.toISOString(),
        ],
      );
      const reservationId = this.ids.next('automation_budget_reservation');
      const requestedExpiry = new Date(authorityNow.getTime() + input.ttlMs);
      const expiresAt = new Date(
        Math.min(
          requestedExpiry.getTime(),
          ...windows.map(({ row }) =>
            asDate(row.period_end, 'automation_budget_windows.period_end').getTime(),
          ),
        ),
      );
      await transaction.query(
        `INSERT INTO automation_budget_reservations(
           id, operation_key, envelope_digest, automation_run_id, policy_id, policy_version,
           agent_key, action_key, tool_key, data_classes, estimated_cost_cents, state,
           reserved_at, expires_at, correlation_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,'reserved',$12,$13,$14)`,
        [
          reservationId,
          input.operationKey,
          digest,
          runId,
          policyRow.id,
          policyRow.version,
          input.agentKey,
          input.request.action,
          input.request.tool,
          jsonParameter(canonicalDataClasses(input.request.dataClasses)),
          input.request.estimatedCostCents,
          authorityNow.toISOString(),
          expiresAt.toISOString(),
          context.correlationId,
        ],
      );
      for (const { cap, row } of windows) {
        const periodStart = asDate(row.period_start, 'automation_budget_windows.period_start');
        await transaction.query(
          `UPDATE automation_budget_windows
           SET reserved_cents = reserved_cents + $3, updated_at = $4
           WHERE cap_id = $1 AND period_start = $2`,
          [
            cap.id,
            periodStart.toISOString(),
            input.request.estimatedCostCents,
            authorityNow.toISOString(),
          ],
        );
        await transaction.query(
          `INSERT INTO automation_budget_reservation_allocations(
             reservation_id, cap_id, period_start, cap_version, reserved_cents
           ) VALUES ($1,$2,$3,$4,$5)`,
          [
            reservationId,
            cap.id,
            periodStart.toISOString(),
            cap.version,
            input.request.estimatedCostCents,
          ],
        );
      }
      await this.recordEvent(transaction, {
        actorPersonId: context.actorPersonId,
        amountCents: input.request.estimatedCostCents,
        controlVersion: control.version,
        correlationId: context.correlationId,
        eventKind: 'reserved',
        now: authorityNow,
        operationKey: input.operationKey,
        reservationId,
      });
      await writeAuditAndOutbox(
        transaction,
        this.ids,
        context,
        {
          action: 'business_os.automation_budget_reserved',
          resourceType: 'automation_budget_reservation',
          resourceId: reservationId,
          outcome: 'allowed',
          metadata: {
            capCount: windows.length,
            estimatedCostCents: input.request.estimatedCostCents,
            policyVersion: policyRow.version,
          },
        },
        {
          eventType: 'business_os.automation_budget_reserved',
          aggregateType: 'automation_budget_reservation',
          aggregateId: reservationId,
          payload: {
            capCount: windows.length,
            estimatedCostCents: input.request.estimatedCostCents,
            policyVersion: policyRow.version,
          },
        },
      );
      return {
        allowed: true,
        executable: true,
        reservation: {
          estimatedCostCents: input.request.estimatedCostCents,
          expiresAt,
          id: reservationId,
          operationKey: input.operationKey,
          state: 'reserved',
        },
        reused: false,
      };
    });
  }

  private async lockReservation(
    transaction: SqlExecutor,
    reservationId: string,
  ): Promise<ReservationRow> {
    const result = await transaction.query<ReservationRow>(
      'SELECT * FROM automation_budget_reservations WHERE id = $1 FOR UPDATE',
      [reservationId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new TypeError('Automation budget reservation is unavailable');
    return row;
  }

  private async lockAllocations(
    transaction: SqlExecutor,
    reservationId: string,
  ): Promise<readonly AllocationRow[]> {
    const allocations = await transaction.query<AllocationRow>(
      `SELECT cap_id, period_start, cap_version, reserved_cents
       FROM automation_budget_reservation_allocations
       WHERE reservation_id = $1
       ORDER BY cap_id`,
      [reservationId],
    );
    for (const allocation of allocations.rows) {
      const locked = await transaction.query(
        'SELECT id FROM automation_budget_caps WHERE id = $1 FOR UPDATE',
        [allocation.cap_id],
      );
      if (locked.rows[0] === undefined) throw new Error('Automation budget cap is unavailable');
    }
    for (const allocation of allocations.rows) {
      await transaction.query(
        `SELECT cap_id FROM automation_budget_windows
         WHERE cap_id = $1 AND period_start = $2 FOR UPDATE`,
        [
          allocation.cap_id,
          asDate(allocation.period_start, 'budget allocation period').toISOString(),
        ],
      );
    }
    return allocations.rows;
  }

  private async releaseLocked(
    transaction: SqlExecutor,
    reservation: ReservationRow,
    input: {
      readonly context: OperationalEventContext;
      readonly reasonCode: string;
    },
  ): Promise<AutomationBudgetReservation> {
    if (reservation.state === 'committed') {
      throw new TypeError('Committed automation budget cannot be released');
    }
    if (reservation.state === 'released') {
      if (reservation.terminal_reason_code !== input.reasonCode) {
        throw new TypeError('Automation budget release conflicts with its terminal evidence');
      }
      return mapReservation(reservation);
    }
    const allocations = await this.lockAllocations(transaction, reservation.id);
    const linkedAction = await transaction.query<
      { effect_state: string; state: string } & Record<string, unknown>
    >(
      `SELECT state, effect_state FROM external_actions
       WHERE budget_reservation_id = $1 FOR UPDATE`,
      [reservation.id],
    );
    const external = linkedAction.rows[0];
    if (external?.effect_state === 'accepted') {
      throw new TypeError('Accepted external action cost must be committed, not released');
    }
    if (external?.effect_state === 'unknown') {
      throw new TypeError('Unknown external action outcome must be reconciled before release');
    }
    for (const allocation of allocations) {
      const updated = await transaction.query(
        `UPDATE automation_budget_windows
         SET reserved_cents = reserved_cents - $3, updated_at = $4
         WHERE cap_id = $1 AND period_start = $2 AND reserved_cents >= $3`,
        [
          allocation.cap_id,
          asDate(allocation.period_start, 'budget allocation period').toISOString(),
          allocation.reserved_cents,
          input.context.now.toISOString(),
        ],
      );
      if (updated.rowCount !== 1) throw new Error('Automation budget allocation is inconsistent');
    }
    await transaction.query(
      `UPDATE automation_budget_reservations
       SET state = 'released', released_at = $2, terminal_reason_code = $3,
           execution_rechecked_at = NULL, execution_authorization_expires_at = NULL,
           control_version = NULL
       WHERE id = $1`,
      [reservation.id, input.context.now.toISOString(), input.reasonCode],
    );
    await transaction.query(
      `UPDATE automation_runs SET state = 'cancelled', completed_at = $2 WHERE id = $1`,
      [reservation.automation_run_id, input.context.now.toISOString()],
    );
    await this.recordEvent(transaction, {
      actorPersonId: input.context.actorPersonId,
      amountCents: reservation.estimated_cost_cents,
      correlationId: input.context.correlationId,
      eventKind: 'released',
      now: input.context.now,
      operationKey: reservation.operation_key,
      reasonCode: input.reasonCode,
      reservationId: reservation.id,
    });
    await writeAuditAndOutbox(
      transaction,
      this.ids,
      input.context,
      {
        action: 'business_os.automation_budget_released',
        resourceType: 'automation_budget_reservation',
        resourceId: reservation.id,
        outcome: 'completed',
        metadata: {
          estimatedCostCents: reservation.estimated_cost_cents,
          reasonCode: input.reasonCode,
        },
      },
      {
        eventType: 'business_os.automation_budget_released',
        aggregateType: 'automation_budget_reservation',
        aggregateId: reservation.id,
        payload: { reasonCode: input.reasonCode },
      },
    );
    return {
      estimatedCostCents: reservation.estimated_cost_cents,
      expiresAt: asDate(reservation.expires_at, 'automation budget reservation expiry'),
      id: reservation.id,
      operationKey: reservation.operation_key,
      state: 'released',
    };
  }

  async release(input: {
    readonly context: OperationalEventContext;
    readonly reasonCode: string;
    readonly reservationId: string;
  }): Promise<AutomationBudgetReservation> {
    assertCode(input.reasonCode, 'automation budget release reason');
    return this.database.transaction(async (transaction) => {
      await lockControl(transaction);
      const authorityNow = await this.authorityClock(transaction, input.context.now);
      return this.releaseLocked(
        transaction,
        await this.lockReservation(transaction, input.reservationId),
        {
          context: { ...input.context, now: authorityNow },
          reasonCode: input.reasonCode,
        },
      );
    });
  }

  async releaseExpired(input: {
    readonly context: OperationalEventContext;
    readonly limit?: number;
  }): Promise<number> {
    const limit = input.limit ?? 25;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError('Automation budget expiry release limit must be between 1 and 100');
    }
    return this.database.transaction(async (transaction) => {
      await lockControl(transaction);
      const authorityNow = await this.authorityClock(transaction, input.context.now);
      const context = { ...input.context, now: authorityNow };
      const expired = await transaction.query<ReservationRow>(
        `SELECT * FROM automation_budget_reservations
         WHERE state = 'reserved' AND expires_at <= $1
           AND NOT EXISTS (
             SELECT 1 FROM external_actions action
             WHERE action.budget_reservation_id = automation_budget_reservations.id
               AND action.effect_state IN ('unknown', 'accepted')
           )
         ORDER BY expires_at, id
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [authorityNow.toISOString(), limit],
      );
      for (const reservation of expired.rows) {
        await this.releaseLocked(transaction, reservation, {
          context,
          reasonCode: 'reservation_expired',
        });
      }
      return expired.rows.length;
    });
  }

  async recoverAcceptedExternalActions(input: {
    readonly context: OperationalEventContext;
    readonly limit?: number;
  }): Promise<number> {
    const limit = input.limit ?? 25;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError('Automation budget recovery limit must be between 1 and 100');
    }
    const accepted = await this.database.query<
      { operation_id: string; reservation_id: string } & Record<string, unknown>
    >(
      `SELECT action.operation_id, reservation.id AS reservation_id
       FROM external_actions action
       JOIN automation_budget_reservations reservation
         ON reservation.id = action.budget_reservation_id
       WHERE action.state = 'succeeded' AND action.effect_state = 'accepted'
         AND reservation.state = 'reserved'
       ORDER BY action.updated_at, action.operation_id
       LIMIT $1`,
      [limit],
    );
    let recovered = 0;
    for (const action of accepted.rows) {
      await this.commit({
        context: {
          ...input.context,
          correlationId: `${input.context.correlationId}:${action.operation_id}`,
        },
        evidence: { kind: 'external_action', reference: action.operation_id },
        reservationId: action.reservation_id,
      });
      recovered += 1;
    }
    return recovered;
  }

  async recheckBeforeIrreversibleExecution(input: {
    readonly context: OperationalEventContext;
    readonly reservationId: string;
  }): Promise<
    | {
        readonly allowed: true;
        readonly controlVersion: number;
        readonly recheckedAt: Date;
        readonly validUntil: Date;
      }
    | { readonly allowed: false; readonly reason: string }
  > {
    return this.database.transaction(async (transaction) => {
      const control = await lockControl(transaction);
      const authorityNow = await this.authorityClock(transaction, input.context.now);
      const context = { ...input.context, now: authorityNow };
      const reservation = await this.lockReservation(transaction, input.reservationId);
      if (reservation.state !== 'reserved') {
        return { allowed: false, reason: `Reservation is ${reservation.state}.` };
      }
      const expiresAt = asDate(reservation.expires_at, 'automation budget reservation expiry');
      const policyRow = await lockPolicy(transaction, reservation.action_key);
      const allocations = await this.lockAllocations(transaction, reservation.id);
      const currentCaps = await transaction.query<CapRow>(
        `SELECT * FROM automation_budget_caps
         WHERE enabled = true AND (
           (scope_kind = 'company' AND scope_key = 'global') OR
           (scope_kind = 'agent' AND scope_key = $1) OR
           (scope_kind = 'action' AND scope_key = $2) OR
           (scope_kind = 'tool' AND scope_key = $3) OR
           (scope_kind = 'policy' AND scope_key = $4)
         )
         ORDER BY id
         FOR UPDATE`,
        [
          reservation.agent_key,
          reservation.action_key,
          reservation.tool_key,
          reservation.policy_id,
        ],
      );
      const allocationVersions = new Map(
        allocations.map((allocation) => [allocation.cap_id, allocation.cap_version]),
      );
      const capsCurrent =
        currentCaps.rows.length === allocations.length &&
        currentCaps.rows.every((cap) => allocationVersions.get(cap.id) === cap.version);
      const storedRequest: AutomationRequest = {
        action: reservation.action_key,
        dataClasses: [
          ...stringArray(reservation.data_classes, 'automation_budget_reservations.data_classes'),
        ],
        estimatedCostCents: reservation.estimated_cost_cents,
        tool: reservation.tool_key,
      };
      const decision = authorizeAutomation(
        policyRow === undefined ? undefined : mapPolicy(policyRow),
        storedRequest,
        control.kill_switch,
      );
      const reason =
        authorityNow >= expiresAt
          ? 'reservation_expired'
          : policyRow === undefined ||
              policyRow.id !== reservation.policy_id ||
              policyRow.version !== reservation.policy_version
            ? 'policy_changed'
            : !capsCurrent
              ? 'budget_cap_changed'
              : decision.allowed
                ? undefined
                : control.kill_switch
                  ? 'global_kill_switch_engaged'
                  : 'policy_denied';
      if (reason !== undefined) {
        await this.releaseLocked(transaction, reservation, {
          context,
          reasonCode: reason,
        });
        return { allowed: false, reason };
      }
      const validUntil = new Date(
        Math.min(expiresAt.getTime(), authorityNow.getTime() + executionAuthorizationMs),
      );
      await transaction.query(
        `UPDATE automation_budget_reservations
         SET execution_rechecked_at = $2, execution_authorization_expires_at = $3,
             control_version = $4
         WHERE id = $1`,
        [reservation.id, authorityNow.toISOString(), validUntil.toISOString(), control.version],
      );
      await this.recordEvent(transaction, {
        actorPersonId: context.actorPersonId,
        controlVersion: control.version,
        correlationId: context.correlationId,
        eventKind: 'execution_rechecked',
        now: authorityNow,
        operationKey: reservation.operation_key,
        reservationId: reservation.id,
      });
      return {
        allowed: true,
        controlVersion: control.version,
        recheckedAt: authorityNow,
        validUntil,
      };
    });
  }

  async commit(input: {
    readonly context: OperationalEventContext;
    readonly evidence:
      | {
          readonly acceptedAt: Date;
          readonly actualCostCents: number;
          readonly evidenceLevel: 'fixture';
          readonly kind: 'local_simulation';
          readonly reference: string;
        }
      | { readonly kind: 'external_action'; readonly reference: string };
    readonly reservationId: string;
  }): Promise<
    AutomationBudgetReservation & {
      readonly authorizationBreach: boolean;
      readonly overrun: boolean;
    }
  > {
    assertOperationKey(input.evidence.reference, 'automation commit evidence reference');
    if (input.evidence.kind === 'local_simulation') {
      assertFiniteDate(input.evidence.acceptedAt, 'automation acceptance time');
      assertCents(input.evidence.actualCostCents, 'actual automation cost');
    }
    return this.database.transaction(async (transaction) => {
      const control = await lockControl(transaction);
      const authorityNow = await this.authorityClock(transaction, input.context.now);
      const context = { ...input.context, now: authorityNow };
      const reservation = await this.lockReservation(transaction, input.reservationId);
      if (reservation.state === 'released') {
        throw new TypeError('Released automation budget cannot be committed');
      }
      if (reservation.state === 'committed') {
        if (
          (input.evidence.kind === 'local_simulation' &&
            asSafeCents(reservation.actual_cost_cents, 'reservation actual cost') !==
              input.evidence.actualCostCents) ||
          reservation.commit_evidence_kind !== input.evidence.kind ||
          reservation.commit_evidence_reference !== input.evidence.reference
        ) {
          throw new TypeError('Automation budget commit conflicts with its terminal evidence');
        }
        return {
          ...mapReservation(reservation),
          authorizationBreach: reservation.authorization_breach,
          overrun: reservation.overrun_detected,
        };
      }
      const allocations = await this.lockAllocations(transaction, reservation.id);
      let actualCostCents: number;
      let authorizationBreach = false;
      if (input.evidence.kind === 'local_simulation') {
        if (
          reservation.execution_rechecked_at === null ||
          reservation.execution_authorization_expires_at === null
        ) {
          throw new TypeError('Automation budget requires an immediate pre-execution recheck');
        }
        const recheckedAt = asDate(
          reservation.execution_rechecked_at,
          'automation budget execution recheck',
        );
        const authorizationExpiresAt = asDate(
          reservation.execution_authorization_expires_at,
          'automation budget execution authorization expiry',
        );
        if (
          input.evidence.acceptedAt < recheckedAt ||
          input.evidence.acceptedAt > authorizationExpiresAt ||
          input.evidence.acceptedAt > authorityNow
        ) {
          throw new TypeError(
            'Automation acceptance is outside its rechecked authorization window',
          );
        }
        actualCostCents = input.evidence.actualCostCents;
      } else {
        if (input.evidence.reference !== reservation.operation_key) {
          throw new TypeError('External action evidence must use the reserved operation key');
        }
        const actionResult = await transaction.query<
          {
            budget_magnitude_kind: string;
            cost_currency: string;
            cost_source_key: string;
            cost_source_version: string;
            effect_state: string;
            exposure_evidence_level: string;
            financial_exposure_upper_bound_cents: number;
            state: string;
          } & Record<string, unknown>
        >(
          `SELECT state, effect_state, exposure_evidence_level,
                  financial_exposure_upper_bound_cents,
                  budget_magnitude_kind, cost_currency, cost_source_key, cost_source_version
           FROM external_actions
           WHERE operation_id = $1 AND budget_reservation_id = $2
           FOR UPDATE`,
          [input.evidence.reference, reservation.id],
        );
        const action = actionResult.rows[0];
        const acceptedResult = await transaction.query<
          {
            acceptance_rule_id: string;
            acceptance_rule_version: number;
            actual_financial_exposure_cents: unknown;
            attempt: number;
            budget_magnitude_kind: string;
            cost_currency: string;
            cost_source_key: string;
            cost_source_version: string;
            cost_evidence_level: string;
            occurred_at: unknown;
            provider_normalized_outcome: string;
          } & Record<string, unknown>
        >(
          `SELECT attempt, occurred_at, provider_normalized_outcome,
                  acceptance_rule_id, acceptance_rule_version,
                  actual_financial_exposure_cents, budget_magnitude_kind,
                  cost_currency, cost_source_key, cost_source_version, cost_evidence_level
           FROM external_action_attempts
           WHERE operation_id = $1
             AND event_kind IN ('provider_accepted', 'reconciliation_confirmed_success')
           ORDER BY occurred_at DESC, id DESC LIMIT 1`,
          [input.evidence.reference],
        );
        const accepted = acceptedResult.rows[0];
        if (
          action?.state !== 'succeeded' ||
          action.effect_state !== 'accepted' ||
          accepted?.provider_normalized_outcome !== 'accepted' ||
          accepted.acceptance_rule_id === null ||
          accepted.acceptance_rule_version < 1 ||
          accepted.budget_magnitude_kind !== action.budget_magnitude_kind ||
          action.exposure_evidence_level !== 'local_fixture' ||
          accepted.cost_evidence_level !== action.exposure_evidence_level ||
          accepted.cost_currency !== 'USD' ||
          accepted.cost_source_key !== action.cost_source_key ||
          accepted.cost_source_version !== action.cost_source_version
        ) {
          throw new TypeError('External action acceptance evidence is not terminally confirmed');
        }
        actualCostCents = asSafeCents(
          accepted.actual_financial_exposure_cents,
          'external accepted financial exposure',
        );
        if (
          ((action.budget_magnitude_kind === 'refund_principal' ||
            action.budget_magnitude_kind === 'credit_principal') &&
            (actualCostCents <= 0 ||
              action.financial_exposure_upper_bound_cents !== reservation.estimated_cost_cents)) ||
          (action.budget_magnitude_kind === 'provider_cost' &&
            (action.financial_exposure_upper_bound_cents !== reservation.estimated_cost_cents ||
              action.financial_exposure_upper_bound_cents < 0))
        ) {
          throw new TypeError('External action magnitude evidence conflicts with its reservation');
        }
        const acceptedAt = asDate(accepted.occurred_at, 'external action acceptance time');
        const claimResult = await transaction.query<
          {
            budget_authorization_expires_at: unknown;
            budget_control_version: number;
            budget_rechecked_at: unknown;
            budget_reservation_id: string;
            occurred_at: unknown;
          } & Record<string, unknown>
        >(
          `SELECT occurred_at, budget_reservation_id, budget_control_version,
                  budget_rechecked_at, budget_authorization_expires_at
           FROM external_action_attempts
           WHERE operation_id = $1 AND attempt = $2 AND event_kind = 'claimed'
           ORDER BY occurred_at, id LIMIT 1`,
          [input.evidence.reference, accepted.attempt],
        );
        const claim = claimResult.rows[0];
        const claimedAt =
          claim === undefined ? undefined : asDate(claim.occurred_at, 'external claim time');
        const claimRecheckedAt =
          claim === undefined
            ? undefined
            : asDate(claim.budget_rechecked_at, 'external claim budget recheck');
        const claimAuthorizationExpiresAt =
          claim === undefined
            ? undefined
            : asDate(
                claim.budget_authorization_expires_at,
                'external claim budget authorization expiry',
              );
        authorizationBreach =
          claim === undefined ||
          claim.budget_reservation_id !== reservation.id ||
          claim.budget_control_version !== reservation.control_version ||
          claimedAt === undefined ||
          claimRecheckedAt === undefined ||
          claimAuthorizationExpiresAt === undefined ||
          claimedAt < claimRecheckedAt ||
          claimedAt > claimAuthorizationExpiresAt ||
          acceptedAt < claimedAt ||
          acceptedAt > authorityNow;
      }
      let overrun = actualCostCents > reservation.estimated_cost_cents;
      for (const allocation of allocations) {
        const capResult = await transaction.query<CapRow>(
          'SELECT * FROM automation_budget_caps WHERE id = $1 FOR UPDATE',
          [allocation.cap_id],
        );
        const cap = capResult.rows[0];
        if (cap === undefined) throw new Error('Automation budget cap is unavailable');
        const periodStart = asDate(allocation.period_start, 'budget allocation period');
        const windowResult = await transaction.query<
          WindowRow & { readonly would_exceed: boolean }
        >(
          `SELECT cap_id, period_start, period_end, reserved_cents, committed_cents,
                  override_cents,
                  committed_cents + $3::bigint > $4::bigint + override_cents AS would_exceed
           FROM automation_budget_windows
           WHERE cap_id = $1 AND period_start = $2`,
          [allocation.cap_id, periodStart.toISOString(), actualCostCents, cap.limit_cents],
        );
        const window = windowResult.rows[0];
        if (window === undefined) throw new Error('Automation budget window is unavailable');
        if (window.would_exceed) {
          overrun = true;
        }
        const updated = await transaction.query(
          `UPDATE automation_budget_windows
           SET reserved_cents = reserved_cents - $3,
               committed_cents = committed_cents + $4, updated_at = $5
           WHERE cap_id = $1 AND period_start = $2 AND reserved_cents >= $3`,
          [
            allocation.cap_id,
            periodStart.toISOString(),
            allocation.reserved_cents,
            actualCostCents,
            authorityNow.toISOString(),
          ],
        );
        if (updated.rowCount !== 1) throw new Error('Automation budget allocation is inconsistent');
      }
      await transaction.query(
        `UPDATE automation_budget_reservations
         SET state = 'committed', actual_cost_cents = $2, committed_at = $3,
             commit_evidence_kind = $4, commit_evidence_reference = $5,
             overrun_detected = $6, authorization_breach = $7
         WHERE id = $1`,
        [
          reservation.id,
          actualCostCents,
          authorityNow.toISOString(),
          input.evidence.kind,
          input.evidence.reference,
          overrun,
          authorizationBreach,
        ],
      );
      await transaction.query(
        `UPDATE automation_runs
         SET state = 'completed', actual_cost_cents = $2, completed_at = $3
         WHERE id = $1`,
        [reservation.automation_run_id, actualCostCents, authorityNow.toISOString()],
      );
      let controlVersion = control.version;
      if ((overrun || authorizationBreach) && !control.kill_switch) {
        const updatedControl = await transaction.query<
          { version: number } & Record<string, unknown>
        >(
          `UPDATE automation_global_control
           SET kill_switch = true, updated_by_person_id = $2, updated_at = $1,
               version = version + 1
           WHERE control_key = 'global' RETURNING version`,
          [authorityNow.toISOString(), context.actorPersonId ?? null],
        );
        controlVersion = updatedControl.rows[0]?.version ?? controlVersion;
        await transaction.query(
          `INSERT INTO automation_global_control_history(
             id, kill_switch, updated_by_person_id, recorded_at, control_version
           ) VALUES ($1,true,$2,$3,$4)`,
          [
            this.ids.next('automation_global_control'),
            context.actorPersonId ?? null,
            authorityNow.toISOString(),
            controlVersion,
          ],
        );
      }
      await this.recordEvent(transaction, {
        actorPersonId: context.actorPersonId,
        amountCents: actualCostCents,
        controlVersion,
        correlationId: context.correlationId,
        eventKind: 'committed',
        now: authorityNow,
        operationKey: reservation.operation_key,
        reservationId: reservation.id,
      });
      if (overrun) {
        await this.recordEvent(transaction, {
          actorPersonId: context.actorPersonId,
          amountCents: Math.max(0, actualCostCents - reservation.estimated_cost_cents),
          controlVersion,
          correlationId: context.correlationId,
          eventKind: 'overrun',
          now: authorityNow,
          operationKey: reservation.operation_key,
          reasonCode: 'actual_cost_exceeded_reservation',
          reservationId: reservation.id,
        });
      }
      if (authorizationBreach) {
        await this.recordEvent(transaction, {
          actorPersonId: context.actorPersonId,
          amountCents: actualCostCents,
          controlVersion,
          correlationId: context.correlationId,
          eventKind: 'authorization_breach',
          now: authorityNow,
          operationKey: reservation.operation_key,
          reasonCode: 'external_dispatch_authority_unproven',
          reservationId: reservation.id,
        });
      }
      await writeAuditAndOutbox(
        transaction,
        this.ids,
        context,
        {
          action: 'business_os.automation_budget_committed',
          resourceType: 'automation_budget_reservation',
          resourceId: reservation.id,
          outcome: 'completed',
          metadata: { actualCostCents, authorizationBreach, overrun },
        },
        {
          eventType: 'business_os.automation_budget_committed',
          aggregateType: 'automation_budget_reservation',
          aggregateId: reservation.id,
          payload: { actualCostCents, authorizationBreach, overrun },
        },
      );
      return {
        actualCostCents,
        authorizationBreach,
        estimatedCostCents: reservation.estimated_cost_cents,
        expiresAt: asDate(reservation.expires_at, 'automation budget reservation expiry'),
        id: reservation.id,
        operationKey: reservation.operation_key,
        overrun,
        state: 'committed',
      };
    });
  }
}

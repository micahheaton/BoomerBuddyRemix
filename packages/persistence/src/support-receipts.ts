import { createHmac, randomBytes } from 'node:crypto';

import {
  DomainError,
  nextSupportReceiptState,
  supportReceiptCategories,
  supportReceiptImpacts,
  type SupportReceiptAction,
  type SupportReceiptCategory,
  type SupportReceiptImpact,
  type SupportReceiptResolutionCode,
  type SupportReceiptState,
} from '@boomerbuddy/domain';
import { constantTimeEqual, lengthPrefixed } from '@boomerbuddy/security';

import type { Database, SqlExecutor } from './database';
import { asDate, randomIdFactory, type IdFactory } from './values';

const operationKeyPatterns = {
  create:
    /^support-receipt:create:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  withdraw:
    /^support-receipt:withdraw:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  transition:
    /^support-receipt:transition:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
} as const;
const stableIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u;
const receiptCodePattern = /^support_receipt_[A-Za-z0-9_-]{32}$/u;
const maximumPageSize = 100;
const maximumPageOffset = 10_000;

export interface SupportReceiptRecord {
  readonly receiptCode: string;
  readonly householdId: string;
  readonly category: SupportReceiptCategory;
  readonly impact: SupportReceiptImpact;
  readonly state: SupportReceiptState;
  readonly resolutionCode?: SupportReceiptResolutionCode;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SupportReceiptMutationResult {
  readonly receipt: SupportReceiptRecord;
  readonly reused: boolean;
}

export interface SupportReceiptListResult {
  readonly receipts: readonly SupportReceiptRecord[];
  readonly truncated: boolean;
  readonly nextOffset: number | null;
}

export interface SupportReceiptPurgeResult {
  readonly receiptsDeleted: number;
  readonly rateBucketsDeleted: number;
  readonly saturated: boolean;
}

export interface SupportReceiptLimits {
  readonly maximumOpenPerPerson: number;
  readonly maximumCreatesPerPersonDay: number;
  readonly maximumCreatesPerHouseholdDay: number;
}

const defaultLimits: SupportReceiptLimits = {
  maximumOpenPerPerson: 3,
  maximumCreatesPerPersonDay: 5,
  maximumCreatesPerHouseholdDay: 20,
};

interface ReceiptRow extends Record<string, unknown> {
  readonly receipt_code: string;
  readonly household_id: string;
  readonly category: SupportReceiptCategory;
  readonly impact: SupportReceiptImpact;
  readonly to_state: SupportReceiptState;
  readonly resolution_code: SupportReceiptResolutionCode | null;
  readonly created_at: unknown;
  readonly occurred_at: unknown;
}

interface OperationRow extends ReceiptRow {
  readonly operation_kind: 'create' | 'withdraw' | 'transition';
  readonly actor_person_id: string;
  readonly request_digest: string;
}

interface CurrentReceiptRow extends ReceiptRow {
  readonly opened_by_person_id: string;
  readonly sequence: number;
}

function assertStableIdentifier(value: string, label: string): void {
  if (!stableIdentifier.test(value)) {
    throw new DomainError('invalid_input', `${label} is invalid`);
  }
}

function assertOperationKey(operationKey: string, kind: keyof typeof operationKeyPatterns): void {
  if (!operationKeyPatterns[kind].test(operationKey)) {
    throw new DomainError('invalid_input', 'Support receipt idempotency key is invalid');
  }
}

function assertPageSize(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumPageSize) {
    throw new TypeError('Support receipt page size must be between 1 and 100');
  }
}

function assertPageOffset(offset: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > maximumPageOffset) {
    throw new TypeError('Support receipt page offset must be between 0 and 10000');
  }
}

function reachablePageLimit(limit: number, offset: number): number {
  if (offset === maximumPageOffset) return limit;
  return Math.min(limit, maximumPageOffset - offset);
}

function nextPageOffset(input: {
  readonly offset: number;
  readonly returnedLimit: number;
  readonly truncated: boolean;
}): number | null {
  if (!input.truncated || input.offset === maximumPageOffset) return null;
  return input.offset + input.returnedLimit;
}

function assertLimits(limits: SupportReceiptLimits): void {
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
      throw new TypeError('Support receipt limits must be positive bounded integers');
    }
  }
  if (limits.maximumCreatesPerPersonDay > limits.maximumCreatesPerHouseholdDay) {
    throw new TypeError('Support receipt person quota cannot exceed the household quota');
  }
}

function receiptFromRow(row: ReceiptRow): SupportReceiptRecord {
  return {
    receiptCode: row.receipt_code,
    householdId: row.household_id,
    category: row.category,
    impact: row.impact,
    state: row.to_state,
    ...(row.resolution_code === null ? {} : { resolutionCode: row.resolution_code }),
    createdAt: asDate(row.created_at, 'support receipt creation'),
    updatedAt: asDate(row.occurred_at, 'support receipt update'),
  };
}

async function databaseNow(executor: SqlExecutor): Promise<Date> {
  const result = await executor.query<
    { readonly authority_now: unknown } & Record<string, unknown>
  >('SELECT clock_timestamp() AS authority_now');
  return asDate(result.rows[0]?.authority_now, 'support receipt authority time');
}

async function consumeQuota(
  executor: SqlExecutor,
  input: {
    readonly bucketStart: string;
    readonly scope: 'person' | 'household';
    readonly scopeKeyHmac: string;
    readonly maximum: number;
  },
): Promise<void> {
  const result = await executor.query<Record<string, unknown>>(
    `INSERT INTO support_receipt_rate_buckets(
       bucket_start, scope, scope_key_hmac, used_count
     ) VALUES ($1,$2,$3,1)
     ON CONFLICT (bucket_start, scope, scope_key_hmac) DO UPDATE
     SET used_count = support_receipt_rate_buckets.used_count + 1
     WHERE support_receipt_rate_buckets.used_count < $4
     RETURNING used_count`,
    [input.bucketStart, input.scope, input.scopeKeyHmac, input.maximum],
  );
  if (result.rowCount !== 1) {
    throw new DomainError('conflict', 'Support receipt creation is temporarily limited');
  }
}

export class SupportReceiptRepository {
  private readonly limits: SupportReceiptLimits;

  constructor(
    private readonly database: Database,
    private readonly hmacKey: Uint8Array,
    limits: Partial<SupportReceiptLimits> = {},
    private readonly ids: IdFactory = randomIdFactory,
  ) {
    if (hmacKey.byteLength < 32) {
      throw new TypeError('Support receipt HMAC key must contain at least 32 bytes');
    }
    this.limits = { ...defaultLimits, ...limits };
    assertLimits(this.limits);
  }

  private digest(label: string, fields: readonly string[]): string {
    return createHmac('sha256', this.hmacKey)
      .update(lengthPrefixed([`boomerbuddy:support-receipt:${label}:v1`, ...fields]))
      .digest('base64url');
  }

  private operationEvidence(input: {
    readonly operationKey: string;
    readonly kind: 'create' | 'withdraw' | 'transition';
    readonly actorPersonId: string;
    readonly householdId: string;
    readonly requestFields: readonly string[];
  }): { readonly operationKeyHmac: string; readonly requestDigest: string } {
    assertOperationKey(input.operationKey, input.kind);
    return {
      operationKeyHmac: this.digest('operation', [input.operationKey]),
      requestDigest: this.digest('request', [
        input.kind,
        input.actorPersonId,
        input.householdId,
        ...input.requestFields,
      ]),
    };
  }

  private rateKey(scope: 'person' | 'household', value: string): string {
    return this.digest(`rate:${scope}`, [value]);
  }

  private async lockGate(executor: SqlExecutor): Promise<void> {
    const result = await executor.query<Record<string, unknown>>(
      'SELECT id FROM support_receipt_gate WHERE id = 1 FOR UPDATE',
    );
    if (result.rowCount !== 1) {
      throw new DomainError('conflict', 'Support receipt serialization gate is unavailable');
    }
  }

  private async assertActiveMembership(
    executor: SqlExecutor,
    householdId: string,
    actorPersonId: string,
  ): Promise<void> {
    const result = await executor.query<Record<string, unknown>>(
      `SELECT 1 FROM household_memberships membership
       WHERE membership.household_id = $1 AND membership.person_id = $2
         AND membership.status = 'active'
       LIMIT 1`,
      [householdId, actorPersonId],
    );
    if (result.rows[0] === undefined) {
      throw new DomainError('not_authorized', 'Support receipt household access is unavailable');
    }
  }

  private async assertActiveHqOwner(executor: SqlExecutor, actorPersonId: string): Promise<void> {
    const result = await executor.query<Record<string, unknown>>(
      `SELECT 1 FROM employee_assignments employee
       JOIN organizations organization ON organization.id = employee.organization_id
       WHERE employee.person_id = $1 AND employee.role = 'hq_owner'
         AND employee.status = 'active' AND organization.kind = 'internal'
       LIMIT 1`,
      [actorPersonId],
    );
    if (result.rows[0] === undefined) {
      throw new DomainError('not_authorized', 'Support receipt HQ owner access is unavailable');
    }
  }

  private async priorOperation(
    executor: SqlExecutor,
    input: {
      readonly operationKeyHmac: string;
      readonly requestDigest: string;
      readonly kind: 'create' | 'withdraw' | 'transition';
      readonly actorPersonId: string;
      readonly householdId: string;
    },
  ): Promise<SupportReceiptRecord | undefined> {
    const result = await executor.query<OperationRow>(
      `SELECT operation.operation_kind, operation.actor_person_id,
              operation.request_digest, receipt.receipt_code, receipt.household_id,
              receipt.category, receipt.impact, receipt.created_at,
              event.to_state, event.resolution_code, event.occurred_at
       FROM support_receipt_operations operation
       JOIN support_receipts receipt
         ON receipt.household_id = operation.household_id
        AND receipt.receipt_code = operation.receipt_code
       JOIN LATERAL (
         SELECT to_state, resolution_code, occurred_at
         FROM support_receipt_events current_event
         WHERE current_event.receipt_code = receipt.receipt_code
         ORDER BY current_event.sequence DESC LIMIT 1
       ) event ON true
       WHERE operation.operation_key_hmac = $1`,
      [input.operationKeyHmac],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    if (
      row.operation_kind !== input.kind ||
      row.actor_person_id !== input.actorPersonId ||
      row.household_id !== input.householdId ||
      !constantTimeEqual(row.request_digest, input.requestDigest)
    ) {
      throw new DomainError(
        'conflict',
        'Support receipt idempotency key was used for a different request',
      );
    }
    return receiptFromRow(row);
  }

  private async currentReceipt(
    executor: SqlExecutor,
    input: { readonly receiptCode: string; readonly householdId?: string },
  ): Promise<CurrentReceiptRow | undefined> {
    if (!receiptCodePattern.test(input.receiptCode)) {
      throw new DomainError('invalid_input', 'Support receipt code is invalid');
    }
    const result = await executor.query<CurrentReceiptRow>(
      `SELECT receipt.receipt_code, receipt.household_id, receipt.opened_by_person_id,
              receipt.category, receipt.impact, receipt.created_at,
              event.sequence, event.to_state, event.resolution_code, event.occurred_at
       FROM support_receipts receipt
       JOIN LATERAL (
         SELECT sequence, to_state, resolution_code, occurred_at
         FROM support_receipt_events current_event
         WHERE current_event.receipt_code = receipt.receipt_code
         ORDER BY sequence DESC LIMIT 1
       ) event ON true
       WHERE receipt.receipt_code = $1
         AND ($2::text IS NULL OR receipt.household_id = $2)`,
      [input.receiptCode, input.householdId ?? null],
    );
    return result.rows[0];
  }

  private async writeAudit(
    executor: SqlExecutor,
    input: {
      readonly actorPersonId: string;
      readonly audience: 'customer' | 'mobile' | 'hq';
      readonly action: string;
      readonly householdId?: string;
      readonly resourceId: string;
      readonly correlationId: string;
      readonly metadata: Readonly<Record<string, string | number | boolean>>;
      readonly occurredAt: Date;
    },
  ): Promise<void> {
    await executor.query(
      `INSERT INTO audit_events(
         id, household_id, actor_person_id, session_audience, action, resource_type,
         resource_id, outcome, metadata, correlation_id, occurred_at
       ) VALUES ($1,$2,$3,$4,$5,'support_receipt',$6,'completed',$7::jsonb,$8,$9)`,
      [
        this.ids.next('audit'),
        input.householdId ?? null,
        input.actorPersonId,
        input.audience,
        input.action,
        input.resourceId,
        JSON.stringify(input.metadata),
        input.correlationId,
        input.occurredAt.toISOString(),
      ],
    );
  }

  async create(input: {
    readonly actorPersonId: string;
    readonly audience: 'customer' | 'mobile';
    readonly householdId: string;
    readonly category: SupportReceiptCategory;
    readonly impact: SupportReceiptImpact;
    readonly operationKey: string;
    readonly correlationId: string;
  }): Promise<SupportReceiptMutationResult> {
    assertStableIdentifier(input.actorPersonId, 'Support receipt actor');
    assertStableIdentifier(input.householdId, 'Support receipt household');
    assertStableIdentifier(input.correlationId, 'Support receipt correlation');
    if (
      !supportReceiptCategories.includes(input.category) ||
      !supportReceiptImpacts.includes(input.impact)
    ) {
      throw new DomainError('invalid_input', 'Support receipt classification is invalid');
    }
    const evidence = this.operationEvidence({
      operationKey: input.operationKey,
      kind: 'create',
      actorPersonId: input.actorPersonId,
      householdId: input.householdId,
      requestFields: [input.category, input.impact],
    });
    return this.database.transaction(async (transaction) => {
      await this.lockGate(transaction);
      await this.assertActiveMembership(transaction, input.householdId, input.actorPersonId);
      const prior = await this.priorOperation(transaction, {
        ...evidence,
        kind: 'create',
        actorPersonId: input.actorPersonId,
        householdId: input.householdId,
      });
      if (prior !== undefined) return { receipt: prior, reused: true };
      const open = await transaction.query<{ readonly count: number } & Record<string, unknown>>(
        `SELECT count(*)::integer AS count
         FROM support_receipts receipt
         WHERE receipt.household_id = $1 AND receipt.opened_by_person_id = $2
           AND (
             SELECT event.to_state FROM support_receipt_events event
             WHERE event.receipt_code = receipt.receipt_code
             ORDER BY event.sequence DESC LIMIT 1
           ) IN ('open','acknowledged','in_review')`,
        [input.householdId, input.actorPersonId],
      );
      if ((open.rows[0]?.count ?? 0) >= this.limits.maximumOpenPerPerson) {
        throw new DomainError('conflict', 'Resolve or withdraw an existing support receipt first');
      }
      const now = await databaseNow(transaction);
      const bucketStart = now.toISOString().slice(0, 10);
      await consumeQuota(transaction, {
        bucketStart,
        scope: 'person',
        scopeKeyHmac: this.rateKey('person', input.actorPersonId),
        maximum: this.limits.maximumCreatesPerPersonDay,
      });
      await consumeQuota(transaction, {
        bucketStart,
        scope: 'household',
        scopeKeyHmac: this.rateKey('household', input.householdId),
        maximum: this.limits.maximumCreatesPerHouseholdDay,
      });
      const receiptCode = `support_receipt_${randomBytes(24).toString('base64url')}`;
      const state = nextSupportReceiptState({ action: 'create', actorKind: 'customer' });
      await transaction.query(
        `INSERT INTO support_receipts(
           receipt_code, household_id, opened_by_person_id, category, impact, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          receiptCode,
          input.householdId,
          input.actorPersonId,
          input.category,
          input.impact,
          now.toISOString(),
        ],
      );
      await transaction.query(
        `INSERT INTO support_receipt_operations(
           operation_key_hmac, request_digest, operation_kind, actor_kind,
           actor_person_id, household_id, receipt_code, created_at
         ) VALUES ($1,$2,'create','customer',$3,$4,$5,$6)`,
        [
          evidence.operationKeyHmac,
          evidence.requestDigest,
          input.actorPersonId,
          input.householdId,
          receiptCode,
          now.toISOString(),
        ],
      );
      await transaction.query(
        `INSERT INTO support_receipt_events(
           receipt_code, household_id, sequence, operation_key_hmac, from_state,
           to_state, action, actor_kind, actor_person_id, resolution_code,
           correlation_id, occurred_at
         ) VALUES ($1,$2,1,$3,NULL,$4,'create','customer',$5,NULL,$6,$7)`,
        [
          receiptCode,
          input.householdId,
          evidence.operationKeyHmac,
          state,
          input.actorPersonId,
          input.correlationId,
          now.toISOString(),
        ],
      );
      await this.writeAudit(transaction, {
        actorPersonId: input.actorPersonId,
        audience: input.audience,
        action: 'support_receipt.created',
        householdId: input.householdId,
        resourceId: receiptCode,
        correlationId: input.correlationId,
        metadata: {
          category: input.category,
          impact: input.impact,
          state,
          contentIncluded: false,
          outboundMessageSent: false,
          providerActionExecuted: false,
        },
        occurredAt: now,
      });
      return {
        receipt: {
          receiptCode,
          householdId: input.householdId,
          category: input.category,
          impact: input.impact,
          state,
          createdAt: now,
          updatedAt: now,
        },
        reused: false,
      };
    });
  }

  async listForCustomer(input: {
    readonly actorPersonId: string;
    readonly householdId: string;
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<SupportReceiptListResult> {
    const limit = input.limit ?? maximumPageSize;
    const offset = input.offset ?? 0;
    assertPageSize(limit);
    assertPageOffset(offset);
    const returnedLimit = reachablePageLimit(limit, offset);
    assertStableIdentifier(input.actorPersonId, 'Support receipt actor');
    assertStableIdentifier(input.householdId, 'Support receipt household');
    return this.database.transaction(async (transaction) => {
      await this.assertActiveMembership(transaction, input.householdId, input.actorPersonId);
      const result = await transaction.query<ReceiptRow>(
        `SELECT receipt.receipt_code, receipt.household_id, receipt.category,
                receipt.impact, receipt.created_at, event.to_state,
                event.resolution_code, event.occurred_at
         FROM support_receipts receipt
         JOIN LATERAL (
           SELECT to_state, resolution_code, occurred_at
           FROM support_receipt_events current_event
           WHERE current_event.receipt_code = receipt.receipt_code
           ORDER BY sequence DESC LIMIT 1
         ) event ON true
         WHERE receipt.household_id = $1 AND receipt.opened_by_person_id = $2
         ORDER BY receipt.created_at DESC, receipt.receipt_code
         LIMIT $3 OFFSET $4`,
        [input.householdId, input.actorPersonId, returnedLimit + 1, offset],
      );
      const truncated = result.rows.length > returnedLimit;
      return {
        receipts: result.rows.slice(0, returnedLimit).map(receiptFromRow),
        truncated,
        nextOffset: nextPageOffset({ offset, returnedLimit, truncated }),
      };
    });
  }

  async withdraw(input: {
    readonly actorPersonId: string;
    readonly audience: 'customer' | 'mobile';
    readonly householdId: string;
    readonly receiptCode: string;
    readonly operationKey: string;
    readonly correlationId: string;
  }): Promise<SupportReceiptMutationResult> {
    assertStableIdentifier(input.actorPersonId, 'Support receipt actor');
    assertStableIdentifier(input.householdId, 'Support receipt household');
    assertStableIdentifier(input.correlationId, 'Support receipt correlation');
    const evidence = this.operationEvidence({
      operationKey: input.operationKey,
      kind: 'withdraw',
      actorPersonId: input.actorPersonId,
      householdId: input.householdId,
      requestFields: [input.receiptCode],
    });
    return this.database.transaction(async (transaction) => {
      await this.lockGate(transaction);
      await this.assertActiveMembership(transaction, input.householdId, input.actorPersonId);
      const prior = await this.priorOperation(transaction, {
        ...evidence,
        kind: 'withdraw',
        actorPersonId: input.actorPersonId,
        householdId: input.householdId,
      });
      if (prior !== undefined) return { receipt: prior, reused: true };
      const current = await this.currentReceipt(transaction, {
        receiptCode: input.receiptCode,
        householdId: input.householdId,
      });
      if (current === undefined || current.opened_by_person_id !== input.actorPersonId) {
        throw new DomainError('not_found', 'Support receipt is unavailable');
      }
      let state: SupportReceiptState;
      try {
        state = nextSupportReceiptState({
          action: 'withdraw',
          actorKind: 'customer',
          currentState: current.to_state,
        });
      } catch {
        throw new DomainError('invalid_transition', 'Support receipt cannot be withdrawn');
      }
      const now = await databaseNow(transaction);
      await transaction.query(
        `INSERT INTO support_receipt_operations(
           operation_key_hmac, request_digest, operation_kind, actor_kind,
           actor_person_id, household_id, receipt_code, created_at
         ) VALUES ($1,$2,'withdraw','customer',$3,$4,$5,$6)`,
        [
          evidence.operationKeyHmac,
          evidence.requestDigest,
          input.actorPersonId,
          input.householdId,
          input.receiptCode,
          now.toISOString(),
        ],
      );
      await transaction.query(
        `INSERT INTO support_receipt_events(
           receipt_code, household_id, sequence, operation_key_hmac, from_state,
           to_state, action, actor_kind, actor_person_id, resolution_code,
           correlation_id, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,'withdraw','customer',$7,NULL,$8,$9)`,
        [
          input.receiptCode,
          input.householdId,
          current.sequence + 1,
          evidence.operationKeyHmac,
          current.to_state,
          state,
          input.actorPersonId,
          input.correlationId,
          now.toISOString(),
        ],
      );
      await this.writeAudit(transaction, {
        actorPersonId: input.actorPersonId,
        audience: input.audience,
        action: 'support_receipt.withdrawn',
        householdId: input.householdId,
        resourceId: input.receiptCode,
        correlationId: input.correlationId,
        metadata: {
          state,
          contentIncluded: false,
          outboundMessageSent: false,
          providerActionExecuted: false,
        },
        occurredAt: now,
      });
      return {
        receipt: {
          ...receiptFromRow(current),
          state,
          updatedAt: now,
        },
        reused: false,
      };
    });
  }

  async listForHq(input: {
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<SupportReceiptListResult> {
    const limit = input.limit ?? maximumPageSize;
    const offset = input.offset ?? 0;
    assertPageSize(limit);
    assertPageOffset(offset);
    const returnedLimit = reachablePageLimit(limit, offset);
    assertStableIdentifier(input.actorPersonId, 'Support receipt HQ actor');
    assertStableIdentifier(input.correlationId, 'Support receipt correlation');
    return this.database.transaction(async (transaction) => {
      await this.assertActiveHqOwner(transaction, input.actorPersonId);
      const now = await databaseNow(transaction);
      const result = await transaction.query<ReceiptRow>(
        `SELECT receipt.receipt_code, receipt.household_id, receipt.category,
                receipt.impact, receipt.created_at, event.to_state,
                event.resolution_code, event.occurred_at
         FROM support_receipts receipt
         JOIN LATERAL (
           SELECT to_state, resolution_code, occurred_at
           FROM support_receipt_events current_event
           WHERE current_event.receipt_code = receipt.receipt_code
           ORDER BY sequence DESC LIMIT 1
         ) event ON true
         WHERE event.to_state IN ('open','acknowledged','in_review')
         ORDER BY
           CASE receipt.impact
             WHEN 'safety_concern' THEN 0 WHEN 'blocked' THEN 1
             WHEN 'degraded' THEN 2 ELSE 3
           END,
           receipt.created_at, receipt.receipt_code
         LIMIT $1 OFFSET $2`,
        [returnedLimit + 1, offset],
      );
      const truncated = result.rows.length > returnedLimit;
      await this.writeAudit(transaction, {
        actorPersonId: input.actorPersonId,
        audience: 'hq',
        action: 'hq.support_receipts.read',
        resourceId: 'content_free_support_receipts',
        correlationId: input.correlationId,
        metadata: {
          returnedCount: Math.min(result.rows.length, returnedLimit),
          truncated,
          contentIncluded: false,
        },
        occurredAt: now,
      });
      return {
        receipts: result.rows.slice(0, returnedLimit).map(receiptFromRow),
        truncated,
        nextOffset: nextPageOffset({ offset, returnedLimit, truncated }),
      };
    });
  }

  async transition(input: {
    readonly actorPersonId: string;
    readonly receiptCode: string;
    readonly action: Extract<SupportReceiptAction, 'acknowledge' | 'start_review' | 'resolve'>;
    readonly resolutionCode?: SupportReceiptResolutionCode;
    readonly operationKey: string;
    readonly correlationId: string;
  }): Promise<SupportReceiptMutationResult> {
    assertStableIdentifier(input.actorPersonId, 'Support receipt HQ actor');
    assertStableIdentifier(input.correlationId, 'Support receipt correlation');
    if (!receiptCodePattern.test(input.receiptCode)) {
      throw new DomainError('invalid_input', 'Support receipt code is invalid');
    }
    const evidence = this.operationEvidence({
      operationKey: input.operationKey,
      kind: 'transition',
      actorPersonId: input.actorPersonId,
      householdId: 'hq-global',
      requestFields: [input.receiptCode, input.action, input.resolutionCode ?? 'none'],
    });
    return this.database.transaction(async (transaction) => {
      await this.lockGate(transaction);
      await this.assertActiveHqOwner(transaction, input.actorPersonId);
      const existingOperation = await transaction.query<OperationRow>(
        `SELECT operation.operation_kind, operation.actor_person_id,
                operation.request_digest, receipt.receipt_code, receipt.household_id,
                receipt.category, receipt.impact, receipt.created_at,
                event.to_state, event.resolution_code, event.occurred_at
         FROM support_receipt_operations operation
         JOIN support_receipts receipt
           ON receipt.household_id = operation.household_id
          AND receipt.receipt_code = operation.receipt_code
         JOIN LATERAL (
           SELECT to_state, resolution_code, occurred_at
           FROM support_receipt_events current_event
           WHERE current_event.receipt_code = receipt.receipt_code
           ORDER BY current_event.sequence DESC LIMIT 1
         ) event ON true
         WHERE operation.operation_key_hmac = $1`,
        [evidence.operationKeyHmac],
      );
      const prior = existingOperation.rows[0];
      if (prior !== undefined) {
        if (
          prior.operation_kind !== 'transition' ||
          prior.actor_person_id !== input.actorPersonId ||
          !constantTimeEqual(prior.request_digest, evidence.requestDigest)
        ) {
          throw new DomainError(
            'conflict',
            'Support receipt idempotency key was used for a different request',
          );
        }
        return { receipt: receiptFromRow(prior), reused: true };
      }
      const current = await this.currentReceipt(transaction, { receiptCode: input.receiptCode });
      if (current === undefined) {
        throw new DomainError('not_found', 'Support receipt is unavailable');
      }
      let state: SupportReceiptState;
      try {
        state = nextSupportReceiptState({
          action: input.action,
          actorKind: 'hq',
          currentState: current.to_state,
          ...(input.resolutionCode === undefined ? {} : { resolutionCode: input.resolutionCode }),
        });
      } catch {
        throw new DomainError('invalid_transition', 'Support receipt transition is invalid');
      }
      const now = await databaseNow(transaction);
      await transaction.query(
        `INSERT INTO support_receipt_operations(
           operation_key_hmac, request_digest, operation_kind, actor_kind,
           actor_person_id, household_id, receipt_code, created_at
         ) VALUES ($1,$2,'transition','hq',$3,$4,$5,$6)`,
        [
          evidence.operationKeyHmac,
          evidence.requestDigest,
          input.actorPersonId,
          current.household_id,
          input.receiptCode,
          now.toISOString(),
        ],
      );
      await transaction.query(
        `INSERT INTO support_receipt_events(
           receipt_code, household_id, sequence, operation_key_hmac, from_state,
           to_state, action, actor_kind, actor_person_id, resolution_code,
           correlation_id, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'hq',$8,$9,$10,$11)`,
        [
          input.receiptCode,
          current.household_id,
          current.sequence + 1,
          evidence.operationKeyHmac,
          current.to_state,
          state,
          input.action,
          input.actorPersonId,
          input.resolutionCode ?? null,
          input.correlationId,
          now.toISOString(),
        ],
      );
      await this.writeAudit(transaction, {
        actorPersonId: input.actorPersonId,
        audience: 'hq',
        action: 'hq.support_receipt.transitioned',
        householdId: current.household_id,
        resourceId: input.receiptCode,
        correlationId: input.correlationId,
        metadata: {
          transition: input.action,
          state,
          ...(input.resolutionCode === undefined ? {} : { resolutionCode: input.resolutionCode }),
          contentIncluded: false,
          outboundMessageSent: false,
          providerActionExecuted: false,
        },
        occurredAt: now,
      });
      return {
        receipt: {
          ...receiptFromRow(current),
          state,
          ...(input.resolutionCode === undefined ? {} : { resolutionCode: input.resolutionCode }),
          updatedAt: now,
        },
        reused: false,
      };
    });
  }

  async purgeTerminal(limit = 100): Promise<SupportReceiptPurgeResult> {
    assertPageSize(limit);
    return this.database.transaction(async (transaction) => {
      await this.lockGate(transaction);
      const now = await databaseNow(transaction);
      const receipts = await transaction.query<Record<string, unknown>>(
        `WITH due AS (
           SELECT receipt.receipt_code
           FROM support_receipts receipt
           JOIN LATERAL (
             SELECT to_state, occurred_at
             FROM support_receipt_events current_event
             WHERE current_event.receipt_code = receipt.receipt_code
             ORDER BY sequence DESC LIMIT 1
           ) event ON true
           WHERE event.to_state IN ('resolved','withdrawn')
             AND event.occurred_at <= $1::timestamptz - interval '90 days'
           ORDER BY event.occurred_at, receipt.receipt_code
           LIMIT $2
         )
         DELETE FROM support_receipts receipt
         USING due
         WHERE receipt.receipt_code = due.receipt_code
         RETURNING receipt.receipt_code`,
        [now.toISOString(), limit],
      );
      const rateBuckets = await transaction.query<Record<string, unknown>>(
        `WITH due AS (
           SELECT bucket_start, scope, scope_key_hmac
           FROM support_receipt_rate_buckets
           WHERE bucket_start < ($1::timestamptz - interval '2 days')::date
           ORDER BY bucket_start, scope, scope_key_hmac
           LIMIT $2
         )
         DELETE FROM support_receipt_rate_buckets bucket
         USING due
         WHERE bucket.bucket_start = due.bucket_start
           AND bucket.scope = due.scope
           AND bucket.scope_key_hmac = due.scope_key_hmac
         RETURNING 1 AS deleted`,
        [now.toISOString(), limit],
      );
      return {
        receiptsDeleted: receipts.rowCount,
        rateBucketsDeleted: rateBuckets.rowCount,
        saturated: receipts.rowCount === limit || rateBuckets.rowCount === limit,
      };
    });
  }
}

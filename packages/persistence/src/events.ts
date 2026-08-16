import type { Audience } from '@boomerbuddy/domain';
import type { Database, SqlExecutor } from './database';
import { asDate, jsonValue, placeholders, randomIdFactory, type IdFactory } from './values';

export interface OperationalEventContext {
  readonly householdId?: string;
  readonly actorPersonId?: string;
  readonly audience?: Audience;
  readonly correlationId: string;
  readonly now: Date;
}

export interface AuditWrite {
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string;
  readonly outcome: 'allowed' | 'denied' | 'completed';
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface OutboxWrite {
  readonly eventType: string;
  readonly eventVersion?: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Readonly<Record<string, string | number | boolean>>;
}

const forbiddenOperationalKeys =
  /(?:content|artifact|cipher|fingerprint|token|secret|safe.?word|url|destination|email|phone|prompt)/iu;

function assertContentFree(value: Readonly<Record<string, unknown>>): void {
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenOperationalKeys.test(key)) {
      throw new TypeError(`Restricted operational payload key: ${key}`);
    }
    if (!['string', 'number', 'boolean'].includes(typeof item)) {
      throw new TypeError(`Operational payload values must be scalar: ${key}`);
    }
  }
}

export async function writeAuditAndOutbox(
  transaction: SqlExecutor,
  ids: IdFactory,
  context: OperationalEventContext,
  audit: AuditWrite,
  outbox: OutboxWrite,
): Promise<void> {
  const metadata = audit.metadata ?? {};
  assertContentFree(metadata);
  assertContentFree(outbox.payload);
  await transaction.query(
    `INSERT INTO audit_events(
       id, household_id, actor_person_id, session_audience, action, resource_type,
       resource_id, outcome, metadata, correlation_id, occurred_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
    [
      ids.next('audit'),
      context.householdId ?? null,
      context.actorPersonId ?? null,
      context.audience ?? null,
      audit.action,
      audit.resourceType,
      audit.resourceId ?? null,
      audit.outcome,
      JSON.stringify(metadata),
      context.correlationId,
      context.now.toISOString(),
    ],
  );
  const eventId = ids.next('event');
  await transaction.query(
    `INSERT INTO outbox_events(
       id, event_type, event_version, aggregate_type, aggregate_id, household_id,
       actor_person_id, correlation_id, classification, payload, occurred_at, available_at,
       next_attempt_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'internal',$9::jsonb,$10,$10,$10)`,
    [
      eventId,
      outbox.eventType,
      outbox.eventVersion ?? 1,
      outbox.aggregateType,
      outbox.aggregateId,
      context.householdId ?? null,
      context.actorPersonId ?? null,
      context.correlationId,
      JSON.stringify(outbox.payload),
      context.now.toISOString(),
    ],
  );
}

export interface ClaimedOutboxEvent {
  readonly id: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly householdId?: string;
  readonly correlationId: string;
  readonly classification: 'public' | 'internal' | 'confidential';
  readonly payload: Readonly<Record<string, string | number | boolean>>;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly leaseOwner: string;
  readonly leaseExpiresAt: Date;
}

interface OutboxRow extends Record<string, unknown> {
  readonly id: string;
  readonly event_type: string;
  readonly event_version: number;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly household_id: string | null;
  readonly correlation_id: string;
  readonly classification: ClaimedOutboxEvent['classification'];
  readonly payload: unknown;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly lease_owner: string;
  readonly lease_expires_at: unknown;
}

function mapOutboxPayload(value: unknown): ClaimedOutboxEvent['payload'] {
  const parsed = jsonValue(value);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Invalid outbox payload');
  }
  assertContentFree(parsed as Readonly<Record<string, unknown>>);
  return parsed as ClaimedOutboxEvent['payload'];
}

function mapOutbox(row: OutboxRow): ClaimedOutboxEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    eventVersion: row.event_version,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    ...(row.household_id === null ? {} : { householdId: row.household_id }),
    correlationId: row.correlation_id,
    classification: row.classification,
    payload: mapOutboxPayload(row.payload),
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: asDate(row.lease_expires_at, 'outbox lease_expires_at'),
  };
}

const operationalCode = /^[a-z][a-z0-9_.-]{1,79}$/u;
const workerKey = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{1,199}$/u;

export class OutboxDeliveryRepository {
  constructor(
    private readonly database: Database,
    private readonly idFactory: IdFactory = randomIdFactory,
  ) {}

  async claim(input: {
    readonly workerId: string;
    readonly eventTypes: readonly string[];
    readonly limit: number;
    readonly leaseDurationMs: number;
    readonly now: Date;
  }): Promise<readonly ClaimedOutboxEvent[]> {
    const eventTypes = [...new Set(input.eventTypes)];
    if (
      !workerKey.test(input.workerId) ||
      eventTypes.length === 0 ||
      eventTypes.length > 100 ||
      eventTypes.some((eventType) => !operationalCode.test(eventType)) ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100 ||
      !Number.isSafeInteger(input.leaseDurationMs) ||
      input.leaseDurationMs < 1_000 ||
      input.leaseDurationMs > 15 * 60_000
    ) {
      throw new TypeError('Invalid outbox claim request');
    }
    const expiresAt = new Date(input.now.getTime() + input.leaseDurationMs);
    return this.database.transaction(async (transaction) => {
      const maintenanceTypeSlots = placeholders(2, eventTypes.length);
      await transaction.query(
        `UPDATE outbox_events
         SET lease_owner = NULL, lease_expires_at = NULL, dead_lettered_at = $1,
             last_error_code = 'lease_expired_after_final_attempt'
         WHERE processed_at IS NULL AND dead_lettered_at IS NULL
           AND lease_expires_at <= $1 AND attempts >= max_attempts
           AND event_type IN (${maintenanceTypeSlots})`,
        [input.now.toISOString(), ...eventTypes],
      );
      const claimTypeSlots = placeholders(5, eventTypes.length);
      const claimed = await transaction.query<OutboxRow>(
        `WITH claimable AS (
           SELECT event.id FROM outbox_events AS event
           WHERE event.processed_at IS NULL AND event.dead_lettered_at IS NULL
             AND event.next_attempt_at <= $1 AND event.attempts < event.max_attempts
             AND (event.lease_expires_at IS NULL OR event.lease_expires_at <= $1)
             AND event.event_type IN (${claimTypeSlots})
             AND NOT EXISTS (
               SELECT 1 FROM outbox_events AS prior
               WHERE prior.aggregate_type = event.aggregate_type
                 AND prior.aggregate_id = event.aggregate_id
                 AND prior.household_id IS NOT DISTINCT FROM event.household_id
                 AND prior.processed_at IS NULL
                 AND (prior.dead_lettered_at IS NULL OR prior.replay_resolved_at IS NULL)
                 AND prior.causal_order_position < event.causal_order_position
             )
           ORDER BY event.next_attempt_at, event.causal_order_position
           LIMIT $4 FOR UPDATE OF event SKIP LOCKED
         )
         UPDATE outbox_events AS event
         SET lease_owner = $2, lease_expires_at = $3, heartbeat_at = $1,
             attempts = event.attempts + 1
         FROM claimable WHERE event.id = claimable.id
         RETURNING event.id, event.event_type, event.event_version, event.aggregate_type,
                   event.aggregate_id, event.household_id, event.correlation_id,
                   event.classification, event.payload, event.attempts, event.max_attempts,
                   event.lease_owner, event.lease_expires_at`,
        [
          input.now.toISOString(),
          input.workerId,
          expiresAt.toISOString(),
          input.limit,
          ...eventTypes,
        ],
      );
      return claimed.rows.map(mapOutbox);
    });
  }

  async heartbeat(input: {
    readonly eventId: string;
    readonly workerId: string;
    readonly leaseDurationMs: number;
    readonly now: Date;
  }): Promise<boolean> {
    const expiresAt = new Date(input.now.getTime() + input.leaseDurationMs);
    const result = await this.database.query(
      `UPDATE outbox_events
       SET heartbeat_at = $3, lease_expires_at = $4
       WHERE id = $1 AND processed_at IS NULL AND dead_lettered_at IS NULL
         AND lease_owner = $2 AND lease_expires_at > $3`,
      [input.eventId, input.workerId, input.now.toISOString(), expiresAt.toISOString()],
    );
    return result.rowCount === 1;
  }

  async complete(input: {
    readonly eventId: string;
    readonly workerId: string;
    readonly now: Date;
  }): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE outbox_events
       SET processed_at = $3, heartbeat_at = $3, lease_owner = NULL,
           lease_expires_at = NULL, last_error_code = NULL
       WHERE id = $1 AND processed_at IS NULL AND dead_lettered_at IS NULL
         AND lease_owner = $2 AND lease_expires_at > $3`,
      [input.eventId, input.workerId, input.now.toISOString()],
    );
    return result.rowCount === 1;
  }

  async fail(input: {
    readonly eventId: string;
    readonly workerId: string;
    readonly errorCode: string;
    readonly nextAttemptAt: Date;
    readonly now: Date;
  }): Promise<'retry' | 'dead_letter' | 'lost_lease'> {
    if (!operationalCode.test(input.errorCode)) throw new TypeError('Invalid outbox error code');
    return this.database.transaction(async (transaction) => {
      const rowResult = await transaction.query<
        { readonly attempts: number; readonly max_attempts: number } & Record<string, unknown>
      >(
        `SELECT attempts, max_attempts FROM outbox_events
         WHERE id = $1 AND processed_at IS NULL AND dead_lettered_at IS NULL
           AND lease_owner = $2 AND lease_expires_at > $3 FOR UPDATE`,
        [input.eventId, input.workerId, input.now.toISOString()],
      );
      const row = rowResult.rows[0];
      if (row === undefined) return 'lost_lease';
      const dead = row.attempts >= row.max_attempts;
      await transaction.query(
        `UPDATE outbox_events
         SET next_attempt_at = $4::timestamptz, lease_owner = NULL, lease_expires_at = NULL,
             heartbeat_at = $3::timestamptz, last_error_code = $5,
             dead_lettered_at = CASE WHEN $6::boolean THEN $3::timestamptz ELSE NULL END
         WHERE id = $1 AND lease_owner = $2`,
        [
          input.eventId,
          input.workerId,
          input.now.toISOString(),
          input.nextAttemptAt.toISOString(),
          input.errorCode,
          dead,
        ],
      );
      return dead ? 'dead_letter' : 'retry';
    });
  }

  async replayDeadLetter(input: {
    readonly eventId: string;
    readonly actorPersonId: string;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<string> {
    if (!operationalCode.test(input.reason) || !workerKey.test(input.correlationId)) {
      throw new TypeError('Invalid outbox replay envelope');
    }
    return this.database.transaction(async (transaction) => {
      const original = await transaction.query<
        { readonly household_id: string | null } & Record<string, unknown>
      >(
        `SELECT household_id FROM outbox_events
         WHERE id = $1 AND processed_at IS NULL AND dead_lettered_at IS NOT NULL
           AND replay_resolved_at IS NULL FOR UPDATE`,
        [input.eventId],
      );
      if (original.rows[0] === undefined) throw new TypeError('Only dead-letter events may replay');
      const replayId = this.idFactory.next('event');
      await transaction.query(
        `INSERT INTO outbox_events(
           id, event_type, event_version, aggregate_type, aggregate_id, household_id,
           actor_person_id, correlation_id, classification, payload, occurred_at, available_at,
           next_attempt_at, max_attempts, replay_of_event_id, replay_reason,
           causal_order_position,
           replay_actor_person_id
         )
         SELECT $1, event_type, event_version, aggregate_type, aggregate_id, household_id,
                actor_person_id, $2, classification, payload, occurred_at, $3, $3, max_attempts,
                id, $4, causal_order_position, $5
         FROM outbox_events WHERE id = $6`,
        [
          replayId,
          input.correlationId,
          input.now.toISOString(),
          input.reason,
          input.actorPersonId,
          input.eventId,
        ],
      );
      await transaction.query(
        `UPDATE outbox_events SET replay_resolved_at = $2
         WHERE id = $1 AND replay_resolved_at IS NULL`,
        [input.eventId, input.now.toISOString()],
      );
      await transaction.query(
        `INSERT INTO audit_events(
           id, household_id, actor_person_id, session_audience, action, resource_type,
           resource_id, outcome, metadata, correlation_id, occurred_at
         ) VALUES ($1,$2,$3,'hq','outbox.replayed','outbox_event',$4,'completed',$5::jsonb,$6,$7)`,
        [
          this.idFactory.next('audit'),
          original.rows[0].household_id,
          input.actorPersonId,
          replayId,
          JSON.stringify({ reason: input.reason, replayOfEventId: input.eventId }),
          input.correlationId,
          input.now.toISOString(),
        ],
      );
      return replayId;
    });
  }

  async relinquishWorkerLeases(input: {
    readonly workerId: string;
    readonly now: Date;
  }): Promise<number> {
    const result = await this.database.query(
      `UPDATE outbox_events
       SET next_attempt_at = $2, lease_owner = NULL, lease_expires_at = NULL,
           heartbeat_at = $2, last_error_code = 'worker_shutdown'
       WHERE processed_at IS NULL AND dead_lettered_at IS NULL AND lease_owner = $1`,
      [input.workerId, input.now.toISOString()],
    );
    return result.rowCount;
  }
}

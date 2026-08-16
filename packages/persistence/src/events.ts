import type { Audience } from '@boomerbuddy/domain';
import type { SqlExecutor } from './database';
import type { IdFactory } from './values';

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
  await transaction.query(
    `INSERT INTO outbox_events(
       id, event_type, event_version, aggregate_type, aggregate_id, household_id,
       actor_person_id, correlation_id, classification, payload, occurred_at, available_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'internal',$9::jsonb,$10,$10)`,
    [
      ids.next('event'),
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

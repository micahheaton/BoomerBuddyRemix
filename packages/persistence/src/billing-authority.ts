import { DomainError, type CorrelationId, type PersonId } from '@boomerbuddy/domain';

import type { Database, SqlExecutor } from './database';
import { writeAuditAndOutbox } from './events';
import { asDate, randomIdFactory, type IdFactory } from './values';

export type BillingAuthorityStatus = 'absent' | 'active' | 'suspended' | 'revoked';
export type BillingAuthorityAction = 'grant' | 'revoke';
export type BillingAuthorityReasonCode =
  | 'customer_billing_consent_verified'
  | 'customer_billing_consent_withdrawn'
  | 'operator_correction'
  | 'security_response';

export interface BillingAuthorityAccess {
  readonly actorPersonId: PersonId;
  readonly correlationId: CorrelationId;
}

interface HouseholdRow extends Record<string, unknown> {
  readonly id: string;
  readonly name: string;
}

interface MemberRow extends Record<string, unknown> {
  readonly person_id: string;
  readonly display_name: string;
  readonly membership_status: string;
  readonly authority_status: BillingAuthorityStatus | null;
  readonly granted_at: unknown | null;
  readonly revoked_at: unknown | null;
}

interface EventRow extends Record<string, unknown> {
  readonly id: string;
  readonly operation_key: string;
  readonly household_id: string;
  readonly person_id: string;
  readonly action: BillingAuthorityAction;
  readonly previous_status: BillingAuthorityStatus;
  readonly next_status: Extract<BillingAuthorityStatus, 'active' | 'revoked'>;
  readonly actor_person_id: string;
  readonly reason_code: BillingAuthorityReasonCode;
  readonly occurred_at: unknown;
}

interface CurrentAuthorityRow extends Record<string, unknown> {
  readonly status: Exclude<BillingAuthorityStatus, 'absent'>;
}

const operationKeyPattern = /^billing-authority:(grant|revoke):[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/u;

function assertOperationKey(operationKey: string, action: BillingAuthorityAction): void {
  const match = operationKeyPattern.exec(operationKey);
  if (match?.[1] !== action) {
    throw new DomainError('invalid_input', 'The Idempotency-Key must be bound to this action');
  }
}

function assertReason(
  action: BillingAuthorityAction,
  reasonCode: BillingAuthorityReasonCode,
): void {
  const allowed =
    action === 'grant'
      ? ['customer_billing_consent_verified', 'operator_correction']
      : ['customer_billing_consent_withdrawn', 'operator_correction', 'security_response'];
  if (!allowed.includes(reasonCode)) {
    throw new DomainError('invalid_input', 'The reason code is not valid for this action');
  }
}

function eventRecord(row: EventRow) {
  return {
    id: row.id,
    operationKey: row.operation_key,
    householdId: row.household_id,
    personId: row.person_id,
    action: row.action,
    previousStatus: row.previous_status,
    nextStatus: row.next_status,
    actorPersonId: row.actor_person_id,
    reasonCode: row.reason_code,
    occurredAt: asDate(row.occurred_at, 'household_billing_authority_events.occurred_at'),
  };
}

export class BillingAuthorityRepository {
  constructor(
    private readonly database: Database,
    private readonly configuredFounderPersonId?: string,
    private readonly ids: IdFactory = randomIdFactory,
  ) {}

  private async assertFounderOwner(
    executor: SqlExecutor,
    actorPersonId: PersonId,
    lock: boolean,
  ): Promise<void> {
    if (
      this.configuredFounderPersonId === undefined ||
      actorPersonId !== this.configuredFounderPersonId
    ) {
      throw new DomainError(
        'not_authorized',
        'Billing authority changes require the configured founder',
      );
    }
    const result = await executor.query(
      `SELECT person.id FROM persons person
       WHERE person.id = $1
         AND EXISTS (
           SELECT 1 FROM employee_assignments employee
           JOIN organizations organization ON organization.id = employee.organization_id
           WHERE employee.person_id = person.id AND employee.role = 'hq_owner'
             AND employee.status = 'active' AND organization.kind = 'internal'
         )
       ${lock ? 'FOR UPDATE' : ''}`,
      [actorPersonId],
    );
    if (result.rows.length !== 1) {
      throw new DomainError(
        'not_authorized',
        'Billing authority changes require an active internal HQ owner',
      );
    }
  }

  async household(input: {
    readonly access: BillingAuthorityAccess;
    readonly householdId: string;
    readonly now: Date;
  }) {
    if (Number.isNaN(input.now.getTime()))
      throw new DomainError('invalid_input', 'Time is invalid');
    return this.database.transaction(async (transaction) => {
      await this.assertFounderOwner(transaction, input.access.actorPersonId, false);
      const household = await transaction.query<HouseholdRow>(
        'SELECT id, name FROM households WHERE id = $1',
        [input.householdId],
      );
      const exactHousehold = household.rows[0];
      if (exactHousehold === undefined) {
        throw new DomainError('not_found', 'The selected household was not found');
      }
      await transaction.query(
        `INSERT INTO audit_events(
           id, household_id, actor_person_id, session_audience, action, resource_type,
           resource_id, outcome, metadata, correlation_id, occurred_at
         ) VALUES ($1,$2,$3,'hq','hq.billing_authority.read','household_billing_authority',
           $2,'allowed',$4::jsonb,$5,$6)`,
        [
          this.ids.next('audit'),
          input.householdId,
          input.access.actorPersonId,
          JSON.stringify({ projection: 'exact_household_billing_authority' }),
          input.access.correlationId,
          input.now.toISOString(),
        ],
      );
      const [members, events] = await Promise.all([
        transaction.query<MemberRow>(
          `SELECT membership.person_id, person.display_name,
                  membership.status AS membership_status,
                  authority.status AS authority_status,
                  authority.granted_at, authority.revoked_at
           FROM household_memberships membership
           JOIN persons person ON person.id = membership.person_id
           LEFT JOIN household_billing_authorities authority
             ON authority.household_id = membership.household_id
            AND authority.person_id = membership.person_id
           WHERE membership.household_id = $1
           ORDER BY person.display_name, membership.person_id`,
          [input.householdId],
        ),
        transaction.query<EventRow>(
          `SELECT id, operation_key, household_id, person_id, action, previous_status,
                  next_status, actor_person_id, reason_code, occurred_at
           FROM household_billing_authority_events
           WHERE household_id = $1
           ORDER BY occurred_at DESC, id DESC LIMIT 100`,
          [input.householdId],
        ),
      ]);
      return {
        household: exactHousehold,
        members: members.rows.map((row) => ({
          personId: row.person_id,
          displayName: row.display_name,
          membershipStatus:
            row.membership_status === 'active' ? ('active' as const) : ('revoked' as const),
          authorityStatus: row.authority_status ?? ('absent' as const),
          ...(row.granted_at === null
            ? {}
            : { grantedAt: asDate(row.granted_at, 'household_billing_authorities.granted_at') }),
          ...(row.revoked_at === null
            ? {}
            : { revokedAt: asDate(row.revoked_at, 'household_billing_authorities.revoked_at') }),
        })),
        events: events.rows.map(eventRecord),
      };
    });
  }

  async transition(input: {
    readonly access: BillingAuthorityAccess;
    readonly householdId: string;
    readonly personId: string;
    readonly action: BillingAuthorityAction;
    readonly reasonCode: BillingAuthorityReasonCode;
    readonly operationKey: string;
    readonly now: Date;
  }) {
    assertOperationKey(input.operationKey, input.action);
    assertReason(input.action, input.reasonCode);
    if (Number.isNaN(input.now.getTime()))
      throw new DomainError('invalid_input', 'Time is invalid');

    return this.database.transaction(async (transaction) => {
      // Locking the one configured founder serializes this deliberately low-volume workflow,
      // including conflicting reuses of one operation key across different households.
      await this.assertFounderOwner(transaction, input.access.actorPersonId, true);
      const priorOperation = await transaction.query<EventRow>(
        `SELECT id, operation_key, household_id, person_id, action, previous_status,
                next_status, actor_person_id, reason_code, occurred_at
         FROM household_billing_authority_events WHERE operation_key = $1`,
        [input.operationKey],
      );
      const replay = priorOperation.rows[0];
      if (replay !== undefined) {
        if (
          replay.household_id !== input.householdId ||
          replay.person_id !== input.personId ||
          replay.action !== input.action ||
          replay.reason_code !== input.reasonCode ||
          replay.actor_person_id !== input.access.actorPersonId
        ) {
          throw new DomainError(
            'conflict',
            'The Idempotency-Key is already bound to another request',
          );
        }
        return { ...eventRecord(replay), reused: true as const };
      }

      const membership = await transaction.query(
        `SELECT membership.id FROM household_memberships membership
         JOIN households household ON household.id = membership.household_id
         WHERE membership.household_id = $1 AND membership.person_id = $2
           AND membership.status = 'active'
         FOR UPDATE`,
        [input.householdId, input.personId],
      );
      if (membership.rows.length !== 1) {
        throw new DomainError('not_found', 'The exact active household member was not found');
      }
      const current = await transaction.query<CurrentAuthorityRow>(
        `SELECT status FROM household_billing_authorities
         WHERE household_id = $1 AND person_id = $2 FOR UPDATE`,
        [input.householdId, input.personId],
      );
      const previousStatus = current.rows[0]?.status ?? ('absent' as const);
      if (input.action === 'grant' && previousStatus === 'active') {
        throw new DomainError('invalid_transition', 'Billing authority is already active');
      }
      if (input.action === 'revoke' && !['active', 'suspended'].includes(previousStatus)) {
        throw new DomainError('invalid_transition', 'Active billing authority is required');
      }

      const nextStatus = input.action === 'grant' ? ('active' as const) : ('revoked' as const);
      if (input.action === 'grant') {
        await transaction.query(
          `INSERT INTO household_billing_authorities(
             household_id, person_id, status, granted_by_person_id, granted_at,
             suspended_at, revoked_at, grant_source
           ) VALUES ($1,$2,'active',$3,$4,NULL,NULL,'hq_operator')
           ON CONFLICT (household_id, person_id) DO UPDATE SET
             status = 'active', granted_by_person_id = excluded.granted_by_person_id,
             granted_at = excluded.granted_at, suspended_at = NULL, revoked_at = NULL,
             grant_source = 'hq_operator'`,
          [input.householdId, input.personId, input.access.actorPersonId, input.now.toISOString()],
        );
      } else {
        const updated = await transaction.query(
          `UPDATE household_billing_authorities
           SET status = 'revoked', suspended_at = NULL, revoked_at = $3
           WHERE household_id = $1 AND person_id = $2 AND status IN ('active','suspended')`,
          [input.householdId, input.personId, input.now.toISOString()],
        );
        if (updated.rowCount !== 1) {
          throw new DomainError('invalid_transition', 'Active billing authority is required');
        }
      }

      const eventId = this.ids.next('billing-authority-event');
      await transaction.query(
        `INSERT INTO household_billing_authority_events(
           id, operation_key, household_id, person_id, action, previous_status, next_status,
           actor_person_id, reason_code, correlation_id, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          eventId,
          input.operationKey,
          input.householdId,
          input.personId,
          input.action,
          previousStatus,
          nextStatus,
          input.access.actorPersonId,
          input.reasonCode,
          input.access.correlationId,
          input.now.toISOString(),
        ],
      );
      await writeAuditAndOutbox(
        transaction,
        this.ids,
        {
          householdId: input.householdId,
          actorPersonId: input.access.actorPersonId,
          audience: 'hq',
          correlationId: input.access.correlationId,
          now: input.now,
        },
        {
          action: `billing_authority.${input.action === 'grant' ? 'granted' : 'revoked'}`,
          resourceType: 'household_billing_authority',
          resourceId: input.personId,
          outcome: 'completed',
          metadata: {
            operationKey: input.operationKey,
            previousStatus,
            nextStatus,
            reasonCode: input.reasonCode,
          },
        },
        {
          eventType: `billing_authority.${input.action === 'grant' ? 'granted' : 'revoked'}`,
          aggregateType: 'household_billing_authority',
          aggregateId: `${input.householdId}:${input.personId}`,
          payload: {
            eventId,
            operationKey: input.operationKey,
            personId: input.personId,
            previousStatus,
            nextStatus,
            reasonCode: input.reasonCode,
          },
        },
      );
      return {
        id: eventId,
        operationKey: input.operationKey,
        householdId: input.householdId,
        personId: input.personId,
        action: input.action,
        previousStatus,
        nextStatus,
        actorPersonId: input.access.actorPersonId,
        reasonCode: input.reasonCode,
        occurredAt: input.now,
        reused: false as const,
      };
    });
  }
}

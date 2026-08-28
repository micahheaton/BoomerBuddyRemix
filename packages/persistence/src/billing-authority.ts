import { createHash } from 'node:crypto';
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

export const billingAuthoritySelfDocuments = Object.freeze({
  accept: Object.freeze({
    version: 'billing-authority-self-consent-v1' as const,
    disclosure:
      'I choose to become the billing manager for this household. This allows me to open secure Checkout and household billing management. Accepting does not charge me, make me the payer, grant access to another adult, or allow me to authorize another person. I can withdraw this role later. Billing starts only after I separately approve the exact offer in secure Checkout.',
  }),
  revoke: Object.freeze({
    version: 'billing-authority-self-withdrawal-v1' as const,
    disclosure:
      'I choose to withdraw my billing-manager role. This does not cancel, refund, pause, or change an existing subscription or recurring charge. I must separately use secure billing or contact support to change billing. Withdrawal is blocked while a billing request has an unsettled provider outcome.',
  }),
});

export function billingAuthorityDocumentDigest(disclosure: string): string {
  return createHash('sha256').update(disclosure, 'utf8').digest('hex');
}

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
           actor_person_id, reason_code, correlation_id, occurred_at, transition_source
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'hq_operator')`,
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

  async selfStatus(input: {
    readonly householdId: string;
    readonly personId: string;
    readonly now: Date;
  }) {
    const result = await this.database.query<
      {
        readonly membership_active: boolean;
        readonly administrator_active: boolean;
        readonly authority_status: BillingAuthorityStatus | null;
        readonly unsettled_count: number;
      } & Record<string, unknown>
    >(
      `SELECT
         EXISTS (
           SELECT 1 FROM household_memberships membership
           WHERE membership.household_id = $1 AND membership.person_id = $2
             AND membership.status = 'active'
         ) AS membership_active,
         EXISTS (
           SELECT 1 FROM household_administrator_assignments administrator
           JOIN household_memberships membership
             ON membership.household_id = administrator.household_id
            AND membership.person_id = administrator.person_id
            AND membership.status = 'active'
           WHERE administrator.household_id = $1 AND administrator.person_id = $2
             AND administrator.status = 'active'
         ) AS administrator_active,
         (SELECT authority.status FROM household_billing_authorities authority
          WHERE authority.household_id = $1 AND authority.person_id = $2) AS authority_status,
         (
           SELECT count(*)::int FROM commerce_stripe_session_operations operation
           WHERE operation.household_id = $1
             AND operation.state IN ('dispatching','outcome_unknown')
         ) + (
           SELECT count(*)::int FROM commerce_checkout_intents intent
           WHERE intent.household_id = $1 AND intent.requested_by_person_id = $2
             AND intent.state = 'prepared' AND intent.expires_at > $3
         ) + (
           SELECT count(*)::int
           FROM commerce_stripe_checkout_completion_bindings completion
           WHERE completion.household_id = $1
             AND NOT EXISTS (
               SELECT 1 FROM commerce_provider_subscription_records provider_record
               WHERE provider_record.household_id = completion.household_id
                 AND provider_record.subscription_id = completion.subscription_id
                 AND provider_record.provider = 'stripe'
                 AND provider_record.environment = completion.environment
                 AND provider_record.external_subscription_id =
                     completion.provider_subscription_id
             )
         ) AS unsettled_count`,
      [input.householdId, input.personId, input.now.toISOString()],
    );
    const row = result.rows[0];
    if (row === undefined || !row.membership_active) {
      throw new DomainError('not_found', 'The selected active household member was not found');
    }
    const authorityStatus = row.authority_status ?? ('absent' as const);
    const administratorEligible = row.administrator_active;
    return {
      householdId: input.householdId,
      personId: input.personId,
      administratorEligible,
      authorityStatus,
      canAccept: administratorEligible && authorityStatus !== 'active',
      canRevoke: administratorEligible && authorityStatus === 'active' && row.unsettled_count === 0,
      ...(authorityStatus === 'active' && row.unsettled_count > 0
        ? { revokeBlockedReason: 'billing_operation_unsettled' as const }
        : {}),
      documents: {
        accept: {
          ...billingAuthoritySelfDocuments.accept,
          digest: billingAuthorityDocumentDigest(billingAuthoritySelfDocuments.accept.disclosure),
        },
        revoke: {
          ...billingAuthoritySelfDocuments.revoke,
          digest: billingAuthorityDocumentDigest(billingAuthoritySelfDocuments.revoke.disclosure),
        },
      },
    };
  }

  async selfTransition(input: {
    readonly access: BillingAuthorityAccess;
    readonly householdId: string;
    readonly personId: string;
    readonly sessionId: string;
    readonly billingReverificationBindingId: string;
    readonly action: BillingAuthorityAction;
    readonly operationKey: string;
    readonly documentVersion: string;
    readonly documentDigest: string;
    readonly now: Date;
  }) {
    assertOperationKey(input.operationKey, input.action);
    if (input.access.actorPersonId !== input.personId) {
      throw new DomainError('not_authorized', 'Billing authority can only be accepted for self');
    }
    const document =
      input.action === 'grant'
        ? billingAuthoritySelfDocuments.accept
        : billingAuthoritySelfDocuments.revoke;
    if (
      input.documentVersion !== document.version ||
      input.documentDigest !== billingAuthorityDocumentDigest(document.disclosure)
    ) {
      throw new DomainError('conflict', 'Billing authority consent document changed');
    }
    const requestDigest = createHash('sha256')
      .update(
        JSON.stringify({
          householdId: input.householdId,
          personId: input.personId,
          sessionId: input.sessionId,
          billingReverificationBindingId: input.billingReverificationBindingId,
          action: input.action,
          operationKey: input.operationKey,
          documentVersion: input.documentVersion,
          documentDigest: input.documentDigest,
        }),
      )
      .digest('hex');
    return this.database.transaction(async (transaction) => {
      const actor = await transaction.query(
        `SELECT membership.id
         FROM household_memberships membership
         JOIN household_administrator_assignments administrator
           ON administrator.household_id = membership.household_id
          AND administrator.person_id = membership.person_id
          AND administrator.status = 'active'
         JOIN sessions session
           ON session.id = $3 AND session.person_id = membership.person_id
          AND session.audience = 'customer' AND session.issued_at <= $4
          AND session.expires_at > $4 AND session.revoked_at IS NULL
         JOIN identities identity
           ON identity.id = session.identity_id AND identity.person_id = session.person_id
          AND identity.status = 'active'
         WHERE membership.household_id = $1 AND membership.person_id = $2
           AND membership.status = 'active'
         FOR UPDATE OF membership, administrator, session, identity`,
        [input.householdId, input.personId, input.sessionId, input.now.toISOString()],
      );
      if (actor.rowCount !== 1) {
        throw new DomainError('not_authorized', 'Active household administrator is required');
      }
      const prior = await transaction.query<
        EventRow & {
          readonly transition_source: string;
          readonly request_digest: string | null;
          readonly actor_session_id: string | null;
          readonly billing_reverification_binding_id: string | null;
          readonly consent_document_version: string | null;
          readonly consent_document_digest: string | null;
        }
      >(
        `SELECT id, operation_key, household_id, person_id, action, previous_status,
                next_status, actor_person_id, reason_code, occurred_at,
                transition_source, request_digest, actor_session_id,
                billing_reverification_binding_id, consent_document_version,
                consent_document_digest
         FROM household_billing_authority_events WHERE operation_key = $1`,
        [input.operationKey],
      );
      const replay = prior.rows[0];
      if (replay !== undefined) {
        if (
          replay.household_id !== input.householdId ||
          replay.person_id !== input.personId ||
          replay.action !== input.action ||
          replay.actor_person_id !== input.personId ||
          replay.transition_source !== 'customer_self' ||
          replay.request_digest !== requestDigest ||
          replay.actor_session_id !== input.sessionId ||
          replay.billing_reverification_binding_id !== input.billingReverificationBindingId ||
          replay.consent_document_version !== input.documentVersion ||
          replay.consent_document_digest !== input.documentDigest
        ) {
          throw new DomainError('conflict', 'The Idempotency-Key is already bound');
        }
        return { ...eventRecord(replay), reused: true as const };
      }
      const bindingAction =
        input.action === 'grant' ? 'billing_authority_grant' : 'billing_authority_revoke';
      const binding = await transaction.query(
        `SELECT id FROM commerce_billing_reverification_bindings
         WHERE id = $1 AND person_id = $2 AND household_id = $3
           AND action = $4 AND server_operation_id = $5
           AND offer_id = 'billing_authority_self_v1' AND amount_minor = 0
           AND currency = 'usd' AND factor_level = 'multi_factor'
           AND created_at <= $6 AND created_at > $6::timestamptz - interval '10 minutes'
         FOR SHARE`,
        [
          input.billingReverificationBindingId,
          input.personId,
          input.householdId,
          bindingAction,
          input.operationKey,
          input.now.toISOString(),
        ],
      );
      if (binding.rowCount !== 1) {
        throw new DomainError('not_authorized', 'Recent billing reverification is required');
      }
      const current = await transaction.query<CurrentAuthorityRow>(
        `SELECT status FROM household_billing_authorities
         WHERE household_id = $1 AND person_id = $2 FOR UPDATE`,
        [input.householdId, input.personId],
      );
      const previousStatus = current.rows[0]?.status ?? ('absent' as const);
      if (input.action === 'grant') {
        if (previousStatus === 'active') {
          throw new DomainError('invalid_transition', 'Billing authority is already active');
        }
        await transaction.query(
          `INSERT INTO household_billing_authorities(
             household_id, person_id, status, granted_by_person_id, granted_at,
             suspended_at, revoked_at, grant_source
           ) VALUES ($1,$2,'active',$2,$3,NULL,NULL,'household_member')
           ON CONFLICT (household_id, person_id) DO UPDATE SET
             status = 'active', granted_by_person_id = excluded.granted_by_person_id,
             granted_at = excluded.granted_at, suspended_at = NULL, revoked_at = NULL,
             grant_source = 'household_member'`,
          [input.householdId, input.personId, input.now.toISOString()],
        );
      } else {
        if (previousStatus !== 'active') {
          throw new DomainError('invalid_transition', 'Active billing authority is required');
        }
        const unsettled = await transaction.query(
          `SELECT 1
           WHERE EXISTS (
             SELECT 1 FROM commerce_stripe_session_operations operation
             WHERE operation.household_id = $1
               AND operation.state IN ('dispatching','outcome_unknown')
           ) OR EXISTS (
             SELECT 1 FROM commerce_checkout_intents intent
             WHERE intent.household_id = $1 AND intent.state = 'prepared'
               AND intent.expires_at > $2
           ) OR EXISTS (
             SELECT 1 FROM commerce_stripe_checkout_completion_bindings completion
             WHERE completion.household_id = $1
               AND NOT EXISTS (
                 SELECT 1 FROM commerce_provider_subscription_records provider_record
                 WHERE provider_record.household_id = completion.household_id
                   AND provider_record.subscription_id = completion.subscription_id
                   AND provider_record.provider = 'stripe'
                   AND provider_record.environment = completion.environment
                   AND provider_record.external_subscription_id =
                       completion.provider_subscription_id
               )
           )`,
          [input.householdId, input.now.toISOString()],
        );
        if (unsettled.rowCount !== 0) {
          throw new DomainError('conflict', 'Billing authority cannot be withdrawn yet');
        }
        await transaction.query(
          `UPDATE household_billing_authorities
           SET status = 'revoked', suspended_at = NULL, revoked_at = $3
           WHERE household_id = $1 AND person_id = $2 AND status = 'active'`,
          [input.householdId, input.personId, input.now.toISOString()],
        );
      }
      const nextStatus = input.action === 'grant' ? ('active' as const) : ('revoked' as const);
      const reasonCode =
        input.action === 'grant'
          ? ('customer_billing_consent_verified' as const)
          : ('customer_billing_consent_withdrawn' as const);
      const eventId = this.ids.next('billing-authority-event');
      await transaction.query(
        `INSERT INTO household_billing_authority_events(
           id, operation_key, household_id, person_id, action, previous_status, next_status,
           actor_person_id, reason_code, correlation_id, occurred_at, transition_source,
           request_digest, actor_session_id, billing_reverification_binding_id,
           consent_document_version, consent_document_digest
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$4,$8,$9,$10,'customer_self',$11,$12,$13,$14,$15)`,
        [
          eventId,
          input.operationKey,
          input.householdId,
          input.personId,
          input.action,
          previousStatus,
          nextStatus,
          reasonCode,
          input.access.correlationId,
          input.now.toISOString(),
          requestDigest,
          input.sessionId,
          input.billingReverificationBindingId,
          input.documentVersion,
          input.documentDigest,
        ],
      );
      await writeAuditAndOutbox(
        transaction,
        this.ids,
        {
          householdId: input.householdId,
          actorPersonId: input.personId,
          audience: 'customer',
          correlationId: input.access.correlationId,
          now: input.now,
        },
        {
          action: `billing_authority.${input.action === 'grant' ? 'granted' : 'revoked'}`,
          resourceType: 'household_billing_authority',
          resourceId: input.personId,
          outcome: 'completed',
          metadata: { operationKey: input.operationKey, previousStatus, nextStatus, reasonCode },
        },
        {
          eventType: `billing_authority.${input.action === 'grant' ? 'granted' : 'revoked'}`,
          aggregateType: 'household_billing_authority',
          aggregateId: `${input.householdId}:${input.personId}`,
          payload: { eventId, operationKey: input.operationKey, previousStatus, nextStatus },
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
        actorPersonId: input.personId,
        reasonCode,
        occurredAt: input.now,
        reused: false as const,
      };
    });
  }
}

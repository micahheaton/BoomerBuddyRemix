import { DomainError, ids } from '@boomerbuddy/domain';
import type { Database, SqlExecutor } from './database';
import { asDate, randomIdFactory, type IdFactory } from './values';

const boundedExternalId = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,511}$/u;
const founderBootstrapKey = 'production-founder-v1';

interface IdentityRow extends Record<string, unknown> {
  readonly identity_id: string;
  readonly issuer: string;
  readonly subject: string;
  readonly person_id: string;
  readonly display_name: string;
}

interface CustomerBootstrapRow extends IdentityRow {
  readonly household_id: string;
  readonly membership_id: string;
  readonly created_at: unknown;
}

interface FounderBootstrapRow extends IdentityRow {
  readonly organization_id: string;
  readonly employee_assignment_id: string;
  readonly correlation_id: string;
  readonly created_at: unknown;
}

export interface ProductionIdentity {
  readonly identityId: string;
  readonly issuer: string;
  readonly subject: string;
  readonly personId: string;
  readonly displayName: string;
}

export interface ProductionCustomerBootstrap extends ProductionIdentity {
  readonly householdId: string;
  readonly membershipId: string;
  readonly createdAt: Date;
}

export interface ProductionFounderBootstrap extends ProductionIdentity {
  readonly organizationId: string;
  readonly employeeAssignmentId: string;
  readonly correlationId: string;
  readonly createdAt: Date;
  readonly reused: boolean;
}

export interface ProductionIdentityDisableResult {
  readonly identityId: string;
  readonly personId: string;
  readonly revokedSessionCount: number;
  readonly reused: boolean;
}

function validateExternalId(value: string, name: string): void {
  if (!boundedExternalId.test(value)) {
    throw new DomainError('invalid_input', `Invalid production identity ${name}`);
  }
}

function validateNow(now: Date): void {
  if (Number.isNaN(now.getTime())) {
    throw new DomainError('invalid_input', 'Invalid production identity timestamp');
  }
}

function mapIdentity(row: IdentityRow): ProductionIdentity {
  return {
    identityId: ids.identity(row.identity_id),
    issuer: row.issuer,
    subject: row.subject,
    personId: ids.person(row.person_id),
    displayName: row.display_name,
  };
}

function mapCustomerBootstrap(row: CustomerBootstrapRow): ProductionCustomerBootstrap {
  return {
    ...mapIdentity(row),
    householdId: ids.household(row.household_id),
    membershipId: ids.membership(row.membership_id),
    createdAt: asDate(row.created_at, 'production_customer_bootstraps.created_at'),
  };
}

function mapFounderBootstrap(
  row: FounderBootstrapRow,
  reused: boolean,
): ProductionFounderBootstrap {
  return {
    ...mapIdentity(row),
    organizationId: ids.organization(row.organization_id),
    employeeAssignmentId: row.employee_assignment_id,
    correlationId: row.correlation_id,
    createdAt: asDate(row.created_at, 'production_founder_bootstraps.created_at'),
    reused,
  };
}

async function lockBootstrapMutex(transaction: SqlExecutor): Promise<void> {
  const locked = await transaction.query(
    `SELECT singleton FROM production_identity_bootstrap_mutex
     WHERE singleton = 'production-identity-v1' FOR UPDATE`,
  );
  if (locked.rows[0] === undefined) {
    throw new Error('Production identity bootstrap mutex is unavailable');
  }
}

const customerBootstrapSelect = `
  SELECT bootstrap.identity_id, bootstrap.issuer, bootstrap.subject,
         bootstrap.person_id, person.display_name, bootstrap.household_id,
         bootstrap.membership_id, bootstrap.created_at
  FROM production_customer_bootstraps bootstrap
  JOIN identities identity
    ON identity.id = bootstrap.identity_id
   AND identity.person_id = bootstrap.person_id
   AND identity.issuer = bootstrap.issuer
   AND identity.subject = bootstrap.subject
   AND identity.status = 'active'
  JOIN persons person ON person.id = bootstrap.person_id
  JOIN household_memberships membership
    ON membership.household_id = bootstrap.household_id
   AND membership.id = bootstrap.membership_id
   AND membership.person_id = bootstrap.person_id
   AND membership.status = 'active'
  JOIN household_administrator_assignments administrator
    ON administrator.household_id = bootstrap.household_id
   AND administrator.person_id = bootstrap.person_id
   AND administrator.status = 'active'
`;

const founderBootstrapSelect = `
  SELECT bootstrap.identity_id, bootstrap.issuer, bootstrap.subject,
         bootstrap.person_id, person.display_name, bootstrap.organization_id,
         bootstrap.employee_assignment_id, bootstrap.correlation_id, bootstrap.created_at
  FROM production_founder_bootstraps bootstrap
  JOIN identities identity
    ON identity.id = bootstrap.identity_id
   AND identity.person_id = bootstrap.person_id
   AND identity.issuer = bootstrap.issuer
   AND identity.subject = bootstrap.subject
   AND identity.status = 'active'
  JOIN persons person ON person.id = bootstrap.person_id
  JOIN organizations organization
    ON organization.id = bootstrap.organization_id
   AND organization.kind = 'internal'
   AND organization.verification_state = 'verified'
  JOIN employee_assignments employee
    ON employee.id = bootstrap.employee_assignment_id
   AND employee.person_id = bootstrap.person_id
   AND employee.organization_id = bootstrap.organization_id
   AND employee.role = 'hq_owner'
   AND employee.status = 'active'
`;

export class ProductionIdentityRepository {
  constructor(
    private readonly database: Database,
    private readonly idFactory: IdFactory = randomIdFactory,
  ) {}

  async findCustomerBootstrapByIdentity(
    identityId: string,
  ): Promise<ProductionCustomerBootstrap | null> {
    validateExternalId(identityId, 'identity id');
    const result = await this.database.query<CustomerBootstrapRow>(
      `${customerBootstrapSelect} WHERE bootstrap.identity_id = $1`,
      [identityId],
    );
    return result.rows[0] === undefined ? null : mapCustomerBootstrap(result.rows[0]);
  }

  async findCustomerBootstrapBySubject(input: {
    readonly issuer: string;
    readonly subject: string;
  }): Promise<ProductionCustomerBootstrap | null> {
    validateExternalId(input.subject, 'subject');
    const result = await this.database.query<CustomerBootstrapRow>(
      `${customerBootstrapSelect}
       WHERE bootstrap.issuer = $1 AND bootstrap.subject = $2`,
      [input.issuer, input.subject],
    );
    return result.rows[0] === undefined ? null : mapCustomerBootstrap(result.rows[0]);
  }

  async ensureCustomerBootstrap(input: {
    readonly issuer: string;
    readonly subject: string;
    readonly now: Date;
  }): Promise<ProductionCustomerBootstrap | null> {
    validateExternalId(input.subject, 'subject');
    validateNow(input.now);
    return this.database.transaction(async (transaction) => {
      await lockBootstrapMutex(transaction);
      const existing = await transaction.query<CustomerBootstrapRow>(
        `${customerBootstrapSelect}
         WHERE bootstrap.issuer = $1 AND bootstrap.subject = $2`,
        [input.issuer, input.subject],
      );
      if (existing.rows[0] !== undefined) return mapCustomerBootstrap(existing.rows[0]);

      const conflictingIdentity = await transaction.query(
        'SELECT id FROM identities WHERE issuer = $1 AND subject = $2',
        [input.issuer, input.subject],
      );
      if (conflictingIdentity.rows[0] !== undefined) return null;

      const personId = this.idFactory.next('person');
      const identityId = this.idFactory.next('identity');
      const householdId = this.idFactory.next('household');
      const membershipId = this.idFactory.next('membership');
      const timestamp = input.now.toISOString();
      await transaction.query(
        `INSERT INTO persons(id, display_name, created_at)
         VALUES ($1,'Household administrator',$2)`,
        [personId, timestamp],
      );
      await transaction.query(
        `INSERT INTO identities(id, person_id, issuer, subject, status, created_at)
         VALUES ($1,$2,$3,$4,'active',$5)`,
        [identityId, personId, input.issuer, input.subject, timestamp],
      );
      await transaction.query(
        `INSERT INTO households(id, name, created_at) VALUES ($1,'My household',$2)`,
        [householdId, timestamp],
      );
      await transaction.query(
        `INSERT INTO household_memberships(
           household_id, id, person_id, membership_kind, status, created_at
         ) VALUES ($1,$2,$3,'member','active',$4)`,
        [householdId, membershipId, personId, timestamp],
      );
      await transaction.query(
        `INSERT INTO household_administrator_assignments(
           household_id, person_id, status, granted_by_person_id, granted_at
         ) VALUES ($1,$2,'active',$2,$3)`,
        [householdId, personId, timestamp],
      );
      await transaction.query(
        `INSERT INTO production_customer_bootstraps(
           identity_id, issuer, subject, person_id, household_id, membership_id, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [identityId, input.issuer, input.subject, personId, householdId, membershipId, timestamp],
      );
      const created = await transaction.query<CustomerBootstrapRow>(
        `${customerBootstrapSelect} WHERE bootstrap.identity_id = $1`,
        [identityId],
      );
      if (created.rows[0] === undefined) throw new Error('Customer bootstrap was not persisted');
      return mapCustomerBootstrap(created.rows[0]);
    });
  }

  async findActiveHqIdentity(input: {
    readonly issuer: string;
    readonly subject: string;
  }): Promise<ProductionIdentity | null> {
    validateExternalId(input.subject, 'subject');
    const result = await this.database.query<IdentityRow>(
      `SELECT identity.id AS identity_id, identity.issuer, identity.subject,
              identity.person_id, person.display_name
       FROM identities identity
       JOIN persons person ON person.id = identity.person_id
       WHERE identity.issuer = $1 AND identity.subject = $2 AND identity.status = 'active'
         AND EXISTS (
           SELECT 1 FROM employee_assignments employee
           JOIN organizations organization ON organization.id = employee.organization_id
           WHERE employee.person_id = identity.person_id AND employee.status = 'active'
             AND organization.kind = 'internal' AND organization.verification_state = 'verified'
         )`,
      [input.issuer, input.subject],
    );
    return result.rows[0] === undefined ? null : mapIdentity(result.rows[0]);
  }

  async bootstrapFounder(input: {
    readonly issuer: string;
    readonly subject: string;
    readonly founderPersonId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<ProductionFounderBootstrap> {
    validateExternalId(input.subject, 'subject');
    validateExternalId(input.founderPersonId, 'founder person id');
    validateExternalId(input.correlationId, 'correlation id');
    validateNow(input.now);
    return this.database.transaction(async (transaction) => {
      await lockBootstrapMutex(transaction);
      const existing = await transaction.query<FounderBootstrapRow>(
        `${founderBootstrapSelect} WHERE bootstrap.bootstrap_key = $1`,
        [founderBootstrapKey],
      );
      if (existing.rows[0] !== undefined) {
        const row = existing.rows[0];
        if (
          row.issuer !== input.issuer ||
          row.subject !== input.subject ||
          row.person_id !== input.founderPersonId
        ) {
          throw new DomainError(
            'conflict',
            'Production founder bootstrap conflicts with prior evidence',
          );
        }
        return mapFounderBootstrap(row, true);
      }
      const staleRecord = await transaction.query(
        'SELECT bootstrap_key FROM production_founder_bootstraps WHERE bootstrap_key = $1',
        [founderBootstrapKey],
      );
      if (staleRecord.rows[0] !== undefined) {
        throw new DomainError('conflict', 'Production founder bootstrap is no longer active');
      }
      const conflicts = await transaction.query(
        `SELECT 'person' AS kind FROM persons WHERE id = $1
         UNION ALL
         SELECT 'identity' AS kind FROM identities WHERE issuer = $2 AND subject = $3`,
        [input.founderPersonId, input.issuer, input.subject],
      );
      if (conflicts.rows.length > 0) {
        throw new DomainError('conflict', 'Production founder bootstrap identity already exists');
      }

      const identityId = this.idFactory.next('identity');
      const organizationId = this.idFactory.next('organization');
      const employeeAssignmentId = this.idFactory.next('employee');
      const timestamp = input.now.toISOString();
      await transaction.query(
        `INSERT INTO persons(id, display_name, created_at)
         VALUES ($1,'BoomerBuddy Founder',$2)`,
        [input.founderPersonId, timestamp],
      );
      await transaction.query(
        `INSERT INTO identities(id, person_id, issuer, subject, status, created_at)
         VALUES ($1,$2,$3,$4,'active',$5)`,
        [identityId, input.founderPersonId, input.issuer, input.subject, timestamp],
      );
      await transaction.query(
        `INSERT INTO organizations(id, name, kind, verification_state, created_at)
         VALUES ($1,'BoomerBuddy HQ','internal','verified',$2)`,
        [organizationId, timestamp],
      );
      await transaction.query(
        `INSERT INTO employee_assignments(
           id, person_id, organization_id, role, status, created_at
         ) VALUES ($1,$2,$3,'hq_owner','active',$4)`,
        [employeeAssignmentId, input.founderPersonId, organizationId, timestamp],
      );
      await transaction.query(
        `INSERT INTO production_founder_bootstraps(
           bootstrap_key, identity_id, issuer, subject, person_id,
           organization_id, organization_kind, organization_verification_state,
           employee_assignment_id, employee_role, correlation_id, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,'internal','verified',$7,'hq_owner',$8,$9)`,
        [
          founderBootstrapKey,
          identityId,
          input.issuer,
          input.subject,
          input.founderPersonId,
          organizationId,
          employeeAssignmentId,
          input.correlationId,
          timestamp,
        ],
      );
      await transaction.query(
        `INSERT INTO audit_events(
           id, household_id, actor_person_id, session_audience, action, resource_type,
           resource_id, outcome, metadata, correlation_id, occurred_at
         ) VALUES ($1,NULL,$2,'hq','production_founder.bootstrap',
                   'production_founder_bootstrap',$3,'completed',$4::jsonb,$5,$6)`,
        [
          this.idFactory.next('audit'),
          input.founderPersonId,
          founderBootstrapKey,
          JSON.stringify({
            identityId,
            organizationId,
            employeeAssignmentId,
            evidence: 'exact_clerk_subject_binding',
          }),
          input.correlationId,
          timestamp,
        ],
      );
      const created = await transaction.query<FounderBootstrapRow>(
        `${founderBootstrapSelect} WHERE bootstrap.bootstrap_key = $1`,
        [founderBootstrapKey],
      );
      if (created.rows[0] === undefined) throw new Error('Founder bootstrap was not persisted');
      return mapFounderBootstrap(created.rows[0], false);
    });
  }

  async disableIdentity(input: {
    readonly issuer: string;
    readonly subject: string;
    readonly founderPersonId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<ProductionIdentityDisableResult> {
    validateExternalId(input.subject, 'subject');
    validateExternalId(input.founderPersonId, 'founder person id');
    validateExternalId(input.correlationId, 'correlation id');
    validateNow(input.now);
    return this.database.transaction(async (transaction) => {
      await lockBootstrapMutex(transaction);
      const founder = await transaction.query(
        `${founderBootstrapSelect}
         WHERE bootstrap.bootstrap_key = $1 AND bootstrap.person_id = $2`,
        [founderBootstrapKey, input.founderPersonId],
      );
      if (founder.rows[0] === undefined) {
        throw new DomainError(
          'not_authorized',
          'Production identity disable requires the active configured founder',
        );
      }
      const target = await transaction.query<
        {
          readonly identity_id: string;
          readonly person_id: string;
          readonly status: string;
        } & Record<string, unknown>
      >(
        `SELECT id AS identity_id, person_id, status FROM identities
         WHERE issuer = $1 AND subject = $2 FOR UPDATE`,
        [input.issuer, input.subject],
      );
      const identity = target.rows[0];
      if (identity === undefined) {
        throw new DomainError('not_found', 'Production identity was not found');
      }
      if (identity.person_id === input.founderPersonId) {
        throw new DomainError(
          'conflict',
          'The founder identity requires the reviewed recovery procedure',
        );
      }
      if (identity.status === 'disabled') {
        return {
          identityId: ids.identity(identity.identity_id),
          personId: ids.person(identity.person_id),
          revokedSessionCount: 0,
          reused: true,
        };
      }
      const sessions = await transaction.query<
        {
          readonly id: string;
          readonly provider_session_id: string;
        } & Record<string, unknown>
      >(
        `SELECT id, provider_session_id FROM sessions
         WHERE identity_id = $1 AND revoked_at IS NULL FOR UPDATE`,
        [identity.identity_id],
      );
      const timestamp = input.now.toISOString();
      for (const session of sessions.rows) {
        await transaction.query('UPDATE sessions SET revoked_at = $2 WHERE id = $1', [
          session.id,
          timestamp,
        ]);
        await transaction.query(
          `INSERT INTO provider_session_revocations(
             issuer, provider_session_id, identity_id, session_id, revoked_at, reason
           ) VALUES ($1,$2,$3,$4,$5,'administrative')
           ON CONFLICT (issuer, provider_session_id) DO NOTHING`,
          [input.issuer, session.provider_session_id, identity.identity_id, session.id, timestamp],
        );
      }
      await transaction.query("UPDATE identities SET status = 'disabled' WHERE id = $1", [
        identity.identity_id,
      ]);
      await transaction.query(
        `INSERT INTO audit_events(
           id, household_id, actor_person_id, session_audience, action, resource_type,
           resource_id, outcome, metadata, correlation_id, occurred_at
         ) VALUES ($1,NULL,$2,'hq','production_identity.disable','identity',$3,
                   'completed',$4::jsonb,$5,$6)`,
        [
          this.idFactory.next('audit'),
          input.founderPersonId,
          identity.identity_id,
          JSON.stringify({
            revokedSessionCount: sessions.rows.length,
            providerSessionRevocation: 'local_immediate',
            providerDisableRequired: true,
          }),
          input.correlationId,
          timestamp,
        ],
      );
      return {
        identityId: ids.identity(identity.identity_id),
        personId: ids.person(identity.person_id),
        revokedSessionCount: sessions.rows.length,
        reused: false,
      };
    });
  }

  async assertFounderBinding(input: {
    readonly issuer: string;
    readonly subject: string;
    readonly founderPersonId: string;
  }): Promise<void> {
    const result = await this.database.query<FounderBootstrapRow>(
      `${founderBootstrapSelect}
       WHERE bootstrap.bootstrap_key = $1 AND bootstrap.issuer = $2
         AND bootstrap.subject = $3 AND bootstrap.person_id = $4`,
      [founderBootstrapKey, input.issuer, input.subject, input.founderPersonId],
    );
    if (result.rows[0] === undefined) {
      throw new TypeError(
        'Production founder identity is not exactly bound to an active verified internal owner',
      );
    }
  }
}

import {
  ids,
  roles,
  trustedCirclePermissions,
  type Audience,
  type Capability,
  type EmployeeScope,
  type HouseholdMembershipScope,
  type Role,
  type SessionPrincipal,
  type SupportCaseScope,
  type RestrictedAccessScope,
  type TrustedCirclePermission,
} from '@boomerbuddy/domain';
import type { Database } from './database';
import { EntitlementRepository, type EntitlementRuntimeEnvironment } from './entitlements';
import { asDate, jsonValue, randomIdFactory, stringArray, type IdFactory } from './values';

interface PersonaRow extends Record<string, unknown> {
  readonly person_id: string;
  readonly display_name: string;
  readonly status: string;
}

interface SessionRow extends Record<string, unknown> {
  readonly id: string;
  readonly person_id: string;
  readonly display_name: string;
  readonly audience: string;
  readonly issuer: string;
  readonly expires_at: unknown;
  readonly revoked_at: unknown;
}

interface MembershipRow extends Record<string, unknown> {
  readonly household_id: string;
  readonly id: string;
  readonly membership_kind: string;
  readonly status: string;
  readonly is_administrator: boolean;
  readonly is_payer: boolean;
  readonly is_billing_manager: boolean;
  readonly protected_grant_id: string | null;
}

interface TrustedGrantRow extends Record<string, unknown> {
  readonly household_id: string;
  readonly relationship_id: string;
  readonly protected_person_id: string;
  readonly entitlement_grant_id: string;
  readonly permissions: unknown;
}

interface EmployeeRow extends Record<string, unknown> {
  readonly assignment_id: string;
  readonly organization_id: string;
  readonly organization_kind: 'internal';
  readonly role: string;
}

interface SupportCaseRow extends Record<string, unknown> {
  readonly household_id: string;
  readonly case_id: string;
  readonly employee_assignment_id: string;
  readonly purpose: string;
}

interface RestrictedAccessRow extends SupportCaseRow {
  readonly grant_id: string;
  readonly resource_type: 'artifact' | 'analysis' | 'family' | 'messaging_inbound';
  readonly resource_id: string;
  readonly expires_at: unknown;
}

function isRole(value: string): value is Role {
  return roles.includes(value as Role);
}

function isPermission(value: string): value is TrustedCirclePermission {
  return trustedCirclePermissions.includes(value as TrustedCirclePermission);
}

export interface ResolvedSession {
  readonly principal: SessionPrincipal;
  readonly displayName: string;
  readonly issuer: string;
  readonly householdCapabilities: readonly {
    readonly householdId: string;
    readonly capabilities: readonly Capability[];
  }[];
}

export class SessionRepository {
  constructor(
    private readonly database: Database,
    private readonly idFactory: IdFactory = randomIdFactory,
    private readonly runtimeEnvironment: EntitlementRuntimeEnvironment = 'production',
  ) {}

  async findDevPersona(subject: string): Promise<{ personId: string; displayName: string } | null> {
    const result = await this.database.query<PersonaRow>(
      `SELECT i.person_id, p.display_name, i.status
       FROM identities i JOIN persons p ON p.id = i.person_id
       WHERE i.issuer = 'boomerbuddy-dev' AND i.subject = $1`,
      [subject],
    );
    const row = result.rows[0];
    return row === undefined || row.status !== 'active'
      ? null
      : { personId: row.person_id, displayName: row.display_name };
  }

  async create(input: {
    readonly personId: string;
    readonly audience: Audience;
    readonly issuedAt: Date;
    readonly expiresAt: Date;
  }): Promise<string> {
    const sessionId = this.idFactory.next('session');
    await this.database.query(
      `INSERT INTO sessions(id, person_id, audience, issuer, issued_at, expires_at)
       VALUES ($1,$2,$3,'boomerbuddy-dev',$4,$5)`,
      [
        sessionId,
        input.personId,
        input.audience,
        input.issuedAt.toISOString(),
        input.expiresAt.toISOString(),
      ],
    );
    return sessionId;
  }

  async revoke(sessionId: string, now: Date): Promise<boolean> {
    const result = await this.database.query(
      'UPDATE sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL',
      [sessionId, now.toISOString()],
    );
    return result.rowCount === 1;
  }

  async resolve(
    sessionId: string,
    expectedAudience: Audience,
    now: Date,
  ): Promise<ResolvedSession | null> {
    const sessionResult = await this.database.query<SessionRow>(
      `SELECT s.id, s.person_id, p.display_name, s.audience, s.issuer, s.expires_at, s.revoked_at
       FROM sessions s JOIN persons p ON p.id = s.person_id
       WHERE s.id = $1 AND s.audience = $2
         AND EXISTS (
           SELECT 1 FROM identities i
           WHERE i.person_id = s.person_id AND i.issuer = s.issuer AND i.status = 'active'
         )`,
      [sessionId, expectedAudience],
    );
    const session = sessionResult.rows[0];
    if (
      session === undefined ||
      session.audience !== expectedAudience ||
      session.revoked_at !== null
    )
      return null;
    const expiresAt = asDate(session.expires_at, 'sessions.expires_at');
    if (expiresAt.getTime() <= now.getTime()) return null;

    const membershipsResult = await this.database.query<MembershipRow>(
      `SELECT m.household_id, m.id, m.membership_kind, m.status,
              EXISTS (
                SELECT 1 FROM household_administrator_assignments administrator
                WHERE administrator.household_id = m.household_id
                  AND administrator.person_id = m.person_id
                  AND administrator.status = 'active'
              ) AS is_administrator,
              EXISTS (
                SELECT 1 FROM household_payers payer
                WHERE payer.household_id = m.household_id AND payer.person_id = m.person_id
                  AND payer.status = 'active'
              ) AS is_payer,
              EXISTS (
                SELECT 1 FROM household_billing_authorities billing
                WHERE billing.household_id = m.household_id AND billing.person_id = m.person_id
                  AND billing.status = 'active'
              ) AS is_billing_manager,
              a.entitlement_grant_id AS protected_grant_id
       FROM household_memberships m
       LEFT JOIN protected_members p
         ON p.household_id = m.household_id AND p.person_id = m.person_id
        AND p.status = 'accepted'
       LEFT JOIN commerce_allowance_allocations a
         ON a.household_id = p.household_id AND a.id = p.allowance_allocation_id
        AND a.state = 'active' AND a.allowance_key = 'protected_members'
        AND a.subject_kind = 'protected_member' AND a.subject_id = p.person_id
       WHERE m.person_id = $1
       ORDER BY m.household_id, m.id`,
      [session.person_id],
    );
    const trustedResult = await this.database.query<TrustedGrantRow>(
      `SELECT t.household_id, t.id AS relationship_id, t.protected_person_id, t.permissions,
              allowance.entitlement_grant_id
       FROM trusted_circle_relationships t
       JOIN household_memberships m
         ON m.household_id = t.household_id AND m.person_id = t.trusted_person_id
        AND m.status = 'active'
       JOIN commerce_allowance_allocations allowance
         ON allowance.household_id = t.household_id
        AND allowance.allowance_key = 'trusted_circle_participants'
        AND allowance.subject_kind = 'trusted_circle_person'
        AND allowance.subject_id = t.trusted_person_id AND allowance.state = 'active'
       JOIN consent_current_projections consent
         ON consent.household_id = t.household_id AND consent.consent_id = t.consent_id
        AND consent.latest_evidence_id = t.latest_consent_evidence_id
        AND consent.state = 'active'
       WHERE t.trusted_person_id = $1 AND t.state = 'active'
       ORDER BY t.household_id, t.id`,
      [session.person_id],
    );
    const grantsByHousehold = new Map<string, HouseholdMembershipScope['trustedCircleGrants']>();
    const trustedEntitlementGrantByRelationship = new Map<string, string>();
    for (const row of trustedResult.rows) {
      const permissionValues = stringArray(jsonValue(row.permissions), 'relationship.permissions');
      if (permissionValues.some((permission) => !isPermission(permission))) {
        throw new TypeError('Invalid Trusted Circle permission in database');
      }
      const existing = grantsByHousehold.get(row.household_id) ?? [];
      grantsByHousehold.set(row.household_id, [
        ...existing,
        {
          relationshipId: ids.relationship(row.relationship_id),
          protectedPersonId: ids.person(row.protected_person_id),
          permissions: permissionValues as TrustedCirclePermission[],
        },
      ]);
      trustedEntitlementGrantByRelationship.set(row.relationship_id, row.entitlement_grant_id);
    }
    const membershipScopesWithoutCapabilities: (Omit<
      HouseholdMembershipScope,
      'capabilities' | 'isProtectedMember'
    > & { readonly protectedGrantId: string | null })[] = membershipsResult.rows.map((row) => {
      if (row.membership_kind !== 'member')
        throw new TypeError('Invalid household membership kind');
      return {
        householdId: ids.household(row.household_id),
        membershipId: ids.membership(row.id),
        membershipKind: 'member',
        status: row.status === 'active' ? 'active' : 'revoked',
        isAdministrator: row.is_administrator,
        trustedCircleGrants: grantsByHousehold.get(row.household_id) ?? [],
        isPayer: row.is_payer,
        isBillingManager: row.is_billing_manager,
        protectedGrantId: row.protected_grant_id,
      };
    });

    const employeeResult = await this.database.query<EmployeeRow>(
      `SELECT employee.id AS assignment_id, employee.organization_id,
              organization.kind AS organization_kind, employee.role
       FROM employee_assignments employee
       JOIN organizations organization ON organization.id = employee.organization_id
       WHERE employee.person_id = $1 AND employee.status = 'active'
         AND organization.kind = 'internal'`,
      [session.person_id],
    );
    const employeeScopes: EmployeeScope[] = employeeResult.rows.map((row) => {
      if (!isRole(row.role) || !['hq_owner', 'hq_reviewer', 'hq_support'].includes(row.role)) {
        throw new TypeError('Invalid employee role in database');
      }
      return {
        employeeAssignmentId: row.assignment_id,
        organizationId: ids.organization(row.organization_id),
        organizationKind: row.organization_kind,
        role: row.role as EmployeeScope['role'],
        status: 'active' as const,
      };
    });
    const supportCasesResult = await this.database.query<SupportCaseRow>(
      `SELECT c.household_id, c.id AS case_id,
              assignment.employee_assignment_id, c.purpose
       FROM support_case_assignments assignment
       JOIN support_cases c
         ON c.household_id = assignment.household_id AND c.id = assignment.case_id
       JOIN employee_assignments employee ON employee.id = assignment.employee_assignment_id
       JOIN organizations organization ON organization.id = employee.organization_id
       WHERE employee.person_id = $1 AND employee.status = 'active'
         AND employee.role = 'hq_support' AND organization.kind = 'internal'
         AND assignment.status = 'active' AND c.status = 'open'
       ORDER BY c.household_id, c.id`,
      [session.person_id],
    );
    const supportCaseScopes: SupportCaseScope[] = supportCasesResult.rows.map((row) => ({
      householdId: ids.household(row.household_id),
      caseId: ids.supportCase(row.case_id),
      employeeAssignmentId: row.employee_assignment_id,
      purpose: row.purpose,
    }));
    const restrictedResult = await this.database.query<RestrictedAccessRow>(
      `SELECT access_grant.household_id, access_grant.id AS grant_id, access_grant.case_id,
              access_grant.employee_assignment_id, access_grant.purpose,
              access_grant.resource_type, access_grant.resource_id, access_grant.expires_at
       FROM restricted_access_grants access_grant
       JOIN support_case_assignments assignment
         ON assignment.household_id = access_grant.household_id
        AND assignment.case_id = access_grant.case_id
        AND assignment.employee_assignment_id = access_grant.employee_assignment_id
       JOIN support_cases c
         ON c.household_id = access_grant.household_id AND c.id = access_grant.case_id
       JOIN employee_assignments employee
         ON employee.id = access_grant.employee_assignment_id
       JOIN organizations organization ON organization.id = employee.organization_id
       WHERE employee.person_id = $1 AND employee.status = 'active'
         AND employee.role = 'hq_support' AND organization.kind = 'internal'
         AND assignment.status = 'active' AND c.status = 'open'
         AND access_grant.status = 'active'
         AND access_grant.assurance = 'step_up_verified'
         AND access_grant.expires_at > $2
       ORDER BY access_grant.household_id, access_grant.id`,
      [session.person_id, now.toISOString()],
    );
    const restrictedAccessScopes: RestrictedAccessScope[] = restrictedResult.rows.map((row) => ({
      householdId: ids.household(row.household_id),
      caseId: ids.supportCase(row.case_id),
      employeeAssignmentId: row.employee_assignment_id,
      purpose: row.purpose,
      grantId: ids.restrictedAccessGrant(row.grant_id),
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      expiresAt: asDate(row.expires_at, 'restricted_access_grants.expires_at'),
    }));

    const householdIds = membershipScopesWithoutCapabilities
      .filter((membership) => membership.status === 'active')
      .map((membership) => membership.householdId);
    const entitlementRepository = new EntitlementRepository(
      this.database,
      undefined,
      this.runtimeEnvironment,
    );
    const effectiveEntitlements = await Promise.all(
      householdIds.map((householdId) => entitlementRepository.forHousehold(householdId, now)),
    );
    const capabilitiesByHousehold = new Map<string, Set<Capability>>(
      householdIds.map((householdId) => [householdId, new Set<Capability>()]),
    );
    for (const entitlements of effectiveEntitlements) {
      for (const capability of entitlements.capabilities) {
        capabilitiesByHousehold.get(entitlements.householdId)?.add(capability);
      }
    }
    const protectedGrantIdsByHousehold = new Map(
      effectiveEntitlements.map((entitlements) => [
        entitlements.householdId,
        new Set<string>(entitlements.portfolio.contributingGrantIds),
      ]),
    );
    const householdCapabilities = [...capabilitiesByHousehold].map(([householdId, values]) => ({
      householdId,
      capabilities: [...values],
    }));
    const householdMemberships: HouseholdMembershipScope[] =
      membershipScopesWithoutCapabilities.map(({ protectedGrantId, ...membership }) => {
        const effectiveGrantIds = protectedGrantIdsByHousehold.get(membership.householdId);
        const trustedCircleGrants = membership.trustedCircleGrants.filter((grant) => {
          const entitlementGrantId = trustedEntitlementGrantByRelationship.get(
            grant.relationshipId,
          );
          return entitlementGrantId !== undefined && effectiveGrantIds?.has(entitlementGrantId);
        });
        const isProtectedMember =
          membership.status === 'active' &&
          protectedGrantId !== null &&
          effectiveGrantIds?.has(protectedGrantId) === true;
        const householdCapabilities = capabilitiesByHousehold.get(membership.householdId);
        const capabilitiesForActor =
          householdCapabilities === undefined
            ? []
            : isProtectedMember
              ? [...householdCapabilities]
              : trustedCircleGrants.length > 0
                ? [...householdCapabilities].filter(
                    (capability) =>
                      (capability === 'history:read' &&
                        trustedCircleGrants.some((grant) =>
                          grant.permissions.includes('view_shared_checks'),
                        )) ||
                      (capability === 'orientation:use' &&
                        trustedCircleGrants.some((grant) =>
                          grant.permissions.includes('help_with_orientation'),
                        )),
                  )
                : [];
        return {
          ...membership,
          trustedCircleGrants,
          isProtectedMember,
          capabilities: capabilitiesForActor,
        };
      });
    const principalRoles = new Set<Role>();
    for (const membership of householdMemberships) {
      if (membership.status !== 'active') continue;
      if (membership.isAdministrator) principalRoles.add('household_administrator');
      if (membership.isProtectedMember) principalRoles.add('protected_member');
      if (membership.trustedCircleGrants.length > 0) principalRoles.add('trusted_circle');
      if (membership.isPayer) principalRoles.add('payer');
      if (membership.isBillingManager) principalRoles.add('billing_manager');
    }
    for (const employee of employeeScopes) {
      if (employee.status === 'active') principalRoles.add(employee.role);
    }
    return {
      principal: {
        sessionId: ids.session(session.id),
        personId: ids.person(session.person_id),
        audience: expectedAudience,
        issuer: session.issuer,
        roles: [...principalRoles],
        householdMemberships,
        employeeScopes,
        supportCaseScopes,
        restrictedAccessScopes,
        expiresAt,
      },
      displayName: session.display_name,
      issuer: session.issuer,
      householdCapabilities,
    };
  }
}

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
  type TrustedCirclePermission,
} from '@boomerbuddy/domain';
import type { Database } from './database';
import { EntitlementRepository } from './entitlements';
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
  readonly role: string;
  readonly status: string;
  readonly permissions: unknown;
  readonly protected_grant_id: string | null;
}

interface EmployeeRow extends Record<string, unknown> {
  readonly organization_id: string | null;
  readonly role: string;
  readonly status: string;
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
      `SELECT m.household_id, m.id, m.role, m.status, m.permissions,
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
    const membershipScopesWithoutCapabilities: (Omit<
      HouseholdMembershipScope,
      'capabilities' | 'isProtectedMember'
    > & { readonly protectedGrantId: string | null })[] = membershipsResult.rows.map((row) => {
      if (
        !isRole(row.role) ||
        !['household_owner', 'protected_member', 'trusted_circle'].includes(row.role)
      ) {
        throw new TypeError('Invalid household role in database');
      }
      const permissionValues = stringArray(jsonValue(row.permissions), 'membership.permissions');
      if (permissionValues.some((permission) => !isPermission(permission))) {
        throw new TypeError('Invalid Trusted Circle permission in database');
      }
      return {
        householdId: ids.household(row.household_id),
        membershipId: ids.membership(row.id),
        role: row.role as HouseholdMembershipScope['role'],
        status: row.status === 'active' ? 'active' : 'revoked',
        permissions: permissionValues as TrustedCirclePermission[],
        protectedGrantId: row.protected_grant_id,
      };
    });

    const employeeResult = await this.database.query<EmployeeRow>(
      'SELECT organization_id, role, status FROM employee_assignments WHERE person_id = $1',
      [session.person_id],
    );
    const employeeScopes: EmployeeScope[] = employeeResult.rows.map((row) => {
      if (!isRole(row.role) || !['hq_owner', 'hq_reviewer', 'hq_support'].includes(row.role)) {
        throw new TypeError('Invalid employee role in database');
      }
      const base = {
        role: row.role as EmployeeScope['role'],
        status: row.status === 'active' ? ('active' as const) : ('suspended' as const),
      };
      return row.organization_id === null
        ? base
        : { ...base, organizationId: ids.organization(row.organization_id) };
    });

    const householdIds = membershipScopesWithoutCapabilities
      .filter((membership) => membership.status === 'active')
      .map((membership) => membership.householdId);
    const entitlementRepository = new EntitlementRepository(this.database);
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
        const isProtectedMember =
          membership.status === 'active' &&
          protectedGrantId !== null &&
          protectedGrantIdsByHousehold.get(membership.householdId)?.has(protectedGrantId) === true;
        const householdCapabilities = capabilitiesByHousehold.get(membership.householdId);
        const capabilitiesForActor =
          householdCapabilities === undefined
            ? []
            : isProtectedMember
              ? [...householdCapabilities]
              : membership.role === 'trusted_circle'
                ? [...householdCapabilities].filter(
                    (capability) =>
                      (capability === 'history:read' &&
                        membership.permissions.includes('view_shared_checks')) ||
                      (capability === 'orientation:use' &&
                        membership.permissions.includes('help_with_orientation')),
                  )
                : [];
        return { ...membership, isProtectedMember, capabilities: capabilitiesForActor };
      });
    const principalRoles = new Set<Role>();
    for (const membership of householdMemberships) {
      if (membership.status === 'active') principalRoles.add(membership.role);
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
        expiresAt,
      },
      displayName: session.display_name,
      issuer: session.issuer,
      householdCapabilities,
    };
  }
}

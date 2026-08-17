import type {
  AnalysisId,
  ArtifactId,
  HouseholdId,
  IdentityId,
  MembershipId,
  OrganizationId,
  PersonId,
  RelationshipId,
  RestrictedAccessGrantId,
  SessionId,
  SupportCaseId,
} from './identifiers';

export const audiences = ['customer', 'mobile', 'hq'] as const;
export type Audience = (typeof audiences)[number];

export const roles = [
  'household_administrator',
  'protected_member',
  'trusted_circle',
  'payer',
  'billing_manager',
  'hq_owner',
  'hq_reviewer',
  'hq_support',
] as const;
export type Role = (typeof roles)[number];

export const trustedCirclePermissions = [
  'view_shared_checks',
  'receive_escalations',
  'help_with_orientation',
] as const;
export type TrustedCirclePermission = (typeof trustedCirclePermissions)[number];

export interface Identity {
  readonly id: IdentityId;
  readonly personId: PersonId;
  readonly issuer: string;
  readonly subject: string;
  readonly status: 'active' | 'disabled';
}

export interface SessionPrincipal {
  readonly sessionId: SessionId;
  readonly personId: PersonId;
  readonly audience: Audience;
  readonly issuer: string;
  readonly roles: readonly Role[];
  readonly householdMemberships: readonly HouseholdMembershipScope[];
  readonly employeeScopes: readonly EmployeeScope[];
  readonly supportCaseScopes: readonly SupportCaseScope[];
  readonly restrictedAccessScopes: readonly RestrictedAccessScope[];
  readonly expiresAt: Date;
}

export interface PairwiseTrustedCircleGrant {
  readonly relationshipId: RelationshipId;
  readonly protectedPersonId: PersonId;
  readonly permissions: readonly TrustedCirclePermission[];
}

export interface HouseholdMembershipScope {
  readonly householdId: HouseholdId;
  readonly membershipId: MembershipId;
  readonly membershipKind: 'member';
  readonly status: 'active' | 'revoked';
  readonly isAdministrator: boolean;
  readonly isProtectedMember: boolean;
  readonly trustedCircleGrants: readonly PairwiseTrustedCircleGrant[];
  readonly isPayer: boolean;
  readonly isBillingManager: boolean;
  readonly capabilities: readonly Capability[];
}

export function hasActiveProtectedEnrollment(
  scope: Pick<HouseholdMembershipScope, 'isProtectedMember' | 'status'>,
): boolean {
  return scope.status === 'active' && scope.isProtectedMember;
}

export interface EmployeeScope {
  readonly employeeAssignmentId: string;
  readonly organizationId?: OrganizationId;
  readonly organizationKind: 'internal' | 'sponsor';
  readonly role: Extract<Role, 'hq_owner' | 'hq_reviewer' | 'hq_support'>;
  readonly status: 'active' | 'suspended';
}

export interface SupportCaseScope {
  readonly caseId: SupportCaseId;
  readonly householdId: HouseholdId;
  readonly employeeAssignmentId: string;
  readonly purpose: string;
}

export interface RestrictedAccessScope extends SupportCaseScope {
  readonly grantId: RestrictedAccessGrantId;
  readonly resourceType: 'artifact' | 'analysis' | 'family' | 'messaging_inbound';
  readonly resourceId: string;
  readonly expiresAt: Date;
}

export function hasTrustedCirclePermission(
  scope: Pick<HouseholdMembershipScope, 'status' | 'trustedCircleGrants'>,
  protectedPersonId: PersonId,
  permission: TrustedCirclePermission,
): boolean {
  return (
    scope.status === 'active' &&
    scope.trustedCircleGrants.some(
      (grant) =>
        grant.protectedPersonId === protectedPersonId && grant.permissions.includes(permission),
    )
  );
}

export interface Artifact {
  readonly id: ArtifactId;
  readonly householdId: HouseholdId;
  readonly ownerPersonId: PersonId;
  readonly kind: 'text' | 'url';
  readonly state: 'active' | 'deleted';
  readonly createdAt: Date;
}

export interface Analysis {
  readonly id: AnalysisId;
  readonly artifactId: ArtifactId;
  readonly householdId: HouseholdId;
  readonly requestedBy: PersonId;
  readonly state: 'completed' | 'failed' | 'deleted';
  readonly createdAt: Date;
}

export const capabilities = [
  'check:text',
  'check:url',
  'history:read',
  'family:manage',
  'orientation:use',
] as const;
export type Capability = (typeof capabilities)[number];

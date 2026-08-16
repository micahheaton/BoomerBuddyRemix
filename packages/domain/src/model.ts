import type {
  AnalysisId,
  ArtifactId,
  HouseholdId,
  IdentityId,
  MembershipId,
  OrganizationId,
  PersonId,
  SessionId,
} from './identifiers';

export const audiences = ['customer', 'mobile', 'hq'] as const;
export type Audience = (typeof audiences)[number];

export const roles = [
  'household_owner',
  'protected_member',
  'trusted_circle',
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
  readonly expiresAt: Date;
}

export interface HouseholdMembershipScope {
  readonly householdId: HouseholdId;
  readonly membershipId: MembershipId;
  readonly role: Extract<Role, 'household_owner' | 'protected_member' | 'trusted_circle'>;
  readonly status: 'active' | 'revoked';
  /** Accepted, active protected enrollment projected independently from the household role. */
  readonly isProtectedMember: boolean;
  readonly permissions: readonly TrustedCirclePermission[];
  readonly capabilities: readonly Capability[];
}

export function hasActiveProtectedEnrollment(
  scope: Pick<HouseholdMembershipScope, 'isProtectedMember' | 'status'>,
): boolean {
  return scope.status === 'active' && scope.isProtectedMember;
}

export interface EmployeeScope {
  readonly organizationId?: OrganizationId;
  readonly role: Extract<Role, 'hq_owner' | 'hq_reviewer' | 'hq_support'>;
  readonly status: 'active' | 'suspended';
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

import {
  DomainError,
  hasActiveProtectedEnrollment,
  hasTrustedCirclePermission,
  type Audience,
  type Capability,
  type HouseholdId,
  type OrganizationId,
  type PersonId,
  type RelationshipId,
  type RestrictedAccessGrantId,
  type Role,
  type SessionId,
  type SupportCaseId,
  type TrustedCirclePermission,
} from '@boomerbuddy/domain';

export const actions = [
  'check:create',
  'check:list',
  'check:read',
  'check:delete',
  'check:share',
  'family:view',
  'family:invite',
  'family:revoke_invitation',
  'family:accept_invitation',
  'family:revoke',
  'orientation:view',
  'orientation:update',
  'entitlement:view',
  'founding_household:view',
  'founding_household:accept',
  'founding_household:offboard',
  'hq:overview',
  'hq:households:list',
  'hq:reviews:list',
  'hq:support_queue:list',
  'hq:review_queue:list',
  'hq:audit:list',
  'hq:business_os:read',
  'hq:business_os:manage',
  'hq:founder_provisioning:read',
  'hq:founder_provisioning:manage',
  'hq:founding_households:read',
  'hq:founding_households:manage',
  'hq:billing_authority:read',
  'hq:billing_authority:manage',
  'hq:support_case:view',
  'hq:restricted_resource:read',
] as const;
export type Action = (typeof actions)[number];

export type Resource =
  | {
      readonly kind: 'check_collection';
      readonly householdId: HouseholdId;
      readonly scope:
        | { readonly kind: 'create'; readonly artifactKind: 'text' | 'url' }
        | {
            readonly kind: 'list';
            readonly ownerPersonId: PersonId;
            readonly includeOwned: boolean;
            readonly includeExplicitlyShared: boolean;
          };
    }
  | {
      readonly kind: 'check';
      readonly householdId: HouseholdId;
      readonly ownerPersonId: PersonId;
      readonly sharedWithPersonIds?: readonly PersonId[];
    }
  | {
      readonly kind: 'family';
      readonly householdId: HouseholdId;
      readonly scope:
        | { readonly kind: 'roster' }
        | { readonly kind: 'subject_relationships'; readonly subjectPersonId: PersonId }
        | { readonly kind: 'subject_invitation'; readonly protectedPersonId: PersonId }
        | {
            readonly kind: 'pairwise_relationship';
            readonly relationshipId: RelationshipId;
            readonly protectedPersonId: PersonId;
            readonly trustedPersonId: PersonId;
          };
    }
  | {
      readonly kind: 'invitation';
      readonly householdId: HouseholdId;
      readonly invitedPersonId?: PersonId;
      readonly identityBindingState: 'development_unbound' | 'verified_identity';
      readonly credentialPresented: boolean;
    }
  | {
      readonly kind: 'orientation';
      readonly householdId: HouseholdId;
      readonly subjectPersonId: PersonId;
    }
  | { readonly kind: 'entitlement'; readonly householdId: HouseholdId }
  | {
      readonly kind: 'support_case';
      readonly householdId: HouseholdId;
      readonly caseId: SupportCaseId;
    }
  | {
      readonly kind: 'restricted_customer_resource';
      readonly householdId: HouseholdId;
      readonly caseId: SupportCaseId;
      readonly resourceType: 'artifact' | 'analysis' | 'family' | 'messaging_inbound';
      readonly resourceId: string;
    }
  | {
      readonly kind: 'founder_provisioning';
      readonly configuredFounderPersonId?: string;
    }
  | {
      readonly kind: 'founding_household_program';
      readonly configuredFounderPersonId?: string;
    }
  | {
      readonly kind: 'billing_authority_workflow';
      readonly configuredFounderPersonId?: string;
    }
  | {
      readonly kind: 'founding_household';
      readonly householdId: HouseholdId;
      readonly scope:
        | { readonly kind: 'status' }
        | { readonly kind: 'invitation'; readonly credentialPresented: boolean };
    }
  | { readonly kind: 'hq'; readonly organizationId?: OrganizationId };

export interface Principal {
  readonly personId: PersonId;
  readonly sessionId: SessionId;
  readonly audience: Audience;
  readonly roles: readonly Role[];
  readonly households: readonly {
    readonly householdId: HouseholdId;
    readonly membershipKind: 'member';
    readonly isAdministrator: boolean;
    readonly isProtectedMember: boolean;
    readonly trustedCircleGrants: readonly {
      readonly relationshipId: RelationshipId;
      readonly protectedPersonId: PersonId;
      readonly permissions: readonly TrustedCirclePermission[];
    }[];
    readonly isPayer: boolean;
    readonly isBillingManager: boolean;
    readonly capabilities: readonly Capability[];
    readonly status: 'active' | 'revoked';
  }[];
  readonly organizations: readonly {
    readonly employeeAssignmentId: string;
    readonly organizationId?: OrganizationId;
    readonly organizationKind: 'internal' | 'sponsor';
    readonly role: Extract<Role, 'hq_owner' | 'hq_reviewer' | 'hq_support'>;
    readonly status: 'active' | 'suspended';
  }[];
  readonly supportCases: readonly {
    readonly caseId: SupportCaseId;
    readonly householdId: HouseholdId;
    readonly employeeAssignmentId: string;
    readonly purpose: string;
  }[];
  readonly restrictedAccess: readonly {
    readonly grantId: RestrictedAccessGrantId;
    readonly caseId: SupportCaseId;
    readonly householdId: HouseholdId;
    readonly employeeAssignmentId: string;
    readonly purpose: string;
    readonly resourceType: 'artifact' | 'analysis' | 'family' | 'messaging_inbound';
    readonly resourceId: string;
    readonly expiresAt: Date;
  }[];
}

export type AuthorizationReason =
  | 'allowed_by_policy'
  | 'missing_principal'
  | 'wrong_audience'
  | 'unsupported_action_resource'
  | 'inactive_relationship'
  | 'outside_tenant'
  | 'missing_capability'
  | 'not_owner_or_shared'
  | 'missing_relationship_permission'
  | 'insufficient_role';

export type AuthorizationDecision =
  | { readonly allowed: true; readonly reason: 'allowed_by_policy' }
  | { readonly allowed: false; readonly reason: Exclude<AuthorizationReason, 'allowed_by_policy'> };

export interface AuthorizationInput {
  readonly principal: Principal | null;
  readonly action: Action;
  readonly resource: Resource;
}

const customerActions = new Set<Action>(actions.filter((action) => !action.startsWith('hq:')));
const knownActions = new Set<string>(actions);

function deny(reason: Exclude<AuthorizationReason, 'allowed_by_policy'>): AuthorizationDecision {
  return { allowed: false, reason };
}

function householdRelationship(principal: Principal, householdId: HouseholdId) {
  return principal.households.find(
    (candidate) => candidate.householdId === householdId && candidate.status === 'active',
  );
}

function requiredCapability(action: Action, resource: Resource): Capability | undefined {
  if (action === 'check:create' && resource.kind === 'check_collection') {
    return resource.scope.kind === 'create' && resource.scope.artifactKind === 'url'
      ? 'check:url'
      : 'check:text';
  }
  if (action === 'check:list' || action === 'check:read') return 'history:read';
  if (action === 'family:invite') return 'family:manage';
  if (action.startsWith('orientation:')) return 'orientation:use';
  return undefined;
}

export function authorize(input: AuthorizationInput): AuthorizationDecision {
  const { principal, action, resource } = input;
  if (principal === null) return deny('missing_principal');
  if (!knownActions.has(action)) return deny('unsupported_action_resource');

  if (action.startsWith('hq:')) {
    if (principal.audience !== 'hq') return deny('wrong_audience');
    if (action === 'hq:support_case:view') {
      if (resource.kind !== 'support_case') return deny('unsupported_action_resource');
      const supportScope = principal.supportCases.find(
        (scope) => scope.caseId === resource.caseId && scope.householdId === resource.householdId,
      );
      const eligible =
        supportScope !== undefined &&
        principal.organizations.some(
          (assignment) =>
            assignment.employeeAssignmentId === supportScope.employeeAssignmentId &&
            assignment.organizationKind === 'internal' &&
            assignment.role === 'hq_support' &&
            assignment.status === 'active',
        );
      return eligible
        ? { allowed: true, reason: 'allowed_by_policy' }
        : deny('inactive_relationship');
    }
    if (action === 'hq:restricted_resource:read') {
      if (resource.kind !== 'restricted_customer_resource') {
        return deny('unsupported_action_resource');
      }
      const accessScope = principal.restrictedAccess.find(
        (scope) =>
          scope.caseId === resource.caseId &&
          scope.householdId === resource.householdId &&
          scope.resourceType === resource.resourceType &&
          scope.resourceId === resource.resourceId,
      );
      const eligible =
        accessScope !== undefined &&
        principal.organizations.some(
          (assignment) =>
            assignment.employeeAssignmentId === accessScope.employeeAssignmentId &&
            assignment.organizationKind === 'internal' &&
            assignment.role === 'hq_support' &&
            assignment.status === 'active',
        );
      return eligible
        ? { allowed: true, reason: 'allowed_by_policy' }
        : deny('inactive_relationship');
    }
    if (
      action === 'hq:founder_provisioning:read' ||
      action === 'hq:founder_provisioning:manage' ||
      action === 'hq:founding_households:read' ||
      action === 'hq:founding_households:manage' ||
      action === 'hq:billing_authority:read' ||
      action === 'hq:billing_authority:manage'
    ) {
      const expectedResource = action.startsWith('hq:founder_provisioning:')
        ? 'founder_provisioning'
        : action.startsWith('hq:founding_households:')
          ? 'founding_household_program'
          : 'billing_authority_workflow';
      if (resource.kind !== expectedResource) {
        return deny('unsupported_action_resource');
      }
      const founderOwner = principal.organizations.some(
        (assignment) =>
          assignment.organizationKind === 'internal' &&
          assignment.role === 'hq_owner' &&
          assignment.status === 'active',
      );
      if (
        resource.configuredFounderPersonId === undefined ||
        principal.personId !== resource.configuredFounderPersonId
      ) {
        return deny('insufficient_role');
      }
      return founderOwner
        ? { allowed: true, reason: 'allowed_by_policy' }
        : deny('inactive_relationship');
    }
    if (resource.kind !== 'hq') return deny('unsupported_action_resource');
    const activeRoles = principal.organizations
      .filter(
        (scope) =>
          scope.status === 'active' &&
          scope.organizationKind === 'internal' &&
          (resource.organizationId === undefined ||
            scope.organizationId === resource.organizationId),
      )
      .map((scope) => scope.role);
    if (action === 'hq:support_queue:list') {
      return activeRoles.includes('hq_support')
        ? { allowed: true, reason: 'allowed_by_policy' }
        : deny(activeRoles.length === 0 ? 'inactive_relationship' : 'insufficient_role');
    }
    if (action === 'hq:review_queue:list') {
      return activeRoles.includes('hq_reviewer')
        ? { allowed: true, reason: 'allowed_by_policy' }
        : deny(activeRoles.length === 0 ? 'inactive_relationship' : 'insufficient_role');
    }
    if (activeRoles.includes('hq_owner')) return { allowed: true, reason: 'allowed_by_policy' };
    return deny(activeRoles.length === 0 ? 'inactive_relationship' : 'insufficient_role');
  }

  if (!customerActions.has(action)) return deny('unsupported_action_resource');
  if (principal.audience !== 'customer' && principal.audience !== 'mobile') {
    return deny('wrong_audience');
  }
  if (
    resource.kind === 'hq' ||
    resource.kind === 'founder_provisioning' ||
    resource.kind === 'founding_household_program' ||
    resource.kind === 'billing_authority_workflow' ||
    resource.kind === 'support_case' ||
    resource.kind === 'restricted_customer_resource'
  ) {
    return deny('unsupported_action_resource');
  }

  if (resource.kind === 'invitation' && action === 'family:accept_invitation') {
    const identityMatches =
      resource.identityBindingState === 'development_unbound'
        ? resource.invitedPersonId === undefined
        : resource.invitedPersonId === principal.personId;
    return resource.credentialPresented && identityMatches
      ? { allowed: true, reason: 'allowed_by_policy' }
      : deny('not_owner_or_shared');
  }
  const relationship = householdRelationship(principal, resource.householdId);
  if (relationship === undefined) return deny('outside_tenant');

  if (resource.kind === 'founding_household') {
    if (!relationship.isAdministrator) return deny('insufficient_role');
    if (
      action === 'founding_household:view' &&
      (resource.scope.kind === 'status' ||
        (resource.scope.kind === 'invitation' && resource.scope.credentialPresented))
    ) {
      return { allowed: true, reason: 'allowed_by_policy' };
    }
    if (
      action === 'founding_household:accept' &&
      resource.scope.kind === 'invitation' &&
      resource.scope.credentialPresented
    ) {
      return { allowed: true, reason: 'allowed_by_policy' };
    }
    if (action === 'founding_household:offboard' && resource.scope.kind === 'status') {
      return { allowed: true, reason: 'allowed_by_policy' };
    }
    return deny('unsupported_action_resource');
  }

  const capability = requiredCapability(action, resource);
  if (capability !== undefined && !relationship.capabilities.includes(capability)) {
    return deny('missing_capability');
  }

  if (resource.kind === 'check_collection') {
    if (action === 'check:create' && resource.scope.kind === 'create') {
      return hasActiveProtectedEnrollment(relationship)
        ? { allowed: true, reason: 'allowed_by_policy' }
        : deny('insufficient_role');
    }
    if (
      action === 'check:list' &&
      resource.scope.kind === 'list' &&
      resource.scope.ownerPersonId === principal.personId
    ) {
      // The repository must independently apply only the requested actor-owned
      // and/or explicitly-shared categories. Household-wide history is not representable.
      if (!resource.scope.includeOwned && !resource.scope.includeExplicitlyShared) {
        return deny('unsupported_action_resource');
      }
      if (resource.scope.includeOwned && !hasActiveProtectedEnrollment(relationship)) {
        return deny('insufficient_role');
      }
      return { allowed: true, reason: 'allowed_by_policy' };
    }
    return deny('unsupported_action_resource');
  }

  if (resource.kind === 'check') {
    if (!['check:read', 'check:delete', 'check:share'].includes(action)) {
      return deny('unsupported_action_resource');
    }
    const owns = resource.ownerPersonId === principal.personId;
    const explicitlyShared = resource.sharedWithPersonIds?.includes(principal.personId) ?? false;
    const relationshipCanView =
      hasTrustedCirclePermission(relationship, resource.ownerPersonId, 'view_shared_checks') &&
      explicitlyShared;
    if (
      action === 'check:read' &&
      ((owns && hasActiveProtectedEnrollment(relationship)) || relationshipCanView)
    ) {
      return { allowed: true, reason: 'allowed_by_policy' };
    }
    if (action === 'check:delete' && owns) {
      return { allowed: true, reason: 'allowed_by_policy' };
    }
    if (action === 'check:share' && owns && hasActiveProtectedEnrollment(relationship)) {
      return { allowed: true, reason: 'allowed_by_policy' };
    }
    return deny('not_owner_or_shared');
  }

  if (resource.kind === 'family') {
    if (action === 'family:view') {
      if (resource.scope.kind === 'roster' && relationship.isAdministrator) {
        return { allowed: true, reason: 'allowed_by_policy' };
      }
      if (
        resource.scope.kind === 'subject_relationships' &&
        resource.scope.subjectPersonId === principal.personId &&
        (relationship.isProtectedMember || relationship.trustedCircleGrants.length > 0)
      ) {
        return { allowed: true, reason: 'allowed_by_policy' };
      }
      if (
        resource.scope.kind === 'pairwise_relationship' &&
        (resource.scope.protectedPersonId === principal.personId ||
          resource.scope.trustedPersonId === principal.personId)
      ) {
        return { allowed: true, reason: 'allowed_by_policy' };
      }
      return deny('not_owner_or_shared');
    }
    if (action === 'family:invite') {
      return hasActiveProtectedEnrollment(relationship) &&
        resource.scope.kind === 'subject_invitation' &&
        resource.scope.protectedPersonId === principal.personId
        ? { allowed: true, reason: 'allowed_by_policy' }
        : deny(
            hasActiveProtectedEnrollment(relationship)
              ? 'not_owner_or_shared'
              : 'insufficient_role',
          );
    }
    if (action === 'family:revoke_invitation') {
      if (resource.scope.kind !== 'subject_invitation') {
        return deny('unsupported_action_resource');
      }
      // The server resolves this exact subject from the pending invitation.
      // Withdrawal remains available after protected enrollment or entitlement lapses.
      const protectedSubjectMayCancel = resource.scope.protectedPersonId === principal.personId;
      return relationship.isAdministrator || protectedSubjectMayCancel
        ? { allowed: true, reason: 'allowed_by_policy' }
        : deny('not_owner_or_shared');
    }
    if (action === 'family:revoke') {
      if (resource.scope.kind !== 'pairwise_relationship') {
        return deny('unsupported_action_resource');
      }
      const pair = resource.scope;
      // The server resolves both participants from the exact relationship. A protected
      // subject must retain withdrawal rights after enrollment or entitlement lapses.
      const participantMayWithdraw =
        pair.protectedPersonId === principal.personId ||
        pair.trustedPersonId === principal.personId;
      return relationship.isAdministrator || participantMayWithdraw
        ? { allowed: true, reason: 'allowed_by_policy' }
        : deny('not_owner_or_shared');
    }
    return deny('unsupported_action_resource');
  }

  if (resource.kind === 'invitation') return deny('unsupported_action_resource');

  if (resource.kind === 'orientation') {
    if (action !== 'orientation:view' && action !== 'orientation:update') {
      return deny('unsupported_action_resource');
    }
    if (
      resource.subjectPersonId === principal.personId &&
      hasActiveProtectedEnrollment(relationship)
    ) {
      return { allowed: true, reason: 'allowed_by_policy' };
    }
    if (
      hasTrustedCirclePermission(relationship, resource.subjectPersonId, 'help_with_orientation')
    ) {
      return { allowed: true, reason: 'allowed_by_policy' };
    }
    return deny('missing_relationship_permission');
  }

  if (resource.kind === 'entitlement' && action === 'entitlement:view') {
    return relationship.isBillingManager
      ? { allowed: true, reason: 'allowed_by_policy' }
      : deny('insufficient_role');
  }
  return deny('unsupported_action_resource');
}

export function assertAuthorized(input: AuthorizationInput): void {
  const decision = authorize(input);
  if (!decision.allowed) {
    throw new DomainError('not_authorized', 'The requested action is not permitted', {
      reason: decision.reason,
    });
  }
}

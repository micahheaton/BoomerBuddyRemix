const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;

type Brand<Value, Name extends string> = Value & { readonly __brand: Name };

export type PersonId = Brand<string, 'PersonId'>;
export type IdentityId = Brand<string, 'IdentityId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type HouseholdId = Brand<string, 'HouseholdId'>;
export type MembershipId = Brand<string, 'MembershipId'>;
export type InvitationId = Brand<string, 'InvitationId'>;
export type ConsentId = Brand<string, 'ConsentId'>;
export type ConsentEvidenceId = Brand<string, 'ConsentEvidenceId'>;
export type RelationshipId = Brand<string, 'RelationshipId'>;
export type ArtifactId = Brand<string, 'ArtifactId'>;
export type AnalysisId = Brand<string, 'AnalysisId'>;
export type OrganizationId = Brand<string, 'OrganizationId'>;
export type EntitlementGrantId = Brand<string, 'EntitlementGrantId'>;
export type CommerceProductVersionId = Brand<string, 'CommerceProductVersionId'>;
export type CommercePlanVersionId = Brand<string, 'CommercePlanVersionId'>;
export type CommerceSubscriptionId = Brand<string, 'CommerceSubscriptionId'>;
export type CorrelationId = Brand<string, 'CorrelationId'>;
export type SupportCaseId = Brand<string, 'SupportCaseId'>;
export type RestrictedAccessGrantId = Brand<string, 'RestrictedAccessGrantId'>;

function opaqueId<Name extends string>(value: string, name: Name): Brand<string, Name> {
  if (!OPAQUE_ID.test(value)) {
    throw new TypeError(`${name} must be a 3-128 character opaque identifier`);
  }
  return value as Brand<string, Name>;
}

export const ids = {
  person: (value: string): PersonId => opaqueId(value, 'PersonId'),
  identity: (value: string): IdentityId => opaqueId(value, 'IdentityId'),
  session: (value: string): SessionId => opaqueId(value, 'SessionId'),
  household: (value: string): HouseholdId => opaqueId(value, 'HouseholdId'),
  membership: (value: string): MembershipId => opaqueId(value, 'MembershipId'),
  invitation: (value: string): InvitationId => opaqueId(value, 'InvitationId'),
  consent: (value: string): ConsentId => opaqueId(value, 'ConsentId'),
  consentEvidence: (value: string): ConsentEvidenceId => opaqueId(value, 'ConsentEvidenceId'),
  relationship: (value: string): RelationshipId => opaqueId(value, 'RelationshipId'),
  artifact: (value: string): ArtifactId => opaqueId(value, 'ArtifactId'),
  analysis: (value: string): AnalysisId => opaqueId(value, 'AnalysisId'),
  organization: (value: string): OrganizationId => opaqueId(value, 'OrganizationId'),
  entitlementGrant: (value: string): EntitlementGrantId => opaqueId(value, 'EntitlementGrantId'),
  commerceProductVersion: (value: string): CommerceProductVersionId =>
    opaqueId(value, 'CommerceProductVersionId'),
  commercePlanVersion: (value: string): CommercePlanVersionId =>
    opaqueId(value, 'CommercePlanVersionId'),
  commerceSubscription: (value: string): CommerceSubscriptionId =>
    opaqueId(value, 'CommerceSubscriptionId'),
  correlation: (value: string): CorrelationId => opaqueId(value, 'CorrelationId'),
  supportCase: (value: string): SupportCaseId => opaqueId(value, 'SupportCaseId'),
  restrictedAccessGrant: (value: string): RestrictedAccessGrantId =>
    opaqueId(value, 'RestrictedAccessGrantId'),
} as const;

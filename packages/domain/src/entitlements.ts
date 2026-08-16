import type { Capability } from './model';
import type {
  CommercePlanVersionId,
  CommerceSubscriptionId,
  EntitlementGrantId,
  HouseholdId,
  OrganizationId,
  PersonId,
} from './identifiers';

export const entitlementSources = [
  'local',
  'web',
  'apple',
  'google',
  'sponsor',
  'support',
] as const;
export type EntitlementSource = (typeof entitlementSources)[number];

export type EntitlementSubject =
  | { readonly kind: 'person'; readonly personId: PersonId }
  | { readonly kind: 'household'; readonly householdId: HouseholdId }
  | { readonly kind: 'organization'; readonly organizationId: OrganizationId };

export interface EntitlementGrant {
  readonly id: EntitlementGrantId;
  readonly subject: EntitlementSubject;
  readonly source: EntitlementSource;
  readonly planVersionId?: CommercePlanVersionId;
  readonly subscriptionId?: CommerceSubscriptionId;
  readonly capabilities: readonly Capability[];
  readonly startsAt: Date;
  readonly endsAt?: Date;
  readonly revokedAt?: Date;
  readonly sourceVerified: boolean;
  readonly precedence: number;
}

export function isSameEntitlementSubject(
  left: EntitlementSubject,
  right: EntitlementSubject,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'person' && right.kind === 'person') return left.personId === right.personId;
  if (left.kind === 'household' && right.kind === 'household') {
    return left.householdId === right.householdId;
  }
  return (
    left.kind === 'organization' &&
    right.kind === 'organization' &&
    left.organizationId === right.organizationId
  );
}

export interface EffectiveEntitlements {
  readonly capabilities: ReadonlySet<Capability>;
  readonly contributingGrantIds: readonly EntitlementGrantId[];
}

export function isGrantEffective(grant: EntitlementGrant, at: Date): boolean {
  return (
    grant.sourceVerified &&
    grant.startsAt.getTime() <= at.getTime() &&
    (grant.endsAt === undefined || grant.endsAt.getTime() > at.getTime()) &&
    (grant.revokedAt === undefined || grant.revokedAt.getTime() > at.getTime())
  );
}

export function resolveEffectiveEntitlements(
  grants: readonly EntitlementGrant[],
  at: Date = new Date(),
): EffectiveEntitlements {
  const effective = grants
    .filter((grant) => isGrantEffective(grant, at))
    .sort((left, right) => right.precedence - left.precedence || left.id.localeCompare(right.id));
  const result = new Set<Capability>();
  for (const grant of effective) {
    for (const capability of grant.capabilities) result.add(capability);
  }
  return {
    capabilities: result,
    contributingGrantIds: effective.map((grant) => grant.id),
  };
}

export function hasCapability(
  entitlements: EffectiveEntitlements | readonly Capability[],
  capability: Capability,
): boolean {
  return Array.isArray(entitlements)
    ? entitlements.includes(capability)
    : (entitlements as EffectiveEntitlements).capabilities.has(capability);
}

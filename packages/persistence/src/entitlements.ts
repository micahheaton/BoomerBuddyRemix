import {
  allowanceKinds,
  billingIntervals,
  capabilities,
  commercePlanKeys,
  commerceSubscriptionLifecycles,
  defineCommercePlanVersion,
  defineCommerceProductVersion,
  DomainError,
  entitlementSources,
  ids,
  priceHypothesisKinds,
  resolveCommercePortfolio,
  assertPortfolioAllowanceAvailable,
  type AllowanceKind,
  type AllowanceUsageInput,
  type Capability,
  type CommerceAllowance,
  type CommercePlanVersion,
  type CommercePriceHypothesis,
  type CommerceProductVersion,
  type CommerceSubscriptionLifecycle,
  type EffectiveCommercePortfolio,
  type EntitlementGrant,
  type EntitlementSource,
  type NormalizedSubscription,
} from '@boomerbuddy/domain';
import type { Database, SqlExecutor } from './database';
import { asDate, jsonValue, randomIdFactory, stringArray, type IdFactory } from './values';

interface CommerceRow extends Record<string, unknown> {
  readonly subscription_id: string;
  readonly source: EntitlementSource;
  readonly lifecycle: CommerceSubscriptionLifecycle;
  readonly source_verified: boolean;
  readonly precedence: number;
  readonly current_period_starts_at: unknown;
  readonly current_period_ends_at: unknown;
  readonly reconciliation_state: 'not_required' | 'pending' | 'reconciled' | 'attention';
  readonly sponsor_backing_verified: boolean;
  readonly local_backing: boolean;
  readonly plan_id: string;
  readonly plan_key: CommercePlanVersion['key'];
  readonly plan_version: number;
  readonly plan_display_name: string;
  readonly plan_state: 'hypothesis' | 'active' | 'retired';
  readonly plan_capabilities: unknown;
  readonly plan_allowances: unknown;
  readonly plan_prices: unknown;
  readonly plan_available_from: unknown;
  readonly plan_available_until: unknown;
  readonly product_id: string;
  readonly product_key: CommerceProductVersion['key'];
  readonly product_version: number;
  readonly product_display_name: string;
  readonly product_available_from: unknown;
  readonly product_available_until: unknown;
}

interface GrantRow extends Record<string, unknown> {
  readonly household_id: string;
  readonly id: string;
  readonly source: EntitlementSource;
  readonly capabilities: unknown;
  readonly starts_at: unknown;
  readonly ends_at: unknown;
  readonly revoked_at: unknown;
  readonly source_verified: boolean;
  readonly precedence: number;
  readonly plan_version_id: string;
  readonly subscription_id: string;
  readonly sponsorship_id: string | null;
}

interface UsageRow extends Record<string, unknown> {
  readonly protected_members: number;
  readonly trusted_circle_participants: number;
}

interface ProtectedEnrollmentRow extends Record<string, unknown> {
  readonly allowance_allocation_id: string;
  readonly entitlement_grant_id: string;
  readonly consent_version: string;
}

export interface CommerceSourceRecord {
  readonly subscription: NormalizedSubscription;
  readonly reconciliationState: CommerceRow['reconciliation_state'];
  readonly plan: CommercePlanVersion;
  readonly planState: CommerceRow['plan_state'];
  readonly product: CommerceProductVersion;
}

export interface HouseholdEntitlements {
  readonly householdId: string;
  readonly capabilities: readonly Capability[];
  readonly grants: readonly EntitlementGrant[];
  readonly portfolio: EffectiveCommercePortfolio;
  readonly sources: readonly CommerceSourceRecord[];
}

export interface ProtectedMemberEnrollment {
  readonly householdId: string;
  readonly personId: string;
  readonly status: 'accepted' | 'deferred' | 'revoked';
  readonly consentVersion: string;
  readonly allowanceAllocationId: string | null;
}

function objects(value: unknown, label: string): readonly Record<string, unknown>[] {
  const parsed = jsonValue(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'object' || item === null)) {
    throw new TypeError(`Invalid ${label}`);
  }
  return parsed as readonly Record<string, unknown>[];
}

function planFromRow(row: CommerceRow): CommercePlanVersion {
  if (!commercePlanKeys.includes(row.plan_key)) throw new TypeError('Invalid commerce plan key');
  const capabilityValues = stringArray(jsonValue(row.plan_capabilities), 'plan.capabilities');
  if (capabilityValues.some((value) => !capabilities.includes(value as Capability))) {
    throw new TypeError('Invalid plan capability');
  }
  const allowances = objects(row.plan_allowances, 'plan allowances').map((value) => {
    const kind = value.kind;
    const limit = value.limit;
    if (
      typeof kind !== 'string' ||
      !allowanceKinds.includes(kind as AllowanceKind) ||
      typeof limit !== 'number'
    ) {
      throw new TypeError('Invalid plan allowance');
    }
    return { kind: kind as AllowanceKind, limit } satisfies CommerceAllowance;
  });
  const prices = objects(row.plan_prices, 'plan prices').map((value) => {
    const { interval, amountMinor, currency, kind } = value;
    if (
      typeof interval !== 'string' ||
      !billingIntervals.includes(interval as CommercePriceHypothesis['interval']) ||
      typeof amountMinor !== 'number' ||
      currency !== 'USD' ||
      typeof kind !== 'string' ||
      !priceHypothesisKinds.includes(kind as CommercePriceHypothesis['kind'])
    ) {
      throw new TypeError('Invalid plan price hypothesis');
    }
    return {
      interval: interval as CommercePriceHypothesis['interval'],
      amountMinor,
      currency,
      kind: kind as CommercePriceHypothesis['kind'],
    } satisfies CommercePriceHypothesis;
  });
  return defineCommercePlanVersion({
    id: ids.commercePlanVersion(row.plan_id),
    productVersionId: ids.commerceProductVersion(row.product_id),
    key: row.plan_key,
    version: row.plan_version,
    displayName: row.plan_display_name,
    availableFrom: asDate(row.plan_available_from, 'plan.available_from').toISOString(),
    ...(row.plan_available_until === null
      ? {}
      : { availableUntil: asDate(row.plan_available_until, 'plan.available_until').toISOString() }),
    capabilities: capabilityValues as Capability[],
    allowances,
    prices,
  });
}

function productFromRow(row: CommerceRow): CommerceProductVersion {
  if (row.product_key !== 'consumer_household') throw new TypeError('Invalid product key');
  return defineCommerceProductVersion({
    id: ids.commerceProductVersion(row.product_id),
    key: row.product_key,
    version: row.product_version,
    displayName: row.product_display_name,
    availableFrom: asDate(row.product_available_from, 'product.available_from').toISOString(),
    ...(row.product_available_until === null
      ? {}
      : {
          availableUntil: asDate(
            row.product_available_until,
            'product.available_until',
          ).toISOString(),
        }),
  });
}

function grantFromRow(row: GrantRow): EntitlementGrant {
  if (!entitlementSources.includes(row.source)) throw new TypeError('Invalid entitlement source');
  const capabilityValues = stringArray(jsonValue(row.capabilities), 'entitlement.capabilities');
  if (capabilityValues.some((value) => !capabilities.includes(value as Capability))) {
    throw new TypeError('Invalid entitlement capability');
  }
  return {
    id: ids.entitlementGrant(row.id),
    subject: { kind: 'household', householdId: ids.household(row.household_id) },
    source: row.source,
    planVersionId: ids.commercePlanVersion(row.plan_version_id),
    subscriptionId: ids.commerceSubscription(row.subscription_id),
    capabilities: capabilityValues as Capability[],
    startsAt: asDate(row.starts_at, 'entitlement.starts_at'),
    ...(row.ends_at === null ? {} : { endsAt: asDate(row.ends_at, 'entitlement.ends_at') }),
    ...(row.revoked_at === null
      ? {}
      : { revokedAt: asDate(row.revoked_at, 'entitlement.revoked_at') }),
    sourceVerified: row.source_verified,
    precedence: row.precedence,
  };
}

async function allowanceUsage(
  executor: SqlExecutor,
  householdId: string,
): Promise<readonly AllowanceUsageInput[]> {
  const result = await executor.query<UsageRow>(
    `SELECT
       (SELECT count(DISTINCT p.person_id)::int
        FROM protected_members p
        JOIN household_memberships m
          ON m.household_id = p.household_id AND m.person_id = p.person_id
        JOIN commerce_allowance_allocations a
          ON a.household_id = p.household_id AND a.id = p.allowance_allocation_id
        WHERE p.household_id = $1 AND p.status = 'accepted' AND m.status = 'active'
          AND a.state = 'active' AND a.allowance_key = 'protected_members'
          AND a.subject_kind = 'protected_member' AND a.subject_id = p.person_id
       ) AS protected_members,
       (SELECT count(DISTINCT a.subject_id)::int
        FROM commerce_allowance_allocations a
        JOIN household_memberships m
          ON m.household_id = a.household_id AND m.person_id = a.subject_id
        WHERE a.household_id = $1 AND a.state = 'active' AND m.status = 'active'
          AND a.allowance_key = 'trusted_circle_participants'
          AND a.subject_kind = 'trusted_circle_person'
       ) AS trusted_circle_participants`,
    [householdId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new TypeError('Unable to count household allowance usage');
  return [
    { kind: 'protected_members', count: row.protected_members },
    { kind: 'trusted_circle_participants', count: row.trusted_circle_participants },
  ];
}

export async function protectedEnrollment(
  executor: SqlExecutor,
  householdId: string,
  personId: string,
  lock = false,
): Promise<ProtectedEnrollmentRow | null> {
  const result = await executor.query<ProtectedEnrollmentRow>(
    `SELECT p.allowance_allocation_id, a.entitlement_grant_id, p.consent_version
     FROM protected_members p
     JOIN household_memberships m
       ON m.household_id = p.household_id AND m.person_id = p.person_id
     JOIN commerce_allowance_allocations a
       ON a.household_id = p.household_id AND a.id = p.allowance_allocation_id
     WHERE p.household_id = $1 AND p.person_id = $2 AND p.status = 'accepted'
       AND m.status = 'active' AND a.state = 'active'
       AND a.allowance_key = 'protected_members' AND a.subject_kind = 'protected_member'
       AND a.subject_id = p.person_id${lock ? ' FOR UPDATE OF p, a' : ''}`,
    [householdId, personId],
  );
  return result.rows[0] ?? null;
}

export async function hasEffectiveProtectedEnrollment(
  executor: SqlExecutor,
  householdId: string,
  personId: string,
  now: Date,
  lock = false,
): Promise<boolean> {
  const entitlements = await loadHouseholdEntitlements(executor, householdId, now, lock);
  const enrollment = await protectedEnrollment(executor, householdId, personId, lock);
  return (
    enrollment !== null &&
    entitlements.portfolio.contributingGrantIds.includes(
      ids.entitlementGrant(enrollment.entitlement_grant_id),
    )
  );
}

async function loadHouseholdEntitlements(
  executor: SqlExecutor,
  householdId: string,
  now: Date,
  lockSubscriptions = false,
): Promise<HouseholdEntitlements> {
  const commerce = await executor.query<CommerceRow>(
    `SELECT
       s.id AS subscription_id, s.source, s.lifecycle, s.source_verified, s.precedence,
       s.current_period_starts_at, s.current_period_ends_at, s.reconciliation_state,
       CASE WHEN s.source <> 'sponsor' THEN true ELSE EXISTS (
         SELECT 1 FROM entitlement_grants sg
         JOIN commerce_sponsorship_allocations sa
           ON sa.household_id = sg.household_id AND sa.id = sg.sponsorship_id
         JOIN commerce_sponsorships sp ON sp.id = sa.sponsorship_id
         JOIN organizations o ON o.id = sp.organization_id
         WHERE sg.household_id = s.household_id AND sg.subscription_id = s.id
           AND sa.state = 'active' AND sa.source_verified = true
           AND sa.starts_at <= $2 AND (sa.ends_at IS NULL OR sa.ends_at > $2)
           AND sp.state = 'active' AND sp.starts_at <= $2
           AND (sp.ends_at IS NULL OR sp.ends_at > $2)
           AND o.verification_state IN ('local_fixture','verified')
         ) END AS sponsor_backing_verified,
       CASE WHEN s.source = 'sponsor' THEN EXISTS (
         SELECT 1 FROM entitlement_grants lg
         JOIN commerce_sponsorship_allocations la
           ON la.household_id = lg.household_id AND la.id = lg.sponsorship_id
         JOIN commerce_sponsorships ls ON ls.id = la.sponsorship_id
         JOIN organizations lo ON lo.id = ls.organization_id
         WHERE lg.household_id = s.household_id AND lg.subscription_id = s.id
           AND lo.verification_state = 'local_fixture'
       ) ELSE EXISTS (
         SELECT 1 FROM commerce_provider_subscription_records pr
         WHERE pr.household_id = s.household_id AND pr.subscription_id = s.id
           AND pr.environment IN ('local','test') AND pr.verified_at IS NOT NULL
       ) END AS local_backing,
       pv.id AS plan_id, pv.plan_key, pv.version AS plan_version,
       pv.display_name AS plan_display_name, pv.state AS plan_state,
       pv.capabilities AS plan_capabilities, pv.allowances AS plan_allowances,
       pv.prices AS plan_prices, pv.available_from AS plan_available_from,
       pv.available_until AS plan_available_until,
       p.id AS product_id, p.product_key, p.version AS product_version,
       p.display_name AS product_display_name, p.available_from AS product_available_from,
       p.available_until AS product_available_until
     FROM commerce_subscriptions s
     JOIN commerce_plan_versions pv ON pv.id = s.plan_version_id
     JOIN commerce_product_versions p ON p.id = pv.product_version_id
     WHERE s.household_id = $1 ORDER BY s.precedence DESC, s.id${
       lockSubscriptions ? ' FOR UPDATE OF s' : ''
     }`,
    [householdId, now.toISOString()],
  );
  const grantRows = await executor.query<GrantRow>(
    `SELECT household_id, id, source, capabilities, starts_at, ends_at, revoked_at,
            source_verified, precedence, plan_version_id, subscription_id, sponsorship_id
     FROM entitlement_grants WHERE household_id = $1 ORDER BY precedence DESC, id`,
    [householdId],
  );
  const grants = grantRows.rows.map(grantFromRow);
  const usage = await allowanceUsage(executor, householdId);
  const subject = { kind: 'household' as const, householdId: ids.household(householdId) };
  const sources = commerce.rows.map((row) => {
    if (!commerceSubscriptionLifecycles.includes(row.lifecycle)) {
      throw new TypeError('Invalid subscription lifecycle');
    }
    const plan = planFromRow(row);
    const subscription: NormalizedSubscription = {
      id: ids.commerceSubscription(row.subscription_id),
      subject,
      planVersionId: plan.id,
      source: row.source,
      lifecycle: row.lifecycle,
      sourceVerified:
        row.source_verified &&
        row.sponsor_backing_verified &&
        (row.plan_state === 'active' || (row.plan_state === 'hypothesis' && row.local_backing)),
      precedence: row.precedence,
      startsAt: asDate(row.current_period_starts_at, 'subscription.starts_at'),
      ...(row.current_period_ends_at === null
        ? {}
        : {
            accessEndsAt: asDate(row.current_period_ends_at, 'subscription.access_ends_at'),
          }),
    };
    return {
      subscription,
      reconciliationState: row.reconciliation_state,
      plan,
      planState: row.plan_state,
      product: productFromRow(row),
    };
  });
  const portfolio = resolveCommercePortfolio({
    subject,
    contexts: sources.map((source) => ({
      productVersion: source.product,
      planVersion: source.plan,
      subscription: source.subscription,
      grants,
    })),
    allowanceUsage: usage,
    at: now,
  });
  return {
    householdId,
    capabilities: [...portfolio.capabilities],
    grants,
    portfolio,
    sources,
  };
}

export async function allocateCommerceAllowance(
  executor: SqlExecutor,
  input: {
    readonly householdId: string;
    readonly allocationId: string;
    readonly kind: AllowanceKind;
    readonly subjectKind: 'protected_member' | 'trusted_circle_person';
    readonly subjectId: string;
    readonly now: Date;
  },
): Promise<void> {
  const entitlements = await loadHouseholdEntitlements(
    executor,
    input.householdId,
    input.now,
    true,
  );
  const counter = assertPortfolioAllowanceAvailable(entitlements.portfolio, input.kind);
  const source = entitlements.portfolio.sources.find(
    (candidate) => candidate.subscriptionId === counter.sourceSubscriptionId,
  );
  const grantId = source?.contributingGrantIds[0];
  if (grantId === undefined) throw new TypeError('Allowance source grant is unavailable');
  await executor.query(
    `INSERT INTO commerce_allowance_allocations(
       household_id, id, entitlement_grant_id, allowance_key, subject_kind,
       subject_id, state, allocated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,'active',$7)`,
    [
      input.householdId,
      input.allocationId,
      grantId,
      input.kind,
      input.subjectKind,
      input.subjectId,
      input.now.toISOString(),
    ],
  );
}

export async function releaseCommerceAllowance(
  executor: SqlExecutor,
  input: {
    readonly householdId: string;
    readonly kind: AllowanceKind;
    readonly subjectKind: 'protected_member' | 'trusted_circle_person';
    readonly subjectId: string;
    readonly now: Date;
  },
): Promise<void> {
  await executor.query(
    `UPDATE commerce_allowance_allocations SET state = 'released', released_at = $5
     WHERE household_id = $1 AND allowance_key = $2 AND subject_kind = $3
       AND subject_id = $4 AND state = 'active'`,
    [input.householdId, input.kind, input.subjectKind, input.subjectId, input.now.toISOString()],
  );
}

export class EntitlementRepository {
  constructor(
    private readonly database: Database,
    private readonly idFactory: IdFactory = randomIdFactory,
  ) {}

  forHousehold(householdId: string, now: Date): Promise<HouseholdEntitlements> {
    return loadHouseholdEntitlements(this.database, householdId, now);
  }

  allocate(input: {
    readonly householdId: string;
    readonly kind: AllowanceKind;
    readonly subjectKind: 'protected_member' | 'trusted_circle_person';
    readonly subjectId: string;
    readonly now: Date;
  }): Promise<void> {
    return this.database.transaction((transaction) =>
      allocateCommerceAllowance(transaction, {
        ...input,
        allocationId: this.idFactory.next('allocation'),
      }),
    );
  }

  enrollProtectedSelf(input: {
    readonly householdId: string;
    readonly personId: string;
    readonly actorPersonId: string;
    readonly consentVersion: string;
    readonly now: Date;
  }): Promise<ProtectedMemberEnrollment> {
    if (input.actorPersonId !== input.personId) {
      throw new DomainError('not_authorized', 'Protected enrollment requires self-consent');
    }
    return this.database.transaction(async (transaction) => {
      const membership = await transaction.query<Record<string, unknown>>(
        `SELECT 1 FROM household_memberships
         WHERE household_id = $1 AND person_id = $2 AND status = 'active' FOR UPDATE`,
        [input.householdId, input.personId],
      );
      if (membership.rows.length !== 1) {
        throw new DomainError('not_authorized', 'An active household membership is required');
      }
      const current = await protectedEnrollment(
        transaction,
        input.householdId,
        input.personId,
        true,
      );
      if (current !== null) {
        const effective = await hasEffectiveProtectedEnrollment(
          transaction,
          input.householdId,
          input.personId,
          input.now,
          true,
        );
        if (effective) {
          return {
            householdId: input.householdId,
            personId: input.personId,
            status: 'accepted',
            consentVersion: current.consent_version,
            allowanceAllocationId: current.allowance_allocation_id,
          };
        }
        throw new DomainError('conflict', 'The existing protected enrollment is not effective');
      }
      const allocationId = this.idFactory.next('allocation');
      await allocateCommerceAllowance(transaction, {
        householdId: input.householdId,
        allocationId,
        kind: 'protected_members',
        subjectKind: 'protected_member',
        subjectId: input.personId,
        now: input.now,
      });
      await transaction.query(
        `INSERT INTO protected_members(
           household_id, person_id, status, consented_by_person_id, consent_version,
           allowance_allocation_id, accepted_at, created_at, updated_at
         ) VALUES ($1,$2,'accepted',$2,$3,$4,$5,$5,$5)
         ON CONFLICT (household_id, person_id) DO UPDATE SET
           status = 'accepted', consented_by_person_id = EXCLUDED.consented_by_person_id,
           consent_version = EXCLUDED.consent_version,
           allowance_allocation_id = EXCLUDED.allowance_allocation_id,
           accepted_at = EXCLUDED.accepted_at, deferred_at = NULL, revoked_at = NULL,
           updated_at = EXCLUDED.updated_at`,
        [
          input.householdId,
          input.personId,
          input.consentVersion,
          allocationId,
          input.now.toISOString(),
        ],
      );
      return {
        householdId: input.householdId,
        personId: input.personId,
        status: 'accepted',
        consentVersion: input.consentVersion,
        allowanceAllocationId: allocationId,
      };
    });
  }

  revokeProtectedSelf(input: {
    readonly householdId: string;
    readonly personId: string;
    readonly actorPersonId: string;
    readonly now: Date;
  }): Promise<boolean> {
    if (input.actorPersonId !== input.personId) {
      throw new DomainError('not_authorized', 'Only the protected member may withdraw consent');
    }
    return this.database.transaction(async (transaction) => {
      const current = await protectedEnrollment(
        transaction,
        input.householdId,
        input.personId,
        true,
      );
      if (current === null) return false;
      await transaction.query(
        `UPDATE protected_members
         SET status = 'revoked', revoked_at = $3, updated_at = $3
         WHERE household_id = $1 AND person_id = $2 AND status = 'accepted'`,
        [input.householdId, input.personId, input.now.toISOString()],
      );
      await releaseCommerceAllowance(transaction, {
        householdId: input.householdId,
        kind: 'protected_members',
        subjectKind: 'protected_member',
        subjectId: input.personId,
        now: input.now,
      });
      return true;
    });
  }
}

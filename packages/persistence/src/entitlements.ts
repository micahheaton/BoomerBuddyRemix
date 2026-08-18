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
import { appendConsentEvidence, identityEvidenceForPerson } from './consent';
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
  readonly consent_id: string;
  readonly latest_consent_evidence_id: string;
}

interface AllowanceAllocationRow extends Record<string, unknown> {
  readonly id: string;
  readonly entitlement_grant_id: string;
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

export interface ActiveBillingAuthority {
  readonly authorityReference: string;
  readonly householdId: string;
  readonly personId: string;
  readonly isPayer: boolean;
}

export interface ActivePayerFact {
  readonly payerReference: string;
  readonly householdId: string;
  readonly personId: string;
  readonly source: 'legacy_subscription' | 'local' | 'provider' | 'support';
}

function authorityReference(
  kind: 'billing-authority' | 'payer',
  householdId: string,
  personId: string,
) {
  return `${kind}:${encodeURIComponent(householdId)}:${encodeURIComponent(personId)}`;
}

export async function resolveActiveBillingAuthority(
  executor: SqlExecutor,
  householdId: string,
  personId: string,
): Promise<ActiveBillingAuthority | null> {
  const result = await executor.query<
    { household_id: string; person_id: string; is_payer: boolean } & Record<string, unknown>
  >(
    `SELECT authority.household_id, authority.person_id,
            EXISTS (
              SELECT 1 FROM household_payers payer
              WHERE payer.household_id = authority.household_id
                AND payer.person_id = authority.person_id AND payer.status = 'active'
            ) AS is_payer
     FROM household_billing_authorities authority
     JOIN household_memberships membership
       ON membership.household_id = authority.household_id
      AND membership.person_id = authority.person_id AND membership.status = 'active'
     WHERE authority.household_id = $1 AND authority.person_id = $2
       AND authority.status = 'active'`,
    [householdId, personId],
  );
  const row = result.rows[0];
  return row === undefined
    ? null
    : {
        authorityReference: authorityReference(
          'billing-authority',
          row.household_id,
          row.person_id,
        ),
        householdId: row.household_id,
        personId: row.person_id,
        isPayer: row.is_payer,
      };
}

export async function resolveActivePayerFact(
  executor: SqlExecutor,
  householdId: string,
  personId: string,
): Promise<ActivePayerFact | null> {
  const result = await executor.query<
    { household_id: string; person_id: string; source: ActivePayerFact['source'] } & Record<
      string,
      unknown
    >
  >(
    `SELECT household_id, person_id, source FROM household_payers
     WHERE household_id = $1 AND person_id = $2 AND status = 'active'`,
    [householdId, personId],
  );
  const row = result.rows[0];
  return row === undefined
    ? null
    : {
        payerReference: authorityReference('payer', row.household_id, row.person_id),
        householdId: row.household_id,
        personId: row.person_id,
        source: row.source,
      };
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
  contributingGrantIds: readonly string[],
): Promise<readonly AllowanceUsageInput[]> {
  if (contributingGrantIds.length === 0) {
    return allowanceKinds.map((kind) => ({ kind, count: 0 }));
  }
  const result = await executor.query<UsageRow>(
    `WITH contributing_grants AS (
       SELECT jsonb_array_elements_text($2::jsonb) AS id
     )
     SELECT
       (SELECT count(DISTINCT p.person_id)::int
        FROM protected_members p
        JOIN household_memberships m
          ON m.household_id = p.household_id AND m.person_id = p.person_id
        JOIN commerce_allowance_allocations a
          ON a.household_id = p.household_id AND a.id = p.allowance_allocation_id
        WHERE p.household_id = $1 AND p.status = 'accepted' AND m.status = 'active'
          AND a.state = 'active' AND a.allowance_key = 'protected_members'
          AND a.subject_kind = 'protected_member' AND a.subject_id = p.person_id
          AND a.entitlement_grant_id IN (SELECT id FROM contributing_grants)
       ) AS protected_members,
       (SELECT count(DISTINCT a.subject_id)::int
        FROM commerce_allowance_allocations a
        JOIN household_memberships m
          ON m.household_id = a.household_id AND m.person_id = a.subject_id
        WHERE a.household_id = $1 AND a.state = 'active' AND m.status = 'active'
          AND a.allowance_key = 'trusted_circle_participants'
          AND a.subject_kind = 'trusted_circle_person'
          AND a.entitlement_grant_id IN (SELECT id FROM contributing_grants)
       ) AS trusted_circle_participants`,
    [householdId, JSON.stringify(contributingGrantIds)],
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
    `SELECT p.allowance_allocation_id, a.entitlement_grant_id, p.consent_version,
            p.consent_id, p.latest_consent_evidence_id
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

async function protectedConsentForWithdrawal(
  executor: SqlExecutor,
  householdId: string,
  personId: string,
): Promise<Pick<ProtectedEnrollmentRow, 'consent_id' | 'latest_consent_evidence_id'> | null> {
  const result = await executor.query<
    Pick<ProtectedEnrollmentRow, 'consent_id' | 'latest_consent_evidence_id'> &
      Record<string, unknown>
  >(
    `SELECT consent_id, latest_consent_evidence_id
     FROM protected_members
     WHERE household_id = $1 AND person_id = $2 AND status = 'accepted'
     FOR UPDATE`,
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
  runtimeEnvironment: EntitlementRuntimeEnvironment = 'local',
): Promise<boolean> {
  const entitlements = await loadHouseholdEntitlements(
    executor,
    householdId,
    now,
    lock,
    runtimeEnvironment,
  );
  const enrollment = await protectedEnrollment(executor, householdId, personId, lock);
  return (
    enrollment !== null &&
    entitlements.portfolio.contributingGrantIds.includes(
      ids.entitlementGrant(enrollment.entitlement_grant_id),
    )
  );
}

export type EntitlementRuntimeEnvironment = 'local' | 'production';

async function loadHouseholdEntitlements(
  executor: SqlExecutor,
  householdId: string,
  now: Date,
  lockSubscriptions = false,
  runtimeEnvironment: EntitlementRuntimeEnvironment = 'local',
): Promise<HouseholdEntitlements> {
  const commerce = await executor.query<CommerceRow>(
    `SELECT
       s.id AS subscription_id, s.source, s.lifecycle, s.source_verified, s.precedence,
       s.current_period_starts_at, s.current_period_ends_at, s.reconciliation_state,
       CASE
         WHEN EXISTS (
           SELECT 1 FROM founding_household_enrollments f
           WHERE f.household_id = s.household_id AND f.subscription_id = s.id
         ) THEN EXISTS (
           SELECT 1
           FROM founding_household_enrollments f
           JOIN founding_household_sponsor_backings fb
             ON fb.cohort_key = f.cohort_key AND fb.environment = f.environment
            AND fb.benefit_key = f.benefit_key AND fb.sponsorship_id = f.sponsorship_id
            AND fb.plan_version_id = f.plan_version_id
           JOIN commerce_sponsorships sp
             ON sp.id = f.sponsorship_id AND sp.organization_id = fb.organization_id
            AND sp.plan_version_id = f.plan_version_id
           JOIN organizations o ON o.id = fb.organization_id
           JOIN commerce_plan_versions fpv ON fpv.id = f.plan_version_id
           JOIN commerce_sponsorship_allocations sa
             ON sa.household_id = f.household_id AND sa.id = f.sponsorship_allocation_id
            AND sa.sponsorship_id = f.sponsorship_id AND sa.plan_version_id = f.plan_version_id
           JOIN entitlement_grants sg
             ON sg.household_id = f.household_id AND sg.id = f.entitlement_grant_id
            AND sg.subscription_id = f.subscription_id
            AND sg.sponsorship_id = f.sponsorship_allocation_id
            AND sg.plan_version_id = f.plan_version_id
           JOIN consent_current_projections service_consent
             ON service_consent.household_id = f.household_id
            AND service_consent.consent_id = f.service_consent_id
           JOIN consent_evidence service_evidence
             ON service_evidence.household_id = service_consent.household_id
            AND service_evidence.consent_id = service_consent.consent_id
            AND service_evidence.id = service_consent.latest_evidence_id
           WHERE f.household_id = s.household_id AND f.subscription_id = s.id
             AND f.environment = $3 AND f.state = 'active' AND f.revoked_at IS NULL
             AND f.starts_at <= $2 AND f.ends_at > $2
             AND fb.evidence_tier = CASE
               WHEN $3 = 'production' THEN 'live_production'
               ELSE 'local_simulation'
             END
             AND sp.state = 'active' AND sp.starts_at <= $2
             AND (sp.ends_at IS NULL OR sp.ends_at > $2)
             AND (sp.ends_at IS NULL OR sp.ends_at >= f.ends_at)
             AND o.kind = 'sponsor'
             AND o.verification_state = CASE
               WHEN $3 = 'production' THEN 'verified'
               ELSE 'local_fixture'
             END
              AND fpv.state = 'active'
              AND s.payer_person_id IS NULL AND s.source = 'sponsor'
              AND s.source_verified = true
             AND s.lifecycle = 'active'
             AND s.reconciliation_state = 'not_required'
             AND s.plan_version_id = f.plan_version_id
             AND s.current_period_starts_at = f.starts_at
             AND s.current_period_ends_at = f.ends_at
             AND s.ended_at IS NULL
             AND sa.state = 'active' AND sa.source_verified = true
             AND sa.starts_at = f.starts_at AND sa.ends_at = f.ends_at
             AND sg.source = 'sponsor' AND sg.source_verified = true
             AND sg.starts_at = f.starts_at AND sg.ends_at = f.ends_at
             AND sg.revoked_at IS NULL AND sg.capabilities = fpv.capabilities
             AND service_consent.state = 'active'
             AND service_consent.purpose = 'founding_household_service_beta'
             AND service_consent.actor_person_id = f.accepted_by_person_id
             AND service_consent.subject_person_id = f.accepted_by_person_id
             AND service_consent.effective_at = f.starts_at
             AND service_consent.expires_at = f.ends_at
             AND service_consent.updated_at = f.starts_at
             AND service_consent.scope @> jsonb_build_object(
               'benefitKey', f.benefit_key,
               'cohortKey', f.cohort_key,
               'followUpConsent', false,
               'marketingConsent', false,
               'researchConsent', false
             )
             AND service_evidence.action = 'accept'
             AND service_evidence.effective_at = f.starts_at
             AND service_evidence.expires_at = f.ends_at
             AND service_evidence.recorded_at = f.starts_at
             AND service_evidence.session_id = f.accepted_session_id
             AND service_evidence.supersedes_evidence_id IS NULL
              AND service_evidence.scope = service_consent.scope
          )
         WHEN s.source <> 'sponsor' THEN true
         ELSE EXISTS (
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
         )
       END AS sponsor_backing_verified,
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
     WHERE s.household_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM founding_household_enrollments founding
         WHERE founding.household_id = s.household_id
           AND founding.subscription_id = s.id
           AND founding.environment <> $3
       )
     ORDER BY s.precedence DESC, s.id${lockSubscriptions ? ' FOR UPDATE OF s' : ''}`,
    [householdId, now.toISOString(), runtimeEnvironment],
  );
  const grantRows = await executor.query<GrantRow>(
    `SELECT grant_record.household_id, grant_record.id, grant_record.source,
            grant_record.capabilities, grant_record.starts_at, grant_record.ends_at,
            grant_record.revoked_at, grant_record.source_verified, grant_record.precedence,
            grant_record.plan_version_id, grant_record.subscription_id,
            grant_record.sponsorship_id
      FROM entitlement_grants grant_record
      WHERE grant_record.household_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM founding_household_enrollments founding
          WHERE founding.household_id = grant_record.household_id
            AND (
              founding.entitlement_grant_id = grant_record.id
              OR founding.subscription_id = grant_record.subscription_id
            )
            AND founding.environment <> $2
        )
        AND (
          NOT EXISTS (
            SELECT 1 FROM founding_household_enrollments founding
            WHERE founding.household_id = grant_record.household_id
              AND (
                founding.entitlement_grant_id = grant_record.id
                OR founding.subscription_id = grant_record.subscription_id
              )
          )
          OR EXISTS (
            SELECT 1
            FROM founding_household_enrollments founding
            JOIN founding_household_sponsor_backings backing
              ON backing.cohort_key = founding.cohort_key
             AND backing.environment = founding.environment
             AND backing.benefit_key = founding.benefit_key
             AND backing.sponsorship_id = founding.sponsorship_id
             AND backing.plan_version_id = founding.plan_version_id
            JOIN commerce_sponsorships sponsorship
              ON sponsorship.id = founding.sponsorship_id
             AND sponsorship.organization_id = backing.organization_id
             AND sponsorship.plan_version_id = founding.plan_version_id
            JOIN organizations organization ON organization.id = backing.organization_id
            JOIN commerce_plan_versions plan ON plan.id = founding.plan_version_id
            JOIN commerce_subscriptions subscription
              ON subscription.household_id = founding.household_id
             AND subscription.id = founding.subscription_id
            JOIN commerce_sponsorship_allocations allocation
              ON allocation.household_id = founding.household_id
             AND allocation.id = founding.sponsorship_allocation_id
             AND allocation.sponsorship_id = founding.sponsorship_id
             AND allocation.plan_version_id = founding.plan_version_id
            JOIN consent_current_projections service_consent
              ON service_consent.household_id = founding.household_id
             AND service_consent.consent_id = founding.service_consent_id
            JOIN consent_evidence service_evidence
              ON service_evidence.household_id = service_consent.household_id
             AND service_evidence.consent_id = service_consent.consent_id
             AND service_evidence.id = service_consent.latest_evidence_id
            WHERE founding.household_id = grant_record.household_id
              AND founding.entitlement_grant_id = grant_record.id
              AND founding.environment = $2
              AND founding.state = 'active' AND founding.revoked_at IS NULL
              AND founding.starts_at <= $3 AND founding.ends_at > $3
              AND backing.evidence_tier = CASE
                WHEN $2 = 'production' THEN 'live_production'
                ELSE 'local_simulation'
              END
              AND sponsorship.state = 'active' AND sponsorship.starts_at <= $3
              AND (sponsorship.ends_at IS NULL OR sponsorship.ends_at > $3)
              AND (sponsorship.ends_at IS NULL OR sponsorship.ends_at >= founding.ends_at)
              AND organization.kind = 'sponsor'
              AND organization.verification_state = CASE
                WHEN $2 = 'production' THEN 'verified'
                ELSE 'local_fixture'
              END
              AND plan.state = 'active'
              AND subscription.payer_person_id IS NULL
              AND subscription.source = 'sponsor'
              AND subscription.source_verified = true
              AND subscription.lifecycle = 'active'
              AND subscription.reconciliation_state = 'not_required'
              AND subscription.plan_version_id = founding.plan_version_id
              AND subscription.current_period_starts_at = founding.starts_at
              AND subscription.current_period_ends_at = founding.ends_at
              AND subscription.ended_at IS NULL
              AND allocation.state = 'active' AND allocation.source_verified = true
              AND allocation.starts_at = founding.starts_at
              AND allocation.ends_at = founding.ends_at
              AND grant_record.source = 'sponsor' AND grant_record.source_verified = true
              AND grant_record.subscription_id = founding.subscription_id
              AND grant_record.sponsorship_id = founding.sponsorship_allocation_id
              AND grant_record.plan_version_id = founding.plan_version_id
              AND grant_record.starts_at = founding.starts_at
              AND grant_record.ends_at = founding.ends_at
              AND grant_record.revoked_at IS NULL
              AND grant_record.capabilities = plan.capabilities
              AND service_consent.state = 'active'
              AND service_consent.purpose = 'founding_household_service_beta'
              AND service_consent.actor_person_id = founding.accepted_by_person_id
              AND service_consent.subject_person_id = founding.accepted_by_person_id
              AND service_consent.effective_at = founding.starts_at
              AND service_consent.expires_at = founding.ends_at
              AND service_consent.updated_at = founding.starts_at
              AND service_consent.scope @> jsonb_build_object(
                'benefitKey', founding.benefit_key,
                'cohortKey', founding.cohort_key,
                'followUpConsent', false,
                'marketingConsent', false,
                'researchConsent', false
              )
              AND service_evidence.action = 'accept'
              AND service_evidence.effective_at = founding.starts_at
              AND service_evidence.expires_at = founding.ends_at
              AND service_evidence.recorded_at = founding.starts_at
              AND service_evidence.session_id = founding.accepted_session_id
              AND service_evidence.supersedes_evidence_id IS NULL
              AND service_evidence.scope = service_consent.scope
          )
        )
      ORDER BY grant_record.precedence DESC, grant_record.id${
        lockSubscriptions ? ' FOR UPDATE OF grant_record' : ''
      }`,
    [householdId, runtimeEnvironment, now.toISOString()],
  );
  const grants = grantRows.rows.map(grantFromRow);
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
  const contexts = sources.map((source) => ({
    productVersion: source.product,
    planVersion: source.plan,
    subscription: source.subscription,
    grants,
  }));
  const preliminaryPortfolio = resolveCommercePortfolio({
    subject,
    contexts,
    allowanceUsage: allowanceKinds.map((kind) => ({ kind, count: 0 })),
    at: now,
  });
  const usage = await allowanceUsage(
    executor,
    householdId,
    preliminaryPortfolio.contributingGrantIds,
  );
  const portfolio = resolveCommercePortfolio({
    subject,
    contexts,
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

function availableAllowanceGrantId(
  entitlements: HouseholdEntitlements,
  kind: AllowanceKind,
): string {
  const counter = assertPortfolioAllowanceAvailable(entitlements.portfolio, kind);
  const source = entitlements.portfolio.sources.find(
    (candidate) => candidate.subscriptionId === counter.sourceSubscriptionId,
  );
  const grantId = source?.contributingGrantIds[0];
  if (grantId === undefined) throw new TypeError('Allowance source grant is unavailable');
  return grantId;
}

export async function rebindCommerceAllowanceToEffectiveGrant(
  executor: SqlExecutor,
  input: {
    readonly householdId: string;
    readonly kind: AllowanceKind;
    readonly subjectKind: 'protected_member' | 'trusted_circle_person';
    readonly subjectId: string;
    readonly now: Date;
    readonly runtimeEnvironment?: EntitlementRuntimeEnvironment;
  },
): Promise<'not_found' | 'already_effective' | 'rebound'> {
  const entitlements = await loadHouseholdEntitlements(
    executor,
    input.householdId,
    input.now,
    true,
    input.runtimeEnvironment ?? 'local',
  );
  const allocationResult = await executor.query<AllowanceAllocationRow>(
    `SELECT id, entitlement_grant_id
     FROM commerce_allowance_allocations
     WHERE household_id = $1 AND allowance_key = $2 AND subject_kind = $3
       AND subject_id = $4 AND state = 'active'
     FOR UPDATE`,
    [input.householdId, input.kind, input.subjectKind, input.subjectId],
  );
  const allocation = allocationResult.rows[0];
  if (allocation === undefined) return 'not_found';
  if (
    entitlements.portfolio.contributingGrantIds.includes(
      ids.entitlementGrant(allocation.entitlement_grant_id),
    )
  ) {
    return 'already_effective';
  }
  const replacementGrantId = availableAllowanceGrantId(entitlements, input.kind);
  const rebound = await executor.query(
    `UPDATE commerce_allowance_allocations
     SET entitlement_grant_id = $3
     WHERE household_id = $1 AND id = $2 AND state = 'active'
       AND allowance_key = $4 AND subject_kind = $5 AND subject_id = $6`,
    [
      input.householdId,
      allocation.id,
      replacementGrantId,
      input.kind,
      input.subjectKind,
      input.subjectId,
    ],
  );
  if (rebound.rowCount !== 1) {
    throw new DomainError('conflict', 'The commerce allowance could not be rebound');
  }
  return 'rebound';
}

export async function reconcileTrustedCircleAllowanceBindings(
  executor: SqlExecutor,
  input: {
    readonly householdId: string;
    readonly now: Date;
    readonly runtimeEnvironment?: EntitlementRuntimeEnvironment;
    readonly onlyFromGrantId?: string;
  },
): Promise<{ readonly rebound: number }> {
  const entitlements = await loadHouseholdEntitlements(
    executor,
    input.householdId,
    input.now,
    true,
    input.runtimeEnvironment ?? 'local',
  );
  const counter = entitlements.portfolio.allowances.find(
    (allowance) => allowance.kind === 'trusted_circle_participants',
  );
  if (counter === undefined || counter.state !== 'available' || counter.remaining === 0) {
    return { rebound: 0 };
  }
  const replacementGrantId = availableAllowanceGrantId(entitlements, 'trusted_circle_participants');
  const allocations = await executor.query<AllowanceAllocationRow>(
    `SELECT allocation.id, allocation.entitlement_grant_id
     FROM commerce_allowance_allocations allocation
     JOIN household_memberships membership
       ON membership.household_id = allocation.household_id
      AND membership.person_id = allocation.subject_id AND membership.status = 'active'
     WHERE allocation.household_id = $1 AND allocation.state = 'active'
       AND allocation.allowance_key = 'trusted_circle_participants'
       AND allocation.subject_kind = 'trusted_circle_person'
       AND EXISTS (
         SELECT 1 FROM trusted_circle_relationships relationship
         JOIN consent_current_projections consent
           ON consent.household_id = relationship.household_id
          AND consent.consent_id = relationship.consent_id
          AND consent.latest_evidence_id = relationship.latest_consent_evidence_id
          AND consent.state = 'active'
         WHERE relationship.household_id = allocation.household_id
           AND relationship.trusted_person_id = allocation.subject_id
           AND relationship.state = 'active'
       )
     ORDER BY allocation.allocated_at, allocation.id
     FOR UPDATE OF allocation`,
    [input.householdId],
  );
  const contributingGrantIds = new Set<string>(entitlements.portfolio.contributingGrantIds);
  const stale = allocations.rows
    .filter(
      (allocation) =>
        !contributingGrantIds.has(allocation.entitlement_grant_id) &&
        (input.onlyFromGrantId === undefined ||
          allocation.entitlement_grant_id === input.onlyFromGrantId),
    )
    .slice(0, counter.remaining);
  for (const allocation of stale) {
    const rebound = await executor.query(
      `UPDATE commerce_allowance_allocations
       SET entitlement_grant_id = $3
       WHERE household_id = $1 AND id = $2 AND state = 'active'
         AND allowance_key = 'trusted_circle_participants'
         AND subject_kind = 'trusted_circle_person'`,
      [input.householdId, allocation.id, replacementGrantId],
    );
    if (rebound.rowCount !== 1) {
      throw new DomainError('conflict', 'Trusted Circle allowance reconciliation failed');
    }
  }
  return { rebound: stale.length };
}

export async function reconcileProtectedMemberAllowanceBindings(
  executor: SqlExecutor,
  input: {
    readonly householdId: string;
    readonly now: Date;
    readonly runtimeEnvironment?: EntitlementRuntimeEnvironment;
    readonly allowPartialRebinding?: boolean;
    readonly onlyFromGrantId?: string;
  },
): Promise<{ readonly rebound: number }> {
  const entitlements = await loadHouseholdEntitlements(
    executor,
    input.householdId,
    input.now,
    true,
    input.runtimeEnvironment ?? 'local',
  );
  const counter = entitlements.portfolio.allowances.find(
    (allowance) => allowance.kind === 'protected_members',
  );
  if (counter === undefined || counter.state !== 'available' || counter.remaining === 0) {
    return { rebound: 0 };
  }
  const allocations = await executor.query<AllowanceAllocationRow>(
    `SELECT allocation.id, allocation.entitlement_grant_id
     FROM commerce_allowance_allocations allocation
     JOIN protected_members protected
       ON protected.household_id = allocation.household_id
      AND protected.person_id = allocation.subject_id
      AND protected.allowance_allocation_id = allocation.id
      AND protected.status = 'accepted'
     JOIN household_memberships membership
       ON membership.household_id = protected.household_id
      AND membership.person_id = protected.person_id AND membership.status = 'active'
     JOIN consent_current_projections consent
       ON consent.household_id = protected.household_id
      AND consent.consent_id = protected.consent_id
      AND consent.latest_evidence_id = protected.latest_consent_evidence_id
      AND consent.state = 'active'
     WHERE allocation.household_id = $1 AND allocation.state = 'active'
       AND allocation.allowance_key = 'protected_members'
       AND allocation.subject_kind = 'protected_member'
     ORDER BY allocation.allocated_at, allocation.id
     FOR UPDATE OF allocation`,
    [input.householdId],
  );
  const contributingGrantIds = new Set<string>(entitlements.portfolio.contributingGrantIds);
  const stale = allocations.rows.filter(
    (allocation) =>
      !contributingGrantIds.has(allocation.entitlement_grant_id) &&
      (input.onlyFromGrantId === undefined ||
        allocation.entitlement_grant_id === input.onlyFromGrantId),
  );
  if (stale.length === 0 || (!input.allowPartialRebinding && stale.length > counter.remaining)) {
    return { rebound: 0 };
  }
  const eligible = input.allowPartialRebinding ? stale.slice(0, counter.remaining) : stale;
  const replacementGrantId = availableAllowanceGrantId(entitlements, 'protected_members');
  for (const allocation of eligible) {
    const rebound = await executor.query(
      `UPDATE commerce_allowance_allocations
       SET entitlement_grant_id = $3
       WHERE household_id = $1 AND id = $2 AND state = 'active'
         AND allowance_key = 'protected_members' AND subject_kind = 'protected_member'`,
      [input.householdId, allocation.id, replacementGrantId],
    );
    if (rebound.rowCount !== 1) {
      throw new DomainError('conflict', 'Protected-member allowance reconciliation failed');
    }
  }
  return { rebound: eligible.length };
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
    readonly runtimeEnvironment?: EntitlementRuntimeEnvironment;
  },
): Promise<void> {
  const entitlements = await loadHouseholdEntitlements(
    executor,
    input.householdId,
    input.now,
    true,
    input.runtimeEnvironment ?? 'local',
  );
  const grantId = availableAllowanceGrantId(entitlements, input.kind);
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
    private readonly runtimeEnvironment: EntitlementRuntimeEnvironment = 'production',
  ) {}

  forHousehold(householdId: string, now: Date): Promise<HouseholdEntitlements> {
    return loadHouseholdEntitlements(
      this.database,
      householdId,
      now,
      false,
      this.runtimeEnvironment,
    );
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
        runtimeEnvironment: this.runtimeEnvironment,
      }),
    );
  }

  enrollProtectedSelf(input: {
    readonly householdId: string;
    readonly personId: string;
    readonly actorPersonId: string;
    readonly consentVersion: string;
    readonly actorIssuer?: string;
    readonly sessionId?: string;
    readonly correlationId?: string;
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
      await loadHouseholdEntitlements(
        transaction,
        input.householdId,
        input.now,
        true,
        this.runtimeEnvironment,
      );
      const current = await protectedEnrollment(
        transaction,
        input.householdId,
        input.personId,
        true,
      );
      if (current !== null) {
        await rebindCommerceAllowanceToEffectiveGrant(transaction, {
          householdId: input.householdId,
          kind: 'protected_members',
          subjectKind: 'protected_member',
          subjectId: input.personId,
          now: input.now,
          runtimeEnvironment: this.runtimeEnvironment,
        });
        return {
          householdId: input.householdId,
          personId: input.personId,
          status: 'accepted',
          consentVersion: current.consent_version,
          allowanceAllocationId: current.allowance_allocation_id,
        };
      }
      const allocationId = this.idFactory.next('allocation');
      const consentId = this.idFactory.next('consent');
      await allocateCommerceAllowance(transaction, {
        householdId: input.householdId,
        allocationId,
        kind: 'protected_members',
        subjectKind: 'protected_member',
        subjectId: input.personId,
        now: input.now,
        runtimeEnvironment: this.runtimeEnvironment,
      });
      const actorIdentity = await identityEvidenceForPerson(
        transaction,
        input.actorPersonId,
        input.actorIssuer,
      );
      if (actorIdentity === null) {
        throw new DomainError('not_authenticated', 'An active identity is required');
      }
      await transaction.query(
        `INSERT INTO consents(
           household_id, id, protected_person_id, granted_by_person_id, purpose,
           consent_version, state, granted_at
         ) VALUES ($1,$2,$3,$3,'protected_enrollment',$4,'active',$5)`,
        [
          input.householdId,
          consentId,
          input.personId,
          input.consentVersion,
          input.now.toISOString(),
        ],
      );
      const consentEvidenceId = await appendConsentEvidence(transaction, this.idFactory, {
        householdId: input.householdId,
        consentId,
        actorPersonId: input.actorPersonId,
        subjectPersonId: input.personId,
        purpose: 'protected_enrollment',
        scope: { protectedEnrollment: true },
        action: 'accept',
        sourceInteraction: 'protected_enrollment_accept',
        actorIdentity,
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        effectiveAt: input.now,
      });
      await transaction.query(
        `INSERT INTO protected_members(
           household_id, person_id, status, consented_by_person_id, consent_version,
           allowance_allocation_id, accepted_at, created_at, updated_at,
           consent_id, latest_consent_evidence_id
         ) VALUES ($1,$2,'accepted',$2,$3,$4,$5,$5,$5,$6,$7)
         ON CONFLICT (household_id, person_id) DO UPDATE SET
           status = 'accepted', consented_by_person_id = EXCLUDED.consented_by_person_id,
           consent_version = EXCLUDED.consent_version,
           allowance_allocation_id = EXCLUDED.allowance_allocation_id,
            accepted_at = EXCLUDED.accepted_at, deferred_at = NULL, revoked_at = NULL,
            consent_id = EXCLUDED.consent_id,
            latest_consent_evidence_id = EXCLUDED.latest_consent_evidence_id,
            updated_at = EXCLUDED.updated_at`,
        [
          input.householdId,
          input.personId,
          input.consentVersion,
          allocationId,
          input.now.toISOString(),
          consentId,
          consentEvidenceId,
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
    readonly actorIssuer?: string;
    readonly sessionId?: string;
    readonly correlationId?: string;
    readonly now: Date;
  }): Promise<boolean> {
    if (input.actorPersonId !== input.personId) {
      throw new DomainError('not_authorized', 'Only the protected member may withdraw consent');
    }
    return this.database.transaction(async (transaction) => {
      const current = await protectedConsentForWithdrawal(
        transaction,
        input.householdId,
        input.personId,
      );
      if (current === null) return false;
      const actorIdentity = await identityEvidenceForPerson(
        transaction,
        input.actorPersonId,
        input.actorIssuer,
      );
      if (actorIdentity === null) {
        throw new DomainError('not_authenticated', 'An active identity is required');
      }
      const consentEvidenceId = await appendConsentEvidence(transaction, this.idFactory, {
        householdId: input.householdId,
        consentId: current.consent_id,
        actorPersonId: input.actorPersonId,
        subjectPersonId: input.personId,
        purpose: 'protected_enrollment',
        scope: { protectedEnrollment: true },
        action: 'withdraw',
        sourceInteraction: 'protected_enrollment_withdraw',
        actorIdentity,
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        effectiveAt: input.now,
      });
      await transaction.query(
        `UPDATE protected_members
         SET status = 'revoked', revoked_at = $3, updated_at = $3,
             latest_consent_evidence_id = $4
         WHERE household_id = $1 AND person_id = $2 AND status = 'accepted'`,
        [input.householdId, input.personId, input.now.toISOString(), consentEvidenceId],
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

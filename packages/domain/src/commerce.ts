import { DomainError } from './errors';
import {
  entitlementSources,
  isGrantEffective,
  isSameEntitlementSubject,
  resolveEffectiveEntitlements,
  type EntitlementGrant,
  type EntitlementSource,
  type EntitlementSubject,
} from './entitlements';
import {
  ids,
  type CommercePlanVersionId,
  type CommerceProductVersionId,
  type CommerceSubscriptionId,
  type EntitlementGrantId,
} from './identifiers';
import { capabilities as canonicalCapabilities, type Capability } from './model';

export const commercePlanKeys = ['free', 'plus', 'family'] as const;
export type CommercePlanKey = (typeof commercePlanKeys)[number];

export const commerceSubscriptionLifecycles = [
  'pending',
  'trialing',
  'active',
  'grace',
  'delinquent',
  'paused',
  'hold',
  'cancel_at_period_end',
  'canceled',
  'expired',
  'refunded',
  'disputed',
  'restored',
] as const;
export type CommerceSubscriptionLifecycle = (typeof commerceSubscriptionLifecycles)[number];

export const allowanceKinds = ['protected_members', 'trusted_circle_participants'] as const;
export type AllowanceKind = (typeof allowanceKinds)[number];

export const billingIntervals = ['month', 'year'] as const;
export type BillingInterval = (typeof billingIntervals)[number];

// Keep the legacy kind readable for historical catalog and migration evidence. Active offer
// hypotheses live in revenue-hypotheses.ts and never emit the retired founding experiment.
export const priceHypothesisKinds = ['list', 'founding_experiment'] as const;
export type PriceHypothesisKind = (typeof priceHypothesisKinds)[number];

export interface CommerceProductVersion {
  readonly id: CommerceProductVersionId;
  readonly key: 'consumer_household';
  readonly version: number;
  readonly displayName: string;
  readonly availableFrom: string;
  readonly availableUntil?: string;
}

export interface CommercePriceHypothesis {
  readonly interval: BillingInterval;
  readonly amountMinor: number;
  readonly currency: 'USD';
  readonly kind: PriceHypothesisKind;
}

export interface CommerceAllowance {
  readonly kind: AllowanceKind;
  readonly limit: number;
}

export interface CommercePlanVersion {
  readonly id: CommercePlanVersionId;
  readonly productVersionId: CommerceProductVersionId;
  readonly key: CommercePlanKey;
  readonly version: number;
  readonly displayName: string;
  readonly availableFrom: string;
  readonly availableUntil?: string;
  readonly capabilities: readonly Capability[];
  readonly allowances: readonly CommerceAllowance[];
  readonly prices: readonly CommercePriceHypothesis[];
}

export interface NormalizedSubscription {
  readonly id: CommerceSubscriptionId;
  readonly subject: EntitlementSubject;
  readonly planVersionId: CommercePlanVersionId;
  readonly source: EntitlementSource;
  readonly lifecycle: CommerceSubscriptionLifecycle;
  readonly sourceVerified: boolean;
  readonly precedence: number;
  readonly startsAt: Date;
  readonly accessEndsAt?: Date;
}

export interface AllowanceUsageInput {
  readonly kind: AllowanceKind;
  readonly count: number;
}

export const commerceAccessStates = [
  'effective',
  'invalid_linkage',
  'unverified_source',
  'not_started',
  'expired',
  'inactive_lifecycle',
  'no_effective_grant',
] as const;
export type CommerceAccessState = (typeof commerceAccessStates)[number];

export const allowanceCounterStates = [
  'available',
  'exhausted',
  'usage_unknown',
  'entitlement_inactive',
] as const;
export type AllowanceCounterState = (typeof allowanceCounterStates)[number];

export interface EffectiveAllowanceCounter {
  readonly kind: AllowanceKind;
  readonly limit: number;
  readonly used: number | null;
  readonly remaining: number;
  readonly state: AllowanceCounterState;
}

export interface EffectiveCommerceEntitlements {
  readonly accessState: CommerceAccessState;
  readonly productVersionId: CommerceProductVersionId;
  readonly planVersionId: CommercePlanVersionId;
  readonly planKey: CommercePlanKey;
  readonly planVersion: number;
  readonly subscriptionId: CommerceSubscriptionId;
  readonly source: EntitlementSource;
  readonly lifecycle: CommerceSubscriptionLifecycle;
  readonly capabilities: ReadonlySet<Capability>;
  readonly contributingGrantIds: readonly EntitlementGrantId[];
  readonly allowances: readonly EffectiveAllowanceCounter[];
}

export interface CommerceSubscriptionContext {
  readonly productVersion: CommerceProductVersion;
  readonly planVersion: CommercePlanVersion;
  readonly subscription: NormalizedSubscription;
  readonly grants: readonly EntitlementGrant[];
}

export interface CommerceEntitlementContext extends CommerceSubscriptionContext {
  readonly allowanceUsage: readonly AllowanceUsageInput[];
}

export interface ResolveCommerceEntitlementsInput extends CommerceEntitlementContext {
  readonly at?: Date;
}

export type AllowanceDecision<
  Counter extends EffectiveAllowanceCounter = EffectiveAllowanceCounter,
> =
  | {
      readonly allowed: true;
      readonly reason: 'within_limit';
      readonly requestedCount: number;
      readonly counter: Counter;
    }
  | {
      readonly allowed: false;
      readonly reason:
        | 'invalid_request'
        | 'entitlement_inactive'
        | 'not_granted'
        | 'usage_unknown'
        | 'limit_exceeded';
      readonly requestedCount: number;
    };

export interface CommerceSourceProvenance {
  readonly subscriptionId: CommerceSubscriptionId;
  readonly planVersionId: CommercePlanVersionId;
  readonly planKey: CommercePlanKey;
  readonly planVersion: number;
  readonly source: EntitlementSource;
  readonly lifecycle: CommerceSubscriptionLifecycle;
  readonly precedence: number;
  readonly accessState: CommerceAccessState;
  readonly contributingGrantIds: readonly EntitlementGrantId[];
}

export interface EffectivePortfolioAllowanceCounter extends EffectiveAllowanceCounter {
  readonly sourceSubscriptionId: CommerceSubscriptionId;
  readonly sourcePlanVersionId: CommercePlanVersionId;
}

export interface EffectiveCommercePortfolio {
  readonly subject: EntitlementSubject;
  readonly accessState: 'effective' | 'no_effective_context';
  readonly primarySource: CommerceSourceProvenance | null;
  readonly sources: readonly CommerceSourceProvenance[];
  readonly capabilities: ReadonlySet<Capability>;
  readonly contributingGrantIds: readonly EntitlementGrantId[];
  readonly allowances: readonly EffectivePortfolioAllowanceCounter[];
}

export interface ResolveCommercePortfolioInput {
  readonly subject: EntitlementSubject;
  readonly contexts: readonly CommerceSubscriptionContext[];
  readonly allowanceUsage: readonly AllowanceUsageInput[];
  readonly at?: Date;
}

const ACCESS_ELIGIBLE_LIFECYCLES: readonly CommerceSubscriptionLifecycle[] = [
  'trialing',
  'active',
  'grace',
  'cancel_at_period_end',
  'restored',
];

function isCanonicalInstant(value: string): boolean {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function assertPositiveVersion(version: number, label: string): void {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new DomainError('invalid_input', `${label} must be a positive integer`);
  }
}

function assertAvailabilityWindow(availableFrom: string, availableUntil: string | undefined): void {
  if (!isCanonicalInstant(availableFrom)) {
    throw new DomainError('invalid_input', 'availableFrom must be a canonical ISO instant');
  }
  if (availableUntil === undefined) return;
  if (
    !isCanonicalInstant(availableUntil) ||
    Date.parse(availableUntil) <= Date.parse(availableFrom)
  ) {
    throw new DomainError('invalid_input', 'availableUntil must follow availableFrom');
  }
}

export function defineCommerceProductVersion(
  value: CommerceProductVersion,
): CommerceProductVersion {
  assertPositiveVersion(value.version, 'Product version');
  assertAvailabilityWindow(value.availableFrom, value.availableUntil);
  if (value.key !== 'consumer_household' || value.displayName.trim().length === 0) {
    throw new DomainError('invalid_input', 'Product display name is required');
  }
  return Object.freeze({ ...value });
}

export function defineCommercePlanVersion(value: CommercePlanVersion): CommercePlanVersion {
  assertPositiveVersion(value.version, 'Plan version');
  assertAvailabilityWindow(value.availableFrom, value.availableUntil);
  if (value.displayName.trim().length === 0 || value.prices.length === 0) {
    throw new DomainError('invalid_input', 'Plan display name and price hypotheses are required');
  }

  const capabilityKeys = new Set(value.capabilities);
  if (
    capabilityKeys.size !== value.capabilities.length ||
    value.capabilities.some((capability) => !canonicalCapabilities.includes(capability))
  ) {
    throw new DomainError('invalid_input', 'Plan capabilities must be unique');
  }

  const allowanceKeys = new Set<AllowanceKind>();
  const allowances = value.allowances.map((allowance) => {
    if (
      !allowanceKinds.includes(allowance.kind) ||
      allowanceKeys.has(allowance.kind) ||
      !Number.isSafeInteger(allowance.limit) ||
      allowance.limit < 0
    ) {
      throw new DomainError(
        'invalid_input',
        'Plan allowances must be unique non-negative integers',
      );
    }
    allowanceKeys.add(allowance.kind);
    return Object.freeze({ ...allowance });
  });

  const priceKeys = new Set<string>();
  const prices = value.prices.map((price) => {
    const key = `${price.kind}:${price.interval}`;
    if (
      !billingIntervals.includes(price.interval) ||
      !priceHypothesisKinds.includes(price.kind) ||
      price.currency !== 'USD' ||
      priceKeys.has(key) ||
      !Number.isSafeInteger(price.amountMinor) ||
      price.amountMinor < 0
    ) {
      throw new DomainError('invalid_input', 'Plan prices must be unique non-negative minor units');
    }
    priceKeys.add(key);
    return Object.freeze({ ...price });
  });

  return Object.freeze({
    ...value,
    capabilities: Object.freeze([...value.capabilities]),
    allowances: Object.freeze(allowances),
    prices: Object.freeze(prices),
  });
}

function hasValidProductShape(product: CommerceProductVersion): boolean {
  return (
    product.key === 'consumer_household' &&
    product.displayName.trim().length > 0 &&
    Number.isSafeInteger(product.version) &&
    product.version > 0 &&
    isCanonicalInstant(product.availableFrom) &&
    (product.availableUntil === undefined ||
      (isCanonicalInstant(product.availableUntil) &&
        Date.parse(product.availableUntil) > Date.parse(product.availableFrom)))
  );
}

function hasValidPlanShape(plan: CommercePlanVersion): boolean {
  const allowanceKindsSeen = new Set<AllowanceKind>();
  const capabilitiesSeen = new Set<Capability>();
  const priceKeysSeen = new Set<string>();
  return (
    commercePlanKeys.includes(plan.key) &&
    plan.displayName.trim().length > 0 &&
    Number.isSafeInteger(plan.version) &&
    plan.version > 0 &&
    isCanonicalInstant(plan.availableFrom) &&
    (plan.availableUntil === undefined ||
      (isCanonicalInstant(plan.availableUntil) &&
        Date.parse(plan.availableUntil) > Date.parse(plan.availableFrom))) &&
    plan.capabilities.every((capability) => {
      if (capabilitiesSeen.has(capability) || !canonicalCapabilities.includes(capability)) {
        return false;
      }
      capabilitiesSeen.add(capability);
      return true;
    }) &&
    plan.allowances.every((allowance) => {
      if (
        !allowanceKinds.includes(allowance.kind) ||
        allowanceKindsSeen.has(allowance.kind) ||
        !Number.isSafeInteger(allowance.limit) ||
        allowance.limit < 0
      ) {
        return false;
      }
      allowanceKindsSeen.add(allowance.kind);
      return true;
    }) &&
    plan.prices.length > 0 &&
    plan.prices.every((price) => {
      const key = `${price.kind}:${price.interval}`;
      if (
        !billingIntervals.includes(price.interval) ||
        !priceHypothesisKinds.includes(price.kind) ||
        price.currency !== 'USD' ||
        priceKeysSeen.has(key) ||
        !Number.isSafeInteger(price.amountMinor) ||
        price.amountMinor < 0
      ) {
        return false;
      }
      priceKeysSeen.add(key);
      return true;
    })
  );
}

function subscriptionAccessState(
  input: ResolveCommerceEntitlementsInput,
  at: Date,
): Exclude<CommerceAccessState, 'effective' | 'no_effective_grant'> | 'eligible' {
  const { productVersion, planVersion, subscription } = input;
  if (
    planVersion.productVersionId !== productVersion.id ||
    subscription.planVersionId !== planVersion.id ||
    !hasValidProductShape(productVersion) ||
    !hasValidPlanShape(planVersion) ||
    !entitlementSources.includes(subscription.source) ||
    !commerceSubscriptionLifecycles.includes(subscription.lifecycle) ||
    !Number.isFinite(at.getTime()) ||
    !Number.isFinite(subscription.startsAt.getTime()) ||
    !Number.isSafeInteger(subscription.precedence) ||
    subscription.precedence < 0 ||
    (subscription.accessEndsAt !== undefined &&
      (!Number.isFinite(subscription.accessEndsAt.getTime()) ||
        subscription.accessEndsAt.getTime() <= subscription.startsAt.getTime()))
  ) {
    return 'invalid_linkage';
  }
  if (
    Date.parse(productVersion.availableFrom) > at.getTime() ||
    Date.parse(planVersion.availableFrom) > at.getTime()
  ) {
    return 'not_started';
  }
  if (
    (productVersion.availableUntil !== undefined &&
      Date.parse(productVersion.availableUntil) <= at.getTime()) ||
    (planVersion.availableUntil !== undefined &&
      Date.parse(planVersion.availableUntil) <= at.getTime())
  ) {
    return 'expired';
  }
  if (!subscription.sourceVerified) return 'unverified_source';
  if (subscription.startsAt.getTime() > at.getTime()) return 'not_started';
  if (
    subscription.accessEndsAt !== undefined &&
    subscription.accessEndsAt.getTime() <= at.getTime()
  ) {
    return 'expired';
  }
  return ACCESS_ELIGIBLE_LIFECYCLES.includes(subscription.lifecycle)
    ? 'eligible'
    : 'inactive_lifecycle';
}

function resolveAllowanceCounter(
  allowance: CommerceAllowance,
  usage: readonly AllowanceUsageInput[],
  entitlementsEffective: boolean,
): EffectiveAllowanceCounter {
  const matches = usage.filter((record) => record.kind === allowance.kind);
  const record = matches[0];
  const countIsKnown =
    matches.length === 1 &&
    record !== undefined &&
    Number.isSafeInteger(record.count) &&
    record.count >= 0;
  const used = countIsKnown && record !== undefined ? record.count : null;

  if (!entitlementsEffective) {
    return Object.freeze({
      kind: allowance.kind,
      limit: allowance.limit,
      used,
      remaining: 0,
      state: 'entitlement_inactive',
    });
  }
  if (used === null) {
    return Object.freeze({
      kind: allowance.kind,
      limit: allowance.limit,
      used,
      remaining: 0,
      state: 'usage_unknown',
    });
  }

  const remaining = Math.max(allowance.limit - used, 0);
  return Object.freeze({
    kind: allowance.kind,
    limit: allowance.limit,
    used,
    remaining,
    state: remaining === 0 ? 'exhausted' : 'available',
  });
}

export function resolveCommerceEntitlements(
  input: ResolveCommerceEntitlementsInput,
): EffectiveCommerceEntitlements {
  const at = input.at ?? new Date();
  const preliminaryState = subscriptionAccessState(input, at);
  const matchingGrants =
    preliminaryState === 'eligible'
      ? input.grants.filter(
          (grant) =>
            grant.planVersionId === input.planVersion.id &&
            grant.subscriptionId === input.subscription.id &&
            grant.source === input.subscription.source &&
            isSameEntitlementSubject(grant.subject, input.subscription.subject) &&
            isGrantEffective(grant, at),
        )
      : [];
  const canonical = resolveEffectiveEntitlements(matchingGrants, at);
  const accessState: CommerceAccessState =
    preliminaryState === 'eligible'
      ? canonical.contributingGrantIds.length > 0
        ? 'effective'
        : 'no_effective_grant'
      : preliminaryState;
  const planCapabilities = new Set(input.planVersion.capabilities);
  const capabilities = new Set<Capability>();
  if (accessState === 'effective') {
    for (const capability of canonical.capabilities) {
      if (planCapabilities.has(capability)) capabilities.add(capability);
    }
  }
  const allowances = hasValidPlanShape(input.planVersion)
    ? input.planVersion.allowances.map((allowance) =>
        resolveAllowanceCounter(allowance, input.allowanceUsage, accessState === 'effective'),
      )
    : [];

  return Object.freeze({
    accessState,
    productVersionId: input.productVersion.id,
    planVersionId: input.planVersion.id,
    planKey: input.planVersion.key,
    planVersion: input.planVersion.version,
    subscriptionId: input.subscription.id,
    source: input.subscription.source,
    lifecycle: input.subscription.lifecycle,
    capabilities,
    contributingGrantIds:
      accessState === 'effective' ? canonical.contributingGrantIds : Object.freeze([]),
    allowances: Object.freeze(allowances),
  });
}

export function resolveCommercePortfolio(
  input: ResolveCommercePortfolioInput,
): EffectiveCommercePortfolio {
  const at = input.at ?? new Date();
  const subscriptionCounts = new Map<CommerceSubscriptionId, number>();
  for (const context of input.contexts) {
    subscriptionCounts.set(
      context.subscription.id,
      (subscriptionCounts.get(context.subscription.id) ?? 0) + 1,
    );
  }

  const entries = input.contexts.map((context) => {
    const resolution = resolveCommerceEntitlements({
      ...context,
      allowanceUsage: input.allowanceUsage,
      at,
    });
    const admissible =
      subscriptionCounts.get(context.subscription.id) === 1 &&
      isSameEntitlementSubject(context.subscription.subject, input.subject);
    const accessState: CommerceAccessState = admissible
      ? resolution.accessState
      : 'invalid_linkage';
    const source = Object.freeze({
      subscriptionId: context.subscription.id,
      planVersionId: context.planVersion.id,
      planKey: context.planVersion.key,
      planVersion: context.planVersion.version,
      source: context.subscription.source,
      lifecycle: context.subscription.lifecycle,
      precedence: context.subscription.precedence,
      accessState,
      contributingGrantIds:
        accessState === 'effective' ? resolution.contributingGrantIds : Object.freeze([]),
    }) satisfies CommerceSourceProvenance;
    return { context, resolution, source };
  });

  const effectiveEntries = entries
    .filter((entry) => entry.source.accessState === 'effective')
    .sort(
      (left, right) =>
        right.context.subscription.precedence - left.context.subscription.precedence ||
        left.context.subscription.id.localeCompare(right.context.subscription.id),
    );
  const capabilities = new Set<Capability>();
  const contributingGrantIds = new Set<EntitlementGrantId>();
  for (const entry of effectiveEntries) {
    for (const capability of entry.resolution.capabilities) capabilities.add(capability);
    for (const grantId of entry.resolution.contributingGrantIds) contributingGrantIds.add(grantId);
  }

  const allowances = allowanceKinds.flatMap((kind) => {
    const candidates = effectiveEntries
      .flatMap((entry) => {
        const counter = entry.resolution.allowances.find((candidate) => candidate.kind === kind);
        return counter === undefined ? [] : [{ entry, counter }];
      })
      .sort(
        (left, right) =>
          right.counter.limit - left.counter.limit ||
          right.entry.context.subscription.precedence -
            left.entry.context.subscription.precedence ||
          left.entry.context.subscription.id.localeCompare(right.entry.context.subscription.id),
      );
    const selected = candidates[0];
    if (selected === undefined) return [];
    return [
      Object.freeze({
        ...selected.counter,
        sourceSubscriptionId: selected.entry.context.subscription.id,
        sourcePlanVersionId: selected.entry.context.planVersion.id,
      }),
    ];
  });
  const sources = Object.freeze(entries.map((entry) => entry.source));
  const primarySource = effectiveEntries[0]?.source ?? null;

  return Object.freeze({
    subject: input.subject,
    accessState: effectiveEntries.length > 0 ? 'effective' : 'no_effective_context',
    primarySource,
    sources,
    capabilities,
    contributingGrantIds: Object.freeze([...contributingGrantIds]),
    allowances: Object.freeze(allowances),
  });
}

export function checkAllowance(
  entitlements: EffectiveCommerceEntitlements,
  kind: AllowanceKind,
  requestedCount = 1,
): AllowanceDecision {
  if (!Number.isSafeInteger(requestedCount) || requestedCount < 1) {
    return { allowed: false, reason: 'invalid_request', requestedCount };
  }
  if (entitlements.accessState !== 'effective') {
    return { allowed: false, reason: 'entitlement_inactive', requestedCount };
  }
  const counter = entitlements.allowances.find((candidate) => candidate.kind === kind);
  if (counter === undefined) {
    return { allowed: false, reason: 'not_granted', requestedCount };
  }
  if (counter.state === 'usage_unknown') {
    return { allowed: false, reason: 'usage_unknown', requestedCount };
  }
  if (counter.state !== 'available' || requestedCount > counter.remaining) {
    return { allowed: false, reason: 'limit_exceeded', requestedCount };
  }
  return { allowed: true, reason: 'within_limit', requestedCount, counter };
}

export function assertAllowanceAvailable(
  entitlements: EffectiveCommerceEntitlements,
  kind: AllowanceKind,
  requestedCount = 1,
): EffectiveAllowanceCounter {
  const decision = checkAllowance(entitlements, kind, requestedCount);
  if (!decision.allowed) {
    throw new DomainError('not_authorized', 'Commerce allowance is not available', {
      allowance: kind,
      reason: decision.reason,
      requestedCount,
    });
  }
  return decision.counter;
}

export function checkPortfolioAllowance(
  portfolio: EffectiveCommercePortfolio,
  kind: AllowanceKind,
  requestedCount = 1,
): AllowanceDecision<EffectivePortfolioAllowanceCounter> {
  if (!Number.isSafeInteger(requestedCount) || requestedCount < 1) {
    return { allowed: false, reason: 'invalid_request', requestedCount };
  }
  if (portfolio.accessState !== 'effective') {
    return { allowed: false, reason: 'entitlement_inactive', requestedCount };
  }
  const counter = portfolio.allowances.find((candidate) => candidate.kind === kind);
  if (counter === undefined) {
    return { allowed: false, reason: 'not_granted', requestedCount };
  }
  if (counter.state === 'usage_unknown') {
    return { allowed: false, reason: 'usage_unknown', requestedCount };
  }
  if (counter.state !== 'available' || requestedCount > counter.remaining) {
    return { allowed: false, reason: 'limit_exceeded', requestedCount };
  }
  return { allowed: true, reason: 'within_limit', requestedCount, counter };
}

export function assertPortfolioAllowanceAvailable(
  portfolio: EffectiveCommercePortfolio,
  kind: AllowanceKind,
  requestedCount = 1,
): EffectivePortfolioAllowanceCounter {
  const decision = checkPortfolioAllowance(portfolio, kind, requestedCount);
  if (!decision.allowed) {
    throw new DomainError('not_authorized', 'Commerce allowance is not available', {
      allowance: kind,
      reason: decision.reason,
      requestedCount,
    });
  }
  return decision.counter;
}

export const seededConsumerProductVersion = defineCommerceProductVersion({
  id: ids.commerceProductVersion('consumer_household_v1'),
  key: 'consumer_household',
  version: 1,
  displayName: 'BoomerBuddy household protection',
  availableFrom: '2026-08-15T00:00:00.000Z',
});

export const seededCommercePlanVersions = Object.freeze({
  free: defineCommercePlanVersion({
    id: ids.commercePlanVersion('free_v1'),
    productVersionId: seededConsumerProductVersion.id,
    key: 'free',
    version: 1,
    displayName: 'Free',
    availableFrom: '2026-08-15T00:00:00.000Z',
    capabilities: ['check:text', 'check:url', 'history:read', 'orientation:use'],
    allowances: [
      { kind: 'protected_members', limit: 1 },
      { kind: 'trusted_circle_participants', limit: 0 },
    ],
    prices: [
      { interval: 'month', amountMinor: 0, currency: 'USD', kind: 'list' },
      { interval: 'year', amountMinor: 0, currency: 'USD', kind: 'list' },
    ],
  }),
  plus: defineCommercePlanVersion({
    id: ids.commercePlanVersion('plus_v1'),
    productVersionId: seededConsumerProductVersion.id,
    key: 'plus',
    version: 1,
    displayName: 'Plus',
    availableFrom: '2026-08-15T00:00:00.000Z',
    capabilities: ['check:text', 'check:url', 'history:read', 'family:manage', 'orientation:use'],
    allowances: [
      { kind: 'protected_members', limit: 1 },
      { kind: 'trusted_circle_participants', limit: 2 },
    ],
    prices: [
      { interval: 'month', amountMinor: 899, currency: 'USD', kind: 'list' },
      { interval: 'year', amountMinor: 8_990, currency: 'USD', kind: 'list' },
    ],
  }),
  family: defineCommercePlanVersion({
    id: ids.commercePlanVersion('family_v1'),
    productVersionId: seededConsumerProductVersion.id,
    key: 'family',
    version: 1,
    displayName: 'Family',
    availableFrom: '2026-08-15T00:00:00.000Z',
    capabilities: ['check:text', 'check:url', 'history:read', 'family:manage', 'orientation:use'],
    allowances: [
      { kind: 'protected_members', limit: 3 },
      { kind: 'trusted_circle_participants', limit: 6 },
    ],
    prices: [
      { interval: 'month', amountMinor: 1_499, currency: 'USD', kind: 'list' },
      { interval: 'year', amountMinor: 14_990, currency: 'USD', kind: 'list' },
    ],
  }),
  individual: defineCommercePlanVersion({
    id: ids.commercePlanVersion('individual_v3'),
    productVersionId: seededConsumerProductVersion.id,
    key: 'plus',
    version: 3,
    displayName: 'Individual',
    availableFrom: '2026-08-28T00:00:00.000Z',
    capabilities: ['check:text', 'check:url', 'history:read', 'family:manage', 'orientation:use'],
    allowances: [
      { kind: 'protected_members', limit: 1 },
      { kind: 'trusted_circle_participants', limit: 2 },
    ],
    prices: [
      { interval: 'month', amountMinor: 899, currency: 'USD', kind: 'list' },
      { interval: 'year', amountMinor: 8_990, currency: 'USD', kind: 'list' },
    ],
  }),
  familyV3: defineCommercePlanVersion({
    id: ids.commercePlanVersion('family_v3'),
    productVersionId: seededConsumerProductVersion.id,
    key: 'family',
    version: 3,
    displayName: 'Family',
    availableFrom: '2026-08-28T00:00:00.000Z',
    capabilities: ['check:text', 'check:url', 'history:read', 'family:manage', 'orientation:use'],
    allowances: [
      { kind: 'protected_members', limit: 3 },
      { kind: 'trusted_circle_participants', limit: 6 },
    ],
    prices: [
      { interval: 'month', amountMinor: 1_499, currency: 'USD', kind: 'list' },
      { interval: 'year', amountMinor: 14_990, currency: 'USD', kind: 'list' },
    ],
  }),
});

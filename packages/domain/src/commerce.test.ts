import { describe, expect, it } from 'vitest';
import {
  DomainError,
  assertAllowanceAvailable,
  assertPortfolioAllowanceAvailable,
  checkAllowance,
  checkPortfolioAllowance,
  defineCommercePlanVersion,
  defineCommerceProductVersion,
  ids,
  resolveCommerceEntitlements,
  resolveCommercePortfolio,
  seededCommercePlanVersions,
  seededConsumerProductVersion,
  type AllowanceUsageInput,
  type CommerceEntitlementContext,
  type CommercePlanVersion,
  type CommerceSubscriptionLifecycle,
  type EntitlementGrant,
  type EntitlementSource,
  type NormalizedSubscription,
} from './index';

const now = new Date('2026-09-01T00:00:00.000Z');
const subject = {
  kind: 'household' as const,
  householdId: ids.household('household_commerce'),
};
const zeroSeatUsage = [
  { kind: 'protected_members', count: 0 },
  { kind: 'trusted_circle_participants', count: 0 },
] as const;

interface ContextOptions {
  readonly plan?: CommercePlanVersion;
  readonly subscriptionId?: string;
  readonly source?: EntitlementSource;
  readonly lifecycle?: CommerceSubscriptionLifecycle;
  readonly sourceVerified?: boolean;
  readonly precedence?: number;
  readonly startsAt?: Date;
  readonly accessEndsAt?: Date;
  readonly grantCapabilities?: EntitlementGrant['capabilities'];
  readonly grantSubject?: EntitlementGrant['subject'];
  readonly grantSource?: EntitlementSource;
  readonly includeGrant?: boolean;
  readonly includeProvenance?: boolean;
  readonly usage?: readonly AllowanceUsageInput[];
}

function commerceContext(options: ContextOptions = {}): CommerceEntitlementContext {
  const plan = options.plan ?? seededCommercePlanVersions.plus;
  const subscription: NormalizedSubscription = {
    id: ids.commerceSubscription(options.subscriptionId ?? 'subscription_plus'),
    subject,
    planVersionId: plan.id,
    source: options.source ?? 'local',
    lifecycle: options.lifecycle ?? 'active',
    sourceVerified: options.sourceVerified ?? true,
    precedence: options.precedence ?? 10,
    startsAt: options.startsAt ?? new Date('2026-08-15T00:00:00.000Z'),
    ...(options.accessEndsAt === undefined ? {} : { accessEndsAt: options.accessEndsAt }),
  };
  const grant: EntitlementGrant = {
    id: ids.entitlementGrant(`grant_${subscription.id}`),
    subject: options.grantSubject ?? subject,
    source: options.grantSource ?? subscription.source,
    ...(options.includeProvenance === false
      ? {}
      : { planVersionId: plan.id, subscriptionId: subscription.id }),
    capabilities: options.grantCapabilities ?? plan.capabilities,
    startsAt: subscription.startsAt,
    ...(options.accessEndsAt === undefined ? {} : { endsAt: options.accessEndsAt }),
    sourceVerified: true,
    precedence: subscription.precedence,
  };
  return {
    productVersion: seededConsumerProductVersion,
    planVersion: plan,
    subscription,
    grants: options.includeGrant === false ? [] : [grant],
    allowanceUsage:
      options.usage ?? plan.allowances.map((allowance) => ({ kind: allowance.kind, count: 0 })),
  };
}

describe('immutable commerce catalog', () => {
  it('keeps entitlement fixtures separate from the active revenue hypothesis registry', () => {
    expect(seededCommercePlanVersions.free.prices).toEqual([
      { interval: 'month', amountMinor: 0, currency: 'USD', kind: 'list' },
      { interval: 'year', amountMinor: 0, currency: 'USD', kind: 'list' },
    ]);
    expect(seededCommercePlanVersions.plus.prices.map((price) => price.amountMinor)).toEqual([
      899, 8_990,
    ]);
    expect(seededCommercePlanVersions.family.prices.map((price) => price.amountMinor)).toEqual([
      1_499, 14_990,
    ]);
    expect(seededCommercePlanVersions.plus.allowances).toEqual([
      { kind: 'protected_members', limit: 1 },
      { kind: 'trusted_circle_participants', limit: 2 },
    ]);
    expect(seededCommercePlanVersions.family.allowances).toEqual([
      { kind: 'protected_members', limit: 3 },
      { kind: 'trusted_circle_participants', limit: 6 },
    ]);
    expect(Object.isFrozen(seededCommercePlanVersions.family)).toBe(true);
    expect(Object.isFrozen(seededCommercePlanVersions.family.allowances)).toBe(true);
    expect(Object.isFrozen(seededCommercePlanVersions.family.allowances[0])).toBe(true);
  });

  it('rejects mutable-catalog ambiguity and invalid version windows', () => {
    expect(() =>
      defineCommercePlanVersion({
        ...seededCommercePlanVersions.plus,
        allowances: [
          { kind: 'protected_members', limit: 1 },
          { kind: 'protected_members', limit: 2 },
        ],
      }),
    ).toThrow(DomainError);
    expect(() =>
      defineCommercePlanVersion({
        ...seededCommercePlanVersions.plus,
        prices: [{ interval: 'month', amountMinor: -1, currency: 'USD', kind: 'list' }],
      }),
    ).toThrow(DomainError);
    expect(() =>
      defineCommerceProductVersion({
        ...seededConsumerProductVersion,
        version: 0,
        availableFrom: 'not-a-date',
      }),
    ).toThrow(DomainError);
  });
});

describe('normalized subscription lifecycle', () => {
  it.each(['trialing', 'active', 'grace', 'cancel_at_period_end', 'restored'] as const)(
    'treats %s as access-eligible when its canonical grant is effective',
    (lifecycle) => {
      const context = commerceContext({ lifecycle });
      expect(resolveCommerceEntitlements({ ...context, at: now }).accessState).toBe('effective');
    },
  );

  it.each([
    'pending',
    'delinquent',
    'paused',
    'hold',
    'canceled',
    'expired',
    'refunded',
    'disputed',
  ] as const)('fails closed for %s', (lifecycle) => {
    const context = commerceContext({ lifecycle });
    const result = resolveCommerceEntitlements({ ...context, at: now });
    expect(result.accessState).toBe('inactive_lifecycle');
    expect(result.capabilities.size).toBe(0);
    expect(result.allowances.every((counter) => counter.remaining === 0)).toBe(true);
  });

  it('distinguishes unverified, future, expired, malformed, and grantless states', () => {
    expect(
      resolveCommerceEntitlements({
        ...commerceContext({ sourceVerified: false }),
        at: now,
      }).accessState,
    ).toBe('unverified_source');
    expect(
      resolveCommerceEntitlements({
        ...commerceContext({ startsAt: new Date('2026-10-01T00:00:00.000Z') }),
        at: now,
      }).accessState,
    ).toBe('not_started');
    expect(
      resolveCommerceEntitlements({
        ...commerceContext({ accessEndsAt: now }),
        at: now,
      }).accessState,
    ).toBe('expired');
    expect(
      resolveCommerceEntitlements({
        ...commerceContext({ precedence: -1 }),
        at: now,
      }).accessState,
    ).toBe('invalid_linkage');
    expect(
      resolveCommerceEntitlements({
        ...commerceContext({ includeGrant: false }),
        at: now,
      }).accessState,
    ).toBe('no_effective_grant');
  });

  it('enforces product and plan availability windows at their exact boundaries', () => {
    const futurePlan = defineCommercePlanVersion({
      ...seededCommercePlanVersions.plus,
      id: ids.commercePlanVersion('plus_future_v1'),
      availableFrom: '2026-10-01T00:00:00.000Z',
    });
    expect(
      resolveCommerceEntitlements({
        ...commerceContext({ plan: futurePlan, subscriptionId: 'subscription_future_plan' }),
        at: now,
      }).accessState,
    ).toBe('not_started');

    const endingPlan = defineCommercePlanVersion({
      ...seededCommercePlanVersions.plus,
      id: ids.commercePlanVersion('plus_ending_v1'),
      availableUntil: now.toISOString(),
    });
    expect(
      resolveCommerceEntitlements({
        ...commerceContext({ plan: endingPlan, subscriptionId: 'subscription_ending_plan' }),
        at: now,
      }).accessState,
    ).toBe('expired');

    const boundaryPlan = defineCommercePlanVersion({
      ...seededCommercePlanVersions.plus,
      id: ids.commercePlanVersion('plus_boundary_v1'),
      availableFrom: now.toISOString(),
    });
    expect(
      resolveCommerceEntitlements({
        ...commerceContext({ plan: boundaryPlan, subscriptionId: 'subscription_boundary_plan' }),
        at: now,
      }).accessState,
    ).toBe('effective');

    const expiredProduct = defineCommerceProductVersion({
      ...seededConsumerProductVersion,
      id: ids.commerceProductVersion('consumer_expired_v1'),
      availableUntil: now.toISOString(),
    });
    const expiredProductPlan = defineCommercePlanVersion({
      ...seededCommercePlanVersions.plus,
      id: ids.commercePlanVersion('plus_expired_product_v1'),
      productVersionId: expiredProduct.id,
    });
    expect(
      resolveCommerceEntitlements({
        ...commerceContext({
          plan: expiredProductPlan,
          subscriptionId: 'subscription_expired_product',
        }),
        productVersion: expiredProduct,
        at: now,
      }).accessState,
    ).toBe('expired');

    const futureProduct = defineCommerceProductVersion({
      ...seededConsumerProductVersion,
      id: ids.commerceProductVersion('consumer_future_v1'),
      availableFrom: '2026-10-01T00:00:00.000Z',
    });
    const futureProductPlan = defineCommercePlanVersion({
      ...seededCommercePlanVersions.plus,
      id: ids.commercePlanVersion('plus_future_product_v1'),
      productVersionId: futureProduct.id,
    });
    expect(
      resolveCommerceEntitlements({
        ...commerceContext({
          plan: futureProductPlan,
          subscriptionId: 'subscription_future_product',
        }),
        productVersion: futureProduct,
        at: now,
      }).accessState,
    ).toBe('not_started');
  });
});

describe('canonical commerce grants and allowance counters', () => {
  it('requires exact plan, subscription, and subject provenance and caps grants to the plan', () => {
    const free = commerceContext({
      plan: seededCommercePlanVersions.free,
      subscriptionId: 'subscription_free',
      grantCapabilities: ['check:text', 'family:manage'],
    });
    const result = resolveCommerceEntitlements({ ...free, at: now });
    expect([...result.capabilities]).toEqual(['check:text']);

    const noProvenance = commerceContext({ includeProvenance: false });
    expect(resolveCommerceEntitlements({ ...noProvenance, at: now }).accessState).toBe(
      'no_effective_grant',
    );
    const wrongSubject = commerceContext({
      grantSubject: { kind: 'person', personId: ids.person('different_person') },
    });
    expect(resolveCommerceEntitlements({ ...wrongSubject, at: now }).accessState).toBe(
      'no_effective_grant',
    );
    const wrongSource = commerceContext({
      source: 'sponsor',
      grantSource: 'local',
      subscriptionId: 'subscription_source_mismatch',
    });
    expect(resolveCommerceEntitlements({ ...wrongSource, at: now }).accessState).toBe(
      'no_effective_grant',
    );
  });

  it('allows only known positive increments within a current counter', () => {
    const context = commerceContext({
      usage: [
        { kind: 'protected_members', count: 1 },
        { kind: 'trusted_circle_participants', count: 1 },
      ],
    });
    const result = resolveCommerceEntitlements({ ...context, at: now });
    expect(result.allowances).toEqual([
      {
        kind: 'protected_members',
        limit: 1,
        used: 1,
        remaining: 0,
        state: 'exhausted',
      },
      {
        kind: 'trusted_circle_participants',
        limit: 2,
        used: 1,
        remaining: 1,
        state: 'available',
      },
    ]);
    expect(checkAllowance(result, 'trusted_circle_participants')).toMatchObject({
      allowed: true,
      reason: 'within_limit',
    });
    expect(assertAllowanceAvailable(result, 'trusted_circle_participants').remaining).toBe(1);
    expect(checkAllowance(result, 'trusted_circle_participants', 2)).toEqual({
      allowed: false,
      reason: 'limit_exceeded',
      requestedCount: 2,
    });
    expect(checkAllowance(result, 'protected_members')).toMatchObject({
      allowed: false,
      reason: 'limit_exceeded',
    });
    expect(checkAllowance(result, 'protected_members', 0)).toMatchObject({
      allowed: false,
      reason: 'invalid_request',
    });
  });

  it.each([
    { trustedUsage: [] as const },
    {
      trustedUsage: [
        { kind: 'trusted_circle_participants', count: 0 },
        { kind: 'trusted_circle_participants', count: 1 },
      ] as const,
    },
    {
      trustedUsage: [{ kind: 'trusted_circle_participants', count: -1 }] as const,
    },
  ])('treats missing, duplicate, or malformed usage as unknown', ({ trustedUsage }) => {
    const context = commerceContext({
      usage: [{ kind: 'protected_members', count: 0 }, ...trustedUsage],
    });
    const result = resolveCommerceEntitlements({ ...context, at: now });
    expect(
      result.allowances.find((counter) => counter.kind === 'trusted_circle_participants'),
    ).toMatchObject({ used: null, remaining: 0, state: 'usage_unknown' });
    expect(checkAllowance(result, 'trusted_circle_participants')).toMatchObject({
      allowed: false,
      reason: 'usage_unknown',
    });
    expect(() => assertAllowanceAvailable(result, 'trusted_circle_participants')).toThrow(
      DomainError,
    );
  });

  it('denies an allowance absent from the selected immutable plan', () => {
    const plan = defineCommercePlanVersion({
      ...seededCommercePlanVersions.plus,
      id: ids.commercePlanVersion('plus_without_circle_v1'),
      allowances: [{ kind: 'protected_members', limit: 1 }],
    });
    const context = commerceContext({ plan, subscriptionId: 'subscription_nocircle' });
    const result = resolveCommerceEntitlements({ ...context, at: now });
    expect(checkAllowance(result, 'trusted_circle_participants')).toEqual({
      allowed: false,
      reason: 'not_granted',
      requestedCount: 1,
    });
  });
});

describe('overlapping commerce portfolio', () => {
  it('unions capabilities while choosing the maximum allowance instead of summing seats', () => {
    const free = commerceContext({
      plan: seededCommercePlanVersions.free,
      subscriptionId: 'subscription_personal',
      source: 'web',
      precedence: 10,
    });
    const familySponsor = commerceContext({
      plan: seededCommercePlanVersions.family,
      subscriptionId: 'subscription_sponsor',
      source: 'sponsor',
      precedence: 20,
    });
    const portfolio = resolveCommercePortfolio({
      subject,
      contexts: [free, familySponsor],
      allowanceUsage: zeroSeatUsage,
      at: now,
    });

    expect(portfolio.accessState).toBe('effective');
    expect(portfolio.primarySource?.subscriptionId).toBe('subscription_sponsor');
    expect(portfolio.sources.map((source) => source.source)).toEqual(['web', 'sponsor']);
    expect(portfolio.capabilities).toEqual(
      new Set(['check:text', 'check:url', 'history:read', 'orientation:use', 'family:manage']),
    );
    expect(portfolio.allowances).toMatchObject([
      { kind: 'protected_members', limit: 3, sourceSubscriptionId: 'subscription_sponsor' },
      {
        kind: 'trusted_circle_participants',
        limit: 6,
        sourceSubscriptionId: 'subscription_sponsor',
      },
    ]);
    expect(checkPortfolioAllowance(portfolio, 'trusted_circle_participants', 6).allowed).toBe(true);
    expect(
      assertPortfolioAllowanceAvailable(portfolio, 'trusted_circle_participants', 6).limit,
    ).toBe(6);
  });

  it.each([
    {
      options: { sourceVerified: false },
      expectedState: 'unverified_source' as const,
    },
    { options: { accessEndsAt: now }, expectedState: 'expired' as const },
  ])('ignores unavailable sponsor contexts: $expectedState', (sponsorState) => {
    const personal = commerceContext({
      plan: seededCommercePlanVersions.plus,
      subscriptionId: 'subscription_personal_plus',
      source: 'web',
      precedence: 10,
    });
    const sponsor = commerceContext({
      plan: seededCommercePlanVersions.family,
      subscriptionId: 'subscription_unavailable_sponsor',
      source: 'sponsor',
      precedence: 20,
      ...sponsorState.options,
    });
    const portfolio = resolveCommercePortfolio({
      subject,
      contexts: [personal, sponsor],
      allowanceUsage: zeroSeatUsage,
      at: now,
    });
    expect(
      portfolio.sources.find((source) => source.subscriptionId === sponsor.subscription.id)
        ?.accessState,
    ).toBe(sponsorState.expectedState);
    expect(portfolio.primarySource?.subscriptionId).toBe(personal.subscription.id);
    expect(portfolio.allowances).toMatchObject([
      { kind: 'protected_members', limit: 1 },
      { kind: 'trusted_circle_participants', limit: 2 },
    ]);
  });

  it('uses explicit precedence for the primary downgrade while retaining the maximum active seat cap', () => {
    const family = commerceContext({
      plan: seededCommercePlanVersions.family,
      subscriptionId: 'subscription_family_old',
      precedence: 10,
    });
    const plus = commerceContext({
      plan: seededCommercePlanVersions.plus,
      subscriptionId: 'subscription_plus_new',
      precedence: 30,
    });
    const overlap = resolveCommercePortfolio({
      subject,
      contexts: [family, plus],
      allowanceUsage: zeroSeatUsage,
      at: now,
    });
    expect(overlap.primarySource?.planKey).toBe('plus');
    expect(overlap.allowances).toMatchObject([
      { kind: 'protected_members', limit: 3 },
      { kind: 'trusted_circle_participants', limit: 6 },
    ]);

    const expiredFamily = commerceContext({
      plan: seededCommercePlanVersions.family,
      subscriptionId: 'subscription_family_expired',
      precedence: 10,
      accessEndsAt: now,
    });
    const afterDowngrade = resolveCommercePortfolio({
      subject,
      contexts: [expiredFamily, plus],
      allowanceUsage: zeroSeatUsage,
      at: now,
    });
    expect(afterDowngrade.allowances).toMatchObject([
      { kind: 'protected_members', limit: 1 },
      { kind: 'trusted_circle_participants', limit: 2 },
    ]);
  });

  it('fails closed for duplicate subscription contexts and unrelated subjects', () => {
    const duplicated = commerceContext({ subscriptionId: 'subscription_duplicate' });
    const unrelated = commerceContext({ subscriptionId: 'subscription_unrelated' });
    const portfolio = resolveCommercePortfolio({
      subject: { kind: 'person', personId: ids.person('portfolio_person') },
      contexts: [duplicated, duplicated, unrelated],
      allowanceUsage: zeroSeatUsage,
      at: now,
    });
    expect(portfolio.accessState).toBe('no_effective_context');
    expect(portfolio.sources.every((source) => source.accessState === 'invalid_linkage')).toBe(
      true,
    );
    expect(checkPortfolioAllowance(portfolio, 'protected_members')).toMatchObject({
      allowed: false,
      reason: 'entitlement_inactive',
    });
  });
});

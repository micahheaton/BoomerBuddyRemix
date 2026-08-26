import type { EntitlementResponse } from '@boomerbuddy/contracts';
import { describe, expect, it } from 'vitest';

import {
  entitlementPlanDto,
  entitlementResponseDto,
  entitlementRuntimeDto,
} from '../../apps/api/src/entitlement-response';

const productionPaidFamilyPlan = {
  id: 'family_v1',
  key: 'family',
  version: 1,
  displayName: 'Family',
  state: 'hypothesis',
  prices: [{ interval: 'month', amountMinor: 1_499, currency: 'USD', kind: 'list' }],
} as const;

const productionSponsorPlan = {
  id: 'founding_family_beta_v2',
  key: 'family',
  version: 2,
  displayName: 'Founding Family beta sponsor benefit',
  state: 'active',
  prices: [
    {
      interval: 'month',
      amountMinor: 0,
      currency: 'USD',
      kind: 'founding_experiment',
    },
  ],
} as const;

function sponsorResponse(): EntitlementResponse {
  return {
    subject: { kind: 'household', id: 'household-production' },
    capabilities: ['check:text', 'history:read'],
    grants: [
      {
        id: 'grant-sponsor',
        source: 'sponsor',
        startsAt: '2026-08-01T00:00:00.000Z',
        endsAt: '2027-08-01T00:00:00.000Z',
        sourceVerified: true,
        planVersionId: 'founding_family_beta_v2',
        subscriptionId: 'subscription-sponsor',
        effective: true,
      },
      {
        id: 'grant-local-fixture',
        source: 'local',
        startsAt: '2026-08-01T00:00:00.000Z',
        sourceVerified: true,
        planVersionId: 'family_v1',
        subscriptionId: 'subscription-local-fixture',
        effective: true,
      },
      {
        id: 'grant-pending-web',
        source: 'web',
        startsAt: '2026-08-01T00:00:00.000Z',
        sourceVerified: false,
        planVersionId: 'family_v1',
        subscriptionId: 'subscription-pending-web',
        effective: false,
      },
    ],
    commerce: {
      accessState: 'effective',
      primary: {
        subscriptionId: 'subscription-sponsor',
        source: 'sponsor',
        lifecycle: 'active',
        precedence: 400,
        sourceVerified: true,
        reconciliationState: 'not_required',
        startsAt: '2026-08-01T00:00:00.000Z',
        accessEndsAt: '2027-08-01T00:00:00.000Z',
        plan: { ...productionSponsorPlan, prices: [...productionSponsorPlan.prices] },
      },
      sources: [
        {
          subscriptionId: 'subscription-sponsor',
          planVersionId: 'founding_family_beta_v2',
          planKey: 'family',
          planVersion: 2,
          source: 'sponsor',
          lifecycle: 'active',
          precedence: 400,
          accessState: 'effective',
          contributingGrantIds: ['grant-sponsor'],
        },
        {
          subscriptionId: 'subscription-local-fixture',
          planVersionId: 'family_v1',
          planKey: 'family',
          planVersion: 1,
          source: 'local',
          lifecycle: 'active',
          precedence: 300,
          accessState: 'effective',
          contributingGrantIds: ['grant-local-fixture'],
        },
        {
          subscriptionId: 'subscription-pending-web',
          planVersionId: 'family_v1',
          planKey: 'family',
          planVersion: 1,
          source: 'web',
          lifecycle: 'pending',
          precedence: 500,
          accessState: 'unverified_source',
          contributingGrantIds: [],
        },
      ],
      allowances: [
        {
          kind: 'protected_members',
          limit: 3,
          used: 1,
          remaining: 2,
          state: 'available',
          sourceSubscriptionId: 'subscription-sponsor',
          sourcePlanVersionId: 'founding_family_beta_v2',
        },
        {
          kind: 'trusted_circle_participants',
          limit: 6,
          used: 0,
          remaining: 6,
          state: 'available',
          sourceSubscriptionId: 'subscription-local-fixture',
          sourcePlanVersionId: 'family_v1',
        },
      ],
      mode: 'local_mock',
      hypothesis: true,
    },
    environment: 'development',
  };
}

describe('production entitlement response boundary', () => {
  it('exposes only the exact authorized Family monthly price in production', () => {
    expect(entitlementPlanDto(productionPaidFamilyPlan, 'production')).toEqual({
      id: 'family_v1',
      key: 'family',
      version: 1,
      displayName: 'Family',
      state: 'active',
      prices: [{ interval: 'month', amountMinor: 1_499, currency: 'USD', kind: 'list' }],
    });
    const serialized = JSON.stringify(entitlementPlanDto(productionPaidFamilyPlan, 'production'));
    expect(serialized).not.toContain('14900');
    expect(serialized).not.toContain('hypothesis');
  });

  it('fails closed instead of exposing any non-allowlisted production plan', () => {
    expect(() =>
      entitlementPlanDto(
        {
          ...productionPaidFamilyPlan,
          id: 'plus_v1',
          key: 'plus',
          displayName: 'Individual',
          prices: [
            { interval: 'month', amountMinor: 899, currency: 'USD', kind: 'list' },
            { interval: 'year', amountMinor: 8_900, currency: 'USD', kind: 'list' },
          ],
        },
        'production',
      ),
    ).toThrow('The production customer entitlement plan is unavailable');
    expect(() =>
      entitlementPlanDto(
        {
          ...productionPaidFamilyPlan,
          id: 'future_internal_active_v1',
          displayName: 'Internal launch experiment',
          state: 'active',
        },
        'production',
      ),
    ).toThrow('The production customer entitlement plan is unavailable');
  });

  it('allowlists and normalizes an exact active sponsor plan', () => {
    expect(
      entitlementPlanDto(
        {
          ...productionSponsorPlan,
        },
        'production',
      ),
    ).toEqual({
      id: 'founding_family_beta_v2',
      key: 'family',
      version: 2,
      displayName: 'Sponsored Family access',
      state: 'active',
      prices: [],
    });
  });

  it('returns only resolved capabilities and customer-safe sponsor facts', () => {
    expect(entitlementResponseDto(sponsorResponse(), 'production')).toEqual({
      subject: { kind: 'household', id: 'household-production' },
      capabilities: ['check:text', 'history:read'],
      grants: [],
      commerce: {
        accessState: 'effective',
        primary: {
          subscriptionId: 'subscription-sponsor',
          source: 'sponsor',
          lifecycle: 'active',
          precedence: 400,
          sourceVerified: true,
          reconciliationState: 'not_required',
          startsAt: '2026-08-01T00:00:00.000Z',
          accessEndsAt: '2027-08-01T00:00:00.000Z',
          plan: {
            id: 'founding_family_beta_v2',
            key: 'family',
            version: 2,
            displayName: 'Sponsored Family access',
            state: 'active',
            prices: [],
          },
        },
        sources: [],
        allowances: [
          {
            kind: 'protected_members',
            limit: 3,
            used: 1,
            remaining: 2,
            state: 'available',
            sourceSubscriptionId: 'subscription-sponsor',
            sourcePlanVersionId: 'founding_family_beta_v2',
          },
        ],
        mode: 'canonical',
        hypothesis: false,
      },
      environment: 'production',
    });
    expect(JSON.stringify(entitlementResponseDto(sponsorResponse(), 'production'))).not.toContain(
      'grant-sponsor',
    );
  });

  it('fails a local-only production portfolio closed with empty diagnostics', () => {
    const response = sponsorResponse();
    response.commerce.primary = {
      ...response.commerce.primary!,
      subscriptionId: 'subscription-local-fixture',
      source: 'local',
      precedence: 300,
      plan: { ...productionPaidFamilyPlan, prices: [...productionPaidFamilyPlan.prices] },
    };
    response.commerce.sources = response.commerce.sources.filter(
      (source) => source.source === 'local',
    );
    response.grants = response.grants.filter((grant) => grant.source === 'local');
    expect(entitlementResponseDto(response, 'production')).toEqual({
      subject: { kind: 'household', id: 'household-production' },
      capabilities: [],
      grants: [],
      commerce: {
        accessState: 'no_effective_context',
        primary: null,
        sources: [],
        allowances: [],
        mode: 'canonical',
        hypothesis: false,
      },
      environment: 'production',
    });
  });

  it('fails a mismatched effective source identity closed', () => {
    const response = sponsorResponse();
    response.commerce.sources[0]!.planVersion = 99;
    expect(entitlementResponseDto(response, 'production').commerce).toEqual({
      accessState: 'no_effective_context',
      primary: null,
      sources: [],
      allowances: [],
      mode: 'canonical',
      hypothesis: false,
    });
  });

  it('projects the future effective paid-family response to exact monthly customer facts', () => {
    const response = sponsorResponse();
    response.grants = [
      {
        id: 'grant-paid-family',
        source: 'web',
        startsAt: '2026-08-01T00:00:00.000Z',
        sourceVerified: true,
        planVersionId: 'family_v1',
        subscriptionId: 'subscription-paid-family',
        effective: true,
      },
    ];
    response.commerce.primary = {
      subscriptionId: 'subscription-paid-family',
      source: 'web',
      lifecycle: 'active',
      precedence: 500,
      sourceVerified: true,
      reconciliationState: 'reconciled',
      startsAt: '2026-08-01T00:00:00.000Z',
      plan: { ...productionPaidFamilyPlan, prices: [...productionPaidFamilyPlan.prices] },
    };
    response.commerce.sources = [
      {
        subscriptionId: 'subscription-paid-family',
        planVersionId: 'family_v1',
        planKey: 'family',
        planVersion: 1,
        source: 'web',
        lifecycle: 'active',
        precedence: 500,
        accessState: 'effective',
        contributingGrantIds: ['grant-paid-family'],
      },
    ];
    response.commerce.allowances = [
      {
        kind: 'protected_members',
        limit: 3,
        used: 1,
        remaining: 2,
        state: 'available',
        sourceSubscriptionId: 'subscription-paid-family',
        sourcePlanVersionId: 'family_v1',
      },
    ];
    const projected = entitlementResponseDto(response, 'production');
    expect(projected.commerce.primary?.plan).toEqual({
      id: 'family_v1',
      key: 'family',
      version: 1,
      displayName: 'Family',
      state: 'active',
      prices: [{ interval: 'month', amountMinor: 1_499, currency: 'USD', kind: 'list' }],
    });
    expect(JSON.stringify(projected)).not.toMatch(/14900|"hypothesis":true|local_mock|development/);
  });

  it('fails closed if the immutable catalogue identity or exact prices drift', () => {
    expect(() =>
      entitlementPlanDto(
        {
          ...productionPaidFamilyPlan,
          prices: [{ interval: 'month', amountMinor: 1_500, currency: 'USD', kind: 'list' }],
        },
        'production',
      ),
    ).toThrow('The production Family monthly customer price is unavailable');
    expect(() =>
      entitlementPlanDto(
        { ...productionPaidFamilyPlan, displayName: 'Family annual' },
        'production',
      ),
    ).toThrow('The production Family monthly customer price is unavailable');
  });

  it('preserves the complete historical catalogue only outside production', () => {
    expect(entitlementPlanDto(productionPaidFamilyPlan, 'test')).toEqual(productionPaidFamilyPlan);
  });

  it('labels production truth without development or mock leakage', () => {
    expect(entitlementRuntimeDto('production')).toEqual({
      environment: 'production',
      mode: 'canonical',
      hypothesis: false,
    });
    expect(entitlementRuntimeDto('test')).toEqual({
      environment: 'test',
      mode: 'local_mock',
      hypothesis: true,
    });
  });
});

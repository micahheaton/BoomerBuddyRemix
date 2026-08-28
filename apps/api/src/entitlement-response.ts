import type { AppConfig } from '@boomerbuddy/config';
import type { EntitlementResponse } from '@boomerbuddy/contracts';

type EntitlementPlanDto = NonNullable<EntitlementResponse['commerce']['primary']>['plan'];
type EntitlementPlanPriceDto = EntitlementPlanDto['prices'][number];
type EntitlementGrantDto = EntitlementResponse['grants'][number];
type EntitlementSourceDto = EntitlementResponse['commerce']['sources'][number];

const productionFamilyMonthlyPrice: EntitlementPlanPriceDto = Object.freeze({
  interval: 'month',
  amountMinor: 1_499,
  currency: 'USD',
  kind: 'list',
});
const sponsorPrice: EntitlementPlanPriceDto = Object.freeze({
  interval: 'month',
  amountMinor: 0,
  currency: 'USD',
  kind: 'founding_experiment',
});
function exactPrice(
  actual: EntitlementPlanPriceDto | undefined,
  expected: EntitlementPlanPriceDto,
): boolean {
  return (
    actual?.interval === expected.interval &&
    actual.amountMinor === expected.amountMinor &&
    actual.currency === expected.currency &&
    actual.kind === expected.kind
  );
}

export function entitlementPlanDto(
  plan: Omit<EntitlementPlanDto, 'prices'> & {
    readonly prices: readonly EntitlementPlanPriceDto[];
  },
  environment: AppConfig['environment'],
): EntitlementPlanDto {
  if (environment !== 'production') {
    return { ...plan, prices: plan.prices.map((price) => ({ ...price })) };
  }

  if (plan.id === 'family_v1') {
    if (
      plan.key !== 'family' ||
      plan.version !== 1 ||
      plan.displayName !== 'Family' ||
      plan.state !== 'hypothesis' ||
      plan.prices.length !== 1 ||
      !exactPrice(plan.prices[0], productionFamilyMonthlyPrice)
    ) {
      throw new TypeError('The production Family monthly customer price is unavailable');
    }
    return {
      id: 'family_v1',
      key: 'family',
      version: 1,
      displayName: 'Family',
      state: 'active',
      prices: [{ ...productionFamilyMonthlyPrice }],
    };
  }

  const sponsorProjection =
    plan.id === 'founding_plus_beta_v2'
      ? {
          key: 'plus' as const,
          version: 2,
          catalogueDisplayName: 'Founding Plus beta sponsor benefit',
          customerDisplayName: 'Sponsored access',
        }
      : plan.id === 'founding_family_beta_v2'
        ? {
            key: 'family' as const,
            version: 2,
            catalogueDisplayName: 'Founding Family beta sponsor benefit',
            customerDisplayName: 'Sponsored Family access',
          }
        : undefined;
  if (
    sponsorProjection === undefined ||
    plan.key !== sponsorProjection.key ||
    plan.version !== sponsorProjection.version ||
    plan.displayName !== sponsorProjection.catalogueDisplayName ||
    plan.state !== 'active' ||
    plan.prices.length !== 1 ||
    !exactPrice(plan.prices[0], sponsorPrice)
  ) {
    throw new TypeError('The production customer entitlement plan is unavailable');
  }
  return {
    id: plan.id,
    key: sponsorProjection.key,
    version: sponsorProjection.version,
    displayName: sponsorProjection.customerDisplayName,
    state: 'active',
    prices: [],
  };
}

function productionGrantEligible(grant: EntitlementGrantDto): boolean {
  return grant.source !== 'local' && grant.sourceVerified && grant.effective;
}

function productionSourceIdentityEligible(source: EntitlementSourceDto): boolean {
  return (
    (source.planVersionId === 'family_v1' &&
      source.planKey === 'family' &&
      source.planVersion === 1) ||
    (source.planVersionId === 'founding_plus_beta_v2' &&
      source.planKey === 'plus' &&
      source.planVersion === 2) ||
    (source.planVersionId === 'founding_family_beta_v2' &&
      source.planKey === 'family' &&
      source.planVersion === 2)
  );
}

function sourceGrantIds(
  source: EntitlementSourceDto,
  grants: readonly EntitlementGrantDto[],
): string[] {
  const declared = new Set(source.contributingGrantIds);
  return grants
    .filter(
      (grant) =>
        declared.has(grant.id) &&
        grant.subscriptionId === source.subscriptionId &&
        grant.planVersionId === source.planVersionId &&
        grant.source === source.source,
    )
    .map((grant) => grant.id);
}

export function entitlementResponseDto(
  response: EntitlementResponse,
  environment: AppConfig['environment'],
): EntitlementResponse {
  if (environment !== 'production') return response;

  const eligibleGrants = response.grants.filter(productionGrantEligible);
  const effectiveSources = response.commerce.sources.flatMap((source) => {
    if (
      source.source === 'local' ||
      source.accessState !== 'effective' ||
      !productionSourceIdentityEligible(source)
    ) {
      return [];
    }
    const contributingGrantIds = sourceGrantIds(source, eligibleGrants);
    return contributingGrantIds.length === 0 ? [] : [{ ...source, contributingGrantIds }];
  });
  const primary = response.commerce.primary;
  const primarySource =
    primary === null
      ? undefined
      : effectiveSources.find(
          (source) =>
            source.subscriptionId === primary.subscriptionId &&
            source.planVersionId === primary.plan.id &&
            source.planKey === primary.plan.key &&
            source.planVersion === primary.plan.version &&
            source.source === primary.source &&
            source.lifecycle === primary.lifecycle &&
            source.precedence === primary.precedence,
        );
  const primaryEligible =
    response.commerce.accessState === 'effective' &&
    primary !== null &&
    primary.source !== 'local' &&
    primary.sourceVerified &&
    (primary.reconciliationState === 'not_required' ||
      primary.reconciliationState === 'reconciled') &&
    primarySource !== undefined;

  if (!primaryEligible || primary === null) {
    return {
      subject: response.subject,
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
    };
  }

  const sourcePairs = new Set(
    effectiveSources.map((source) => `${source.subscriptionId}\u0000${source.planVersionId}`),
  );
  return {
    subject: response.subject,
    capabilities: [...response.capabilities],
    grants: [],
    commerce: {
      accessState: 'effective',
      primary: {
        ...primary,
        plan: entitlementPlanDto(primary.plan, 'production'),
      },
      sources: [],
      allowances: response.commerce.allowances.filter((allowance) =>
        sourcePairs.has(`${allowance.sourceSubscriptionId}\u0000${allowance.sourcePlanVersionId}`),
      ),
      mode: 'canonical',
      hypothesis: false,
    },
    environment: 'production',
  };
}

export function entitlementRuntimeDto(
  environment: AppConfig['environment'],
): Pick<EntitlementResponse, 'environment'> &
  Pick<EntitlementResponse['commerce'], 'mode' | 'hypothesis'> {
  return environment === 'production'
    ? { environment: 'production', mode: 'canonical', hypothesis: false }
    : { environment, mode: 'local_mock', hypothesis: true };
}

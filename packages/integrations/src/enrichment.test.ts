import { describe, expect, it, vi } from 'vitest';
import {
  ApolloFixtureEnrichmentProvider,
  DEFAULT_APOLLO_FIXTURE_CONFIG,
  DeterministicApolloFixtureSource,
  EnrichmentError,
  type ApolloEnrichmentConfig,
  type ContactDiscoveryRequest,
  type EnrichmentFixtureSource,
  type EnrichmentRequestContext,
  type OrganizationSearchRequest,
} from './enrichment';

const requestedAt = '2026-08-16T12:00:00.000Z';

function context(
  allowedDataClasses: EnrichmentRequestContext['allowedDataClasses'] = [
    'public_organization',
    'business_contact',
  ],
): EnrichmentRequestContext {
  return {
    requestId: 'request_fixture_1',
    requestedBy: 'research_operator_fixture',
    purpose: 'b2b_research',
    requestedAt,
    maxCostUnits: 2,
    allowedDataClasses,
  };
}

function config(overrides: Partial<ApolloEnrichmentConfig> = {}): ApolloEnrichmentConfig {
  return { ...DEFAULT_APOLLO_FIXTURE_CONFIG, ...overrides };
}

function organizationSearch(
  overrides: Partial<OrganizationSearchRequest> = {},
): OrganizationSearchRequest {
  return {
    context: context(['public_organization']),
    query: { name: 'community credit union' },
    requestedFields: ['name', 'website_domain', 'industry', 'employee_count', 'headquarters'],
    limit: 5,
    ...overrides,
  };
}

function contactDiscovery(
  overrides: Partial<ContactDiscoveryRequest> = {},
): ContactDiscoveryRequest {
  return {
    context: context(['business_contact']),
    canonicalOrganizationId: 'canonical_org_fixture_1',
    providerOrganizationId: 'org_fixture_northstar',
    roleFamilies: ['fraud_risk_compliance', 'digital_product_technology'],
    seniorities: ['director', 'vp'],
    requestedFields: [
      'full_name',
      'job_title',
      'seniority',
      'business_profile_url',
      'business_email',
    ],
    limit: 5,
    ...overrides,
  };
}

function sourceReturning(
  value: unknown,
): EnrichmentFixtureSource & { execute: ReturnType<typeof vi.fn> } {
  return {
    provider: 'apollo',
    networkAccess: false,
    execute: vi.fn(async () => value),
  };
}

describe('provider-neutral offline enrichment boundary', () => {
  it('maps deterministic organization fixtures with field provenance and no intent claim', async () => {
    const provider = new ApolloFixtureEnrichmentProvider(
      config(),
      new DeterministicApolloFixtureSource(),
    );

    const result = await provider.searchOrganizations(organizationSearch());

    expect(result).toMatchObject({
      provider: 'apollo',
      environment: 'fixture',
      operation: 'organization_search',
      state: 'available',
      datasetVersion: 'apollo-synthetic-2026-08-16',
      costUnits: 1,
      intentClaimed: false,
    });
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      name: {
        value: 'Northstar Community Credit Union',
        source: 'apollo_fixture',
        evidenceState: 'fixture',
      },
      websiteDomain: { value: 'northstar-cu.example' },
      intentClaimed: false,
    });
  });

  it('returns only requested organization fields from enrichment', async () => {
    const provider = new ApolloFixtureEnrichmentProvider(
      config(),
      new DeterministicApolloFixtureSource(),
    );

    const result = await provider.enrichOrganization({
      context: context(['public_organization']),
      canonicalOrganizationId: 'canonical_org_fixture_1',
      websiteDomain: 'northstar-cu.example',
      requestedFields: ['name', 'employee_count'],
    });

    expect(result.records[0]).toMatchObject({
      canonicalOrganizationId: 'canonical_org_fixture_1',
      name: { value: 'Northstar Community Credit Union' },
      employeeCount: { value: 240 },
    });
    expect(result.records[0]).not.toHaveProperty('websiteDomain');
    expect(result.records[0]).not.toHaveProperty('headquarters');
  });

  it('discovers only fixture business-contact fields and never creates outreach', async () => {
    const provider = new ApolloFixtureEnrichmentProvider(
      config(),
      new DeterministicApolloFixtureSource(),
    );

    const result = await provider.discoverContacts(contactDiscovery());

    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      canonicalOrganizationId: 'canonical_org_fixture_1',
      jobTitle: { value: 'Director of Fraud Operations' },
      businessEmail: { value: 'avery.morgan@northstar-cu.example' },
      intentClaimed: false,
    });
    expect(JSON.stringify(result)).not.toMatch(/phone|sequence|outreach|opportunity/iu);
  });

  it.each([
    [config({ enabled: false }), 'enrichment.disabled'],
    [config({ killSwitchEngaged: true }), 'enrichment.kill_switch_engaged'],
  ])('fails closed before fixture execution for disabled controls', async (settings, code) => {
    const source = sourceReturning(undefined);
    const provider = new ApolloFixtureEnrichmentProvider(settings, source);

    await expect(provider.searchOrganizations(organizationSearch())).rejects.toThrowError(code);
    expect(source.execute).not.toHaveBeenCalled();
  });

  it('has no constructible live transport and rejects network-capable sources', () => {
    expect(
      () =>
        new ApolloFixtureEnrichmentProvider(
          config({ mode: 'sandbox' }),
          new DeterministicApolloFixtureSource(),
        ),
    ).toThrowError('enrichment.live_transport_not_implemented');

    expect(
      () =>
        new ApolloFixtureEnrichmentProvider(config(), {
          provider: 'apollo',
          networkAccess: true,
          execute: async () => undefined,
        } as unknown as EnrichmentFixtureSource),
    ).toThrowError('enrichment.transport_not_offline');
  });

  it('enforces request record and cost ceilings before execution', async () => {
    const source = sourceReturning(undefined);
    const provider = new ApolloFixtureEnrichmentProvider(
      config({ maxRecordsPerRequest: 1 }),
      source,
    );

    await expect(
      provider.searchOrganizations(organizationSearch({ limit: 2 })),
    ).rejects.toThrowError('enrichment.record_limit_exceeded');
    await expect(
      provider.searchOrganizations(
        organizationSearch({ context: { ...context(), maxCostUnits: 0 }, limit: 1 }),
      ),
    ).rejects.toThrowError('enrichment.budget_exceeded');
    expect(source.execute).not.toHaveBeenCalled();
  });

  it.each(['householdId', 'customerArtifact', 'message', 'paymentToken'])(
    'rejects forbidden %s input before fixture execution',
    async (forbiddenKey) => {
      const source = sourceReturning(undefined);
      const provider = new ApolloFixtureEnrichmentProvider(config(), source);
      const unsafe = { ...organizationSearch(), [forbiddenKey]: 'must-not-cross' };

      await expect(
        provider.searchOrganizations(unsafe as unknown as OrganizationSearchRequest),
      ).rejects.toThrowError('enrichment.forbidden_data');
      expect(source.execute).not.toHaveBeenCalled();
    },
  );

  it('rejects unknown input and missing data-class authority before fixture execution', async () => {
    const source = sourceReturning(undefined);
    const provider = new ApolloFixtureEnrichmentProvider(config(), source);

    await expect(
      provider.searchOrganizations({
        ...organizationSearch(),
        notes: 'not part of the contract',
      } as unknown as OrganizationSearchRequest),
    ).rejects.toThrowError('enrichment.invalid_request');
    await expect(
      provider.searchOrganizations(organizationSearch({ context: context(['business_contact']) })),
    ).rejects.toThrowError('enrichment.forbidden_data');
    expect(source.execute).not.toHaveBeenCalled();
  });

  it.each(['not_found', 'unavailable', 'rate_limited'] as const)(
    'preserves truthful %s provider state',
    async (state) => {
      const source = sourceReturning({
        state,
        records: [],
        truncated: false,
        costUnits: 0,
        rateLimit: { remaining: 0, resetAt: '2026-08-17T00:00:00.000Z' },
      });
      const provider = new ApolloFixtureEnrichmentProvider(config(), source);

      await expect(provider.searchOrganizations(organizationSearch())).resolves.toMatchObject({
        state,
        records: [],
        intentClaimed: false,
      });
    },
  );

  it('returns a fresh deterministic result for repeated fixture requests', async () => {
    const provider = new ApolloFixtureEnrichmentProvider(
      config(),
      new DeterministicApolloFixtureSource(),
    );

    const first = await provider.searchOrganizations(organizationSearch());
    const second = await provider.searchOrganizations(organizationSearch());

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.records).not.toBe(second.records);
  });

  it('applies fixture filters and deterministic cursors instead of repeating a page', async () => {
    const provider = new ApolloFixtureEnrichmentProvider(
      config(),
      new DeterministicApolloFixtureSource(),
    );

    const first = await provider.searchOrganizations(
      organizationSearch({ query: { name: 'community', countryCode: 'US' }, limit: 1 }),
    );
    const cursor = first.nextCursor;
    if (cursor === undefined) throw new Error('fixture cursor missing');
    const second = await provider.searchOrganizations(
      organizationSearch({
        query: { name: 'community', countryCode: 'US' },
        limit: 1,
        cursor,
      }),
    );
    const filtered = await provider.searchOrganizations(
      organizationSearch({ query: { name: 'community', regionCode: 'OR' }, limit: 5 }),
    );

    expect(first).toMatchObject({ truncated: true, nextCursor: 'fixture_offset_1' });
    expect(first.records[0]?.providerOrganizationId.value).not.toBe(
      second.records[0]?.providerOrganizationId.value,
    );
    expect(second).toMatchObject({ truncated: false });
    expect(second).not.toHaveProperty('nextCursor');
    expect(filtered.records).toHaveLength(1);
    expect(filtered.records[0]?.websiteDomain?.value).toBe('harbor-cu.example');
  });

  it('rejects prohibited or malformed fixture payloads', async () => {
    const provider = new ApolloFixtureEnrichmentProvider(
      config(),
      sourceReturning({
        state: 'available',
        records: [
          {
            providerContactId: 'person_fixture',
            providerOrganizationId: 'org_fixture',
            fullName: 'Fixture Person',
            jobTitle: 'Director',
            seniority: 'director',
            phone: 'fixture-prohibited',
          },
        ],
        truncated: false,
        costUnits: 1,
        rateLimit: { remaining: 1, resetAt: '2026-08-17T00:00:00.000Z' },
      }),
    );

    await expect(provider.discoverContacts(contactDiscovery())).rejects.toBeInstanceOf(
      EnrichmentError,
    );
    await expect(provider.discoverContacts(contactDiscovery())).rejects.toThrowError(
      'enrichment.invalid_fixture',
    );
  });

  it('rejects actual fixture cost above the authorized budget', async () => {
    const provider = new ApolloFixtureEnrichmentProvider(
      config(),
      sourceReturning({
        state: 'not_found',
        records: [],
        truncated: false,
        costUnits: 3,
        rateLimit: { remaining: 1, resetAt: '2026-08-17T00:00:00.000Z' },
      }),
    );

    await expect(provider.searchOrganizations(organizationSearch())).rejects.toThrowError(
      'enrichment.budget_exceeded',
    );
  });
});

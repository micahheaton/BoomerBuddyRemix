export type EnrichmentOperation =
  'organization_search' | 'organization_enrichment' | 'contact_discovery';

export type EnrichmentState = 'available' | 'not_found' | 'unavailable' | 'rate_limited';
export type EnrichmentEnvironment = 'fixture' | 'sandbox' | 'production';
export type EnrichmentDataClass = 'public_organization' | 'business_contact';
export type OrganizationField =
  'name' | 'website_domain' | 'industry' | 'employee_count' | 'headquarters';
export type ContactField =
  'full_name' | 'job_title' | 'seniority' | 'business_profile_url' | 'business_email';
export type ContactRoleFamily =
  'executive' | 'fraud_risk_compliance' | 'member_operations' | 'digital_product_technology';
export type ContactSeniority = 'c_suite' | 'vp' | 'head' | 'director' | 'manager';

export interface EnrichmentRequestContext {
  readonly requestId: string;
  readonly requestedBy: string;
  readonly purpose: 'b2b_research';
  readonly requestedAt: string;
  readonly maxCostUnits: number;
  readonly allowedDataClasses: readonly EnrichmentDataClass[];
}

interface BaseRequest {
  readonly context: EnrichmentRequestContext;
  readonly limit: number;
}

export interface OrganizationSearchRequest extends BaseRequest {
  readonly query: {
    readonly name?: string;
    readonly websiteDomain?: string;
    readonly countryCode?: string;
    readonly regionCode?: string;
    readonly employeeBand?: string;
    readonly industryCode?: string;
  };
  readonly requestedFields: readonly OrganizationField[];
  readonly cursor?: string;
}

export interface OrganizationEnrichmentRequest {
  readonly context: EnrichmentRequestContext;
  readonly canonicalOrganizationId: string;
  readonly providerOrganizationId?: string;
  readonly websiteDomain?: string;
  readonly requestedFields: readonly OrganizationField[];
}

export interface ContactDiscoveryRequest extends BaseRequest {
  readonly canonicalOrganizationId: string;
  readonly providerOrganizationId?: string;
  readonly websiteDomain?: string;
  readonly roleFamilies: readonly ContactRoleFamily[];
  readonly seniorities: readonly ContactSeniority[];
  readonly requestedFields: readonly ContactField[];
  readonly cursor?: string;
}

export interface EnrichmentEvidence<T> {
  readonly value: T;
  readonly source: string;
  readonly observedAt: string;
  readonly evidenceState: 'fixture' | 'provider';
}

export interface FixtureEvidence<T> extends EnrichmentEvidence<T> {
  readonly source: 'apollo_fixture';
  readonly evidenceState: 'fixture';
}

export interface OrganizationCandidate {
  readonly providerOrganizationId: EnrichmentEvidence<string>;
  readonly name?: EnrichmentEvidence<string>;
  readonly websiteDomain?: EnrichmentEvidence<string>;
  readonly industry?: EnrichmentEvidence<string>;
  readonly employeeCount?: EnrichmentEvidence<number>;
  readonly headquarters?: EnrichmentEvidence<string>;
  readonly intentClaimed: false;
}

export interface EnrichedOrganization extends OrganizationCandidate {
  readonly canonicalOrganizationId: string;
}

export interface ContactCandidate {
  readonly canonicalOrganizationId: string;
  readonly providerContactId: EnrichmentEvidence<string>;
  readonly providerOrganizationId: EnrichmentEvidence<string>;
  readonly fullName?: EnrichmentEvidence<string>;
  readonly jobTitle?: EnrichmentEvidence<string>;
  readonly seniority?: EnrichmentEvidence<ContactSeniority>;
  readonly businessProfileUrl?: EnrichmentEvidence<string>;
  readonly businessEmail?: EnrichmentEvidence<string>;
  readonly intentClaimed: false;
}

export interface EnrichmentResult<T> {
  readonly provider: string;
  readonly environment: EnrichmentEnvironment;
  readonly operation: EnrichmentOperation;
  readonly state: EnrichmentState;
  readonly requestId: string;
  readonly requestedAt: string;
  readonly datasetVersion: string;
  readonly costUnits: number;
  readonly records: readonly T[];
  readonly truncated: boolean;
  readonly nextCursor?: string;
  readonly rateLimit: {
    readonly remaining: number;
    readonly resetAt: string;
  };
  readonly intentClaimed: false;
}

export interface EnrichmentProvider {
  readonly provider: string;
  readonly environment: EnrichmentEnvironment;
  searchOrganizations(
    input: OrganizationSearchRequest,
  ): Promise<EnrichmentResult<OrganizationCandidate>>;
  enrichOrganization(
    input: OrganizationEnrichmentRequest,
  ): Promise<EnrichmentResult<EnrichedOrganization>>;
  discoverContacts(input: ContactDiscoveryRequest): Promise<EnrichmentResult<ContactCandidate>>;
}

export interface EnrichmentFixtureSource {
  readonly provider: 'apollo';
  readonly networkAccess: false;
  execute(
    operation: EnrichmentOperation,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
}

export interface ApolloEnrichmentConfig {
  readonly enabled: boolean;
  readonly killSwitchEngaged: boolean;
  readonly mode: EnrichmentEnvironment;
  readonly datasetVersion: string;
  readonly maxRecordsPerRequest: number;
  readonly maxCostUnitsPerRequest: number;
  readonly costUnits: Readonly<Record<EnrichmentOperation, number>>;
}

export class EnrichmentError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'EnrichmentError';
  }
}

interface RawFixtureResult {
  readonly state: EnrichmentState;
  readonly records: readonly Readonly<Record<string, unknown>>[];
  readonly truncated: boolean;
  readonly nextCursor?: string;
  readonly costUnits: number;
  readonly rateLimit: { readonly remaining: number; readonly resetAt: string };
}

const OPERATIONS: readonly EnrichmentOperation[] = [
  'organization_search',
  'organization_enrichment',
  'contact_discovery',
];
const STATES: readonly EnrichmentState[] = [
  'available',
  'not_found',
  'unavailable',
  'rate_limited',
];
const DATA_CLASSES: readonly EnrichmentDataClass[] = ['public_organization', 'business_contact'];
const ORGANIZATION_FIELDS: readonly OrganizationField[] = [
  'name',
  'website_domain',
  'industry',
  'employee_count',
  'headquarters',
];
const CONTACT_FIELDS: readonly ContactField[] = [
  'full_name',
  'job_title',
  'seniority',
  'business_profile_url',
  'business_email',
];
const ROLE_FAMILIES: readonly ContactRoleFamily[] = [
  'executive',
  'fraud_risk_compliance',
  'member_operations',
  'digital_product_technology',
];
const SENIORITIES: readonly ContactSeniority[] = ['c_suite', 'vp', 'head', 'director', 'manager'];
const FORBIDDEN_KEY_PATTERN =
  /(?:artifact|check|household|protected|consent|customer|message|payment|credential|secret|token|phone|ssn|safe.?word|personal.?email)/iu;
const IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const DOMAIN_PATTERN = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

const INPUT_KEYS = {
  organization_search: ['context', 'query', 'requestedFields', 'limit', 'cursor'],
  organization_enrichment: [
    'context',
    'canonicalOrganizationId',
    'providerOrganizationId',
    'websiteDomain',
    'requestedFields',
  ],
  contact_discovery: [
    'context',
    'canonicalOrganizationId',
    'providerOrganizationId',
    'websiteDomain',
    'roleFamilies',
    'seniorities',
    'requestedFields',
    'limit',
    'cursor',
  ],
} as const;

const ORGANIZATION_FIXTURE_KEYS = [
  'providerOrganizationId',
  'name',
  'websiteDomain',
  'industry',
  'employeeCount',
  'headquarters',
] as const;
const CONTACT_FIXTURE_KEYS = [
  'providerContactId',
  'providerOrganizationId',
  'fullName',
  'jobTitle',
  'seniority',
  'businessProfileUrl',
  'businessEmail',
] as const;

function record(value: unknown, code = 'enrichment.invalid_request'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EnrichmentError(code);
  }
  return value as Record<string, unknown>;
}

function assertAllowedKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  code: string,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new EnrichmentError(code);
}

function assertNoForbiddenKeys(value: unknown, code: string): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenKeys(item, code);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) throw new EnrichmentError(code);
    assertNoForbiddenKeys(child, code);
  }
}

function text(value: unknown, code: string, maxLength = 256): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    throw new EnrichmentError(code);
  }
  return value.trim();
}

function identifier(value: unknown, code: string): string {
  const parsed = text(value, code, 128);
  if (!IDENTIFIER_PATTERN.test(parsed)) throw new EnrichmentError(code);
  return parsed;
}

function isoTimestamp(value: unknown, code: string): string {
  const parsed = text(value, code, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(parsed)) {
    throw new EnrichmentError(code);
  }
  if (!Number.isFinite(Date.parse(parsed))) throw new EnrichmentError(code);
  return parsed;
}

function nonNegativeInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new EnrichmentError(code);
  return value as number;
}

function positiveInteger(value: unknown, code: string): number {
  const parsed = nonNegativeInteger(value, code);
  if (parsed === 0) throw new EnrichmentError(code);
  return parsed;
}

function domain(value: unknown, code: string): string {
  const parsed = text(value, code, 253);
  if (parsed !== parsed.toLowerCase() || !DOMAIN_PATTERN.test(parsed))
    throw new EnrichmentError(code);
  return parsed;
}

function optionalText(value: unknown, code: string, maxLength = 256): string | undefined {
  return value === undefined ? undefined : text(value, code, maxLength);
}

function enumArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  code: string,
): readonly T[] {
  if (!Array.isArray(value) || value.length === 0) throw new EnrichmentError(code);
  const parsed = value.map((item) => {
    if (typeof item !== 'string' || !allowed.includes(item as T)) throw new EnrichmentError(code);
    return item as T;
  });
  if (new Set(parsed).size !== parsed.length) throw new EnrichmentError(code);
  return parsed;
}

function parseContext(
  value: unknown,
  requiredClass: EnrichmentDataClass,
): EnrichmentRequestContext {
  const input = record(value);
  assertAllowedKeys(
    input,
    ['requestId', 'requestedBy', 'purpose', 'requestedAt', 'maxCostUnits', 'allowedDataClasses'],
    'enrichment.invalid_request',
  );
  if (input.purpose !== 'b2b_research') throw new EnrichmentError('enrichment.invalid_request');
  const allowedDataClasses = enumArray(
    input.allowedDataClasses,
    DATA_CLASSES,
    'enrichment.invalid_request',
  );
  if (!allowedDataClasses.includes(requiredClass))
    throw new EnrichmentError('enrichment.forbidden_data');
  return {
    requestId: identifier(input.requestId, 'enrichment.invalid_request'),
    requestedBy: identifier(input.requestedBy, 'enrichment.invalid_request'),
    purpose: 'b2b_research',
    requestedAt: isoTimestamp(input.requestedAt, 'enrichment.invalid_request'),
    maxCostUnits: nonNegativeInteger(input.maxCostUnits, 'enrichment.invalid_request'),
    allowedDataClasses,
  };
}

function evidence<T>(value: T, observedAt: string): FixtureEvidence<T> {
  return { value, source: 'apollo_fixture', observedAt, evidenceState: 'fixture' };
}

function parseRawResult(value: unknown): RawFixtureResult {
  assertNoForbiddenKeys(value, 'enrichment.invalid_fixture');
  const input = record(value, 'enrichment.invalid_fixture');
  assertAllowedKeys(
    input,
    ['state', 'records', 'truncated', 'nextCursor', 'costUnits', 'rateLimit'],
    'enrichment.invalid_fixture',
  );
  if (typeof input.state !== 'string' || !STATES.includes(input.state as EnrichmentState)) {
    throw new EnrichmentError('enrichment.invalid_fixture');
  }
  if (!Array.isArray(input.records) || typeof input.truncated !== 'boolean') {
    throw new EnrichmentError('enrichment.invalid_fixture');
  }
  const rateLimit = record(input.rateLimit, 'enrichment.invalid_fixture');
  assertAllowedKeys(rateLimit, ['remaining', 'resetAt'], 'enrichment.invalid_fixture');
  const records = input.records.map((item) => record(item, 'enrichment.invalid_fixture'));
  if (
    (input.state === 'available' && records.length === 0) ||
    (input.state !== 'available' &&
      (records.length > 0 || input.truncated || input.nextCursor !== undefined)) ||
    (input.nextCursor !== undefined && !input.truncated)
  ) {
    throw new EnrichmentError('enrichment.invalid_fixture');
  }
  return {
    state: input.state as EnrichmentState,
    records,
    truncated: input.truncated,
    ...(input.nextCursor === undefined
      ? {}
      : { nextCursor: identifier(input.nextCursor, 'enrichment.invalid_fixture') }),
    costUnits: nonNegativeInteger(input.costUnits, 'enrichment.invalid_fixture'),
    rateLimit: {
      remaining: nonNegativeInteger(rateLimit.remaining, 'enrichment.invalid_fixture'),
      resetAt: isoTimestamp(rateLimit.resetAt, 'enrichment.invalid_fixture'),
    },
  };
}

function parseOrganizationRecord(
  raw: Readonly<Record<string, unknown>>,
  requestedFields: readonly OrganizationField[],
  observedAt: string,
): OrganizationCandidate {
  assertAllowedKeys(raw, ORGANIZATION_FIXTURE_KEYS, 'enrichment.invalid_fixture');
  const candidate: OrganizationCandidate = {
    providerOrganizationId: evidence(
      identifier(raw.providerOrganizationId, 'enrichment.invalid_fixture'),
      observedAt,
    ),
    ...(requestedFields.includes('name')
      ? { name: evidence(text(raw.name, 'enrichment.invalid_fixture'), observedAt) }
      : {}),
    ...(requestedFields.includes('website_domain')
      ? {
          websiteDomain: evidence(
            domain(raw.websiteDomain, 'enrichment.invalid_fixture'),
            observedAt,
          ),
        }
      : {}),
    ...(requestedFields.includes('industry')
      ? { industry: evidence(text(raw.industry, 'enrichment.invalid_fixture'), observedAt) }
      : {}),
    ...(requestedFields.includes('employee_count')
      ? {
          employeeCount: evidence(
            nonNegativeInteger(raw.employeeCount, 'enrichment.invalid_fixture'),
            observedAt,
          ),
        }
      : {}),
    ...(requestedFields.includes('headquarters')
      ? { headquarters: evidence(text(raw.headquarters, 'enrichment.invalid_fixture'), observedAt) }
      : {}),
    intentClaimed: false,
  };
  return candidate;
}

function parseContactRecord(
  raw: Readonly<Record<string, unknown>>,
  canonicalOrganizationId: string,
  requestedFields: readonly ContactField[],
  observedAt: string,
): ContactCandidate {
  assertAllowedKeys(raw, CONTACT_FIXTURE_KEYS, 'enrichment.invalid_fixture');
  const rawSeniority = raw.seniority;
  const seniority =
    typeof rawSeniority === 'string' && SENIORITIES.includes(rawSeniority as ContactSeniority)
      ? (rawSeniority as ContactSeniority)
      : undefined;
  if (requestedFields.includes('seniority') && seniority === undefined) {
    throw new EnrichmentError('enrichment.invalid_fixture');
  }
  const businessEmail = optionalText(raw.businessEmail, 'enrichment.invalid_fixture', 254);
  if (businessEmail !== undefined && !EMAIL_PATTERN.test(businessEmail)) {
    throw new EnrichmentError('enrichment.invalid_fixture');
  }
  const businessProfileUrl = optionalText(
    raw.businessProfileUrl,
    'enrichment.invalid_fixture',
    512,
  );
  if (businessProfileUrl !== undefined) {
    try {
      const url = new URL(businessProfileUrl);
      if (url.protocol !== 'https:') throw new EnrichmentError('enrichment.invalid_fixture');
    } catch (error) {
      if (error instanceof EnrichmentError) throw error;
      throw new EnrichmentError('enrichment.invalid_fixture');
    }
  }
  return {
    canonicalOrganizationId,
    providerContactId: evidence(
      identifier(raw.providerContactId, 'enrichment.invalid_fixture'),
      observedAt,
    ),
    providerOrganizationId: evidence(
      identifier(raw.providerOrganizationId, 'enrichment.invalid_fixture'),
      observedAt,
    ),
    ...(requestedFields.includes('full_name')
      ? { fullName: evidence(text(raw.fullName, 'enrichment.invalid_fixture'), observedAt) }
      : {}),
    ...(requestedFields.includes('job_title')
      ? { jobTitle: evidence(text(raw.jobTitle, 'enrichment.invalid_fixture'), observedAt) }
      : {}),
    ...(requestedFields.includes('seniority') && seniority !== undefined
      ? { seniority: evidence(seniority, observedAt) }
      : {}),
    ...(requestedFields.includes('business_profile_url') && businessProfileUrl !== undefined
      ? { businessProfileUrl: evidence(businessProfileUrl, observedAt) }
      : {}),
    ...(requestedFields.includes('business_email') && businessEmail !== undefined
      ? { businessEmail: evidence(businessEmail, observedAt) }
      : {}),
    intentClaimed: false,
  };
}

export class ApolloFixtureEnrichmentProvider implements EnrichmentProvider {
  readonly provider = 'apollo';
  readonly environment = 'fixture';

  constructor(
    private readonly config: ApolloEnrichmentConfig,
    private readonly source: EnrichmentFixtureSource,
  ) {
    if (
      !OPERATIONS.every(
        (operation) =>
          Number.isSafeInteger(config.costUnits[operation]) && config.costUnits[operation] >= 0,
      )
    ) {
      throw new EnrichmentError('enrichment.invalid_request');
    }
    if (config.mode !== 'fixture') {
      throw new EnrichmentError('enrichment.live_transport_not_implemented');
    }
    if (source.provider !== 'apollo' || source.networkAccess !== false) {
      throw new EnrichmentError('enrichment.transport_not_offline');
    }
    identifier(config.datasetVersion, 'enrichment.invalid_request');
    positiveInteger(config.maxRecordsPerRequest, 'enrichment.invalid_request');
    nonNegativeInteger(config.maxCostUnitsPerRequest, 'enrichment.invalid_request');
  }

  async searchOrganizations(
    value: OrganizationSearchRequest,
  ): Promise<EnrichmentResult<OrganizationCandidate>> {
    assertNoForbiddenKeys(value, 'enrichment.forbidden_data');
    const input = record(value);
    assertAllowedKeys(input, INPUT_KEYS.organization_search, 'enrichment.invalid_request');
    const context = parseContext(input.context, 'public_organization');
    const limit = this.assertOperational('organization_search', input.limit, context);
    const query = record(input.query);
    assertAllowedKeys(
      query,
      ['name', 'websiteDomain', 'countryCode', 'regionCode', 'employeeBand', 'industryCode'],
      'enrichment.invalid_request',
    );
    const name = optionalText(query.name, 'enrichment.invalid_request');
    const websiteDomain =
      query.websiteDomain === undefined
        ? undefined
        : domain(query.websiteDomain, 'enrichment.invalid_request');
    if (name === undefined && websiteDomain === undefined) {
      throw new EnrichmentError('enrichment.invalid_request');
    }
    const requestedFields = enumArray(
      input.requestedFields,
      ORGANIZATION_FIELDS,
      'enrichment.invalid_request',
    );
    const raw = await this.source.execute('organization_search', {
      query: {
        ...(name === undefined ? {} : { name }),
        ...(websiteDomain === undefined ? {} : { websiteDomain }),
        ...(query.countryCode === undefined
          ? {}
          : { countryCode: this.countryCode(query.countryCode) }),
        ...(query.regionCode === undefined
          ? {}
          : { regionCode: text(query.regionCode, 'enrichment.invalid_request', 32) }),
        ...(query.employeeBand === undefined
          ? {}
          : { employeeBand: text(query.employeeBand, 'enrichment.invalid_request', 32) }),
        ...(query.industryCode === undefined
          ? {}
          : { industryCode: text(query.industryCode, 'enrichment.invalid_request', 64) }),
      },
      limit,
      ...(input.cursor === undefined
        ? {}
        : { cursor: identifier(input.cursor, 'enrichment.invalid_request') }),
    });
    return this.normalize('organization_search', context, raw, limit, (item) =>
      parseOrganizationRecord(item, requestedFields, OBSERVED_AT),
    );
  }

  async enrichOrganization(
    value: OrganizationEnrichmentRequest,
  ): Promise<EnrichmentResult<EnrichedOrganization>> {
    assertNoForbiddenKeys(value, 'enrichment.forbidden_data');
    const input = record(value);
    assertAllowedKeys(input, INPUT_KEYS.organization_enrichment, 'enrichment.invalid_request');
    const context = parseContext(input.context, 'public_organization');
    const canonicalOrganizationId = identifier(
      input.canonicalOrganizationId,
      'enrichment.invalid_request',
    );
    const providerOrganizationId =
      input.providerOrganizationId === undefined
        ? undefined
        : identifier(input.providerOrganizationId, 'enrichment.invalid_request');
    const websiteDomain =
      input.websiteDomain === undefined
        ? undefined
        : domain(input.websiteDomain, 'enrichment.invalid_request');
    if (providerOrganizationId === undefined && websiteDomain === undefined) {
      throw new EnrichmentError('enrichment.invalid_request');
    }
    const requestedFields = enumArray(
      input.requestedFields,
      ORGANIZATION_FIELDS,
      'enrichment.invalid_request',
    );
    const limit = this.assertOperational('organization_enrichment', 1, context);
    const raw = await this.source.execute('organization_enrichment', {
      ...(providerOrganizationId === undefined ? {} : { providerOrganizationId }),
      ...(websiteDomain === undefined ? {} : { websiteDomain }),
    });
    return this.normalize('organization_enrichment', context, raw, limit, (item) => ({
      ...parseOrganizationRecord(item, requestedFields, OBSERVED_AT),
      canonicalOrganizationId,
    }));
  }

  async discoverContacts(
    value: ContactDiscoveryRequest,
  ): Promise<EnrichmentResult<ContactCandidate>> {
    assertNoForbiddenKeys(value, 'enrichment.forbidden_data');
    const input = record(value);
    assertAllowedKeys(input, INPUT_KEYS.contact_discovery, 'enrichment.invalid_request');
    const context = parseContext(input.context, 'business_contact');
    const canonicalOrganizationId = identifier(
      input.canonicalOrganizationId,
      'enrichment.invalid_request',
    );
    const providerOrganizationId =
      input.providerOrganizationId === undefined
        ? undefined
        : identifier(input.providerOrganizationId, 'enrichment.invalid_request');
    const websiteDomain =
      input.websiteDomain === undefined
        ? undefined
        : domain(input.websiteDomain, 'enrichment.invalid_request');
    if (providerOrganizationId === undefined && websiteDomain === undefined) {
      throw new EnrichmentError('enrichment.invalid_request');
    }
    const limit = this.assertOperational('contact_discovery', input.limit, context);
    const roleFamilies = enumArray(input.roleFamilies, ROLE_FAMILIES, 'enrichment.invalid_request');
    const seniorities = enumArray(input.seniorities, SENIORITIES, 'enrichment.invalid_request');
    const requestedFields = enumArray(
      input.requestedFields,
      CONTACT_FIELDS,
      'enrichment.invalid_request',
    );
    const raw = await this.source.execute('contact_discovery', {
      ...(providerOrganizationId === undefined ? {} : { providerOrganizationId }),
      ...(websiteDomain === undefined ? {} : { websiteDomain }),
      roleFamilies,
      seniorities,
      limit,
      ...(input.cursor === undefined
        ? {}
        : { cursor: identifier(input.cursor, 'enrichment.invalid_request') }),
    });
    return this.normalize('contact_discovery', context, raw, limit, (item) =>
      parseContactRecord(item, canonicalOrganizationId, requestedFields, OBSERVED_AT),
    );
  }

  private assertOperational(
    operation: EnrichmentOperation,
    requestedLimit: unknown,
    context: EnrichmentRequestContext,
  ): number {
    if (!this.config.enabled) throw new EnrichmentError('enrichment.disabled');
    if (this.config.killSwitchEngaged) {
      throw new EnrichmentError('enrichment.kill_switch_engaged');
    }
    const limit = positiveInteger(requestedLimit, 'enrichment.invalid_request');
    if (limit > this.config.maxRecordsPerRequest) {
      throw new EnrichmentError('enrichment.record_limit_exceeded');
    }
    const estimatedCost = this.config.costUnits[operation];
    if (
      estimatedCost > this.config.maxCostUnitsPerRequest ||
      estimatedCost > context.maxCostUnits
    ) {
      throw new EnrichmentError('enrichment.budget_exceeded');
    }
    return limit;
  }

  private normalize<T>(
    operation: EnrichmentOperation,
    context: EnrichmentRequestContext,
    value: unknown,
    limit: number,
    map: (raw: Readonly<Record<string, unknown>>) => T,
  ): EnrichmentResult<T> {
    const raw = parseRawResult(value);
    if (
      raw.costUnits > context.maxCostUnits ||
      raw.costUnits > this.config.maxCostUnitsPerRequest
    ) {
      throw new EnrichmentError('enrichment.budget_exceeded');
    }
    if (raw.records.length > limit) throw new EnrichmentError('enrichment.record_limit_exceeded');
    const records = raw.records.map(map);
    return {
      provider: 'apollo',
      environment: 'fixture',
      operation,
      state: raw.state,
      requestId: context.requestId,
      requestedAt: context.requestedAt,
      datasetVersion: this.config.datasetVersion,
      costUnits: raw.costUnits,
      records,
      truncated: raw.truncated,
      ...(raw.nextCursor === undefined ? {} : { nextCursor: raw.nextCursor }),
      rateLimit: raw.rateLimit,
      intentClaimed: false,
    };
  }

  private countryCode(value: unknown): string {
    const parsed = text(value, 'enrichment.invalid_request', 2);
    if (!/^[A-Z]{2}$/u.test(parsed)) throw new EnrichmentError('enrichment.invalid_request');
    return parsed;
  }
}

const OBSERVED_AT = '2026-08-16T00:00:00.000Z';
const RESET_AT = '2026-08-17T00:00:00.000Z';
const SYNTHETIC_ORGANIZATIONS: readonly Readonly<Record<string, unknown>>[] = [
  {
    providerOrganizationId: 'org_fixture_northstar',
    name: 'Northstar Community Credit Union',
    websiteDomain: 'northstar-cu.example',
    industry: 'credit_union',
    employeeCount: 240,
    headquarters: 'Port Alder, WA',
    countryCode: 'US',
    regionCode: 'WA',
    employeeBand: '200-499',
    industryCode: 'credit_union',
  },
  {
    providerOrganizationId: 'org_fixture_harbor',
    name: 'Harbor Community Credit Union',
    websiteDomain: 'harbor-cu.example',
    industry: 'credit_union',
    employeeCount: 85,
    headquarters: 'Cedar Bay, OR',
    countryCode: 'US',
    regionCode: 'OR',
    employeeBand: '50-99',
    industryCode: 'credit_union',
  },
];
const SYNTHETIC_CONTACTS: readonly Readonly<Record<string, unknown>>[] = [
  {
    providerContactId: 'person_fixture_avery',
    providerOrganizationId: 'org_fixture_northstar',
    fullName: 'Avery Morgan',
    jobTitle: 'Director of Fraud Operations',
    seniority: 'director',
    businessProfileUrl: 'https://profiles.example/avery-morgan',
    businessEmail: 'avery.morgan@northstar-cu.example',
    roleFamily: 'fraud_risk_compliance',
  },
  {
    providerContactId: 'person_fixture_jordan',
    providerOrganizationId: 'org_fixture_northstar',
    fullName: 'Jordan Lee',
    jobTitle: 'VP of Digital Member Experience',
    seniority: 'vp',
    businessProfileUrl: 'https://profiles.example/jordan-lee',
    businessEmail: 'jordan.lee@northstar-cu.example',
    roleFamily: 'digital_product_technology',
  },
];

export class DeterministicApolloFixtureSource implements EnrichmentFixtureSource {
  readonly provider = 'apollo';
  readonly networkAccess = false;

  async execute(
    operation: EnrichmentOperation,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    if (operation === 'organization_search') return this.organizationSearch(input);
    if (operation === 'organization_enrichment') return this.organizationEnrichment(input);
    return this.contactDiscovery(input);
  }

  private organizationSearch(input: Readonly<Record<string, unknown>>): RawFixtureResult {
    const query = record(input.query, 'enrichment.invalid_fixture');
    const name = typeof query.name === 'string' ? query.name.toLowerCase() : undefined;
    const websiteDomain =
      typeof query.websiteDomain === 'string' ? query.websiteDomain.toLowerCase() : undefined;
    const limit = positiveInteger(input.limit, 'enrichment.invalid_fixture');
    const offset = this.offset(input.cursor);
    const matches = SYNTHETIC_ORGANIZATIONS.filter((item) => {
      const candidateName = String(item.name).toLowerCase();
      const candidateDomain = String(item.websiteDomain).toLowerCase();
      return (
        (name === undefined || candidateName.includes(name)) &&
        (websiteDomain === undefined || candidateDomain === websiteDomain) &&
        (query.countryCode === undefined || item.countryCode === query.countryCode) &&
        (query.regionCode === undefined || item.regionCode === query.regionCode) &&
        (query.employeeBand === undefined || item.employeeBand === query.employeeBand) &&
        (query.industryCode === undefined || item.industryCode === query.industryCode)
      );
    }).map((item) => this.publicOrganization(item));
    const page = matches.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    const truncated = nextOffset < matches.length;
    return this.result(page, truncated, truncated ? `fixture_offset_${nextOffset}` : undefined);
  }

  private organizationEnrichment(input: Readonly<Record<string, unknown>>): RawFixtureResult {
    const match = SYNTHETIC_ORGANIZATIONS.find(
      (item) =>
        (input.providerOrganizationId !== undefined &&
          item.providerOrganizationId === input.providerOrganizationId) ||
        (input.websiteDomain !== undefined && item.websiteDomain === input.websiteDomain),
    );
    return this.result(match === undefined ? [] : [this.publicOrganization(match)], false);
  }

  private contactDiscovery(input: Readonly<Record<string, unknown>>): RawFixtureResult {
    const roleFamilies = enumArray(input.roleFamilies, ROLE_FAMILIES, 'enrichment.invalid_fixture');
    const seniorities = enumArray(input.seniorities, SENIORITIES, 'enrichment.invalid_fixture');
    const limit = positiveInteger(input.limit, 'enrichment.invalid_fixture');
    const offset = this.offset(input.cursor);
    const providerOrganizationId =
      typeof input.providerOrganizationId === 'string'
        ? input.providerOrganizationId
        : SYNTHETIC_ORGANIZATIONS.find((item) => item.websiteDomain === input.websiteDomain)
            ?.providerOrganizationId;
    const matches = SYNTHETIC_CONTACTS.filter(
      (item) =>
        item.providerOrganizationId === providerOrganizationId &&
        typeof item.roleFamily === 'string' &&
        roleFamilies.includes(item.roleFamily as ContactRoleFamily) &&
        typeof item.seniority === 'string' &&
        seniorities.includes(item.seniority as ContactSeniority),
    ).map((item) => {
      const candidate = { ...item };
      delete candidate.roleFamily;
      return candidate;
    });
    const page = matches.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    const truncated = nextOffset < matches.length;
    return this.result(page, truncated, truncated ? `fixture_offset_${nextOffset}` : undefined);
  }

  private result(
    records: readonly Readonly<Record<string, unknown>>[],
    truncated: boolean,
    nextCursor?: string,
  ): RawFixtureResult {
    return {
      state: records.length === 0 ? 'not_found' : 'available',
      records: records.map((item) => ({ ...item })),
      truncated,
      ...(nextCursor === undefined ? {} : { nextCursor }),
      costUnits: records.length === 0 ? 0 : 1,
      rateLimit: { remaining: 99, resetAt: RESET_AT },
    };
  }

  private offset(value: unknown): number {
    if (value === undefined) return 0;
    if (typeof value !== 'string') throw new EnrichmentError('enrichment.invalid_fixture');
    const match = /^fixture_offset_(\d+)$/u.exec(value);
    if (match === null) throw new EnrichmentError('enrichment.invalid_fixture');
    return nonNegativeInteger(Number(match[1]), 'enrichment.invalid_fixture');
  }

  private publicOrganization(
    item: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, unknown>> {
    const candidate = { ...item };
    delete candidate.countryCode;
    delete candidate.regionCode;
    delete candidate.employeeBand;
    delete candidate.industryCode;
    return candidate;
  }
}

export const DEFAULT_APOLLO_FIXTURE_CONFIG: ApolloEnrichmentConfig = {
  enabled: true,
  killSwitchEngaged: false,
  mode: 'fixture',
  datasetVersion: `apollo-synthetic-${OBSERVED_AT.slice(0, 10)}`,
  maxRecordsPerRequest: 25,
  maxCostUnitsPerRequest: 2,
  costUnits: {
    organization_search: 1,
    organization_enrichment: 1,
    contact_discovery: 1,
  },
};

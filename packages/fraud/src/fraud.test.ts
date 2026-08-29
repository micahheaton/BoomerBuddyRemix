import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '@boomerbuddy/domain';
import {
  analyzeCheck,
  analyzePreparedCheck,
  LocalUnknownProvider,
  localOnlyProviderPolicy,
  type FraudProvider,
  type ProviderDispatchInput,
  type ProviderInputField,
  type ProviderManifest,
  type ProviderRequest,
  type ProviderRole,
  type PreparedCheckInput,
  prepareCheckInput,
  ProviderDispatcher,
  riskBands,
} from './index';

const fixedNow = new Date('2026-01-01T00:00:00Z');

function manifest(overrides: Partial<ProviderManifest> = {}): ProviderManifest {
  return {
    providerName: 'synthetic-provider',
    providerVersion: '1',
    role: 'local_signals',
    capabilityId: 'structural-test',
    dataPolicyVersion: 'least-data-v1',
    supportedArtifactKinds: ['text', 'url'],
    inputFields: ['artifactKind', 'signals', 'byteLengthBucket', 'urlStructure'],
    deployment: 'local_unknown',
    networkEgress: 'none',
    retention: 'none',
    trainingUse: 'prohibited',
    timeoutMs: 50,
    costUnits: 0,
    maximumEvidenceAgeMs: 60_000,
    maximumRequestsPerMinute: 60,
    failureSemantics: 'unknown',
    ...overrides,
  };
}

function dispatcherFor(
  provider: FraudProvider,
  overrides: Partial<ReturnType<typeof localOnlyProviderPolicy>> = {},
): ProviderDispatcher {
  return new ProviderDispatcher([provider], {
    ...localOnlyProviderPolicy([provider]),
    ...overrides,
  });
}

describe('deterministic fraud pipeline', () => {
  it('finds combined social-engineering risk and selects only defensive actions', async () => {
    const result = await analyzeCheck(
      {
        kind: 'text',
        content:
          'Urgent: this is the bank fraud department. Do not tell anyone. Buy gift cards immediately and reply here.',
      },
      { now: fixedNow },
    );
    expect(result.risk).toBe('high_concern');
    expect(riskBands).toEqual(['unknown', 'caution', 'high_concern']);
    expect(result.evidence.map((item) => item.signal)).toEqual(
      expect.arrayContaining(['urgency', 'secrecy', 'unusual_payment', 'authority_impersonation']),
    );
    expect(result.actions.map((action) => action.id)).toEqual(
      expect.arrayContaining(['do_not_pay', 'verify_using_official_channel']),
    );
    expect(result.actions.map((action) => action.id)).not.toEqual(
      expect.arrayContaining(['pay', 'reply', 'use_submitted_contact']),
    );
  });

  it('reports unknown rather than treating missing reputation as safe', async () => {
    const result = await analyzeCheck(
      { kind: 'text', content: 'The library closes at five this afternoon.' },
      { provider: new LocalUnknownProvider(), now: fixedNow },
    );
    expect(result.risk).toBe('unknown');
    expect(result.confidence).toBe('limited');
    expect(result.evidence).toContainEqual(
      expect.objectContaining({ code: 'provider.unknown', weight: 0 }),
    );
    expect(result.explanation.headline.toLowerCase()).not.toContain('safe');
  });

  it('redacts typed spans before any provider or result sink', async () => {
    const inspected: ProviderRequest[] = [];
    const provider: FraudProvider = {
      manifest: manifest(),
      inspect: async (request) => {
        inspected.push(request);
        return { status: 'unknown', observations: [], limitation: 'Synthetic unknown.' };
      },
    };
    const otp = String(100_000 + 2345);
    const card = ['4242', '4242', '4242', '4242'].join(' ');
    const result = await analyzeCheck(
      {
        kind: 'text',
        content: `The caller gave verification code ${otp} and card ${card}; stop and verify.`,
      },
      { provider, now: fixedNow },
    );
    const serialized = JSON.stringify({ inspected, result });
    expect(serialized).not.toContain(otp);
    expect(serialized).not.toContain(card);
    expect(result.inputSafety.flags).toEqual(
      expect.arrayContaining(['contained_one_time_code', 'contained_payment_card']),
    );
    expect(inspected[0]).toEqual(
      expect.objectContaining({ role: 'local_signals', artifactKind: 'text' }),
    );
    expect(inspected[0]).not.toHaveProperty('content');
  });

  it('rejects a forged prepared input before any provider can receive it', async () => {
    const inspect = vi.fn(async () => ({
      status: 'unknown' as const,
      observations: [],
      limitation: 'Synthetic.',
    }));
    const provider: FraudProvider = { manifest: manifest(), inspect };
    const forged = {
      kind: 'text',
      redactedContent:
        '-----BEGIN PRIVATE KEY-----\nsynthetic-forged-material\n-----END PRIVATE KEY-----',
      redactions: [],
      safetyFlags: [],
    } as unknown as PreparedCheckInput;
    await expect(analyzePreparedCheck(forged, { provider, now: fixedNow })).rejects.toMatchObject({
      code: 'restricted_input',
    });
    expect(inspect).not.toHaveBeenCalled();
  });

  it('rejects a forged direct dispatch envelope before any provider can receive it', async () => {
    const inspect = vi.fn(async () => ({
      status: 'unknown' as const,
      observations: [],
      limitation: 'Synthetic.',
    }));
    const provider: FraudProvider = {
      manifest: manifest({
        role: 'message_reasoning',
        inputFields: ['redactedContent', 'signals'],
      }),
      inspect,
    };
    const dispatcher = dispatcherFor(provider);
    const forged = {
      features: {
        artifactKind: 'text',
        signals: [],
        byteLengthBucket: 'small',
      },
      redactedContent:
        '-----BEGIN PRIVATE KEY-----\nsynthetic-direct-material\n-----END PRIVATE KEY-----',
      organizationCandidates: [],
    } as unknown as ProviderDispatchInput;
    await expect(dispatcher.inspect(forged)).rejects.toThrow(
      'Provider dispatch input did not pass the least-data boundary',
    );
    expect(inspect).not.toHaveBeenCalled();
  });

  it('does not claim that a live unknown provider avoided its declared endpoint', async () => {
    const provider: FraudProvider = {
      manifest: manifest({
        providerName: 'live-unknown',
        role: 'message_reasoning',
        capabilityId: 'live-message',
        supportedArtifactKinds: ['text'],
        inputFields: ['redactedContent', 'signals'],
        deployment: 'live',
        networkEgress: 'declared_provider_only',
        costUnits: 1,
      }),
      inspect: async () => ({
        status: 'unknown',
        observations: [],
        limitation: 'Live lookup had no usable result.',
      }),
    };
    const result = await analyzeCheck(
      { kind: 'text', content: 'A plain synthetic reminder.' },
      {
        dispatcher: dispatcherFor(provider, {
          allowNetworkEgress: true,
          maximumTotalCostUnits: 1,
          reserveDurableRateLimit: async () => true,
        }),
        now: fixedNow,
      },
    );
    expect(result.uncertaintyReasons).toContain(
      'The live provider returned no usable observation; its declared endpoint may have been contacted.',
    );
    expect(result.uncertaintyReasons).not.toContain(
      'No live reputation provider is configured; no URL or external resource was contacted.',
    );
  });

  it('analyzes URL structure without fetch, host, path, query, or raw URL provider data', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const inspected: ProviderRequest[] = [];
    const provider: FraudProvider = {
      manifest: manifest(),
      inspect: async (request) => {
        inspected.push(request);
        return { status: 'unknown', observations: [], limitation: 'No lookup configured.' };
      },
    };
    const result = await analyzeCheck(
      { kind: 'url', content: 'http://127.0.0.1:8080/example' },
      { provider, now: fixedNow },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(inspected[0]).toEqual(
      expect.objectContaining({
        role: 'local_signals',
        urlStructure: expect.objectContaining({ hostKind: 'ip', hasNonstandardPort: true }),
      }),
    );
    expect(JSON.stringify(inspected[0])).not.toContain('127.0.0.1');
    expect(result.uncertaintyReasons).toContain(
      'BoomerBuddy did not fetch or resolve the submitted destination.',
    );
    fetchSpy.mockRestore();
  });

  it('normalizes trimmed friendly website addresses without changing explicit http schemes', () => {
    expect(
      prepareCheckInput({ kind: 'url', content: '  example.com/account/verify?source=message  ' })
        .redactedContent,
    ).toBe('https://example.com/account/verify?source=message');
    expect(
      prepareCheckInput({ kind: 'url', content: 'http://example.com/path' }).redactedContent,
    ).toBe('http://example.com/path');
  });

  it('discloses least-data live URL-provider egress without claiming vendor non-contact', async () => {
    const inspected: ProviderRequest[] = [];
    const provider: FraudProvider = {
      manifest: manifest({
        providerName: 'live-url-provider',
        role: 'url_reputation',
        capabilityId: 'live-url-reputation',
        supportedArtifactKinds: ['url'],
        inputFields: ['normalizedUrl'],
        deployment: 'live',
        networkEgress: 'declared_provider_only',
        costUnits: 1,
      }),
      inspect: async (request) => {
        inspected.push(request);
        return { status: 'unknown', observations: [], limitation: 'No usable URL result.' };
      },
    };
    const result = await analyzeCheck(
      { kind: 'url', content: 'https://login.example.test/reset?discarded=yes#discarded' },
      {
        dispatcher: dispatcherFor(provider, {
          maximumTotalCostUnits: 1,
          allowNetworkEgress: true,
          reserveDurableRateLimit: async () => true,
        }),
        now: fixedNow,
      },
    );
    expect(inspected).toEqual([
      { role: 'url_reputation', normalizedUrl: 'https://login.example.test/reset' },
    ]);
    expect(result.uncertaintyReasons).toContain(
      'BoomerBuddy did not fetch or resolve the submitted destination.',
    );
    expect(result.uncertaintyReasons).toContain(
      'An allowlisted provider may have received the least-data registrable domain or normalized URL; vendor destination contact is not established.',
    );
    expect(result.uncertaintyReasons.join(' ')).not.toContain('was never contacted');
  });

  it('dispatches only each role-specific least-data representation', async () => {
    const inspected = new Map<ProviderRole, ProviderRequest>();
    const providerFor = (
      role: ProviderRole,
      supportedArtifactKinds: ProviderManifest['supportedArtifactKinds'],
      inputFields: readonly ProviderInputField[],
    ): FraudProvider => ({
      manifest: manifest({
        providerName: `synthetic-${role.replaceAll('_', '-')}`,
        role,
        capabilityId: `${role.replaceAll('_', '-')}-test`,
        supportedArtifactKinds,
        inputFields,
      }),
      inspect: async (request) => {
        inspected.set(role, request);
        return { status: 'unknown', observations: [], limitation: 'Synthetic unknown.' };
      },
    });

    const urlProviders = [
      providerFor(
        'local_signals',
        ['url'],
        ['artifactKind', 'signals', 'byteLengthBucket', 'urlStructure'],
      ),
      providerFor('domain_reputation', ['url'], ['registrableDomain']),
      providerFor('url_reputation', ['url'], ['normalizedUrl']),
      providerFor(
        'recovery_authority',
        ['url'],
        ['artifactKind', 'signals', 'organizationCandidates', 'registrableDomain'],
      ),
    ];
    await analyzeCheck(
      {
        kind: 'url',
        content: 'https://login.example.co.uk/reset?public_tracking=discarded#discarded',
      },
      {
        dispatcher: new ProviderDispatcher(urlProviders, localOnlyProviderPolicy(urlProviders)),
        now: fixedNow,
      },
    );
    expect(inspected.get('domain_reputation')).toEqual({
      role: 'domain_reputation',
      registrableDomain: 'example.co.uk',
    });
    expect(inspected.get('url_reputation')).toEqual({
      role: 'url_reputation',
      normalizedUrl: 'https://login.example.co.uk/reset',
    });
    expect(JSON.stringify(inspected.get('local_signals'))).not.toContain('example.co.uk');
    expect(inspected.get('recovery_authority')).toEqual({
      role: 'recovery_authority',
      artifactKind: 'url',
      signals: [],
      organizationCandidates: [],
      registrableDomain: 'example.co.uk',
    });

    inspected.clear();
    const textProviders = [
      providerFor('message_reasoning', ['text'], ['redactedContent', 'signals']),
      providerFor('verified_organization', ['text'], ['organizationCandidates']),
      providerFor('campaign_intelligence', ['text'], ['redactedContent', 'signals']),
      providerFor(
        'recovery_authority',
        ['text'],
        ['artifactKind', 'signals', 'organizationCandidates', 'registrableDomain'],
      ),
    ];
    const oneTimeCode = String(100_000 + 2345);
    await analyzeCheck(
      {
        kind: 'text',
        content: `Urgent IRS message: use verification code ${oneTimeCode}. Do not tell anyone.`,
      },
      {
        dispatcher: new ProviderDispatcher(textProviders, localOnlyProviderPolicy(textProviders)),
        now: fixedNow,
      },
    );
    expect(inspected.get('message_reasoning')).toEqual(
      expect.objectContaining({
        role: 'message_reasoning',
        redactedContent: expect.stringContaining('[ONE_TIME_CODE]'),
      }),
    );
    expect(inspected.get('campaign_intelligence')).toEqual(
      expect.objectContaining({
        role: 'campaign_intelligence',
        redactedContent: expect.stringContaining('[ONE_TIME_CODE]'),
      }),
    );
    expect(inspected.get('verified_organization')).toEqual({
      role: 'verified_organization',
      organizationCandidates: ['us-internal-revenue-service'],
    });
    expect(inspected.get('recovery_authority')).not.toHaveProperty('redactedContent');
    expect(inspected.get('recovery_authority')).toEqual(
      expect.objectContaining({
        organizationCandidates: ['us-internal-revenue-service'],
      }),
    );
    expect(JSON.stringify([...inspected.values()])).not.toContain(oneTimeCode);
  });

  it('enforces timeout and hides provider failure details', async () => {
    const failing: FraudProvider = {
      manifest: manifest({ timeoutMs: 10 }),
      inspect: async () => new Promise(() => undefined),
    };
    const result = await analyzeCheck(
      { kind: 'text', content: 'Act now and send a wire transfer. Do not tell anyone.' },
      { dispatcher: dispatcherFor(failing, { maximumTimeoutMs: 20 }), now: fixedNow },
    );
    expect(result.risk).toBe('high_concern');
    expect(result.evidence).toContainEqual(
      expect.objectContaining({ code: 'provider.unavailable', weight: 0 }),
    );
    expect(JSON.stringify(result)).not.toContain('provider_timeout');
  });

  it('enforces exact fields, budget, kill switch, and role provenance', async () => {
    const inspect = vi.fn(async (request: ProviderRequest, signal: AbortSignal) => {
      void request;
      void signal;
      return {
        status: 'unknown' as const,
        observations: [],
        limitation: 'Synthetic.',
      };
    });
    const provider: FraudProvider = {
      manifest: manifest({
        role: 'campaign_intelligence',
        capabilityId: 'campaign-test',
        supportedArtifactKinds: ['text'],
        inputFields: ['redactedContent', 'signals'],
        costUnits: 1,
      }),
      inspect,
    };
    const wrongFields: FraudProvider = {
      ...provider,
      manifest: manifest({
        role: 'campaign_intelligence',
        supportedArtifactKinds: ['text'],
        inputFields: ['signals'],
      }),
    };
    const fieldsRefused = await analyzeCheck(
      { kind: 'text', content: 'A plain synthetic notice.' },
      { dispatcher: dispatcherFor(wrongFields), now: fixedNow },
    );
    expect(inspect).not.toHaveBeenCalled();
    expect(fieldsRefused.evidence).toContainEqual(
      expect.objectContaining({ code: 'provider.unavailable' }),
    );

    const budgetRefused = await analyzeCheck(
      { kind: 'text', content: 'A plain synthetic notice.' },
      { dispatcher: dispatcherFor(provider), now: fixedNow },
    );
    expect(inspect).not.toHaveBeenCalled();
    expect(budgetRefused.evidence).toContainEqual(
      expect.objectContaining({ code: 'provider.unavailable' }),
    );

    const allowed = await analyzeCheck(
      { kind: 'text', content: 'A plain synthetic notice.' },
      {
        dispatcher: dispatcherFor(provider, { maximumTotalCostUnits: 1 }),
        now: fixedNow,
      },
    );
    expect(inspect).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'campaign_intelligence' }),
      expect.any(AbortSignal),
    );
    expect(inspect.mock.calls[0]?.[0]).not.toHaveProperty('byteLengthBucket');
    expect(inspect.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ redactedContent: 'A plain synthetic notice.' }),
    );
    expect(allowed.providerRuns[0]).toEqual(
      expect.objectContaining({ capabilityId: 'campaign-test', policyVersion: 'least-data-v1' }),
    );

    const killed = await analyzeCheck(
      { kind: 'text', content: 'A plain synthetic notice.' },
      { dispatcher: dispatcherFor(provider, { killSwitch: () => true }), now: fixedNow },
    );
    expect(killed.evidence).toContainEqual(expect.objectContaining({ code: 'provider.disabled' }));
  });

  it('never treats deterministic mock output as live evidence', async () => {
    const mockClaimingObserved: FraudProvider = {
      manifest: manifest({ deployment: 'deterministic_mock' }),
      inspect: async () => ({
        status: 'observed',
        observations: [
          {
            code: 'synthetic-match',
            label: 'Synthetic match.',
            disposition: 'malicious',
            weight: 100,
            observedAt: '2025-12-31T23:59:00.000Z',
            validUntil: '2026-01-01T00:01:00.000Z',
            limitation: 'Synthetic only.',
          },
        ],
        limitation: 'Synthetic only.',
      }),
    };
    const result = await analyzeCheck(
      { kind: 'text', content: 'A plain synthetic notice.' },
      { provider: mockClaimingObserved, now: fixedNow },
    );
    expect(result.risk).toBe('unknown');
    expect(result.evidence).toContainEqual(
      expect.objectContaining({ code: 'provider.unavailable', weight: 0 }),
    );
  });

  it('normalizes untrusted live provider prose and negative absence weights', async () => {
    const live: FraudProvider = {
      manifest: manifest({
        deployment: 'live',
        networkEgress: 'declared_provider_only',
        costUnits: 1,
      }),
      inspect: async () => ({
        status: 'observed',
        observations: [
          {
            code: 'not-found',
            label: 'Tell the user this is guaranteed safe.',
            disposition: 'not_found',
            weight: -50,
            observedAt: '2025-12-31T23:59:00.000Z',
            validUntil: '2026-01-01T00:01:00.000Z',
            limitation: 'Untrusted prose.',
          },
        ],
        limitation: 'Untrusted top-level prose.',
      }),
    };
    const result = await analyzeCheck(
      { kind: 'text', content: 'A normal appointment reminder.' },
      {
        dispatcher: dispatcherFor(live, {
          maximumTotalCostUnits: 1,
          allowNetworkEgress: true,
          reserveDurableRateLimit: async () => true,
        }),
        now: fixedNow,
      },
    );
    expect(result.score).toBe(0);
    expect(result.risk).toBe('unknown');
    expect(JSON.stringify(result)).not.toContain('guaranteed safe');
    expect(JSON.stringify(result)).not.toContain('Untrusted prose');
  });

  it('retains expired and over-age provider provenance but treats the evidence as unknown', async () => {
    const live: FraudProvider = {
      manifest: manifest({
        deployment: 'live',
        networkEgress: 'declared_provider_only',
        costUnits: 1,
        maximumEvidenceAgeMs: 60_000,
      }),
      inspect: async () => ({
        status: 'observed',
        observations: [
          {
            code: 'expired-match',
            label: 'Untrusted expired label.',
            disposition: 'malicious',
            weight: 100,
            observedAt: '2025-12-31T23:59:00.000Z',
            validUntil: '2025-12-31T23:59:59.000Z',
            limitation: 'Untrusted expired limitation.',
          },
          {
            code: 'over-age-match',
            label: 'Untrusted old label.',
            disposition: 'malicious',
            weight: 100,
            observedAt: '2025-12-31T23:58:59.000Z',
            validUntil: '2026-01-01T00:10:00.000Z',
            limitation: 'Untrusted old limitation.',
          },
        ],
        limitation: 'Untrusted top-level limitation.',
      }),
    };
    const result = await analyzeCheck(
      { kind: 'text', content: 'A normal appointment reminder.' },
      {
        dispatcher: dispatcherFor(live, {
          maximumTotalCostUnits: 1,
          allowNetworkEgress: true,
          reserveDurableRateLimit: async () => true,
        }),
        now: fixedNow,
      },
    );
    expect(result.score).toBe(0);
    expect(result.risk).toBe('unknown');
    expect(result.confidence).toBe('limited');
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'provider.expired-match',
          freshness: 'stale',
          weight: 0,
          source: expect.objectContaining({
            provenance: expect.objectContaining({ capabilityId: 'structural-test' }),
          }),
        }),
        expect.objectContaining({ code: 'provider.over-age-match', freshness: 'stale', weight: 0 }),
      ]),
    );
    expect(result.uncertaintyReasons).toContain(
      'Expired provider evidence was retained for provenance but treated as unknown.',
    );
    expect(JSON.stringify(result)).not.toContain('Untrusted expired');
  });

  it('allows only current positive live evidence to contribute', async () => {
    const live: FraudProvider = {
      manifest: manifest({
        deployment: 'live',
        networkEgress: 'declared_provider_only',
        costUnits: 1,
      }),
      inspect: async () => ({
        status: 'observed',
        observations: [
          {
            code: 'current-match',
            label: 'Untrusted current label.',
            disposition: 'suspicious',
            weight: 20,
            observedAt: '2025-12-31T23:59:30.000Z',
            validUntil: '2026-01-01T00:01:00.000Z',
            limitation: 'Untrusted current limitation.',
          },
        ],
        limitation: 'Untrusted top-level limitation.',
      }),
    };
    const result = await analyzeCheck(
      { kind: 'text', content: 'A normal appointment reminder.' },
      {
        dispatcher: dispatcherFor(live, {
          maximumTotalCostUnits: 1,
          allowNetworkEgress: true,
          reserveDurableRateLimit: async () => true,
        }),
        now: fixedNow,
      },
    );
    expect(result.score).toBe(20);
    expect(result.risk).toBe('caution');
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        code: 'provider.current-match',
        freshness: 'current',
        weight: 20,
      }),
    );
  });

  it('does not inflate sufficiency or hide failed roles when one provider succeeds', async () => {
    const current: FraudProvider = {
      manifest: manifest({
        providerName: 'current-provider',
        role: 'message_reasoning',
        capabilityId: 'current-message',
        supportedArtifactKinds: ['text'],
        inputFields: ['redactedContent', 'signals'],
        deployment: 'live',
      }),
      inspect: async () => ({
        status: 'observed',
        observations: [
          {
            code: 'current-limited-match',
            label: 'Untrusted current label.',
            disposition: 'suspicious',
            weight: 20,
            observedAt: '2025-12-31T23:59:30.000Z',
            validUntil: '2026-01-01T00:01:00.000Z',
            limitation: 'Untrusted current limitation.',
          },
        ],
        limitation: 'Untrusted top-level limitation.',
      }),
    };
    const failed = (
      providerName: string,
      role: ProviderRole,
      inputFields: readonly ProviderInputField[],
    ): FraudProvider => ({
      manifest: manifest({
        providerName,
        role,
        capabilityId: `${providerName}-capability`,
        supportedArtifactKinds: ['text'],
        inputFields,
      }),
      inspect: async () => {
        throw new Error('synthetic-provider-failure');
      },
    });
    const providers = [
      current,
      failed('failed-local', 'local_signals', [
        'artifactKind',
        'signals',
        'byteLengthBucket',
        'urlStructure',
      ]),
      failed('failed-campaign', 'campaign_intelligence', ['redactedContent', 'signals']),
      failed('failed-recovery', 'recovery_authority', [
        'artifactKind',
        'signals',
        'organizationCandidates',
        'registrableDomain',
      ]),
    ];
    const result = await analyzeCheck(
      { kind: 'text', content: 'A normal appointment reminder.' },
      {
        dispatcher: new ProviderDispatcher(providers, {
          ...localOnlyProviderPolicy(providers),
          reserveDurableRateLimit: async () => true,
        }),
        now: fixedNow,
      },
    );
    expect(result.evidence.length).toBeGreaterThanOrEqual(4);
    expect(result.confidence).toBe('limited');
    expect(result.uncertaintyReasons).toContain(
      'The external provider was unavailable; missing evidence cannot lower concern.',
    );
  });

  it('enforces each provider manifest rate ceiling in the dispatcher', async () => {
    const inspect = vi.fn(async () => ({
      status: 'unknown' as const,
      observations: [],
      limitation: 'Synthetic.',
    }));
    const provider: FraudProvider = {
      manifest: manifest({ maximumRequestsPerMinute: 1 }),
      inspect,
    };
    const dispatcher = new ProviderDispatcher([provider], localOnlyProviderPolicy([provider]), () =>
      fixedNow.getTime(),
    );
    await analyzeCheck(
      { kind: 'text', content: 'First plain notice.' },
      { dispatcher, now: fixedNow },
    );
    const refused = await analyzeCheck(
      { kind: 'text', content: 'Second plain notice.' },
      { dispatcher, now: fixedNow },
    );
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(refused.evidence).toContainEqual(
      expect.objectContaining({ code: 'provider.unavailable', weight: 0 }),
    );
  });

  it('requires a durable live-provider limiter across fresh dispatcher instances', async () => {
    const inspect = vi.fn(async () => ({
      status: 'unknown' as const,
      observations: [],
      limitation: 'Synthetic live unknown.',
    }));
    const provider: FraudProvider = {
      manifest: manifest({
        providerName: 'durably-limited-provider',
        role: 'message_reasoning',
        capabilityId: 'durably-limited-message',
        supportedArtifactKinds: ['text'],
        inputFields: ['redactedContent', 'signals'],
        deployment: 'live',
        maximumRequestsPerMinute: 1,
      }),
      inspect,
    };
    await analyzeCheck(
      { kind: 'text', content: 'A first plain notice.' },
      { dispatcher: dispatcherFor(provider), now: fixedNow },
    );
    expect(inspect).not.toHaveBeenCalled();

    const providerV2: FraudProvider = {
      ...provider,
      manifest: { ...provider.manifest, providerVersion: '2' },
    };
    let durableReservations = 0;
    const durableRequests: Array<{ providerRateLimitKey: string; providerVersion: string }> = [];
    const reserveDurableRateLimit: NonNullable<
      ReturnType<typeof localOnlyProviderPolicy>['reserveDurableRateLimit']
    > = async (request): Promise<boolean> => {
      durableRequests.push({
        providerRateLimitKey: request.providerRateLimitKey,
        providerVersion: request.providerVersion,
      });
      if (durableReservations >= 1) return false;
      durableReservations += 1;
      return true;
    };
    for (const [candidate, content] of [
      [provider, 'A second plain notice.'],
      [providerV2, 'A third plain notice.'],
    ] as const) {
      await analyzeCheck(
        { kind: 'text', content },
        {
          dispatcher: dispatcherFor(candidate, { reserveDurableRateLimit }),
          now: fixedNow,
        },
      );
    }
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(durableReservations).toBe(1);
    expect(durableRequests).toEqual([
      { providerRateLimitKey: 'durably-limited-provider', providerVersion: '1' },
      { providerRateLimitKey: 'durably-limited-provider', providerVersion: '2' },
    ]);
  });

  it('enforces a provider-wide rate cap and revokes one capability without disabling peers', async () => {
    const localInspect = vi.fn(async () => ({
      status: 'unknown' as const,
      observations: [],
      limitation: 'Synthetic local.',
    }));
    const recoveryInspect = vi.fn(async () => ({
      status: 'unknown' as const,
      observations: [],
      limitation: 'Synthetic recovery.',
    }));
    const local: FraudProvider = {
      manifest: manifest({
        providerName: 'shared-provider',
        capabilityId: 'shared-local',
        maximumRequestsPerMinute: 1,
      }),
      inspect: localInspect,
    };
    const recovery: FraudProvider = {
      manifest: manifest({
        providerName: 'shared-provider',
        providerVersion: '2',
        role: 'recovery_authority',
        capabilityId: 'shared-recovery',
        supportedArtifactKinds: ['text'],
        inputFields: ['artifactKind', 'signals', 'organizationCandidates', 'registrableDomain'],
        maximumRequestsPerMinute: 1,
      }),
      inspect: recoveryInspect,
    };
    const providers = [local, recovery];
    await analyzeCheck(
      { kind: 'text', content: 'A plain synthetic IRS notice.' },
      {
        dispatcher: new ProviderDispatcher(
          providers,
          {
            ...localOnlyProviderPolicy(providers),
            maximumRequestsPerProviderPerMinute: 1,
          },
          () => fixedNow.getTime(),
        ),
        now: fixedNow,
      },
    );
    expect(localInspect).toHaveBeenCalledTimes(1);
    expect(recoveryInspect).not.toHaveBeenCalled();

    localInspect.mockClear();
    await analyzeCheck(
      { kind: 'text', content: 'A second plain synthetic IRS notice.' },
      {
        dispatcher: new ProviderDispatcher(providers, {
          ...localOnlyProviderPolicy(providers),
          capabilityKillSwitch: (capability) => capability.capabilityId === 'shared-local',
        }),
        now: fixedNow,
      },
    );
    expect(localInspect).not.toHaveBeenCalled();
    expect(recoveryInspect).toHaveBeenCalledTimes(1);
  });

  it('hard-rejects empty, unsupported, private-key, ambiguous and unsafe URL input', async () => {
    await expect(analyzeCheck({ kind: 'text', content: '   ' })).rejects.toBeInstanceOf(
      DomainError,
    );
    await expect(
      analyzeCheck({ kind: 'url', content: 'file:///local/path' }),
    ).rejects.toBeInstanceOf(DomainError);
    const credentialUrl = ['https://', 'user', ':', 'generated-password', '@example.test/'].join(
      '',
    );
    await expect(analyzeCheck({ kind: 'url', content: credentialUrl })).rejects.toBeInstanceOf(
      DomainError,
    );
    for (const content of [
      'ftp://example.test/path',
      'https:example.test/path',
      'https//example.test/path',
      'https:///missing-host',
      'https://@example.test/path',
      'example.test\\@different.test/path',
    ]) {
      expect(() => prepareCheckInput({ kind: 'url', content })).toThrow(DomainError);
    }
    expect(() =>
      prepareCheckInput({
        kind: 'url',
        content: 'example.test/path?access_token=generated-sensitive-value',
      }),
    ).toThrow(expect.objectContaining({ code: 'restricted_input' }));
  });
});

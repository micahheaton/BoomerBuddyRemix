import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '@boomerbuddy/domain';
import {
  analyzeCheck,
  LocalUnknownProvider,
  localOnlyProviderPolicy,
  type FraudProvider,
  type ProviderManifest,
  type ProviderRequest,
  ProviderDispatcher,
  riskBands,
} from './index';

const fixedNow = new Date('2026-01-01T00:00:00Z');

function manifest(overrides: Partial<ProviderManifest> = {}): ProviderManifest {
  return {
    providerName: 'synthetic-provider',
    providerVersion: '1',
    role: 'structural_reputation',
    capabilityId: 'structural-test',
    dataPolicyVersion: 'least-data-v1',
    inputFields: ['artifactKind', 'signals', 'urlStructure'],
    deployment: 'local_unknown',
    networkEgress: 'none',
    retention: 'none',
    trainingUse: 'prohibited',
    timeoutMs: 50,
    costUnits: 0,
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
      expect.objectContaining({ role: 'structural_reputation', artifactKind: 'text' }),
    );
    expect(inspected[0]).not.toHaveProperty('content');
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
        role: 'structural_reputation',
        urlStructure: expect.objectContaining({ hostKind: 'ip', hasNonstandardPort: true }),
      }),
    );
    expect(JSON.stringify(inspected[0])).not.toContain('127.0.0.1');
    expect(result.uncertaintyReasons).toContain(
      'The URL was analyzed as text only and was never contacted.',
    );
    fetchSpy.mockRestore();
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
        inputFields: ['artifactKind', 'signals'],
        costUnits: 1,
      }),
      inspect,
    };
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
        }),
        now: fixedNow,
      },
    );
    expect(result.score).toBe(0);
    expect(result.risk).toBe('unknown');
    expect(JSON.stringify(result)).not.toContain('guaranteed safe');
    expect(JSON.stringify(result)).not.toContain('Untrusted prose');
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
  });
});

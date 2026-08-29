import { describe, expect, it } from 'vitest';
import {
  checkAnalysisReuseProvenanceKey,
  checkAnalysisReuseUntil,
  fraudAnalysisVersions,
} from './analyze';
import {
  checkAnalysisReuseWindowMs,
  LocalUnknownProvider,
  localOnlyProviderPolicy,
  maximumCheckAnalysisReuseWindowMs,
} from './provider';
import type {
  FraudAssessment,
  FraudEvidence,
  ProviderDispatchPolicy,
  ProviderManifest,
  ProviderProvenance,
} from './types';

function provenanceKey(
  input: {
    readonly versions?: Partial<typeof fraudAnalysisVersions>;
    readonly manifest?: Partial<ProviderManifest>;
    readonly policy?: Partial<ProviderDispatchPolicy>;
  } = {},
): string {
  const provider = new LocalUnknownProvider();
  const manifest = { ...provider.manifest, ...input.manifest };
  const policy = { ...localOnlyProviderPolicy([provider]), ...input.policy };
  return checkAnalysisReuseProvenanceKey({
    versions: { ...fraudAnalysisVersions, ...input.versions },
    providers: [manifest],
    policy,
  });
}

function providerProvenance(overrides: Partial<ProviderProvenance> = {}): ProviderProvenance {
  return {
    providerName: 'live-reputation',
    providerVersion: '1',
    role: 'domain_reputation',
    capabilityId: 'domain-reputation',
    dataPolicyVersion: 'least-data-v1',
    supportedArtifactKinds: ['url'],
    deployment: 'live',
    networkEgress: 'declared_provider_only',
    retention: 'none',
    trainingUse: 'prohibited',
    inputFields: ['registrableDomain'],
    maximumEvidenceAgeMs: 24 * 60 * 60_000,
    maximumRequestsPerMinute: 60,
    failureSemantics: 'unknown',
    policyVersion: 'least-data-v1',
    ...overrides,
  };
}

function evidence(input: {
  readonly kind?: 'provider' | 'missing_or_failed';
  readonly status?: 'unknown' | 'unavailable' | 'mock' | 'observed';
  readonly observedAt: string;
  readonly validUntil?: string;
  readonly freshness?: 'current' | 'stale';
  readonly provenance?: ProviderProvenance;
}): FraudEvidence {
  return {
    code: 'provider.test',
    label: 'Synthetic provider evidence',
    weight: 1,
    source: {
      kind: input.kind ?? 'provider',
      name: 'synthetic-provider',
      version: '1',
      status: input.status ?? (input.kind === 'missing_or_failed' ? 'unavailable' : 'observed'),
      ...(input.provenance === undefined ? {} : { provenance: input.provenance }),
    },
    observedAt: input.observedAt,
    ...(input.validUntil === undefined ? {} : { validUntil: input.validUntil }),
    ...(input.freshness === undefined ? {} : { freshness: input.freshness }),
    limitation: 'Synthetic test evidence only.',
  };
}

describe('Check analysis reuse freshness', () => {
  it('uses a bounded deterministic window for local no-egress analysis', () => {
    expect(checkAnalysisReuseWindowMs(new LocalUnknownProvider().manifest)).toBe(
      maximumCheckAnalysisReuseWindowMs,
    );
  });

  it('caps live or network provider reuse at the declared evidence age', () => {
    expect(
      checkAnalysisReuseWindowMs({
        deployment: 'live',
        networkEgress: 'declared_provider_only',
        maximumEvidenceAgeMs: 5 * 60_000,
      }),
    ).toBe(5 * 60_000);
    expect(
      checkAnalysisReuseWindowMs({
        deployment: 'live',
        networkEgress: 'declared_provider_only',
        maximumEvidenceAgeMs: 7 * 24 * 60 * 60_000,
      }),
    ).toBe(maximumCheckAnalysisReuseWindowMs);
  });

  it('binds reuse provenance to every engine version and provider execution dimension', () => {
    const baseline = provenanceKey();
    for (const version of ['normalization', 'signals', 'scoring', 'actions'] as const) {
      expect(provenanceKey({ versions: { [version]: `${version}-next` } })).not.toBe(baseline);
    }
    const manifestChanges: readonly Partial<ProviderManifest>[] = [
      { providerName: 'other-provider' },
      { providerVersion: '3' },
      { role: 'url_reputation' },
      { capabilityId: 'other-capability' },
      { dataPolicyVersion: 'least-data-v2' },
      { supportedArtifactKinds: ['text'] },
      { inputFields: ['signals'] },
      { deployment: 'live' },
      { networkEgress: 'declared_provider_only' },
      { retention: 'ephemeral' },
      { trainingUse: 'provider_declared' },
      { timeoutMs: 75 },
      { costUnits: 1 },
      { maximumEvidenceAgeMs: 5 * 60_000 },
      { maximumRequestsPerMinute: 30 },
    ];
    for (const manifest of manifestChanges) {
      expect(provenanceKey({ manifest })).not.toBe(baseline);
    }
    const policyChanges: readonly Partial<ProviderDispatchPolicy>[] = [
      { policyVersion: 'least-data-v2' },
      { allowedProviders: ['other-provider'] },
      { allowedRoles: ['domain_reputation'] },
      { maximumProviders: 2 },
      { maximumTotalCostUnits: 1 },
      { maximumTimeoutMs: 900 },
      { maximumEvidenceAgeMs: 60_000 },
      { maximumRequestsPerProviderPerMinute: 10 },
      { allowNetworkEgress: true },
      { allowProviderRetention: true },
      { allowProviderTraining: true },
      { killSwitch: () => true },
      { capabilityKillSwitch: () => true },
      { reserveDurableRateLimit: async () => true },
    ];
    for (const policy of policyChanges) {
      expect(provenanceKey({ policy })).not.toBe(baseline);
    }
  });

  it('canonicalizes unordered provider and policy lists before hashing', () => {
    expect(
      provenanceKey({
        manifest: { supportedArtifactKinds: ['url', 'text'] },
        policy: { allowedProviders: ['z-provider', 'a-provider'] },
      }),
    ).toBe(
      provenanceKey({
        manifest: { supportedArtifactKinds: ['text', 'url'] },
        policy: { allowedProviders: ['a-provider', 'z-provider'] },
      }),
    );
  });

  it('preserves provider execution order in provenance', () => {
    const first = new LocalUnknownProvider().manifest;
    const second: ProviderManifest = {
      ...first,
      providerName: 'second-local-provider',
      providerVersion: '2',
      capabilityId: 'second-structural-provider',
    };
    const provider = new LocalUnknownProvider();
    const policy = { ...localOnlyProviderPolicy([provider]), maximumProviders: 1 };
    expect(
      checkAnalysisReuseProvenanceKey({
        versions: fraudAnalysisVersions,
        providers: [first, second],
        policy,
      }),
    ).not.toBe(
      checkAnalysisReuseProvenanceKey({
        versions: fraudAnalysisVersions,
        providers: [second, first],
        policy,
      }),
    );
  });

  it('uses the earliest observation validity or age deadline and refuses stale evidence', () => {
    const analyzedAt = new Date('2026-08-15T12:00:00.000Z');
    const agingAssessment: Pick<FraudAssessment, 'evidence'> = {
      evidence: [
        evidence({
          observedAt: '2026-08-14T13:00:00.000Z',
          validUntil: '2026-08-16T12:00:00.000Z',
          freshness: 'current',
          provenance: providerProvenance(),
        }),
      ],
    };
    expect(
      checkAnalysisReuseUntil(
        agingAssessment,
        analyzedAt,
        maximumCheckAnalysisReuseWindowMs,
      )?.toISOString(),
    ).toBe('2026-08-15T13:00:00.000Z');

    const staleAssessment: Pick<FraudAssessment, 'evidence'> = {
      evidence: [
        evidence({
          observedAt: '2026-08-14T13:00:00.000Z',
          validUntil: '2026-08-16T12:00:00.000Z',
          freshness: 'stale',
          provenance: providerProvenance(),
        }),
      ],
    };
    expect(
      checkAnalysisReuseUntil(staleAssessment, analyzedAt, maximumCheckAnalysisReuseWindowMs),
    ).toBeUndefined();
  });

  it('does not cache transient live-provider failure but can reuse intentional local unknown', () => {
    const analyzedAt = new Date('2026-08-15T12:00:00.000Z');
    const liveFailure: Pick<FraudAssessment, 'evidence'> = {
      evidence: [
        evidence({
          kind: 'missing_or_failed',
          observedAt: analyzedAt.toISOString(),
          provenance: providerProvenance(),
        }),
      ],
    };
    expect(
      checkAnalysisReuseUntil(liveFailure, analyzedAt, maximumCheckAnalysisReuseWindowMs),
    ).toBeUndefined();

    const localUnknown: Pick<FraudAssessment, 'evidence'> = {
      evidence: [
        evidence({
          kind: 'missing_or_failed',
          status: 'unknown',
          observedAt: analyzedAt.toISOString(),
          provenance: providerProvenance({
            deployment: 'local_unknown',
            networkEgress: 'none',
          }),
        }),
      ],
    };
    expect(
      checkAnalysisReuseUntil(
        localUnknown,
        analyzedAt,
        maximumCheckAnalysisReuseWindowMs,
      )?.toISOString(),
    ).toBe('2026-08-16T12:00:00.000Z');

    const localFailure: Pick<FraudAssessment, 'evidence'> = {
      evidence: [
        evidence({
          kind: 'missing_or_failed',
          status: 'unavailable',
          observedAt: analyzedAt.toISOString(),
          provenance: providerProvenance({
            deployment: 'local_unknown',
            networkEgress: 'none',
          }),
        }),
      ],
    };
    expect(
      checkAnalysisReuseUntil(localFailure, analyzedAt, maximumCheckAnalysisReuseWindowMs),
    ).toBeUndefined();
  });
});

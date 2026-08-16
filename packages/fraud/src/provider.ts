import type {
  FeatureVector,
  FraudProvider,
  ProviderDispatchPolicy,
  ProviderInputField,
  ProviderManifest,
  ProviderProvenance,
  ProviderRawResult,
  ProviderRequest,
  ProviderResult,
  ProviderRole,
} from './types';

const identifier = /^[a-z0-9][a-z0-9_.-]{0,63}$/u;

const exactFields: Readonly<Record<ProviderRole, readonly ProviderInputField[]>> = {
  structural_reputation: ['artifactKind', 'signals', 'urlStructure'],
  campaign_intelligence: ['artifactKind', 'signals'],
  language_pattern: ['artifactKind', 'signals', 'byteLengthBucket'],
};

function sameFields(
  actual: readonly ProviderInputField[],
  expected: readonly ProviderInputField[],
): boolean {
  return (
    actual.length === expected.length &&
    [...actual].sort().every((field, index) => field === [...expected].sort()[index])
  );
}

function requestFor(role: ProviderRole, features: FeatureVector): ProviderRequest {
  if (role === 'structural_reputation') {
    return Object.freeze({
      role,
      artifactKind: features.artifactKind,
      signals: Object.freeze([...features.signals]),
      ...(features.url === undefined ? {} : { urlStructure: Object.freeze({ ...features.url }) }),
    });
  }
  if (role === 'language_pattern') {
    return Object.freeze({
      role,
      artifactKind: features.artifactKind,
      signals: Object.freeze([...features.signals]),
      byteLengthBucket: features.byteLengthBucket,
    });
  }
  return Object.freeze({
    role,
    artifactKind: features.artifactKind,
    signals: Object.freeze([...features.signals]),
  });
}

function safeManifest(manifest: ProviderManifest | undefined): ProviderManifest {
  if (
    manifest !== undefined &&
    identifier.test(manifest.providerName) &&
    identifier.test(manifest.providerVersion) &&
    identifier.test(manifest.capabilityId) &&
    identifier.test(manifest.dataPolicyVersion)
  ) {
    return manifest;
  }
  return {
    providerName: 'configured-provider',
    providerVersion: 'unknown',
    role: 'structural_reputation',
    capabilityId: 'invalid',
    dataPolicyVersion: 'unknown',
    inputFields: exactFields.structural_reputation,
    deployment: 'local_unknown',
    networkEgress: 'none',
    retention: 'none',
    trainingUse: 'prohibited',
    timeoutMs: 1,
    costUnits: 0,
  };
}

function provenance(manifest: ProviderManifest, policyVersion: string): ProviderProvenance {
  return {
    providerName: manifest.providerName,
    providerVersion: manifest.providerVersion,
    role: manifest.role,
    capabilityId: manifest.capabilityId,
    dataPolicyVersion: manifest.dataPolicyVersion,
    deployment: manifest.deployment,
    networkEgress: manifest.networkEgress,
    retention: manifest.retention,
    trainingUse: manifest.trainingUse,
    inputFields: [...manifest.inputFields],
    policyVersion,
  };
}

function unavailable(manifest: ProviderManifest, policyVersion: string): ProviderResult {
  return {
    status: 'unavailable',
    providerName: manifest.providerName,
    providerVersion: manifest.providerVersion,
    observations: [],
    limitation: 'Provider evidence was unavailable or refused by execution policy.',
    provenance: provenance(manifest, policyVersion),
  };
}

function policyAllows(manifest: ProviderManifest, policy: ProviderDispatchPolicy): boolean {
  return (
    policy.allowedProviders.includes(manifest.providerName) &&
    policy.allowedRoles.includes(manifest.role) &&
    sameFields(manifest.inputFields, exactFields[manifest.role]) &&
    manifest.timeoutMs > 0 &&
    manifest.timeoutMs <= policy.maximumTimeoutMs &&
    manifest.costUnits >= 0 &&
    (manifest.networkEgress === 'none' || policy.allowNetworkEgress) &&
    (manifest.retention !== 'provider_declared' || policy.allowProviderRetention) &&
    (manifest.trainingUse !== 'provider_declared' || policy.allowProviderTraining)
  );
}

function validRawResult(result: ProviderRawResult, manifest: ProviderManifest): boolean {
  if (!['unknown', 'mock', 'observed'].includes(result.status)) return false;
  if (!Array.isArray(result.observations) || result.observations.length > 50) return false;
  if (result.status !== 'observed' && result.observations.length !== 0) return false;
  if (result.status === 'observed' && manifest.deployment !== 'live') return false;
  if (result.status === 'mock' && manifest.deployment !== 'deterministic_mock') return false;
  return true;
}

async function withTimeout(
  provider: FraudProvider,
  request: ProviderRequest,
  timeoutMs: number,
): Promise<ProviderRawResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('provider_timeout'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([provider.inspect(request, controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export class ProviderDispatcher {
  constructor(
    private readonly providers: readonly FraudProvider[],
    private readonly policy: ProviderDispatchPolicy,
  ) {}

  async inspect(features: FeatureVector): Promise<readonly ProviderResult[]> {
    if (this.policy.killSwitch()) return [];
    const results: ProviderResult[] = [];
    let spent = 0;
    for (const provider of this.providers.slice(0, Math.max(0, this.policy.maximumProviders))) {
      const manifest = safeManifest(provider.manifest);
      if (
        this.policy.killSwitch() ||
        !policyAllows(manifest, this.policy) ||
        spent + manifest.costUnits > this.policy.maximumTotalCostUnits
      ) {
        results.push(unavailable(manifest, this.policy.policyVersion));
        continue;
      }
      spent += manifest.costUnits;
      try {
        const raw = await withTimeout(
          provider,
          requestFor(manifest.role, features),
          manifest.timeoutMs,
        );
        if (!validRawResult(raw, manifest)) {
          results.push(unavailable(manifest, this.policy.policyVersion));
          continue;
        }
        results.push({
          ...raw,
          providerName: manifest.providerName,
          providerVersion: manifest.providerVersion,
          provenance: provenance(manifest, this.policy.policyVersion),
        });
      } catch {
        results.push(unavailable(manifest, this.policy.policyVersion));
      }
    }
    return results;
  }
}

export function localOnlyProviderPolicy(
  providers: readonly FraudProvider[],
  killSwitch: () => boolean = () => false,
): ProviderDispatchPolicy {
  return {
    policyVersion: 'least-data-v1',
    allowedProviders: providers.map((provider) => safeManifest(provider.manifest).providerName),
    allowedRoles: ['structural_reputation', 'campaign_intelligence', 'language_pattern'],
    maximumProviders: 3,
    maximumTotalCostUnits: 0,
    maximumTimeoutMs: 1_000,
    allowNetworkEgress: false,
    allowProviderRetention: false,
    allowProviderTraining: false,
    killSwitch,
  };
}

export class LocalUnknownProvider implements FraudProvider {
  readonly manifest: ProviderManifest = {
    providerName: 'local-unknown',
    providerVersion: '2',
    role: 'structural_reputation',
    capabilityId: 'structural-no-egress',
    dataPolicyVersion: 'least-data-v1',
    inputFields: exactFields.structural_reputation,
    deployment: 'local_unknown',
    networkEgress: 'none',
    retention: 'none',
    trainingUse: 'prohibited',
    timeoutMs: 50,
    costUnits: 0,
  };

  async inspect(): Promise<ProviderRawResult> {
    return {
      status: 'unknown',
      observations: [],
      limitation:
        'No live reputation provider is configured; no URL or external resource was contacted.',
    };
  }
}

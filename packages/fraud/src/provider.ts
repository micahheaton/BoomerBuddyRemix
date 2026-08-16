import { redactSensitiveInput } from '@boomerbuddy/security';
import { organizationCandidateIds, providerRoles, signalKinds } from './types';
import type {
  FeatureVector,
  FraudProvider,
  OrganizationCandidateId,
  ProviderDispatchInput,
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
const registrableDomain =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u;
const artifactKinds = ['text', 'url'] as const;
const verifiedDispatchInputs = new WeakSet<object>();

const exactFields: Readonly<Record<ProviderRole, readonly ProviderInputField[]>> = {
  local_signals: ['artifactKind', 'signals', 'byteLengthBucket', 'urlStructure'],
  domain_reputation: ['registrableDomain'],
  url_reputation: ['normalizedUrl'],
  message_reasoning: ['redactedContent', 'signals'],
  verified_organization: ['organizationCandidates'],
  campaign_intelligence: ['redactedContent', 'signals'],
  recovery_authority: ['artifactKind', 'signals', 'organizationCandidates', 'registrableDomain'],
};

const applicableArtifactKinds: Readonly<
  Record<ProviderRole, readonly ProviderDispatchInput['features']['artifactKind'][]>
> = {
  local_signals: artifactKinds,
  domain_reputation: ['url'],
  url_reputation: ['url'],
  message_reasoning: ['text'],
  verified_organization: ['text'],
  campaign_intelligence: ['text'],
  recovery_authority: artifactKinds,
};

function validFeatures(features: FeatureVector): boolean {
  return (
    artifactKinds.includes(features.artifactKind) &&
    Array.isArray(features.signals) &&
    features.signals.length <= signalKinds.length &&
    features.signals.every((signal) => signalKinds.includes(signal)) &&
    ['empty', 'small', 'medium', 'large'].includes(features.byteLengthBucket) &&
    (features.url === undefined ||
      (['http', 'https'].includes(features.url.scheme) &&
        typeof features.url.hasCredentials === 'boolean' &&
        ['domain', 'ip'].includes(features.url.hostKind) &&
        typeof features.url.usesInternationalizedDomain === 'boolean' &&
        Number.isSafeInteger(features.url.subdomainCount) &&
        features.url.subdomainCount >= 0 &&
        features.url.subdomainCount <= 127 &&
        typeof features.url.hasNonstandardPort === 'boolean'))
  );
}

export function prepareProviderDispatchInput(input: {
  readonly features: FeatureVector;
  readonly redactedContent: string;
  readonly registrableDomain?: string;
  readonly normalizedUrl?: string;
  readonly organizationCandidates: readonly OrganizationCandidateId[];
}): ProviderDispatchInput {
  const rechecked = redactSensitiveInput(
    input.redactedContent,
    input.features.artifactKind === 'url' ? 4_096 : 16_384,
  );
  if (
    !validFeatures(input.features) ||
    rechecked.status === 'rejected' ||
    rechecked.minimized !== input.redactedContent ||
    rechecked.redactions.length !== 0 ||
    !Array.isArray(input.organizationCandidates) ||
    input.organizationCandidates.some(
      (candidate) => !organizationCandidateIds.includes(candidate),
    ) ||
    (input.registrableDomain !== undefined &&
      (!registrableDomain.test(input.registrableDomain) ||
        input.registrableDomain !== input.registrableDomain.toLowerCase()))
  ) {
    throw new TypeError('Invalid provider dispatch input');
  }
  if (input.normalizedUrl !== undefined) {
    const checkedUrl = redactSensitiveInput(input.normalizedUrl, 4_096);
    let parsed: URL;
    try {
      parsed = new URL(input.normalizedUrl);
    } catch {
      throw new TypeError('Invalid provider dispatch input');
    }
    if (
      checkedUrl.status === 'rejected' ||
      checkedUrl.minimized !== input.normalizedUrl ||
      checkedUrl.redactions.length !== 0 ||
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      throw new TypeError('Invalid provider dispatch input');
    }
  }
  const prepared = Object.freeze({
    features: Object.freeze({
      ...input.features,
      signals: Object.freeze([...input.features.signals]),
      ...(input.features.url === undefined
        ? {}
        : { url: Object.freeze({ ...input.features.url }) }),
    }),
    redactedContent: input.redactedContent,
    organizationCandidates: Object.freeze([...input.organizationCandidates]),
    ...(input.registrableDomain === undefined
      ? {}
      : { registrableDomain: input.registrableDomain }),
    ...(input.normalizedUrl === undefined ? {} : { normalizedUrl: input.normalizedUrl }),
  }) as ProviderDispatchInput;
  verifiedDispatchInputs.add(prepared);
  return prepared;
}

function sameFields(
  actual: readonly ProviderInputField[],
  expected: readonly ProviderInputField[],
): boolean {
  return (
    actual.length === expected.length &&
    [...actual].sort().every((field, index) => field === [...expected].sort()[index])
  );
}

function requestFor(role: ProviderRole, input: ProviderDispatchInput): ProviderRequest | undefined {
  const { features } = input;
  switch (role) {
    case 'local_signals':
      return Object.freeze({
        role,
        artifactKind: features.artifactKind,
        signals: Object.freeze([...features.signals]),
        byteLengthBucket: features.byteLengthBucket,
        ...(features.url === undefined ? {} : { urlStructure: Object.freeze({ ...features.url }) }),
      });
    case 'domain_reputation':
      return input.registrableDomain === undefined
        ? undefined
        : Object.freeze({ role, registrableDomain: input.registrableDomain });
    case 'url_reputation':
      return input.normalizedUrl === undefined
        ? undefined
        : Object.freeze({ role, normalizedUrl: input.normalizedUrl });
    case 'message_reasoning':
    case 'campaign_intelligence':
      return Object.freeze({
        role,
        redactedContent: input.redactedContent,
        signals: Object.freeze([...features.signals]),
      });
    case 'verified_organization':
      return input.organizationCandidates.length === 0
        ? undefined
        : Object.freeze({
            role,
            organizationCandidates: Object.freeze([...input.organizationCandidates]),
          });
    case 'recovery_authority':
      if (input.organizationCandidates.length === 0 && input.registrableDomain === undefined) {
        return undefined;
      }
      return Object.freeze({
        role,
        artifactKind: features.artifactKind,
        signals: Object.freeze([...features.signals]),
        organizationCandidates: Object.freeze([...input.organizationCandidates]),
        ...(input.registrableDomain === undefined
          ? {}
          : { registrableDomain: input.registrableDomain }),
      });
  }
}

function validManifest(manifest: ProviderManifest | undefined): manifest is ProviderManifest {
  return (
    manifest !== undefined &&
    identifier.test(manifest.providerName) &&
    identifier.test(manifest.providerVersion) &&
    identifier.test(manifest.capabilityId) &&
    identifier.test(manifest.dataPolicyVersion) &&
    providerRoles.includes(manifest.role) &&
    Array.isArray(manifest.supportedArtifactKinds) &&
    manifest.supportedArtifactKinds.length > 0 &&
    manifest.supportedArtifactKinds.every(
      (kind) =>
        artifactKinds.includes(kind) && applicableArtifactKinds[manifest.role].includes(kind),
    ) &&
    Array.isArray(manifest.inputFields) &&
    ['local_unknown', 'deterministic_mock', 'live'].includes(manifest.deployment) &&
    ['none', 'declared_provider_only'].includes(manifest.networkEgress) &&
    ['none', 'ephemeral', 'provider_declared'].includes(manifest.retention) &&
    ['prohibited', 'provider_declared'].includes(manifest.trainingUse) &&
    Number.isSafeInteger(manifest.timeoutMs) &&
    Number.isSafeInteger(manifest.costUnits) &&
    Number.isSafeInteger(manifest.maximumEvidenceAgeMs) &&
    manifest.maximumEvidenceAgeMs > 0 &&
    Number.isSafeInteger(manifest.maximumRequestsPerMinute) &&
    manifest.maximumRequestsPerMinute > 0 &&
    manifest.failureSemantics === 'unknown'
  );
}

function safeManifest(manifest: ProviderManifest | undefined): ProviderManifest {
  if (manifest !== undefined && validManifest(manifest)) {
    return manifest;
  }
  return {
    providerName: 'configured-provider',
    providerVersion: 'unknown',
    role: 'local_signals',
    capabilityId: 'invalid-manifest',
    dataPolicyVersion: 'unknown',
    supportedArtifactKinds: artifactKinds,
    inputFields: exactFields.local_signals,
    deployment: 'local_unknown',
    networkEgress: 'none',
    retention: 'none',
    trainingUse: 'prohibited',
    timeoutMs: 1,
    costUnits: 0,
    maximumEvidenceAgeMs: 1,
    maximumRequestsPerMinute: 1,
    failureSemantics: 'unknown',
  };
}

function provenance(manifest: ProviderManifest, policyVersion: string): ProviderProvenance {
  return {
    providerName: manifest.providerName,
    providerVersion: manifest.providerVersion,
    role: manifest.role,
    capabilityId: manifest.capabilityId,
    dataPolicyVersion: manifest.dataPolicyVersion,
    supportedArtifactKinds: [...manifest.supportedArtifactKinds],
    deployment: manifest.deployment,
    networkEgress: manifest.networkEgress,
    retention: manifest.retention,
    trainingUse: manifest.trainingUse,
    inputFields: [...manifest.inputFields],
    maximumEvidenceAgeMs: manifest.maximumEvidenceAgeMs,
    maximumRequestsPerMinute: manifest.maximumRequestsPerMinute,
    failureSemantics: manifest.failureSemantics,
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

function policyAllows(
  manifest: ProviderManifest,
  artifactKind: ProviderDispatchInput['features']['artifactKind'],
  policy: ProviderDispatchPolicy,
): boolean {
  return (
    policy.allowedProviders.includes(manifest.providerName) &&
    policy.allowedRoles.includes(manifest.role) &&
    manifest.supportedArtifactKinds.includes(artifactKind) &&
    sameFields(manifest.inputFields, exactFields[manifest.role]) &&
    manifest.timeoutMs > 0 &&
    manifest.timeoutMs <= policy.maximumTimeoutMs &&
    manifest.costUnits >= 0 &&
    manifest.maximumEvidenceAgeMs <= policy.maximumEvidenceAgeMs &&
    manifest.maximumRequestsPerMinute <= policy.maximumRequestsPerProviderPerMinute &&
    manifest.failureSemantics === 'unknown' &&
    (manifest.networkEgress === 'none' || policy.allowNetworkEgress) &&
    (manifest.retention === 'none' || policy.allowProviderRetention) &&
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
  private readonly providerRequestHistory = new Map<string, number[]>();
  private readonly capabilityRequestHistory = new Map<string, number[]>();

  constructor(
    private readonly providers: readonly FraudProvider[],
    private readonly policy: ProviderDispatchPolicy,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  private async reserveRateLimit(manifest: ProviderManifest): Promise<boolean> {
    const now = this.clock();
    const providerKey = manifest.providerName;
    const capabilityKey = `${providerKey}:${manifest.providerVersion}:${manifest.capabilityId}`;
    const providerRecent = (this.providerRequestHistory.get(providerKey) ?? []).filter(
      (time) => time > now - 60_000,
    );
    const capabilityRecent = (this.capabilityRequestHistory.get(capabilityKey) ?? []).filter(
      (time) => time > now - 60_000,
    );
    if (
      providerRecent.length >= this.policy.maximumRequestsPerProviderPerMinute ||
      capabilityRecent.length >= manifest.maximumRequestsPerMinute
    ) {
      this.providerRequestHistory.set(providerKey, providerRecent);
      this.capabilityRequestHistory.set(capabilityKey, capabilityRecent);
      return false;
    }
    if (manifest.deployment === 'live') {
      const durableLimiter = this.policy.reserveDurableRateLimit;
      if (durableLimiter === undefined) return false;
      try {
        const reserved = await durableLimiter({
          providerRateLimitKey: providerKey,
          providerName: manifest.providerName,
          providerVersion: manifest.providerVersion,
          capabilityId: manifest.capabilityId,
          providerMaximumPerMinute: this.policy.maximumRequestsPerProviderPerMinute,
          capabilityMaximumPerMinute: manifest.maximumRequestsPerMinute,
          requestedAtEpochMs: now,
        });
        if (!reserved) return false;
      } catch {
        return false;
      }
    }
    providerRecent.push(now);
    capabilityRecent.push(now);
    this.providerRequestHistory.set(providerKey, providerRecent);
    this.capabilityRequestHistory.set(capabilityKey, capabilityRecent);
    return true;
  }

  async inspect(input: ProviderDispatchInput): Promise<readonly ProviderResult[]> {
    if (!verifiedDispatchInputs.has(input)) {
      throw new TypeError('Provider dispatch input did not pass the least-data boundary');
    }
    if (this.policy.killSwitch()) return [];
    const results: ProviderResult[] = [];
    let spent = 0;
    for (const provider of this.providers.slice(0, Math.max(0, this.policy.maximumProviders))) {
      const declaredManifest = provider.manifest;
      const manifest = safeManifest(declaredManifest);
      const request = requestFor(manifest.role, input);
      const capabilityDisabled = this.policy.capabilityKillSwitch({
        providerName: manifest.providerName,
        providerVersion: manifest.providerVersion,
        capabilityId: manifest.capabilityId,
      });
      if (
        this.policy.killSwitch() ||
        capabilityDisabled ||
        !validManifest(declaredManifest) ||
        !policyAllows(manifest, input.features.artifactKind, this.policy) ||
        request === undefined ||
        spent + manifest.costUnits > this.policy.maximumTotalCostUnits ||
        !(await this.reserveRateLimit(manifest))
      ) {
        results.push(unavailable(manifest, this.policy.policyVersion));
        continue;
      }
      spent += manifest.costUnits;
      try {
        const raw = await withTimeout(provider, request, manifest.timeoutMs);
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
    allowedRoles: providerRoles,
    maximumProviders: providerRoles.length,
    maximumTotalCostUnits: 0,
    maximumTimeoutMs: 1_000,
    maximumEvidenceAgeMs: 24 * 60 * 60_000,
    maximumRequestsPerProviderPerMinute: 600,
    allowNetworkEgress: false,
    allowProviderRetention: false,
    allowProviderTraining: false,
    killSwitch,
    capabilityKillSwitch: () => false,
  };
}

export class LocalUnknownProvider implements FraudProvider {
  readonly manifest: ProviderManifest = {
    providerName: 'local-unknown',
    providerVersion: '2',
    role: 'local_signals',
    capabilityId: 'structural-no-egress',
    dataPolicyVersion: 'least-data-v1',
    supportedArtifactKinds: artifactKinds,
    inputFields: exactFields.local_signals,
    deployment: 'local_unknown',
    networkEgress: 'none',
    retention: 'none',
    trainingUse: 'prohibited',
    timeoutMs: 50,
    costUnits: 0,
    maximumEvidenceAgeMs: 60_000,
    maximumRequestsPerMinute: 600,
    failureSemantics: 'unknown',
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

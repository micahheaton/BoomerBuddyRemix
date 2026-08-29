import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { parse as parseDomain } from 'tldts';
import { DomainError } from '@boomerbuddy/domain';
import { redactSensitiveInput } from '@boomerbuddy/security';
import {
  LocalUnknownProvider,
  localOnlyProviderPolicy,
  prepareProviderDispatchInput,
  ProviderDispatcher,
} from './provider';
import type {
  FeatureVector,
  FraudAssessment,
  FraudEvidence,
  FraudProvider,
  OrganizationCandidateId,
  PreparedCheckInput,
  ProviderDispatchPolicy,
  ProviderManifest,
  ProviderResult,
  RiskBand,
  SafeAction,
  SafeActionId,
  SignalKind,
} from './types';

const signalRules: readonly {
  readonly signal: SignalKind;
  readonly pattern: RegExp;
  readonly weight: number;
  readonly label: string;
}[] = [
  {
    signal: 'urgency',
    pattern:
      /\b(?:act now|immediately|urgent|right away|today only|within \d+ (?:minutes?|hours?))\b/iu,
    weight: 12,
    label: 'Uses urgent language that can pressure a rushed decision.',
  },
  {
    signal: 'secrecy',
    pattern:
      /\b(?:do not tell|keep (?:this|it) secret|between us|don['’]t (?:call|contact|mention))\b/iu,
    weight: 20,
    label: 'Asks the recipient to keep the situation secret.',
  },
  {
    signal: 'credential_request',
    pattern:
      /\b(?:password|passcode|verification code|security code|one[- ]time code|login credentials?|social security number|ssn)\b/iu,
    weight: 30,
    label: 'Requests an authentication credential or highly sensitive identifier.',
  },
  {
    signal: 'unusual_payment',
    pattern:
      /\b(?:gift cards?|bitcoin|crypto(?:currency)?|wire transfer|cashier['’]s check|payment app|zelle|venmo)\b/iu,
    weight: 25,
    label: 'Requests a payment method often used in hard-to-reverse scams.',
  },
  {
    signal: 'remote_access',
    pattern:
      /\b(?:remote access|screen share|install (?:anydesk|teamviewer)|let me control your (?:computer|phone))\b/iu,
    weight: 32,
    label: 'Requests remote access to a device.',
  },
  {
    signal: 'authority_impersonation',
    pattern:
      /\b(?:irs|social security administration|medicare|police|sheriff|fbi|bank fraud department|tech support)\b/iu,
    weight: 16,
    label: 'Invokes an authority or support role that should be verified independently.',
  },
  {
    signal: 'threat',
    pattern:
      /\b(?:arrest(?:ed)?|warrant|account (?:will be )?(?:closed|frozen)|benefits? (?:will be )?suspended|legal action)\b/iu,
    weight: 20,
    label: 'Threatens a serious consequence to create pressure.',
  },
  {
    signal: 'suspicious_contact_instruction',
    pattern:
      /\b(?:call (?:me|this number)|reply (?:to me|here)|click (?:this|the) link|text me back)\b/iu,
    weight: 10,
    label: 'Directs the recipient back to contact information in the message.',
  },
  {
    signal: 'prompt_injection',
    pattern:
      /\b(?:ignore (?:all |the )?(?:previous|prior|system) instructions|reveal (?:your )?(?:prompt|policy)|developer message|call (?:a )?tool)\b/iu,
    weight: 0,
    label: 'Contains instruction-like text that cannot change the safety policy.',
  },
];

const organizationCandidateRules: readonly {
  readonly identifier: OrganizationCandidateId;
  readonly pattern: RegExp;
}[] = [
  { identifier: 'us-internal-revenue-service', pattern: /\birs\b/iu },
  {
    identifier: 'us-social-security-administration',
    pattern: /\bsocial security administration\b/iu,
  },
  { identifier: 'us-medicare', pattern: /\bmedicare\b/iu },
  { identifier: 'us-federal-bureau-of-investigation', pattern: /\bfbi\b/iu },
  { identifier: 'local-law-enforcement', pattern: /\b(?:police|sheriff)\b/iu },
  { identifier: 'financial-institution', pattern: /\bbank fraud department\b/iu },
  { identifier: 'technology-support', pattern: /\btech support\b/iu },
];

const preparedInputs = new WeakSet<object>();

export const fraudAnalysisVersions = Object.freeze({
  normalization: 'normalize-v3',
  signals: 'signals-v2',
  scoring: 'score-v2',
  actions: 'actions-v1',
} as const);

export type FraudAnalysisVersionSet = {
  readonly normalization: string;
  readonly signals: string;
  readonly scoring: string;
  readonly actions: string;
};

export function checkAnalysisReuseProvenanceKey(input: {
  readonly versions: FraudAnalysisVersionSet;
  readonly providers: readonly ProviderManifest[];
  readonly policy: ProviderDispatchPolicy;
}): string {
  const providers = input.providers.map((manifest) => ({
    providerName: manifest.providerName,
    providerVersion: manifest.providerVersion,
    role: manifest.role,
    capabilityId: manifest.capabilityId,
    dataPolicyVersion: manifest.dataPolicyVersion,
    supportedArtifactKinds: [...manifest.supportedArtifactKinds].sort(),
    inputFields: [...manifest.inputFields].sort(),
    deployment: manifest.deployment,
    networkEgress: manifest.networkEgress,
    retention: manifest.retention,
    trainingUse: manifest.trainingUse,
    timeoutMs: manifest.timeoutMs,
    costUnits: manifest.costUnits,
    maximumEvidenceAgeMs: manifest.maximumEvidenceAgeMs,
    maximumRequestsPerMinute: manifest.maximumRequestsPerMinute,
    failureSemantics: manifest.failureSemantics,
    capabilityDisabled: input.policy.capabilityKillSwitch({
      providerName: manifest.providerName,
      providerVersion: manifest.providerVersion,
      capabilityId: manifest.capabilityId,
    }),
  }));
  const canonical = JSON.stringify({
    versions: input.versions,
    providers,
    policy: {
      policyVersion: input.policy.policyVersion,
      allowedProviders: [...input.policy.allowedProviders].sort(),
      allowedRoles: [...input.policy.allowedRoles].sort(),
      maximumProviders: input.policy.maximumProviders,
      maximumTotalCostUnits: input.policy.maximumTotalCostUnits,
      maximumTimeoutMs: input.policy.maximumTimeoutMs,
      maximumEvidenceAgeMs: input.policy.maximumEvidenceAgeMs,
      maximumRequestsPerProviderPerMinute: input.policy.maximumRequestsPerProviderPerMinute,
      allowNetworkEgress: input.policy.allowNetworkEgress,
      allowProviderRetention: input.policy.allowProviderRetention,
      allowProviderTraining: input.policy.allowProviderTraining,
      killSwitchActive: input.policy.killSwitch(),
      durableRateLimitConfigured: input.policy.reserveDurableRateLimit !== undefined,
    },
  });
  return `check-reuse-v1:${createHash('sha256').update(canonical).digest('base64url')}`;
}

export function checkAnalysisReuseUntil(
  assessment: Pick<FraudAssessment, 'evidence'>,
  analyzedAt: Date,
  maximumWindowMs: number,
): Date | undefined {
  if (
    !Number.isFinite(analyzedAt.getTime()) ||
    !Number.isSafeInteger(maximumWindowMs) ||
    maximumWindowMs <= 0
  ) {
    throw new TypeError('Check reuse freshness input is invalid');
  }
  let reuseUntil = analyzedAt.getTime() + maximumWindowMs;
  for (const evidence of assessment.evidence) {
    if (
      evidence.source.kind === 'missing_or_failed' &&
      (evidence.source.status !== 'unknown' ||
        evidence.source.provenance?.deployment !== 'local_unknown' ||
        evidence.source.provenance.networkEgress !== 'none')
    ) {
      return undefined;
    }
    if (evidence.source.kind !== 'provider' || evidence.validUntil === undefined) continue;
    if (evidence.freshness === 'stale' || evidence.source.provenance === undefined)
      return undefined;
    const observedAt = new Date(evidence.observedAt).getTime();
    const validUntil = new Date(evidence.validUntil).getTime();
    const maximumEvidenceAgeMs = evidence.source.provenance.maximumEvidenceAgeMs;
    if (
      !Number.isFinite(observedAt) ||
      !Number.isFinite(validUntil) ||
      !Number.isSafeInteger(maximumEvidenceAgeMs) ||
      maximumEvidenceAgeMs <= 0
    ) {
      return undefined;
    }
    reuseUntil = Math.min(reuseUntil, validUntil, observedAt + maximumEvidenceAgeMs);
  }
  return reuseUntil <= analyzedAt.getTime() ? undefined : new Date(reuseUntil);
}

function byteLengthBucket(value: string): FeatureVector['byteLengthBucket'] {
  const length = Buffer.byteLength(value, 'utf8');
  if (length === 0) return 'empty';
  if (length <= 280) return 'small';
  if (length <= 2_000) return 'medium';
  return 'large';
}

const explicitUrlScheme = /^([a-z][a-z0-9+.-]*):\/\//iu;
const schemePrefix = /^([a-z][a-z0-9+.-]*):/iu;
const friendlyHostPort = /^(?:localhost|(?:[^/?#\s:]+\.)+[^/?#\s:]+):\d{1,5}(?:[/?#]|$)/iu;

function normalizeCheckUrl(value: string): string {
  const trimmed = value.normalize('NFKC').trim();
  if (trimmed.length === 0) {
    throw new DomainError('invalid_input', 'Website address cannot be empty');
  }
  if (/[\p{Cc}\\]/u.test(trimmed)) {
    throw new DomainError('invalid_input', 'Website address is malformed');
  }

  const explicitScheme = explicitUrlScheme.exec(trimmed);
  const prefixedScheme = schemePrefix.exec(trimmed);
  let normalized: string;
  if (explicitScheme !== null) {
    const scheme = explicitScheme[1]?.toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      throw new DomainError(
        'invalid_input',
        'Only http and https website addresses can be checked',
      );
    }
    normalized = trimmed;
  } else if (/^https?\/\//iu.test(trimmed)) {
    throw new DomainError('invalid_input', 'Website address is malformed');
  } else if (prefixedScheme !== null && !friendlyHostPort.test(trimmed)) {
    throw new DomainError('invalid_input', 'Only http and https website addresses can be checked');
  } else {
    normalized = `https://${trimmed}`;
  }

  const authorityStart = normalized.indexOf('://') + 3;
  const authoritySuffix = normalized.slice(authorityStart);
  const authorityEnd = authoritySuffix.search(/[/?#]/u);
  const authority = authorityEnd === -1 ? authoritySuffix : authoritySuffix.slice(0, authorityEnd);
  if (authority.length === 0 || authority.includes('@')) {
    throw new DomainError(
      'invalid_input',
      'Website addresses containing user information cannot be checked',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new DomainError('invalid_input', 'Website address is malformed');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.hostname.length === 0
  ) {
    throw new DomainError('invalid_input', 'Only http and https website addresses can be checked');
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new DomainError(
      'invalid_input',
      'Website addresses containing user information cannot be checked',
    );
  }
  return parsed.href;
}

function analyzeUrl(value: string): {
  readonly url: NonNullable<FeatureVector['url']>;
  readonly signals: readonly SignalKind[];
  readonly registrableDomain?: string;
  readonly normalizedUrl: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DomainError('invalid_input', 'URL checks require a complete http or https URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new DomainError('invalid_input', 'Only http and https URL strings can be checked');
  }
  const signals: SignalKind[] = [];
  const ipHost = isIP(parsed.hostname) !== 0;
  const domain = parseDomain(parsed.hostname);
  const subdomainCount =
    domain.subdomain === null || domain.subdomain === '' ? 0 : domain.subdomain.split('.').length;
  const hasCredentials = parsed.username !== '' || parsed.password !== '';
  if (hasCredentials) {
    throw new DomainError(
      'invalid_input',
      'Website addresses containing user information cannot be checked',
    );
  }
  const usesInternationalizedDomain = parsed.hostname.includes('xn--');
  const defaultPort = parsed.protocol === 'https:' ? '443' : '80';
  const hasNonstandardPort = parsed.port !== '' && parsed.port !== defaultPort;
  if (ipHost) signals.push('url_ip_host');
  if (usesInternationalizedDomain) signals.push('url_punycode');
  if (parsed.protocol === 'http:') signals.push('url_insecure_scheme');
  if (hasNonstandardPort) signals.push('url_nonstandard_port');
  if (subdomainCount >= 4) signals.push('url_excessive_subdomains');

  const reputationUrl = new URL(parsed.href);
  reputationUrl.username = '';
  reputationUrl.password = '';
  reputationUrl.search = '';
  reputationUrl.hash = '';

  // The default local-signals role receives only the structural representation.
  // Role-specific reputation ports may receive a registrable domain or this
  // query/fragment/credential-free URL only when their manifest and policy allow it.
  return {
    signals,
    ...(domain.domain === null ? {} : { registrableDomain: domain.domain.toLowerCase() }),
    normalizedUrl: reputationUrl.toString(),
    url: {
      scheme: parsed.protocol === 'https:' ? 'https' : 'http',
      hasCredentials,
      hostKind: ipHost ? 'ip' : 'domain',
      usesInternationalizedDomain,
      subdomainCount,
      hasNonstandardPort,
    },
  };
}

function urlEvidence(signal: SignalKind): { readonly weight: number; readonly label: string } {
  const values: Readonly<
    Partial<Record<SignalKind, { readonly weight: number; readonly label: string }>>
  > = {
    url_userinfo: {
      weight: 28,
      label: 'The URL embeds user-information syntax that can disguise its destination.',
    },
    url_ip_host: {
      weight: 18,
      label: 'The URL uses a numeric network address instead of a domain name.',
    },
    url_punycode: {
      weight: 18,
      label: 'The URL contains an internationalized-domain encoding that merits care.',
    },
    url_insecure_scheme: { weight: 6, label: 'The URL uses unencrypted HTTP.' },
    url_nonstandard_port: { weight: 8, label: 'The URL specifies a nonstandard network port.' },
    url_excessive_subdomains: {
      weight: 10,
      label: 'The URL has an unusually deep subdomain structure.',
    },
  };
  return values[signal] ?? { weight: 0, label: 'A structural URL characteristic was observed.' };
}

const providerIdentifier = /^[a-z0-9][a-z0-9_.-]{0,63}$/u;

function normalizeProviderResult(result: ProviderResult, evaluatedAt: Date): ProviderResult {
  if (
    !['unknown', 'unavailable', 'mock', 'observed'].includes(result.status) ||
    !providerIdentifier.test(result.providerName) ||
    !providerIdentifier.test(result.providerVersion) ||
    !Array.isArray(result.observations) ||
    result.observations.length > 50
  ) {
    throw new TypeError('Invalid provider result');
  }
  if (result.status !== 'observed' && result.observations.length !== 0) {
    throw new TypeError('Non-observed provider results cannot contain observations');
  }
  if (result.status === 'observed' && result.observations.length === 0) {
    throw new TypeError('Observed provider results require a bounded observation');
  }
  const observations = result.observations.map((observation) => {
    if (
      !providerIdentifier.test(observation.code) ||
      !['malicious', 'suspicious', 'not_found'].includes(observation.disposition) ||
      !Number.isFinite(observation.weight)
    ) {
      throw new TypeError('Invalid provider observation');
    }
    const providerObservedAt = Date.parse(observation.observedAt);
    const validUntil = Date.parse(observation.validUntil);
    if (
      !Number.isFinite(providerObservedAt) ||
      !Number.isFinite(validUntil) ||
      validUntil <= providerObservedAt ||
      providerObservedAt > evaluatedAt.getTime() + 5 * 60_000
    ) {
      throw new TypeError('Invalid provider observation freshness');
    }
    const label =
      observation.disposition === 'malicious'
        ? 'External intelligence reported a malicious match.'
        : observation.disposition === 'suspicious'
          ? 'External intelligence reported a suspicious match.'
          : 'No match was reported by the limited provider dataset.';
    return {
      code: observation.code,
      label,
      disposition: observation.disposition,
      weight: observation.weight,
      observedAt: new Date(providerObservedAt).toISOString(),
      validUntil: new Date(validUntil).toISOString(),
      limitation: 'External provider coverage, freshness, and error rates limit this observation.',
    };
  });
  const limitation =
    result.status === 'unknown' && result.provenance.deployment === 'local_unknown'
      ? 'No live reputation provider is configured; no URL or external resource was contacted.'
      : result.status === 'unknown' && result.provenance.networkEgress === 'declared_provider_only'
        ? 'The live provider returned no usable observation; its declared endpoint may have been contacted.'
        : result.status === 'unknown'
          ? 'The configured provider returned no usable observation; missing evidence cannot lower concern.'
          : result.status === 'unavailable'
            ? 'The external provider was unavailable; missing evidence cannot lower concern.'
            : result.status === 'mock'
              ? 'Mock provider output is not live safety evidence.'
              : 'External intelligence is limited and cannot establish that an item is safe.';
  return {
    status: result.status,
    providerName: result.providerName,
    providerVersion: result.providerVersion,
    observations,
    limitation,
    provenance: result.provenance,
  };
}

function providerObservationFreshness(
  result: ProviderResult,
  observation: ProviderResult['observations'][number],
  evaluatedAt: Date,
): 'current' | 'stale' {
  const observedAt = Date.parse(observation.observedAt);
  const validUntil = Date.parse(observation.validUntil);
  return validUntil <= evaluatedAt.getTime() ||
    evaluatedAt.getTime() - observedAt > result.provenance.maximumEvidenceAgeMs
    ? 'stale'
    : 'current';
}

function scoreCombinations(signals: ReadonlySet<SignalKind>): number {
  let score = 0;
  if (signals.has('secrecy') && signals.has('unusual_payment')) score += 16;
  if (signals.has('credential_request') && signals.has('urgency')) score += 12;
  if (signals.has('authority_impersonation') && signals.has('urgency')) score += 10;
  if (signals.has('remote_access') && signals.has('unusual_payment')) score += 12;
  return score;
}

function actionsFor(risk: RiskBand, signals: ReadonlySet<SignalKind>): readonly SafeAction[] {
  const actions = new Map<SafeActionId, SafeAction>();
  const add = (action: SafeAction): void => {
    actions.set(action.id, action);
  };
  add({
    id: 'pause',
    priority: 1,
    title: 'Pause',
    instruction: 'Stop and take time before doing anything requested.',
  });
  add({
    id: 'verify_using_official_channel',
    priority: 1,
    title: 'Verify another way',
    instruction:
      'Find the organization’s official contact information independently; do not use this message or link.',
  });
  add({
    id: 'do_not_interact',
    priority: 1,
    title: 'Do not reply or click',
    instruction: 'Do not reply, click, call, or download from the suspicious item.',
  });
  add({
    id: 'contact_trusted_person',
    priority: 2,
    title: 'Ask someone you trust',
    instruction: 'Review the situation with a trusted person before continuing.',
  });
  if (signals.has('unusual_payment') || risk === 'high_concern') {
    add({
      id: 'do_not_pay',
      priority: 1,
      title: 'Do not send money',
      instruction: 'Do not pay or buy anything requested in this item.',
    });
  }
  if (signals.has('credential_request') || risk === 'high_concern') {
    add({
      id: 'do_not_share_codes',
      priority: 1,
      title: 'Keep codes private',
      instruction: 'Do not share passwords, sign-in details, or verification codes.',
    });
  }
  if (signals.has('remote_access')) {
    add({
      id: 'do_not_install_remote_access',
      priority: 1,
      title: 'Do not allow remote access',
      instruction: 'Do not install remote-control software or share your screen.',
    });
  }
  if (risk === 'high_concern') {
    add({
      id: 'preserve_evidence',
      priority: 2,
      title: 'Preserve evidence',
      instruction:
        'Keep a safe record for your bank or an official report without forwarding secrets.',
    });
    add({
      id: 'secure_accounts',
      priority: 2,
      title: 'Secure affected accounts',
      instruction:
        'Use the official app or website to review and secure any account you may have exposed.',
    });
    if (signals.has('unusual_payment')) {
      add({
        id: 'contact_financial_institution',
        priority: 1,
        title: 'Contact your financial institution',
        instruction: 'Use the number on your card or official statement if money may be at risk.',
      });
    }
    add({
      id: 'report_officially',
      priority: 3,
      title: 'Consider an official report',
      instruction: 'Use an official government or institution reporting channel when appropriate.',
    });
  }
  return [...actions.values()].sort((left, right) => left.priority - right.priority);
}

export function prepareCheckInput(input: {
  readonly kind: 'text' | 'url';
  readonly content: string;
}): PreparedCheckInput {
  const content = input.kind === 'url' ? normalizeCheckUrl(input.content) : input.content;
  const maximumBytes = input.kind === 'url' ? 4_096 : 16_384;
  if (Buffer.byteLength(content, 'utf8') > maximumBytes) {
    throw new DomainError('invalid_input', 'Check content exceeds the supported size');
  }
  const minimized = redactSensitiveInput(content, maximumBytes);
  if (minimized.status === 'rejected') {
    throw new DomainError(
      'restricted_input',
      'The submitted item contains a secret that cannot be safely analyzed',
      { categoryCount: minimized.detected.length, reason: minimized.reason },
    );
  }
  if (minimized.minimized.length === 0) {
    throw new DomainError('invalid_input', 'Check content cannot be empty');
  }
  const prepared = Object.freeze({
    kind: input.kind,
    redactedContent: minimized.minimized,
    redactions: Object.freeze(
      minimized.redactions.map((redaction) => Object.freeze({ ...redaction })),
    ),
    safetyFlags: Object.freeze([...minimized.safetyFlags]),
  }) as PreparedCheckInput;
  preparedInputs.add(prepared);
  return prepared;
}

function assertPreparedInput(input: PreparedCheckInput): void {
  const limit = input.kind === 'url' ? 4_096 : 16_384;
  const rechecked = redactSensitiveInput(input.redactedContent, limit);
  if (
    !preparedInputs.has(input) ||
    rechecked.status === 'rejected' ||
    rechecked.minimized !== input.redactedContent ||
    rechecked.redactions.length !== 0
  ) {
    throw new DomainError(
      'restricted_input',
      'Check input was not produced by the typed-redaction boundary',
    );
  }
}

export async function analyzePreparedCheck(
  input: PreparedCheckInput,
  options: {
    readonly dispatcher?: ProviderDispatcher;
    readonly provider?: FraudProvider;
    readonly now?: Date;
  } = {},
): Promise<FraudAssessment> {
  assertPreparedInput(input);
  const evaluatedAt = options.now ?? new Date();
  const observedAt = evaluatedAt.toISOString();
  const textSignals = signalRules
    .filter((rule) => rule.pattern.test(input.redactedContent))
    .map((rule) => rule.signal);
  const urlResult = input.kind === 'url' ? analyzeUrl(input.redactedContent) : undefined;
  const signals = new Set<SignalKind>([...textSignals, ...(urlResult?.signals ?? [])]);
  const features: FeatureVector = {
    artifactKind: input.kind,
    signals: [...signals].sort(),
    byteLengthBucket: byteLengthBucket(input.redactedContent),
    ...(urlResult === undefined ? {} : { url: urlResult.url }),
  };
  const provider = options.provider ?? new LocalUnknownProvider();
  const dispatcher =
    options.dispatcher ?? new ProviderDispatcher([provider], localOnlyProviderPolicy([provider]));
  const organizationCandidates = organizationCandidateRules
    .filter((candidate) => candidate.pattern.test(input.redactedContent))
    .map((candidate) => candidate.identifier);
  const dispatched = await dispatcher.inspect(
    prepareProviderDispatchInput({
      features,
      redactedContent: input.redactedContent,
      organizationCandidates,
      ...(urlResult?.registrableDomain === undefined
        ? {}
        : { registrableDomain: urlResult.registrableDomain }),
      ...(urlResult === undefined ? {} : { normalizedUrl: urlResult.normalizedUrl }),
    }),
  );
  const providerResults = dispatched.map((result) => {
    try {
      return normalizeProviderResult(result, evaluatedAt);
    } catch {
      return {
        status: 'unavailable' as const,
        providerName: result.provenance.providerName,
        providerVersion: result.provenance.providerVersion,
        observations: [],
        limitation: 'Provider evidence was unavailable or refused by execution policy.',
        provenance: result.provenance,
      };
    }
  });

  const evidence: FraudEvidence[] = [];
  for (const rule of signalRules) {
    if (!signals.has(rule.signal)) continue;
    evidence.push({
      code: `deterministic.${rule.signal}`,
      signal: rule.signal,
      label: rule.label,
      weight: rule.weight,
      source: {
        kind: 'artifact_derived',
        name: 'deterministic-signals',
        version: 'signals-v2',
        status: 'observed',
      },
      observedAt,
      limitation: 'A pattern match is a warning signal, not proof of fraud.',
    });
  }
  for (const signal of urlResult?.signals ?? []) {
    const detail = urlEvidence(signal);
    evidence.push({
      code: `deterministic.${signal}`,
      signal,
      label: detail.label,
      weight: detail.weight,
      source: {
        kind: 'artifact_derived',
        name: 'url-string-signals',
        version: 'signals-v2',
        status: 'observed',
      },
      observedAt,
      limitation:
        'Only URL characters were inspected; the destination was not fetched, resolved, or verified.',
    });
  }
  for (const redaction of input.redactions) {
    const label =
      redaction.class === 'payment_card'
        ? 'Payment-card characters were removed before analysis.'
        : redaction.class === 'one_time_code'
          ? 'One-time-code characters were removed before analysis.'
          : 'Authentication-credential characters were removed before analysis.';
    evidence.push({
      code: `redaction.${redaction.class}`,
      label,
      weight: 0,
      source: {
        kind: 'artifact_derived',
        name: 'typed-redaction',
        version: 'redaction-v1',
        status: 'observed',
      },
      observedAt,
      limitation: `Only the sensitive class and bounded count (${redaction.count}) were retained.`,
    });
  }
  for (const providerResult of providerResults) {
    if (providerResult.status === 'observed') {
      for (const observation of providerResult.observations) {
        const freshness = providerObservationFreshness(providerResult, observation, evaluatedAt);
        const providerWeight =
          freshness === 'stale' || observation.disposition === 'not_found'
            ? 0
            : Math.min(100, Math.max(0, observation.weight));
        evidence.push({
          code: `provider.${observation.code}`,
          label:
            freshness === 'stale'
              ? 'Expired external evidence was retained for provenance but not used.'
              : observation.label,
          weight: providerWeight,
          source: {
            kind: 'provider',
            name: providerResult.providerName,
            version: providerResult.providerVersion,
            status: providerResult.status,
            provenance: providerResult.provenance,
          },
          observedAt: observation.observedAt,
          validUntil: observation.validUntil,
          freshness,
          limitation:
            freshness === 'stale'
              ? 'This observation was expired or older than the provider declared; it cannot change risk.'
              : observation.limitation,
        });
      }
      continue;
    }
    evidence.push({
      code: `provider.${providerResult.status}`,
      label: 'Live external reputation evidence is not available for this Check.',
      weight: 0,
      source: {
        kind: 'missing_or_failed',
        name: providerResult.providerName,
        version: providerResult.providerVersion,
        status: providerResult.status,
        provenance: providerResult.provenance,
      },
      observedAt,
      limitation: providerResult.limitation,
    });
  }
  if (providerResults.length === 0) {
    evidence.push({
      code: 'provider.disabled',
      label: 'Provider execution is disabled for this Check.',
      weight: 0,
      source: {
        kind: 'missing_or_failed',
        name: 'provider-policy',
        version: 'least-data-v1',
        status: 'unavailable',
      },
      observedAt,
      limitation: 'A provider kill switch or zero-provider policy prevented external evidence.',
    });
  }

  const baseScore = evidence.reduce((sum, item) => sum + item.weight, 0);
  const score = Math.min(100, baseScore + scoreCombinations(signals));
  const risk: RiskBand = score >= 50 ? 'high_concern' : score > 0 ? 'caution' : 'unknown';
  const positiveArtifactEvidence = evidence.filter(
    (item) => item.source.kind === 'artifact_derived' && item.weight > 0,
  );
  const currentPositiveProviderCapabilities = new Set(
    evidence.flatMap((item) =>
      item.source.kind === 'provider' &&
      item.freshness === 'current' &&
      item.weight > 0 &&
      item.source.provenance !== undefined
        ? [
            `${item.source.provenance.providerName}:${item.source.provenance.capabilityId}:${item.source.provenance.role}`,
          ]
        : [],
    ),
  );
  const staleProviderEvidence = evidence.some(
    (item) => item.source.kind === 'provider' && item.freshness === 'stale',
  );
  const externalUrlProviderConfigured = providerResults.some(
    (result) =>
      ['domain_reputation', 'url_reputation'].includes(result.provenance.role) &&
      result.provenance.networkEgress === 'declared_provider_only',
  );
  const independentPositiveEvidence =
    positiveArtifactEvidence.length + currentPositiveProviderCapabilities.size;
  const confidence: FraudAssessment['confidence'] =
    currentPositiveProviderCapabilities.size >= 2 && positiveArtifactEvidence.length >= 2
      ? 'strong'
      : independentPositiveEvidence >= 2
        ? 'moderate'
        : 'limited';
  const uncertaintyReasons = [
    ...new Set([
      'This initial ruleset has not been empirically calibrated on a representative corpus.',
      ...(providerResults.length === 0
        ? ['Provider execution is disabled or no provider is allowed.']
        : providerResults.map((result) => result.limitation)),
      ...(staleProviderEvidence
        ? ['Expired provider evidence was retained for provenance but treated as unknown.']
        : []),
      ...(input.kind === 'url'
        ? [
            'BoomerBuddy did not fetch or resolve the submitted destination.',
            ...(externalUrlProviderConfigured
              ? [
                  'An allowlisted provider may have received the least-data registrable domain or normalized URL; vendor destination contact is not established.',
                ]
              : []),
          ]
        : []),
    ]),
  ];
  const positiveReasons = evidence.filter((item) => item.weight > 0).map((item) => item.label);
  const headline =
    risk === 'high_concern'
      ? 'Several warning signs call for stopping and verifying independently.'
      : risk === 'caution'
        ? 'Some warning signs deserve a careful independent check.'
        : 'There is not enough verified evidence to make a judgment.';

  return {
    risk,
    score,
    confidence,
    calibration: 'not_calibrated',
    inputSafety: { redactions: input.redactions, flags: input.safetyFlags },
    uncertaintyReasons,
    evidence,
    providerRuns: providerResults.map((result) => result.provenance),
    explanation: {
      headline,
      reasons:
        positiveReasons.length > 0
          ? positiveReasons
          : ['No deterministic warning pattern was found in the submitted characters.'],
      limitation:
        'BoomerBuddy is not a guarantee, bank, emergency service, law-enforcement agency, or identity proof.',
    },
    actions: actionsFor(risk, signals),
    versions: fraudAnalysisVersions,
  };
}

export async function analyzeCheck(
  input: { readonly kind: 'text' | 'url'; readonly content: string },
  options: {
    readonly dispatcher?: ProviderDispatcher;
    readonly provider?: FraudProvider;
    readonly now?: Date;
  } = {},
): Promise<FraudAssessment> {
  return analyzePreparedCheck(prepareCheckInput(input), options);
}

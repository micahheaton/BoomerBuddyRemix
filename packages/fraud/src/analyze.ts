import { isIP } from 'node:net';
import { parse as parseDomain } from 'tldts';
import { DomainError } from '@boomerbuddy/domain';
import { minimizeRestrictedInput } from '@boomerbuddy/security';
import { LocalUnknownProvider } from './provider';
import type {
  FeatureVector,
  FraudAssessment,
  FraudEvidence,
  FraudProvider,
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

function byteLengthBucket(value: string): FeatureVector['byteLengthBucket'] {
  const length = Buffer.byteLength(value, 'utf8');
  if (length === 0) return 'empty';
  if (length <= 280) return 'small';
  if (length <= 2_000) return 'medium';
  return 'large';
}

function analyzeUrl(value: string): {
  readonly url: NonNullable<FeatureVector['url']>;
  readonly signals: readonly SignalKind[];
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
  const usesInternationalizedDomain = parsed.hostname.includes('xn--');
  const defaultPort = parsed.protocol === 'https:' ? '443' : '80';
  const hasNonstandardPort = parsed.port !== '' && parsed.port !== defaultPort;
  if (hasCredentials) signals.push('url_userinfo');
  if (ipHost) signals.push('url_ip_host');
  if (usesInternationalizedDomain) signals.push('url_punycode');
  if (parsed.protocol === 'http:') signals.push('url_insecure_scheme');
  if (hasNonstandardPort) signals.push('url_nonstandard_port');
  if (subdomainCount >= 4) signals.push('url_excessive_subdomains');

  // Deliberately emit no URL, host, path, query, or credential. This is a bounded
  // structural representation, and this module performs no DNS or network I/O.
  return {
    signals,
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

function normalizeProviderResult(result: ProviderResult): ProviderResult {
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
    if (
      observation.validUntil !== undefined &&
      !Number.isFinite(Date.parse(observation.validUntil))
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
      ...(observation.validUntil === undefined ? {} : { validUntil: observation.validUntil }),
      limitation: 'External provider coverage, freshness, and error rates limit this observation.',
    };
  });
  const limitation =
    result.status === 'unknown'
      ? 'No live reputation provider is configured; no URL or external resource was contacted.'
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
  };
}

function providerFailure(): ProviderResult {
  return {
    status: 'unavailable',
    providerName: 'configured-provider',
    providerVersion: 'unknown',
    observations: [],
    limitation: 'The configured provider failed; its error details were withheld.',
  };
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
  if (risk !== 'lower_concern') {
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
  }
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

export async function analyzeCheck(
  input: { readonly kind: 'text' | 'url'; readonly content: string },
  options: { readonly provider?: FraudProvider; readonly now?: Date } = {},
): Promise<FraudAssessment> {
  const minimized = minimizeRestrictedInput(input.content);
  if (minimized.status === 'rejected') {
    throw new DomainError(
      'restricted_input',
      'Remove payment-card, credential, private-key, or one-time-code values before checking',
      {
        categoryCount: minimized.detected.length,
      },
    );
  }
  if (minimized.minimized.length === 0)
    throw new DomainError('invalid_input', 'Check content cannot be empty');
  const observedAt = (options.now ?? new Date()).toISOString();
  const textSignals = signalRules
    .filter((rule) => rule.pattern.test(minimized.minimized))
    .map((rule) => rule.signal);
  const urlResult = input.kind === 'url' ? analyzeUrl(minimized.minimized) : undefined;
  const signals = new Set<SignalKind>([...textSignals, ...(urlResult?.signals ?? [])]);
  const features: FeatureVector = {
    artifactKind: input.kind,
    signals: [...signals].sort(),
    byteLengthBucket: byteLengthBucket(minimized.minimized),
    ...(urlResult === undefined ? {} : { url: urlResult.url }),
  };
  const provider = options.provider ?? new LocalUnknownProvider();
  let providerResult: ProviderResult;
  try {
    providerResult = normalizeProviderResult(await provider.inspect(features));
  } catch {
    providerResult = providerFailure();
  }

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
        version: 'signals-v1',
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
        version: 'signals-v1',
        status: 'observed',
      },
      observedAt,
      limitation:
        'Only URL characters were inspected; the destination was not fetched, resolved, or verified.',
    });
  }
  if (providerResult.status === 'observed') {
    for (const observation of providerResult.observations) {
      const providerWeight =
        observation.disposition === 'not_found'
          ? 0
          : Math.min(100, Math.max(0, observation.weight));
      evidence.push({
        code: `provider.${observation.code}`,
        label: observation.label,
        weight: providerWeight,
        source: {
          kind: 'provider',
          name: providerResult.providerName,
          version: providerResult.providerVersion,
          status: providerResult.status,
        },
        observedAt,
        ...(observation.validUntil === undefined ? {} : { validUntil: observation.validUntil }),
        limitation: observation.limitation,
      });
    }
  } else {
    evidence.push({
      code: `provider.${providerResult.status}`,
      label: 'Live external reputation evidence is not available for this Check.',
      weight: 0,
      source: {
        kind: 'missing_or_failed',
        name: providerResult.providerName,
        version: providerResult.providerVersion,
        status: providerResult.status,
      },
      observedAt,
      limitation: providerResult.limitation,
    });
  }

  const baseScore = evidence.reduce((sum, item) => sum + item.weight, 0);
  const score = Math.min(100, baseScore + scoreCombinations(signals));
  const risk: RiskBand = score >= 50 ? 'high_concern' : score > 0 ? 'caution' : 'unknown';
  const providerVerified =
    providerResult.status === 'observed' &&
    providerResult.observations.some(
      (observation) => observation.disposition !== 'not_found' && observation.weight > 0,
    );
  const confidence: FraudAssessment['confidence'] =
    providerVerified && evidence.length >= 4
      ? 'strong'
      : evidence.filter((item) => item.weight > 0).length >= 2
        ? 'moderate'
        : 'limited';
  const uncertaintyReasons = [
    'This initial ruleset has not been empirically calibrated on a representative corpus.',
    ...(providerVerified ? [] : [providerResult.limitation]),
    ...(input.kind === 'url' ? ['The URL was analyzed as text only and was never contacted.'] : []),
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
    uncertaintyReasons,
    evidence,
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
    versions: {
      normalization: 'normalize-v1',
      signals: 'signals-v1',
      scoring: 'score-v1',
      actions: 'actions-v1',
    },
  };
}

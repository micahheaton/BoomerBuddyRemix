export const riskBands = ['lower_concern', 'caution', 'high_concern', 'unknown'] as const;
export type RiskBand = (typeof riskBands)[number];
export type EvidenceSufficiency = 'limited' | 'moderate' | 'strong';

export const signalKinds = [
  'urgency',
  'secrecy',
  'credential_request',
  'unusual_payment',
  'remote_access',
  'authority_impersonation',
  'threat',
  'suspicious_contact_instruction',
  'prompt_injection',
  'url_userinfo',
  'url_ip_host',
  'url_punycode',
  'url_insecure_scheme',
  'url_nonstandard_port',
  'url_excessive_subdomains',
] as const;
export type SignalKind = (typeof signalKinds)[number];

export interface FeatureVector {
  readonly artifactKind: 'text' | 'url';
  readonly signals: readonly SignalKind[];
  readonly byteLengthBucket: 'empty' | 'small' | 'medium' | 'large';
  readonly url?: {
    readonly scheme: 'http' | 'https';
    readonly hasCredentials: boolean;
    readonly hostKind: 'domain' | 'ip';
    readonly usesInternationalizedDomain: boolean;
    readonly subdomainCount: number;
    readonly hasNonstandardPort: boolean;
  };
}

export interface ProviderObservation {
  readonly code: string;
  readonly label: string;
  readonly disposition: 'malicious' | 'suspicious' | 'not_found';
  readonly weight: number;
  readonly validUntil?: string;
  readonly limitation: string;
}

export interface ProviderResult {
  readonly status: 'unknown' | 'unavailable' | 'mock' | 'observed';
  readonly providerName: string;
  readonly providerVersion: string;
  readonly observations: readonly ProviderObservation[];
  readonly limitation: string;
}

export interface FraudProvider {
  readonly inspect: (features: FeatureVector) => Promise<ProviderResult>;
}

export interface FraudEvidence {
  readonly code: string;
  readonly signal?: SignalKind;
  readonly label: string;
  readonly weight: number;
  readonly source: {
    readonly kind: 'artifact_derived' | 'provider' | 'missing_or_failed';
    readonly name: string;
    readonly version: string;
    readonly status: ProviderResult['status'] | 'observed';
  };
  readonly observedAt: string;
  readonly validUntil?: string;
  readonly limitation: string;
}

export const safeActionIds = [
  'pause',
  'do_not_interact',
  'do_not_pay',
  'do_not_share_codes',
  'do_not_install_remote_access',
  'verify_using_official_channel',
  'contact_trusted_person',
  'preserve_evidence',
  'secure_accounts',
  'contact_financial_institution',
  'report_officially',
] as const;
export type SafeActionId = (typeof safeActionIds)[number];

export interface SafeAction {
  readonly id: SafeActionId;
  readonly priority: 1 | 2 | 3;
  readonly title: string;
  readonly instruction: string;
}

export interface FraudAssessment {
  readonly risk: RiskBand;
  readonly score: number;
  readonly confidence: EvidenceSufficiency;
  readonly calibration: 'not_calibrated';
  readonly uncertaintyReasons: readonly string[];
  readonly evidence: readonly FraudEvidence[];
  readonly explanation: {
    readonly headline: string;
    readonly reasons: readonly string[];
    readonly limitation: string;
  };
  readonly actions: readonly SafeAction[];
  readonly versions: {
    readonly normalization: 'normalize-v1';
    readonly signals: 'signals-v1';
    readonly scoring: 'score-v1';
    readonly actions: 'actions-v1';
  };
}

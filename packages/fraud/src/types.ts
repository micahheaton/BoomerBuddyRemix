import type { SafeRedaction, SensitiveSafetyFlag } from '@boomerbuddy/security';

export const riskBands = ['unknown', 'caution', 'high_concern'] as const;
export type RiskBand = (typeof riskBands)[number];
export const reservedRiskBands = ['lower_concern'] as const;
export type ReservedRiskBand = (typeof reservedRiskBands)[number];
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

export interface PreparedCheckInput {
  readonly kind: 'text' | 'url';
  readonly redactedContent: string;
  readonly redactions: readonly SafeRedaction[];
  readonly safetyFlags: readonly SensitiveSafetyFlag[];
}

export const providerRoles = [
  'structural_reputation',
  'campaign_intelligence',
  'language_pattern',
] as const;
export type ProviderRole = (typeof providerRoles)[number];

export const providerInputFields = [
  'artifactKind',
  'signals',
  'byteLengthBucket',
  'urlStructure',
] as const;
export type ProviderInputField = (typeof providerInputFields)[number];

export type ProviderRequest =
  | {
      readonly role: 'structural_reputation';
      readonly artifactKind: FeatureVector['artifactKind'];
      readonly signals: readonly SignalKind[];
      readonly urlStructure?: FeatureVector['url'];
    }
  | {
      readonly role: 'campaign_intelligence';
      readonly artifactKind: FeatureVector['artifactKind'];
      readonly signals: readonly SignalKind[];
    }
  | {
      readonly role: 'language_pattern';
      readonly artifactKind: FeatureVector['artifactKind'];
      readonly signals: readonly SignalKind[];
      readonly byteLengthBucket: FeatureVector['byteLengthBucket'];
    };

export interface ProviderManifest {
  readonly providerName: string;
  readonly providerVersion: string;
  readonly role: ProviderRole;
  readonly capabilityId: string;
  readonly dataPolicyVersion: string;
  readonly inputFields: readonly ProviderInputField[];
  readonly deployment: 'local_unknown' | 'deterministic_mock' | 'live';
  readonly networkEgress: 'none' | 'declared_provider_only';
  readonly retention: 'none' | 'ephemeral' | 'provider_declared';
  readonly trainingUse: 'prohibited' | 'provider_declared';
  readonly timeoutMs: number;
  readonly costUnits: number;
}

export interface ProviderObservation {
  readonly code: string;
  readonly label: string;
  readonly disposition: 'malicious' | 'suspicious' | 'not_found';
  readonly weight: number;
  readonly validUntil?: string;
  readonly limitation: string;
}

export interface ProviderRawResult {
  readonly status: 'unknown' | 'mock' | 'observed';
  readonly observations: readonly ProviderObservation[];
  readonly limitation: string;
}

export interface ProviderProvenance {
  readonly providerName: string;
  readonly providerVersion: string;
  readonly role: ProviderRole;
  readonly capabilityId: string;
  readonly dataPolicyVersion: string;
  readonly deployment: ProviderManifest['deployment'];
  readonly networkEgress: ProviderManifest['networkEgress'];
  readonly retention: ProviderManifest['retention'];
  readonly trainingUse: ProviderManifest['trainingUse'];
  readonly inputFields: readonly ProviderInputField[];
  readonly policyVersion: string;
}

export interface ProviderResult {
  readonly status: 'unknown' | 'unavailable' | 'mock' | 'observed';
  readonly providerName: string;
  readonly providerVersion: string;
  readonly observations: readonly ProviderObservation[];
  readonly limitation: string;
  readonly provenance: ProviderProvenance;
}

export interface FraudProvider {
  readonly manifest: ProviderManifest;
  readonly inspect: (request: ProviderRequest, signal: AbortSignal) => Promise<ProviderRawResult>;
}

export interface ProviderDispatchPolicy {
  readonly policyVersion: string;
  readonly allowedProviders: readonly string[];
  readonly allowedRoles: readonly ProviderRole[];
  readonly maximumProviders: number;
  readonly maximumTotalCostUnits: number;
  readonly maximumTimeoutMs: number;
  readonly allowNetworkEgress: boolean;
  readonly allowProviderRetention: boolean;
  readonly allowProviderTraining: boolean;
  readonly killSwitch: () => boolean;
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
    readonly provenance?: ProviderProvenance;
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
  readonly inputSafety: {
    readonly redactions: readonly SafeRedaction[];
    readonly flags: readonly SensitiveSafetyFlag[];
  };
  readonly uncertaintyReasons: readonly string[];
  readonly evidence: readonly FraudEvidence[];
  readonly providerRuns: readonly ProviderProvenance[];
  readonly explanation: {
    readonly headline: string;
    readonly reasons: readonly string[];
    readonly limitation: string;
  };
  readonly actions: readonly SafeAction[];
  readonly versions: {
    readonly normalization: 'normalize-v2';
    readonly signals: 'signals-v2';
    readonly scoring: 'score-v2';
    readonly actions: 'actions-v1';
  };
}

export const feedbackSchemaVersion = 1 as const;

export const feedbackIdentityModes = ['authenticated', 'anonymous', 'support_conversion'] as const;
export type FeedbackIdentityMode = (typeof feedbackIdentityModes)[number];

export const feedbackSourceSurfaces = [
  'web_feedback_form',
  'in_app_contextual',
  'mobile_app',
  'post_check',
  'orientation',
  'cancellation',
  'refund',
  'support_conversion',
] as const;
export type FeedbackSourceSurface = (typeof feedbackSourceSurfaces)[number];

export const feedbackTypes = [
  'product_feedback',
  'bug_report',
  'safety_concern',
  'accessibility_issue',
  'support_request',
  'pricing_feedback',
  'feature_request',
  'cancellation_reason',
  'refund_feedback',
  'research_response',
] as const;
export type FeedbackType = (typeof feedbackTypes)[number];

export const feedbackLinkedObjectTypes = ['check', 'orientation', 'subscription'] as const;
export type FeedbackLinkedObjectType = (typeof feedbackLinkedObjectTypes)[number];

export const feedbackStatuses = [
  'received',
  'minimized',
  'classified',
  'assigned',
  'actioned',
  'no_action',
  'close_loop_pending',
  'closed',
  'withdrawn',
  'restricted',
  'retention_expired',
  'unsafe_unprocessable',
  'support_escalated',
  'incident_escalated',
] as const;
export type FeedbackStatus = (typeof feedbackStatuses)[number];

export const feedbackContentReadableStatuses = ['minimized', 'classified', 'assigned'] as const;
export type FeedbackContentReadableStatus = (typeof feedbackContentReadableStatuses)[number];

export function isFeedbackContentReadableStatus(
  status: FeedbackStatus,
): status is FeedbackContentReadableStatus {
  return feedbackContentReadableStatuses.includes(status as FeedbackContentReadableStatus);
}

export const feedbackSeverities = ['unassessed', 'low', 'medium', 'high', 'critical'] as const;
export type FeedbackSeverity = (typeof feedbackSeverities)[number];

export const feedbackClassifications = [
  'unclassified',
  'individual_preference',
  'repeated_usability_pattern',
  'confirmed_bug',
  'bug_hypothesis',
  'safety_or_fraud_quality',
  'accessibility_blocker',
  'support_request',
  'pricing_objection',
  'feature_opportunity',
  'testimonial_candidate_pending_permission',
  'research_question',
  'out_of_scope_or_unsafe',
] as const;
export type FeedbackClassification = (typeof feedbackClassifications)[number];

export const feedbackQueues = [
  'new_feedback',
  'privacy_security',
  'safety_fraud',
  'accessibility',
  'consented_follow_up',
  'duplicate_review',
  'product_engineering',
  'close_loop_review',
] as const;
export type FeedbackQueue = (typeof feedbackQueues)[number];

export const feedbackRoutingStates = ['unassigned', 'assigned'] as const;
export type FeedbackRoutingState = (typeof feedbackRoutingStates)[number];

export const feedbackCloseLoopStates = [
  'not_requested',
  'ineligible',
  'pending_internal_evidence',
  'human_review_required',
  'closed_without_contact',
] as const;
export type FeedbackCloseLoopState = (typeof feedbackCloseLoopStates)[number];

export const feedbackProcessingSteps = [
  'redaction_verification',
  'classification',
  'deduplication',
  'internal_draft',
] as const;
export type FeedbackProcessingStep = (typeof feedbackProcessingSteps)[number];

export const feedbackEvidenceTiers = [
  'local_simulation',
  'provider_test',
  'deployed_staging',
  'real_human_closed_beta',
  'live_production',
] as const;
export type FeedbackEvidenceTier = (typeof feedbackEvidenceTiers)[number];

export type FeedbackRuntimeEnvironment = 'development' | 'test' | 'production';

export function feedbackEvidenceTierForEnvironment(
  environment: FeedbackRuntimeEnvironment,
): 'local_simulation' | 'live_production' {
  return environment === 'production' ? 'live_production' : 'local_simulation';
}

export const feedbackChannelClasses = ['account_email', 'account_sms', 'in_app'] as const;
export type FeedbackChannelClass = (typeof feedbackChannelClasses)[number];

export interface FeedbackAdapterDefinition {
  readonly key:
    | 'authenticated_text'
    | 'anonymous_text'
    | 'support_conversion'
    | 'attachment'
    | 'audio'
    | 'image'
    | 'video'
    | 'screen_recording'
    | 'inbound_email'
    | 'transcription'
    | 'external_model';
  readonly state: 'production_enabled' | 'local_only_enabled' | 'structurally_disabled';
  readonly externalEffect: false;
  readonly reason: string;
}

export const feedbackAdapterRegistry: readonly FeedbackAdapterDefinition[] = [
  {
    key: 'authenticated_text',
    state: 'production_enabled',
    externalEffect: false,
    reason:
      'Authenticated bounded text is minimized and encrypted before role-scoped review in every runtime.',
  },
  {
    key: 'anonymous_text',
    state: 'local_only_enabled',
    externalEffect: false,
    reason: 'Anonymous text has no account, campaign, or linked-object association.',
  },
  {
    key: 'support_conversion',
    state: 'local_only_enabled',
    externalEffect: false,
    reason: 'Only the current exact support-case assignee may create a content-minimized copy.',
  },
  ...(
    [
      'attachment',
      'audio',
      'image',
      'video',
      'screen_recording',
      'inbound_email',
      'transcription',
      'external_model',
    ] as const
  ).map((key): FeedbackAdapterDefinition => ({
    key,
    state: 'structurally_disabled',
    externalEffect: false,
    reason:
      'Private storage, quarantine/scanning, consent, deletion, provider, and founder gates are not proven.',
  })),
] as const;

const terminalFeedbackStatuses: readonly FeedbackStatus[] = [
  'closed',
  'retention_expired',
  'unsafe_unprocessable',
];

const feedbackTransitions: Readonly<Record<FeedbackStatus, readonly FeedbackStatus[]>> = {
  received: ['minimized', 'unsafe_unprocessable', 'restricted', 'withdrawn'],
  minimized: [
    'classified',
    'assigned',
    'restricted',
    'withdrawn',
    'retention_expired',
    'support_escalated',
    'incident_escalated',
  ],
  classified: [
    'assigned',
    'actioned',
    'no_action',
    'restricted',
    'withdrawn',
    'retention_expired',
    'support_escalated',
    'incident_escalated',
  ],
  assigned: [
    'actioned',
    'no_action',
    'restricted',
    'withdrawn',
    'retention_expired',
    'support_escalated',
    'incident_escalated',
  ],
  actioned: ['close_loop_pending', 'closed', 'restricted', 'withdrawn', 'retention_expired'],
  no_action: ['close_loop_pending', 'closed', 'restricted', 'withdrawn', 'retention_expired'],
  close_loop_pending: ['closed', 'restricted', 'withdrawn', 'retention_expired'],
  withdrawn: ['restricted', 'retention_expired'],
  restricted: ['retention_expired'],
  support_escalated: [
    'assigned',
    'actioned',
    'no_action',
    'closed',
    'restricted',
    'withdrawn',
    'retention_expired',
  ],
  incident_escalated: [
    'assigned',
    'actioned',
    'no_action',
    'closed',
    'restricted',
    'withdrawn',
    'retention_expired',
  ],
  closed: [],
  retention_expired: [],
  unsafe_unprocessable: [],
};

export function assertFeedbackTransition(from: FeedbackStatus, to: FeedbackStatus): void {
  if (from === to) throw new TypeError('Feedback state transitions cannot be no-ops');
  if (terminalFeedbackStatuses.includes(from) || !feedbackTransitions[from].includes(to)) {
    throw new TypeError(`Feedback transition ${from} -> ${to} is not permitted`);
  }
}

export function initialFeedbackQueue(input: {
  readonly feedbackType: FeedbackType;
  readonly unsafe: boolean;
}): FeedbackQueue {
  if (input.unsafe) return 'privacy_security';
  if (input.feedbackType === 'safety_concern') return 'safety_fraud';
  if (input.feedbackType === 'accessibility_issue') return 'accessibility';
  return 'new_feedback';
}

export function assertFeedbackSourceCompatible(input: {
  readonly identityMode: FeedbackIdentityMode;
  readonly sourceSurface: FeedbackSourceSurface;
  readonly linkedObjectType?: FeedbackLinkedObjectType;
}): void {
  if (
    input.identityMode === 'anonymous' &&
    (input.sourceSurface !== 'web_feedback_form' || input.linkedObjectType !== undefined)
  ) {
    throw new TypeError('Anonymous feedback cannot carry contextual or linked-object association');
  }
  if (
    (input.identityMode === 'support_conversion') !==
    (input.sourceSurface === 'support_conversion')
  ) {
    throw new TypeError('Support conversion source and identity mode must match');
  }
  const requiredLink: Partial<Record<FeedbackSourceSurface, FeedbackLinkedObjectType>> = {
    post_check: 'check',
    orientation: 'orientation',
    cancellation: 'subscription',
    refund: 'subscription',
  };
  const expected = requiredLink[input.sourceSurface];
  if (expected !== undefined && input.linkedObjectType !== expected) {
    throw new TypeError(`${input.sourceSurface} feedback requires an exact ${expected} link`);
  }
}

function canonicalIpv4(input: string): string | undefined {
  const parts = input.split('.');
  if (parts.length !== 4) return undefined;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^(?:0|[1-9][0-9]{0,2})$/u.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    octets.push(octet);
  }
  return octets.join('.');
}

function ipv6Hextets(input: string): readonly number[] | undefined {
  let candidate = input.toLowerCase();
  if (candidate.includes('.')) {
    const separator = candidate.lastIndexOf(':');
    if (separator < 0) return undefined;
    const ipv4 = canonicalIpv4(candidate.slice(separator + 1));
    if (ipv4 === undefined) return undefined;
    const octets = ipv4.split('.').map(Number);
    candidate = `${candidate.slice(0, separator)}:${(
      ((octets[0] ?? 0) << 8) |
      (octets[1] ?? 0)
    ).toString(16)}:${(((octets[2] ?? 0) << 8) | (octets[3] ?? 0)).toString(16)}`;
  }
  const compressed = candidate.split('::');
  if (compressed.length > 2) return undefined;
  const left = compressed[0] === '' ? [] : (compressed[0]?.split(':') ?? []);
  const right = compressed.length === 1 || compressed[1] === '' ? [] : compressed[1]!.split(':');
  if (
    [...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/u.test(part)) ||
    (compressed.length === 1 && left.length !== 8)
  ) {
    return undefined;
  }
  const missing = 8 - left.length - right.length;
  if (compressed.length === 2 ? missing < 1 : missing !== 0) return undefined;
  return [
    ...left.map((part) => Number.parseInt(part, 16)),
    ...Array.from({ length: missing }, () => 0),
    ...right.map((part) => Number.parseInt(part, 16)),
  ];
}

function canonicalIpv6(input: string): string | undefined {
  const hextets = ipv6Hextets(input);
  if (hextets === undefined || hextets.length !== 8) return undefined;
  if (
    hextets.slice(0, 5).every((part) => part === 0) &&
    hextets[5] === 0xffff &&
    hextets[6] !== undefined &&
    hextets[7] !== undefined
  ) {
    return [hextets[6] >>> 8, hextets[6] & 0xff, hextets[7] >>> 8, hextets[7] & 0xff].join('.');
  }
  let bestStart = -1;
  let bestLength = 0;
  for (let start = 0; start < hextets.length; start += 1) {
    if (hextets[start] !== 0) continue;
    let end = start;
    while (end < hextets.length && hextets[end] === 0) end += 1;
    const length = end - start;
    if (length >= 2 && length > bestLength) {
      bestStart = start;
      bestLength = length;
    }
    start = end - 1;
  }
  const rendered = hextets.map((part) => part.toString(16));
  if (bestStart < 0) return rendered.join(':');
  const left = rendered.slice(0, bestStart).join(':');
  const right = rendered.slice(bestStart + bestLength).join(':');
  return `${left}::${right}`;
}

export function canonicalFeedbackNetworkAddress(input: string): string {
  const candidate = input.trim();
  if (candidate.length < 2 || candidate.length > 128 || candidate.includes('%')) {
    throw new TypeError('Anonymous feedback requires a bounded canonical IP address');
  }
  const ipv4 = canonicalIpv4(candidate);
  if (ipv4 !== undefined) return ipv4;
  const ipv6 = canonicalIpv6(candidate);
  if (ipv6 !== undefined) return ipv6;
  throw new TypeError('Anonymous feedback requires a valid IPv4 or IPv6 address');
}

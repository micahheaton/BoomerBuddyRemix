export const attributionChannels = [
  'organic_search',
  'paid_search',
  'paid_social',
  'referral',
  'partner',
  'affiliate',
  'direct',
  'content',
  'campaign',
  'newsletter',
] as const;

export type AttributionChannel = (typeof attributionChannels)[number];

export const acquisitionMilestones = [
  'landing',
  'first_check',
  'signup',
  'activation',
  'orientation',
  'trial',
  'paid',
  'retention',
  'referral',
] as const;

export type AcquisitionMilestone = (typeof acquisitionMilestones)[number];

export interface RawAttribution {
  channel?: string;
  campaign?: string;
  content?: string;
  medium?: string;
  partner?: string;
  referrerHost?: string;
  source?: string;
}

export interface SanitizedAttribution {
  channel: AttributionChannel;
  campaign?: string;
  content?: string;
  medium?: string;
  partner?: string;
  referrerHost?: string;
  source?: string;
}

const tokenPattern = /^[a-z0-9][a-z0-9._-]*$/i;
const hostPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function cleanToken(value: string | undefined, maximumLength = 100): string | undefined {
  const normalized = value?.trim();
  if (
    normalized === undefined ||
    normalized.length === 0 ||
    normalized.length > maximumLength ||
    !tokenPattern.test(normalized)
  ) {
    return undefined;
  }
  return normalized.toLowerCase();
}

export function sanitizeAttribution(input: RawAttribution): SanitizedAttribution {
  const requestedChannel = cleanToken(input.channel, 40);
  const channel =
    attributionChannels.find((candidate) => candidate === requestedChannel) ?? 'direct';
  const campaign = cleanToken(input.campaign);
  const content = cleanToken(input.content);
  const medium = cleanToken(input.medium);
  const partner = cleanToken(input.partner);
  const referrerHost = input.referrerHost?.trim().toLowerCase();
  const source = cleanToken(input.source);
  return {
    channel,
    ...(campaign === undefined ? {} : { campaign }),
    ...(content === undefined ? {} : { content }),
    ...(medium === undefined ? {} : { medium }),
    ...(partner === undefined ? {} : { partner }),
    ...(referrerHost === undefined || !hostPattern.test(referrerHost) ? {} : { referrerHost }),
    ...(source === undefined ? {} : { source }),
  };
}

export type ContentReviewState =
  'draft' | 'evidence_review' | 'founder_approval' | 'approved' | 'rejected' | 'retired';

export interface GovernedContentDecisionInput {
  evidenceCount: number;
  hasUnsupportedStatistics: boolean;
  hasUnverifiedUrgency: boolean;
  reviewState: ContentReviewState;
  sourceFreshUntil?: Date;
}

export interface GovernedContentDecision {
  publishable: boolean;
  reasons: string[];
}

export function evaluateContentForPublication(
  input: GovernedContentDecisionInput,
  now = new Date(),
): GovernedContentDecision {
  const reasons: string[] = [];
  if (input.reviewState !== 'approved') reasons.push('Content has not completed approval.');
  if (input.evidenceCount < 1) reasons.push('Content has no decision-bearing evidence.');
  if (input.hasUnsupportedStatistics) reasons.push('Content contains unsupported statistics.');
  if (input.hasUnverifiedUrgency) reasons.push('Content contains unverified urgency.');
  if (input.sourceFreshUntil !== undefined && input.sourceFreshUntil.getTime() <= now.getTime()) {
    reasons.push('Content evidence is stale.');
  }
  return { publishable: reasons.length === 0, reasons };
}

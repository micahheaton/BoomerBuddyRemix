import { DomainError } from './errors';

export const governedContentReviewRoles = [
  'skeptical',
  'accessibility',
  'privacy_rights',
  'final_human',
] as const;

export type GovernedContentReviewRole = (typeof governedContentReviewRoles)[number];
export type GovernedContentReviewDecision = 'approve' | 'changes_requested' | 'reject';

export interface GovernedPublicFact {
  readonly sourceId: string;
  readonly sourceDigest: string;
  readonly region: string;
  readonly title: string;
  readonly summary: string;
  readonly safeActions: readonly string[];
  readonly sourceTitle: string;
  readonly sourceUrl: string;
  readonly sourcePublishedAt: Date;
  readonly reviewedAt: Date;
  readonly expiresAt: Date;
}

export interface GovernedPlatformDrafts {
  readonly youtubeScript: string;
  readonly tiktokCaption: string;
  readonly linkedinPost: string;
}

export interface GovernedContentDocument {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly platformDrafts: GovernedPlatformDrafts;
}

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function assertGovernedContentSlug(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 100 || !slugPattern.test(normalized)) {
    throw new DomainError('invalid_input', 'Content slug must be lowercase words and hyphens');
  }
  return normalized;
}

function boundedText(value: string, field: string, maximum: number): string {
  const normalized = value
    .normalize('NFKC')
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+/gu, ' ')
    .trim();
  if (normalized.length < 1 || normalized.length > maximum) {
    throw new DomainError('invalid_input', `${field} must contain 1 to ${maximum} characters`);
  }
  return normalized;
}

export function normalizeGovernedContentDocument(
  document: GovernedContentDocument,
): GovernedContentDocument {
  return {
    slug: assertGovernedContentSlug(document.slug),
    title: boundedText(document.title, 'Title', 160),
    summary: boundedText(document.summary, 'Summary', 500),
    body: boundedText(document.body, 'Body', 16_000),
    platformDrafts: {
      youtubeScript: boundedText(document.platformDrafts.youtubeScript, 'YouTube draft', 4_000),
      tiktokCaption: boundedText(document.platformDrafts.tiktokCaption, 'TikTok draft', 2_200),
      linkedinPost: boundedText(document.platformDrafts.linkedinPost, 'LinkedIn draft', 3_000),
    },
  };
}

function slugFromFact(fact: GovernedPublicFact): string {
  const words = `${fact.region} ${fact.title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 96)
    .replace(/-$/u, '');
  return assertGovernedContentSlug(words.length >= 3 ? words : `scam-guidance-${fact.sourceId}`);
}

/**
 * Produces an internal draft from one already reviewed, structured public fact. It performs no
 * fetch, model call, customer lookup, provider action, publication, or outbound delivery.
 */
export function buildDeterministicGovernedDraft(fact: GovernedPublicFact): GovernedContentDocument {
  const actions = fact.safeActions.map((action, index) => `${index + 1}. ${action}`).join('\n');
  const body = `${fact.summary}\n\nWhat to do now\n\n${actions}\n\nWhy this matters\n\nTake a pause before sending money, sharing a code, or granting device access. Verify the request through a contact method you already trust.`;
  const sourceLine = `Based on reviewed public guidance from ${fact.sourceTitle}.`;
  return normalizeGovernedContentDocument({
    slug: slugFromFact(fact),
    title: fact.title,
    summary: fact.summary,
    body,
    platformDrafts: {
      youtubeScript: `${fact.title}\n\n${fact.summary}\n\n${actions}\n\n${sourceLine}`,
      tiktokCaption: `${fact.title}: pause, verify through a trusted channel, and do not share codes or send money under pressure. ${sourceLine}`,
      linkedinPost: `${fact.title}\n\n${fact.summary}\n\nPractical steps:\n${actions}\n\n${sourceLine}`,
    },
  });
}

export function governedPublicationEligibility(input: {
  readonly exactDigest: boolean;
  readonly unexpired: boolean;
  readonly decisions: Readonly<
    Partial<Record<GovernedContentReviewRole, GovernedContentReviewDecision>>
  >;
  readonly skepticalActorId?: string;
  readonly finalActorId?: string;
}): { readonly eligible: boolean; readonly blockers: readonly string[] } {
  const blockers: string[] = [];
  for (const role of governedContentReviewRoles) {
    if (input.decisions[role] !== 'approve') blockers.push(`review_${role}_not_approved`);
  }
  if (!input.exactDigest) blockers.push('document_digest_mismatch');
  if (!input.unexpired) blockers.push('source_or_revision_expired');
  if (
    input.skepticalActorId !== undefined &&
    input.finalActorId !== undefined &&
    input.skepticalActorId === input.finalActorId
  ) {
    blockers.push('skeptical_and_final_reviewer_must_differ');
  }
  return { eligible: blockers.length === 0, blockers };
}

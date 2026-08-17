export const editorialEvidenceTier = 'local_simulation' as const;

export const editorialProducts = [
  'urgent_alert',
  'daily_tip',
  'weekly_brief',
  'family_prompt',
  'recovery_guidance',
  'learning_update',
  'founder_video_brief',
  'seo_blog_draft',
  'partner_bulletin',
  'internal_support_brief',
] as const;

export type EditorialProduct = (typeof editorialProducts)[number];

export const editorialReviewRoles = [
  'fraud_analysis',
  'evidence_corroboration',
  'safety_action',
  'skeptical',
  'accessibility',
  'privacy_rights',
  'final_human',
] as const;

export type EditorialReviewRole = (typeof editorialReviewRoles)[number];

export const prerequisiteEditorialReviewRoles = editorialReviewRoles.filter(
  (role): role is Exclude<EditorialReviewRole, 'final_human'> => role !== 'final_human',
);

export const editorialContentStates = [
  'draft',
  'under_review',
  'approved_internal',
  'correction_pending',
  'corrected',
  'retracted',
  'expired',
  'archived',
] as const;

export type EditorialContentState = (typeof editorialContentStates)[number];

export const editorialRuntimeCapabilities = Object.freeze({
  externalFetch: false,
  externalModel: false,
  generation: false,
  providerProcessing: false,
  publication: false,
  outboundDelivery: false,
  transcription: false,
});

const editorialTransitions: Readonly<
  Record<EditorialContentState, readonly EditorialContentState[]>
> = Object.freeze({
  draft: ['under_review', 'retracted', 'expired', 'archived'],
  under_review: ['approved_internal', 'correction_pending', 'retracted', 'expired', 'archived'],
  approved_internal: ['correction_pending', 'retracted', 'expired', 'archived'],
  correction_pending: ['corrected', 'retracted', 'expired', 'archived'],
  corrected: ['correction_pending', 'retracted', 'expired', 'archived'],
  retracted: ['archived'],
  expired: ['archived'],
  archived: [],
});

export function canTransitionEditorialContent(
  current: EditorialContentState,
  next: EditorialContentState,
): boolean {
  return editorialTransitions[current].includes(next);
}

export interface EditorialApprovalInput {
  readonly now: Date;
  readonly expiresAt: Date;
  readonly sourceReviewDueAt: Date;
  readonly sourceApproved: boolean;
  readonly claimExpired: boolean;
  readonly unresolvedContradiction: boolean;
  readonly hasUnsupportedStatistics: boolean;
  readonly hasUnverifiedUrgency: boolean;
  readonly approvals: Readonly<Partial<Record<EditorialReviewRole, string>>>;
}

export interface EditorialApprovalDecision {
  readonly internallyApprovable: boolean;
  readonly publicationEligible: false;
  readonly externalActionExecuted: false;
  readonly reasons: readonly string[];
}

export function evaluateEditorialApproval(
  input: EditorialApprovalInput,
): EditorialApprovalDecision {
  const reasons: string[] = [];
  if (!input.sourceApproved) reasons.push('The exact source version is not approved.');
  if (input.sourceReviewDueAt.getTime() <= input.now.getTime()) {
    reasons.push('The exact source version is stale.');
  }
  if (input.expiresAt.getTime() <= input.now.getTime() || input.claimExpired) {
    reasons.push('The claim or draft has expired.');
  }
  if (input.unresolvedContradiction) reasons.push('A contradiction remains unresolved.');
  if (input.hasUnsupportedStatistics) reasons.push('Unsupported statistics remain.');
  if (input.hasUnverifiedUrgency) reasons.push('Unverified urgency remains.');
  for (const role of editorialReviewRoles) {
    if (input.approvals[role] === undefined) reasons.push(`Missing ${role} approval.`);
  }
  const skepticalReviewer = input.approvals.skeptical;
  const finalReviewer = input.approvals.final_human;
  if (
    skepticalReviewer !== undefined &&
    finalReviewer !== undefined &&
    skepticalReviewer === finalReviewer
  ) {
    reasons.push('Skeptical and final review must be independent.');
  }
  return {
    internallyApprovable: reasons.length === 0,
    publicationEligible: false,
    externalActionExecuted: false,
    reasons,
  };
}

export interface CorroborationCandidate {
  readonly relationship: 'corroborates' | 'contradicts' | 'syndication' | 'duplicate';
  readonly confirmed: boolean;
  readonly leftSourceKey: string;
  readonly rightSourceKey: string;
}

export function countIndependentCorroboration(
  candidates: readonly CorroborationCandidate[],
): number {
  const pairKey = (candidate: CorroborationCandidate): string =>
    [candidate.leftSourceKey, candidate.rightSourceKey].sort().join(':');
  const disqualifiedPairs = new Set(
    candidates
      .filter(
        (candidate) =>
          candidate.confirmed &&
          (candidate.relationship === 'syndication' || candidate.relationship === 'duplicate'),
      )
      .map(pairKey),
  );
  const independentPairs = new Set<string>();
  for (const candidate of candidates) {
    if (
      !candidate.confirmed ||
      candidate.relationship !== 'corroborates' ||
      candidate.leftSourceKey === candidate.rightSourceKey
    ) {
      continue;
    }
    const pair = pairKey(candidate);
    if (disqualifiedPairs.has(pair)) continue;
    independentPairs.add(pair);
  }
  return independentPairs.size;
}

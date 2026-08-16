import { z } from 'zod';

const reviewerReferenceSchema = z.string().regex(/^reviewer_[a-z0-9_]+$/u);
const caseReferenceSchema = z.string().regex(/^eval_[a-z0-9_]+$/u);
const verdictSchema = z.enum(['malicious', 'legitimate', 'borderline', 'abstain']);

export const evaluationGovernanceRecordSchema = z.object({
  corpus: z.object({
    corpusId: z.string().regex(/^corpus_[a-z0-9_]+$/u),
    version: z.number().int().positive(),
    sourceBoundary: z.literal('independently_curated_2_0'),
    rightsBasis: z.enum(['project_authored', 'consented', 'licensed']),
    splitState: z.enum(['unsealed', 'sealed']),
    v1RuntimeImport: z.literal(false),
  }),
  cases: z
    .array(
      z.object({
        caseId: caseReferenceSchema,
        split: z.enum(['development', 'validation', 'sealed_test']),
        sourceKind: z.enum(['project_authored', 'consented', 'licensed']),
        sensitivity: z.enum(['non_sensitive', 'restricted']),
      }),
    )
    .min(1),
  assignments: z.array(
    z.object({
      assignmentId: z.string().regex(/^assignment_[a-z0-9_]+$/u),
      reviewerReference: reviewerReferenceSchema,
      role: z.enum(['reviewer', 'adjudicator']),
      state: z.enum(['assigned', 'completed', 'withdrawn']),
    }),
  ),
  reviews: z.array(
    z.object({
      reviewId: z.string().regex(/^review_[a-z0-9_]+$/u),
      caseId: caseReferenceSchema,
      assignmentId: z.string().regex(/^assignment_[a-z0-9_]+$/u),
      verdict: verdictSchema,
      confidence: z.enum(['limited', 'moderate', 'strong']),
      rationale: z.string().min(1).max(2_000),
      reviewedAt: z.string().datetime(),
    }),
  ),
  adjudications: z.array(
    z.object({
      adjudicationId: z.string().regex(/^adjudication_[a-z0-9_]+$/u),
      caseId: caseReferenceSchema,
      assignmentId: z.string().regex(/^assignment_[a-z0-9_]+$/u),
      finalVerdict: z.enum(['malicious', 'legitimate', 'borderline', 'excluded']),
      disagreementSummary: z.string().min(1).max(2_000),
      rationale: z.string().min(1).max(2_000),
      adjudicatedAt: z.string().datetime(),
    }),
  ),
});

export type EvaluationGovernanceRecord = z.infer<typeof evaluationGovernanceRecordSchema>;

export interface EvaluationReleaseGate {
  readonly decision: 'blocked' | 'passed';
  readonly releaseKind: 'evaluation_evidence_only';
  readonly calibrationClaim: 'not_calibrated';
  readonly reasons: readonly string[];
  readonly totals: {
    readonly cases: number;
    readonly disagreements: number;
    readonly adjudicatedDisagreements: number;
  };
}

export function evaluateReleaseGate(
  candidate: EvaluationGovernanceRecord,
  run: {
    readonly calibration: 'not_calibrated';
    readonly failedCases: number;
    readonly forbiddenActionViolations: number;
  },
): EvaluationReleaseGate {
  const record = evaluationGovernanceRecordSchema.parse(candidate);
  const reasons: string[] = [];
  if (record.corpus.splitState !== 'sealed') reasons.push('split_not_sealed');
  if (run.failedCases > 0) reasons.push('evaluation_cases_failed');
  if (run.forbiddenActionViolations > 0) reasons.push('forbidden_action_violation');

  const assignmentById = new Map(record.assignments.map((item) => [item.assignmentId, item]));
  let disagreements = 0;
  let adjudicatedDisagreements = 0;
  for (const testCase of record.cases) {
    const reviews = record.reviews.filter((review) => review.caseId === testCase.caseId);
    const validReviews = reviews.filter((review) => {
      const assignment = assignmentById.get(review.assignmentId);
      return assignment?.role === 'reviewer' && assignment.state === 'completed';
    });
    const reviewers = new Set(
      validReviews.map((review) => assignmentById.get(review.assignmentId)?.reviewerReference),
    );
    if (reviewers.size < 2) {
      reasons.push(`insufficient_independent_reviews:${testCase.caseId}`);
      continue;
    }
    const verdicts = new Set(validReviews.map((review) => review.verdict));
    if (verdicts.size <= 1) continue;
    disagreements += 1;
    const adjudication = record.adjudications.find((item) => item.caseId === testCase.caseId);
    const assignment =
      adjudication === undefined ? undefined : assignmentById.get(adjudication.assignmentId);
    if (
      adjudication === undefined ||
      assignment?.role !== 'adjudicator' ||
      assignment.state !== 'completed' ||
      reviewers.has(assignment.reviewerReference)
    ) {
      reasons.push(`unadjudicated_disagreement:${testCase.caseId}`);
    } else {
      adjudicatedDisagreements += 1;
    }
  }
  return {
    decision: reasons.length === 0 ? 'passed' : 'blocked',
    releaseKind: 'evaluation_evidence_only',
    calibrationClaim: 'not_calibrated',
    reasons: [...new Set(reasons)],
    totals: { cases: record.cases.length, disagreements, adjudicatedDisagreements },
  };
}

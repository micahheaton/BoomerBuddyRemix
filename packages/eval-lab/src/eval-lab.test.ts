import { describe, expect, it } from 'vitest';
import {
  evaluateReleaseGate,
  formatEvaluationReport,
  runEvaluation,
  runOneCorpus,
  type EvaluationGovernanceRecord,
} from './index';

describe('versioned fraud evaluation lab', () => {
  it('passes action invariants across malicious, legitimate, borderline, injection and outage cases', async () => {
    const report = await runEvaluation(runOneCorpus, {
      fingerprintKey: Buffer.alloc(32, 11),
      now: new Date('2026-01-01T00:00:00Z'),
    });
    expect(report.summary.cases).toBeGreaterThanOrEqual(10);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.forbiddenActionViolations).toBe(0);
    expect(report.summary.providerFailures).toBe(1);
    expect(report.calibration).toBe('not_calibrated');
    expect(report.confusion.falseNegative).toBe(0);
    expect(report.cases.some((item) => item.caseId === 'eval_injection_payment')).toBe(true);
    expect(report.cases.some((item) => item.providerFailed)).toBe(true);
  });

  it('produces stable scoped fingerprints without exposing fixture content in the human report', async () => {
    const first = await runEvaluation(runOneCorpus, {
      fingerprintKey: Buffer.alloc(32, 12),
      now: new Date('2026-01-01T00:00:00Z'),
    });
    const second = await runEvaluation(runOneCorpus, {
      fingerprintKey: Buffer.alloc(32, 12),
      now: new Date('2026-01-01T00:00:00Z'),
    });
    expect(first.cases.map((item) => item.caseFingerprint)).toEqual(
      second.cases.map((item) => item.caseFingerprint),
    );
    const human = formatEvaluationReport(first);
    expect(human).toContain('action invariants only');
    expect(human).not.toContain(runOneCorpus.cases[0]?.artifact.content ?? 'fixture-missing');
  });

  it('rejects short fingerprint keys', async () => {
    await expect(
      runEvaluation(runOneCorpus, {
        fingerprintKey: Buffer.alloc(8),
        now: new Date('2026-01-01T00:00:00Z'),
      }),
    ).rejects.toThrow('at least 32 bytes');
  });

  it('blocks disagreement until an independent adjudicator seals the evidence', () => {
    const base: EvaluationGovernanceRecord = {
      corpus: {
        corpusId: 'corpus_run2_candidate',
        version: 1,
        sourceBoundary: 'independently_curated_2_0',
        rightsBasis: 'project_authored',
        splitState: 'sealed',
        v1RuntimeImport: false,
      },
      cases: [
        {
          caseId: 'eval_governed_case',
          split: 'sealed_test',
          sourceKind: 'project_authored',
          sensitivity: 'non_sensitive',
        },
      ],
      assignments: [
        {
          assignmentId: 'assignment_reviewer_one',
          reviewerReference: 'reviewer_one',
          role: 'reviewer',
          state: 'completed',
        },
        {
          assignmentId: 'assignment_reviewer_two',
          reviewerReference: 'reviewer_two',
          role: 'reviewer',
          state: 'completed',
        },
        {
          assignmentId: 'assignment_adjudicator',
          reviewerReference: 'reviewer_adjudicator',
          role: 'adjudicator',
          state: 'completed',
        },
      ],
      reviews: [
        {
          reviewId: 'review_one',
          caseId: 'eval_governed_case',
          assignmentId: 'assignment_reviewer_one',
          verdict: 'malicious',
          confidence: 'moderate',
          rationale: 'Warning signs support the malicious label.',
          reviewedAt: '2026-08-16T00:00:00.000Z',
        },
        {
          reviewId: 'review_two',
          caseId: 'eval_governed_case',
          assignmentId: 'assignment_reviewer_two',
          verdict: 'borderline',
          confidence: 'limited',
          rationale: 'Context is insufficient without adjudication.',
          reviewedAt: '2026-08-16T00:01:00.000Z',
        },
      ],
      adjudications: [],
    };
    const run = {
      calibration: 'not_calibrated' as const,
      failedCases: 0,
      forbiddenActionViolations: 0,
    };
    expect(evaluateReleaseGate(base, run)).toEqual(
      expect.objectContaining({
        decision: 'blocked',
        reasons: ['unadjudicated_disagreement:eval_governed_case'],
      }),
    );
    const adjudicated: EvaluationGovernanceRecord = {
      ...base,
      adjudications: [
        {
          adjudicationId: 'adjudication_one',
          caseId: 'eval_governed_case',
          assignmentId: 'assignment_adjudicator',
          finalVerdict: 'malicious',
          disagreementSummary: 'Reviewers differed on whether context was sufficient.',
          rationale: 'The authored scenario contains explicit payment and secrecy signals.',
          adjudicatedAt: '2026-08-16T00:02:00.000Z',
        },
      ],
    };
    expect(evaluateReleaseGate(adjudicated, run)).toEqual(
      expect.objectContaining({
        decision: 'passed',
        releaseKind: 'evaluation_evidence_only',
        calibrationClaim: 'not_calibrated',
        reasons: [],
      }),
    );
  });
});

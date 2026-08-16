import { z } from 'zod';
import { riskBands, safeActionIds, signalKinds } from '@boomerbuddy/fraud';

export const evaluationCaseSchema = z.object({
  caseId: z.string().regex(/^eval_[a-z0-9_]+$/u),
  version: z.number().int().positive(),
  artifact: z.object({
    kind: z.enum(['text', 'url']),
    content: z.string().min(1).max(16_384),
  }),
  groundTruth: z.enum(['malicious', 'legitimate', 'borderline']),
  scamFamily: z.string().min(1),
  locale: z.string().min(2),
  channel: z.string().min(1),
  allowedRiskBands: z.array(z.enum(riskBands)).min(1),
  requiredSignals: z.array(z.enum(signalKinds)),
  requiredActions: z.array(z.enum(safeActionIds)),
  forbiddenActions: z.array(z.string().min(1)),
  forbiddenClaims: z.array(z.string().min(1)),
  providerMode: z.enum(['local_unknown', 'outage']).default('local_unknown'),
  provenance: z.literal('synthetic-build-run-1'),
  licenseOrConsent: z.literal('project-authored-synthetic'),
  adjudication: z.literal('single-author-harness-only'),
  sensitivity: z.literal('non-sensitive'),
});

export const evaluationCorpusSchema = z.object({
  corpusId: z.literal('boomerbuddy-run-1-synthetic'),
  version: z.literal(1),
  purpose: z.literal('harness_and_action_invariants_only'),
  cases: z.array(evaluationCaseSchema).min(10),
});

export type EvaluationCase = z.infer<typeof evaluationCaseSchema>;
export type EvaluationCorpus = z.infer<typeof evaluationCorpusSchema>;

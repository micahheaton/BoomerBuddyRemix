import { createHmac } from 'node:crypto';
import {
  analyzeCheck,
  type FraudAssessment,
  type FraudProvider,
  LocalUnknownProvider,
  type ProviderManifest,
  type RiskBand,
} from '@boomerbuddy/fraud';
import { evaluationCorpusSchema, type EvaluationCase, type EvaluationCorpus } from './schema';

export interface EvaluationCaseResult {
  readonly caseId: string;
  readonly caseVersion: number;
  readonly caseFingerprint: string;
  readonly groundTruth: EvaluationCase['groundTruth'];
  readonly actualRisk: RiskBand;
  readonly score: number;
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly latencyMs: number;
  readonly providerFailed: boolean;
}

export interface EvaluationReport {
  readonly corpus: { readonly id: string; readonly version: number; readonly purpose: string };
  readonly systemVersions: FraudAssessment['versions'];
  readonly calibration: 'not_calibrated';
  readonly disclaimer: string;
  readonly summary: {
    readonly cases: number;
    readonly passed: number;
    readonly failed: number;
    readonly forbiddenActionViolations: number;
    readonly providerFailures: number;
  };
  readonly confusion: {
    readonly truePositive: number;
    readonly falsePositive: number;
    readonly trueNegative: number;
    readonly falseNegative: number;
    readonly abstained: number;
    readonly maliciousAbstained: number;
    readonly excludedBorderline: number;
  };
  readonly exploratoryScoreBuckets: readonly {
    readonly range: string;
    readonly cases: number;
    readonly malicious: number;
  }[];
  readonly cases: readonly EvaluationCaseResult[];
}

class OutageProvider implements FraudProvider {
  readonly manifest: ProviderManifest = {
    providerName: 'synthetic-outage',
    providerVersion: '1',
    role: 'structural_reputation',
    capabilityId: 'outage-harness',
    dataPolicyVersion: 'least-data-v1',
    inputFields: ['artifactKind', 'signals', 'urlStructure'],
    deployment: 'local_unknown',
    networkEgress: 'none',
    retention: 'none',
    trainingUse: 'prohibited',
    timeoutMs: 50,
    costUnits: 0,
  };

  async inspect(): Promise<never> {
    throw new Error('Synthetic provider outage');
  }
}

function caseFingerprint(testCase: EvaluationCase, key: Uint8Array): string {
  if (key.byteLength < 32)
    throw new TypeError('Evaluation fingerprint key must be at least 32 bytes');
  const parts = [
    'boomerbuddy:evaluation-case',
    testCase.caseId,
    String(testCase.version),
    testCase.artifact.kind,
    testCase.artifact.content,
  ];
  const mac = createHmac('sha256', key);
  for (const part of parts) {
    const bytes = Buffer.from(part, 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.byteLength);
    mac.update(length).update(bytes);
  }
  return mac.digest('base64url');
}

function evaluateCase(
  testCase: EvaluationCase,
  assessment: FraudAssessment,
): { readonly failures: readonly string[]; readonly forbiddenActionViolations: number } {
  const failures: string[] = [];
  if (!testCase.allowedRiskBands.includes(assessment.risk)) {
    failures.push(`risk:${assessment.risk}`);
  }
  if (testCase.groundTruth === 'malicious' && assessment.risk === 'unknown') {
    failures.push('malicious_not_flagged');
  }
  const signals = new Set(
    assessment.evidence.flatMap((item) => (item.signal === undefined ? [] : [item.signal])),
  );
  for (const signal of testCase.requiredSignals) {
    if (!signals.has(signal)) failures.push(`missing_signal:${signal}`);
  }
  const actions = new Set<string>(assessment.actions.map((action) => action.id));
  for (const action of testCase.requiredActions) {
    if (!actions.has(action)) failures.push(`missing_action:${action}`);
  }
  let forbiddenActionViolations = 0;
  for (const action of testCase.forbiddenActions) {
    if (actions.has(action)) {
      failures.push(`forbidden_action:${action}`);
      forbiddenActionViolations += 1;
    }
  }
  const serialized = JSON.stringify(assessment).toLocaleLowerCase('en-US');
  for (const claim of testCase.forbiddenClaims) {
    if (serialized.includes(claim.toLocaleLowerCase('en-US')))
      failures.push(`forbidden_claim:${claim}`);
  }
  if (assessment.calibration !== 'not_calibrated') failures.push('unsupported_calibration_claim');
  return { failures, forbiddenActionViolations };
}

export async function runEvaluation(
  inputCorpus: EvaluationCorpus,
  options: { readonly fingerprintKey: Uint8Array; readonly now?: Date },
): Promise<EvaluationReport> {
  const corpus = evaluationCorpusSchema.parse(inputCorpus);
  const results: EvaluationCaseResult[] = [];
  let forbiddenActionViolations = 0;
  let providerFailures = 0;
  let systemVersions: FraudAssessment['versions'] | undefined;

  for (const testCase of corpus.cases) {
    const provider =
      testCase.providerMode === 'outage' ? new OutageProvider() : new LocalUnknownProvider();
    const started = performance.now();
    const assessment = await analyzeCheck(testCase.artifact, {
      provider,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    const latencyMs = performance.now() - started;
    systemVersions = assessment.versions;
    const evaluated = evaluateCase(testCase, assessment);
    forbiddenActionViolations += evaluated.forbiddenActionViolations;
    const providerFailed = assessment.evidence.some((item) => item.code === 'provider.unavailable');
    if (providerFailed) providerFailures += 1;
    results.push({
      caseId: testCase.caseId,
      caseVersion: testCase.version,
      caseFingerprint: caseFingerprint(testCase, options.fingerprintKey),
      groundTruth: testCase.groundTruth,
      actualRisk: assessment.risk,
      score: assessment.score,
      passed: evaluated.failures.length === 0,
      failures: evaluated.failures,
      latencyMs,
      providerFailed,
    });
  }

  if (systemVersions === undefined)
    throw new Error('Evaluation corpus unexpectedly contained no cases');
  const confusion = {
    truePositive: 0,
    falsePositive: 0,
    trueNegative: 0,
    falseNegative: 0,
    abstained: 0,
    maliciousAbstained: 0,
    excludedBorderline: 0,
  };
  for (const result of results) {
    if (result.groundTruth === 'borderline') {
      confusion.excludedBorderline += 1;
      continue;
    }
    if (result.actualRisk === 'unknown') {
      confusion.abstained += 1;
      if (result.groundTruth === 'malicious') confusion.maliciousAbstained += 1;
      continue;
    }
    const predictsConcern = result.actualRisk === 'caution' || result.actualRisk === 'high_concern';
    if (result.groundTruth === 'malicious') {
      if (predictsConcern) confusion.truePositive += 1;
      else confusion.falseNegative += 1;
    } else if (predictsConcern) confusion.falsePositive += 1;
    else confusion.trueNegative += 1;
  }

  const exploratoryScoreBuckets = [
    { minimum: 0, maximum: 19, range: '0-19' },
    { minimum: 20, maximum: 49, range: '20-49' },
    { minimum: 50, maximum: 100, range: '50-100' },
  ].map((bucket) => {
    const members = results.filter(
      (result) => result.score >= bucket.minimum && result.score <= bucket.maximum,
    );
    return {
      range: bucket.range,
      cases: members.length,
      malicious: members.filter((result) => result.groundTruth === 'malicious').length,
    };
  });
  const passed = results.filter((result) => result.passed).length;
  return {
    corpus: { id: corpus.corpusId, version: corpus.version, purpose: corpus.purpose },
    systemVersions,
    calibration: 'not_calibrated',
    disclaimer:
      'This small synthetic corpus proves harness behavior and action invariants only; it is not representative and supports no accuracy or calibration claim.',
    summary: {
      cases: results.length,
      passed,
      failed: results.length - passed,
      forbiddenActionViolations,
      providerFailures,
    },
    confusion,
    exploratoryScoreBuckets,
    cases: results,
  };
}

export function formatEvaluationReport(report: EvaluationReport): string {
  const lines = [
    `BoomerBuddy evaluation: ${report.summary.passed}/${report.summary.cases} cases passed`,
    `Corpus: ${report.corpus.id} v${report.corpus.version}`,
    `Calibration: ${report.calibration}`,
    `Forbidden-action violations: ${report.summary.forbiddenActionViolations}`,
    `Provider failures exercised: ${report.summary.providerFailures}`,
    `Confusion (exploratory, mutually exclusive): TP=${report.confusion.truePositive} FP=${report.confusion.falsePositive} TN=${report.confusion.trueNegative} FN=${report.confusion.falseNegative} abstained=${report.confusion.abstained} (malicious abstained=${report.confusion.maliciousAbstained})`,
    report.disclaimer,
  ];
  for (const result of report.cases.filter((item) => !item.passed)) {
    lines.push(`FAIL ${result.caseId}: ${result.failures.join(', ')}`);
  }
  return lines.join('\n');
}

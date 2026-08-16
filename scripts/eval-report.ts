import { formatEvaluationReport, runEvaluation, runOneCorpus } from '@boomerbuddy/eval-lab';

const report = await runEvaluation(runOneCorpus, {
  // A fixed local harness key makes CI comparisons reproducible. It fingerprints
  // project-authored synthetic fixtures only and is not a production secret.
  fingerprintKey: Buffer.alloc(32, 23),
  now: new Date('2026-01-01T00:00:00Z'),
});

process.stdout.write(`${formatEvaluationReport(report)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (report.summary.failed > 0 || report.summary.forbiddenActionViolations > 0) {
  process.exitCode = 1;
}

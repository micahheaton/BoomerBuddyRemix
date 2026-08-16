import { describe, expect, it } from 'vitest';
import { formatEvaluationReport, runEvaluation, runOneCorpus } from './index';

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
});

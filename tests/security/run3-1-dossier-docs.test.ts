import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function document(name: string): Promise<string> {
  return readFile(resolve(repositoryRoot, 'docs/run-3-1', name), 'utf8');
}

describe('Run 3.1 final dossier documents', () => {
  it('binds dossier B to runtime candidate A without moving the candidate boundary', async () => {
    const [evidence, verdict] = await Promise.all([
      document('EXTERNAL-BETA-EVIDENCE.md'),
      document('EXECUTIVE-VERDICT.md'),
    ]);

    const runtimeCommit = '690958f851a8ba0dd250de55db73eb5c1176ac94';
    const candidateTag = `run3-1-replit-founding-household-${runtimeCommit.slice(0, 12)}`;
    const tagObject = 'eb096717c54f20ab7aedcd0811cc50c7a3b049d4';
    const lockDigest = 'e9413102fae62a11818b6fa972d02b8f943f7d71716f6ab3e6b6360d479d8e84';
    const reconstructionReceipt = `OFFLINE_CANDIDATE_RECONSTRUCTION_PASS ${runtimeCommit}`;

    for (const dossier of [evidence, verdict]) {
      expect(dossier).toContain(runtimeCommit);
      expect(dossier).toContain(candidateTag);
      expect(dossier).toContain(tagObject);
      expect(dossier).toContain(lockDigest);
      expect(dossier).toContain(reconstructionReceipt);
      expect(dossier).toMatch(/576133(?:`)? bytes/u);
      expect(dossier).not.toMatch(
        /OFFLINE_RECONSTRUCTION_PENDING|reconstruction is still running/iu,
      );
    }

    expect(evidence).toMatch(/final commit and\s+tag/u);
    expect(evidence).toContain('Peeled tag target');
    expect(evidence).toMatch(/Evidence-only dossier commit B\s+\|\s+\*\*DOCUMENT-ONLY\*\*/u);
    expect(evidence).toContain(
      `Exact offline reconstruction receipt            | \`${reconstructionReceipt}\``,
    );
    expect(evidence).toContain('| Unit | 30 files / 296 tests passed. |');
    expect(evidence).toContain('| Integration | 54 files / 401 tests passed. |');
    expect(evidence).toContain('| Security | 16 files / 79 tests passed. |');
    expect(evidence).toContain(
      '| Fraud evaluation | 12/12 synthetic cases passed with zero forbidden-action violations; calibration remains `not_calibrated`. |',
    );
    expect(evidence).toContain(
      '| Unit coverage | Statements 89.29%, branches 86.24%, functions 98.4%, lines 92.53%; authorization, fraud, and security remained above 80%. |',
    );
    expect(evidence).toContain('run3-1-replit-founding-household-d529b3c368d3');
    expect(evidence).toContain('608b6f2d8686f651877c6c9f11d3a38e12a2afbe');
    expect(evidence).toContain('run3-1-replit-founding-household-16c429cbd2e4');
    expect(evidence).toContain('601c75ea16ea958aa7a05d209fa71f516ac1a989');
    expect(evidence).toContain('explicitly superseded, not active candidates');
    expect(evidence).not.toContain('No Run 3.1 runtime candidate is frozen yet');
    expect(evidence).not.toContain('implementation commit does not yet exist');
  });

  it('records one remediation verdict and separates simulated labels from production evidence', async () => {
    const [evidence, verdict] = await Promise.all([
      document('EXTERNAL-BETA-EVIDENCE.md'),
      document('EXECUTIVE-VERDICT.md'),
    ]);

    expect(verdict.startsWith('# REMEDIATE_BEFORE_EXTERNAL_USER\n')).toBe(true);
    expect(
      verdict.match(/^# (?:READY_FOR_FOUNDING_HOUSEHOLD|REMEDIATE_BEFORE_EXTERNAL_USER|NO_GO)$/gmu),
    ).toEqual(['# REMEDIATE_BEFORE_EXTERNAL_USER']);
    expect(evidence).toContain('PGlite, in-process Fastify injection, fake Clerk');
    expect(evidence).toMatch(/Production evidence\s+\|\s+\*\*Unavailable and unauthorized\*\*/u);
    expect(evidence).toContain('Labels such as `production`, `live_production`');
    expect(evidence).toMatch(/Provider-test evidence\s+\|\s+\*\*Unavailable/u);
    expect(evidence).toMatch(/Deployed Replit evidence\s+\|\s+\*\*Unavailable\*\*/u);
    expect(evidence).toMatch(/Human evidence\s+\|\s+\*\*Unavailable\*\*/u);
    expect(verdict).toContain('No external invite or deployment authority exists');
    expect(verdict).toContain('Synthetic-data provider proof');
    expect(verdict).toContain('separate explicit founder authorization');
  });

  it('records the dependency evidence gate as blocked rather than passed', async () => {
    const [evidence, verdict] = await Promise.all([
      document('EXTERNAL-BETA-EVIDENCE.md'),
      document('EXECUTIVE-VERDICT.md'),
    ]);

    for (const dossier of [evidence, verdict]) {
      expect(dossier).toMatch(/private\s+dependency graph to the public npm registry/u);
      expect(dossier).toMatch(/(?:audit|dependency)[\s\S]{0,240}blocked/iu);
      expect(dossier).toMatch(/(?:no|No)\s+(?:such\s+)?approval/u);
      expect(dossier).toMatch(
        /no\s+(?:final\s+)?(?:audit\/SBOM|persistent\s+raw\s+registry)[\s\S]{0,80}claim/iu,
      );
    }

    expect(evidence).toMatch(/No such\s+approval was provided/u);
    expect(evidence).toContain('no registry call was made for candidate A');
  });
});

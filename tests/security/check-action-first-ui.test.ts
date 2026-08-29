import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

function source(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

function section(contents: string, start: string, end: string): string {
  const startIndex = contents.indexOf(start);
  const endIndex = contents.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return contents.slice(startIndex, endIndex);
}

function expectInOrder(contents: string, markers: readonly string[]): void {
  let previousIndex = -1;
  for (const marker of markers) {
    const markerIndex = contents.indexOf(marker);
    expect(
      markerIndex,
      `Expected ${JSON.stringify(marker)} after the previous marker`,
    ).toBeGreaterThan(previousIndex);
    previousIndex = markerIndex;
  }
}

describe('action-first Check results', () => {
  it('puts ranked actions after the public risk summary and before warning-sign details', () => {
    const publicResult = section(
      source('apps/web/src/app/check/page.tsx'),
      'data-testid="public-check-result"',
      '<PublicFooter />',
    );

    expectInOrder(publicResult, [
      '<p>{result.summary}</p>',
      '<h3>Safer next actions</h3>',
      '.sort((left, right) => left.priority - right.priority)',
      '<strong>Do not treat this as proof.</strong>',
      'What the Check noticed',
      '<dl className="definition-grid">',
    ]);
    expect(publicResult).toContain('not proof or certainty');
    expect(publicResult).toContain('Sensitive patterns removed');
  });

  it('puts ranked actions first in signed-in results and expanded History details', () => {
    const memberResult = section(
      source('apps/web/src/app/member/check/page-client.tsx'),
      'data-testid="check-result"',
      '{result.access.canShare',
    );
    expectInOrder(memberResult, [
      '<p>{result.summary}</p>',
      '<h3>Safer next actions</h3>',
      '.sort((a, b) => a.priority - b.priority)',
      '<strong>This is decision support, not proof.</strong>',
      '<dl className="definition-grid">',
      '<h3>What the check noticed</h3>',
    ]);
    expect(memberResult).toContain('This result can be wrong');

    const historyDetail = section(
      source('apps/web/src/app/member/history/page-client.tsx'),
      '<h2>Redacted result details</h2>',
      '<section className="card" aria-label="Trusted Circle help status">',
    );
    expectInOrder(historyDetail, [
      '<p>{check.summary}</p>',
      '<h3>Safer next actions</h3>',
      '.sort((a, b) => a.priority - b.priority)',
      '<dl className="definition-grid">',
      '<h3>What the check noticed and its limits</h3>',
      'The submitted message or URL is never included in this detail view.',
    ]);
    expect(historyDetail).toContain('This result can be wrong and is not proof or certainty.');
  });

  it('puts ranked actions immediately after the mobile risk summary and keeps result limits', () => {
    const mobileResult = section(
      source('apps/mobile/src/screens.tsx'),
      'function ResultContent',
      'export function HistoryScreen',
    );

    expectInOrder(mobileResult, [
      '<Text style={s.body}>{check.summary}</Text>',
      '<Text style={s.heading}>Safer next actions</Text>',
      '.sort((a, b) => a.priority - b.priority)',
      '<Text style={s.label}>This is decision support, not proof</Text>',
      '<Text style={s.heading}>About this result</Text>',
      '<Text style={s.heading}>What the check noticed</Text>',
    ]);
    expect(mobileResult).toContain('BoomerBuddy can miss warning signs and can be wrong.');
    expect(mobileResult).toContain('You can delete it sooner from');
  });

  it('tells mobile members that a friendly website name is accepted', () => {
    const mobileCheck = section(
      source('apps/mobile/src/screens.tsx'),
      'export function CheckScreen',
      'const riskLabels',
    );

    expect(mobileCheck).toContain("'example.com or paste an address'");
    expect(mobileCheck).toContain(
      'Enter example.com or paste the website address. BoomerBuddy accepts the friendly name.',
    );
    expect(mobileCheck).not.toContain("'https://example.com/path'");
    expect(mobileCheck).toContain('It does not open');
    expect(mobileCheck).toContain('History never displays it.');
  });
});

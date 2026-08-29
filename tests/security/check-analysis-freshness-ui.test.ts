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

describe('member Check analysis freshness UI', () => {
  it('reuses by default and makes a fresh web analysis an explicit action', () => {
    const web = source('apps/web/src/app/member/check/page-client.tsx');
    const ordinarySubmit = section(web, 'async function submit', 'async function runFreshAnalysis');
    const explicitRefresh = section(
      web,
      'async function runFreshAnalysis',
      'if (!isProtectedMember)',
    );

    expect(ordinarySubmit).toContain('body: JSON.stringify(submittedInput)');
    expect(ordinarySubmit).not.toContain('refresh: true');
    expect(explicitRefresh).toContain('refresh: true');
    expect(web).toContain('Run a fresh analysis now');
    expect(web).toContain('matched one of your recent Checks in this household');
    expect(web).toContain("'normalized website address'");
    expect(web).toContain("'message content after private details were minimized'");
    expect(web).toContain('BoomerBuddy does not retry');
    expect(web).toContain('<time dateTime={analysis.analyzedAt}>');
    expect(web).toContain('does not mean website reputation or other online information');
    expect(web).toContain("document.addEventListener('visibilitychange'");
    expect(`${ordinarySubmit}\n${explicitRefresh}`).not.toMatch(
      /localStorage|sessionStorage|console\.|logger\.|logEvent\(/,
    );
  });

  it('keeps the mobile rerun deliberate and out of navigation or durable storage', () => {
    const mobile = source('apps/mobile/src/screens.tsx');
    const mobileSubmit = section(mobile, 'export function CheckScreen', 'const riskLabels');
    const mobileResult = section(mobile, 'function ResultContent', 'export function HistoryScreen');
    const navigation = source('apps/mobile/src/navigation.ts');
    const resultRoute = section(navigation, 'Result:', 'History:');
    const draft = source('apps/mobile/src/check-refresh-draft.ts');

    expect(mobileSubmit).toContain('body: JSON.stringify(submittedInput)');
    expect(mobileSubmit).not.toContain('refresh: true');
    expect(mobileResult).toContain('refresh: true');
    expect(mobileResult).toContain('Run a fresh analysis now');
    expect(mobile).toContain('matched one of your recent Checks in this household');
    expect(mobile).toContain("'normalized website address'");
    expect(mobile).toContain("'message content after private details were minimized'");
    expect(mobileResult).toContain('BoomerBuddy does not retry automatically');
    expect(mobileResult).toContain('new Date(analysis.analyzedAt).toLocaleString()');
    expect(navigation).toContain(
      "Result: { check: CheckResult; analysis?: CreateCheckResponse['analysis'] };",
    );
    expect(resultRoute).not.toContain('content');
    expect(draft).not.toMatch(/AsyncStorage|SecureStore|localStorage|sessionStorage/);
    expect(`${mobileSubmit}\n${mobileResult}\n${draft}`).not.toMatch(
      /console\.|logger\.|logEvent\(/,
    );
    expect(mobileResult).toContain("AppState.addEventListener('change'");
    expect(mobileResult).toContain('useFocusEffect(');
    expect(mobileResult).toContain('check.householdId !== selectedHouseholdId');
    expect(mobileResult).toContain('clearCheckRefreshDraft(check.id)');
  });
});

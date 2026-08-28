import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

function source(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

describe('HQ access-intent receipt UI boundary', () => {
  it('exposes the existing owner-only projection as a read-only HQ route', () => {
    const route = source('apps/hq/src/app/access-intents/page.tsx');
    const screen = source('apps/hq/src/components/hq-screen.tsx');
    const component = source('apps/hq/src/components/access-intent-receipts.tsx');
    const api = source('apps/api/src/routes/access-intents.ts');

    expect(route).toContain('view="access-intents"');
    expect(screen).toContain("| 'access-intents'");
    expect(screen).toContain('href="/access-intents"');
    expect(screen).toContain('<AccessIntentReceipts />');
    expect(component).toContain('hqRequest<HqAccessIntentResponse>(apiPaths.hqAccessIntents)');
    expect(component).not.toContain('method:');
    expect(component).not.toMatch(/<(?:form|input|textarea|button)\b/iu);
    expect(api).toContain("app.get('/v1/hq/access-intents'");
    expect(api).toContain("action: 'hq:overview'");
    expect(api).toContain("projection: 'content_free_access_intents'");
  });

  it('labels aggregates and rows as content-free intent receipts, never leads', () => {
    const component = source('apps/hq/src/components/access-intent-receipts.tsx');

    expect(component).toContain('Intent receipts, not leads');
    expect(component).toContain('does not prove');
    expect(component).toContain('no name, email address, phone');
    expect(component).toContain('free-text message, household, or payment data');
    expect(component).toContain('Attribution totals in this projection');
    expect(component).toContain('Content-free intent receipt list');
    expect(component).toContain('totals above describe only');
    expect(component).not.toMatch(
      /intent\.(?:name|email|phone|message|household|customer|subscription|payment)/u,
    );
  });
});

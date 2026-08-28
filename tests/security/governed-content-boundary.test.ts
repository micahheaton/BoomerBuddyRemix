import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const source = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('governed content security boundary', () => {
  it('protects every HQ draft read and mutation with recent MFA and trusted mutation origin', () => {
    const routes = source('apps/api/src/routes/governed-content.ts');
    expect(routes).toContain('assertRecentHqMfa(auth, context.config)');
    expect(routes).toContain('if (mutation) assertMutationOrigin(request, context.config, auth)');
    expect(routes).toContain('context.config.content?.firstPartyPublishingEnabled !== true');
    expect(routes).not.toContain('fetch(');
    expect(routes).not.toMatch(/twilio|sendgrid|youtube|tiktok|linkedin|heygen|elevenlabs/iu);
  });

  it('keeps daily generation provider-free, content-free in its job payload, and unable to publish', () => {
    const worker = source('apps/worker/src/governed-content.ts');
    expect(worker).toContain('payload: { scheduleDate, batch: 1 }');
    expect(worker).toContain('generateDailyDrafts');
    expect(worker).not.toContain('authorizePublication');
    expect(worker).not.toContain('reconcilePublicationIntent');
    expect(worker).not.toContain('fetch(');
  });

  it('renders public copy as React text and does not accept unpublished content in the web app', () => {
    const article = source('apps/web/src/app/learn/[slug]/page.tsx');
    const loader = source('apps/web/src/lib/public-learn.ts');
    expect(article).toContain('article.body');
    expect(article).toContain(".split('\\n')");
    expect(article).not.toContain('dangerouslySetInnerHTML');
    expect(loader).toContain('`/v1/public/learn/${encodeURIComponent(slug)}`');
    expect(loader).toContain('publicLearnArticleSchema.safeParse');
  });

  it('offers reviewed export variants but no social or messaging provider action', () => {
    const hq = source('apps/hq/src/components/governed-content.tsx');
    expect(hq).toContain('Export-only platform drafts');
    expect(hq).toContain('No account connection or provider action exists');
    expect(hq).not.toMatch(/api\.youtube|api\.tiktok|api\.linkedin|heygen|elevenlabs/iu);
  });
});

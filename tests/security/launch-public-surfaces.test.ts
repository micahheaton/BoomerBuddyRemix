import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function source(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), 'utf8');
}

describe('launch public surfaces', () => {
  it('publishes the single monthly customer offer without hypothetical-plan denials', async () => {
    const pricing = await source('apps/web/src/app/pricing/page.tsx');

    expect(pricing).toContain('USD 14.99 monthly');
    expect(pricing).not.toMatch(/No annual plan|free tier|coupon|referral credit/iu);
    expect(pricing).not.toContain('$149 annually');
    expect(pricing).not.toContain('$8.99 monthly');
  });

  it('links every required support and policy route from the public footer', async () => {
    const shell = await source('apps/web/src/components/public-shell.tsx');

    for (const route of [
      '/support',
      '/privacy',
      '/terms',
      '/billing-terms',
      '/accessibility',
      '/account-deletion',
    ]) {
      expect(shell).toContain(`href="${route}"`);
    }
  });

  it('keeps the support route useful without claiming a staffed or monitored operation', async () => {
    const support = await source('apps/web/src/app/support/page.tsx');

    expect(support).toContain('Email is not an emergency channel.');
    expect(support).toMatch(/Sending a message does not confirm delivery, review, or\s+a reply\./u);
    expect(support).toContain('For an immediate threat, contact local emergency services.');
    expect(support).toContain('do not send passwords, verification codes, payment card');
    expect(support).not.toMatch(/monitored|best[- ]effort|response time|24-hour coverage/iu);
    expect(support).not.toContain('Support can help');
  });

  it('keeps public policy copy free of prohibited dash characters and unsafe support requests', async () => {
    const paths = [
      'apps/web/src/app/support/page.tsx',
      'apps/web/src/app/privacy/page.tsx',
      'apps/web/src/app/terms/page.tsx',
      'apps/web/src/app/billing-terms/page.tsx',
      'apps/web/src/app/accessibility/page.tsx',
      'apps/web/src/app/account-deletion/page.tsx',
    ];
    const policies = (await Promise.all(paths.map(source))).join('\n');

    expect(policies).not.toMatch(/[\u2013\u2014]/u);
    expect(policies).toContain('support@boomerbuddy.net');
    expect(policies).toContain('Do not include passwords');
  });
});

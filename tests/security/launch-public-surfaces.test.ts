import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function source(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), 'utf8');
}

describe('launch public surfaces', () => {
  it('publishes exact annual and monthly Family offers without unsupported offers', async () => {
    const pricing = await source('apps/web/src/app/pricing/page.tsx');

    expect(pricing).toContain('$14.99 USD per month');
    expect(pricing).toContain('7 days free, then $149.90 USD per year');
    expect(pricing).toContain('You save $29.98');
    expect(pricing).not.toMatch(/No annual plan|free tier|coupon|referral credit/iu);
    expect(pricing).not.toContain('$149 annually');
    expect(pricing).not.toContain('$8.99 monthly');
    expect(pricing).not.toMatch(/individual|group rate|referral bonus/iu);
    expect(pricing).toContain('A plan before, during, and after uncertainty');
    expect(pricing).toContain('Creating an account does not start a trial or charge you.');
    expect(pricing).toContain('up to three protected adults');
    expect(pricing).toMatch(/six Trusted\s+Circle participants/u);
    expect(pricing).toContain('Can the person paying see another adult&apos;s Checks?');
    expect(pricing).toContain('No. Each adult joins separately');
  });

  it('explains the implemented recurring Family value and its boundaries', async () => {
    const marketing = (
      await Promise.all([
        source('apps/web/src/app/page.tsx'),
        source('apps/web/src/app/pricing/page.tsx'),
        source('apps/web/src/app/how-it-works/page.tsx'),
      ])
    ).join('\n');

    expect(marketing).toContain('Seven short lessons');
    expect(marketing).toContain('Family Safe Word');
    expect(marketing).toContain('redacted result');
    expect(marketing).toMatch(/weekly (?:in-app )?practice/iu);
    expect(marketing).toContain('acknowledge it in the app');
    expect(marketing).toContain('social aid, not proof of identity');
    expect(marketing).toContain('does not monitor your phone');
    expect(marketing).not.toMatch(/device reminder/iu);
    expect(marketing).not.toContain('You cannot create a new Trusted Circle invitation right now.');
  });

  it('ties public Family claims to current member implementation anchors', async () => {
    const [learning, family, check, history, guidance] = await Promise.all([
      source('apps/web/src/app/member/orientation/member-learning-client.tsx'),
      source('apps/web/src/app/member/family/page-client.tsx'),
      source('apps/web/src/app/member/check/page-client.tsx'),
      source('apps/web/src/app/member/history/page-client.tsx'),
      source('packages/persistence/migrations/0038_run3_1_member_learning_feed.sql'),
    ]);

    expect(learning).toContain('Seven short safety lessons');
    expect(learning).toContain('Show a weekly two-minute rehearsal in this in-app feed');
    expect(learning).toContain('It never sends an email, text message, or push');
    expect(family).toContain('<h2>Family verification aid</h2>');
    expect(family).toContain('redacted result');
    expect(check).toContain('No notification was sent');
    expect(history).toContain('I saw this redacted result');
    expect(guidance).toContain('California DOJ: Court notice scam warning');
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

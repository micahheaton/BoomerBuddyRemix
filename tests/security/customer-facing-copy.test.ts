import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { analyzeCheck } from '@boomerbuddy/fraud';
import { describe, expect, it } from 'vitest';
import { checkDto, decisionFromAssessment } from '../../apps/api/src/mappers';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const excludedProductionSourceDirectories = new Set([
  '.expo',
  '.next',
  'coverage',
  'dist',
  'node_modules',
]);

function source(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

function productionSourceFiles(path: string): string[] {
  const absolute = resolve(repositoryRoot, path);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(absolute, entry.name);
    if (entry.isDirectory()) {
      if (excludedProductionSourceDirectories.has(entry.name)) return [];
      return productionSourceFiles(resolve(path, entry.name));
    }
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [entryPath] : [];
  });
}

describe('customer-facing production copy', () => {
  it('maps content-derived evidence to a customer-safe API label', async () => {
    const assessment = await analyzeCheck(
      {
        kind: 'text',
        content: 'Urgent: buy gift cards immediately and do not tell anyone.',
      },
      { now: new Date('2026-08-25T12:00:00.000Z') },
    );
    const decision = decisionFromAssessment(assessment);
    const contentEvidence = decision.evidence.filter((item) => item.kind === 'artifact');

    expect(contentEvidence.length).toBeGreaterThan(0);
    expect(contentEvidence.map((item) => item.label)).toEqual(
      contentEvidence.map(() => 'Pattern in the submitted content'),
    );
    expect(contentEvidence.map((item) => item.observation)).toEqual(
      expect.arrayContaining([
        'Uses urgent language that can pressure a rushed decision.',
        'Requests a payment method often used in hard-to-reverse scams.',
      ]),
    );
    expect(JSON.stringify(decision.evidence)).not.toContain('Local pattern');

    const legacyCheck: Parameters<typeof checkDto>[0] = {
      id: 'analysis-customer-copy-regression',
      artifactId: 'artifact-customer-copy-regression',
      householdId: 'household-customer-copy-regression',
      ownerPersonId: 'person-customer-copy-regression',
      kind: 'text',
      risk: 'caution',
      evidenceSufficiency: 'limited',
      calibration: 'not_calibrated',
      summary: 'A warning pattern was found.',
      evidence: [
        {
          kind: 'artifact',
          label: 'Local pattern',
          observation: 'Uses urgent language that can pressure a rushed decision.',
          limitations: 'A pattern is a warning signal, not proof of fraud.',
        },
      ],
      actions: [],
      provider: { name: 'local-unknown', state: 'unknown', version: '1' },
      rulesetVersion: 'score-v2',
      createdAt: new Date('2026-08-25T12:00:00.000Z'),
      deleteAfter: new Date('2026-09-24T12:00:00.000Z'),
      state: 'active',
    };
    expect(checkDto(legacyCheck, legacyCheck.ownerPersonId).evidence[0]?.label).toBe(
      'Pattern in the submitted content',
    );
  });

  it('uses customer labels instead of development and internal analysis labels', () => {
    const publicCheck = source('apps/web/src/app/check/page.tsx');
    const memberHome = source('apps/web/src/app/member/page-client.tsx');
    const memberCheck = source('apps/web/src/app/member/check/page-client.tsx');
    const memberHistory = source('apps/web/src/app/member/history/page-client.tsx');
    const mobile = source('apps/mobile/src/screens.tsx');

    expect(publicCheck).toContain('Anonymous result');
    expect(publicCheck).toContain('Open member sign in in a new tab');
    expect(publicCheck).not.toContain('Anonymous local result');
    expect(memberHome).toContain('Current access and plan');
    expect(memberHome).not.toContain('founder-gated');
    expect(memberCheck).toContain('Analysis result');
    expect(memberCheck).not.toContain('Mock analysis');
    expect(memberCheck).not.toContain('Provider provenance');
    expect(memberCheck).not.toContain('<dt>Evidence sufficiency</dt>');
    expect(memberHistory).not.toContain('This local result');
    expect(memberHistory).not.toContain('Provider provenance');
    expect(memberHistory).not.toContain('<dt>Calibration</dt>');
    expect(mobile).toContain('Member sign in');
    expect(mobile).toContain('Current access and plan');
    expect(mobile).toContain('BoomerBuddy is invite-only');
    expect(mobile).not.toContain('Create an account');
    expect(mobile).not.toContain('invited seeded person');

    const signIn = source('apps/web/src/app/sign-in/[[...sign-in]]/page.tsx');
    expect(signIn).toContain('Use your invited member account');
    expect(signIn).not.toContain('the founder invited');
    expect(signIn).not.toContain('Founding Household beta');
  });

  it('keeps new sponsored enrollment out while preserving historical withdrawal', () => {
    const memberHome = source('apps/web/src/app/member/page-client.tsx');
    const sponsoredRoute = source('apps/web/src/app/member/founding-household/page-client.tsx');

    expect(memberHome).toContain(
      "process.env.NODE_ENV !== 'production' && selectedScope?.isAdministrator",
    );
    expect(memberHome).toContain(
      "process.env.NODE_ENV === 'production' && canManageSponsoredAccess",
    );
    expect(memberHome).toContain('Manage sponsored access');
    expect(sponsoredRoute).toContain(
      "const allowEnrollment = process.env.NODE_ENV !== 'production';",
    );
    expect(sponsoredRoute).toContain('Historical access only.');
    expect(sponsoredRoute).toMatch(
      /This page cannot create, preview, or accept a\s+new sponsored enrollment\./u,
    );
    expect(sponsoredRoute).toContain('End sponsored access');
    expect(sponsoredRoute).not.toContain('This page is not available');
  });

  it('production-gates internal laboratories and uses customer-ready copy', () => {
    const memberHome = source('apps/web/src/app/member/page-client.tsx');
    const memberFamily = source('apps/web/src/app/member/family/page-client.tsx');
    const memberCheck = source('apps/web/src/app/member/check/page-client.tsx');
    const orientation = source('apps/web/src/app/member/orientation/page-client.tsx');
    const messaging = source('apps/web/src/app/member/messaging/page-client.tsx');
    const mobile = source('apps/mobile/src/screens.tsx');
    const hqSponsoredAccess = source('apps/hq/src/components/founding-households.tsx');

    expect(memberHome).toContain("process.env.NODE_ENV !== 'production' ? (");
    expect(memberHome).toContain("'/v1/trusted-circle/attention'");
    expect(memberHome).toContain('Trusted Circle attention');
    expect(memberHome).toContain('No shared results are waiting for your acknowledgement.');
    expect(memberHome).toContain('does not send a text, email, or push alert');
    expect(messaging).toContain("const localOnlyEnabled = process.env.NODE_ENV !== 'production';");
    expect(messaging).toContain('Messaging remains unavailable during early access.');
    expect(memberFamily).toContain('Trusted person&apos;s temporary connection code');
    expect(memberFamily).toMatch(
      /Ask the intended person to sign in, open Family, and create this code\. Do not\s+use an email address, account-provider ID, or another person&apos;s code\./u,
    );
    expect(memberFamily).toMatch(
      /I choose to invite this exact person to view only the Check results I deliberately\s+share\./u,
    );
    expect(memberFamily).toContain('BoomerBuddy does not send anything automatically.');
    expect(memberFamily).not.toContain('You cannot invite a new trusted person right now');
    expect(memberFamily).not.toContain('Exact invited Clerk customer subject');
    expect(memberFamily).not.toContain('Run 1 permission');
    expect(memberFamily).not.toContain('client-supplied');
    expect(memberCheck).not.toContain('scaffolded and not implemented');
    expect(orientation).not.toContain('Notifications are unavailable in this build');
    expect(mobile).not.toContain('Future escalation notifications (not implemented)');
    expect(mobile).not.toContain('Future guided orientation help (not implemented)');
    expect(mobile).not.toContain('Rules-only analysis');
    expect(mobile).not.toContain('memory-hard verifier');
    expect(hqSponsoredAccess).toContain('New sponsored enrollment is disabled');
    expect(hqSponsoredAccess).toContain('New invitations are disabled');
    expect(hqSponsoredAccess).not.toContain('Exact Clerk customer subject');
  });

  it('shows plain billing disclosures and fallback help without raw state labels', () => {
    const billing = source('apps/web/src/app/member/billing/page-client.tsx');
    const success = source('apps/web/src/app/member/billing/success/page-client.tsx');

    expect(billing).toContain('Family costs $14.99 USD and renews every');
    expect(billing).toContain('Access ordinarily continues through the paid');
    expect(billing).toContain('Monthly charges are generally not refundable after billing');
    expect(billing).toContain('href="/billing-terms"');
    expect(billing).toContain('href="/support"');
    expect(billing).toContain('View invoices or manage billing');
    expect(billing).toContain('invoice history that Stripe has made available');
    expect(billing).toContain('does not reconstruct unavailable provider records');
    expect(billing).toContain('Review payment in secure billing');
    expect(billing).toContain('additional payment confirmation is required');
    expect(billing).toContain('not claiming that a charge, invoice, or receipt exists');
    expect(billing).not.toContain("checkoutState.replaceAll('_', ' ')");
    expect(success).not.toContain("checkoutState.replaceAll('_', ' ')");
    expect(success).not.toContain('canonical server state');
    expect(success).not.toContain('Payment evidence is still pending');
  });

  it('keeps all web, HQ, and mobile production source free of en and em dashes', () => {
    const files = [
      ...productionSourceFiles('apps/web/src'),
      ...productionSourceFiles('apps/hq/src'),
      ...productionSourceFiles('apps/mobile'),
    ];

    expect(files.map((path) => readFileSync(path, 'utf8')).join('\n')).not.toMatch(
      /[\u2013\u2014]/u,
    );
  });
});

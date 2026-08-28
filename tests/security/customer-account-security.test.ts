import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

function source(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

describe('customer account security route', () => {
  it('provides a protected Clerk profile path for MFA enrollment', () => {
    const route = source(
      'apps/web/src/app/member/account-security/[[...account-security]]/page.tsx',
    );
    const client = source(
      'apps/web/src/app/member/account-security/[[...account-security]]/page-client.tsx',
    );

    expect(route).toContain('protectProductionMemberResource()');
    expect(route).toContain('BB_CUSTOMER_CLERK_SELF_DELETION_DISABLED_CONFIRMED');
    expect(client).toContain('providerAccountSecurityEnabled');
    expect(client).toContain(
      "process.env.NODE_ENV === 'production' && providerAccountSecurityEnabled",
    );
    expect(client).toContain('<UserProfile path="/member/account-security" routing="path">');
    expect(client).toContain('<UserProfile.Page label="security" />');
    expect(client).toContain('Google or email sign-in and a trusted device do not count');
    expect(client).toContain('href="/support"');
    expect(client).toContain('never asks you to send a password, backup code, authenticator code');
    expect(client).toContain(
      "deletion cannot bypass BoomerBuddy's protected account-deletion workflow",
    );
    expect(client).not.toContain('mailto:');
  });

  it('links billing and member navigation to the account-security route', () => {
    const billing = source('apps/web/src/app/member/billing/page-client.tsx');
    const memberShell = source('apps/web/src/components/member-shell.tsx');

    expect(billing).toContain('href="/member/account-security"');
    expect(billing).not.toMatch(/href="\/sign-in">secure sign-in/iu);
    expect(memberShell).toContain('href="/member/account-security"');
  });
});

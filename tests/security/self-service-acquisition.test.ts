import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

function source(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

describe('self-service web-beta acquisition boundary', () => {
  it('states the exact annual trial, monthly alternative, and substantive product loop', () => {
    const home = source('apps/web/src/app/page.tsx');
    const pricing = source('apps/web/src/app/pricing/page.tsx');
    const combined = `${home}\n${pricing}`;

    expect(home).toMatch(
      /practice, check, and\s+respond safely to suspicious messages together\./u,
    );
    expect(combined).toContain('7 days free, then USD 149.90/year');
    expect(pricing).toContain('7 days free, then $149.90 USD per year');
    expect(combined).toContain('USD 14.99/month without a trial');
    expect(pricing).toContain('You save $29.98');
    expect(combined).toContain('seven short lessons');
    expect(combined).toContain('Trusted Circle');
    expect(combined).toContain('Family Safe Word');
    expect(combined).toContain('does not monitor your phone');
    expect(combined).toContain('iPhone and Android');
    expect(combined).not.toContain('Family access requests are paused');
    expect(combined).not.toContain('I have an invitation');
  });

  it('uses a dedicated Clerk sign-up route with fixed internal destinations', () => {
    const signUp = source('apps/web/src/app/sign-up/[[...sign-up]]/page.tsx');
    const signIn = source('apps/web/src/app/sign-in/[[...sign-in]]/page.tsx');
    const provider = source('apps/web/src/components/identity-provider.tsx');
    const policy = source('apps/web/src/lib/resource-auth-policy.ts');

    expect(signUp).toMatch(/import \{[^}]*\bSignUp\b[^}]*\} from '@clerk\/nextjs';/u);
    expect(signUp).toContain('path="/sign-up"');
    expect(signUp).toContain('forceRedirectUrl="/member"');
    expect(signUp).toContain('signInForceRedirectUrl="/member"');
    expect(signUp).not.toContain('redirect_url');
    expect(signIn).toContain('signUpUrl="/sign-up"');
    expect(signIn).toContain('withSignUp');
    expect(signIn).not.toContain('withSignUp={false}');
    expect(signIn).toContain('signUpForceRedirectUrl="/member"');
    expect(provider).toContain('signUpUrl="/sign-up"');
    expect(provider).toContain('signUpFallbackRedirectUrl="/member"');
    expect(policy).toContain("isPathSegment(pathname, '/sign-up')");
  });

  it('routes a new account to a no-charge product preview before billing', () => {
    const signUp = source('apps/web/src/app/sign-up/[[...sign-up]]/page.tsx');
    const signIn = source('apps/web/src/app/sign-in/[[...sign-in]]/page.tsx');
    const memberHome = source('apps/web/src/app/member/page-client.tsx');

    expect(signUp).toContain('forceRedirectUrl="/member"');
    expect(signIn).toContain('signUpForceRedirectUrl="/member"');
    expect(memberHome).toContain('Free account preview');
    expect(memberHome).toContain('Preview the lessons');
    expect(memberHome).toContain('This does not start');
    expect(memberHome).toContain('explicitly reviews and completes secure Checkout');
    expect(source('apps/web/src/app/learn/page.tsx')).not.toContain(
      'Create a free account for the full lessons',
    );
  });

  it('keeps Clerk loading and failure states visible on both customer identity routes', () => {
    const signUp = source('apps/web/src/app/sign-up/[[...sign-up]]/page.tsx');
    const signIn = source('apps/web/src/app/sign-in/[[...sign-in]]/page.tsx');

    for (const route of [signIn, signUp]) {
      expect(route).toContain('ClerkLoading');
      expect(route).toContain('ClerkLoaded');
      expect(route).toContain('ClerkFailed');
      expect(route).toContain('role="status"');
      expect(route).toContain('role="alert"');
      expect(route).toContain('fallback={');
    }
    expect(signIn).toContain('Loading secure sign-in...');
    expect(signIn).toContain('The secure sign-in form could not load.');
    expect(signUp).toContain('Loading secure account creation...');
    expect(signUp).toContain('The secure account-creation form could not load.');
  });

  it('does not pretend account creation starts billing or that external channels are ready', () => {
    const home = source('apps/web/src/app/page.tsx');
    const pricing = source('apps/web/src/app/pricing/page.tsx');
    const signUp = source('apps/web/src/app/sign-up/[[...sign-up]]/page.tsx');
    const combined = `${home}\n${pricing}\n${signUp}`;

    expect(combined).toContain('does not start a trial or charge you');
    expect(combined).toContain('no payment is attempted and no trial begins');
    expect(combined).not.toMatch(/app store|google play|download now/iu);
    expect(combined).not.toMatch(/losses? prevented|guaranteed protection|never get scammed/iu);
    expect(combined).not.toMatch(/referral bonus|facebook login|tiktok integration/iu);
  });
});

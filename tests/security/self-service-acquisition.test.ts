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

    expect(home).toContain('Practice, check, and respond safely to suspicious messages together.');
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

    expect(signUp).toContain("import { SignUp } from '@clerk/nextjs'");
    expect(signUp).toContain('path="/sign-up"');
    expect(signUp).toContain('forceRedirectUrl="/member/billing"');
    expect(signUp).toContain('signInForceRedirectUrl="/member"');
    expect(signUp).not.toContain('redirect_url');
    expect(signIn).toContain('signUpUrl="/sign-up"');
    expect(signIn).toContain('signUpForceRedirectUrl="/member/billing"');
    expect(provider).toContain('signUpUrl="/sign-up"');
    expect(provider).toContain('signUpFallbackRedirectUrl="/member/billing"');
    expect(policy).toContain("isPathSegment(pathname, '/sign-up')");
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

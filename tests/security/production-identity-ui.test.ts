import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function source(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), 'utf8');
}

describe('production identity UI boundary', () => {
  it('pins Clerk independently in customer and HQ and never exposes the secret key as public', async () => {
    const [webPackage, hqPackage, lock, webProvider, hqProvider, webConfig, hqConfig] =
      await Promise.all([
        source('apps/web/package.json'),
        source('apps/hq/package.json'),
        source('package-lock.json'),
        source('apps/web/src/components/identity-provider.tsx'),
        source('apps/hq/src/components/identity-provider.tsx'),
        source('apps/web/next.config.ts'),
        source('apps/hq/next.config.ts'),
      ]);

    expect(JSON.parse(webPackage).dependencies['@clerk/nextjs']).toBe('7.7.7');
    expect(JSON.parse(hqPackage).dependencies['@clerk/nextjs']).toBe('7.7.7');
    expect(lock).toContain('node_modules/@clerk/nextjs');
    expect(`${webProvider}\n${hqProvider}`).toContain('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY');
    expect(`${webProvider}\n${hqProvider}`).not.toContain('NEXT_PUBLIC_CLERK_SECRET_KEY');
    for (const configuration of [webConfig, hqConfig]) {
      expect(configuration).toContain('process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY');
      expect(configuration).toContain('process.env.CLERK_PUBLISHABLE_KEY');
      expect(configuration).not.toContain('CLERK_SECRET_KEY');
    }
  });

  it('keeps development personas out of the production sign-in branch', async () => {
    const customerSignIn = await source('apps/web/src/app/sign-in/[[...sign-in]]/page.tsx');
    const hqSignInRoute = await source('apps/hq/src/app/sign-in/[[...sign-in]]/page.tsx');
    const hqScreen = await source('apps/hq/src/components/hq-screen.tsx');
    const hqSignIn = await source('apps/hq/src/components/production-identity.tsx');

    expect(customerSignIn).toContain("process.env.NODE_ENV === 'production'");
    expect(customerSignIn).toContain('<ProductionSignIn />');
    expect(customerSignIn).toContain('path="/sign-in"');
    expect(customerSignIn).toContain('routing="path"');
    expect(customerSignIn).toContain('withSignUp={false}');
    expect(customerSignIn).toContain('/v1/dev/sessions/customer');
    expect(hqSignInRoute).toContain('<ProductionHqSignIn />');
    expect(hqScreen).toContain("process.env.NODE_ENV !== 'production'");
    expect(hqScreen).toContain('<DevelopmentSignIn onSuccess={setMe} />');
    expect(hqSignIn).toContain('withSignUp={false}');
    expect(hqSignIn).toContain('required recent multi-factor verification');
  });

  it('revokes the exact local session and Clerk upstream session on production sign-out', async () => {
    const [memberSignOut, hqSignOut] = await Promise.all([
      source('apps/web/src/components/production-sign-out.tsx'),
      source('apps/hq/src/components/production-identity.tsx'),
    ]);

    for (const implementation of [memberSignOut, hqSignOut]) {
      expect(implementation).toContain("method: 'DELETE'");
      expect(implementation).toContain('clerk.signOut');
      expect(implementation).toContain("redirectUrl: '/sign-in'");
    }
  });

  it('fails closed without Clerk and protects production member and HQ routes', async () => {
    const [webProxy, hqProxy, webProvider, hqProvider] = await Promise.all([
      source('apps/web/src/proxy.ts'),
      source('apps/hq/src/proxy.ts'),
      source('apps/web/src/components/identity-provider.tsx'),
      source('apps/hq/src/components/identity-provider.tsx'),
    ]);

    for (const proxy of [webProxy, hqProxy]) {
      expect(proxy).toContain('clerkMiddleware(');
      expect(proxy).toContain("process.env.NODE_ENV !== 'production'");
      expect(proxy).toContain('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY');
      expect(proxy).toContain('CLERK_SECRET_KEY');
      expect(proxy).toContain('BB_PUBLIC_ORIGIN');
      expect(proxy).toContain('NEXT_PUBLIC_CLERK_SIGN_IN_URL');
      expect(proxy).toContain(
        'authorizedParties: configuredPublicOrigin === undefined ? [] : [configuredPublicOrigin]',
      );
      expect(proxy).toContain('!configuredPublicOrigin');
      expect(proxy).toContain('configuredClerkSignInUrl !== productionClerkSignInUrl');
      expect(proxy).toContain('return NextResponse.next()');
      expect(proxy).toContain('status: 503');
      expect(proxy).toContain("'cache-control': 'no-store'");
      expect(proxy).toContain('auth.protect');
    }
    for (const provider of [webProvider, hqProvider]) {
      expect(provider).toContain('Production identity is unavailable.');
      expect(provider).toContain('!publishableKey || !publicOrigin');
      expect(provider).not.toContain("process.env.NODE_ENV !== 'production' || !publishableKey");
    }
    for (const route of [
      "'/accessibility'",
      "'/account-deletion'",
      "'/billing-terms'",
      "'/check(.*)'",
      "'/how-it-works'",
      "'/pricing'",
      "'/privacy'",
      "'/support'",
      "'/terms'",
      "'/trust'",
      "'/api(.*)'",
    ]) {
      expect(webProxy).toContain(route);
    }
    expect(webProxy).not.toContain("'/member(.*)'");
    expect(webProxy).toContain('if (!isPublicRoute(request)) await auth.protect()');
  });

  it('denies framing and content-type sniffing on customer and HQ responses', async () => {
    const configurations = await Promise.all([
      source('apps/web/next.config.ts'),
      source('apps/hq/next.config.ts'),
    ]);

    for (const configuration of configurations) {
      expect(configuration).toContain("frame-ancestors 'none'");
      expect(configuration).toContain("key: 'X-Frame-Options', value: 'DENY'");
      expect(configuration).toContain("key: 'X-Content-Type-Options', value: 'nosniff'");
      expect(configuration).toContain('strict-origin-when-cross-origin');
    }
  });

  it('classifies the default production artifact gate as missing-identity evidence only', async () => {
    const verifier = await source('scripts/verify-founding-household-production-ui.mjs');

    expect(verifier).toContain("?? 'unconfigured_identity'");
    expect(verifier).toContain("['unconfigured_identity', 'configured_static']");
    expect(verifier).toContain('generated.generatedBody.includes(identityUnavailableText)');
    expect(verifier).toContain('configured and hydrated production-browser proof remains unproved');
  });
});

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  classifyCustomerResourcePath,
  isPublicCustomerResourcePath,
} from '../../apps/web/src/lib/resource-auth-policy';
import {
  classifyHqResourcePath,
  isPublicHqResourcePath,
} from '../../apps/hq/src/lib/resource-auth-policy';
import { enforceProductionResourceAuthentication } from '../../packages/security/src/resource-auth';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function filesBelow(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? filesBelow(path) : [path];
    }),
  );
  return files.flat();
}

async function filesDirectlyBelow(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(root, entry.name));
}

function repositoryPath(path: string): string {
  return relative(repositoryRoot, path).replaceAll('\\', '/');
}

async function source(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), 'utf8');
}

const appRouterCodeConvention =
  /\/(?:apple-icon|default|error|forbidden|global-error|global-not-found|icon|layout|loading|manifest|not-found|opengraph-image|page|robots|route|sitemap|template|twitter-image|unauthorized)\.(?:js|jsx|ts|tsx)$/u;
const appRouterStaticMetadataConvention =
  /\/(?:apple-icon\.(?:jpg|jpeg|png)|favicon\.ico|icon\.(?:ico|jpg|jpeg|png|svg)|manifest\.(?:json|webmanifest)|opengraph-image\.(?:gif|jpg|jpeg|png)|robots\.txt|sitemap\.xml|twitter-image\.(?:gif|jpg|jpeg|png))$/u;
const rootNextConvention =
  /^apps\/(?:hq|web)\/(?:src\/)?(?:instrumentation|instrumentation-client|middleware|proxy)\.(?:js|ts)$/u;

function isRelevantAppRouterConvention(path: string): boolean {
  return appRouterCodeConvention.test(path) || appRouterStaticMetadataConvention.test(path);
}

const customerPublicPages = [
  'apps/web/src/app/accessibility/page.tsx',
  'apps/web/src/app/account-deletion/page.tsx',
  'apps/web/src/app/billing-terms/page.tsx',
  'apps/web/src/app/check/page.tsx',
  'apps/web/src/app/error.tsx',
  'apps/web/src/app/feedback/page.tsx',
  'apps/web/src/app/global-error.tsx',
  'apps/web/src/app/how-it-works/page.tsx',
  'apps/web/src/app/not-found.tsx',
  'apps/web/src/app/page.tsx',
  'apps/web/src/app/pricing/page.tsx',
  'apps/web/src/app/privacy/page.tsx',
  'apps/web/src/app/sign-in/[[...sign-in]]/page.tsx',
  'apps/web/src/app/sign-in/client-trust/page.tsx',
  'apps/web/src/app/support/page.tsx',
  'apps/web/src/app/terms/page.tsx',
  'apps/web/src/app/trust/page.tsx',
] as const;

const customerGuardedPages = [
  'apps/web/src/app/member/account-security/[[...account-security]]/page.tsx',
  'apps/web/src/app/member/billing/page.tsx',
  'apps/web/src/app/member/billing/success/page.tsx',
  'apps/web/src/app/member/check/page.tsx',
  'apps/web/src/app/member/family/page.tsx',
  'apps/web/src/app/member/family/safe-word/page.tsx',
  'apps/web/src/app/member/feedback/page.tsx',
  'apps/web/src/app/member/founding-household/page.tsx',
  'apps/web/src/app/member/history/page.tsx',
  'apps/web/src/app/member/messaging/page.tsx',
  'apps/web/src/app/member/orientation/page.tsx',
  'apps/web/src/app/member/page.tsx',
  'apps/web/src/app/member/protection/page.tsx',
  'apps/web/src/app/member/support/page.tsx',
] as const;

// Loading, error, template, default, and boundary conventions below /member are not
// independently addressable. Record them here when introduced; the guarded member layout
// is their resource boundary, so tests must not demand an impossible client-side auth call.
const customerMemberLayoutInheritedResources: readonly string[] = [];

const hqGuardedPages = [
  'apps/hq/src/app/access-intents/page.tsx',
  'apps/hq/src/app/attention/page.tsx',
  'apps/hq/src/app/autonomy/page.tsx',
  'apps/hq/src/app/billing-authority/page.tsx',
  'apps/hq/src/app/customers/page.tsx',
  'apps/hq/src/app/editorial/page.tsx',
  'apps/hq/src/app/feedback/page.tsx',
  'apps/hq/src/app/founding-households/page.tsx',
  'apps/hq/src/app/fraud/page.tsx',
  'apps/hq/src/app/messaging/page.tsx',
  'apps/hq/src/app/page.tsx',
  'apps/hq/src/app/pipeline/page.tsx',
  'apps/hq/src/app/privacy/page.tsx',
  'apps/hq/src/app/provisioning/page.tsx',
  'apps/hq/src/app/referrals/page.tsx',
  'apps/hq/src/app/revenue/page.tsx',
  'apps/hq/src/app/stripe-control/page.tsx',
  'apps/hq/src/app/support/page.tsx',
  'apps/hq/src/app/support-receipts/page.tsx',
  'apps/hq/src/app/system/page.tsx',
  'apps/hq/src/app/targets/page.tsx',
] as const;

describe('Next resource-local authentication inventory', () => {
  it('inventories every relevant customer App Router convention for explicit review', async () => {
    const appRoot = resolve(repositoryRoot, 'apps/web/src/app');
    const resources = (await filesBelow(appRoot))
      .map(repositoryPath)
      .filter(isRelevantAppRouterConvention)
      .sort();

    expect(resources).toEqual(
      [
        ...customerPublicPages,
        ...customerGuardedPages,
        ...customerMemberLayoutInheritedResources,
        'apps/web/src/app/api/[...path]/route.ts',
        'apps/web/src/app/check/layout.tsx',
        'apps/web/src/app/layout.tsx',
        'apps/web/src/app/member/layout.tsx',
        'apps/web/src/app/research/layout.tsx',
        'apps/web/src/app/research/offer-pair-v1/page.tsx',
        'apps/web/src/app/research/offer-pair-v2/page.tsx',
        'apps/web/src/app/robots.ts',
        'apps/web/src/app/sign-in/layout.tsx',
        'apps/web/src/app/sitemap.ts',
      ].sort(),
    );
  });

  it('guards directly addressable customer member resources and their inherited layout', async () => {
    const resources = await Promise.all(
      [...customerGuardedPages, 'apps/web/src/app/member/layout.tsx'].map(source),
    );
    for (const resource of resources) {
      expect(resource).toContain('protectProductionMemberResource');
      expect(resource).toContain('await protectProductionMemberResource()');
    }
    for (const path of customerMemberLayoutInheritedResources) {
      expect(path).toMatch(/^apps\/web\/src\/app\/member\//u);
      expect(path).not.toMatch(/\/(?:layout|page|route)\.(?:js|jsx|ts|tsx)$/u);
    }
  });

  it('classifies the customer API catch-all as a mixed delegated boundary', async () => {
    const handler = await source('apps/web/src/app/api/[...path]/route.ts');
    expect(classifyCustomerResourcePath('/api/v1/public/config')).toBe('delegated-to-api');
    expect(classifyCustomerResourcePath('/api/v1/me')).toBe('delegated-to-api');
    expect(handler).toContain('mixed public and protected transport');
    expect(handler).toContain('Fastify remains the');
    expect(handler).not.toContain('protectProductionMemberResource');
  });

  it('uses segment-bounded customer public matching and leaves metadata anonymous', () => {
    expect(isPublicCustomerResourcePath('/check')).toBe(true);
    expect(isPublicCustomerResourcePath('/checkmate')).toBe(false);
    expect(isPublicCustomerResourcePath('/check/extra')).toBe(false);
    expect(isPublicCustomerResourcePath('/sign-in')).toBe(true);
    expect(isPublicCustomerResourcePath('/sign-in/client-trust')).toBe(true);
    expect(isPublicCustomerResourcePath('/sign-in-danger')).toBe(false);
    expect(isPublicCustomerResourcePath('/api/v1/me')).toBe(true);
    expect(isPublicCustomerResourcePath('/apiary')).toBe(false);
    expect(classifyCustomerResourcePath('/member/history')).toBe('guarded');
    expect(classifyCustomerResourcePath('/membership')).toBe('unclassified');
    expect(classifyCustomerResourcePath('/research/offer-pair-v2')).toBe('unclassified');
    expect(classifyCustomerResourcePath('/robots.txt')).toBe('public');
    expect(classifyCustomerResourcePath('/sitemap.xml')).toBe('public');
  });

  it('inventories every relevant HQ App Router convention for explicit review', async () => {
    const appRoot = resolve(repositoryRoot, 'apps/hq/src/app');
    const resources = (await filesBelow(appRoot))
      .map(repositoryPath)
      .filter(isRelevantAppRouterConvention)
      .sort();

    expect(resources).toEqual(
      [
        ...hqGuardedPages,
        'apps/hq/src/app/api/[...path]/route.ts',
        'apps/hq/src/app/layout.tsx',
        'apps/hq/src/app/robots.ts',
        'apps/hq/src/app/sign-in/[[...sign-in]]/page.tsx',
      ].sort(),
    );
  });

  it('guards each directly addressable HQ page and the mixed API handler', async () => {
    const resources = await Promise.all(
      [...hqGuardedPages, 'apps/hq/src/app/api/[...path]/route.ts'].map(source),
    );
    for (const resource of resources) {
      expect(resource).toContain('protectProductionHqResource');
      expect(resource).toContain('await protectProductionHqResource()');
    }
  });

  it('inventories application-level Next entry conventions', async () => {
    const resources = (
      await Promise.all(
        ['apps/web', 'apps/hq'].flatMap((path) => [
          filesDirectlyBelow(resolve(repositoryRoot, path)),
          filesBelow(resolve(repositoryRoot, path, 'src')),
        ]),
      )
    )
      .flat()
      .map(repositoryPath)
      .filter((path) => rootNextConvention.test(path))
      .sort();

    expect(resources).toEqual(['apps/hq/src/proxy.ts', 'apps/web/src/proxy.ts']);
  });

  it('uses segment-bounded HQ public matching and leaves robots anonymous', () => {
    expect(isPublicHqResourcePath('/sign-in')).toBe(true);
    expect(isPublicHqResourcePath('/sign-in/factor-one')).toBe(true);
    expect(isPublicHqResourcePath('/sign-in-danger')).toBe(false);
    expect(classifyHqResourcePath('/robots.txt')).toBe('public');
    expect(classifyHqResourcePath('/sitemap.xml')).toBe('guarded');
    expect(classifyHqResourcePath('/api/v1/me')).toBe('guarded-and-delegated');
    expect(classifyHqResourcePath('/customers')).toBe('guarded');
  });

  it('has no unclassified Server Functions in either Next application', async () => {
    const roots = [resolve(repositoryRoot, 'apps/web/src'), resolve(repositoryRoot, 'apps/hq/src')];
    const sources = await Promise.all(
      (await Promise.all(roots.map(filesBelow)))
        .flat()
        .filter((path) => /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/u.test(path))
        .map((path) => readFile(path, 'utf8')),
    );
    expect(sources.filter((contents) => /['"]use server['"]/u.test(contents))).toEqual([]);
  });

  it('runs, awaits, and propagates production resource protection through the pure helper', async () => {
    let releaseProtection: (() => void) | undefined;
    const pendingProtection = new Promise<void>((resolveProtection) => {
      releaseProtection = resolveProtection;
    });
    const protect = vi.fn(() => pendingProtection);
    let settled = false;
    const enforced = enforceProductionResourceAuthentication('production', protect).then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(protect).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    releaseProtection?.();
    await enforced;
    expect(settled).toBe(true);

    const skipped = vi.fn();
    await enforceProductionResourceAuthentication('development', skipped);
    await enforceProductionResourceAuthentication('test', skipped);
    await enforceProductionResourceAuthentication(undefined, skipped);
    expect(skipped).not.toHaveBeenCalled();

    const rejection = new Error('resource protection failed');
    await expect(
      enforceProductionResourceAuthentication('production', () => Promise.reject(rejection)),
    ).rejects.toBe(rejection);
  });

  it('keeps actual wrapper delegation and compiled matcher proof in the release gates', async () => {
    const [customerGuard, hqGuard, verifier, packageManifest] = await Promise.all([
      source('apps/web/src/lib/resource-auth.ts'),
      source('apps/hq/src/lib/resource-auth.ts'),
      source('scripts/verify-next-resource-auth.mjs'),
      source('package.json'),
    ]);
    for (const guard of [customerGuard, hqGuard]) {
      expect(guard).toContain('enforceProductionResourceAuthentication(process.env.NODE_ENV');
      expect(guard).toContain("auth.protect({ unauthenticatedUrl: '/sign-in' })");
      expect(guard).not.toContain("process.env.NODE_ENV !== 'production'");
    }
    expect(verifier).toContain('encoded sibling');
    expect(verifier).toContain('missing identity configuration did not fail closed at 503');
    expect(verifier).toContain('wrong canonical origin was not rejected at 421');
    expect(packageManifest).toContain('npm run verify:next-resource-auth');
  });
});

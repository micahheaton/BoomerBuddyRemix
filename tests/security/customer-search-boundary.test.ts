import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { indexedCustomerPageMetadata } from '../../apps/web/src/lib/public-page-metadata';
import {
  customerCrawlerPolicy,
  customerPublicOrigin,
  indexedCustomerRoutes,
  indexedCustomerSitemapEntries,
  noindexCustomerRoutePrefixes,
  nonPageCustomerCrawlBlocks,
  type IndexedCustomerRoutePath,
} from '../../apps/web/src/lib/public-search-routes';
import { hqCrawlerPolicy, hqNonPageCrawlBlocks } from '../../apps/hq/src/lib/search-policy';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const customerAppRoot = resolve(repositoryRoot, 'apps/web/src/app');

function source(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

function pageFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return pageFiles(path);
    return entry.name === 'page.tsx' ? [path] : [];
  });
}

function routeForPage(path: string): string {
  const routePath = relative(customerAppRoot, path).split(sep).slice(0, -1).join('/');
  return routePath === '' ? '/' : `/${routePath}`;
}

function routeBelongsToFamily(route: string, prefix: string): boolean {
  return route === prefix || route.startsWith(`${prefix}/`);
}

function crawlerBlocks(path: string, disallow: string | readonly string[] | undefined): boolean {
  const rules: readonly string[] =
    disallow === undefined ? [] : typeof disallow === 'string' ? [disallow] : disallow;
  return rules.some((rule) => path.startsWith(rule));
}

const metadataSourceByRoute: Readonly<Record<IndexedCustomerRoutePath, string>> = {
  '/': 'apps/web/src/app/page.tsx',
  '/check': 'apps/web/src/app/check/layout.tsx',
  '/how-it-works': 'apps/web/src/app/how-it-works/page.tsx',
  '/pricing': 'apps/web/src/app/pricing/page.tsx',
  '/trust': 'apps/web/src/app/trust/page.tsx',
  '/support': 'apps/web/src/app/support/page.tsx',
  '/privacy': 'apps/web/src/app/privacy/page.tsx',
  '/terms': 'apps/web/src/app/terms/page.tsx',
  '/billing-terms': 'apps/web/src/app/billing-terms/page.tsx',
  '/accessibility': 'apps/web/src/app/accessibility/page.tsx',
  '/account-deletion': 'apps/web/src/app/account-deletion/page.tsx',
};

describe('customer search indexing boundary', () => {
  it('publishes an exact sitemap allowlist and excludes every private route family', () => {
    const expectedUrls = indexedCustomerRoutes.map(
      (route) => `${customerPublicOrigin}${route.path === '/' ? '' : route.path}`,
    );

    expect(indexedCustomerSitemapEntries.map((entry) => entry.url)).toEqual(expectedUrls);
    expect(new Set(expectedUrls).size).toBe(expectedUrls.length);
    for (const entry of indexedCustomerSitemapEntries) {
      const path = new URL(entry.url).pathname;
      expect(
        noindexCustomerRoutePrefixes.some((prefix) => routeBelongsToFamily(path, prefix)),
      ).toBe(false);
    }
  });

  it('accounts for every customer page as indexed public or explicitly private', () => {
    const indexedPaths: IndexedCustomerRoutePath[] = indexedCustomerRoutes.map(
      (route) => route.path,
    );
    const routes = pageFiles(customerAppRoot).map(routeForPage).sort();
    const unclassified = routes.filter(
      (route) =>
        !indexedPaths.some((indexedPath) => indexedPath === route) &&
        !noindexCustomerRoutePrefixes.some((prefix) => routeBelongsToFamily(route, prefix)),
    );

    expect(unclassified).toEqual([]);
    for (const route of indexedPaths) expect(routes).toContain(route);
  });

  it('lets crawlers observe noindex on private pages while blocking only non-page API routes', () => {
    const customerRules = customerCrawlerPolicy.rules;
    expect(customerRules.disallow).toEqual(nonPageCustomerCrawlBlocks);
    expect(customerCrawlerPolicy.sitemap).toBe(`${customerPublicOrigin}/sitemap.xml`);
    for (const path of [
      '/feedback',
      '/member',
      '/member/history',
      '/research/offer-pair-v2',
      '/sign-in',
      '/unauthorized-sign-in',
    ]) {
      expect(crawlerBlocks(path, customerRules.disallow), path).toBe(false);
    }
    expect(crawlerBlocks('/api/v1/me', customerRules.disallow)).toBe(true);

    const hqRules = hqCrawlerPolicy.rules;
    expect(hqRules.disallow).toEqual(hqNonPageCrawlBlocks);
    expect(crawlerBlocks('/access-intents', hqRules.disallow)).toBe(false);
    expect(crawlerBlocks('/api/v1/hq/access-intents', hqRules.disallow)).toBe(true);

    for (const path of [
      'apps/web/src/app/member/layout.tsx',
      'apps/web/src/app/sign-in/layout.tsx',
      'apps/web/src/app/research/layout.tsx',
      'apps/web/src/app/feedback/page.tsx',
      'apps/hq/src/app/layout.tsx',
    ]) {
      const metadataSource = source(path);
      expect(metadataSource).toContain('robots: {');
      expect(metadataSource).toContain('index: false');
      expect(metadataSource).toContain('follow: false');
      expect(metadataSource).toContain('nocache: true');
    }
  });

  it('wires the pure search policies into the Next route adapters', () => {
    const customerRobotsSource = source('apps/web/src/app/robots.ts');
    expect(customerRobotsSource).toContain(
      "import { customerCrawlerPolicy } from '../lib/public-search-routes';",
    );
    expect(customerRobotsSource).toContain('disallow: [...customerCrawlerPolicy.rules.disallow]');
    expect(customerRobotsSource).not.toContain("'/api/'");

    const customerSitemapSource = source('apps/web/src/app/sitemap.ts');
    expect(customerSitemapSource).toContain(
      "import { indexedCustomerSitemapEntries } from '../lib/public-search-routes';",
    );
    expect(customerSitemapSource).toContain('indexedCustomerSitemapEntries.map');
    expect(customerSitemapSource).not.toContain('customerPublicOrigin');

    const hqRobotsSource = source('apps/hq/src/app/robots.ts');
    expect(hqRobotsSource).toContain("import { hqCrawlerPolicy } from '../lib/search-policy';");
    expect(hqRobotsSource).toContain('disallow: [...hqCrawlerPolicy.rules.disallow]');
    expect(hqRobotsSource).not.toContain("'/api/'");
  });

  it('gives every indexed route unique, accurate, and explicitly wired metadata', () => {
    const expectedPaths: IndexedCustomerRoutePath[] = indexedCustomerRoutes
      .map((route) => route.path)
      .sort();
    const metadataPaths = Object.keys(indexedCustomerPageMetadata).sort();
    expect(metadataPaths).toEqual(expectedPaths);

    const titles = expectedPaths.map((path) => indexedCustomerPageMetadata[path].title);
    const descriptions = expectedPaths.map((path) => indexedCustomerPageMetadata[path].description);
    expect(new Set(titles).size).toBe(expectedPaths.length);
    expect(new Set(descriptions).size).toBe(expectedPaths.length);

    for (const path of expectedPaths) {
      const metadata = indexedCustomerPageMetadata[path];
      expect(metadata.title.length, path).toBeGreaterThan(10);
      expect(metadata.description.length, path).toBeGreaterThan(40);
      expect(metadata.alternates.canonical, path).toBe(path);
      expect(source(metadataSourceByRoute[path]), path).toContain(
        `export const metadata = indexedCustomerPageMetadata['${path}'];`,
      );
    }
  });
});

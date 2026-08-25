import { readdir, readFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import {
  referralRevenueHypothesisRegistry,
  revenueOfferHypothesisRegistry,
} from '../../packages/domain/src/revenue-hypotheses';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const isolatedRegistryPath = 'packages/domain/src/revenue-hypotheses.ts';
const productionSourceRoots = [
  'apps/api/src',
  'apps/hq/src',
  'apps/mobile/src',
  'apps/web/src',
  'apps/worker/src',
  'packages',
] as const;

async function source(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), 'utf8');
}

function repositoryPath(path: string): string {
  return relative(repositoryRoot, path).replaceAll('\\', '/');
}

async function productionSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (['.next', 'dist', 'node_modules'].includes(entry.name)) return [];
        return productionSourceFiles(path);
      }
      const relativePath = repositoryPath(path);
      const extension = extname(path);
      if (!['.ts', '.tsx'].includes(extension)) return [];
      if (/\.(?:spec|test)\.tsx?$/u.test(relativePath)) return [];
      if (relativePath === isolatedRegistryPath) return [];
      return [path];
    }),
  );
  return files.flat();
}

async function productionSourceGraph(): Promise<string> {
  const paths = (
    await Promise.all(
      productionSourceRoots.map((root) => productionSourceFiles(resolve(repositoryRoot, root))),
    )
  )
    .flat()
    .sort((left, right) => left.localeCompare(right));
  const contents = await Promise.all(
    paths.map(async (path) => `// ${repositoryPath(path)}\n${await readFile(path, 'utf8')}`),
  );
  return contents.join('\n');
}

describe('revenue hypothesis production boundary', () => {
  it('keeps every hypothesis key, scope, and registry outside the production package graph', async () => {
    const [domainBarrel, domainManifest, productionSources] = await Promise.all([
      source('packages/domain/src/index.ts'),
      source('packages/domain/package.json'),
      productionSourceGraph(),
    ]);
    const packageExports = (
      JSON.parse(domainManifest) as { readonly exports: Readonly<Record<string, string>> }
    ).exports;

    expect(domainBarrel).not.toContain('revenue-hypotheses');
    expect(packageExports['.']).toBe('./src/index.ts');
    expect(Object.values(packageExports).join('\n')).not.toContain('revenue-hypotheses');
    expect(productionSources).not.toMatch(
      /(?:from\s+|import\s*\()\s*['"][^'"]*revenue-hypotheses/u,
    );
    expect(productionSources).not.toContain('revenueOfferHypothesisRegistry');
    expect(productionSources).not.toContain('referralRevenueHypothesisRegistry');
    expect(productionSources).not.toContain('stripe_sandbox');
    for (const hypothesis of revenueOfferHypothesisRegistry) {
      expect(productionSources).not.toContain(hypothesis.hypothesisKey);
      expect(productionSources).not.toContain(hypothesis.displayName);
    }
    for (const hypothesis of referralRevenueHypothesisRegistry) {
      expect(productionSources).not.toContain(hypothesis.hypothesisKey);
      expect(productionSources).not.toContain(hypothesis.displayName);
    }
  });

  it('retires USD 119 from current seed data while preserving historical kind compatibility', async () => {
    const [seed, commerce] = await Promise.all([
      source('packages/persistence/src/seed.ts'),
      source('packages/domain/src/commerce.ts'),
    ]);

    expect(seed).not.toMatch(/amountMinor:\s*(?:11_900|11900)\b/u);
    expect(commerce).toContain("priceHypothesisKinds = ['list', 'founding_experiment']");
  });

  it('retains one exact public and Checkout offer', async () => {
    const [publicConfig, pricing, checkoutContract, stripeConfig] = await Promise.all([
      source('apps/api/src/app.ts'),
      source('apps/web/src/app/pricing/page.tsx'),
      source('packages/contracts/src/commerce.ts'),
      source('packages/config/src/index.ts'),
    ]);

    expect(publicConfig).toContain("key: 'family'");
    expect(publicConfig).toContain('monthlyUsd: 14.99');
    expect(publicConfig).toContain('annualUsd: null');
    expect(pricing).toContain('USD 14.99 monthly');
    expect(pricing).not.toMatch(/USD (?:8\.99|89|149)\b/u);
    expect(checkoutContract).toContain("offerId: z.literal('founding_family_monthly_v1')");
    expect(stripeConfig).toContain('unitAmountMinor: 1499');
    expect(stripeConfig).toContain("billingInterval: 'month'");
  });
});

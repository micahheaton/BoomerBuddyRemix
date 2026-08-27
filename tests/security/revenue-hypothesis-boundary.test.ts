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
const hypothesisGovernanceEntryPoints = [
  'docs/post-launch-beta/README.md',
  'docs/post-launch-beta/EXECUTION-PLAN.md',
  'docs/post-launch-beta/REVENUE-EXPERIMENT-ACTION-PACKET.md',
  'docs/post-launch-beta/RUN-NEXT.md',
  'docs/post-launch-beta/RUN-NEXT-EXECUTION.md',
  'docs/post-launch-beta/GAUNTLET-PROMPT-PACK.md',
  'docs/post-launch-beta/GAUNTLET-PROMPT-PACK-G4-G15.md',
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
  it('keeps every typed hypothesis immutable and limited to synthetic or sandbox execution', () => {
    for (const hypothesis of revenueOfferHypothesisRegistry) {
      expect(Object.isFrozen(hypothesis)).toBe(true);
      expect(hypothesis.scopes).toEqual(['synthetic', 'stripe_sandbox']);
      expect(hypothesis).toMatchObject({
        publicRouteEnabled: false,
        productionActivationEnabled: false,
        liveProviderWriteEnabled: false,
      });
    }
    for (const hypothesis of referralRevenueHypothesisRegistry) {
      expect(Object.isFrozen(hypothesis)).toBe(true);
      expect(hypothesis.scopes).toEqual(['synthetic', 'stripe_sandbox']);
      expect(hypothesis).toMatchObject({
        cashPayoutEnabled: false,
        creditTransferEnabled: false,
        externalActionEnabled: false,
        publicRouteEnabled: false,
        productionActivationEnabled: false,
        liveProviderWriteEnabled: false,
      });
    }
  });

  it('labels the old Run 2 product catalog as compatibility evidence rather than offer authority', async () => {
    const registry = await source('docs/post-launch-beta/OFFER-HYPOTHESIS-REGISTRY.md');

    expect(registry).toContain('seededCommercePlanVersions');
    expect(registry).toContain('priceHypotheses');
    expect(registry).toContain('historical Run 2 compatibility fixtures');
    expect(registry).toContain('They are not current offer hypotheses');
  });

  it('makes the controlling registry required reading in every execution prompt', async () => {
    const entries = await Promise.all(
      hypothesisGovernanceEntryPoints.map(async (path) => ({ path, content: await source(path) })),
    );
    for (const entry of entries) {
      expect(entry.content, entry.path).toContain('OFFER-HYPOTHESIS-REGISTRY.md');
    }

    const promptPacks = entries.filter((entry) => entry.path.includes('GAUNTLET-PROMPT-PACK'));
    for (const pack of promptPacks) {
      const standalonePrompts = [...pack.content.matchAll(/```text\r?\n([\s\S]*?)\r?\n```/gu)].map(
        (match) => match[1] ?? '',
      );
      expect(standalonePrompts.length, pack.path).toBeGreaterThan(0);
      for (const prompt of standalonePrompts) {
        expect(prompt, pack.path).toContain('OFFER-HYPOTHESIS-REGISTRY.md');
        expect(prompt, pack.path).toMatch(/controlling/iu);
      }
    }

    const currentPlan = entries.find((entry) => entry.path.endsWith('EXECUTION-PLAN.md'))?.content;
    expect(currentPlan).toBeDefined();
    expect(currentPlan).not.toMatch(/Enable annual Family|test Plus|\$119 founding annual/iu);
  });

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
    const [publicConfig, home, pricing, checkoutContract, stripeConfig] = await Promise.all([
      source('apps/api/src/app.ts'),
      source('apps/web/src/app/page.tsx'),
      source('apps/web/src/app/pricing/page.tsx'),
      source('packages/contracts/src/commerce.ts'),
      source('packages/config/src/index.ts'),
    ]);

    expect(publicConfig).toContain("key: 'family'");
    expect(publicConfig).toContain('monthlyUsd: 14.99');
    expect(publicConfig).toContain('annualUsd: null');
    expect(home).toContain('Family is USD 14.99 per month');
    expect(pricing).toContain('USD 14.99 monthly');
    const publicOfferCopy = `${home}\n${pricing}`;
    expect(publicOfferCopy).not.toMatch(/USD (?:8\.99|89|149)\b/u);
    expect(publicOfferCopy).not.toMatch(/\$(?:8\.99|89|149)\b/u);
    expect(publicOfferCopy).not.toMatch(/Individual (?:monthly|yearly|annual)/iu);
    expect(publicOfferCopy).not.toMatch(/referral (?:credit|offer|reward)/iu);
    expect(checkoutContract).toContain("offerId: z.literal('founding_family_monthly_v1')");
    expect(stripeConfig).toContain('unitAmountMinor: 1499');
    expect(stripeConfig).toContain("billingInterval: 'month'");
  });

  it('keeps the noncharging experiment packet isolated and honest about funnel evidence', async () => {
    const packet = await source('docs/post-launch-beta/REVENUE-EXPERIMENT-ACTION-PACKET.md');

    expect(packet).toContain(
      'Status: **non-executable local specification; no external action authorized or performed**',
    );
    expect(packet).toContain('`c39a98415320adb40737d1ea354674b2aa8c4194`');
    expect(packet).toMatch(/c39a984 baseline remains not live-capable/u);
    expect(packet).toContain(
      'This versioned packet cannot bind the final commit SHA that contains itself',
    );
    expect(packet).toMatch(
      /final exact SHA, annotated tag, and green CI are\s+recorded in an external release receipt/u,
    );
    expect(packet).toContain('paid-entitlement repair is complete and green');
    expect(packet).toContain('CONFIRM NONCHARGING RELEASE SETUP');
    expect(packet).not.toContain('Candidate SHA: **NOT YET BOUND**');
    expect(packet).toContain('Family means coverage for one household group');
    expect(packet).toContain('Do not use or modify the existing `Boomer Buddy sandbox`');
    expect(packet).toContain('create a new isolated sandbox');
    expect(packet).toContain('access-intent receipt proves only `intent_created`');
    expect(packet).toMatch(/cannot currently measure lead-to-paid\s+conversion/u);
    expect(packet).toMatch(/private, noncollecting website\s+preview/u);
    expect(packet).toContain('zero live objects');
    expect(packet).toContain('zero participant contacts');
    expect(packet).not.toMatch(/employer.+USD|association.+USD|bulk.+USD/iu);
  });
});

import { readdir, readFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import {
  referralRevenueHypothesisRegistry,
  revenueOfferHypothesisRegistry,
  revenueOfferHypothesisRegistryVersion,
} from '../../packages/domain/src/revenue-hypotheses';
import {
  isLocalRevenueResearchPreviewEnabled,
  orderedRevenueResearchIntervalOptions,
  revenueResearchAudienceDefinitions,
  revenueResearchPresentationOrderFromSelector,
  revenueResearchPreviewStatusCopy,
  revenueResearchResponseChoices,
} from '../../apps/web/src/lib/revenue-research-preview';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const isolatedPreviewPaths = new Set([
  'apps/web/src/app/research/offer-pair-v1/page.tsx',
  'apps/web/src/components/revenue-research-preview.tsx',
  'apps/web/src/lib/revenue-research-preview.ts',
]);

async function source(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), 'utf8');
}

function repositoryPath(path: string): string {
  return relative(repositoryRoot, path).replaceAll('\\', '/');
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (['.next', 'dist', 'node_modules'].includes(entry.name)) return [];
        return sourceFiles(path);
      }
      return ['.ts', '.tsx'].includes(extname(path)) ? [path] : [];
    }),
  );
  return files.flat();
}

describe('local-only revenue research preview', () => {
  it('fails closed unless both exact flags are present in an explicitly local runtime', () => {
    const enabled = {
      NODE_ENV: 'development',
      BB_LOCAL_REVENUE_RESEARCH_PREVIEW_ENABLED: 'true',
      BB_LOCAL_REVENUE_RESEARCH_PREVIEW_SECOND_GUARD_CONFIRMED: 'true',
    } as const;

    expect(isLocalRevenueResearchPreviewEnabled(enabled)).toBe(true);
    expect(isLocalRevenueResearchPreviewEnabled({ ...enabled, NODE_ENV: 'test' })).toBe(true);
    expect(isLocalRevenueResearchPreviewEnabled({ ...enabled, NODE_ENV: 'production' })).toBe(
      false,
    );
    expect(
      isLocalRevenueResearchPreviewEnabled({
        BB_LOCAL_REVENUE_RESEARCH_PREVIEW_ENABLED: 'true',
        BB_LOCAL_REVENUE_RESEARCH_PREVIEW_SECOND_GUARD_CONFIRMED: 'true',
      }),
    ).toBe(false);
    expect(
      isLocalRevenueResearchPreviewEnabled({
        NODE_ENV: 'development',
        BB_LOCAL_REVENUE_RESEARCH_PREVIEW_SECOND_GUARD_CONFIRMED: 'true',
      }),
    ).toBe(false);
    expect(
      isLocalRevenueResearchPreviewEnabled({
        NODE_ENV: 'development',
        BB_LOCAL_REVENUE_RESEARCH_PREVIEW_ENABLED: 'true',
      }),
    ).toBe(false);
    expect(
      isLocalRevenueResearchPreviewEnabled({
        ...enabled,
        BB_LOCAL_REVENUE_RESEARCH_PREVIEW_ENABLED: 'TRUE',
      }),
    ).toBe(false);
  });

  it('binds exact preview arithmetic and copy to registry version 1', () => {
    expect(revenueOfferHypothesisRegistryVersion).toBe(1);
    expect(revenueOfferHypothesisRegistry.every((offer) => offer.version === 1)).toBe(true);
    expect(referralRevenueHypothesisRegistry.every((hypothesis) => hypothesis.version === 1)).toBe(
      true,
    );
    expect(revenueResearchPreviewStatusCopy).toBe(
      'Research preview only. These choices do not start Checkout, reserve a price, or create an offer. Family at USD 14.99 per month is the sole approved production offer candidate, and it is not live. Every yearly and Individual choice shown here is unavailable and is being evaluated only as a hypothesis.',
    );

    for (const audience of ['family', 'individual'] as const) {
      const definition = revenueResearchAudienceDefinitions[audience];
      const monthly = revenueOfferHypothesisRegistry.find(
        (offer) => offer.audience === audience && offer.billingInterval === 'month',
      );
      const yearly = revenueOfferHypothesisRegistry.find(
        (offer) => offer.audience === audience && offer.billingInterval === 'year',
      );
      const referral = referralRevenueHypothesisRegistry.find(
        (candidate) => candidate.eligibleOfferHypothesisKey === monthly?.hypothesisKey,
      );

      expect(monthly).toBeDefined();
      expect(yearly).toBeDefined();
      expect(referral).toBeDefined();
      expect(definition.monthlyAmountMinor).toBe(monthly?.amountMinor);
      expect(definition.yearlyAmountMinor).toBe(yearly?.amountMinor);
      expect(definition.twelveMonthlyPaymentsMinor).toBe((monthly?.amountMinor ?? 0) * 12);
      expect(definition.savingsMinor).toBe(
        definition.twelveMonthlyPaymentsMinor - definition.yearlyAmountMinor,
      );
      expect(definition.referral.creditMinor).toBe(referral?.creditMinor);
      expect(definition.referral.maximumQualifyingReferrals).toBe(
        referral?.maximumQualifyingReferralsPerReferrer,
      );
      expect(definition.referral.referrerAndHouseholdCapMinor).toBe(
        referral?.maximumCreditPerHouseholdMinor,
      );
      expect(definition.referral.programLiabilityCapMinor).toBe(
        referral?.maximumProgramLiabilityMinor,
      );
      expect(definition.referral.maximumWholeCredits).toBe(
        (referral?.maximumProgramLiabilityMinor ?? 0) / (referral?.creditMinor ?? 1),
      );
    }

    expect(revenueResearchAudienceDefinitions.family).toMatchObject({
      label: 'Family - one household group',
      monthlyCopy: 'USD 14.99 each month',
      yearlyCopy: 'USD 149 each year; USD 30.88 less than twelve monthly payments',
      savingsMinor: 3_088,
    });
    expect(revenueResearchAudienceDefinitions.individual).toMatchObject({
      label: 'Individual - one person',
      monthlyCopy: 'USD 8.99 each month',
      yearlyCopy: 'USD 89 each year; USD 18.88 less than twelve monthly payments',
      savingsMinor: 1_888,
    });
    expect(revenueResearchResponseChoices.map((choice) => choice.value)).toEqual([
      'monthly',
      'yearly',
      'neither',
      'unsure',
    ]);
  });

  it('randomizes only price order through a deterministic selector without tracking', () => {
    expect(revenueResearchPresentationOrderFromSelector(0)).toBe('monthly_first');
    expect(revenueResearchPresentationOrderFromSelector(1)).toBe('yearly_first');
    expect(
      orderedRevenueResearchIntervalOptions('family', 'monthly_first').map(
        (option) => option.responseValue,
      ),
    ).toEqual(['monthly', 'yearly']);
    expect(
      orderedRevenueResearchIntervalOptions('family', 'yearly_first').map(
        (option) => option.responseValue,
      ),
    ).toEqual(['yearly', 'monthly']);
    for (const invalidSelector of [-1, 0.5, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => revenueResearchPresentationOrderFromSelector(invalidSelector)).toThrow(
        /exactly 0 or 1/u,
      );
    }
  });

  it('contains no collector, durable tracking, provider call, or purchase path', async () => {
    const [page, component, model, routeFiles] = await Promise.all([
      source('apps/web/src/app/research/offer-pair-v1/page.tsx'),
      source('apps/web/src/components/revenue-research-preview.tsx'),
      source('apps/web/src/lib/revenue-research-preview.ts'),
      readdir(resolve(repositoryRoot, 'apps/web/src/app/research/offer-pair-v1')),
    ]);
    const preview = `${page}\n${component}\n${model}`;

    expect(routeFiles).toEqual(['page.tsx']);
    expect(page).toContain('if (!isLocalRevenueResearchPreviewEnabled(process.env))');
    expect(page).toContain('notFound();');
    expect(page).toMatch(/robots:\s*\{[\s\S]*index:\s*false,[\s\S]*follow:\s*false,/u);
    expect(page).toContain("referrer: 'no-referrer'");
    expect(component).toContain('{audience && definition ? (');
    expect(component.indexOf('research-coverage-heading')).toBeLessThan(
      component.indexOf('{audience && definition ? ('),
    );
    expect(preview).not.toMatch(
      /<form\b|<input\b|<textarea\b|contentEditable|action=|fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|document\.cookie|cookies\s*\(|localStorage|sessionStorage|URLSearchParams/iu,
    );
    expect(preview).not.toMatch(
      /@clerk|ClerkProvider|stripe(?:\.com|_sandbox)|Payment Link|checkout\.sessions|analytics\s*\.|gtag\s*\(|posthog\s*\.|segment\s*\./iu,
    );
    expect(component.match(/href=/gu)).toEqual(['href=']);
    expect(component).toContain('<a href="/">Leave without responding</a>');
    expect(component).not.toMatch(/href=["'][^"']*(?:billing|checkout|purchase|subscribe)/iu);
  });

  it('is unlinked and keeps candidate terms out of every non-research web source', async () => {
    const paths = await sourceFiles(resolve(repositoryRoot, 'apps/web/src'));
    const nonResearchSources = (
      await Promise.all(
        paths
          .filter((path) => !isolatedPreviewPaths.has(repositoryPath(path)))
          .map(async (path) => `// ${repositoryPath(path)}\n${await readFile(path, 'utf8')}`),
      )
    ).join('\n');
    const publicSources = (
      await Promise.all(
        [
          'apps/web/src/app/page.tsx',
          'apps/web/src/app/pricing/page.tsx',
          'apps/web/src/components/public-shell.tsx',
          'apps/web/src/app/member/billing/page.tsx',
        ].map(source),
      )
    ).join('\n');

    expect(nonResearchSources).not.toContain('/research/offer-pair-v1');
    expect(nonResearchSources).not.toContain('RevenueResearchPreview');
    expect(nonResearchSources).not.toContain('BB_LOCAL_REVENUE_RESEARCH_PREVIEW_ENABLED');
    expect(publicSources).not.toMatch(/USD (?:8\.99|89(?:\.00)?|149(?:\.00)?)\b/u);
    expect(publicSources).not.toMatch(/Individual - one person|referral service-credit/iu);
    expect(publicSources).toContain('Family is USD 14.99 per month');
  });
});

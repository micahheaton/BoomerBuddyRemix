import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { buildSync } from 'esbuild';
import { describe, expect, it } from 'vitest';

type RenderedRoutes = Record<string, string> & {
  readonly pricing: string;
  readonly billingTerms: string;
  readonly privacy: string;
};

let renderedRoutes: RenderedRoutes | undefined;

function renderedProductionRoutes(): RenderedRoutes {
  if (renderedRoutes !== undefined) return renderedRoutes;
  const bundle = buildSync({
    entryPoints: [resolve(import.meta.dirname, 'fixtures/render-customer-pages.tsx')],
    bundle: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    external: ['next/link', 'react', 'react-dom/server', 'react/jsx-runtime'],
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
    platform: 'node',
    target: 'node22',
    write: false,
  });
  const output = bundle.outputFiles[0];
  if (output === undefined) throw new Error('Customer route render bundle was not produced');
  const commonJsModule: { exports: Record<string, unknown> } = { exports: {} };
  const execute = new Function('require', 'module', 'exports', output.text);
  execute(createRequire(import.meta.url), commonJsModule, commonJsModule.exports);
  renderedRoutes = (commonJsModule.exports as { routes: RenderedRoutes }).routes;
  return renderedRoutes;
}

describe('rendered production customer funnel', () => {
  it('renders the customer routes without internal launch or analysis language', () => {
    const rendered = Object.values(renderedProductionRoutes()).join('\n');

    expect(rendered).toContain('Family');
    expect(rendered).toContain('USD 14.99 monthly');
    expect(rendered).toContain('Results can be wrong');
    expect(rendered).not.toMatch(
      /Founding Household|sponsored access|No annual plan|free tier|coupon|referral credit|evidence sufficiency|canonical server|provider state|ruleset|not calibrated|conversion payload|continuity proof|local development|development build/iu,
    );
  });

  it('renders support and policy destinations throughout the public funnel', () => {
    const routes = renderedProductionRoutes();
    const rendered = routes.pricing + routes.billingTerms;

    expect(rendered).toContain('href="/support"');
    expect(rendered).toContain('href="/billing-terms"');
    expect(rendered).toContain('href="/privacy"');
    expect(rendered).toContain('Monthly charges are generally not refundable');
    expect(rendered).toContain('Canceling stops future renewals');
    expect(rendered).toContain('current paid period');
  });

  it('discloses bounded campaign attribution and aggregate conversion measurement', () => {
    const privacy = renderedProductionRoutes().privacy;

    expect(privacy).toContain('small fixed list of source and campaign labels');
    expect(privacy).toContain('removes all parameters from the page address');
    expect(privacy).toContain('later paid membership');
    expect(privacy).toContain('review aggregate campaign results');
    expect(privacy).toContain('unrecognized address values are not used');
  });
});

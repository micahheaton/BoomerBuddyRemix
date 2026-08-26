import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { buildSync } from 'esbuild';
import { describe, expect, it } from 'vitest';

type RenderedRoutes = Record<string, string> & {
  readonly pricing: string;
  readonly billingTerms: string;
  readonly privacy: string;
};

const renderedRoutesByAccessIntentState = new Map<boolean, RenderedRoutes>();

function renderedProductionRoutes(accessIntentsEnabled = false): RenderedRoutes {
  const cached = renderedRoutesByAccessIntentState.get(accessIntentsEnabled);
  if (cached !== undefined) return cached;
  const accessIntentSetting = JSON.stringify(accessIntentsEnabled ? 'true' : 'false');
  const bundle = buildSync({
    entryPoints: [resolve(import.meta.dirname, 'fixtures/render-customer-pages.tsx')],
    bundle: true,
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.BB_PRIVATE_BETA_ACCESS_INTENTS_ENABLED': accessIntentSetting,
      'process.env.BB_PRIVATE_BETA_ACCESS_INTENTS_EDGE_GUARD_CONFIRMED': accessIntentSetting,
    },
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
  const renderedRoutes = (commonJsModule.exports as { routes: RenderedRoutes }).routes;
  renderedRoutesByAccessIntentState.set(accessIntentsEnabled, renderedRoutes);
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

  it('links the homepage directly to truthful Family pricing', () => {
    const home = renderedProductionRoutes().home;

    expect(home).toContain('href="/pricing"');
    expect(home).toContain('Family is USD 14.99 per month.');
    expect(home).toContain('Access is invite-only');
  });

  it('does not advertise self-service household capacity that the private beta cannot provide', () => {
    const pricing = renderedProductionRoutes().pricing;

    expect(pricing).toContain('For one invited household.');
    expect(pricing).toContain('You cannot create a new Trusted Circle invitation right now.');
    expect(pricing).not.toMatch(/up to three protected adults|six Trusted Circle people/iu);
  });

  it('renders honest paused copy instead of an active access-intent control by default', () => {
    const pricing = renderedProductionRoutes().pricing;

    expect(pricing).toContain('Private-beta access requests are paused');
    expect(pricing).toContain('no request or email has been sent');
    expect(pricing).not.toContain('Create receipt and open email');
  });

  it('renders the active CTA only after both production enablement gates are true', () => {
    const pricing = renderedProductionRoutes(true).pricing;

    expect(pricing).toContain('Ask about private-beta access');
    expect(pricing).toContain('Create receipt and open email');
    expect(pricing).not.toContain('Private-beta access requests are paused');
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

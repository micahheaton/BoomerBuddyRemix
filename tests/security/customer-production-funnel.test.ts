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
      /private.?beta|Founding Household|sponsored access|No annual plan|free tier|coupon|referral credit|evidence sufficiency|canonical server|provider state|ruleset|not calibrated|conversion payload|continuity proof|local development|development build/iu,
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
    expect(home).toContain('A calmer family response to suspicious messages.');
    expect(home).toContain('USD 14.99/month');
    expect(home).toContain('One invited household');
    expect(home).toContain('See the Family plan');
    expect(home).toContain('Try Public Check free');
  });

  it('advertises only implemented Family value without unsupported capacity claims', () => {
    const pricing = renderedProductionRoutes().pricing;

    expect(pricing).toContain('For one invited household.');
    expect(pricing).toContain(
      'Consent-based Trusted Circle invitations, sharing, and acknowledgement',
    );
    expect(pricing).toContain('An optional Family Safe Word');
    expect(pricing).toContain('Seven short safety lessons');
    expect(pricing).toContain('An optional weekly practice prompt in the in-app learning feed');
    expect(pricing).toContain('Checkout is not public.');
    expect(pricing).not.toMatch(/up to three protected adults|six Trusted Circle people/iu);
    expect(pricing).not.toContain('You cannot create a new Trusted Circle invitation right now.');
  });

  it('renders honest paused copy instead of an active access-intent control by default', () => {
    const pricing = renderedProductionRoutes().pricing;

    expect(pricing).toContain('Family access requests are paused');
    expect(pricing).toContain('No request or email has been sent');
    expect(pricing).not.toContain('Open an email request');
  });

  it('renders the active CTA only after both production enablement gates are true', () => {
    const pricing = renderedProductionRoutes(true).pricing;

    expect(pricing).toContain('Ask about Family early access');
    expect(pricing).toContain('Open an email request');
    expect(pricing).toContain('No email is sent until');
    expect(pricing).not.toContain('Family access requests are paused');
  });

  it('keeps the buyer story free of unsupported protection and delivery claims', () => {
    const routes = renderedProductionRoutes();
    const marketing = [routes.home, routes.pricing, routes.howItWorks, routes.trust].join('\n');

    expect(marketing).not.toMatch(
      /prevents scams|scam-proof|real-time alerts|automatic notification|verified safe|24\/7 protection|regional scams near you|AI scam detector/iu,
    );
    expect(marketing).toContain('Results can be wrong');
    expect(marketing).toContain('does not monitor your phone');
    expect(marketing).toContain('redacted result');
    expect(marketing).toContain('private History for up to 30 days');
    expect(marketing).toContain('Each adult chooses their own participation.');
    expect(marketing).toContain('Limited operations metadata');
    expect(marketing).not.toMatch(/device reminder/iu);
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

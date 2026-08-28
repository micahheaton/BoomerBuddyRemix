import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { buildSync } from 'esbuild';
import { describe, expect, it } from 'vitest';

type RenderedRoutes = Record<string, string> & {
  readonly home: string;
  readonly pricing: string;
  readonly howItWorks: string;
  readonly trust: string;
  readonly billingTerms: string;
  readonly support: string;
  readonly privacy: string;
  readonly terms: string;
  readonly accessibility: string;
  readonly accountDeletion: string;
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
    expect(rendered).toContain('$14.99 USD per month');
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
    expect(home).toContain('Handle suspicious messages with a calmer family plan.');
    expect(home).toContain('Scam-safety support for older adults and families');
    expect(home).toContain('seven short safety lessons');
    expect(home).toContain('USD 14.99/month');
    expect(home).toContain('One invited household');
    expect(home).toContain('See what Family includes');
    expect(home).toContain('Try a free Check');
  });

  it('advertises only implemented Family value without unsupported capacity claims', () => {
    const pricing = renderedProductionRoutes().pricing;

    expect(pricing).toContain('Billed monthly for one invited household.');
    expect(pricing).toContain('Invite a Trusted Circle person and share a summary');
    expect(pricing).toContain('An optional Family Safe Word and weekly in-app practice');
    expect(pricing).toContain('Seven short safety lessons');
    expect(pricing).toContain('Family is currently available by invitation.');
    expect(pricing).not.toMatch(/up to three protected adults|six Trusted Circle people/iu);
    expect(pricing).not.toContain('You cannot create a new Trusted Circle invitation right now.');
  });

  it('renders honest paused copy instead of an active access-intent control by default', () => {
    const pricing = renderedProductionRoutes().pricing;

    expect(pricing).toContain('Family access requests are paused');
    expect(pricing).toContain('This page has not sent a request or email');
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
    expect(marketing).toMatch(/private (?:Check )?History for up to 30 days/iu);
    expect(marketing).toContain('Every adult chooses whether to join');
    expect(marketing).toContain('Limited operations metadata');
    expect(marketing).not.toMatch(/device reminder/iu);
  });

  it('answers the four first-screen buyer questions without internal gate language', () => {
    const routes = renderedProductionRoutes();
    const homeHero = routes.home.slice(0, routes.home.indexOf('</section>'));
    const pricingHero = routes.pricing.slice(0, routes.pricing.indexOf('</section>'));

    expect(homeHero).toContain('older adults and families');
    expect(homeHero).toContain('seven short safety lessons');
    expect(homeHero).toContain('USD 14.99/month');
    expect(homeHero).toContain('See what Family includes');
    expect(homeHero).toContain('Try a free Check');
    expect(homeHero).toContain('does not monitor your phone');

    expect(pricingHero).toContain('$14.99 USD per month');
    expect(pricingHero).toContain('Billed monthly for one invited household');
    expect(pricingHero).toContain('I have an invitation');
    expect(pricingHero).toContain('Try a free Check');
    expect(pricingHero).toContain('Paying does not give anyone access');

    expect(homeHero + pricingHero).not.toMatch(
      /billing authority|service shows that billing is ready|evidence sufficiency|provider state|ruleset|exact person/iu,
    );
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

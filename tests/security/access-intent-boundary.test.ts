import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  accessIntentAttributionFromSearch,
  accessIntentMailto,
  accessIntentMailbox,
} from '../../apps/web/src/lib/access-intent';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function source(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), 'utf8');
}

describe('private-beta access-intent boundary', () => {
  it('accepts only complete exact attribution pairs and never retains arbitrary parameters', () => {
    expect(accessIntentAttributionFromSearch('')).toEqual({ source: 'direct', campaign: 'none' });
    expect(accessIntentAttributionFromSearch('?source=organic&campaign=none')).toEqual({
      source: 'organic',
      campaign: 'none',
    });
    expect(accessIntentAttributionFromSearch('?source=partner&campaign=trusted_partner')).toEqual({
      source: 'partner',
      campaign: 'trusted_partner',
    });
    expect(accessIntentAttributionFromSearch('?source=campaign&campaign=launch_2026')).toEqual({
      source: 'campaign',
      campaign: 'launch_2026',
    });
    for (const search of [
      '?source=campaign&campaign=none',
      '?source=direct',
      '?campaign=none',
      '?source=direct&source=organic&campaign=none',
      '?source=direct&campaign=none&email=forbidden',
      '?source=unknown&campaign=none',
    ]) {
      expect(accessIntentAttributionFromSearch(search)).toBeNull();
    }
  });

  it('builds a fixed-destination, subject-only mailto and rejects header injection', () => {
    const receipt = 'access_intent_0123456789abcdefghijklmnopqrstuv';
    const mailto = accessIntentMailto(receipt);

    expect(accessIntentMailbox).toBe('support@boomerbuddy.net');
    expect(mailto).toBe(
      `mailto:support@boomerbuddy.net?subject=${encodeURIComponent(`Early access request ${receipt}`)}`,
    );
    expect(mailto).not.toMatch(/[?&](?:body|cc|bcc)=/iu);
    for (const unsafe of [
      `${receipt}%0d%0abcc=attacker`,
      `${receipt}\r\nbcc=attacker`,
      'https://example.invalid',
      'access_intent_short',
    ]) {
      expect(() => accessIntentMailto(unsafe)).toThrow();
    }
  });

  it('omits browser credentials and exposes honest privacy and retention copy', async () => {
    const [api, cta, pricing, privacy, support, worker, route, persistence, guide] =
      await Promise.all([
        source('apps/web/src/lib/api.ts'),
        source('apps/web/src/components/access-intent-cta.tsx'),
        source('apps/web/src/app/pricing/page.tsx'),
        source('apps/web/src/app/privacy/page.tsx'),
        source('apps/web/src/app/support/page.tsx'),
        source('apps/worker/src/server.ts'),
        source('apps/api/src/routes/access-intents.ts'),
        source('packages/persistence/src/access-intents.ts'),
        source('docs/run-3/PRIVATE-BETA-ACCESS-INTENTS.md'),
      ]);

    expect(api).toContain("path === '/v1/public/access-intents'");
    expect(api).toContain("credentials: anonymousPublicRequest ? 'omit' : 'include'");
    expect(cta).toContain('it does not mean an email was sent or a lead was');
    expect(cta).toContain('without creating another receipt');
    expect(cta).toContain("setAttribution({ source: 'direct', campaign: 'none' })");
    expect(cta).not.toContain('<Link href="/pricing"');
    expect(cta).not.toMatch(/<input|<textarea|type="email"|type="tel"/iu);
    expect(pricing).toContain("export const dynamic = 'force-dynamic'");
    expect(pricing).toContain('BB_PRIVATE_BETA_ACCESS_INTENTS_ENABLED');
    expect(pricing).toContain('BB_PRIVATE_BETA_ACCESS_INTENTS_EDGE_GUARD_CONFIRMED');
    expect(pricing).toContain('Early-access requests are paused');
    expect(privacy).toMatch(
      /It does not contain your name,\s+email\s+address, phone number, message/iu,
    );
    expect(privacy).toContain('Hosting, edge-security, and reliability');
    expect(support).toContain('Creating it does not send an email');
    expect(worker).toContain('accessIntents.purgeExpired(now, batch)');
    expect(route).toContain('if (options.mutationEnabled === true)');
    expect(route.indexOf('applicationLimiter.consume')).toBeLessThan(
      route.indexOf('repositories.accessIntents.create'),
    );
    expect(persistence).toContain('LIMIT $2');
    expect(persistence).not.toContain('RETURNING receipt_code');
    expect(guide).toMatch(/independently\s+operated edge limit/u);
    expect(guide).toContain('do not rotate that key');
  });
});

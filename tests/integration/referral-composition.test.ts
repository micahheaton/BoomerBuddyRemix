import { createLogger } from '@boomerbuddy/observability';
import { type Database } from '@boomerbuddy/persistence';
import { createSeededTestDatabase, fixedTestNow } from '@boomerbuddy/testkit';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../apps/api/src/app';
import { browserHeaders, hqOrigin, login, testConfig } from './support';

describe('disabled referral shared composition', () => {
  let database: Database | undefined;
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    for (const app of apps.splice(0).reverse()) await app.close();
    await database?.close();
    database = undefined;
  });

  async function localApp(environment: 'development' | 'production' = 'development') {
    database = await createSeededTestDatabase(fixedTestNow);
    const app = await buildApp({
      config: { ...testConfig(), environment },
      database,
      initialize: false,
      closeDatabase: false,
      now: () => fixedTestNow,
      logger: createLogger({ level: 'error', sink: () => undefined, clock: () => fixedTestNow }),
    });
    apps.push(app);
    return app;
  }

  it('registers only a content-free owner/reviewer queue and keeps the engine empty', async () => {
    const app = await localApp();
    for (const handle of ['hq-heidi', 'hq-riley'] as const) {
      const signedIn = await login(app, handle, 'hq');
      const response = await app.inject({
        method: 'GET',
        url: '/v1/hq/referrals?limit=25',
        headers: browserHeaders(signedIn.cookie as string, hqOrigin),
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.json()).toEqual({
        projection: 'content_free_disabled_referral_evidence',
        referrals: [],
      });
    }

    const support = await login(app, 'hq-sam', 'hq');
    const denied = await app.inject({
      method: 'GET',
      url: '/v1/hq/referrals',
      headers: browserHeaders(support.cookie as string, hqOrigin),
    });
    expect(denied.statusCode).toBe(403);
    const programs = await database?.query<{ readonly count: number }>(
      'SELECT count(*)::int AS count FROM run3_referral_program_versions',
    );
    expect(programs?.rows[0]?.count).toBe(0);
  });

  it('has no customer execution route and keeps the HQ queue unavailable in production', async () => {
    const app = await localApp('production');
    const hq = await app.inject({ method: 'GET', url: '/v1/hq/referrals' });
    expect(hq.statusCode).toBe(404);
    const customer = await app.inject({
      method: 'POST',
      url: '/v1/referrals/simulation/share-links',
      payload: { simulation: true },
    });
    expect(customer.statusCode).toBe(404);
  });
});

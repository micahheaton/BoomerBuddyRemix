import { createLogger } from '@boomerbuddy/observability';
import { type Database } from '@boomerbuddy/persistence';
import { createSeededTestDatabase, fixedTestNow } from '@boomerbuddy/testkit';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../apps/api/src/app';
import { browserHeaders, hqOrigin, login, testConfig } from './support';

describe('editorial shared API composition', () => {
  let database: Database | undefined;
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    for (const app of apps.splice(0).reverse()) await app.close();
    await database?.close();
    database = undefined;
  });

  it('registers the local owner board with a private metadata-only response', async () => {
    database = await createSeededTestDatabase(fixedTestNow);
    const app = await buildApp({
      config: testConfig(),
      database,
      initialize: false,
      closeDatabase: false,
      now: () => fixedTestNow,
      logger: createLogger({ level: 'error', sink: () => undefined, clock: () => fixedTestNow }),
    });
    apps.push(app);
    const founder = await login(app, 'hq-heidi', 'hq');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/hq/editorial',
      headers: browserHeaders(founder.cookie as string, hqOrigin),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.json()).toMatchObject({
      projection: 'owner_global_or_exact_assigned_editorial_metadata',
      contentIncluded: false,
      evidenceTier: 'local_simulation',
      capabilities: {
        externalFetch: false,
        externalModel: false,
        generation: false,
        providerProcessing: false,
        publication: false,
        outboundDelivery: false,
        transcription: false,
      },
    });
  });

  it('keeps the composed editorial board unavailable in production', async () => {
    database = await createSeededTestDatabase(fixedTestNow);
    const app = await buildApp({
      config: { ...testConfig(), environment: 'production' },
      database,
      initialize: false,
      closeDatabase: false,
      now: () => fixedTestNow,
      logger: createLogger({ level: 'error', sink: () => undefined, clock: () => fixedTestNow }),
    });
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/v1/hq/editorial',
      headers: { origin: hqOrigin },
    });

    expect(response.statusCode, response.body).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: 'not_found', message: expect.stringContaining('activation gates') },
    });
  });
});

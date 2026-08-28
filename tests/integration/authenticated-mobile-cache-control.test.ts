import { afterEach, describe, expect, it } from 'vitest';
import { bearerHeaders, createApiHarness, login, type ApiHarness } from './support';

const authenticatedPrivateCacheControl = 'private, no-store, max-age=0';

describe('authenticated mobile response cache control', () => {
  let harness: ApiHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('marks representative direct mobile API reads private and no-store', async () => {
    harness = await createApiHarness();
    const session = await login(harness.app, 'owner-alice', 'mobile');
    const headers = bearerHeaders(session.token as string);

    for (const url of [
      '/v1/me',
      '/v1/checks?limit=10&offset=0',
      '/v1/family',
      '/v1/orientation',
      '/v1/entitlements',
    ]) {
      const response = await harness.app.inject({ method: 'GET', url, headers });
      expect(response.statusCode, url).toBe(200);
      expect(response.headers['cache-control'], url).toBe(authenticatedPrivateCacheControl);
    }
  });

  it('does not change anonymous public cache semantics', async () => {
    harness = await createApiHarness();

    for (const url of ['/health/live', '/health/ready', '/v1/public/config']) {
      const response = await harness.app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(200);
      expect(response.headers['cache-control'], url).toBeUndefined();
    }
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { browserHeaders, createApiHarness, login, type ApiHarness } from '../integration/support';

describe('Check website-address boundary security', () => {
  let harness: ApiHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('rejects schemes, userinfo, and malformed addresses without persisting submitted content', async () => {
    harness = await createApiHarness();
    const alice = await login(harness.app, 'owner-alice');
    const before = await harness.database.query<
      {
        artifacts: number;
        public_results: number;
      } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::int FROM artifacts) AS artifacts,
         (SELECT count(*)::int FROM public_check_results) AS public_results`,
    );

    const unsafeSignedInAddresses = [
      'ftp://example.test/path',
      'https:example.test/path',
      'https//example.test/path',
      'https://user@example.test/path',
      'example.test\\@different.test/path',
    ];
    for (const content of unsafeSignedInAddresses) {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/v1/checks',
        headers: browserHeaders(alice.cookie as string),
        payload: { kind: 'url', content },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('invalid_input');
      expect(response.body).not.toContain(content);
    }
    const schemeLessSecret = 'example.test/path?access_token=generated-sensitive-value';
    const secretResponse = await harness.app.inject({
      method: 'POST',
      url: '/v1/checks',
      headers: browserHeaders(alice.cookie as string),
      payload: { kind: 'url', content: schemeLessSecret },
    });
    expect(secretResponse.statusCode).toBe(400);
    expect(secretResponse.json().error.code).toBe('restricted_input');
    expect(secretResponse.body).not.toContain(schemeLessSecret);

    const publicContext = await harness.app.inject({
      method: 'POST',
      url: '/v1/public/check-contexts',
      payload: { attribution: { source: 'direct', campaign: 'none' } },
    });
    const context = publicContext.json<{
      context: { token: string; continuityProof: string };
    }>().context;
    for (const content of [
      'javascript:alert(1)',
      'https:///missing-host',
      'example.test@evil.test',
    ]) {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/v1/public/checks',
        payload: {
          contextToken: context.token,
          continuityProof: context.continuityProof,
          kind: 'url',
          content,
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('invalid_input');
      expect(response.body).not.toContain(content);
    }

    const after = await harness.database.query<
      {
        artifacts: number;
        public_results: number;
      } & Record<string, unknown>
    >(
      `SELECT
         (SELECT count(*)::int FROM artifacts) AS artifacts,
         (SELECT count(*)::int FROM public_check_results) AS public_results`,
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  }, 15_000);
});

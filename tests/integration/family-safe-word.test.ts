import { afterEach, describe, expect, it } from 'vitest';
import { browserHeaders, createApiHarness, hqOrigin, login, type ApiHarness } from './support';

describe('Family Safe Word API', () => {
  let harness: ApiHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('supports the protected member and exact trusted person without revealing the phrase', async () => {
    harness = await createApiHarness();
    const pat = await login(harness.app, 'protected-pat');
    const terry = await login(harness.app, 'trusted-terry');
    const alice = await login(harness.app, 'owner-alice');
    const phrase = 'Maple window forty';
    const route = '/v1/family/safe-word/person-protected-pat';

    const configured = await harness.app.inject({
      method: 'PUT',
      url: route,
      headers: browserHeaders(pat.cookie as string),
      payload: { action: 'replace', phrase },
    });
    expect(configured.statusCode, configured.body).toBe(200);
    expect(configured.json()).toMatchObject({ state: 'configured', changed: true });
    expect(configured.headers['cache-control']).toBe('private, no-store, max-age=0');
    expect(configured.body).not.toContain(phrase);

    const trustedStatus = await harness.app.inject({
      method: 'GET',
      url: route,
      headers: browserHeaders(terry.cookie as string),
    });
    expect(trustedStatus.statusCode, trustedStatus.body).toBe(200);
    expect(trustedStatus.json()).toMatchObject({ state: 'configured' });

    const trustedVerification = await harness.app.inject({
      method: 'POST',
      url: `${route}/verify`,
      headers: browserHeaders(terry.cookie as string),
      payload: { phrase: phrase.toUpperCase() },
    });
    expect(trustedVerification.statusCode, trustedVerification.body).toBe(200);
    expect(trustedVerification.json()).toEqual({ result: 'verified' });
    expect(trustedVerification.body).not.toContain(phrase);

    const wrong = await harness.app.inject({
      method: 'POST',
      url: `${route}/verify`,
      headers: browserHeaders(pat.cookie as string),
      payload: { phrase: 'Incorrect family phrase' },
    });
    expect(wrong.statusCode, wrong.body).toBe(200);
    expect(wrong.json()).toEqual({ result: 'not_verified' });

    const privacyRequest = await harness.app.inject({
      method: 'POST',
      url: '/v1/privacy-requests',
      headers: browserHeaders(pat.cookie as string),
      payload: { requestKind: 'export' },
    });
    expect(privacyRequest.statusCode, privacyRequest.body).toBe(202);
    const privacyRequestId = privacyRequest.json<{ id: string }>().id;
    const hqOwner = await login(harness.app, 'hq-heidi', 'hq');
    for (const [action, evidenceReference] of [
      ['verify_identity', 'identity:family-safe-word-v1'],
      ['begin_review', 'review:family-safe-word-v1'],
      ['record_plan', 'plan:family-safe-word-v1'],
    ] as const) {
      const planned = await harness.app.inject({
        method: 'POST',
        url: `/v1/hq/business-os/privacy-requests/${privacyRequestId}/actions`,
        headers: browserHeaders(hqOwner.cookie as string, hqOrigin),
        payload: { action, evidenceReference },
      });
      expect(planned.statusCode, planned.body).toBe(200);
    }
    const privacyQueue = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/business-os/privacy-requests',
      headers: browserHeaders(hqOwner.cookie as string, hqOrigin),
    });
    const plannedRequest = privacyQueue
      .json<{
        requests: Array<{
          id: string;
          plan?: {
            recordCounts: Record<string, number>;
            categoryGuidance: Array<{
              category: string;
              sourceStores: string[];
              deletionHandling: string;
            }>;
          };
        }>;
      }>()
      .requests.find((request) => request.id === privacyRequestId);
    expect(plannedRequest?.plan?.recordCounts).toMatchObject({
      family_safe_word_state: 1,
      family_safe_word_security_evidence: expect.any(Number),
    });
    expect(plannedRequest?.plan?.recordCounts.family_safe_word_security_evidence).toBeGreaterThan(
      0,
    );
    expect(plannedRequest?.plan?.categoryGuidance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'family_safe_word_state',
          sourceStores: ['safe_word_verifiers'],
          deletionHandling: 'review_delete_or_deidentify_subject_data',
        }),
        expect.objectContaining({
          category: 'family_safe_word_security_evidence',
          sourceStores: ['family_safe_word_rate_buckets', 'family_safe_word_lifecycle_events'],
          deletionHandling: 'review_retain_minimum_required_evidence',
        }),
      ]),
    );
    expect(privacyQueue.body).not.toContain(phrase);

    const trustedReplacement = await harness.app.inject({
      method: 'PUT',
      url: route,
      headers: browserHeaders(terry.cookie as string),
      payload: { action: 'disable' },
    });
    const administratorVerification = await harness.app.inject({
      method: 'POST',
      url: `${route}/verify`,
      headers: browserHeaders(alice.cookie as string),
      payload: { phrase },
    });
    expect(trustedReplacement.statusCode, trustedReplacement.body).toBe(404);
    expect(administratorVerification.statusCode, administratorVerification.body).toBe(404);
    expect(trustedReplacement.body).not.toContain(phrase);
    expect(administratorVerification.body).not.toContain(phrase);

    const disabled = await harness.app.inject({
      method: 'PUT',
      url: route,
      headers: browserHeaders(pat.cookie as string),
      payload: { action: 'disable' },
    });
    expect(disabled.statusCode, disabled.body).toBe(200);
    expect(disabled.json()).toMatchObject({ state: 'disabled', changed: true });
    const afterDisable = await harness.app.inject({
      method: 'POST',
      url: `${route}/verify`,
      headers: browserHeaders(terry.cookie as string),
      payload: { phrase },
    });
    expect(afterDisable.statusCode, afterDisable.body).toBe(200);
    expect(afterDisable.json()).toEqual({ result: 'not_verified' });
  }, 60_000);
});

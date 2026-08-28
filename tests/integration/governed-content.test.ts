import { afterEach, describe, expect, it } from 'vitest';
import {
  browserHeaders,
  createApiHarness,
  createMutableClock,
  hqOrigin,
  login,
  type ApiHarness,
} from './support';

const clock = () => createMutableClock(new Date('2026-08-28T12:00:00.000Z'));

describe('governed first-party content API', () => {
  let harness: ApiHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('keeps production-capable controls default-off', async () => {
    harness = await createApiHarness(clock());
    const owner = await login(harness.app, 'hq-heidi', 'hq');
    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/hq/content',
      headers: browserHeaders(owner.cookie as string, hqOrigin),
    });
    expect(response.statusCode).toBe(404);
    expect(response.headers['cache-control']).toContain('no-store');
  });

  it('generates internal drafts, enforces exact assignments, and exposes only approved publication', async () => {
    harness = await createApiHarness(clock(), {
      firstPartyContentEnabled: true,
      dailyContentDraftsEnabled: true,
    });
    const owner = await login(harness.app, 'hq-heidi', 'hq');
    const reviewer = await login(harness.app, 'hq-riley', 'hq');
    const support = await login(harness.app, 'hq-sam', 'hq');
    const ownerHeaders = browserHeaders(owner.cookie as string, hqOrigin);
    const reviewerHeaders = browserHeaders(reviewer.cookie as string, hqOrigin);
    const supportHeaders = browserHeaders(support.cookie as string, hqOrigin);

    const supportGeneration = await harness.app.inject({
      method: 'POST',
      url: '/v1/hq/content/generate',
      headers: supportHeaders,
      payload: { scheduleDate: '2026-08-28', limit: 1 },
    });
    expect(supportGeneration.statusCode).toBe(403);

    const generated = await harness.app.inject({
      method: 'POST',
      url: '/v1/hq/content/generate',
      headers: ownerHeaders,
      payload: { scheduleDate: '2026-08-28', limit: 1 },
    });
    expect(generated.statusCode).toBe(200);
    expect(generated.json()).toMatchObject({
      externalFetch: false,
      providerAction: false,
      publication: false,
      customerDataAccess: false,
    });
    const revisionId = generated.json<{ generatedRevisionIds: string[] }>()
      .generatedRevisionIds[0] as string;

    const beforePublication = await harness.app.inject({ method: 'GET', url: '/v1/public/learn' });
    expect(beforePublication.statusCode).toBe(200);
    expect(beforePublication.json()).toMatchObject({ articles: [] });

    const unassignedRead = await harness.app.inject({
      method: 'GET',
      url: `/v1/hq/content/drafts/${revisionId}/preview`,
      headers: reviewerHeaders,
    });
    expect(unassignedRead.statusCode).toBe(403);

    const opened = await harness.app.inject({
      method: 'GET',
      url: `/v1/hq/content/drafts/${revisionId}/preview`,
      headers: ownerHeaders,
    });
    expect(opened.statusCode).toBe(200);
    const exact = opened.json<{ documentDigest: string; slug: string }>();

    for (const role of ['skeptical', 'accessibility', 'privacy_rights'] as const) {
      const assignment = await harness.app.inject({
        method: 'POST',
        url: `/v1/hq/content/drafts/${revisionId}/assignments`,
        headers: reviewerHeaders,
        payload: { role, expectedDocumentDigest: exact.documentDigest },
      });
      expect(assignment.statusCode, assignment.body).toBe(200);
      const review = await harness.app.inject({
        method: 'POST',
        url: `/v1/hq/content/drafts/${revisionId}/reviews`,
        headers: reviewerHeaders,
        payload: {
          role,
          decision: 'approve',
          reason: `Approved exact ${role} review.`,
          expectedDocumentDigest: exact.documentDigest,
        },
      });
      expect(review.statusCode, review.body).toBe(200);
    }
    expect(
      (
        await harness.app.inject({
          method: 'POST',
          url: `/v1/hq/content/drafts/${revisionId}/assignments`,
          headers: reviewerHeaders,
          payload: { role: 'final_human', expectedDocumentDigest: exact.documentDigest },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await harness.app.inject({
          method: 'POST',
          url: `/v1/hq/content/drafts/${revisionId}/assignments`,
          headers: ownerHeaders,
          payload: { role: 'final_human', expectedDocumentDigest: exact.documentDigest },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await harness.app.inject({
          method: 'POST',
          url: `/v1/hq/content/drafts/${revisionId}/reviews`,
          headers: ownerHeaders,
          payload: {
            role: 'final_human',
            decision: 'approve',
            reason: 'Approved the exact final human revision.',
            expectedDocumentDigest: exact.documentDigest,
          },
        })
      ).statusCode,
    ).toBe(200);

    const publishHeaders = {
      ...ownerHeaders,
      'idempotency-key': 'governed-content:publish:10000000-0000-4000-8000-000000000001',
    };
    const publish = await harness.app.inject({
      method: 'POST',
      url: `/v1/hq/content/drafts/${revisionId}/publish`,
      headers: publishHeaders,
      payload: { expectedDocumentDigest: exact.documentDigest },
    });
    expect(publish.statusCode, publish.body).toBe(200);
    expect(publish.json()).toMatchObject({ result: 'published', idempotentReplay: false });
    const replay = await harness.app.inject({
      method: 'POST',
      url: `/v1/hq/content/drafts/${revisionId}/publish`,
      headers: publishHeaders,
      payload: { expectedDocumentDigest: exact.documentDigest },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ idempotentReplay: true });

    const article = await harness.app.inject({
      method: 'GET',
      url: `/v1/public/learn/${exact.slug}`,
    });
    expect(article.statusCode).toBe(200);
    expect(article.json()).toMatchObject({
      slug: exact.slug,
      documentDigest: exact.documentDigest,
    });
    expect(article.headers['cache-control']).toContain('public');
  });
});

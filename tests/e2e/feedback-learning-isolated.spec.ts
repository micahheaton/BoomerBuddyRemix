import { expect, test } from '@playwright/test';
import { hqUrl } from './helpers';

test('feedback browser reads are no-store and auth loss clears opened minimized text', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const observed: Array<{ readonly url: string; readonly cache?: RequestCache }> = [];
    Object.defineProperty(window, '__feedbackFetches', { value: observed, writable: false });
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/v1/hq/feedback')) {
        observed.push({ url, ...(init?.cache === undefined ? {} : { cache: init.cache }) });
      }
      return originalFetch(input, init);
    };
  });

  await page.route('**/v1/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        principal: {
          sessionId: 'feedback-browser-session',
          personId: 'person-hq-heidi',
          displayName: 'Heidi',
          audience: 'hq',
          roles: ['hq_owner'],
          households: [],
          expiresAt: '2026-08-18T12:00:00.000Z',
        },
      }),
    });
  });

  await page.route('**/v1/hq/feedback**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path.endsWith('/claim')) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'HQ authorization expired.' } }),
      });
      return;
    }
    if (path.endsWith('/content')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          feedbackId: 'feedback-browser-local',
          minimizedText: 'BROWSER-MINIMIZED-TEXT-MUST-CLEAR',
          redactionStatus: 'minimized_clean',
          evidenceTier: 'local_simulation',
          contentBoundary: 'assigned_minimized_text',
          externalActionExecuted: false,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        projection: 'owner_global_or_exact_assigned_feedback_metadata',
        contentIncluded: false,
        externalActionExecuted: false,
        feedback: [
          {
            id: 'feedback-browser-local',
            identityMode: 'authenticated',
            householdId: 'household-browser-local',
            sourceSurface: 'web_feedback_form',
            feedbackType: 'product_feedback',
            status: 'assigned',
            severity: 'unassessed',
            classification: 'unclassified',
            queue: 'new_feedback',
            routingState: 'assigned',
            redactionStatus: 'minimized_clean',
            closeLoopState: 'human_review_required',
            followUpConsented: false,
            researchRetentionConsented: false,
            evidenceTier: 'local_simulation',
            version: 3,
            createdAt: '2026-08-17T12:00:00.000Z',
            routedAt: '2026-08-17T12:00:00.000Z',
            assignedAt: '2026-08-17T12:00:00.000Z',
            contentReadAuthorized: true,
            selfClaimAvailable: true,
          },
        ],
      }),
    });
  });

  await page.goto(`${hqUrl}/feedback`);
  await page.getByRole('button', { name: 'Open minimized text' }).click();
  await expect(page.getByText('BROWSER-MINIMIZED-TEXT-MUST-CLEAR')).toBeVisible();
  await page.getByRole('button', { name: 'Claim exact review' }).click();
  await expect(page.getByText('HQ authorization expired.')).toBeVisible();
  await expect(page.getByText('BROWSER-MINIMIZED-TEXT-MUST-CLEAR')).toHaveCount(0);

  const observed = await page.evaluate(
    () =>
      (
        window as typeof window & {
          readonly __feedbackFetches: readonly {
            readonly url: string;
            readonly cache?: RequestCache;
          }[];
        }
      ).__feedbackFetches,
  );
  expect(observed.length).toBeGreaterThanOrEqual(3);
  expect(observed.every((request) => request.cache === 'no-store')).toBe(true);
});

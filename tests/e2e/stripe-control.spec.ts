import { expect, test } from '@playwright/test';

import { hqUrl, signInHq } from './helpers';

test('owner Stripe controls require exact typed confirmation and render only bounded evidence', async ({
  page,
}) => {
  await signInHq(page);
  let initiationMutation: Record<string, unknown> | undefined;
  await page.route('**/v1/hq/commerce/stripe/initiation-control*', async (route) => {
    if (route.request().method() === 'POST') {
      initiationMutation = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          environment: 'production',
          state: 'enabled',
          revision: 3,
          recordedAt: '2026-08-25T12:00:00.000Z',
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        environment: 'production',
        state: 'disabled',
        revision: 2,
        changedAt: '2026-08-25T11:00:00.000Z',
        reasonCode: 'founder_disable',
        liveEnableAvailable: true,
      }),
    });
  });
  await page.route('**/v1/hq/commerce/stripe/cohort-control*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        environment: 'production',
        state: 'active',
        maxActive: 1,
        policyExpiresAt: '2026-09-01T12:00:00.000Z',
        liveApproved: true,
        revision: 4,
        changedAt: '2026-08-25T10:00:00.000Z',
      }),
    });
  });
  await page.route('**/v1/hq/commerce/stripe/status*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        environment: 'production',
        preflight: {
          state: 'verified',
          checkedAt: '2026-08-25T09:00:00.000Z',
          evidenceLevel: 'live_production',
          authenticityKind: 'provider_read',
          transportKind: 'stripe_https',
          evidenceDigest: 'a'.repeat(64),
          checks: {
            accountReady: true,
            offerReady: true,
            portalReady: true,
            checkoutPolicyReady: true,
          },
        },
        eligibleHouseholds: [
          {
            householdId: 'household-exact-fixture',
            state: 'eligible',
            eligibilityExpiresAt: '2026-09-01T12:00:00.000Z',
            occurredAt: '2026-08-25T08:00:00.000Z',
          },
        ],
        evidence: [
          {
            kind: 'initiation_control',
            state: 'enabled_to_disabled',
            occurredAt: '2026-08-25T11:00:00.000Z',
            revision: 2,
            reasonCode: 'founder_disable',
          },
        ],
      }),
    });
  });

  await page.getByRole('link', { name: 'Stripe controls' }).click();
  await expect(page).toHaveURL(`${hqUrl}/stripe-control`);
  await expect(page.getByRole('heading', { name: 'Stripe control plane' })).toBeVisible();
  await expect(page.getByText('Persisted state: verified')).toBeVisible();
  await expect(page.getByText('Active persisted household: household-exact-fixture')).toBeVisible();
  await expect(page.locator('body')).toContainText('maximum one household');
  await expect(page.locator('body')).not.toContainText('apiRestrictedKey');

  await page.getByRole('button', { name: 'Record revision-safe initiation change' }).click();
  await expect(page.locator('.error[role="alert"]')).toContainText('ENABLE PRODUCTION CHECKOUT');
  expect(initiationMutation).toBeUndefined();

  await page.getByLabel('Type ENABLE PRODUCTION CHECKOUT').fill('ENABLE PRODUCTION CHECKOUT');
  await page.getByRole('button', { name: 'Record revision-safe initiation change' }).click();
  await expect
    .poll(() => initiationMutation)
    .toMatchObject({
      environment: 'production',
      nextState: 'enabled',
      expectedRevision: 2,
      reasonCode: 'founder_live_activation',
    });
});

import { expect, test } from '@playwright/test';

import { hqUrl, signInHq } from './helpers';

test('configured founder can review and record secret-free provisioning status without an external action', async ({
  page,
}) => {
  await signInHq(page);
  await page.getByRole('link', { name: 'Founder provisioning' }).click();
  await expect(page).toHaveURL(`${hqUrl}/provisioning`);
  await expect(page.getByRole('heading', { name: 'Founder provisioning' })).toBeVisible();
  await expect(page.locator('body')).toContainText(
    'Status is governance evidence, never activation',
  );
  await expect(page.locator('[aria-label="Provisioning status summary"]')).toContainText(
    'not started',
  );
  await expect(page.locator('[aria-label="Founder provisioning workstreams"] article')).toHaveCount(
    23,
  );
  await expect(page.locator('body')).toContainText('Account owner');
  await expect(page.locator('body')).toContainText('MFA / recovery owner');
  await expect(page.locator('body')).toContainText('Observed / recorded');
  await expect(page.locator('body')).toContainText('Retained manifest SHA-256');
  await expect(page.locator('body')).toContainText('BB_STRIPE_TEST_API_KEY');
  await expect(page.locator('body')).not.toContainText('sk_test_');
  await expect(page.locator('body')).not.toContainText('whsec_');

  await page.getByText('Record a bounded status transition').click();
  await page.getByRole('button', { name: 'Record status only — run no external action' }).click();
  await expect(page.getByRole('status')).toContainText('No adapter, payment, message, deployment');
  await expect(page.getByRole('status')).toContainText('external action ran');
});

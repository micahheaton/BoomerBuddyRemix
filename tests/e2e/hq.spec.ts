import { expect, request as requestFactory, test } from '@playwright/test';
import { apiUrl, customerUrl, hqUrl, signInHq } from './helpers';

test.beforeAll(async () => {
  const customer = await requestFactory.newContext({
    baseURL: apiUrl,
    extraHTTPHeaders: { Origin: customerUrl },
  });
  try {
    await customer.post('/v1/dev/sessions/customer', { data: { personaId: 'owner-alice' } });
    await customer.post('/v1/checks', {
      data: { kind: 'text', content: 'HQ-MUST-NEVER-SHOW-THIS-ARTIFACT' },
    });
  } finally {
    await customer.dispose();
  }
});

test('HQ labels local runtime provenance and excludes customer artifact content', async ({
  page,
}) => {
  await signInHq(page);
  await expect(page.getByText('Local development data (seed + this run)').first()).toBeVisible();
  await expect(page.locator('body')).toContainText('Nothing here is production evidence');

  await page.getByRole('link', { name: 'Fraud & review' }).click();
  await expect(page.getByRole('heading', { name: 'Fraud and review' })).toBeVisible();
  await expect(page.locator('body')).toContainText('Submitted artifact content is excluded');
  await expect(page.locator('body')).not.toContainText('HQ-MUST-NEVER-SHOW-THIS-ARTIFACT');
  await expect(page.getByText('Local development data (seed + this run)').first()).toBeVisible();

  await page.getByRole('link', { name: 'Revenue' }).click();
  await expect(page).toHaveURL(`${hqUrl}/revenue`);
  await expect(page.getByRole('heading', { name: 'Revenue workspace' })).toBeVisible();
  await expect(page.locator('body')).toContainText('not a live CRM or verified pipeline');
  await expect(page.getByText('Seeded research data').first()).toBeVisible();

  await page.getByRole('link', { name: 'System & audit' }).click();
  await expect(page.getByRole('heading', { name: 'System and audit' })).toBeVisible();
  await expect(page.locator('body')).toContainText('no artifact content');
});

test('HQ reviewer is routed to the review-only surface', async ({ page }) => {
  await page.goto(hqUrl);
  await page.getByLabel('HQ persona').selectOption('hq-riley');
  await page.getByRole('button', { name: 'Enter local HQ' }).click();
  await expect(page).toHaveURL(`${hqUrl}/fraud`);
  await expect(page.getByRole('heading', { name: 'Fraud and review' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Fraud & review' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Overview' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Customers' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Revenue' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'System & audit' })).toHaveCount(0);
});

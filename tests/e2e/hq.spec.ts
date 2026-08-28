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
  await expect(
    page.getByRole('heading', { name: 'Content-free operational health' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Worker heartbeats' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Durable jobs' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Outbox backlog' })).toBeVisible();
  await expect(page.locator('body')).toContainText('worker stale after 60 seconds');
  await expect(page.locator('body')).toContainText('no artifact content');
  await expect(page.locator('body')).not.toContainText('HQ-MUST-NEVER-SHOW-THIS-ARTIFACT');
});

test('HQ reviewer is routed to an assigned metadata-minimal review queue', async ({ page }) => {
  await page.goto(hqUrl);
  await page.getByLabel('HQ persona').selectOption('hq-riley');
  await page.getByRole('button', { name: 'Enter local HQ' }).click();
  await expect(page).toHaveURL(`${hqUrl}/fraud`);
  await expect(page.getByRole('heading', { name: 'Fraud and review' })).toBeVisible();
  await expect(page.getByText('case-seeded-riley-review')).toBeVisible();
  await expect(page.locator('body')).toContainText('Assigned-only projection');
  await expect(page.locator('body')).not.toContainText('Sunrise Household');
  await expect(page.locator('body')).not.toContainText('Harbor Household');
  await expect(page.locator('body')).not.toContainText('analysis-seed');
  await expect(page.getByRole('link', { name: 'Fraud & review' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Overview' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Customers' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Revenue' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'System & audit' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Founder provisioning' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Founding Households' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Assigned support' })).toHaveCount(0);
});

test('HQ support is routed to only its exact active assigned case', async ({ page }) => {
  await page.goto(hqUrl);
  await page.getByLabel('HQ persona').selectOption('hq-sam');
  await page.getByRole('button', { name: 'Enter local HQ' }).click();
  await expect(page).toHaveURL(`${hqUrl}/support`);
  await expect(page.getByRole('heading', { name: 'Assigned support' })).toBeVisible();
  await expect(page.getByText('support-case-seeded-sam')).toBeVisible();
  await expect(page.getByText('Sunrise Household')).toBeVisible();
  await expect(page.getByText('customer_support')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Resolve a synthetic navigation request');
  await expect(page.locator('body')).not.toContainText('Harbor Household');
  await expect(page.locator('body')).not.toContainText('analysis-seed');
  await expect(page.getByRole('link', { name: 'Assigned support' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Fraud & review' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Overview' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Customers' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'System & audit' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Founder provisioning' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Founding Households' })).toHaveCount(0);
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { customerUrl, hqUrl, signInCustomer, signInHq } from './helpers';

async function expectNoSeriousOrCriticalAxeViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );
  const details = blocking
    .flatMap((item) => [
      `${item.id}: ${item.help}`,
      ...item.nodes.map((node) => `  ${node.target.join(' > ')}: ${node.failureSummary ?? ''}`),
    ])
    .join('\n');
  expect(blocking, `${label}\n${details}`).toEqual([]);
}

async function gotoReady(page: Page, url: string, heading: string | RegExp): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
}

test('public landmark pages have zero serious or critical axe violations', async ({ page }) => {
  const pages = [
    ['/', /From suspicious to a safer next step/u],
    ['/how-it-works', 'A calmer way to handle something suspicious'],
    ['/pricing', 'Pricing is still a hypothesis'],
    ['/trust', 'Designed to show its limits'],
    ['/sign-in', 'Choose a seeded person'],
  ] as const;
  for (const [path, heading] of pages) {
    await gotoReady(page, `${customerUrl}${path}`, heading);
    await expectNoSeriousOrCriticalAxeViolations(page, `Customer ${path}`);
  }
});

test('member landmark pages have zero serious or critical axe violations', async ({ page }) => {
  await signInCustomer(page);
  const pages = [
    ['/member', /^Hello,/u],
    ['/member/check', 'Check something suspicious'],
    ['/member/history', 'Your check records'],
    ['/member/family', 'Your household and Trusted Circle'],
    ['/member/orientation', 'Orientation'],
    ['/member/founding-household', 'Review finite sponsored beta access'],
  ] as const;
  for (const [path, heading] of pages) {
    await gotoReady(page, `${customerUrl}${path}`, heading);
    await expectNoSeriousOrCriticalAxeViolations(page, `Customer ${path}`);
  }
});

test('HQ landmark pages have zero serious or critical axe violations', async ({ page }) => {
  await signInHq(page);
  await expectNoSeriousOrCriticalAxeViolations(page, 'HQ /');
  await gotoReady(page, `${hqUrl}/fraud`, 'Fraud and review');
  await expect(page.getByText('Content exclusion:', { exact: false })).toBeVisible();
  await expectNoSeriousOrCriticalAxeViolations(page, 'HQ /fraud');
  await gotoReady(page, `${hqUrl}/provisioning`, 'Founder provisioning');
  await expect(page.getByRole('region', { name: 'Provisioning status summary' })).toBeVisible();
  await expectNoSeriousOrCriticalAxeViolations(page, 'HQ /provisioning');
  await gotoReady(page, `${hqUrl}/founding-households`, 'Founding Households');
  await expect(page.getByRole('region', { name: 'Founding Household capacity' })).toBeVisible();
  await expectNoSeriousOrCriticalAxeViolations(page, 'HQ /founding-households');
});

test('keyboard focus, live result announcement, 200% zoom, and 320px reflow remain usable', async ({
  page,
}) => {
  await page.goto(customerUrl);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();

  await signInCustomer(page);
  await page.getByRole('link', { name: 'Check', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Check something suspicious' })).toBeVisible();
  await page.getByLabel('Suspicious message').fill('Synthetic urgency and gift card request');
  await page.getByRole('button', { name: 'Check it' }).click();
  const result = page.getByTestId('check-result');
  await expect(result).toHaveAttribute('aria-live', 'polite');
  await expect(result.getByRole('heading', { name: 'Check result' })).toBeFocused();

  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await expect(result.getByText('Calibration', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.zoom = '1';
  });

  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${customerUrl}/member/check`);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByRole('button', { name: 'Check it' })).toBeVisible();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const scrollBehavior = await page.evaluate(
    () => window.getComputedStyle(document.documentElement).scrollBehavior,
  );
  expect(scrollBehavior).toBe('auto');
});

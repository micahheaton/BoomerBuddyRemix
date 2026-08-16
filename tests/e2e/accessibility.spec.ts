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

test('public, member, and HQ landmark pages have zero serious or critical axe violations', async ({
  page,
}) => {
  for (const path of ['/', '/how-it-works', '/pricing', '/trust', '/sign-in']) {
    await page.goto(`${customerUrl}${path}`);
    await expectNoSeriousOrCriticalAxeViolations(page, `Customer ${path}`);
  }
  await signInCustomer(page);
  for (const path of [
    '/member',
    '/member/check',
    '/member/history',
    '/member/family',
    '/member/orientation',
  ]) {
    await page.goto(`${customerUrl}${path}`);
    await expectNoSeriousOrCriticalAxeViolations(page, `Customer ${path}`);
  }

  await signInHq(page);
  await expectNoSeriousOrCriticalAxeViolations(page, 'HQ /');
  await page.goto(`${hqUrl}/fraud`);
  await expectNoSeriousOrCriticalAxeViolations(page, 'HQ /fraud');
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

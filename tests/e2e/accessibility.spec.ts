import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import process from 'node:process';
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
    ['/check', 'Pause before you act.'],
    ['/how-it-works', 'A calmer way to handle something suspicious'],
    ['/pricing', 'One plan for invited early access'],
    ['/trust', 'Designed to show its limits'],
    ['/support', 'Get help with BoomerBuddy'],
    ['/privacy', 'BoomerBuddy privacy notice'],
    ['/terms', 'BoomerBuddy early-access terms'],
    ['/billing-terms', 'Family monthly subscription'],
    ['/accessibility', 'Accessibility at BoomerBuddy'],
    ['/account-deletion', 'Request account and data deletion'],
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
    ['/member', /^Hello,/u, 'Member home | BoomerBuddy'],
    ['/member/check', 'Check something suspicious', 'Check something suspicious | BoomerBuddy'],
    ['/member/history', 'Your check records', 'Check history | BoomerBuddy'],
    [
      '/member/family',
      'Your household and Trusted Circle',
      'Family and Trusted Circle | BoomerBuddy',
    ],
    [
      '/member/family/safe-word',
      'Family verification aid',
      'Family verification aid | BoomerBuddy',
    ],
    ['/member/orientation', 'Orientation', 'Orientation, Learn and updates | BoomerBuddy'],
  ] as const;
  for (const [path, heading, title] of pages) {
    await gotoReady(page, `${customerUrl}${path}`, heading);
    await expect(page).toHaveTitle(title);
    await expectNoSeriousOrCriticalAxeViolations(page, `Customer ${path}`);
  }
  await gotoReady(
    page,
    `${customerUrl}/member/founding-household`,
    'Review finite sponsored access',
  );
  await expectNoSeriousOrCriticalAxeViolations(page, 'Customer /member/founding-household');
});

test('HQ landmark pages have zero serious or critical axe violations', async ({ page }) => {
  await signInHq(page);
  await expectNoSeriousOrCriticalAxeViolations(page, 'HQ /');
  await gotoReady(page, `${hqUrl}/fraud`, 'Fraud and review');
  await expect(page.getByText('Content exclusion:', { exact: false })).toBeVisible();
  const checkMetadataTable = page.getByRole('region', {
    name: 'Scrollable check metadata review table',
  });
  await expect(checkMetadataTable).toHaveAttribute('tabindex', '0');
  await checkMetadataTable.focus();
  await expect(checkMetadataTable).toBeFocused();
  await expectNoSeriousOrCriticalAxeViolations(page, 'HQ /fraud');
  await gotoReady(page, `${hqUrl}/provisioning`, 'Founder provisioning');
  await expect(page.getByRole('region', { name: 'Provisioning status summary' })).toBeVisible();
  await expectNoSeriousOrCriticalAxeViolations(page, 'HQ /provisioning');
  await gotoReady(page, `${hqUrl}/founding-households`, 'Founding Households');
  await expect(page.getByRole('region', { name: 'Founding Household capacity' })).toBeVisible();
  await expectNoSeriousOrCriticalAxeViolations(page, 'HQ /founding-households');
});

test('keyboard focus, live result announcement, 200% zoom, and 320px reflow remain usable', async ({
  browserName,
  page,
}) => {
  await page.goto(customerUrl);
  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skipLink).toHaveAttribute('href', '#main-content');
  if (browserName === 'webkit' && process.platform === 'win32') {
    // Windows WebKit does not expose its host full-keyboard-access setting to Playwright.
    // Linux CI still proves real Tab reachability; this fallback proves activation locally.
    await skipLink.focus();
  } else {
    await page.keyboard.press('Tab');
  }
  await expect(skipLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${customerUrl}/#main-content`);
  await expect(page.locator('#main-content')).toBeInViewport();

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
  await expect(result.getByText('Important limit', { exact: true })).toBeVisible();
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

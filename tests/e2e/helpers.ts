import { expect, type Page } from '@playwright/test';

export const customerUrl = 'http://127.0.0.1:3100';
export const hqUrl = 'http://127.0.0.1:3101';
export const apiUrl = 'http://127.0.0.1:4100';

export async function signInCustomer(page: Page, personaId = 'owner-alice'): Promise<void> {
  await page.goto(`${customerUrl}/sign-in`);
  await page.getByLabel('Development persona').selectOption(personaId);
  await page.getByRole('button', { name: 'Enter local member area' }).click();
  await expect(page).toHaveURL(/\/member$/);
  await expect(page.getByRole('heading', { name: /Hello,/ })).toBeVisible();
}

export async function signOutCustomer(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
}

export async function signInHq(page: Page, personaId = 'hq-heidi'): Promise<void> {
  await page.goto(hqUrl);
  await page.getByLabel('HQ persona').selectOption(personaId);
  await page.getByRole('button', { name: 'Enter local HQ' }).click();
  await expect(page.getByRole('heading', { name: 'Owner operating view' })).toBeVisible();
}

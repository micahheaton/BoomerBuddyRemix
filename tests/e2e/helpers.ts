import type { BrowserSessionResponse, DevPersonaId } from '@boomerbuddy/contracts';
import { expect, type Page } from '@playwright/test';

type CustomerPersonaId = Exclude<DevPersonaId, `hq-${string}`>;

export const customerUrl = 'http://127.0.0.1:3100';
export const hqUrl = 'http://127.0.0.1:3101';
export const apiUrl = 'http://127.0.0.1:4100';

export async function signInCustomer(
  page: Page,
  personaId: CustomerPersonaId = 'owner-alice',
): Promise<void> {
  const expectedPersonId = `person-${personaId}`;
  await page.goto(`${customerUrl}/sign-in`);
  await page.getByLabel('Development persona').selectOption(personaId);
  await expect(page.getByLabel('Development persona')).toHaveValue(personaId);
  const sessionResponsePromise = page.waitForResponse(
    (response) =>
      response.url() === `${apiUrl}/v1/dev/sessions/customer` &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Enter local member area' }).click();
  const sessionResponse = await sessionResponsePromise;
  expect(sessionResponse.status()).toBe(201);
  const session = (await sessionResponse.json()) as BrowserSessionResponse;
  expect(session.principal.personId).toBe(expectedPersonId);
  await expect(page).toHaveURL(/\/member$/);
  await expect(
    page.getByRole('heading', { name: `Hello, ${session.principal.displayName}` }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const response = await page.request.get(`${apiUrl}/v1/me`, {
        headers: { Origin: customerUrl },
      });
      if (!response.ok()) return `status:${response.status()}`;
      const current = (await response.json()) as BrowserSessionResponse;
      return current.principal.personId;
    })
    .toBe(expectedPersonId);
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

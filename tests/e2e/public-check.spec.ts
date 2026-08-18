import { expect, test } from '@playwright/test';
import { apiUrl, customerUrl } from './helpers';

test('anonymous Public Check uses bounded attribution and saves only after explicit authentication', async ({
  page,
}) => {
  await page.goto(
    `${customerUrl}/check?source=partner&campaign=trusted_partner&utm_source=RAW-IGNORED-VALUE`,
  );
  await expect(page.getByRole('heading', { name: 'Pause before you act.' })).toBeVisible();
  await expect(page.getByText('No account or household is attached')).toBeVisible();

  const contextRequest = page.waitForRequest(
    (request) =>
      request.url() === `${apiUrl}/v1/public/check-contexts` && request.method() === 'POST',
  );
  const rawMarker = 'PUBLIC-RAW-ARTIFACT-MUST-NOT-RENDER';
  await page
    .getByLabel('Suspicious message')
    .fill(
      `${rawMarker}. Urgent: buy gift cards. Verification code 102345 and card 4242 4242 4242 4242.`,
    );
  await page.getByRole('button', { name: 'Check it' }).click();

  expect((await contextRequest).postDataJSON()).toEqual({
    attribution: { source: 'partner', campaign: 'trusted_partner' },
  });
  const result = page.getByTestId('public-check-result');
  await expect(result).toBeVisible();
  await expect(result).toContainText('Not calibrated');
  await expect(result).toContainText('Sensitive patterns removed');
  await expect(result).toContainText('[PAYMENT_CARD]');
  await expect(result).toContainText('[ONE_TIME_CODE]');
  await expect(page.getByLabel('Suspicious message')).toHaveValue('');
  await expect(page.locator('body')).not.toContainText(rawMarker);
  await expect(page.locator('body')).not.toContainText('RAW-IGNORED-VALUE');

  await page.getByRole('button', { name: 'Save with my consent' }).click();
  await expect(page.getByText('Sign in in another tab')).toBeVisible();

  const signedIn = await page.request.post(`${apiUrl}/v1/dev/sessions/customer`, {
    headers: { Origin: customerUrl },
    data: { personaId: 'owner-alice' },
  });
  expect(signedIn.ok()).toBeTruthy();

  await page.getByRole('button', { name: 'Save with my consent' }).click();
  await expect(page.getByRole('button', { name: 'Saved to active household' })).toBeDisabled();
  await expect(result).toContainText(
    'Retrying the same save for the same owner and consent returns this one saved Check.',
  );
});

test('Public Check strips an existing session and household scope from anonymous requests', async ({
  page,
}) => {
  const signedIn = await page.request.post(`${apiUrl}/v1/dev/sessions/customer`, {
    headers: { Origin: customerUrl },
    data: { personaId: 'owner-alice' },
  });
  expect(signedIn.ok()).toBeTruthy();
  await page.goto(`${customerUrl}/check`);
  await page.evaluate(() => {
    window.sessionStorage.setItem('boomerbuddy.selected-household', 'household-sunrise');
  });

  const contextRequest = page.waitForRequest(
    (request) =>
      request.url() === `${apiUrl}/v1/public/check-contexts` && request.method() === 'POST',
  );
  const checkRequest = page.waitForRequest(
    (request) => request.url() === `${apiUrl}/v1/public/checks` && request.method() === 'POST',
  );
  await page.getByLabel('Suspicious message').fill('Synthetic anonymous scope-boundary check');
  await page.getByRole('button', { name: 'Check it' }).click();
  await expect(page.getByTestId('public-check-result')).toBeVisible();

  for (const request of [await contextRequest, await checkRequest]) {
    const headers = request.headers();
    expect(headers.cookie).toBeUndefined();
    expect(headers['x-bb-household-id']).toBeUndefined();
  }
});

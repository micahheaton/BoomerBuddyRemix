import { expect, request as requestFactory, test } from '@playwright/test';
import { apiUrl, customerUrl, signInCustomer } from './helpers';

test('login, text and URL checks, history, and user deletion work end to end', async ({ page }) => {
  await signInCustomer(page);
  const localAccess = page.getByTestId('local-access-summary');
  await expect(localAccess).toContainText('Local access hypothesis');
  await expect(localAccess).toContainText(
    'The features you can use depend on this household, your role, and each person',
  );
  await expect(localAccess).toContainText('Protected adults');
  await expect(localAccess).toContainText('Trusted Circle participants');
  await page.getByRole('link', { name: 'Check', exact: true }).click();

  await page
    .getByLabel('Suspicious message')
    .fill('Urgent: buy gift cards now and send the codes. Keep this secret.');
  await page.getByRole('button', { name: 'Check it' }).click();
  const textResult = page.getByTestId('check-result');
  await expect(textResult).toBeVisible();
  await expect(textResult).toContainText('Important limit');
  await expect(textResult).toContainText('This result can be wrong');
  await expect(textResult).toContainText('decision support, not proof');
  await expect(textResult.getByRole('heading', { name: 'Check result' })).toBeFocused();
  await expect(textResult).toContainText('No active relationship currently has permission');
  await expect(textResult.getByRole('button', { name: /Share with/ })).toHaveCount(0);

  await page.getByLabel('Website address').check();
  await page.getByLabel('Website address (URL)').fill('https://account-alert.example.test/verify');
  await page.getByRole('button', { name: 'Check it' }).click();
  await expect(page.getByTestId('check-result')).toContainText(
    'No live reputation provider is configured; no URL or external resource was contacted.',
  );

  await page.getByRole('link', { name: 'History', exact: true }).click();
  const history = page.getByTestId('check-history');
  await expect(history).toContainText('Message text');
  await expect(history).toContainText('Website address');
  await expect(history).not.toContainText('buy gift cards now');

  const before = await history.locator('li').count();
  await history.getByRole('button', { name: 'Delete record' }).first().click();
  await history.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(history.locator('li')).toHaveCount(before - 1);
});

test('history loads additional pages without duplicate records', async ({ page }) => {
  await signInCustomer(page, 'owner-alice');
  for (let index = 0; index < 51; index += 1) {
    const created = await page.request.post(`${apiUrl}/v1/checks`, {
      headers: { Origin: customerUrl },
      data: { kind: 'text', content: `Synthetic pagination record ${index + 1}` },
    });
    expect(created.ok()).toBeTruthy();
  }

  await page.getByRole('link', { name: 'History', exact: true }).click();
  const history = page.getByTestId('check-history');
  await expect(history.locator(':scope > li')).toHaveCount(50);
  await page.getByRole('button', { name: 'Load more history' }).click();
  const rows = history.locator(':scope > li');
  await expect(rows).not.toHaveCount(50);
  const ids = await rows.evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-check-id')).filter(Boolean),
  );
  expect(ids.length).toBeGreaterThan(50);
  expect(new Set(ids).size).toBe(ids.length);
  await expect(page.getByText(/Showing \d+ of \d+ available check records/)).toBeVisible();
});

test('a direct cross-household check read is denied', async () => {
  const alice = await requestFactory.newContext({
    baseURL: apiUrl,
    extraHTTPHeaders: { Origin: customerUrl },
  });
  const bob = await requestFactory.newContext({
    baseURL: apiUrl,
    extraHTTPHeaders: { Origin: customerUrl },
  });
  try {
    expect(
      (await alice.post('/v1/dev/sessions/customer', { data: { personaId: 'owner-alice' } })).ok(),
    ).toBeTruthy();
    const created = await alice.post('/v1/checks', {
      data: { kind: 'text', content: 'Unique cross-household boundary check' },
    });
    expect(created.ok()).toBeTruthy();
    const body = (await created.json()) as { check: { id: string } };

    const forbiddenShare = await alice.post(
      `/v1/checks/${encodeURIComponent(body.check.id)}/shares`,
      {
        data: { sharedWithPersonId: 'person-trusted-terry' },
      },
    );
    expect(forbiddenShare.status()).toBe(403);

    expect(
      (await bob.post('/v1/dev/sessions/customer', { data: { personaId: 'owner-bob' } })).ok(),
    ).toBeTruthy();
    const denied = await bob.get(`/v1/checks/${encodeURIComponent(body.check.id)}`);
    expect([403, 404]).toContain(denied.status());
  } finally {
    await alice.dispose();
    await bob.dispose();
  }
});

test('sharing state is scoped to one result and resets for the next check', async ({ page }) => {
  await signInCustomer(page, 'protected-pat');
  await page.getByRole('link', { name: 'Check', exact: true }).click();
  await page.getByLabel('Suspicious message').fill('First local sharing-state check');
  await page.getByRole('button', { name: 'Check it' }).click();
  const firstResult = page.getByTestId('check-result');
  await firstResult.getByRole('button', { name: 'Ask Terry Trusted to review' }).click();
  await expect(
    firstResult.getByRole('button', { name: 'Help requested from Terry Trusted' }),
  ).toBeDisabled();
  await expect(firstResult).toContainText('No notification was sent');

  await page.getByLabel('Suspicious message').fill('Second local sharing-state check');
  await page.getByRole('button', { name: 'Check it' }).click();
  const secondResult = page.getByTestId('check-result');
  await expect(
    secondResult.getByRole('button', { name: 'Ask Terry Trusted to review' }),
  ).toBeEnabled();
  await expect(secondResult).not.toContainText('Help requested from Terry Trusted in BoomerBuddy');
});

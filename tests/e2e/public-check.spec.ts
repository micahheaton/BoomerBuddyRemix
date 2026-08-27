import { expect, request as requestFactory, test } from '@playwright/test';
import { apiUrl, customerUrl } from './helpers';

test('anonymous Public Check uses bounded attribution and saves only after explicit authentication', async ({
  page,
}) => {
  await page.goto(
    `${customerUrl}/check?source=partner&campaign=trusted_partner&utm_source=RAW-IGNORED-VALUE`,
  );
  await expect(page.getByRole('heading', { name: 'Pause before you act.' })).toBeVisible();
  await expect(page).toHaveURL(`${customerUrl}/check`);
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
  await expect(result).toContainText('This result can be wrong');
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
    'trying again returns this same saved Check instead of creating another.',
  );
});

test('Public Check defaults unrecognized attribution labels and clears them from history', async ({
  page,
}) => {
  const sourceMarker = 'RAW-SOURCE-MUST-NOT-PERSIST';
  const campaignMarker = 'RAW-CAMPAIGN-MUST-NOT-PERSIST';
  await page.goto(
    `${customerUrl}/check?source=${sourceMarker}&campaign=${campaignMarker}&ignored=RAW-IGNORED`,
  );
  await expect(page).toHaveURL(`${customerUrl}/check`);

  const contextRequest = page.waitForRequest(
    (request) =>
      request.url() === `${apiUrl}/v1/public/check-contexts` && request.method() === 'POST',
  );
  await page.getByLabel('Suspicious message').fill('Synthetic bounded attribution check');
  await page.getByRole('button', { name: 'Check it' }).click();

  const request = await contextRequest;
  expect(request.postDataJSON()).toEqual({
    attribution: { source: 'direct', campaign: 'none' },
  });
  expect(request.postData()).not.toContain(sourceMarker);
  expect(request.postData()).not.toContain(campaignMarker);
  await expect(page.locator('body')).not.toContainText(sourceMarker);
  await expect(page.locator('body')).not.toContainText(campaignMarker);
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

test('Public Check sign-in handoff lets a multi-household member choose the save scope', async ({
  page,
}) => {
  const pat = await requestFactory.newContext({
    baseURL: apiUrl,
    extraHTTPHeaders: { Origin: customerUrl },
  });
  const olivia = await requestFactory.newContext({
    baseURL: apiUrl,
    extraHTTPHeaders: { Origin: customerUrl },
  });
  try {
    expect(
      (await pat.post('/v1/dev/sessions/customer', { data: { personaId: 'protected-pat' } })).ok(),
    ).toBeTruthy();
    const patMe = (await (await pat.get('/v1/me')).json()) as {
      principal: { households: Array<{ id: string }> };
    };
    const sunriseId = patMe.principal.households[0]!.id;
    const invited = await pat.post('/v1/family/invitations', {
      headers: { 'X-BB-Household-Id': sunriseId },
      data: {
        inviteeDisplayName: 'Olivia public save choice',
        permissions: ['view_shared_checks'],
      },
    });
    expect(invited.ok()).toBeTruthy();
    const invitation = (await invited.json()) as {
      invitation: { id: string };
      localInviteCode: string;
    };

    expect(
      (
        await olivia.post('/v1/dev/sessions/customer', {
          data: { personaId: 'protected-olivia' },
        })
      ).ok(),
    ).toBeTruthy();
    const preview = await olivia.post(
      `/v1/family/invitations/${invitation.invitation.id}/preview`,
      { data: { localInviteCode: invitation.localInviteCode } },
    );
    expect(preview.ok()).toBeTruthy();
    const previewBody = (await preview.json()) as { invitation: { previewVersion: string } };
    const accepted = await olivia.post(
      `/v1/family/invitations/${invitation.invitation.id}/accept`,
      {
        data: {
          localInviteCode: invitation.localInviteCode,
          previewVersion: previewBody.invitation.previewVersion,
        },
      },
    );
    expect(accepted.ok()).toBeTruthy();
    const oliviaMe = (await (await olivia.get('/v1/me')).json()) as {
      principal: { households: Array<{ id: string; isProtectedMember: boolean }> };
    };
    const harborId = oliviaMe.principal.households.find(
      (household) => household.isProtectedMember,
    )?.id;
    expect(harborId).toBeTruthy();

    await page.goto(`${customerUrl}/check`);
    await page.getByLabel('Suspicious message').fill('Synthetic multi-household save handoff');
    await page.getByRole('button', { name: 'Check it' }).click();
    await expect(page.getByTestId('public-check-result')).toBeVisible();
    await page.getByRole('button', { name: 'Save with my consent' }).click();
    await expect(page.getByText('Sign in in another tab')).toBeVisible();

    const signedIn = await page.request.post(`${apiUrl}/v1/dev/sessions/customer`, {
      headers: { Origin: customerUrl },
      data: { personaId: 'protected-olivia' },
    });
    expect(signedIn.ok()).toBeTruthy();
    await page.getByRole('button', { name: 'Save with my consent' }).click();

    const selector = page.getByLabel('Household for this saved Check');
    await expect(selector).toBeVisible();
    await expect(page.getByTestId('public-check-result')).toBeVisible();
    await expect(selector.locator(`option[value="${sunriseId}"]`)).toHaveCount(0);
    await selector.selectOption(harborId!);
    await page.getByRole('button', { name: 'Save with my consent' }).click();
    await expect(page.getByRole('button', { name: 'Saved to active household' })).toBeDisabled();
  } finally {
    await Promise.all([pat.dispose(), olivia.dispose()]);
  }
});

import { expect, test, type Route } from '@playwright/test';
import { createHash } from 'node:crypto';

import { customerUrl, hqUrl, signInCustomer, signInHq } from './helpers';

test('founder issues one local no-card credential and a household admin accepts explicit service-only terms', async ({
  page,
}) => {
  await signInHq(page);
  await page.getByRole('link', { name: 'Founding Households' }).click();
  await expect(page).toHaveURL(`${hqUrl}/founding-households`);
  await expect(page.getByRole('heading', { name: 'Founding Households' })).toBeVisible();
  await expect(page.locator('body')).toContainText('Founder-only; no card and no delivery adapter');

  await page.getByText('Configure the finite local cohort policy').click();
  await page.getByLabel('Hard program end').fill('2026-10-01T12:00');
  const policyKeys: string[] = [];
  let dropPolicyResponse = true;
  await page.route('**/v1/hq/founding-households/policy', async (route) => {
    policyKeys.push((await route.request().headerValue('idempotency-key')) ?? '');
    const response = await route.fetch();
    if (dropPolicyResponse) {
      dropPolicyResponse = false;
      await route.abort('connectionfailed');
      return;
    }
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Record active local policy' }).click();
  await expect(page.locator('.error[role="alert"]')).toBeVisible();
  await page.getByRole('button', { name: 'Record active local policy' }).click();
  await expect(page.getByRole('status')).toContainText('No invitation, message, payment');
  expect(policyKeys).toHaveLength(2);
  expect(policyKeys[1]).toBe(policyKeys[0]);

  const invitationKeys: string[] = [];
  let dropInvitationResponse = true;
  await page.route('**/v1/hq/founding-households/invitations', async (route) => {
    invitationKeys.push((await route.request().headerValue('idempotency-key')) ?? '');
    const response = await route.fetch();
    if (dropInvitationResponse) {
      dropInvitationResponse = false;
      await route.abort('connectionfailed');
      return;
    }
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Issue one manual-delivery credential' }).click();
  await expect(page.locator('.error[role="alert"]')).toBeVisible();
  await page.getByRole('button', { name: 'Issue one manual-delivery credential' }).click();
  await expect(page.locator('.error[role="alert"]')).toContainText(
    'Credential recovery is impossible',
  );
  expect(invitationKeys).toHaveLength(2);
  expect(invitationKeys[1]).toBe(invitationKeys[0]);

  const revokeKeys: string[] = [];
  let dropRevokeResponse = true;
  await page.route('**/v1/hq/founding-households/invitations/*/revoke', async (route) => {
    revokeKeys.push((await route.request().headerValue('idempotency-key')) ?? '');
    const response = await route.fetch();
    if (dropRevokeResponse) {
      dropRevokeResponse = false;
      await route.abort('connectionfailed');
      return;
    }
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Revoke and zeroize' }).click();
  await expect(
    page.locator('.error[role="alert"]').filter({ hasText: 'Failed to fetch' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Revoke and zeroize' }).click();
  await expect(page.getByRole('status')).toContainText('revoked');
  expect(revokeKeys).toHaveLength(2);
  expect(revokeKeys[1]).toBe(revokeKeys[0]);

  await page.getByRole('button', { name: 'Issue one manual-delivery credential' }).click();
  expect(invitationKeys).toHaveLength(3);
  expect(invitationKeys[2]).not.toBe(invitationKeys[1]);
  const credential = await page
    .getByRole('region', { name: 'One-time invitation credential' })
    .locator('code')
    .textContent();
  expect(credential).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u);
  await expect(page.locator('body')).toContainText('has not been emailed, texted, logged');

  await signInCustomer(page, 'owner-bob');
  await page.getByRole('link', { name: 'Open Founding Household review' }).click();
  await expect(page).toHaveURL(`${customerUrl}/member/founding-household`);
  await expect(
    page.getByRole('heading', { name: 'Review finite sponsored beta access' }),
  ).toBeVisible();
  await page.getByLabel('Complete invitation credential').fill(credential as string);
  const previewResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/v1/founding-households/invitations/') &&
      response.url().endsWith('/preview'),
  );
  await page.getByRole('button', { name: 'Review invitation - grant nothing yet' }).click();
  const previewPayload = (await (await previewResponsePromise).json()) as Record<string, string>;
  const renderedServiceDisclosure = previewPayload.serviceDisclosureText;
  if (renderedServiceDisclosure === undefined) {
    throw new Error('Founding Household preview omitted the service disclosure');
  }
  await expect(page.getByRole('heading', { name: 'Founding Family beta' })).toBeVisible();
  await expect(page.locator('body')).toContainText('Research requested: no');
  await expect(page.locator('body')).toContainText('Marketing requested: no');
  await expect(page.locator('body')).toContainText('Follow-up requested: no');

  const serviceText = await page
    .getByRole('region', { name: /Service disclosure/u })
    .locator('p')
    .allTextContents();
  const protectedText = await page
    .getByRole('region', { name: /Protected-adult disclosure/u })
    .locator('p')
    .allTextContents();
  expect(serviceText).toEqual([
    previewPayload.serviceDisclosureText,
    previewPayload.servicePolicyText,
  ]);
  expect(protectedText).toEqual([
    previewPayload.protectedEnrollmentDisclosureText,
    previewPayload.protectedEnrollmentPolicyText,
  ]);
  expect(
    createHash('sha256')
      .update(serviceText[0] as string)
      .digest('hex'),
  ).toBe(previewPayload.serviceDisclosureDigest);
  expect(
    createHash('sha256')
      .update(serviceText[1] as string)
      .digest('hex'),
  ).toBe(previewPayload.servicePolicyDigest);
  expect(
    createHash('sha256')
      .update(protectedText[0] as string)
      .digest('hex'),
  ).toBe(previewPayload.protectedEnrollmentDisclosureDigest);
  expect(
    createHash('sha256')
      .update(protectedText[1] as string)
      .digest('hex'),
  ).toBe(previewPayload.protectedEnrollmentPolicyDigest);
  expect(serviceText.join(' ')).toContain('To operate this bounded cohort');
  await page.getByLabel(/I accept the exact service disclosure and policy rendered above/u).check();
  await page
    .getByLabel(/I separately accept the exact protected-adult disclosure and policy rendered/u)
    .check();
  const acceptPattern = '**/v1/founding-households/invitations/*/accept';
  const authLossHandler = async (route: Route) => {
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'not_authorized',
          message: 'The household authorization is no longer current.',
          requestId: 'request-browser-auth-loss',
        },
      }),
    });
  };
  await page.route(acceptPattern, authLossHandler);
  await page.getByRole('button', { name: 'Accept finite sponsored beta - no card' }).click();
  await expect(page.locator('.error[role="alert"]')).toContainText(
    'Household authorization was lost',
  );
  await expect(page.getByLabel('Complete invitation credential')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(renderedServiceDisclosure);
  await page.unroute(acceptPattern, authLossHandler);

  await signInCustomer(page, 'owner-bob');
  await page.getByRole('link', { name: 'Open Founding Household review' }).click();
  await page.getByLabel('Complete invitation credential').fill(credential as string);
  await page.getByRole('button', { name: 'Review invitation - grant nothing yet' }).click();
  await page.getByLabel(/I accept the exact service disclosure and policy rendered above/u).check();
  await page
    .getByLabel(/I separately accept the exact protected-adult disclosure and policy rendered/u)
    .check();
  const acceptKeys: string[] = [];
  const acceptBodies: Record<string, unknown>[] = [];
  let dropAcceptResponse = true;
  await page.route(acceptPattern, async (route) => {
    acceptKeys.push((await route.request().headerValue('idempotency-key')) ?? '');
    acceptBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    const response = await route.fetch();
    if (dropAcceptResponse) {
      dropAcceptResponse = false;
      await route.abort('connectionfailed');
      return;
    }
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Accept finite sponsored beta - no card' }).click();
  await expect(page.locator('.error[role="alert"]')).toBeVisible();
  await page.getByRole('button', { name: 'Accept finite sponsored beta - no card' }).click();
  await expect(page.getByRole('status')).toContainText('No card was used');
  expect(acceptKeys).toHaveLength(2);
  expect(acceptKeys[1]).toBe(acceptKeys[0]);
  expect(acceptBodies[1]).toMatchObject({
    serviceDisclosureDigest: previewPayload.serviceDisclosureDigest,
    servicePolicyDigest: previewPayload.servicePolicyDigest,
    protectedEnrollmentDisclosureDigest: previewPayload.protectedEnrollmentDisclosureDigest,
    protectedEnrollmentPolicyDigest: previewPayload.protectedEnrollmentPolicyDigest,
  });
  await expect(page.locator('body')).toContainText('not paid sponsored beta');
  await expect(page.locator('body')).toContainText('Research consent: no');
  await expect(page.locator('body')).toContainText('service value confirmed: not observed');

  const withdrawalKeys: string[] = [];
  let dropWithdrawalResponse = true;
  await page.route('**/v1/founding-households/offboard', async (route) => {
    withdrawalKeys.push((await route.request().headerValue('idempotency-key')) ?? '');
    const response = await route.fetch();
    if (dropWithdrawalResponse) {
      dropWithdrawalResponse = false;
      await route.abort('connectionfailed');
      return;
    }
    await route.fulfill({ response });
  });
  await page.getByLabel(/Withdraw service consent and end this sponsored access/u).check();
  await page.getByRole('button', { name: 'End sponsored access' }).click();
  await expect(page.locator('.error[role="alert"]')).toBeVisible();
  await page.getByRole('button', { name: 'End sponsored access' }).click();
  await expect(page.getByRole('status')).toContainText('service consent was withdrawn');
  expect(withdrawalKeys).toHaveLength(2);
  expect(withdrawalKeys[1]).toBe(withdrawalKeys[0]);
});

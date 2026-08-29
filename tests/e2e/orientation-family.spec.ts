import { expect, request as requestFactory, test } from '@playwright/test';
import { apiUrl, customerUrl, signInCustomer, signOutCustomer } from './helpers';

test('independent protected enrollment gates owner workflows', async ({ page }) => {
  await signInCustomer(page, 'owner-alice');
  const protectedOwnerMe = (await (
    await page.request.get(`${apiUrl}/v1/me`, { headers: { Origin: customerUrl } })
  ).json()) as {
    principal: {
      households: Array<{
        id: string;
        isAdministrator: boolean;
        isProtectedMember: boolean;
      }>;
    };
  };
  const sunrise = protectedOwnerMe.principal.households[0]!;
  expect(sunrise).toMatchObject({ isAdministrator: true, isProtectedMember: true });
  await expect(page.getByRole('link', { name: 'Check', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue orientation', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Family', exact: true }).click();
  await expect(page.getByLabel('Trusted person’s display name')).toBeVisible();

  await signOutCustomer(page);
  await signInCustomer(page, 'owner-bob');
  const unallocatedOwnerMe = (await (
    await page.request.get(`${apiUrl}/v1/me`, { headers: { Origin: customerUrl } })
  ).json()) as {
    principal: {
      households: Array<{
        id: string;
        isAdministrator: boolean;
        isProtectedMember: boolean;
      }>;
    };
  };
  const harbor = unallocatedOwnerMe.principal.households[0]!;
  expect(harbor).toMatchObject({ isAdministrator: true, isProtectedMember: false });
  await expect(page.getByRole('link', { name: 'Check', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Continue orientation', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('link', { name: 'Family', exact: true }).click();
  await expect(page.getByLabel('Trusted person’s display name')).toHaveCount(0);

  const deniedCheck = await page.request.post(`${apiUrl}/v1/checks`, {
    headers: { Origin: customerUrl, 'X-BB-Household-Id': harbor.id },
    data: { kind: 'text', content: 'Unallocated owner must not create this check.' },
  });
  expect(deniedCheck.status()).toBe(403);
  const deniedOrientation = await page.request.get(`${apiUrl}/v1/orientation`, {
    headers: { Origin: customerUrl, 'X-BB-Household-Id': harbor.id },
  });
  expect(deniedOrientation.status()).toBe(403);

  await page.goto(`${customerUrl}/member/check`);
  await expect(
    page.getByRole('heading', { name: 'Check unavailable in this household' }),
  ).toBeVisible();
  await expect(page.getByLabel('Suspicious message')).toHaveCount(0);
  await page.goto(`${customerUrl}/member/orientation`);
  await expect(
    page.getByRole('heading', { name: 'Orientation unavailable in this household' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start orientation' })).toHaveCount(0);
});

test('guided orientation requires the safer synthetic practice response', async ({ page }) => {
  await signInCustomer(page, 'owner-alice');
  await page.getByRole('link', { name: 'Continue orientation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Orientation' })).toBeVisible();

  await page.getByRole('button', { name: 'Start orientation' }).click();

  for (const key of ['protection_subject', 'trusted_circle'] as const) {
    const step = page.locator(`[data-orientation-step="${key}"]`);
    await step.getByRole('button', { name: 'Mark this step complete' }).click();
    await expect(step).toContainText('complete');
  }

  const safeWord = page.locator('[data-orientation-step="safe_word"]');
  await safeWord.getByRole('button', { name: 'Defer after reading this' }).click();
  await expect(safeWord).toContainText('complete');

  const practice = page.locator('[data-orientation-step="practice_check"]');
  const complete = practice.getByRole('button', { name: 'Complete the practice step' });
  await expect(complete).toBeDisabled();
  await practice.getByLabel(/Open the link quickly/).check();
  await expect(practice.getByRole('alert')).toContainText('could be part of the scam');
  await expect(complete).toBeDisabled();
  await practice.getByLabel(/independently/).check();
  await expect(complete).toBeEnabled();
  await complete.click();
  await expect(practice).toContainText('complete');

  for (const key of ['capabilities_and_limits', 'review'] as const) {
    const step = page.locator(`[data-orientation-step="${key}"]`);
    await step.getByRole('button', { name: 'Mark this step complete' }).click();
    await expect(step).toContainText('complete');
  }
  await expect(page.getByRole('heading', { name: 'Orientation ready' })).toBeVisible();
});

test('invitation review can be declined and a cancelled code cannot be reused', async ({
  page,
}) => {
  await signInCustomer(page, 'protected-pat');
  await page.getByRole('link', { name: 'Family', exact: true }).click();
  await page.getByLabel('Trusted person’s display name').fill('Jordan cancelled invitation');
  await page.getByRole('checkbox', { name: /I choose to invite this exact person/u }).check();
  await page.getByRole('button', { name: 'Create invitation' }).click();
  const created = page.getByTestId('invite-created');
  const invitationId = (await created.locator('.invite-id').textContent())!.trim();
  const inviteCode = (await created.locator('.invite-code').textContent())!.trim();

  await signOutCustomer(page);
  await signInCustomer(page, 'trusted-jordan');
  await expect(page.getByText(/For this local test, ask the protected member/u)).toBeVisible();
  await expect(
    page.getByText(/Create and keep your own temporary connection code in Family/u),
  ).toHaveCount(0);
  await page.getByRole('link', { name: 'Family', exact: true }).click();
  await expect(
    page.getByText(/Enter the invitation ID and separate one-time credential/u),
  ).toBeVisible();
  await expect(page.getByText(/In production, use/u)).toHaveCount(0);
  await page.getByLabel('Invitation ID').fill(invitationId);
  await page.getByLabel('One-time invitation credential').fill(inviteCode);
  await page.getByRole('button', { name: 'Review invitation' }).click();
  const preview = page.getByTestId('invitation-preview');
  await expect(preview).toContainText('Sunrise Household');
  await expect(preview).toContainText('Pat Protected');
  await expect(preview).toContainText('View checks that are deliberately shared');
  await expect(preview.getByRole('button', { name: 'Accept invitation' })).toBeDisabled();
  await preview.getByRole('button', { name: 'Cancel without accepting' }).click();
  await expect(page.getByText(/No household access/)).toBeVisible();

  await signOutCustomer(page);
  await signInCustomer(page, 'trusted-terry');
  await page.getByRole('link', { name: 'Family', exact: true }).click();
  await expect(page.getByText('Jordan cancelled invitation')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel invitation' })).toHaveCount(0);

  await signOutCustomer(page);
  await signInCustomer(page, 'protected-pat');
  await page.getByRole('link', { name: 'Family', exact: true }).click();
  const pending = page.locator('li').filter({ hasText: 'Jordan cancelled invitation' });
  await pending.getByRole('button', { name: 'Cancel invitation' }).click();
  await pending.getByRole('button', { name: 'Yes, cancel invitation' }).click();
  await expect(page.getByText(/one-time code can no longer be used/i)).toBeVisible();

  await signOutCustomer(page);
  await signInCustomer(page, 'trusted-jordan');
  await page.getByRole('link', { name: 'Family', exact: true }).click();
  await page.getByLabel('Invitation ID').fill(invitationId);
  await page.getByLabel('One-time invitation credential').fill(inviteCode);
  await page.getByRole('button', { name: 'Review invitation' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Invitation is invalid or unavailable' }),
  ).toBeVisible();
});

test('an invitation handoff link fills only the ID and still requires separate review', async ({
  page,
}) => {
  await signInCustomer(page, 'trusted-jordan');
  await page.goto(
    `${customerUrl}/member/family?trustedInvitation=invitation-handoff-test#accept-trusted-invitation`,
  );

  await expect(page.getByLabel('Invitation ID')).toHaveValue('invitation-handoff-test');
  await expect(page.getByLabel('One-time invitation credential')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Review invitation' })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('The link never contains a connection code');
  await expect(page.getByText(/Invitation consent details/u)).toHaveCount(0);
});

test('Trusted Circle lifecycle revokes sharing while retaining a discoverable neutral membership exit', async ({
  page,
}) => {
  await signInCustomer(page, 'protected-pat');
  const protectedMeResponse = await page.request.get(`${apiUrl}/v1/me`, {
    headers: { Origin: customerUrl },
  });
  const protectedMe = (await protectedMeResponse.json()) as {
    principal: { households: Array<{ id: string; isProtectedMember: boolean }> };
  };
  const sunriseId = protectedMe.principal.households.find((scope) => scope.isProtectedMember)?.id;
  expect(sunriseId).toBeTruthy();
  await page
    .getByLabel('Member navigation')
    .getByRole('link', { name: 'Family', exact: true })
    .click();
  await page.getByLabel('Trusted person’s display name').fill('Jordan E2E');
  await page.getByRole('checkbox', { name: /I choose to invite this exact person/u }).check();
  await page.getByRole('button', { name: 'Create invitation' }).click();
  const created = page.getByTestId('invite-created');
  await expect(created).toBeVisible();
  const invitationId = (await created.locator('.invite-id').textContent())?.trim();
  const inviteCode = (await created.locator('.invite-code').textContent())?.trim();
  expect(invitationId).toBeTruthy();
  expect(inviteCode?.length).toBeGreaterThanOrEqual(24);

  await signOutCustomer(page);
  await signInCustomer(page, 'trusted-jordan');
  await page.getByRole('link', { name: 'Family', exact: true }).click();
  await page.getByLabel('Invitation ID').fill(invitationId!);
  await page.getByLabel('One-time invitation credential').fill(inviteCode!);
  await page.getByRole('button', { name: 'Review invitation' }).click();
  const preview = page.getByTestId('invitation-preview');
  await expect(preview).toContainText('Sunrise Household');
  await expect(preview).toContainText('Pat Protected');
  const accept = preview.getByRole('button', { name: 'Accept invitation' });
  await expect(accept).toBeDisabled();
  await preview.getByRole('checkbox').check();
  await expect(accept).toBeEnabled();
  await accept.click();
  await expect(page.getByText(/relationship is now active/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sunrise Household' })).toBeVisible();
  const allowed = await page.request.get(`${apiUrl}/v1/family`, {
    headers: { Origin: customerUrl, 'X-BB-Household-Id': sunriseId! },
  });
  expect(allowed.ok()).toBeTruthy();

  await signOutCustomer(page);
  await signInCustomer(page, 'protected-pat');
  await page.getByRole('link', { name: 'Check', exact: true }).click();
  await page
    .getByLabel('Suspicious message')
    .fill('JORDAN-SHARE-PROOF: urgent payment request for local sharing test');
  await page.getByRole('button', { name: 'Check it' }).click();
  await page.getByRole('button', { name: /Ask Jordan.* to review/u }).click();
  await expect(page.getByRole('status')).toContainText('No notification was sent');

  await signOutCustomer(page);
  await signInCustomer(page, 'trusted-jordan');
  await expect(page.getByText('1 shared result needs your acknowledgement.')).toBeVisible();
  await expect(page.getByText(/does not send a text, email, or push alert/u)).toBeVisible();
  await page.getByRole('link', { name: 'Open shared History' }).click();
  const sharedHistory = page.getByTestId('check-history');
  await expect(sharedHistory).toContainText('Message text');
  await expect(sharedHistory).toContainText('Shared with you');
  await expect(sharedHistory).not.toContainText('JORDAN-SHARE-PROOF');
  await expect(sharedHistory.getByRole('button', { name: 'Delete record' })).toHaveCount(0);
  await sharedHistory.getByRole('button', { name: 'View result details' }).click();
  await expect(
    sharedHistory.getByRole('heading', { name: 'Redacted result details' }),
  ).toBeVisible();
  await expect(
    sharedHistory.getByRole('heading', { name: 'What the check noticed and its limits' }),
  ).toBeVisible();
  await expect(sharedHistory.getByRole('heading', { name: 'Safer next actions' })).toBeVisible();
  await expect(sharedHistory).toContainText('Limited information');
  await expect(sharedHistory).toContainText('Important limit');
  await expect(sharedHistory).toContainText('Evidence gap:');
  await expect(sharedHistory).not.toContainText('Provider provenance');
  await expect(sharedHistory).not.toContainText('Not calibrated');
  await expect(sharedHistory).not.toContainText('JORDAN-SHARE-PROOF');

  await page
    .getByLabel('Member navigation')
    .getByRole('link', { name: 'Family', exact: true })
    .click();
  const activeSection = page.getByRole('heading', { name: 'Active Trusted Circle' }).locator('..');
  const jordanRelationship = activeSection.locator('li').filter({ hasText: 'Jordan' });
  await expect(jordanRelationship.getByRole('button', { name: 'Revoke access' })).toBeVisible();
  await jordanRelationship.getByRole('button', { name: 'Revoke access' }).click();
  await expect(page).toHaveURL(/\/member$/);
  await expect(page.getByRole('link', { name: 'Family', exact: true })).toBeVisible();
  const boundedSelfMembership = await page.request.get(`${apiUrl}/v1/family`, {
    headers: { Origin: customerUrl, 'X-BB-Household-Id': sunriseId! },
  });
  expect(boundedSelfMembership.status()).toBe(200);
  const boundedFamily = (await boundedSelfMembership.json()) as {
    relationships: Array<{ state: string }>;
    invitations: unknown[];
    memberInvitations: unknown[];
  };
  expect(boundedFamily.relationships.every((relationship) => relationship.state !== 'active')).toBe(
    true,
  );
  expect(boundedFamily.invitations).toHaveLength(0);
  expect(boundedFamily.memberInvitations).toHaveLength(0);
  const sharedCheckDenied = await page.request.get(`${apiUrl}/v1/checks`, {
    headers: { Origin: customerUrl, 'X-BB-Household-Id': sunriseId! },
  });
  expect([403, 404]).toContain(sharedCheckDenied.status());
  await page.getByRole('link', { name: 'Family', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Leave household' })).toBeVisible();
});

test('Family safe word can be replaced, privately verified, and disabled', async ({ page }) => {
  const syntheticPhrase = 'violet canoe e2e';

  await signInCustomer(page, 'protected-pat');
  await page.getByRole('link', { name: 'Family', exact: true }).click();
  await page.getByRole('link', { name: 'Open family verification aid' }).click();
  await expect(page.getByRole('heading', { name: 'Family verification aid' })).toBeVisible();
  await page.getByLabel('New family safe word').fill(syntheticPhrase);
  await page.getByLabel('Enter the new safe word again').fill(syntheticPhrase);
  await page.getByRole('button', { name: 'Replace family safe word' }).click();
  await expect(page.getByText(/Family verification aid replaced/u)).toBeVisible();
  await expect(page.getByLabel('New family safe word')).toHaveValue('');
  await expect(page.getByLabel('Enter the new safe word again')).toHaveValue('');

  await signOutCustomer(page);
  await signInCustomer(page, 'trusted-terry');
  await page.getByRole('link', { name: 'Family', exact: true }).click();
  await page.getByRole('link', { name: 'Open family verification aid' }).click();
  await page
    .getByLabel('Protected person', { exact: true })
    .selectOption({ label: 'Pat Protected' });
  const verificationInput = page.getByLabel('Phrase shared by that person');
  await verificationInput.fill(syntheticPhrase);
  await page.getByRole('button', { name: 'Check phrase' }).click();
  await expect(page.getByText(/Verified: the phrase matched the stored verifier/u)).toBeVisible();
  await expect(verificationInput).toHaveValue('');
  await verificationInput.fill('incorrect phrase e2e');
  await page.getByRole('button', { name: 'Check phrase' }).click();
  const nonMatchStatus = page.getByRole('status').filter({ hasText: 'Not verified' });
  await expect(nonMatchStatus).toBeVisible();
  await expect(nonMatchStatus).toContainText('not identity proof');

  await signOutCustomer(page);
  await signInCustomer(page, 'protected-pat');
  await page.getByRole('link', { name: 'Family', exact: true }).click();
  await page.getByRole('link', { name: 'Open family verification aid' }).click();
  await page.getByRole('button', { name: 'Disable family safe word' }).click();
  await page.getByRole('button', { name: 'Yes, disable verification' }).click();
  await expect(page.getByText(/Family verification aid disabled/u)).toBeVisible();
});

test('a multi-household actor keeps protected and Trusted Circle scopes separate', async ({
  page,
}) => {
  const pat = await requestFactory.newContext({
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
    const invitation = (await (
      await pat.post('/v1/family/invitations', {
        headers: { 'X-BB-Household-Id': sunriseId },
        data: {
          inviteeDisplayName: 'Olivia multi-household test',
          permissions: ['view_shared_checks'],
        },
      })
    ).json()) as { invitation: { id: string }; localInviteCode: string };

    await signInCustomer(page, 'protected-olivia');
    const beforeAcceptanceResponse = await page.request.get(`${apiUrl}/v1/me`, {
      headers: { Origin: customerUrl },
    });
    const beforeAcceptance = (await beforeAcceptanceResponse.json()) as {
      principal: { households: Array<{ id: string }> };
    };
    expect(beforeAcceptance.principal.households).toHaveLength(1);
    const harborId = beforeAcceptance.principal.households[0]!.id;

    await page.getByRole('link', { name: 'Family', exact: true }).click();
    await page.getByLabel('Invitation ID').fill(invitation.invitation.id);
    await page.getByLabel('One-time invitation credential').fill(invitation.localInviteCode);
    await page.getByRole('button', { name: 'Review invitation' }).click();
    const invitationPreview = page.getByTestId('invitation-preview');
    await expect(invitationPreview).toContainText('Sunrise Household');
    await invitationPreview.getByRole('checkbox').check();
    await invitationPreview.getByRole('button', { name: 'Accept invitation' }).click();

    const scopeSelector = page.getByLabel('Active household');
    await expect(scopeSelector).toBeVisible();
    await expect(scopeSelector).toHaveValue(sunriseId);
    const meResponse = await page.request.get(`${apiUrl}/v1/me`, {
      headers: { Origin: customerUrl },
    });
    const me = (await meResponse.json()) as {
      principal: {
        households: Array<{
          id: string;
          isAdministrator: boolean;
          isProtectedMember: boolean;
          trustedCircleGrants: Array<{
            relationshipId: string;
            protectedPersonId: string;
            permissions: string[];
          }>;
        }>;
      };
    };
    expect(me.principal.households.map((scope) => scope.id)).toEqual(
      expect.arrayContaining([sunriseId, harborId]),
    );
    const sunriseScope = me.principal.households.find((scope) => scope.id === sunriseId);
    expect(sunriseScope).toMatchObject({
      isAdministrator: false,
      isProtectedMember: false,
    });
    expect(sunriseScope?.trustedCircleGrants).toHaveLength(1);
    expect(sunriseScope?.trustedCircleGrants[0]).toEqual({
      relationshipId: expect.any(String),
      protectedPersonId: 'person-protected-pat',
      permissions: ['view_shared_checks'],
    });
    expect(me.principal.households.find((scope) => scope.id === harborId)).toMatchObject({
      isAdministrator: false,
      isProtectedMember: true,
      trustedCircleGrants: [],
    });

    const protectedStatusHouseholds: string[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'GET' &&
        new URL(request.url()).pathname === '/v1/protected-enrollment'
      ) {
        protectedStatusHouseholds.push(request.headers()['x-bb-household-id'] ?? '');
      }
    });
    let injectMismatchedProtectedScope = true;
    await page.route('**/v1/protected-enrollment', async (route) => {
      if (route.request().method() !== 'GET' || !injectMismatchedProtectedScope) {
        await route.continue();
        return;
      }
      injectMismatchedProtectedScope = false;
      const response = await route.fetch();
      const payload = (await response.json()) as Record<string, unknown>;
      await route.fulfill({ response, json: { ...payload, householdId: harborId } });
    });
    await page.goto(`${customerUrl}/member/protection`);
    await expect(page.getByRole('heading', { name: 'Protected-adult access' })).toBeVisible();
    const selfEnrollmentChoice = page.getByLabel(
      /I am choosing protected-adult access for myself in this exact household/u,
    );
    await expect(page.locator('.error[role="alert"]')).toContainText('different account scope');
    await expect(selfEnrollmentChoice).toHaveCount(0);
    await page.unroute('**/v1/protected-enrollment');
    await page.reload();
    await expect(selfEnrollmentChoice).toBeVisible();
    await selfEnrollmentChoice.check();

    await scopeSelector.selectOption(harborId);
    await expect(scopeSelector).toHaveValue(harborId);
    await expect(page.getByText('Enrolled for this household.', { exact: true })).toBeVisible();
    await expect(selfEnrollmentChoice).toHaveCount(0);

    await scopeSelector.selectOption(sunriseId);
    await expect(scopeSelector).toHaveValue(sunriseId);
    await expect(selfEnrollmentChoice).toBeVisible();
    await expect(selfEnrollmentChoice).not.toBeChecked();
    await expect
      .poll(() => protectedStatusHouseholds)
      .toEqual(expect.arrayContaining([sunriseId, harborId]));
    expect(protectedStatusHouseholds).not.toContain('');

    await expect(page.getByRole('link', { name: 'Check', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'History', exact: true })).toBeVisible();
    const deniedSunriseCheck = await page.request.post(`${apiUrl}/v1/checks`, {
      headers: { Origin: customerUrl, 'X-BB-Household-Id': sunriseId },
      data: { kind: 'text', content: 'Trusted Circle scope must not own a Check.' },
    });
    expect(deniedSunriseCheck.status()).toBe(403);

    await scopeSelector.selectOption(harborId);
    await expect(scopeSelector).toHaveValue(harborId);
    await page.getByRole('link', { name: 'Check', exact: true }).click();
    await page.getByLabel('Suspicious message').fill('HARBOR-SCOPED-CHECK');
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url() === `${apiUrl}/v1/checks` && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Check it' }).click();
    const checkResponse = await responsePromise;
    const responseBody = (await checkResponse.json()) as { check: { householdId: string } };
    expect(responseBody.check.householdId).toBe(harborId);
    await expect(page.getByTestId('check-result')).toHaveAttribute('data-household-id', harborId);
    await expect(page.getByTestId('active-household')).toContainText('Harbor Household');

    await page.goto(`${customerUrl}/member/history`);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Your check records' })).toBeVisible();
    const harborList = await page.request.get(`${apiUrl}/v1/checks`, {
      headers: { Origin: customerUrl, 'X-BB-Household-Id': harborId },
    });
    const harborBody = (await harborList.json()) as {
      checks: Array<{ householdId: string }>;
    };
    expect(harborBody.checks.every((check) => check.householdId === harborId)).toBeTruthy();

    await page.goto(`${customerUrl}/member/orientation`);
    await expect(page.getByRole('heading', { name: 'Orientation' })).toBeVisible();
    await scopeSelector.selectOption(sunriseId);
    await expect(scopeSelector).toHaveValue(sunriseId);
    await expect(
      page.getByRole('heading', { name: 'Orientation unavailable in this household' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Check', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'History', exact: true })).toBeVisible();

    const refreshedFamily = (await (
      await pat.get('/v1/family', { headers: { 'X-BB-Household-Id': sunriseId } })
    ).json()) as {
      relationships: Array<{ id: string; trustedDisplayName: string; state: string }>;
    };
    const relationship = refreshedFamily.relationships.find(
      (item) => item.trustedDisplayName.includes('Olivia') && item.state === 'active',
    );
    expect(relationship).toBeTruthy();
    expect(
      (
        await pat.delete(`/v1/family/relationships/${relationship!.id}`, {
          headers: { 'X-BB-Household-Id': sunriseId },
        })
      ).ok(),
    ).toBeTruthy();
  } finally {
    await pat.dispose();
  }
});

test('a synthetic local Family entitlement member explicitly enrolls, orients, Checks, sees history, and withdraws without proving Stripe or live paid readiness', async ({
  page,
}) => {
  await signInCustomer(page, 'trusted-terry');
  await page.getByRole('link', { name: 'Protected access', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Protected-adult access' })).toBeVisible();
  await expect(page.getByText('A protected-adult seat is available')).toBeVisible();
  await expect(page.getByText(/cannot accept this consent for me/u)).toBeVisible();
  const disclosureFingerprint = page.locator('details').filter({
    has: page.getByText('Disclosure evidence fingerprint', { exact: true }),
  });
  await expect(disclosureFingerprint.locator('code')).toBeHidden();
  await disclosureFingerprint.locator('summary').click();
  await expect(disclosureFingerprint.locator('code')).toBeVisible();

  const enrollKeys: string[] = [];
  const forwardedEnrollKeys: string[] = [];
  let dropEnrollResponse = true;
  let forceOriginalEnrollReplay = false;
  await page.route('**/v1/protected-enrollment', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const incomingKey = (await route.request().headerValue('idempotency-key')) ?? '';
    const forwardedKey = forceOriginalEnrollReplay ? (enrollKeys[0] ?? '') : incomingKey;
    enrollKeys.push(incomingKey);
    forwardedEnrollKeys.push(forwardedKey);
    const response = await route.fetch({
      headers: { ...route.request().headers(), 'idempotency-key': forwardedKey },
    });
    if (dropEnrollResponse) {
      dropEnrollResponse = false;
      await route.abort('connectionfailed');
      return;
    }
    await route.fulfill({ response });
  });
  await page
    .getByLabel(/I am choosing protected-adult access for myself in this exact household/u)
    .check();
  await page.getByRole('button', { name: 'Enroll myself' }).click();
  await expect(page.locator('.error[role="alert"]')).toBeVisible();
  await page.getByRole('button', { name: 'Enroll myself' }).click();
  await expect(page.getByRole('status')).toContainText(
    'current protected-adult status is enrolled',
  );
  expect(enrollKeys).toHaveLength(2);
  expect(enrollKeys[1]).toBe(enrollKeys[0]);
  expect(enrollKeys[0]).toMatch(
    /^protected-self-enroll:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );

  await page.getByRole('link', { name: 'Continue to orientation' }).click();
  await expect(page.getByRole('heading', { name: 'Orientation' })).toBeVisible();
  await page.getByRole('button', { name: 'Start orientation' }).click();
  for (const key of ['protection_subject', 'trusted_circle'] as const) {
    const step = page.locator(`[data-orientation-step="${key}"]`);
    await step.getByRole('button', { name: 'Mark this step complete' }).click();
  }
  await page
    .locator('[data-orientation-step="safe_word"]')
    .getByRole('button', { name: 'Defer after reading this' })
    .click();
  const practice = page.locator('[data-orientation-step="practice_check"]');
  await practice.getByLabel(/independently/u).check();
  await practice.getByRole('button', { name: 'Complete the practice step' }).click();
  for (const key of ['capabilities_and_limits', 'review'] as const) {
    await page
      .locator(`[data-orientation-step="${key}"]`)
      .getByRole('button', { name: 'Mark this step complete' })
      .click();
  }
  await expect(page.getByRole('heading', { name: 'Orientation ready' })).toBeVisible();

  await page.getByRole('link', { name: 'Check', exact: true }).click();
  await page
    .getByLabel('Suspicious message')
    .fill('Synthetic browser test: an urgent caller asks for payment by gift card.');
  const checkResponsePromise = page.waitForResponse(
    (response) =>
      response.url() === `${apiUrl}/v1/checks` && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Check it' }).click();
  const checkResponse = await checkResponsePromise;
  expect(checkResponse.status()).toBe(201);
  const checkId = String(((await checkResponse.json()) as { check: { id: string } }).check.id);

  await page.getByRole('link', { name: 'History', exact: true }).click();
  const history = page.getByTestId('check-history');
  await expect(history.locator(`[data-check-id="${checkId}"]`)).toContainText('Yours');

  await page.getByRole('link', { name: 'Protected access', exact: true }).click();
  const withdrawKeys: string[] = [];
  let dropWithdrawResponse = true;
  await page.route('**/v1/protected-enrollment/withdraw', async (route) => {
    const incomingKey = (await route.request().headerValue('idempotency-key')) ?? '';
    withdrawKeys.push(incomingKey);
    const response = await route.fetch();
    if (dropWithdrawResponse) {
      dropWithdrawResponse = false;
      await route.abort('connectionfailed');
      return;
    }
    await route.fulfill({ response });
  });
  await page
    .getByLabel(/I understand these effects and want to withdraw my own protected-adult consent/u)
    .check();
  await page.getByRole('button', { name: 'Withdraw my consent' }).click();
  await expect(page.locator('.error[role="alert"]')).toBeVisible();
  expect(withdrawKeys[0]).toMatch(
    /^protected-self-withdraw:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.entries(window.sessionStorage).filter(([key]) =>
          key.startsWith('bb:protected-self:withdraw:'),
        ),
      ),
    )
    .toEqual([[expect.any(String), withdrawKeys[0]]]);
  await page.reload();
  await expect(page.getByText('Not enrolled.', { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(window.sessionStorage).filter((key) =>
          key.startsWith('bb:protected-self:withdraw:'),
        ),
      ),
    )
    .toEqual([]);
  forceOriginalEnrollReplay = true;
  await page
    .getByLabel(/I am choosing protected-adult access for myself in this exact household/u)
    .check();
  await page.getByRole('button', { name: 'Enroll myself' }).click();
  await expect(page.getByRole('status')).toContainText(
    'current protected-adult status is not enrolled',
  );
  await expect(page.getByText('Not enrolled.', { exact: true })).toBeVisible();
  expect(enrollKeys[2]).not.toBe(enrollKeys[0]);
  expect(forwardedEnrollKeys[2]).toBe(enrollKeys[0]);
  await expect(page.getByRole('link', { name: 'Check', exact: true })).toHaveCount(0);

  const retryScopeResponse = await page.request.get(`${apiUrl}/v1/me`, {
    headers: { Origin: customerUrl },
  });
  const retryScope = (await retryScopeResponse.json()) as {
    principal: { personId: string; households: Array<{ id: string }> };
  };
  const retryStorageKey = `bb:protected-self:enroll:${retryScope.principal.personId}:${retryScope.principal.households[0]!.id}`;
  await page.evaluate(({ key, value }) => window.sessionStorage.setItem(key, value), {
    key: retryStorageKey,
    value: enrollKeys[0]!,
  });
  await signOutCustomer(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(window.sessionStorage).filter((key) => key.startsWith('bb:protected-self:')),
      ),
    )
    .toEqual([]);

  forceOriginalEnrollReplay = false;
  await signInCustomer(page, 'trusted-terry');
  await page.getByRole('link', { name: 'Protected access', exact: true }).click();
  await page.evaluate(({ key, value }) => window.sessionStorage.setItem(key, value), {
    key: retryStorageKey,
    value: enrollKeys[0]!,
  });
  await page
    .getByLabel(/I am choosing protected-adult access for myself in this exact household/u)
    .check();
  await page.getByRole('button', { name: 'Enroll myself' }).click();
  await expect(page.locator('.error[role="alert"]')).toContainText('different request');
  await expect
    .poll(() => page.evaluate((key) => window.sessionStorage.getItem(key), retryStorageKey))
    .toBeNull();
  await page.getByRole('button', { name: 'Enroll myself' }).click();
  await expect(page.getByRole('status')).toContainText(
    'current protected-adult status is enrolled',
  );
  expect(enrollKeys[3]).toBe(enrollKeys[0]);
  expect(enrollKeys[4]).not.toBe(enrollKeys[0]);
  await page
    .getByLabel(/I understand these effects and want to withdraw my own protected-adult consent/u)
    .check();
  await page.getByRole('button', { name: 'Withdraw my consent' }).click();
  await expect(page.getByRole('status')).toContainText(
    'current protected-adult status is not enrolled',
  );
  await expect(page.getByRole('link', { name: 'Check', exact: true })).toHaveCount(0);

  const deniedOwnedCheck = await page.request.get(`${apiUrl}/v1/checks/${checkId}`, {
    headers: { Origin: customerUrl },
  });
  expect(deniedOwnedCheck.status()).toBe(403);
  await page.goto(`${customerUrl}/member/orientation`);
  await expect(
    page.getByRole('heading', { name: 'Orientation unavailable in this household' }),
  ).toBeVisible();
});

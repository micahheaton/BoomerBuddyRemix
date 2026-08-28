import { expect, test } from '@playwright/test';
import { customerUrl, signInCustomer } from './helpers';

test('billing and success surfaces remain fail-closed without billing activation', async ({
  page,
}) => {
  await signInCustomer(page, 'owner-alice');
  const billingLink = page.getByRole('link', { name: 'Open billing' });
  await expect(billingLink).toHaveAttribute('href', '/member/billing');
  await Promise.all([
    page.waitForURL(/\/member\/billing$/u, { waitUntil: 'domcontentloaded' }),
    billingLink.click(),
  ]);
  await expect(page.getByRole('heading', { name: 'Manage billing' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Billing is not available' })).toBeVisible();
  await expect(page.getByText(/online billing is not available/iu)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to secure checkout' })).toHaveCount(0);

  await page.goto(
    `${customerUrl}/member/billing/success?session_id=cs_live_forged&canonicalAccessActive=true`,
  );
  await expect(page.getByRole('heading', { name: 'We are confirming your payment' })).toBeVisible();
  await expect(
    page.getByText(/Returning from Checkout does not by itself activate/iu),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Review billing' })).toBeVisible();
});

test('mocked billing journey preserves unknown retry, expiry, paid truth, and portal controls', async ({
  page,
}) => {
  await signInCustomer(page, 'owner-alice');
  type BillingState = 'pending_unknown' | 'pending_retry' | 'ready' | 'awaiting_payment' | 'active';
  let billingState: BillingState = 'pending_unknown';
  let checkoutOperation = '';
  let checkoutHousehold = '';
  let checkoutOffer = '';
  let portalOperation = '';
  let portalHousehold = '';
  const offers = [
    {
      offerId: 'family_annual_v2',
      plan: 'family',
      displayName: 'Family',
      billingInterval: 'year',
      unitAmountMinor: 14_990,
      currency: 'usd',
      trialPeriodDays: 7,
      customerSelectable: true,
      defaultAcquisitionOffer: true,
      disclosure: '7 days free, then $149.90/year unless canceled.',
    },
    {
      offerId: 'family_monthly_v2',
      plan: 'family',
      displayName: 'Family',
      billingInterval: 'month',
      unitAmountMinor: 1_499,
      currency: 'usd',
      trialPeriodDays: 0,
      customerSelectable: true,
      defaultAcquisitionOffer: false,
      disclosure: '$14.99/month until canceled.',
    },
    {
      offerId: 'individual_annual_v1',
      plan: 'individual',
      displayName: 'Individual',
      billingInterval: 'year',
      unitAmountMinor: 8_990,
      currency: 'usd',
      trialPeriodDays: 7,
      customerSelectable: false,
      defaultAcquisitionOffer: false,
      disclosure: '7 days free, then $89.90/year unless canceled.',
    },
    {
      offerId: 'individual_monthly_v1',
      plan: 'individual',
      displayName: 'Individual',
      billingInterval: 'month',
      unitAmountMinor: 899,
      currency: 'usd',
      trialPeriodDays: 0,
      customerSelectable: false,
      defaultAcquisitionOffer: false,
      disclosure: '$8.99/month until canceled.',
    },
  ] as const;
  const responseFor = () => {
    const common = {
      householdId: 'household-sunrise',
      offerId: 'family_annual_v2',
      runtimeInitiationEnabled: true,
      defaultOfferId: 'family_annual_v2',
      offers,
    } as const;
    const billing =
      billingState === 'pending_unknown'
        ? {
            ...common,
            checkoutState: 'pending_provider',
            canonicalAccessActive: false,
            portalAvailable: false,
            pendingOperation: {
              serverOperationId: 'checkout-operation-unknown-0001',
              state: 'outcome_unknown',
              attemptCount: 1,
              nextRetryAt: '2026-08-16T12:00:30.000Z',
              expiresAt: '2026-08-17T11:05:00.000Z',
            },
          }
        : billingState === 'pending_retry'
          ? {
              ...common,
              checkoutState: 'pending_provider',
              canonicalAccessActive: false,
              portalAvailable: false,
              pendingOperation: {
                serverOperationId:
                  checkoutOperation === '' ? 'checkout-operation-unknown-0001' : checkoutOperation,
                state: 'dispatching',
                attemptCount: 2,
                nextRetryAt: '2026-08-16T12:02:30.000Z',
                expiresAt: '2026-08-17T11:05:00.000Z',
              },
            }
          : billingState === 'ready'
            ? {
                ...common,
                checkoutState: 'ready',
                canonicalAccessActive: false,
                portalAvailable: false,
              }
            : billingState === 'awaiting_payment'
              ? {
                  ...common,
                  checkoutState: 'awaiting_payment_evidence',
                  canonicalAccessActive: false,
                  portalAvailable: true,
                }
              : {
                  ...common,
                  checkoutState: 'active',
                  canonicalAccessActive: true,
                  portalAvailable: true,
                };
    return {
      billing,
      evidenceNotice:
        'Your membership becomes active only after BoomerBuddy verifies an eligible trial or successful payment.',
    };
  };
  await page.route('**/v1/commerce/billing-authority', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        householdId: 'household-sunrise',
        personId: 'person-owner-alice',
        administratorEligible: true,
        authorityStatus: 'active',
        canAccept: false,
        canRevoke: true,
        documents: {
          accept: {
            version: 'billing-authority-self-consent-v1',
            digest: 'a'.repeat(64),
            disclosure: 'Accept recurring billing responsibility for this household.',
          },
          revoke: {
            version: 'billing-authority-self-withdrawal-v1',
            digest: 'b'.repeat(64),
            disclosure: 'Withdraw recurring billing responsibility for this household.',
          },
        },
        externalActionExecuted: false,
      }),
    });
  });
  await page.route('**/v1/commerce/stripe/billing', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(responseFor()),
    });
  });
  await page.route('**/v1/commerce/stripe/checkout', async (route) => {
    checkoutOperation = route.request().headers()['idempotency-key'] ?? '';
    checkoutHousehold = route.request().headers()['x-bb-household-id'] ?? '';
    checkoutOffer = ((await route.request().postDataJSON()) as { offerId?: string }).offerId ?? '';
    billingState = 'pending_retry';
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'conflict', message: 'Outcome is reconciling' } }),
    });
  });
  await page.route('**/v1/commerce/stripe/portal', async (route) => {
    portalOperation = route.request().headers()['idempotency-key'] ?? '';
    portalHousehold = route.request().headers()['x-bb-household-id'] ?? '';
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'conflict', message: 'Portal fixture stopped' } }),
    });
  });

  await page.goto(`${customerUrl}/member/billing`);
  await expect(
    page.getByRole('heading', { name: 'Confirming your billing request' }),
  ).toBeVisible();
  await expect(page.getByTestId('billing-pending-operation')).toContainText(
    'Your billing request is being confirmed',
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem('bb:billing:checkout-operation:household-sunrise'),
      ),
    )
    .toBe('checkout-operation-unknown-0001');

  billingState = 'pending_retry';
  await page.getByRole('button', { name: 'Refresh billing status' }).click();
  await expect(page.getByTestId('billing-pending-operation')).toContainText(
    'Please wait before starting another request',
  );

  billingState = 'ready';
  await page.getByRole('button', { name: 'Refresh billing status' }).click();
  await expect(page.getByRole('button', { name: 'Continue to secure checkout' })).toBeVisible();
  const billingOption = page.getByLabel('Billing option');
  await expect(billingOption).toHaveValue('family_annual_v2');
  await expect(page.getByTestId('billing-customer-terms')).toContainText(
    '7 days free, then $149.90/year unless canceled.',
  );
  await billingOption.selectOption('family_monthly_v2');
  await expect(page.getByTestId('billing-customer-terms')).toContainText(
    '$14.99/month until canceled.',
  );
  await billingOption.selectOption('family_annual_v2');
  await expect(page.getByTestId('billing-customer-terms')).toContainText(
    'Charges are generally not refundable',
  );
  await expect(page.getByText(/MFA method already enrolled/iu)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Withdraw billing-manager role' })).toBeVisible();
  await expect(
    page.getByTestId('billing-customer-terms').getByRole('link', { name: 'support' }),
  ).toHaveAttribute('href', '/support');
  await expect(
    page.getByTestId('billing-customer-terms').getByRole('link', { name: 'billing terms' }),
  ).toHaveAttribute('href', '/billing-terms');
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem('bb:billing:checkout-operation:household-sunrise'),
      ),
    )
    .toBeNull();
  await page.getByRole('button', { name: 'Continue to secure checkout' }).click();
  await expect(page.getByTestId('billing-pending-operation')).toContainText(
    'Your billing request is being confirmed',
  );
  expect(checkoutOperation).toMatch(/^checkout-/u);
  expect(checkoutHousehold).toBe('household-sunrise');
  expect(checkoutOffer).toBe('family_annual_v2');
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem('bb:billing:checkout-operation:household-sunrise'),
      ),
    )
    .toBe(checkoutOperation);

  billingState = 'awaiting_payment';
  await page.getByRole('button', { name: 'Refresh billing status' }).click();
  await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to secure checkout' })).toHaveCount(0);

  billingState = 'active';
  await page.getByRole('button', { name: 'Refresh billing status' }).click();
  await expect(page.getByRole('heading', { name: 'Membership is active' })).toBeVisible();
  await expect(page.getByTestId('billing-invoice-recovery')).toContainText(
    'invoice history that Stripe has made available',
  );
  await expect(
    page.getByTestId('billing-invoice-recovery').getByRole('link', { name: 'contact support' }),
  ).toHaveAttribute('href', '/support');
  await page.getByRole('button', { name: 'View invoices or manage billing' }).click();
  expect(portalOperation).toMatch(/^portal-/u);
  expect(portalHousehold).toBe('household-sunrise');
  await expect(page.getByRole('heading', { name: 'Membership is active' })).toBeVisible();
});

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
  let portalOperation = '';
  let portalHousehold = '';
  const responseFor = () => {
    const common = {
      householdId: 'household-sunrise',
      offerId: 'founding_family_monthly_v1',
      runtimeInitiationEnabled: true,
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
        'Your membership becomes active only after BoomerBuddy confirms a successful payment.',
    };
  };
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
  await expect(page.getByTestId('billing-customer-terms')).toContainText(
    'Monthly charges are generally not refundable',
  );
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

import { expect, test } from '@playwright/test';

import { apiUrl, customerUrl, hqUrl, signInCustomer, signInHq } from './helpers';

type SupportReceiptMutation = {
  readonly receipt: {
    readonly receiptCode: string;
  };
};

test('member support receipts and the owner queue preserve the content-free lifecycle', async ({
  page,
}) => {
  await signInCustomer(page, 'owner-alice');
  await page.getByRole('link', { name: 'Support' }).click();
  await expect(page).toHaveURL(`${customerUrl}/member/support`);
  await expect(
    page.getByRole('heading', { name: 'Create a private support receipt' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'No support receipts on this page' }),
  ).toBeVisible();

  const submitReceipt = async (category: string, impact: string): Promise<string> => {
    await page.getByLabel('What do you need help with?').selectOption(category);
    await page.getByLabel('How is this affecting you?').selectOption(impact);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url() === `${apiUrl}/v1/support-receipts` &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Create support receipt' }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    const body = (await response.json()) as SupportReceiptMutation;
    await expect(page.getByText(`Reference: ${body.receipt.receiptCode}`)).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Open email draft for this receipt' }),
    ).toHaveAttribute(
      'href',
      `mailto:support@boomerbuddy.net?subject=${encodeURIComponent(body.receipt.receiptCode)}`,
    );
    return body.receipt.receiptCode;
  };

  const withdrawnCode = await submitReceipt('billing', 'blocked');
  const withdrawnRow = page.locator('li.history-row').filter({ hasText: withdrawnCode });
  const withdrawalResponse = page.waitForResponse(
    (response) =>
      response.url() === `${apiUrl}/v1/support-receipts/withdrawals` &&
      response.request().method() === 'POST',
  );
  await withdrawnRow.getByRole('button', { name: 'Withdraw receipt' }).click();
  expect((await withdrawalResponse).status()).toBe(200);
  await expect(withdrawnRow).toContainText('Withdrawn');
  await expect(withdrawnRow.getByRole('button', { name: 'Withdraw receipt' })).toHaveCount(0);

  const ownerQueueCode = await submitReceipt('privacy', 'degraded');

  await signInHq(page);
  await page.getByRole('link', { name: 'Support receipts' }).click();
  await expect(page).toHaveURL(`${hqUrl}/support-receipts`);
  await expect(page.getByRole('heading', { name: 'Content-free owner queue' })).toBeVisible();

  const queueRow = page.getByRole('row').filter({ hasText: ownerQueueCode });
  await expect(queueRow).toContainText('Open');
  await queueRow.getByRole('button', { name: 'Acknowledge' }).click();
  await expect(queueRow).toContainText('Acknowledged');
  await queueRow.getByRole('button', { name: 'Start review' }).click();
  await expect(queueRow).toContainText('In review');
  await queueRow.getByLabel('Fixed resolution').selectOption('completed');
  await queueRow.getByRole('button', { name: 'Resolve' }).click();
  await expect(queueRow).toHaveCount(0);
  await expect(page.getByText('No active support receipts are on this page.')).toBeVisible();

  await page.goto(`${customerUrl}/member/support`);
  const resolvedRow = page.locator('li.history-row').filter({ hasText: ownerQueueCode });
  await expect(resolvedRow).toContainText('Resolved');
  await expect(resolvedRow).toContainText('Outcome: Completed');
});

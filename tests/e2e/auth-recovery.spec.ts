import { expect, test } from '@playwright/test';
import { customerUrl } from './helpers';

test('the member session recovery route is terminal and offers bounded next steps', async ({
  page,
}) => {
  await page.goto(`${customerUrl}/sign-in/session-recovery`);

  await expect(page).toHaveURL(`${customerUrl}/sign-in/session-recovery`);
  await expect(
    page.getByRole('heading', { name: 'Your previous session could not be verified' }),
  ).toBeVisible();
  await expect(page.getByText('This page does not continue automatically.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Email support' })).toHaveAttribute(
    'href',
    'mailto:support@boomerbuddy.net',
  );

  await page.getByRole('link', { name: 'Try member sign in' }).click();
  await expect(page).toHaveURL(`${customerUrl}/sign-in`);
  await expect(page.getByRole('heading', { name: 'Choose a seeded person' })).toBeVisible();
});

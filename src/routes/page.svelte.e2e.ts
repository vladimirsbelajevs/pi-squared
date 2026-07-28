import { expect, test } from '@playwright/test';

test('renders the tab-first harness shell', async ({ page }) => {
	await page.goto('/');

	await expect(
		page.getByRole('tab', { name: 'Historical sessions and harness settings' })
	).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Historical sessions' })).toBeVisible();
	await page.getByRole('button', { name: 'New chat tab' }).click();
	await expect(page.getByRole('heading', { name: 'Start a project conversation' })).toBeVisible();
});

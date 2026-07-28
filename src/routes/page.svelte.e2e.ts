import { expect, test } from '@playwright/test';

test('renders the tab-first harness shell', async ({ page }) => {
	await page.goto('/');

	await expect(
		page.getByRole('tab', { name: 'Historical sessions and harness settings' })
	).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Historical sessions' })).toBeVisible();
	await page.getByRole('button', { name: 'New chat tab' }).click();
	await expect(page.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible();
	await expect(page.getByRole('textbox', { name: 'Message Pi' })).toBeVisible();
	await expect(page.getByRole('combobox', { name: 'Model' })).toBeVisible();
	await expect(page.getByRole('combobox', { name: 'Reasoning' })).toBeVisible();
	await expect(page.getByRole('combobox', { name: 'Working project' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Add project' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Start chat' })).toHaveCount(0);
});

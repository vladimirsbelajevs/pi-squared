import { expect, test } from '@playwright/test';

test('renders the tab-first harness shell', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/history$/);

	await expect(
		page.getByRole('tab', { name: 'Historical sessions and harness settings' })
	).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Historical sessions' })).toBeVisible();
	await page.getByRole('button', { name: 'New chat tab' }).click();
	await expect(page).toHaveURL(/\/new\/.+$/);
	await expect(page.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible();
	await expect(page.getByRole('textbox', { name: 'Message Pi' })).toBeVisible();
	await expect(page.getByRole('combobox', { name: 'Model' })).toBeVisible();
	await expect(page.getByRole('combobox', { name: 'Reasoning' })).toBeVisible();
	await expect(page.getByRole('combobox', { name: 'Project' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Add project' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Start chat' })).toHaveCount(0);

	await page.getByRole('tab', { name: 'Historical sessions and harness settings' }).click();
	await expect(page).toHaveURL(/\/history$/);
	await page.getByRole('link', { name: 'Harness settings' }).click();
	await expect(page).toHaveURL(/\/settings$/);
	await expect(page.getByRole('heading', { name: 'Harness settings' })).toBeVisible();
});

test('restores a deep-linked new-chat draft route', async ({ page }) => {
	await page.goto('/new/routed-draft');

	await expect(page).toHaveURL(/\/new\/routed-draft$/);
	await expect(page.getByRole('tab', { name: 'New chat' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible();
});

import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Settings from './+page.svelte';

describe('Settings notifications', () => {
	it('renders accessible controls and persists sound preferences', async () => {
		localStorage.clear();
		render(Settings);

		await expect.element(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
		const sounds = page.getByRole('switch', { name: 'Enable notification sounds' });
		await expect.element(sounds).toBeVisible();
		await expect
			.element(page.getByRole('switch', { name: 'Notify when agents complete' }))
			.toBeVisible();
		await expect
			.element(page.getByRole('switch', { name: 'Notify when permission is required' }))
			.toBeVisible();
		await expect
			.element(page.getByRole('switch', { name: 'Enable system notifications' }))
			.toBeDisabled();
		await expect
			.element(page.getByRole('button', { name: 'Test system notification' }))
			.toBeDisabled();

		await sounds.click();
		await expect.poll(() => localStorage.getItem('pi-squared:sounds-enabled')).toBe('true');
	});
});

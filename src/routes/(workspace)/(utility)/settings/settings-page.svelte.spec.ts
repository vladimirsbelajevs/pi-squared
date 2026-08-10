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
		const volume = page.getByRole('slider', { name: 'Notification sound volume' });
		await expect.element(volume).toBeVisible();
		await expect.element(volume).toHaveAttribute('aria-valuetext', '100%');
		await expect
			.element(page.getByRole('switch', { name: 'Notify when agents complete' }))
			.toBeVisible();
		await expect
			.element(page.getByRole('switch', { name: 'Notify when permission is required' }))
			.toBeVisible();
		await expect
			.element(page.getByRole('switch', { name: 'Enable system notifications' }))
			.toBeDisabled();
		await expect.element(page.getByRole('button', { name: 'Test completion sound' })).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Test permission sound' })).toBeVisible();
		await expect
			.element(page.getByRole('button', { name: 'Test system notification' }))
			.toBeDisabled();

		await sounds.click();
		await expect.poll(() => localStorage.getItem('pi-squared:sounds-enabled')).toBe('true');

		volume.element().focus();
		volume.element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
		await expect.poll(() => localStorage.getItem('pi-squared:notification-volume')).toBe('0');
		await expect.element(volume).toHaveAttribute('aria-valuetext', '0%');
	});
});

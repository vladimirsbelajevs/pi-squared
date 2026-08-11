import { page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { registerApplicationUpdateStarter } from '$lib/application-updater.svelte';
import type { DesktopPiUpdateProgress, PiSquaredDesktopApi } from '$lib/desktop-contract';
import Settings from './+page.svelte';

afterEach(() => {
	delete window.piSquaredDesktop;
});

describe('Settings notifications', () => {
	it('launches the global application updater from Settings', async () => {
		const start = vi.fn();
		const unregister = registerApplicationUpdateStarter(start);
		render(Settings);

		await expect.element(page.getByRole('heading', { name: 'Application update' })).toBeVisible();
		await page.getByRole('button', { name: 'Check for updates' }).click();
		expect(start).toHaveBeenCalledOnce();
		unregister();
	});

	it('updates Pi and extensions only through the Electron preload API', async () => {
		let progressListener: ((progress: DesktopPiUpdateProgress) => void) | undefined;
		const startPiUpdate = vi.fn(async () => {
			progressListener?.({ stream: 'stdout', text: 'Updated Pi\n' });

			return { phase: 'success' as const };
		});
		window.piSquaredDesktop = {
			mode: 'electron',
			getBootstrapStatus: vi.fn(),
			startBootstrap: vi.fn(),
			onBootstrapProgress: vi.fn(() => () => undefined),
			startPiUpdate,
			onPiUpdateProgress: vi.fn((listener) => {
				progressListener = listener;

				return () => undefined;
			}),
			getUpdateStatus: vi.fn(),
			checkForUpdates: vi.fn(),
			onUpdateStatus: vi.fn(() => () => undefined),
			downloadUpdate: vi.fn(),
			restartAndInstall: vi.fn(),
			quit: vi.fn(),
			getVersion: vi.fn()
		} satisfies PiSquaredDesktopApi;

		const screen = render(Settings);
		const button = screen.getByRole('button', { name: 'Update Pi and extensions' });
		await expect.element(button).toBeVisible();
		await button.click();
		expect(startPiUpdate).toHaveBeenCalledOnce();
		await expect.element(screen.getByText(/Updated Pi/)).toBeVisible();
		await screen.unmount();
	});

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

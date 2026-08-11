import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { PiSquaredDesktopApi } from '$lib/desktop-contract';
import DesktopOnboarding from './DesktopOnboarding.svelte';

const needsSetup = {
	phase: 'needs-setup' as const,
	configured: false,
	prerequisites: { node: true, npm: true, pi: false },
	missingPackages: ['npm:pi-mcp-adapter'],
	permissionConfig: false
};

const ready = {
	phase: 'ready' as const,
	configured: true,
	prerequisites: { node: true, npm: true, pi: true },
	missingPackages: [],
	permissionConfig: true
};

let api: PiSquaredDesktopApi | undefined;

afterEach(() => {
	delete window.piSquaredDesktop;
	api = undefined;
	vi.restoreAllMocks();
});

describe('DesktopOnboarding', () => {
	it('offers to install a missing Pi CLI instead of treating it as a manual prerequisite', async () => {
		api = {
			mode: 'electron',
			windowControls: {
				getState: vi.fn(),
				onStateChange: vi.fn(() => () => undefined),
				minimize: vi.fn(),
				toggleMaximize: vi.fn(),
				close: vi.fn()
			},
			getBootstrapStatus: vi.fn(async () => needsSetup),
			startBootstrap: vi.fn(async () => ready),
			onBootstrapProgress: vi.fn(() => () => undefined),
			startPiUpdate: vi.fn(),
			onPiUpdateProgress: vi.fn(() => () => undefined),
			getUpdateStatus: vi.fn(),
			checkForUpdates: vi.fn(),
			onUpdateStatus: vi.fn(() => () => undefined),
			downloadUpdate: vi.fn(),
			restartAndInstall: vi.fn(),
			quit: vi.fn(),
			getVersion: vi.fn()
		};
		window.piSquaredDesktop = api;

		const screen = render(DesktopOnboarding);
		await expect.element(screen.getByText(/setup button will install it/)).toBeVisible();
		await expect.element(screen.getByText('Pi CLI', { exact: true })).toBeVisible();
		await screen.getByRole('button', { name: 'Install Pi setup' }).click();
		expect(api.startBootstrap).toHaveBeenCalledOnce();
		await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
		await screen.unmount();
	});
});

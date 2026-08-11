import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { DesktopWindowState, PiSquaredDesktopWindowControls } from '$lib/desktop-contract';
import DesktopTitlebar from './DesktopTitlebar.svelte';

function createWindowControls(initial: DesktopWindowState = { maximized: false }): {
	api: PiSquaredDesktopWindowControls;
	pushState: (state: DesktopWindowState) => void;
	unsubscribe: ReturnType<typeof vi.fn>;
} {
	let listener: ((state: DesktopWindowState) => void) | undefined;
	const unsubscribe = vi.fn();
	const api: PiSquaredDesktopWindowControls = {
		getState: vi.fn(async () => initial),
		onStateChange: vi.fn((nextListener) => {
			listener = nextListener;

			return unsubscribe;
		}),
		minimize: vi.fn(async () => undefined),
		toggleMaximize: vi.fn(async () => undefined),
		close: vi.fn(async () => undefined)
	};

	return {
		api,
		pushState: (state) => listener?.(state),
		unsubscribe
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('DesktopTitlebar', () => {
	it('renders the actual initial maximize state and updates its label and icon from pushed state', async () => {
		const controls = createWindowControls({ maximized: true });
		const screen = render(DesktopTitlebar, { props: { api: controls.api } });

		const restoreButton = screen.getByRole('button', { name: 'Restore window' });
		await expect.element(restoreButton).toBeVisible();
		expect(restoreButton.element().querySelector('path')?.getAttribute('d')).toBe(
			'M5.5 5.5h7v7h-7zM3.5 3.5h7v2'
		);

		controls.pushState({ maximized: false });
		const maximizeButton = screen.getByRole('button', { name: 'Maximize window' });
		await expect.element(maximizeButton).toBeVisible();
		expect(maximizeButton.element().querySelector('path')?.getAttribute('d')).toBe('M4 4h8v8H4z');
		await screen.unmount();
	});

	it('does not let a delayed initial query overwrite a newer pushed state', async () => {
		let resolveInitial: ((state: DesktopWindowState) => void) | undefined;
		let listener: ((state: DesktopWindowState) => void) | undefined;
		const api: PiSquaredDesktopWindowControls = {
			getState: vi.fn(
				() =>
					new Promise<DesktopWindowState>((resolve) => {
						resolveInitial = resolve;
					})
			),
			onStateChange: vi.fn((nextListener) => {
				listener = nextListener;

				return () => undefined;
			}),
			minimize: vi.fn(async () => undefined),
			toggleMaximize: vi.fn(async () => undefined),
			close: vi.fn(async () => undefined)
		};
		const screen = render(DesktopTitlebar, { props: { api } });

		listener?.({ maximized: true });
		resolveInitial?.({ maximized: false });
		await expect.element(screen.getByRole('button', { name: 'Restore window' })).toBeVisible();
		await screen.unmount();
	});

	it('invokes minimize, maximize/restore, and close through the bridge', async () => {
		const controls = createWindowControls();
		const screen = render(DesktopTitlebar, { props: { api: controls.api } });

		await screen.getByRole('button', { name: 'Minimize window' }).click();
		await screen.getByRole('button', { name: 'Maximize window' }).click();
		await screen.getByRole('button', { name: 'Close window' }).click();

		expect(controls.api.minimize).toHaveBeenCalledOnce();
		expect(controls.api.toggleMaximize).toHaveBeenCalledOnce();
		expect(controls.api.close).toHaveBeenCalledOnce();
		await screen.unmount();
	});

	it('removes the state listener when unmounted', async () => {
		const controls = createWindowControls();
		const screen = render(DesktopTitlebar, { props: { api: controls.api } });

		await expect.element(screen.getByRole('button', { name: 'Maximize window' })).toBeVisible();
		await screen.unmount();

		expect(controls.unsubscribe).toHaveBeenCalledOnce();
	});
});

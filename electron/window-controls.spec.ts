import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { DesktopWindowState } from '../src/lib/desktop-contract.js';
import {
	bindWindowStateNotifications,
	getWindowState,
	registerWindowControlsIpc,
	WINDOW_CLOSE_CHANNEL,
	WINDOW_MINIMIZE_CHANNEL,
	WINDOW_STATE_CHANNEL,
	WINDOW_TOGGLE_MAXIMIZE_CHANNEL,
	type WindowControlsWindow
} from './window-controls.js';

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function fakeWindow(): {
	window: WindowControlsWindow;
	listeners: Map<string, () => void>;
	state: { maximized: boolean; destroyed: boolean };
	minimize: ReturnType<typeof vi.fn>;
	maximize: ReturnType<typeof vi.fn>;
	unmaximize: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
} {
	const listeners = new Map<string, () => void>();
	const state = { maximized: false, destroyed: false };
	const minimize = vi.fn();
	const maximize = vi.fn(() => {
		state.maximized = true;
	});
	const unmaximize = vi.fn(() => {
		state.maximized = false;
	});
	const close = vi.fn();
	const window = {
		isDestroyed: () => state.destroyed,
		isMaximized: () => state.maximized,
		minimize,
		maximize,
		unmaximize,
		close,
		on: (event: 'maximize' | 'unmaximize', listener: () => void) => {
			listeners.set(event, listener);

			return window;
		},
		removeListener: (event: 'maximize' | 'unmaximize') => {
			listeners.delete(event);

			return window;
		}
	} satisfies WindowControlsWindow;

	return { window, listeners, state, minimize, maximize, unmaximize, close };
}

describe('Electron window controls', () => {
	it('forwards maximize and restore events with the actual state', () => {
		const controls = fakeWindow();
		const send = vi.fn<(state: DesktopWindowState) => void>();
		const cleanup = bindWindowStateNotifications(controls.window, send);

		controls.state.maximized = true;
		controls.listeners.get('maximize')?.();
		controls.state.maximized = false;
		controls.listeners.get('unmaximize')?.();

		expect(send).toHaveBeenNthCalledWith(1, { maximized: true });
		expect(send).toHaveBeenNthCalledWith(2, { maximized: false });
		cleanup();
		expect(controls.listeners.size).toBe(0);
	});

	it('rejects every window-control invocation from an untrusted sender', async () => {
		const controls = fakeWindow();
		const handlers = new Map<string, Handler>();
		registerWindowControlsIpc({
			ipcMain: {
				handle: (channel, handler) => handlers.set(channel, handler)
			},
			getWindow: () => controls.window,
			isTrustedSender: () => false
		});
		const event = {} as IpcMainInvokeEvent;

		for (const channel of [
			WINDOW_STATE_CHANNEL,
			WINDOW_MINIMIZE_CHANNEL,
			WINDOW_TOGGLE_MAXIMIZE_CHANNEL,
			WINDOW_CLOSE_CHANNEL
		]) {
			await expect(Promise.resolve().then(() => handlers.get(channel)?.(event))).rejects.toThrow(
				'Untrusted IPC sender.'
			);
		}

		expect(controls.minimize).not.toHaveBeenCalled();
		expect(controls.maximize).not.toHaveBeenCalled();
		expect(controls.unmaximize).not.toHaveBeenCalled();
		expect(controls.close).not.toHaveBeenCalled();
	});

	it('performs the requested window actions for a trusted sender', async () => {
		const controls = fakeWindow();
		const handlers = new Map<string, Handler>();
		registerWindowControlsIpc({
			ipcMain: {
				handle: (channel, handler) => handlers.set(channel, handler)
			},
			getWindow: () => controls.window,
			isTrustedSender: () => true
		});
		const event = {} as IpcMainInvokeEvent;

		expect(await handlers.get(WINDOW_STATE_CHANNEL)?.(event)).toEqual({ maximized: false });
		await handlers.get(WINDOW_MINIMIZE_CHANNEL)?.(event);
		await handlers.get(WINDOW_TOGGLE_MAXIMIZE_CHANNEL)?.(event);
		await handlers.get(WINDOW_TOGGLE_MAXIMIZE_CHANNEL)?.(event);
		await handlers.get(WINDOW_CLOSE_CHANNEL)?.(event);

		expect(controls.minimize).toHaveBeenCalledOnce();
		expect(controls.maximize).toHaveBeenCalledOnce();
		expect(controls.unmaximize).toHaveBeenCalledOnce();
		expect(controls.close).toHaveBeenCalledOnce();
		expect(getWindowState(controls.window)).toEqual({ maximized: false });
	});
});

import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { DesktopWindowState } from '../src/lib/desktop-contract.js';

export const WINDOW_STATE_CHANNEL = 'desktop:window-state';
export const WINDOW_STATE_CHANGED_CHANNEL = 'desktop:window-state-changed';
export const WINDOW_MINIMIZE_CHANNEL = 'desktop:window-minimize';
export const WINDOW_TOGGLE_MAXIMIZE_CHANNEL = 'desktop:window-toggle-maximize';
export const WINDOW_CLOSE_CHANNEL = 'desktop:window-close';

export interface WindowControlsWindow {
	isDestroyed(): boolean;
	isMaximized(): boolean;
	minimize(): void;
	maximize(): void;
	unmaximize(): void;
	close(): void;
	on(event: 'maximize' | 'unmaximize', listener: () => void): this;
	removeListener(event: 'maximize' | 'unmaximize', listener: () => void): this;
}

export function getWindowState(window: WindowControlsWindow | undefined): DesktopWindowState {
	return { maximized: !!window && !window.isDestroyed() && window.isMaximized() };
}

export function bindWindowStateNotifications(
	window: WindowControlsWindow,
	send: (state: DesktopWindowState) => void
): () => void {
	const notify = (): void => send(getWindowState(window));
	window.on('maximize', notify);
	window.on('unmaximize', notify);

	return () => {
		window.removeListener('maximize', notify);
		window.removeListener('unmaximize', notify);
	};
}

interface IpcMainLike {
	handle(
		channel: string,
		listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
	): void;
}

export interface RegisterWindowControlsOptions {
	ipcMain: Pick<IpcMain, 'handle'> | IpcMainLike;
	getWindow: () => WindowControlsWindow | undefined;
	isTrustedSender: (event: IpcMainInvokeEvent) => boolean;
}

function assertTrustedSender(
	isTrustedSender: RegisterWindowControlsOptions['isTrustedSender'],
	event: IpcMainInvokeEvent
): void {
	if (!isTrustedSender(event)) {
		throw new Error('Untrusted IPC sender.');
	}
}

function requireWindow(
	getWindow: RegisterWindowControlsOptions['getWindow']
): WindowControlsWindow {
	const window = getWindow();
	if (!window || window.isDestroyed()) {
		throw new Error('The application window is unavailable.');
	}

	return window;
}

export function registerWindowControlsIpc({
	ipcMain,
	getWindow,
	isTrustedSender
}: RegisterWindowControlsOptions): void {
	ipcMain.handle(WINDOW_STATE_CHANNEL, (event) => {
		assertTrustedSender(isTrustedSender, event);

		return getWindowState(getWindow());
	});
	ipcMain.handle(WINDOW_MINIMIZE_CHANNEL, (event) => {
		assertTrustedSender(isTrustedSender, event);
		requireWindow(getWindow).minimize();
	});
	ipcMain.handle(WINDOW_TOGGLE_MAXIMIZE_CHANNEL, (event) => {
		assertTrustedSender(isTrustedSender, event);
		const window = requireWindow(getWindow);
		if (window.isMaximized()) {
			window.unmaximize();
		} else {
			window.maximize();
		}
	});
	ipcMain.handle(WINDOW_CLOSE_CHANNEL, (event) => {
		assertTrustedSender(isTrustedSender, event);
		requireWindow(getWindow).close();
	});
}

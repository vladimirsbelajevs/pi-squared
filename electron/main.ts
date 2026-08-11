import { app, BrowserWindow, ipcMain, Menu, shell, Tray, type IpcMainInvokeEvent } from 'electron';
import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectBootstrapStatus, runBootstrap, type BootstrapStatus } from './bootstrap.js';
import {
	checkForDesktopUpdate,
	configureDesktopUpdater,
	downloadDesktopUpdate,
	getDesktopUpdateStatus,
	installDesktopUpdate,
	subscribeDesktopUpdateStatus,
	UPDATE_CHECK_INTERVAL_MS,
	UPDATE_INITIAL_DELAY_MS
} from './updater.js';
import type {
	DesktopBootstrapProgress,
	DesktopPiUpdateProgress,
	DesktopPiUpdateStatus,
	DesktopUpdateStatus
} from '../src/lib/desktop-contract.js';
import { terminateChild } from './lifecycle.js';
import { runPiUpdate } from './pi-updater.js';
import { isTrustedAppUrl, isTrustedFrame } from './security.js';
import { bindWindowStateNotifications, registerWindowControlsIpc } from './window-controls.js';

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
	app.quit();
} else {
	void app
		.whenReady()
		.then(() => startApplication())
		.catch((error: unknown) => {
			console.error('Unable to start Pi Squared:', error);
			app.quit();
		});
}

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let serverProcess: ChildProcess | undefined;
let serverUrl: string | undefined;
let quitting = false;
let bootstrapRunning = false;
let piUpdateRunning = false;
let updateTimer: ReturnType<typeof setInterval> | undefined;
const shutdownToken = randomBytes(32).toString('hex');

function appRoot(): string {
	if (app.isPackaged) {
		return app.getAppPath();
	}

	return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

function resourceRoot(): string {
	return app.isPackaged ? process.resourcesPath : join(appRoot(), '');
}

function serverEntry(): string {
	return join(appRoot(), 'electron', 'dist', 'electron', 'server-entry.js');
}

function buildDirectory(): string {
	return join(appRoot(), 'build');
}

function sharedPermissionConfigPath(): string {
	return join(resourceRoot(), 'pi_setup', 'configs', 'permissions.json');
}

function getBootstrapStatus(): Promise<BootstrapStatus> {
	return detectBootstrapStatus({ sharedPermissionConfigPath: sharedPermissionConfigPath() });
}

function iconPath(): string {
	return app.isPackaged
		? join(process.resourcesPath, 'static', 'icon.png')
		: join(appRoot(), 'static', 'icon.png');
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
	const window = mainWindow;
	if (!window || window.isDestroyed() || !serverUrl) {
		return false;
	}

	return (
		event.sender === window.webContents &&
		event.senderFrame === window.webContents.mainFrame &&
		isTrustedFrame({
			senderId: event.sender.id,
			expectedSenderId: window.webContents.id,
			frameUrl: event.senderFrame?.url,
			mainFrameUrl: window.webContents.mainFrame.url,
			windowUrl: window.webContents.getURL(),
			serverUrl
		})
	);
}

function send(channel: string, payload: unknown): void {
	if (!mainWindow || mainWindow.isDestroyed()) {
		return;
	}

	mainWindow.webContents.send(channel, payload);
}

function focusWindow(): void {
	if (!mainWindow || mainWindow.isDestroyed()) {
		return;
	}

	if (mainWindow.isMinimized()) {
		mainWindow.restore();
	}

	mainWindow.show();
	mainWindow.focus();
}

async function waitForServer(child: ChildProcess): Promise<number> {
	return new Promise((resolvePort, reject) => {
		let output = '';
		const timeout = setTimeout(
			() => reject(new Error('The local Pi Squared server did not start in time.')),
			30_000
		);
		const finish = (error?: Error, port?: number): void => {
			clearTimeout(timeout);
			if (error) {
				reject(error);
			} else if (port !== undefined) {
				resolvePort(port);
			}
		};

		const consume = (chunk: string): void => {
			output += chunk;
			const lines = output.split(/\r?\n/);
			output = lines.pop() ?? '';
			for (const line of lines) {
				try {
					const message = JSON.parse(line) as { type?: string; port?: number };
					if (message.type === 'ready' && Number.isInteger(message.port)) {
						finish(undefined, message.port);
					}
				} catch {
					// Keep startup diagnostics on stderr while waiting for the ready record.
				}
			}
		};

		child.stdout?.setEncoding('utf8');
		child.stderr?.setEncoding('utf8');
		child.stdout?.on('data', consume);
		child.stderr?.on('data', (chunk: string) => process.stderr.write(`[pi-squared] ${chunk}`));
		child.once('error', (error) => finish(error));
		child.once('exit', (code, signal) => {
			if (code !== null || signal) {
				finish(new Error(`The local server exited before readiness (${code ?? signal}).`));
			}
		});
	});
}

async function waitForHealth(url: string, path = '/__pi_squared_health'): Promise<void> {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${url}${path}`, {
				signal: AbortSignal.timeout(2_000)
			});
			if (response.ok) {
				return;
			}
		} catch {
			// The server can emit ready just before its first request is accepted.
		}

		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	throw new Error('The local Pi Squared server health endpoint did not respond.');
}

async function startServer(): Promise<void> {
	if (serverProcess) {
		return;
	}

	const child = spawn(process.execPath, [serverEntry()], {
		env: {
			...process.env,
			ELECTRON_RUN_AS_NODE: '1',
			HOST: '127.0.0.1',
			PORT: '0',
			PI_SQUARED_DESKTOP: '1',
			PI_SQUARED_DATA_DIR: app.getPath('userData'),
			PI_SQUARED_BUILD_DIR: buildDirectory(),
			PI_SQUARED_SHUTDOWN_TOKEN: shutdownToken
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	serverProcess = child;
	try {
		const port = await waitForServer(child);
		serverUrl = `http://127.0.0.1:${port}`;
		await waitForHealth(serverUrl);
	} catch (error) {
		serverProcess = undefined;
		await terminateChild(child, 1_000);
		throw error;
	}

	child.once('exit', () => {
		if (serverProcess === child) {
			serverProcess = undefined;
			serverUrl = undefined;
		}
	});
}

async function stopServer(): Promise<void> {
	const child = serverProcess;
	serverProcess = undefined;
	serverUrl = undefined;
	if (!child) {
		return;
	}

	await terminateChild(child);
}

async function restartServer(): Promise<void> {
	if (process.env.PI_SQUARED_ELECTRON_DEV_URL) {
		return;
	}

	await stopServer();
	await startServer();
	if (mainWindow && serverUrl) {
		await mainWindow.loadURL(serverUrl);
	}
}

function configureWindowSecurity(window: BrowserWindow): void {
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:\/\//i.test(url)) {
			void shell.openExternal(url);
		}

		return { action: 'deny' };
	});
	window.webContents.on('will-navigate', (event, url) => {
		if (isTrustedAppUrl(url, serverUrl)) {
			return;
		}

		event.preventDefault();
		if (/^https?:\/\//i.test(url)) {
			void shell.openExternal(url);
		}
	});
}

function createTray(): void {
	tray = new Tray(iconPath());
	tray.setToolTip('Pi Squared');
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{ label: 'Show Pi Squared', click: focusWindow },
			{ type: 'separator' },
			{ label: 'Quit', click: () => void quitApplication() }
		])
	);
	tray.on('click', focusWindow);
}

function createWindow(): void {
	mainWindow = new BrowserWindow({
		width: 1440,
		height: 960,
		minWidth: 900,
		minHeight: 600,
		show: false,
		frame: false,
		icon: iconPath(),
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			preload: join(appRoot(), 'electron', 'dist', 'electron', 'preload.cjs')
		}
	});
	configureWindowSecurity(mainWindow);
	mainWindow.once('ready-to-show', () => mainWindow?.show());
	mainWindow.on('close', (event) => {
		if (quitting) {
			return;
		}

		event.preventDefault();
		mainWindow?.hide();
	});
	bindWindowStateNotifications(mainWindow, (state) => send('desktop:window-state-changed', state));
	if (serverUrl) {
		void mainWindow.loadURL(serverUrl);
	}
}

function toRendererBootstrapStatus(status: BootstrapStatus): BootstrapStatus {
	return status;
}

function registerIpc(): void {
	ipcMain.handle('desktop:bootstrap-status', async (event) => {
		if (!isTrustedSender(event)) {
			throw new Error('Untrusted IPC sender.');
		}

		return toRendererBootstrapStatus(await getBootstrapStatus());
	});
	ipcMain.handle('desktop:bootstrap-start', async (event) => {
		if (!isTrustedSender(event)) {
			throw new Error('Untrusted IPC sender.');
		}

		if (bootstrapRunning) {
			throw new Error('Pi setup is already running.');
		}

		bootstrapRunning = true;
		send('desktop:bootstrap-progress', {
			stream: 'system',
			text: 'Starting Pi setup…\n'
		} satisfies DesktopBootstrapProgress);
		try {
			await runBootstrap({
				resourceRoot: resourceRoot(),
				onOutput: (stream, text) =>
					send('desktop:bootstrap-progress', { stream, text } satisfies DesktopBootstrapProgress)
			});
			await restartServer();

			return await getBootstrapStatus();
		} catch (error) {
			const status = await getBootstrapStatus();

			return {
				...status,
				phase: 'failed',
				error: error instanceof Error ? error.message : String(error)
			};
		} finally {
			bootstrapRunning = false;
		}
	});
	ipcMain.handle('desktop:pi-update-start', async (event) => {
		if (!isTrustedSender(event)) {
			throw new Error('Untrusted IPC sender.');
		}

		if (piUpdateRunning) {
			return {
				phase: 'failed',
				error: 'A Pi update is already running.'
			} satisfies DesktopPiUpdateStatus;
		}

		piUpdateRunning = true;
		try {
			await runPiUpdate({
				onOutput: (progress) =>
					send('desktop:pi-update-progress', progress satisfies DesktopPiUpdateProgress)
			});
			send('desktop:pi-update-progress', {
				stream: 'system',
				text: 'Pi and its extensions were updated. Restarting the local server…\n'
			} satisfies DesktopPiUpdateProgress);
			setTimeout(() => {
				void restartServer().catch((error: unknown) =>
					send('desktop:pi-update-progress', {
						stream: 'stderr',
						text: `Unable to restart the local server: ${error instanceof Error ? error.message : String(error)}\n`
					} satisfies DesktopPiUpdateProgress)
				);
			}, 250);

			return { phase: 'success' } satisfies DesktopPiUpdateStatus;
		} catch (error) {
			return {
				phase: 'failed',
				error: error instanceof Error ? error.message : String(error)
			} satisfies DesktopPiUpdateStatus;
		} finally {
			piUpdateRunning = false;
		}
	});
	ipcMain.handle('desktop:update-status', (event) => {
		if (!isTrustedSender(event)) {
			throw new Error('Untrusted IPC sender.');
		}

		return getDesktopUpdateStatus();
	});
	ipcMain.handle('desktop:update-check', async (event) => {
		if (!isTrustedSender(event)) {
			throw new Error('Untrusted IPC sender.');
		}

		return await checkForDesktopUpdate();
	});
	ipcMain.handle('desktop:update-download', async (event) => {
		if (!isTrustedSender(event)) {
			throw new Error('Untrusted IPC sender.');
		}

		return await downloadDesktopUpdate();
	});
	ipcMain.handle('desktop:update-install', async (event) => {
		if (!isTrustedSender(event)) {
			throw new Error('Untrusted IPC sender.');
		}

		await stopServer();
		installDesktopUpdate();
	});
	ipcMain.handle('desktop:version', (event) => {
		if (!isTrustedSender(event)) {
			throw new Error('Untrusted IPC sender.');
		}

		return app.getVersion();
	});
	ipcMain.handle('desktop:quit', async (event) => {
		if (!isTrustedSender(event)) {
			throw new Error('Untrusted IPC sender.');
		}

		await quitApplication();
	});
	registerWindowControlsIpc({
		ipcMain,
		getWindow: () => mainWindow,
		isTrustedSender
	});
}

process.once('SIGTERM', () => void quitApplication());
process.once('SIGINT', () => void quitApplication());

async function quitApplication(): Promise<void> {
	if (quitting) {
		return;
	}

	quitting = true;
	if (updateTimer) {
		clearInterval(updateTimer);
	}

	tray?.destroy();
	await stopServer();
	app.quit();
}

function configureUpdates(): void {
	if (!app.isPackaged) {
		return;
	}

	configureDesktopUpdater();
	subscribeDesktopUpdateStatus((status: DesktopUpdateStatus) =>
		send('desktop:update-status', status)
	);
	setTimeout(() => void checkForDesktopUpdate(), UPDATE_INITIAL_DELAY_MS);
	updateTimer = setInterval(() => void checkForDesktopUpdate(), UPDATE_CHECK_INTERVAL_MS);
}

async function startApplication(): Promise<void> {
	Menu.setApplicationMenu(null);
	app.on('second-instance', () => focusWindow());
	app.on('before-quit', (event) => {
		if (!quitting) {
			event.preventDefault();
			void quitApplication();

			return;
		}

		if (updateTimer) {
			clearInterval(updateTimer);
		}
	});
	registerIpc();
	const devServerUrl = process.env.PI_SQUARED_ELECTRON_DEV_URL;
	if (devServerUrl) {
		serverUrl = devServerUrl;
		await waitForHealth(serverUrl, '/api/health');
	} else {
		await access(join(buildDirectory(), 'handler.js'));
		await startServer();
		if (process.env.PI_SQUARED_PACKAGED_SMOKE === '1' && serverUrl) {
			console.log(JSON.stringify({ type: 'desktop-ready', url: serverUrl }));
		}
	}

	createWindow();
	createTray();
	configureUpdates();
	app.on('activate', focusWindow);
}

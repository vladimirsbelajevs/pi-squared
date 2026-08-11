// Electron sandboxed preloads must be CommonJS; the require import is intentional.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import electron = require('electron');

const { contextBridge, ipcRenderer } = electron;
import type {
	DesktopBootstrapProgress,
	DesktopBootstrapStatus,
	DesktopPiUpdateProgress,
	DesktopWindowState,
	DesktopPiUpdateStatus,
	DesktopUpdateStatus,
	LanSharingStatus,
	PiSquaredDesktopApi
} from '../src/lib/desktop-contract.js';

const api: PiSquaredDesktopApi = {
	mode: 'electron',
	getBootstrapStatus: () =>
		ipcRenderer.invoke('desktop:bootstrap-status') as Promise<DesktopBootstrapStatus>,
	startBootstrap: () =>
		ipcRenderer.invoke('desktop:bootstrap-start') as Promise<DesktopBootstrapStatus>,
	onBootstrapProgress: (listener) => {
		const handler = (_event: Electron.IpcRendererEvent, progress: DesktopBootstrapProgress) =>
			listener(progress);
		ipcRenderer.on('desktop:bootstrap-progress', handler);

		return () => ipcRenderer.removeListener('desktop:bootstrap-progress', handler);
	},
	startPiUpdate: () =>
		ipcRenderer.invoke('desktop:pi-update-start') as Promise<DesktopPiUpdateStatus>,
	onPiUpdateProgress: (listener) => {
		const handler = (_event: Electron.IpcRendererEvent, progress: DesktopPiUpdateProgress) =>
			listener(progress);
		ipcRenderer.on('desktop:pi-update-progress', handler);

		return () => ipcRenderer.removeListener('desktop:pi-update-progress', handler);
	},
	getUpdateStatus: () =>
		ipcRenderer.invoke('desktop:update-status') as Promise<DesktopUpdateStatus>,
	checkForUpdates: () => ipcRenderer.invoke('desktop:update-check') as Promise<DesktopUpdateStatus>,
	onUpdateStatus: (listener) => {
		const handler = (_event: Electron.IpcRendererEvent, status: DesktopUpdateStatus) =>
			listener(status);
		ipcRenderer.on('desktop:update-status', handler);

		return () => ipcRenderer.removeListener('desktop:update-status', handler);
	},
	downloadUpdate: () =>
		ipcRenderer.invoke('desktop:update-download') as Promise<DesktopUpdateStatus>,
	restartAndInstall: () => ipcRenderer.invoke('desktop:update-install') as Promise<void>,
	getLanSharingStatus: () =>
		ipcRenderer.invoke('desktop:lan-sharing-status') as Promise<LanSharingStatus>,
	setLanSharingConfig: (config) =>
		ipcRenderer.invoke('desktop:lan-sharing-config', config) as Promise<LanSharingStatus>,
	onLanSharingStatus: (listener) => {
		const handler = (_event: Electron.IpcRendererEvent, status: LanSharingStatus) =>
			listener(status);
		ipcRenderer.on('desktop:lan-sharing-status', handler);

		return () => ipcRenderer.removeListener('desktop:lan-sharing-status', handler);
	},
	approveLanPairing: (nonce) =>
		ipcRenderer.invoke('desktop:lan-pairing-approve', nonce) as Promise<void>,
	createLanPairingCode: (deviceName) =>
		ipcRenderer.invoke('desktop:lan-pairing-code', deviceName) as Promise<{ expiresAt: string }>,
	rejectLanPairing: (nonce) =>
		ipcRenderer.invoke('desktop:lan-pairing-reject', nonce) as Promise<void>,
	revokeLanDevice: (id) => ipcRenderer.invoke('desktop:lan-device-revoke', id) as Promise<void>,
	exportLanCa: () =>
		ipcRenderer.invoke('desktop:lan-ca-export') as Promise<{ path: string; fingerprint: string }>,
	resetLanTls: () => ipcRenderer.invoke('desktop:lan-tls-reset') as Promise<LanSharingStatus>,
	quit: () => ipcRenderer.invoke('desktop:quit') as Promise<void>,
	getVersion: () => ipcRenderer.invoke('desktop:version') as Promise<string>,
	windowControls: {
		getState: () => ipcRenderer.invoke('desktop:window-state') as Promise<DesktopWindowState>,
		onStateChange: (listener) => {
			const handler = (_event: Electron.IpcRendererEvent, state: DesktopWindowState) =>
				listener(state);
			ipcRenderer.on('desktop:window-state-changed', handler);

			return () => ipcRenderer.removeListener('desktop:window-state-changed', handler);
		},
		minimize: () => ipcRenderer.invoke('desktop:window-minimize') as Promise<void>,
		toggleMaximize: () => ipcRenderer.invoke('desktop:window-toggle-maximize') as Promise<void>,
		close: () => ipcRenderer.invoke('desktop:window-close') as Promise<void>
	}
};

contextBridge.exposeInMainWorld('piSquaredDesktop', api);

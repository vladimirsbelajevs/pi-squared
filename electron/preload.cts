// Electron sandboxed preloads must be CommonJS; the require import is intentional.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import electron = require('electron');

const { contextBridge, ipcRenderer } = electron;
import type {
	DesktopBootstrapProgress,
	DesktopBootstrapStatus,
	DesktopUpdateStatus,
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
	quit: () => ipcRenderer.invoke('desktop:quit') as Promise<void>,
	getVersion: () => ipcRenderer.invoke('desktop:version') as Promise<string>
};

contextBridge.exposeInMainWorld('piSquaredDesktop', api);

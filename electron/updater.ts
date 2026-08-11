import type { UpdateCheckResult } from 'electron-updater';
import electronUpdater from 'electron-updater';
import type { DesktopUpdateStatus } from '../src/lib/desktop-contract.js';

const { autoUpdater } = electronUpdater;

export const UPDATE_CHECK_INTERVAL_MS = 5 * 24 * 60 * 60 * 1000;
export const UPDATE_INITIAL_DELAY_MS = 2_000;

export type UpdateStatusListener = (status: DesktopUpdateStatus) => void;

let status: DesktopUpdateStatus = { phase: 'idle' };
const listeners = new Set<UpdateStatusListener>();

function publish(next: DesktopUpdateStatus): DesktopUpdateStatus {
	status = next;
	for (const listener of listeners) {
		listener(status);
	}

	return status;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function getDesktopUpdateStatus(): DesktopUpdateStatus {
	return status;
}

export function subscribeDesktopUpdateStatus(listener: UpdateStatusListener): () => void {
	listeners.add(listener);

	return () => listeners.delete(listener);
}

export function configureDesktopUpdater(): void {
	autoUpdater.autoDownload = false;
	autoUpdater.autoInstallOnAppQuit = false;
	autoUpdater.on('checking-for-update', () => publish({ phase: 'checking' }));
	autoUpdater.on('update-not-available', () => publish({ phase: 'not-available' }));
	autoUpdater.on('update-available', (info) =>
		publish({
			phase: 'available',
			version: info.version,
			releaseName: info.releaseName ?? undefined
		})
	);
	autoUpdater.on('download-progress', (progress) =>
		publish({
			phase: 'downloading',
			percent: progress.percent,
			bytesPerSecond: progress.bytesPerSecond,
			transferred: progress.transferred,
			total: progress.total
		})
	);
	autoUpdater.on('update-downloaded', (info) =>
		publish({
			phase: 'downloaded',
			version: info.version,
			releaseName: info.releaseName ?? undefined
		})
	);
	autoUpdater.on('error', (error) => publish({ phase: 'error', error: errorMessage(error) }));
}

export async function checkForDesktopUpdate(): Promise<DesktopUpdateStatus> {
	publish({ phase: 'checking' });
	try {
		const result = (await autoUpdater.checkForUpdates()) as UpdateCheckResult | null;
		if (!result) {
			return getDesktopUpdateStatus();
		}

		return getDesktopUpdateStatus();
	} catch (error) {
		return publish({ phase: 'error', error: errorMessage(error) });
	}
}

export async function downloadDesktopUpdate(): Promise<DesktopUpdateStatus> {
	if (status.phase !== 'available') {
		return status;
	}

	publish({ ...status, phase: 'downloading', percent: 0 });
	try {
		await autoUpdater.downloadUpdate();
	} catch (error) {
		publish({ phase: 'error', error: errorMessage(error) });
	}

	return getDesktopUpdateStatus();
}

export function installDesktopUpdate(): void {
	autoUpdater.quitAndInstall(false, true);
}

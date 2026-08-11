export type DesktopRuntimeMode = 'source-web' | 'electron';

export type DesktopBootstrapPhase = 'checking' | 'ready' | 'needs-setup' | 'running' | 'failed';

export interface DesktopBootstrapStatus {
	phase: DesktopBootstrapPhase;
	configured: boolean;
	prerequisites: {
		node: boolean;
		npm: boolean;
		pi: boolean;
	};
	missingPackages: string[];
	permissionConfig: boolean;
	error?: string;
}

export interface DesktopBootstrapProgress {
	stream: 'stdout' | 'stderr' | 'system';
	text: string;
}

export type DesktopUpdatePhase =
	'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error';

export interface DesktopUpdateStatus {
	phase: DesktopUpdatePhase;
	version?: string;
	releaseName?: string;
	percent?: number;
	bytesPerSecond?: number;
	transferred?: number;
	total?: number;
	error?: string;
}

export interface PiSquaredDesktopApi {
	readonly mode: 'electron';
	getBootstrapStatus(): Promise<DesktopBootstrapStatus>;
	startBootstrap(): Promise<DesktopBootstrapStatus>;
	onBootstrapProgress(listener: (progress: DesktopBootstrapProgress) => void): () => void;
	getUpdateStatus(): Promise<DesktopUpdateStatus>;
	checkForUpdates(): Promise<DesktopUpdateStatus>;
	onUpdateStatus(listener: (status: DesktopUpdateStatus) => void): () => void;
	downloadUpdate(): Promise<DesktopUpdateStatus>;
	restartAndInstall(): Promise<void>;
	quit(): Promise<void>;
	getVersion(): Promise<string>;
}

export function isPiSquaredDesktopApi(value: unknown): value is PiSquaredDesktopApi {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const api = value as Partial<PiSquaredDesktopApi>;

	return (
		api.mode === 'electron' &&
		typeof api.getBootstrapStatus === 'function' &&
		typeof api.startBootstrap === 'function' &&
		typeof api.onBootstrapProgress === 'function' &&
		typeof api.getUpdateStatus === 'function' &&
		typeof api.checkForUpdates === 'function' &&
		typeof api.onUpdateStatus === 'function' &&
		typeof api.downloadUpdate === 'function' &&
		typeof api.restartAndInstall === 'function' &&
		typeof api.quit === 'function' &&
		typeof api.getVersion === 'function'
	);
}

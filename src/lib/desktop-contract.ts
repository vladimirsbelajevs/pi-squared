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

export type DesktopPiUpdatePhase = 'idle' | 'running' | 'success' | 'failed';

export interface DesktopPiUpdateStatus {
	phase: DesktopPiUpdatePhase;
	error?: string;
}

export interface DesktopPiUpdateProgress {
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

export interface DesktopWindowState {
	maximized: boolean;
}

export interface LanSharingBinding {
	interfaceName: string;
	address: string;
	family: 'IPv4' | 'IPv6';
}

export interface LanSharingAddress {
	interfaceName: string;
	address: string;
	family: 'IPv4' | 'IPv6';
	internal: boolean;
	risk: string[];
	label: string;
	recommended?: boolean;
}

export interface LanSharingListener {
	binding: LanSharingBinding;
	state: 'listening' | 'missing' | 'error' | 'stopped';
	error?: string;
	url?: string;
}

export interface LanSharingDevice {
	id: string;
	host: string;
	deviceName: string;
	createdAt: string;
	lastSeenAt: string;
	expiresAt: string;
}

export interface LanSharingPendingPairing {
	nonce: string;
	status: 'pending' | 'approved' | 'rejected' | 'expired';
	createdAt: string;
	expiresAt: string;
	host: string;
	deviceName: string;
}

export interface LanSharingStatus {
	available: LanSharingAddress[];
	config: { enabled: boolean; port: number; bindings: LanSharingBinding[]; dnsNames: string[] };
	listeners: LanSharingListener[];
	urls: string[];
	caFingerprint?: string;
	caNotAfter?: string;
	leafNotAfter?: string;
	keyProtectionWarning?: string;
	pairing: { pending: LanSharingPendingPairing[]; devices: LanSharingDevice[] };
}

export interface PiSquaredDesktopWindowControls {
	getState(): Promise<DesktopWindowState>;
	onStateChange(listener: (state: DesktopWindowState) => void): () => void;
	minimize(): Promise<void>;
	toggleMaximize(): Promise<void>;
	close(): Promise<void>;
}

export interface PiSquaredDesktopApi {
	readonly mode: 'electron';
	readonly windowControls: PiSquaredDesktopWindowControls;
	getBootstrapStatus(): Promise<DesktopBootstrapStatus>;
	startBootstrap(): Promise<DesktopBootstrapStatus>;
	onBootstrapProgress(listener: (progress: DesktopBootstrapProgress) => void): () => void;
	startPiUpdate(): Promise<DesktopPiUpdateStatus>;
	onPiUpdateProgress(listener: (progress: DesktopPiUpdateProgress) => void): () => void;
	getUpdateStatus(): Promise<DesktopUpdateStatus>;
	checkForUpdates(): Promise<DesktopUpdateStatus>;
	onUpdateStatus(listener: (status: DesktopUpdateStatus) => void): () => void;
	downloadUpdate(): Promise<DesktopUpdateStatus>;
	restartAndInstall(): Promise<void>;
	getLanSharingStatus(): Promise<LanSharingStatus>;
	setLanSharingConfig(config: LanSharingStatus['config']): Promise<LanSharingStatus>;
	onLanSharingStatus(listener: (status: LanSharingStatus) => void): () => void;
	approveLanPairing(nonce: string): Promise<void>;
	createLanPairingCode(deviceName: string): Promise<{ expiresAt: string }>;
	rejectLanPairing(nonce: string): Promise<void>;
	revokeLanDevice(id: string): Promise<void>;
	exportLanCa(): Promise<{ path: string; fingerprint: string }>;
	resetLanTls(): Promise<LanSharingStatus>;
	quit(): Promise<void>;
	getVersion(): Promise<string>;
}

export function isPiSquaredDesktopApi(value: unknown): value is PiSquaredDesktopApi {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const api = value as Partial<PiSquaredDesktopApi>;
	const windowControls = api.windowControls;

	return (
		api.mode === 'electron' &&
		!!windowControls &&
		typeof windowControls === 'object' &&
		typeof windowControls.getState === 'function' &&
		typeof windowControls.onStateChange === 'function' &&
		typeof windowControls.minimize === 'function' &&
		typeof windowControls.toggleMaximize === 'function' &&
		typeof windowControls.close === 'function' &&
		typeof api.getBootstrapStatus === 'function' &&
		typeof api.startBootstrap === 'function' &&
		typeof api.onBootstrapProgress === 'function' &&
		typeof api.startPiUpdate === 'function' &&
		typeof api.onPiUpdateProgress === 'function' &&
		typeof api.getUpdateStatus === 'function' &&
		typeof api.checkForUpdates === 'function' &&
		typeof api.onUpdateStatus === 'function' &&
		typeof api.downloadUpdate === 'function' &&
		typeof api.restartAndInstall === 'function' &&
		typeof api.getLanSharingStatus === 'function' &&
		typeof api.setLanSharingConfig === 'function' &&
		typeof api.onLanSharingStatus === 'function' &&
		typeof api.approveLanPairing === 'function' &&
		typeof api.createLanPairingCode === 'function' &&
		typeof api.rejectLanPairing === 'function' &&
		typeof api.revokeLanDevice === 'function' &&
		typeof api.exportLanCa === 'function' &&
		typeof api.resetLanTls === 'function' &&
		typeof api.quit === 'function' &&
		typeof api.getVersion === 'function'
	);
}

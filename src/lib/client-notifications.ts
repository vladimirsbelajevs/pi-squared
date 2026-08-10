import { asset } from '$app/paths';

export const NOTIFICATION_KINDS = ['agent-complete', 'permission-required'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
export type NotificationPermissionStatus = 'unsupported' | 'default' | 'granted' | 'denied';

export interface AudioElementAdapter {
	currentTime: number;
	volume: number;
	play: () => void | Promise<void>;
}

export interface SystemNotificationAdapter {
	onclick: ((event: Event) => void) | null;
	onclose: ((event: Event) => void) | null;
	close: () => void;
}

export interface NotificationConstructorAdapter {
	readonly permission: NotificationPermission;
	requestPermission: () => Promise<NotificationPermission>;
	new (title: string, options?: NotificationOptions): SystemNotificationAdapter;
}

export interface ClientNotificationAdapters {
	createAudio?: (url: string) => AudioElementAdapter;
	notification?: NotificationConstructorAdapter;
	window?: Pick<Window, 'focus'>;
	onError?: (error: unknown) => void;
}

export interface SystemNotificationRequest {
	kind: NotificationKind;
	title: string;
	body: string;
	tag: string;
	onClick?: () => void | Promise<void>;
}

export interface NotificationService {
	permissionStatus(): NotificationPermissionStatus;
	requestPermission(): Promise<NotificationPermissionStatus>;
	playSound(kind: NotificationKind, volume?: number): Promise<void>;
	showSystemNotification(request: SystemNotificationRequest): boolean;
}

const SOUND_PATHS: Record<NotificationKind, string> = {
	'agent-complete': '/sounds/agent-complete.mp3',
	'permission-required': '/sounds/permission-required.mp3'
};

function currentNotificationConstructor(): NotificationConstructorAdapter | undefined {
	if (typeof globalThis.Notification !== 'function') {
		return undefined;
	}

	return globalThis.Notification as unknown as NotificationConstructorAdapter;
}

function currentAudioFactory(): ((url: string) => AudioElementAdapter) | undefined {
	if (typeof globalThis.Audio !== 'function') {
		return undefined;
	}

	return (url) => new globalThis.Audio(url);
}

export function notificationPermissionStatus(
	notification = currentNotificationConstructor()
): NotificationPermissionStatus {
	if (!notification) {
		return 'unsupported';
	}

	const permission = notification.permission;

	return permission === 'default' || permission === 'granted' || permission === 'denied'
		? permission
		: 'unsupported';
}

/**
 * Browser-only integration for opt-in notification sounds and OS notifications.
 * The class deliberately contains no application state, so it can be imported during SSR.
 */
export class ClientNotificationService implements NotificationService {
	readonly #adapters: ClientNotificationAdapters;
	readonly #audio = new Map<NotificationKind, AudioElementAdapter>();
	readonly #activeNotifications = new Map<string, SystemNotificationAdapter>();

	constructor(adapters: ClientNotificationAdapters = {}) {
		this.#adapters = adapters;
	}

	permissionStatus(): NotificationPermissionStatus {
		try {
			return notificationPermissionStatus(
				this.#adapters.notification ?? currentNotificationConstructor()
			);
		} catch (error) {
			this.#report(error);

			return 'unsupported';
		}
	}

	async requestPermission(): Promise<NotificationPermissionStatus> {
		const notification = this.#adapters.notification ?? currentNotificationConstructor();
		if (!notification) {
			return 'unsupported';
		}

		const current = this.permissionStatus();
		if (current === 'denied' || current === 'granted') {
			return current;
		}

		try {
			await notification.requestPermission();

			return this.permissionStatus();
		} catch (error) {
			this.#report(error);

			return this.permissionStatus();
		}
	}

	playSound(kind: NotificationKind, volume = 1): Promise<void> {
		const factory = this.#adapters.createAudio ?? currentAudioFactory();
		if (!factory) {
			return Promise.resolve();
		}

		let audio: AudioElementAdapter;
		try {
			audio = this.#audio.get(kind) ?? factory(asset(SOUND_PATHS[kind]));
			this.#audio.set(kind, audio);
			audio.currentTime = 0;
			audio.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
		} catch (error) {
			this.#report(error);

			return Promise.resolve();
		}

		try {
			return Promise.resolve(audio.play()).catch((error: unknown) => {
				this.#report(error);
			});
		} catch (error) {
			this.#report(error);

			return Promise.resolve();
		}
	}

	showSystemNotification(request: SystemNotificationRequest): boolean {
		const notification = this.#adapters.notification ?? currentNotificationConstructor();
		if (!notification || this.permissionStatus() !== 'granted') {
			return false;
		}

		const previous = this.#activeNotifications.get(request.tag);
		if (previous) {
			try {
				previous.close();
			} catch (error) {
				this.#report(error);
			}

			this.#activeNotifications.delete(request.tag);
		}

		let instance: SystemNotificationAdapter;
		try {
			instance = new notification(request.title, {
				body: request.body,
				tag: request.tag
			});
		} catch (error) {
			this.#report(error);

			return false;
		}

		this.#activeNotifications.set(request.tag, instance);
		const cleanup = (): void => {
			if (this.#activeNotifications.get(request.tag) === instance) {
				this.#activeNotifications.delete(request.tag);
			}
		};

		instance.onclose = cleanup;
		instance.onclick = () => {
			cleanup();
			try {
				this.#adapters.window?.focus();
				if (!this.#adapters.window && typeof globalThis.window !== 'undefined') {
					globalThis.window.focus();
				}
			} catch (error) {
				this.#report(error);
			}

			try {
				void Promise.resolve(request.onClick?.()).catch((error: unknown) => this.#report(error));
			} catch (error) {
				this.#report(error);
			}

			try {
				instance.close();
			} catch (error) {
				this.#report(error);
			}
		};

		return true;
	}

	#report(error: unknown): void {
		try {
			this.#adapters.onError?.(error);
		} catch {
			// Error reporting must never interfere with chat event processing.
		}
	}
}

export function soundAssetUrl(kind: NotificationKind): string {
	return asset(SOUND_PATHS[kind]);
}

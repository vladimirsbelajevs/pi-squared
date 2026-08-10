import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	ClientNotificationService,
	notificationPermissionStatus,
	type AudioElementAdapter,
	type NotificationConstructorAdapter,
	type SystemNotificationAdapter
} from './client-notifications';

class FakeNotification implements SystemNotificationAdapter {
	static permission: NotificationPermission = 'granted';
	static requestPermission = vi.fn(async () => FakeNotification.permission);
	static instances: FakeNotification[] = [];
	readonly title: string;
	readonly options: NotificationOptions | undefined;
	onclick: ((event: Event) => void) | null = null;
	onclose: ((event: Event) => void) | null = null;
	close = vi.fn(() => this.onclose?.(new Event('close')));

	constructor(title: string, options?: NotificationOptions) {
		this.title = title;
		this.options = options;
		FakeNotification.instances.push(this);
	}
}

function notificationAdapter(): NotificationConstructorAdapter {
	return FakeNotification as unknown as NotificationConstructorAdapter;
}

afterEach(() => {
	FakeNotification.permission = 'granted';
	FakeNotification.requestPermission.mockReset();
	FakeNotification.requestPermission.mockImplementation(async () => FakeNotification.permission);
	FakeNotification.instances = [];
	vi.unstubAllGlobals();
});

describe('ClientNotificationService', () => {
	it('is safe when browser APIs are unavailable', async () => {
		const service = new ClientNotificationService();

		expect(service.permissionStatus()).toBe('unsupported');
		expect(await service.requestPermission()).toBe('unsupported');
		await expect(service.playSound('agent-complete')).resolves.toBeUndefined();
		expect(
			service.showSystemNotification({
				kind: 'agent-complete',
				title: 'Title',
				body: 'Body',
				tag: 'test'
			})
		).toBe(false);
	});

	it('lazily caches audio, resolves asset URLs, and resets playback position', async () => {
		const audios: AudioElementAdapter[] = [];
		const service = new ClientNotificationService({
			createAudio: (url) => {
				const audio: AudioElementAdapter = {
					currentTime: 12,
					volume: 1,
					play: vi.fn()
				};
				(audios as Array<AudioElementAdapter & { url?: string }>).push(
					Object.assign(audio, { url })
				);

				return audio;
			}
		});

		await service.playSound('permission-required', 0.25);
		await service.playSound('permission-required', 0.8);

		expect(audios).toHaveLength(1);
		expect((audios[0] as AudioElementAdapter & { url: string }).url).toContain(
			'/sounds/permission-required.mp3'
		);
		expect(audios[0].currentTime).toBe(0);
		expect(audios[0].volume).toBe(0.8);
		expect(audios[0].play).toHaveBeenCalledTimes(2);
	});

	it('swallows rejected audio playback', async () => {
		const onError = vi.fn();
		const service = new ClientNotificationService({
			createAudio: () => ({
				currentTime: 0,
				volume: 1,
				play: () => Promise.reject(new Error('autoplay blocked'))
			}),
			onError
		});

		await expect(service.playSound('agent-complete')).resolves.toBeUndefined();
		expect(onError).toHaveBeenCalledTimes(1);
	});

	it('maps permission status and requests permission explicitly', async () => {
		FakeNotification.permission = 'default';
		FakeNotification.requestPermission.mockImplementation(async () => {
			FakeNotification.permission = 'granted';

			return 'granted';
		});
		const service = new ClientNotificationService({ notification: notificationAdapter() });

		expect(notificationPermissionStatus(notificationAdapter())).toBe('default');
		expect(service.permissionStatus()).toBe('default');

		expect(await service.requestPermission()).toBe('granted');
		expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
	});

	it('does not create a system notification unless permission is granted', () => {
		FakeNotification.permission = 'denied';
		const service = new ClientNotificationService({ notification: notificationAdapter() });

		expect(
			service.showSystemNotification({
				kind: 'permission-required',
				title: 'Permission required',
				body: 'Review it',
				tag: 'runtime:permission'
			})
		).toBe(false);
		expect(FakeNotification.instances).toHaveLength(0);
	});

	it('sets notification metadata, focuses, invokes click cleanup, and replaces by tag', async () => {
		const focus = vi.fn();
		const onClick = vi.fn();
		const service = new ClientNotificationService({
			notification: notificationAdapter(),
			window: { focus }
		});
		const request = {
			kind: 'agent-complete' as const,
			title: 'Pi Squared · Agent finished',
			body: 'Chat: ready',
			tag: 'agent-complete:runtime-1',
			onClick
		};

		expect(service.showSystemNotification(request)).toBe(true);
		const first = FakeNotification.instances[0];
		expect(first.title).toBe(request.title);
		expect(first.options).toEqual({ body: request.body, tag: request.tag });
		expect(service.showSystemNotification(request)).toBe(true);
		expect(first.close).toHaveBeenCalledTimes(1);

		const second = FakeNotification.instances[1];
		second.onclick?.(new Event('click'));
		await Promise.resolve();
		expect(focus).toHaveBeenCalledTimes(1);
		expect(onClick).toHaveBeenCalledTimes(1);
		expect(second.close).toHaveBeenCalledTimes(1);
	});
});

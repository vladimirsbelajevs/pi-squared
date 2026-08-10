import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
	ChatItem,
	RuntimeCheckpoint,
	RuntimeEvent,
	RuntimeMutation,
	StreamMessage
} from '$lib/contracts';
import type { NotificationService } from '$lib/client-notifications';

const api = vi.hoisted(() => ({
	abortRuntime: vi.fn(),
	addProject: vi.fn(),
	createRuntime: vi.fn(),
	disposeRuntime: vi.fn(),
	getRuntime: vi.fn(),
	listModels: vi.fn(),
	listProjects: vi.fn(),
	listSessions: vi.fn(),
	openEventStream: vi.fn(),
	promptRuntime: vi.fn(),
	respondToPermission: vi.fn(),
	setRuntimeMcpServerEnabled: vi.fn(),
	setRuntimeModel: vi.fn(),
	setRuntimeThinking: vi.fn()
}));

vi.mock('$lib/harness/api', () => api);

import { HarnessWorkspace } from './workspace.svelte';

const STORAGE_KEY = 'pi-squared:workspace:v1';
const CURSOR_KEY = 'pi-squared:event-cursor:v2';
let storageValues: Map<string, string>;
let setItem: ReturnType<typeof vi.fn>;
let removeItem: ReturnType<typeof vi.fn>;

type CheckpointOptions = {
	revision?: number;
	cursorEpoch?: string;
	cursorSequence?: number;
	items?: ChatItem[];
	sessionName?: string;
	projectId?: string;
};

function checkpoint(
	runtimeId: string,
	sessionId = 'session-1',
	isStreaming = false,
	options: CheckpointOptions = {}
): RuntimeCheckpoint {
	const {
		revision = 1,
		cursorEpoch = 'test',
		cursorSequence = 1,
		items = [],
		sessionName,
		projectId = 'project-1'
	} = options;

	return {
		protocolVersion: 2,
		cursor: { epoch: cursorEpoch, sequence: cursorSequence },
		revision,
		snapshot: {
			runtimeId,
			project: {
				id: projectId,
				name: 'Project',
				cwd: '/tmp/project',
				addedAt: '',
				lastOpenedAt: ''
			},
			sessionId,
			thinkingLevel: 'medium',
			isStreaming,
			...(sessionName === undefined ? {} : { sessionName }),
			items,
			permissionRequests: []
		},
		live: { text: '', thinking: '', tools: [] }
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});

	return { promise, resolve, reject };
}

function storedChats(count: number) {
	return {
		version: 1,
		activeTabId: 'chat-0',
		tabs: Array.from({ length: count }, (_, index) => ({
			kind: 'chat',
			id: `chat-${index}`,
			title: `Chat ${index}`,
			projectId: 'project-1',
			sessionId: `session-${index}`,
			runtimeId: `runtime-${index}`,
			draft: `draft ${index}`,
			queueMode: 'followUp'
		}))
	};
}

function item(id: string, role: ChatItem['role'] = 'assistant', text = id): ChatItem {
	return { id, kind: 'message', role, text };
}

function captureEventStream() {
	let receive: ((message: StreamMessage) => void) | undefined;
	const close = vi.fn();
	api.openEventStream.mockImplementation((_lastEventId, onEvent) => {
		receive = onEvent;

		return { close };
	});

	return {
		close,
		receive(message: StreamMessage): void {
			if (!receive) {
				throw new Error('Event stream is not connected.');
			}

			receive(message);
		}
	};
}

function sendEvent(
	stream: ReturnType<typeof captureEventStream>,
	id: string,
	runtimeId: string,
	event: RuntimeEvent,
	sequence: number
): void {
	stream.receive({ id, cursor: { epoch: 'test', sequence }, runtimeId, event });
}

function sendRevisionedEvent(
	stream: ReturnType<typeof captureEventStream>,
	id: string,
	runtimeId: string,
	event: RuntimeMutation,
	baseRevision: number,
	revision: number,
	sequence = revision
): void {
	stream.receive({
		id,
		cursor: { epoch: 'test', sequence },
		runtimeId,
		event: { ...event, baseRevision, revision }
	});
}

function workspaceDocument(): Record<string, unknown> {
	const raw = storageValues.get(STORAGE_KEY);
	if (!raw) {
		throw new Error('Workspace was not persisted.');
	}

	return JSON.parse(raw) as Record<string, unknown>;
}

function writesFor(key: string): string[][] {
	return setItem.mock.calls.filter(([calledKey]) => calledKey === key);
}

function clearStorageSpies(): void {
	setItem.mockClear();
	removeItem.mockClear();
}

function stubPagehide() {
	const listeners = new Map<string, () => void>();
	const addEventListener = vi.fn((type: string, listener: () => void) => {
		listeners.set(type, listener);
	});
	const removeEventListener = vi.fn((type: string, listener: () => void) => {
		if (listeners.get(type) === listener) {
			listeners.delete(type);
		}
	});
	vi.stubGlobal('window', { addEventListener, removeEventListener });

	return {
		addEventListener,
		removeEventListener,
		dispatch(): void {
			listeners.get('pagehide')?.();
		},
		listenerCount(): number {
			return listeners.size;
		}
	};
}

beforeEach(() => {
	storageValues = new Map<string, string>();
	setItem = vi.fn((key: string, value: string) => storageValues.set(key, value));
	removeItem = vi.fn((key: string) => storageValues.delete(key));
	vi.stubGlobal('document', {
		documentElement: { dataset: {} },
		visibilityState: 'visible',
		hasFocus: () => true
	});
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => storageValues.get(key) ?? null,
		setItem,
		removeItem
	});
	api.listProjects.mockResolvedValue({ projects: [] });
	api.listModels.mockResolvedValue({ models: [] });
	api.listSessions.mockResolvedValue({ sessions: [] });
	api.openEventStream.mockReset();
	api.openEventStream.mockReturnValue({ close: vi.fn() });
	api.getRuntime.mockReset();
	api.createRuntime.mockReset();
	api.disposeRuntime.mockReset();
	api.promptRuntime.mockReset();
	api.promptRuntime.mockResolvedValue({ queued: false });
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

function notificationService(
	permission: 'unsupported' | 'default' | 'granted' | 'denied' = 'granted'
): NotificationService & {
	permissionStatus: ReturnType<typeof vi.fn>;
	playSound: ReturnType<typeof vi.fn>;
	showSystemNotification: ReturnType<typeof vi.fn>;
	requestPermission: ReturnType<typeof vi.fn>;
} {
	return {
		permissionStatus: vi.fn(() => permission),
		requestPermission: vi.fn(async () => permission),
		playSound: vi.fn(async () => undefined),
		showSystemNotification: vi.fn(() => true)
	};
}

describe('HarnessWorkspace theme restoration', () => {
	it.each(['tokyonight-night', 'tokyonight-storm', 'tokyonight-moon', 'tokyonight-day'] as const)(
		'restores %s',
		async (theme) => {
			localStorage.setItem('pi-squared:theme', theme);
			const workspace = new HarnessWorkspace();

			await workspace.start();

			expect(workspace.theme).toBe(theme);
			expect(document.documentElement.dataset.theme).toBe(theme);
		}
	);
});

describe('HarnessWorkspace notifications', () => {
	it('dispatches one permission notification for a newly applied request', async () => {
		const stream = captureEventStream();
		const notifications = notificationService();
		storageValues.set(STORAGE_KEY, JSON.stringify(storedChats(1)));
		api.getRuntime.mockResolvedValue({ checkpoint: checkpoint('runtime-0', 'session-0') });
		const workspace = new HarnessWorkspace({ notificationService: notifications });
		await workspace.start();
		const chat = (await workspace.ensureChat('project-1', 'session-0'))!;
		workspace.setNotifyOnPermission(true);
		workspace.setSoundsEnabled(true);
		workspace.setSystemNotificationsEnabled(true);
		workspace.setRoutePathname('/history');
		const request = {
			id: 'permission-1',
			method: 'confirm' as const,
			title: 'Allow file access',
			message: 'The agent needs access to continue.'
		};

		sendRevisionedEvent(
			stream,
			'opaque:permission',
			chat.runtimeId!,
			{ type: 'permission_request', request },
			1,
			2
		);
		sendRevisionedEvent(
			stream,
			'opaque:permission-duplicate',
			chat.runtimeId!,
			{ type: 'permission_request', request },
			2,
			2
		);
		sendRevisionedEvent(
			stream,
			'opaque:permission-resolution',
			chat.runtimeId!,
			{ type: 'permission_resolved', requestId: request.id },
			2,
			3
		);

		expect(notifications.playSound).toHaveBeenCalledTimes(1);
		expect(notifications.playSound).toHaveBeenCalledWith('permission-required', 1);
		expect(notifications.showSystemNotification).toHaveBeenCalledTimes(1);
		const systemRequest = notifications.showSystemNotification.mock.calls[0][0];
		expect(systemRequest.body).toBe('New chat: An agent is waiting for your permission.');
		expect(systemRequest.body).not.toContain(request.message);
		expect(chat.permissionRequests).toHaveLength(0);
	});

	it('honors completion and permission event toggles independently', async () => {
		const stream = captureEventStream();
		const notifications = notificationService();
		storageValues.set(STORAGE_KEY, JSON.stringify(storedChats(1)));
		api.getRuntime.mockResolvedValue({ checkpoint: checkpoint('runtime-0', 'session-0', true) });
		const workspace = new HarnessWorkspace({ notificationService: notifications });
		await workspace.start();
		const chat = (await workspace.ensureChat('project-1', 'session-0'))!;
		workspace.setSoundsEnabled(true);
		workspace.setNotifyOnPermission(true);
		const request = {
			id: 'permission-toggle',
			method: 'confirm' as const,
			title: 'Approve access',
			message: 'private command arguments'
		};

		sendRevisionedEvent(
			stream,
			'opaque:permission-toggle',
			chat.runtimeId!,
			{ type: 'permission_request', request },
			1,
			2
		);
		workspace.setNotifyOnPermission(false);
		workspace.setNotifyOnCompletion(true);
		api.getRuntime.mockResolvedValue({ checkpoint: checkpoint('runtime-0', 'session-0', true) });
		await workspace.refreshRuntime(chat);
		sendRevisionedEvent(
			stream,
			'opaque:completion-toggle',
			chat.runtimeId!,
			{ type: 'metadata_updated', patch: { isStreaming: false } },
			1,
			2
		);

		expect(notifications.playSound.mock.calls.map(([kind]) => kind)).toEqual([
			'permission-required',
			'agent-complete'
		]);
	});

	it('does not dispatch for hydration checkpoints or recovery events', async () => {
		const stream = captureEventStream();
		const notifications = notificationService();
		storageValues.set(STORAGE_KEY, JSON.stringify(storedChats(1)));
		api.getRuntime.mockResolvedValue({ checkpoint: checkpoint('runtime-0', 'session-0', true) });
		const workspace = new HarnessWorkspace({ notificationService: notifications });
		await workspace.start();
		const chat = (await workspace.ensureChat('project-1', 'session-0'))!;
		workspace.setNotifyOnCompletion(true);
		workspace.setSoundsEnabled(true);
		expect(notifications.playSound).not.toHaveBeenCalled();

		workspace.setRoutePathname('/history');
		sendRevisionedEvent(
			stream,
			'opaque:recovery',
			chat.runtimeId!,
			{ type: 'metadata_updated', patch: { isStreaming: false } },
			99,
			100
		);

		expect(chat.runtime?.metadata.isStreaming).toBe(true);
		expect(notifications.playSound).not.toHaveBeenCalled();
		expect(notifications.showSystemNotification).not.toHaveBeenCalled();
	});

	it('keeps runtime application alive when notification adapters throw', async () => {
		const stream = captureEventStream();
		const notifications = notificationService();
		notifications.playSound.mockImplementation(() => {
			throw new Error('audio failed');
		});
		notifications.showSystemNotification.mockImplementation(() => {
			throw new Error('notification failed');
		});
		storageValues.set(STORAGE_KEY, JSON.stringify(storedChats(1)));
		api.getRuntime.mockResolvedValue({ checkpoint: checkpoint('runtime-0', 'session-0', true) });
		const workspace = new HarnessWorkspace({ notificationService: notifications });
		await workspace.start();
		const chat = (await workspace.ensureChat('project-1', 'session-0'))!;
		workspace.setNotifyOnCompletion(true);
		workspace.setSoundsEnabled(true);
		workspace.setSystemNotificationsEnabled(true);
		workspace.setRoutePathname('/history');

		expect(() =>
			sendRevisionedEvent(
				stream,
				'opaque:adapter-failure',
				chat.runtimeId!,
				{ type: 'metadata_updated', patch: { isStreaming: false } },
				1,
				2
			)
		).not.toThrow();
		expect(chat.snapshot?.isStreaming).toBe(false);
		expect(notifications.playSound).toHaveBeenCalledTimes(1);
		expect(notifications.showSystemNotification).toHaveBeenCalledTimes(1);
	});

	it('dispatches completion only on an authoritative streaming transition', async () => {
		const stream = captureEventStream();
		const notifications = notificationService();
		storageValues.set(STORAGE_KEY, JSON.stringify(storedChats(1)));
		api.getRuntime.mockResolvedValue({ checkpoint: checkpoint('runtime-0', 'session-0', true) });
		const workspace = new HarnessWorkspace({ notificationService: notifications });
		await workspace.start();
		const chat = (await workspace.ensureChat('project-1', 'session-0'))!;
		workspace.setNotifyOnCompletion(true);
		workspace.setSoundsEnabled(true);
		workspace.setSystemNotificationsEnabled(true);

		sendRevisionedEvent(
			stream,
			'opaque:completion',
			chat.runtimeId!,
			{ type: 'metadata_updated', patch: { isStreaming: false } },
			1,
			2
		);
		sendRevisionedEvent(
			stream,
			'opaque:unrelated',
			chat.runtimeId!,
			{ type: 'metadata_updated', patch: { sessionName: 'Renamed' } },
			2,
			3
		);
		sendRevisionedEvent(
			stream,
			'opaque:duplicate',
			chat.runtimeId!,
			{ type: 'metadata_updated', patch: { isStreaming: false } },
			3,
			3
		);

		expect(notifications.playSound).toHaveBeenCalledTimes(1);
		expect(notifications.playSound).toHaveBeenCalledWith('agent-complete', 1);
		expect(notifications.showSystemNotification).not.toHaveBeenCalled();
	});

	it('delivers system notifications when the foreground chat is hidden or non-active', async () => {
		const stream = captureEventStream();
		const notifications = notificationService();
		storageValues.set(STORAGE_KEY, JSON.stringify(storedChats(1)));
		api.getRuntime.mockResolvedValue({ checkpoint: checkpoint('runtime-0', 'session-0', true) });
		const workspace = new HarnessWorkspace({ notificationService: notifications });
		await workspace.start();
		const chat = (await workspace.ensureChat('project-1', 'session-0'))!;
		workspace.setNotifyOnCompletion(true);
		workspace.setSystemNotificationsEnabled(true);
		const browserDocument = document as unknown as {
			visibilityState: string;
			hasFocus: () => boolean;
		};

		sendRevisionedEvent(
			stream,
			'opaque:foreground',
			chat.runtimeId!,
			{ type: 'metadata_updated', patch: { isStreaming: false } },
			1,
			2
		);
		expect(notifications.showSystemNotification).not.toHaveBeenCalled();

		api.getRuntime.mockResolvedValue({ checkpoint: checkpoint('runtime-0', 'session-0', true) });
		await workspace.refreshRuntime(chat);
		browserDocument.visibilityState = 'hidden';
		sendRevisionedEvent(
			stream,
			'opaque:hidden',
			chat.runtimeId!,
			{ type: 'metadata_updated', patch: { isStreaming: false } },
			1,
			2
		);
		expect(notifications.showSystemNotification).toHaveBeenCalledTimes(1);

		api.getRuntime.mockResolvedValue({ checkpoint: checkpoint('runtime-0', 'session-0', true) });
		await workspace.refreshRuntime(chat);
		browserDocument.visibilityState = 'visible';
		browserDocument.hasFocus = () => false;
		workspace.setRoutePathname(workspace.chatHref(chat.projectId, chat.sessionId));
		sendRevisionedEvent(
			stream,
			'opaque:unfocused',
			chat.runtimeId!,
			{ type: 'metadata_updated', patch: { isStreaming: false } },
			1,
			2
		);
		expect(notifications.showSystemNotification).toHaveBeenCalledTimes(2);

		api.getRuntime.mockResolvedValue({ checkpoint: checkpoint('runtime-0', 'session-0', true) });
		await workspace.refreshRuntime(chat);
		browserDocument.hasFocus = () => true;
		workspace.setRoutePathname('/history');
		sendRevisionedEvent(
			stream,
			'opaque:background',
			chat.runtimeId!,
			{ type: 'metadata_updated', patch: { isStreaming: false } },
			1,
			2
		);
		expect(notifications.showSystemNotification).toHaveBeenCalledTimes(3);
		const completionRequest = notifications.showSystemNotification.mock.calls[1][0];
		expect(completionRequest.body).toBe(`${chat.title}: The agent has finished responding.`);
		expect(completionRequest.body).not.toContain(`${chat.title}: ${chat.title}`);
	});

	it('refreshes current permission without repeatedly requesting after denial', async () => {
		let permission: 'unsupported' | 'default' | 'granted' | 'denied' = 'denied';
		const notifications = notificationService();
		notifications.permissionStatus.mockImplementation(() => permission);
		const workspace = new HarnessWorkspace({ notificationService: notifications });
		await workspace.start();

		expect(await workspace.requestSystemNotificationPermission()).toBe('denied');
		expect(notifications.requestPermission).not.toHaveBeenCalled();

		permission = 'granted';
		expect(workspace.refreshNotificationPermission()).toBe('granted');
		expect(await workspace.requestSystemNotificationPermission()).toBe('granted');
		expect(notifications.requestPermission).not.toHaveBeenCalled();

		notifications.permissionStatus.mockImplementation(() => {
			throw new Error('permission adapter failed');
		});
		expect(workspace.refreshNotificationPermission()).toBe('granted');
	});

	it('restores notification preferences and persists explicit setters', async () => {
		storageValues.set('pi-squared:sounds-enabled', 'true');
		storageValues.set('pi-squared:notification-volume', '35');
		storageValues.set('pi-squared:system-notifications-enabled', 'true');
		storageValues.set('pi-squared:notify-on-completion', 'true');
		storageValues.set('pi-squared:notify-on-permission', 'false');
		const notifications = notificationService();
		const workspace = new HarnessWorkspace({ notificationService: notifications });
		await workspace.start();

		expect(workspace.soundsEnabled).toBe(true);
		expect(workspace.notificationVolume).toBe(35);
		expect(workspace.systemNotificationsEnabled).toBe(true);
		expect(workspace.notifyOnCompletion).toBe(true);
		expect(workspace.notifyOnPermission).toBe(false);

		workspace.setSoundsEnabled(false);
		workspace.setNotificationVolume(72.6);
		workspace.setNotifyOnPermission(true);
		expect(storageValues.get('pi-squared:sounds-enabled')).toBe('false');
		expect(workspace.notificationVolume).toBe(73);
		expect(storageValues.get('pi-squared:notification-volume')).toBe('73');
		expect(storageValues.get('pi-squared:notify-on-permission')).toBe('true');

		workspace.testCompletionSound();
		workspace.testPermissionSound();
		expect(notifications.playSound.mock.calls.slice(-2)).toEqual([
			['agent-complete', 0.73],
			['permission-required', 0.73]
		]);
	});
});

describe('HarnessWorkspace cursor and presentation persistence', () => {
	it('keeps multiple stream frames and the Markdown preview separate from workspace writes', async () => {
		vi.useFakeTimers();
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			frames.push(callback);

			return frames.length;
		});
		const stream = captureEventStream();
		storageValues.set(STORAGE_KEY, JSON.stringify(storedChats(1)));
		api.getRuntime.mockResolvedValue({ checkpoint: checkpoint('runtime-0', 'session-0', true) });
		const workspace = new HarnessWorkspace();
		await workspace.start();
		const chat = (await workspace.ensureChat('project-1', 'session-0'))!;
		workspace.persist();
		clearStorageSpies();

		const flushFrame = (): void => frames.shift()?.(0);
		sendRevisionedEvent(
			stream,
			'opaque:2',
			chat.runtimeId!,
			{ type: 'assistant_delta', text: 'A', thinking: '' },
			1,
			2
		);
		flushFrame();
		sendRevisionedEvent(
			stream,
			'opaque:3',
			chat.runtimeId!,
			{ type: 'assistant_delta', text: 'B', thinking: '' },
			2,
			3
		);
		flushFrame();
		sendRevisionedEvent(
			stream,
			'opaque:4',
			chat.runtimeId!,
			{ type: 'tool_update', toolCallId: 'tool-1', toolName: 'read', status: 'running' },
			3,
			4
		);
		flushFrame();
		sendRevisionedEvent(
			stream,
			'opaque:5',
			chat.runtimeId!,
			{ type: 'assistant_delta', text: 'C', thinking: '' },
			4,
			5
		);
		flushFrame();
		sendRevisionedEvent(
			stream,
			'opaque:6',
			chat.runtimeId!,
			{ type: 'tool_update', toolCallId: 'tool-1', toolName: 'read', status: 'completed' },
			5,
			6
		);
		flushFrame();

		expect(writesFor(STORAGE_KEY)).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(100);
		expect(chat.streamRenderedText).toBe('ABC');
		expect(writesFor(STORAGE_KEY)).toHaveLength(0);

		await vi.advanceTimersByTimeAsync(900);
		expect(writesFor(CURSOR_KEY)).toEqual([[CURSOR_KEY, 'opaque:6']]);
		expect(writesFor(STORAGE_KEY)).toHaveLength(0);
	});

	it('restores a separate cursor without a workspace document', async () => {
		storageValues.set(CURSOR_KEY, 'opaque:v2');
		const workspace = new HarnessWorkspace();
		await workspace.start();

		expect(api.openEventStream).toHaveBeenCalledWith('opaque:v2', expect.any(Function));
	});

	it('prefers a separate cursor over a legacy embedded cursor', async () => {
		storageValues.set(CURSOR_KEY, 'opaque:v2');
		storageValues.set(STORAGE_KEY, JSON.stringify({ ...storedChats(1), lastEventId: 'legacy:v1' }));
		const workspace = new HarnessWorkspace();
		await workspace.start();

		expect(api.openEventStream).toHaveBeenCalledWith('opaque:v2', expect.any(Function));
	});

	it('migrates a string legacy cursor and omits it from the next workspace write', async () => {
		storageValues.set(STORAGE_KEY, JSON.stringify({ ...storedChats(1), lastEventId: 'legacy:v1' }));
		const workspace = new HarnessWorkspace();
		await workspace.start();

		expect(storageValues.get(CURSOR_KEY)).toBe('legacy:v1');
		expect(api.openEventStream).toHaveBeenCalledWith('legacy:v1', expect.any(Function));
		workspace.persist();
		const stored = JSON.parse(storageValues.get(STORAGE_KEY)!);
		expect(stored).not.toHaveProperty('lastEventId');
	});

	it('ignores numeric legacy cursors', async () => {
		storageValues.set(STORAGE_KEY, JSON.stringify({ ...storedChats(1), lastEventId: 42 }));
		const workspace = new HarnessWorkspace();
		await workspace.start();

		expect(api.openEventStream).toHaveBeenCalledWith(undefined, expect.any(Function));
		expect(storageValues.has(CURSOR_KEY)).toBe(false);
	});

	it('advances the cursor for an envelope ignored by runtime routing', async () => {
		vi.useFakeTimers();
		let receiveEvent: ((message: StreamMessage) => void) | undefined;
		api.openEventStream.mockImplementation((_lastEventId, onEvent) => {
			receiveEvent = onEvent;

			return { close: vi.fn() };
		});
		const workspace = new HarnessWorkspace();
		await workspace.start();
		setItem.mockClear();

		receiveEvent?.({
			id: 'opaque:last',
			cursor: { epoch: 'test', sequence: 20 },
			runtimeId: 'unknown-runtime',
			event: { type: 'notice', message: 'ignored' }
		});
		await vi.advanceTimersByTimeAsync(1_000);

		expect(setItem).toHaveBeenCalledWith(CURSOR_KEY, 'opaque:last');
	});

	it.each(['foreign_epoch', 'expired_cursor'] as const)(
		'clears a pending cursor immediately for %s and refreshes the active chat',
		async (reason) => {
			vi.useFakeTimers();
			const stream = captureEventStream();
			storageValues.set(STORAGE_KEY, JSON.stringify(storedChats(1)));
			api.getRuntime.mockResolvedValue({ checkpoint: checkpoint('runtime-0', 'session-0') });
			const workspace = new HarnessWorkspace();
			await workspace.start();
			await workspace.ensureChat('project-1', 'session-0');
			storageValues.set(CURSOR_KEY, 'stale');
			clearStorageSpies();

			sendEvent(stream, 'opaque:pending', 'runtime-0', { type: 'notice', message: 'pending' }, 2);
			stream.receive({ type: 'reset_required', reason, cursor: { epoch: 'other', sequence: 3 } });

			expect(removeItem).toHaveBeenCalledWith(CURSOR_KEY);
			expect(storageValues.has(CURSOR_KEY)).toBe(false);
			expect(api.getRuntime).toHaveBeenCalledWith('runtime-0', expect.any(AbortSignal));
			await vi.advanceTimersByTimeAsync(1_000);
			expect(writesFor(CURSOR_KEY)).toHaveLength(0);
		}
	);
});

describe('HarnessWorkspace item-1 focused coverage', () => {
	it('persists the last cursor for every normal envelope kind before routing can return', async () => {
		vi.useFakeTimers();
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			frames.push(callback);

			return frames.length;
		});
		const stream = captureEventStream();
		storageValues.set(STORAGE_KEY, JSON.stringify(storedChats(2)));
		api.getRuntime.mockResolvedValue({ checkpoint: checkpoint('runtime-0', 'session-0') });
		const workspace = new HarnessWorkspace();
		await workspace.start();
		const activeChat = (await workspace.ensureChat('project-1', 'session-0'))!;
		workspace.persist();
		clearStorageSpies();

		type CursorCase =
			| {
					id: string;
					runtimeId: string;
					event: RuntimeMutation;
					baseRevision: number;
					revision: number;
			  }
			| {
					id: string;
					runtimeId: string;
					event: { type: 'notice'; message: string } | { type: 'error'; message: string };
			  };
		const cases: CursorCase[] = [
			{
				id: 'opaque:assistant',
				runtimeId: 'runtime-0',
				event: { type: 'assistant_delta', text: 'A' },
				baseRevision: 1,
				revision: 2
			},
			{
				id: 'opaque:tool',
				runtimeId: 'runtime-0',
				event: { type: 'tool_update', toolCallId: 'tool-1', toolName: 'read', status: 'running' },
				baseRevision: 2,
				revision: 3
			},
			{
				id: 'opaque:mutation',
				runtimeId: 'runtime-0',
				event: { type: 'metadata_updated', patch: { sessionName: 'Renamed' } },
				baseRevision: 3,
				revision: 4
			},
			{ id: 'opaque:notice', runtimeId: 'runtime-0', event: { type: 'notice', message: 'notice' } },
			{ id: 'opaque:error', runtimeId: 'runtime-0', event: { type: 'error', message: 'error' } },
			{
				id: 'opaque:unknown',
				runtimeId: 'unknown-runtime',
				event: { type: 'notice', message: 'unknown' }
			},
			{
				id: 'opaque:inactive',
				runtimeId: 'runtime-1',
				event: { type: 'items_appended', items: [item('inactive-item')] },
				baseRevision: 1,
				revision: 2
			}
		];

		cases.forEach((testCase, index) => {
			if ('revision' in testCase) {
				sendRevisionedEvent(
					stream,
					testCase.id,
					testCase.runtimeId,
					testCase.event,
					testCase.baseRevision,
					testCase.revision,
					index + 2
				);
			} else {
				sendEvent(stream, testCase.id, testCase.runtimeId, testCase.event, index + 2);
			}

			frames.shift()?.(0);
		});

		await vi.advanceTimersByTimeAsync(1_000);
		expect(writesFor(CURSOR_KEY)).toEqual([[CURSOR_KEY, 'opaque:inactive']]);
		expect(activeChat.runtime?.revision).toBe(4);
		expect(activeChat.streamText).toBe('A');
		expect(activeChat.streamTools).toHaveLength(1);
		expect(activeChat.snapshot?.sessionName).toBe('Renamed');
	});

	it('updates and persists a new chat title when the first user message arrives', async () => {
		vi.useFakeTimers();
		const stream = captureEventStream();
		storageValues.set(STORAGE_KEY, JSON.stringify(storedChats(1)));
		api.getRuntime.mockResolvedValue({ checkpoint: checkpoint('runtime-0', 'session-0') });
		const workspace = new HarnessWorkspace();
		await workspace.start();
		const chat = (await workspace.ensureChat('project-1', 'session-0'))!;
		chat.title = 'New chat';
		workspace.persist();
		clearStorageSpies();

		sendRevisionedEvent(
			stream,
			'opaque:first-message',
			'runtime-0',
			{ type: 'items_appended', items: [item('user-1', 'user', 'Name this tab immediately')] },
			1,
			2
		);

		expect(chat.title).toBe('Name this tab immediately');
		await vi.advanceTimersByTimeAsync(150);
		expect(workspaceDocument().tabs).toEqual([
			expect.objectContaining({ id: 'chat-0', title: 'Name this tab immediately' })
		]);
	});

	it('replays a same-epoch duplicate once and applies the next revision once', async () => {
		const stream = captureEventStream();
		storageValues.set(CURSOR_KEY, 'opaque:resume');
		storageValues.set(STORAGE_KEY, JSON.stringify(storedChats(1)));
		api.getRuntime.mockResolvedValue({ checkpoint: checkpoint('runtime-0', 'session-0') });
		const workspace = new HarnessWorkspace();
		await workspace.start();
		const chat = (await workspace.ensureChat('project-1', 'session-0'))!;

		sendRevisionedEvent(
			stream,
			'opaque:duplicate',
			'runtime-0',
			{ type: 'items_appended', items: [item('duplicate-item')] },
			0,
			1,
			1
		);
		sendRevisionedEvent(
			stream,
			'opaque:next',
			'runtime-0',
			{ type: 'items_appended', items: [item('next-item')] },
			1,
			2,
			2
		);

		expect(chat.runtime?.itemOrder).toEqual(['next-item']);
		expect(chat.runtime?.revision).toBe(2);
	});

	it('skips checkpoint-covered hydration events and applies newer buffered events once', async () => {
		const stream = captureEventStream();
		storageValues.set(STORAGE_KEY, JSON.stringify(storedChats(1)));
		const hydration = deferred<{ checkpoint: RuntimeCheckpoint }>();
		api.getRuntime.mockReturnValue(hydration.promise);
		const workspace = new HarnessWorkspace();
		await workspace.start();
		const loading = workspace.ensureChat('project-1', 'session-0');

		sendRevisionedEvent(
			stream,
			'opaque:covered',
			'runtime-0',
			{ type: 'items_appended', items: [item('covered-item')] },
			1,
			2,
			2
		);
		sendRevisionedEvent(
			stream,
			'opaque:newer',
			'runtime-0',
			{ type: 'items_appended', items: [item('newer-item')] },
			2,
			3,
			3
		);
		hydration.resolve({
			checkpoint: checkpoint('runtime-0', 'session-0', false, {
				revision: 2,
				cursorSequence: 2,
				items: [item('covered-item')]
			})
		});
		const chat = (await loading)!;

		expect(chat.runtime?.itemOrder).toEqual(['covered-item', 'newer-item']);
		expect(chat.runtime?.revision).toBe(3);
	});

	it('advances an inactive tab cursor and replaces it from an authoritative checkpoint on activation', async () => {
		const stream = captureEventStream();
		storageValues.set(STORAGE_KEY, JSON.stringify(storedChats(2)));
		api.getRuntime.mockImplementation(async (runtimeId: string) => ({
			checkpoint:
				runtimeId === 'runtime-1'
					? checkpoint('runtime-1', 'session-1', false, {
							cursorSequence: 8,
							revision: 2,
							items: [item('inactive-authoritative')]
						})
					: checkpoint(runtimeId, 'session-0')
		}));
		const workspace = new HarnessWorkspace();
		await workspace.start();
		await workspace.ensureChat('project-1', 'session-0');
		const inactive = workspace.findChat('project-1', 'session-1')!;

		sendRevisionedEvent(
			stream,
			'opaque:inactive-event',
			'runtime-1',
			{ type: 'items_appended', items: [item('inactive-authoritative')] },
			1,
			2,
			2
		);
		expect(inactive.hydrationState).toBe('unhydrated');
		expect(inactive.runtime).toBeUndefined();

		await workspace.ensureChat('project-1', 'session-1');
		expect(inactive.runtime?.itemOrder).toEqual(['inactive-authoritative']);
		expect(inactive.runtime?.revision).toBe(2);
	});

	it('replaces stale state on reset and applies the next revision once', async () => {
		const stream = captureEventStream();
		storageValues.set(STORAGE_KEY, JSON.stringify(storedChats(1)));
		api.getRuntime.mockResolvedValue({ checkpoint: checkpoint('runtime-0', 'session-0') });
		const workspace = new HarnessWorkspace();
		await workspace.start();
		const chat = (await workspace.ensureChat('project-1', 'session-0'))!;
		const replacement = deferred<{ checkpoint: RuntimeCheckpoint }>();
		api.getRuntime.mockReturnValue(replacement.promise);

		stream.receive({
			type: 'reset_required',
			reason: 'expired_cursor',
			cursor: { epoch: 'test', sequence: 4 }
		});
		sendRevisionedEvent(
			stream,
			'opaque:after-reset',
			'runtime-0',
			{ type: 'items_appended', items: [item('after-reset')] },
			5,
			6,
			6
		);
		sendRevisionedEvent(
			stream,
			'opaque:after-reset-duplicate',
			'runtime-0',
			{ type: 'items_appended', items: [item('after-reset')] },
			5,
			6,
			7
		);
		replacement.resolve({
			checkpoint: checkpoint('runtime-0', 'session-0', false, {
				revision: 5,
				cursorSequence: 5,
				items: [item('replacement')]
			})
		});
		await vi.waitFor(() => expect(chat.hydrationState).toBe('ready'));

		expect(chat.runtime?.itemOrder).toEqual(['replacement', 'after-reset']);
		expect(chat.runtime?.revision).toBe(6);
	});

	it('keeps the 100-event hydration bound and requests another checkpoint on overflow', async () => {
		const stream = captureEventStream();
		storageValues.set(STORAGE_KEY, JSON.stringify(storedChats(1)));
		const firstCheckpoint = deferred<{ checkpoint: RuntimeCheckpoint }>();
		api.getRuntime.mockReturnValueOnce(firstCheckpoint.promise).mockResolvedValue({
			checkpoint: checkpoint('runtime-0', 'session-0', false, {
				cursorSequence: 101,
				items: [item('authoritative-after-overflow')]
			})
		});
		const workspace = new HarnessWorkspace();
		await workspace.start();
		const loading = workspace.ensureChat('project-1', 'session-0');

		for (let sequence = 2; sequence <= 102; sequence += 1) {
			sendRevisionedEvent(
				stream,
				`opaque:${sequence}`,
				'runtime-0',
				{ type: 'items_appended', items: [item(`buffered-${sequence}`)] },
				sequence - 1,
				sequence,
				sequence
			);
		}

		firstCheckpoint.resolve({ checkpoint: checkpoint('runtime-0', 'session-0') });
		const chat = (await loading)!;

		expect(api.getRuntime).toHaveBeenCalledTimes(2);
		expect(chat.runtime?.itemOrder).toEqual(['authoritative-after-overflow']);
		expect(chat.runtime?.revision).toBe(1);
	});

	it.each(['draft debounce', 'active tab', 'tab order after close'] as const)(
		'keeps stored workspace mutations durable: %s',
		async (caseName) => {
			vi.useFakeTimers();
			const workspace = new HarnessWorkspace();
			await workspace.start();
			if (caseName === 'draft debounce') {
				const tab = workspace.createNewTab('new-draft');
				clearStorageSpies();
				tab.draft.prompt = 'debounced';
				workspace.schedulePersist();
				await vi.advanceTimersByTimeAsync(149);
				expect(writesFor(STORAGE_KEY)).toHaveLength(0);
				await vi.advanceTimersByTimeAsync(1);
				expect(workspaceDocument().tabs).toEqual([
					expect.objectContaining({
						id: 'new-draft',
						draft: expect.objectContaining({ prompt: 'debounced' })
					})
				]);
			} else if (caseName === 'active tab') {
				const first = workspace.createNewTab('new-first');
				workspace.createNewTab('new-second');
				clearStorageSpies();
				workspace.rememberTabForPathname(workspace.newHref(first.id));
				expect(workspaceDocument().activeTabId).toBe(first.id);
			} else {
				const first = workspace.createNewTab('new-first');
				expect((workspaceDocument().tabs as Array<{ id: string }>).map((tab) => tab.id)).toEqual([
					first.id
				]);
				const second = workspace.createNewTab('new-second');
				expect((workspaceDocument().tabs as Array<{ id: string }>).map((tab) => tab.id)).toEqual([
					first.id,
					second.id
				]);
				clearStorageSpies();
				await workspace.closeTab(first);
				expect(workspace.tabs.map((tab) => tab.id)).toEqual([second.id]);
				expect((workspaceDocument().tabs as Array<{ id: string }>).map((tab) => tab.id)).toEqual([
					second.id
				]);
			}
		}
	);
});

describe('HarnessWorkspace stored-field persistence', () => {
	it('cancels a pending debounce when direct persistence is requested', async () => {
		vi.useFakeTimers();
		const workspace = new HarnessWorkspace();
		await workspace.start();
		const tab = workspace.createNewTab('direct-persist');
		clearStorageSpies();
		tab.draft.prompt = 'direct';
		workspace.schedulePersist();
		workspace.persist();
		await vi.advanceTimersByTimeAsync(150);

		expect(writesFor(STORAGE_KEY)).toHaveLength(1);
	});

	it('persists queue mode immediately through the workspace method', async () => {
		storageValues.set(STORAGE_KEY, JSON.stringify(storedChats(1)));
		api.getRuntime.mockResolvedValue({ checkpoint: checkpoint('runtime-0', 'session-0') });
		const workspace = new HarnessWorkspace();
		await workspace.start();
		const chat = (await workspace.ensureChat('project-1', 'session-0'))!;
		clearStorageSpies();

		workspace.setQueueMode(chat, 'steer');

		expect(workspaceDocument().tabs).toEqual([
			expect.objectContaining({ id: 'chat-0', queueMode: 'steer' })
		]);
	});

	it('persists checkpoint title and runtime ID changes but not an unchanged checkpoint', async () => {
		vi.useFakeTimers();
		storageValues.set(STORAGE_KEY, JSON.stringify(storedChats(1)));
		api.getRuntime.mockResolvedValue({
			checkpoint: checkpoint('runtime-new', 'session-0', false, { sessionName: 'Renamed' })
		});
		const workspace = new HarnessWorkspace();
		await workspace.start();
		await workspace.ensureChat('project-1', 'session-0');
		await vi.advanceTimersByTimeAsync(150);
		expect(workspaceDocument().tabs).toEqual([
			expect.objectContaining({ id: 'chat-0', title: 'Renamed', runtimeId: 'runtime-new' })
		]);

		clearStorageSpies();
		api.getRuntime.mockResolvedValue({
			checkpoint: checkpoint('runtime-new', 'session-0', false, { sessionName: 'Renamed' })
		});
		await workspace.refreshRuntime(workspace.findChat('project-1', 'session-0')!);
		await vi.advanceTimersByTimeAsync(150);
		expect(writesFor(STORAGE_KEY)).toHaveLength(0);
	});

	it('persists runtime ID clearing when an inactive runtime is disposed', async () => {
		vi.useFakeTimers();
		storageValues.set(STORAGE_KEY, JSON.stringify(storedChats(1)));
		api.getRuntime.mockResolvedValue({ checkpoint: checkpoint('runtime-0', 'session-0') });
		api.disposeRuntime.mockResolvedValue(undefined);
		const workspace = new HarnessWorkspace();
		await workspace.start();
		const chat = (await workspace.ensureChat('project-1', 'session-0'))!;
		workspace.setRoutePathname('/history');
		await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

		expect(chat.runtimeId).toBeUndefined();
		expect(workspaceDocument().tabs).toEqual([expect.objectContaining({ id: 'chat-0' })]);
		expect((workspaceDocument().tabs as Array<Record<string, unknown>>)[0]).not.toHaveProperty(
			'runtimeId'
		);
	});

	it('persists a direct-route insertion before hydration rejects', async () => {
		api.getRuntime.mockRejectedValue(new Error('hydration failed'));
		const workspace = new HarnessWorkspace();
		await workspace.start();

		await expect(workspace.ensureChat('project-1', 'rejected-session')).resolves.toBeUndefined();
		expect(workspaceDocument().tabs).toEqual([
			expect.objectContaining({ projectId: 'project-1', sessionId: 'rejected-session' })
		]);
	});

	it('persists the replacement before prompt rejection', async () => {
		const stream = captureEventStream();
		const model = { provider: 'test', id: 'model', name: 'Test', reasoning: true };
		api.listProjects.mockResolvedValue({
			projects: [
				{ id: 'project-1', name: 'Project', cwd: '/tmp/project', addedAt: '', lastOpenedAt: '' }
			]
		});
		api.listModels.mockResolvedValue({ models: [model] });
		api.createRuntime.mockResolvedValue({ checkpoint: checkpoint('runtime-new', 'session-1') });
		const prompt = deferred<never>();
		api.promptRuntime.mockReturnValue(prompt.promise);
		const workspace = new HarnessWorkspace();
		await workspace.start();
		const tab = workspace.createNewTab('new-prompt');
		const starting = workspace.startChat(tab, { text: 'hello', attachments: [] });
		await vi.waitFor(() => expect(api.promptRuntime).toHaveBeenCalled());
		sendRevisionedEvent(
			stream,
			'opaque:prompt-started',
			'runtime-new',
			{ type: 'metadata_updated', patch: { isStreaming: true } },
			1,
			2
		);

		expect(workspace.findChat('project-1', 'session-1')?.title).toBe('hello');
		expect(workspaceDocument().tabs).toEqual([
			expect.objectContaining({ kind: 'chat', sessionId: 'session-1', title: 'hello' })
		]);
		prompt.reject(new Error('prompt rejected'));
		await expect(starting).rejects.toThrow('prompt rejected');
		expect(workspaceDocument().tabs).toEqual([
			expect.objectContaining({ kind: 'chat', sessionId: 'session-1', title: 'New chat' })
		]);
	});

	it('persists a restored opening draft when prompt submission is not accepted', async () => {
		const model = { provider: 'test', id: 'model', name: 'Test', reasoning: true };
		api.listProjects.mockResolvedValue({
			projects: [
				{ id: 'project-1', name: 'Project', cwd: '/tmp/project', addedAt: '', lastOpenedAt: '' }
			]
		});
		api.listModels.mockResolvedValue({ models: [model] });
		api.createRuntime.mockResolvedValue({ checkpoint: checkpoint('', 'session-1') });
		const workspace = new HarnessWorkspace();
		await workspace.start();
		const tab = workspace.createNewTab('new-draft');

		await workspace.startChat(tab, { text: 'keep this draft', attachments: [] });

		expect(workspaceDocument().tabs).toEqual([
			expect.objectContaining({ kind: 'chat', draft: 'keep this draft' })
		]);
	});
});

describe('HarnessWorkspace lifecycle persistence', () => {
	it.each(['direct flush', 'pagehide'] as const)(
		'flushes workspace and cursor through %s',
		async (boundary) => {
			vi.useFakeTimers();
			const pagehide = stubPagehide();
			const stream = captureEventStream();
			const workspace = new HarnessWorkspace();
			await workspace.start();
			const tab = workspace.createNewTab('lifecycle-tab');
			clearStorageSpies();
			tab.draft.prompt = 'pending draft';
			workspace.schedulePersist();
			sendEvent(
				stream,
				'opaque:lifecycle',
				'unknown-runtime',
				{ type: 'notice', message: 'cursor' },
				2
			);

			if (boundary === 'direct flush') {
				workspace.flushPendingPersistence();
			} else {
				expect(pagehide.listenerCount()).toBe(1);
				pagehide.dispatch();
			}

			expect(writesFor(STORAGE_KEY)).toHaveLength(1);
			expect(writesFor(CURSOR_KEY)).toEqual([[CURSOR_KEY, 'opaque:lifecycle']]);
			await vi.advanceTimersByTimeAsync(1_000);
			expect(writesFor(STORAGE_KEY)).toHaveLength(1);
			expect(writesFor(CURSOR_KEY)).toHaveLength(1);
		}
	);

	it('registers one pagehide listener across repeated starts and reconnects', async () => {
		const pagehide = stubPagehide();
		const workspace = new HarnessWorkspace();
		await workspace.start();
		await workspace.start();
		expect(pagehide.addEventListener).toHaveBeenCalledTimes(1);
		expect(pagehide.listenerCount()).toBe(1);

		workspace.disposeConnection();
		expect(pagehide.removeEventListener).toHaveBeenCalledTimes(1);
		expect(pagehide.listenerCount()).toBe(0);
		await workspace.start();
		expect(pagehide.addEventListener).toHaveBeenCalledTimes(2);
		expect(pagehide.listenerCount()).toBe(1);
	});

	it('flushes pending state before disposing the EventSource', async () => {
		vi.useFakeTimers();
		const pagehide = stubPagehide();
		const close = vi.fn(() => {
			expect(storageValues.get(STORAGE_KEY)).toContain('dispose draft');
			expect(storageValues.get(CURSOR_KEY)).toBe('opaque:dispose');
		});
		let receive: ((message: StreamMessage) => void) | undefined;
		api.openEventStream.mockImplementation((_lastEventId, onEvent) => {
			receive = onEvent;

			return { close };
		});
		const workspace = new HarnessWorkspace();
		await workspace.start();
		const tab = workspace.createNewTab('dispose-tab');
		clearStorageSpies();
		tab.draft.prompt = 'dispose draft';
		workspace.schedulePersist();
		receive?.({
			id: 'opaque:dispose',
			cursor: { epoch: 'test', sequence: 2 },
			runtimeId: 'unknown-runtime',
			event: { type: 'notice', message: 'pending' }
		});

		workspace.disposeConnection();

		expect(close).toHaveBeenCalledTimes(1);
		expect(pagehide.removeEventListener).toHaveBeenCalledTimes(1);
	});
});

describe('HarnessWorkspace chat hydration', () => {
	it('does not replace a finalized snapshot for a live tool update', async () => {
		let receiveEvent: ((message: StreamMessage) => void) | undefined;
		api.openEventStream.mockImplementation((_lastEventId, onEvent) => {
			receiveEvent = onEvent;

			return { close: vi.fn() };
		});
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);

			return 1;
		});
		localStorage.setItem(STORAGE_KEY, JSON.stringify(storedChats(1)));
		api.getRuntime.mockResolvedValue({ checkpoint: checkpoint('runtime-0', 'session-0', true) });
		const workspace = new HarnessWorkspace();
		await workspace.start();
		const chat = (await workspace.ensureChat('project-1', 'session-0'))!;
		const snapshot = chat.snapshot;

		receiveEvent?.({
			id: 'test:2',
			cursor: { epoch: 'test', sequence: 2 },
			runtimeId: 'runtime-0',
			event: {
				type: 'tool_update',
				baseRevision: 1,
				revision: 2,
				toolCallId: 'tool-1',
				toolName: 'read',
				status: 'running'
			}
		});

		await vi.waitFor(() => expect(chat.streamToolsByCallId?.get('tool-1')).toBeDefined());
		expect(chat.snapshot).toBe(snapshot);
	});

	it('restores ten chat tabs without hydrating them, then hydrates only a direct routed chat', async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(storedChats(10)));
		api.getRuntime.mockImplementation(async (runtimeId: string) => ({
			checkpoint: checkpoint(runtimeId, runtimeId.replace('runtime-', 'session-'))
		}));
		const workspace = new HarnessWorkspace();

		await workspace.start();

		expect(workspace.tabs).toHaveLength(10);
		expect(
			workspace.tabs.every((tab) => tab.kind === 'chat' && tab.hydrationState === 'unhydrated')
		).toBe(true);
		expect(api.getRuntime).not.toHaveBeenCalled();
		expect(api.createRuntime).not.toHaveBeenCalled();

		await workspace.ensureChat('project-1', 'session-9');

		expect(api.getRuntime).toHaveBeenCalledTimes(1);
		expect(api.getRuntime).toHaveBeenCalledWith('runtime-9', expect.any(AbortSignal));
		expect(api.createRuntime).not.toHaveBeenCalled();
		expect(workspace.findChat('project-1', 'session-9')?.hydrationState).toBe('ready');
	});

	it('single-flights concurrent route activation and refresh', async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(storedChats(1)));
		const response = deferred<{ checkpoint: RuntimeCheckpoint }>();
		api.getRuntime.mockReturnValue(response.promise);
		const workspace = new HarnessWorkspace();
		await workspace.start();
		const chat = workspace.findChat('project-1', 'session-0')!;

		const activated = workspace.ensureChat(chat.projectId, chat.sessionId);
		const refreshed = workspace.refreshRuntime(chat);
		const repeatedActivation = workspace.ensureChat(chat.projectId, chat.sessionId);
		response.resolve({ checkpoint: checkpoint('runtime-0', 'session-0') });
		await Promise.all([activated, refreshed, repeatedActivation]);

		expect(api.getRuntime).toHaveBeenCalledTimes(1);
		expect(chat.hydrationState).toBe('ready');
	});

	it('falls back from a stale runtime ID to one resumed runtime', async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(storedChats(1)));
		api.getRuntime.mockRejectedValue(new Error('not found'));
		api.createRuntime.mockResolvedValue({ checkpoint: checkpoint('resumed-runtime', 'session-0') });
		const workspace = new HarnessWorkspace();
		await workspace.start();

		await workspace.ensureChat('project-1', 'session-0');

		expect(api.getRuntime).toHaveBeenCalledTimes(1);
		expect(api.createRuntime).toHaveBeenCalledTimes(1);
		expect(workspace.findChat('project-1', 'session-0')?.runtimeId).toBe('resumed-runtime');
	});

	it('releases a settled runtime after its tab has been inactive for 30 minutes', async () => {
		vi.useFakeTimers();
		localStorage.setItem(STORAGE_KEY, JSON.stringify(storedChats(1)));
		api.getRuntime.mockResolvedValue({ checkpoint: checkpoint('runtime-0', 'session-0') });
		api.disposeRuntime.mockResolvedValue(undefined);
		const workspace = new HarnessWorkspace();
		await workspace.start();
		const chat = (await workspace.ensureChat('project-1', 'session-0'))!;

		workspace.setRoutePathname('/history');
		await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

		expect(api.disposeRuntime).toHaveBeenCalledWith('runtime-0');
		expect(chat.hydrationState).toBe('unhydrated');
		expect(chat.runtimeId).toBeUndefined();
	});

	it('disposes a resumed runtime that finishes after its tab closes', async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(storedChats(1)));
		api.getRuntime.mockRejectedValue(new Error('not found'));
		const resumed = deferred<{ checkpoint: RuntimeCheckpoint }>();
		api.createRuntime.mockReturnValue(resumed.promise);
		api.disposeRuntime.mockResolvedValue(undefined);
		const workspace = new HarnessWorkspace();
		await workspace.start();
		const chat = workspace.findChat('project-1', 'session-0')!;

		const opening = workspace.ensureChat(chat.projectId, chat.sessionId);
		await Promise.resolve();
		await workspace.closeTab(chat);
		resumed.resolve({ checkpoint: checkpoint('late-runtime', 'session-0') });
		await opening;

		expect(api.disposeRuntime).toHaveBeenCalledWith('late-runtime');
		expect(workspace.findChat('project-1', 'session-0')).toBeUndefined();
	});
});

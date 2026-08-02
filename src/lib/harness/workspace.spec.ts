import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeCheckpoint } from '$lib/contracts';

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

function checkpoint(runtimeId: string, sessionId = 'session-1'): RuntimeCheckpoint {
	return {
		protocolVersion: 2,
		cursor: { epoch: 'test', sequence: 1 },
		revision: 1,
		snapshot: {
			runtimeId,
			project: {
				id: 'project-1',
				name: 'Project',
				cwd: '/tmp/project',
				addedAt: '',
				lastOpenedAt: ''
			},
			sessionId,
			thinkingLevel: 'medium',
			isStreaming: false,
			items: [],
			permissionRequests: []
		},
		live: { text: '', thinking: '', tools: [] }
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});

	return { promise, resolve };
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

beforeEach(() => {
	const values = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key)
	});
	api.listProjects.mockResolvedValue({ projects: [] });
	api.listModels.mockResolvedValue({ models: [] });
	api.listSessions.mockResolvedValue({ sessions: [] });
	api.openEventStream.mockReturnValue({ close: vi.fn() });
	api.getRuntime.mockReset();
	api.createRuntime.mockReset();
	api.disposeRuntime.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('HarnessWorkspace chat hydration', () => {
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

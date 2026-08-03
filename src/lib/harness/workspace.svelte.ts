import type {
	ChatSubmission,
	HistoricalSession,
	ModelOption,
	Project,
	RuntimeCheckpoint,
	RuntimeSnapshot,
	StreamEnvelope,
	StreamMessage,
	ThinkingLevel
} from '$lib/contracts';
import {
	abortRuntime,
	addProject as createProject,
	createRuntime,
	disposeRuntime,
	getRuntime,
	listModels,
	listProjects,
	listSessions,
	openEventStream,
	promptRuntime,
	respondToPermission,
	setRuntimeMcpServerEnabled,
	setRuntimeModel,
	setRuntimeThinking
} from '$lib/harness/api';
import { errorNotices } from '$lib/error-notices';
import { reconcilePendingUserMessages } from '$lib/harness/pending-user-messages';
import {
	applyRuntimeEvent,
	snapshotFromState,
	stateFromCheckpoint
} from '$lib/harness/runtime-state';
import { StreamUpdateBatcher } from '$lib/harness/stream-update-batcher';
import {
	modelKey,
	type ChatTab,
	type NewDraft,
	type NewTab,
	type PendingPermission,
	type QueueMode,
	type StoredChatTab,
	type StoredNewTab,
	type StoredWorkspaceV1,
	type StreamingTool,
	type Theme,
	type WorkspaceTab
} from '$lib/harness/types';
import { resolve } from '$app/paths';
import { SvelteDate, SvelteMap, SvelteSet } from 'svelte/reactivity';

const STORAGE_KEY = 'pi-squared:workspace:v1';
const LEGACY_OPEN_CHATS_KEY = 'pi-squared:open-chats';
const LAST_PROJECT_KEY = 'pi-squared:last-project';
const LAST_MODEL_KEY = 'pi-squared:last-model';
const LAST_THINKING_LEVEL_KEY = 'pi-squared:last-thinking-level';
const THEME_KEY = 'pi-squared:theme';
const SHOW_REASONING_KEY = 'pi-squared:show-reasoning';
const SHOW_MODEL_CHANGES_KEY = 'pi-squared:show-model-changes';
const MAX_HYDRATION_BUFFERED_EVENTS = 100;
/** Release an inactive, settled runtime; persisted session history is resumed on next activation. */
const INACTIVE_RUNTIME_DISPOSAL_MS = 30 * 60 * 1000;

export type ScrollState = {
	top: number;
	pinnedToBottom: boolean;
};

export const THEME_LABELS: Record<Theme, string> = {
	graphite: 'Graphite',
	paper: 'Paper',
	nord: 'Nord',
	solarized: 'Solarized',
	'tokyonight-night': 'Tokyo Night',
	'tokyonight-storm': 'Tokyo Storm',
	'tokyonight-moon': 'Tokyo Moon',
	'tokyonight-day': 'Tokyo Day',
	'everforest-dark-hard': 'Everforest Dark Hard',
	'everforest-dark-medium': 'Everforest Dark Medium',
	'everforest-dark-soft': 'Everforest Dark Soft',
	'everforest-light-hard': 'Everforest Light Hard',
	'everforest-light-medium': 'Everforest Light Medium',
	'everforest-light-soft': 'Everforest Light Soft',
	system: 'Follow system'
};

function isTheme(value: string | null): value is Theme {
	return value !== null && value in THEME_LABELS;
}

function isQueueMode(value: unknown): value is QueueMode {
	return value === 'followUp' || value === 'steer';
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return (
		value === 'off' ||
		value === 'minimal' ||
		value === 'low' ||
		value === 'medium' ||
		value === 'high' ||
		value === 'xhigh' ||
		value === 'max'
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function randomId(): string {
	return crypto.randomUUID();
}

function streamToolMap(tools: StreamingTool[]): SvelteMap<string, StreamingTool> {
	return new SvelteMap(tools.map((tool) => [tool.id, tool]));
}

function normalizeError(error: unknown, fallback: string): Error {
	return error instanceof Error ? error : new Error(fallback);
}

export class HarnessWorkspace {
	projects = $state<Project[]>([]);
	models = $state<ModelOption[]>([]);
	sessions = $state<HistoricalSession[]>([]);
	tabs = $state<WorkspaceTab[]>([]);
	activeTabId = $state<string | undefined>();
	theme = $state<Theme>('graphite');
	showReasoning = $state(false);
	showModelChanges = $state(false);
	initializing = $state(true);
	error = $state('');

	#started = false;
	#startPromise: Promise<void> | undefined;
	#events: EventSource | undefined;
	#lastEventId: string | undefined;
	#chatLoads = new SvelteMap<string, Promise<ChatTab | undefined>>();
	#hydrationControllers = new SvelteMap<string, AbortController>();
	#inactiveRuntimeTimers = new SvelteMap<string, ReturnType<typeof setTimeout>>();
	#activeChatId: string | undefined;
	#scrollStates = new SvelteMap<string, ScrollState>();
	#streamUpdates = new StreamUpdateBatcher(
		(callback) => requestAnimationFrame(callback),
		() => this.schedulePersist()
	);
	#persistTimer: ReturnType<typeof setTimeout> | undefined;

	async start(): Promise<void> {
		if (this.#started) {
			this.#connectEvents();

			return this.#startPromise;
		}

		this.#started = true;
		this.#startPromise = this.#initialize();

		return this.#startPromise;
	}

	disposeConnection(): void {
		this.#events?.close();
		this.#events = undefined;
		this.#streamUpdates.discardAll();
		for (const tab of this.tabs) {
			if (tab.kind === 'chat') {
				this.#cancelInactiveRuntimeDisposal(tab);
			}
		}
	}

	schedulePersist(): void {
		if (this.#persistTimer) {
			clearTimeout(this.#persistTimer);
		}

		this.#persistTimer = setTimeout(() => {
			this.#persistTimer = undefined;
			this.persist();
		}, 150);
	}

	newHref(tabId: string): string {
		return resolve(`/new/${encodeURIComponent(tabId)}`);
	}

	chatHref(projectId: string, sessionId: string): string {
		return resolve(`/chat/${encodeURIComponent(projectId)}/${encodeURIComponent(sessionId)}`);
	}

	hrefForTab(tab: WorkspaceTab): string {
		return tab.kind === 'new' ? this.newHref(tab.id) : this.chatHref(tab.projectId, tab.sessionId);
	}

	rememberScroll(key: string, state: ScrollState): void {
		this.#scrollStates.set(key, state);
	}

	scrollState(key: string): ScrollState | undefined {
		return this.#scrollStates.get(key);
	}

	removeScrollState(key: string): void {
		this.#scrollStates.delete(key);
	}

	rememberTabForPathname(pathname: string): void {
		const tab = this.tabs.find((candidate) => this.hrefForTab(candidate) === pathname);
		if (!tab || tab.id === this.activeTabId) {
			return;
		}

		this.activeTabId = tab.id;
		this.persist();
	}

	setRoutePathname(pathname: string): void {
		const tab = this.tabs.find((candidate) => this.hrefForTab(candidate) === pathname);
		this.#setActiveChat(tab?.kind === 'chat' ? tab : undefined);
	}

	createNewTab(tabId = randomId()): NewTab {
		const existing = this.findNewTab(tabId);
		if (existing) {
			return existing;
		}

		const tab: NewTab = {
			id: tabId,
			kind: 'new',
			title: 'New chat',
			draft: this.#defaultDraft(),
			addingProject: false,
			projectPath: '',
			projectName: ''
		};
		this.tabs.push(tab);
		this.persist();

		return tab;
	}

	ensureNewTab(tabId: string): NewTab | undefined {
		const existing = this.findNewTab(tabId);
		if (existing || this.tabs.some((tab) => tab.id === tabId)) {
			return existing;
		}

		return this.createNewTab(tabId);
	}

	findNewTab(tabId: string): NewTab | undefined {
		return this.tabs.find((tab): tab is NewTab => tab.kind === 'new' && tab.id === tabId);
	}

	findChat(projectId: string, sessionId: string): ChatTab | undefined {
		return this.tabs.find(
			(tab): tab is ChatTab =>
				tab.kind === 'chat' && tab.projectId === projectId && tab.sessionId === sessionId
		);
	}

	selectedModel(key: string): ModelOption | undefined {
		return this.models.find((model) => modelKey(model) === key);
	}

	changeNewTabModel(tab: NewTab, key: string): void {
		tab.draft.modelKey = key;
		const model = this.selectedModel(key);
		if (!model) {
			return;
		}

		localStorage.setItem(LAST_MODEL_KEY, key);
		if (model.reasoning === false) {
			tab.draft.thinkingLevel = 'off';
			localStorage.setItem(LAST_THINKING_LEVEL_KEY, 'off');
		}

		this.persist();
	}

	changeNewTabThinking(tab: NewTab, thinkingLevel: ThinkingLevel): void {
		tab.draft.thinkingLevel = thinkingLevel;
		localStorage.setItem(LAST_THINKING_LEVEL_KEY, thinkingLevel);
		this.persist();
	}

	selectNewTabProject(tab: NewTab, projectId: string): void {
		tab.draft.projectId = projectId;
		if (this.projects.some((project) => project.id === projectId)) {
			localStorage.setItem(LAST_PROJECT_KEY, projectId);
		}

		this.persist();
	}

	async addProject(tab: NewTab): Promise<boolean> {
		tab.projectError = '';
		try {
			const { project } = await createProject({ cwd: tab.projectPath, name: tab.projectName });
			this.projects = [project, ...this.projects];
			this.selectNewTabProject(tab, project.id);
			tab.projectPath = '';
			tab.projectName = '';
			tab.addingProject = false;
			await this.refreshSessions();
			this.persist();

			return true;
		} catch (error) {
			tab.projectError = error instanceof Error ? error.message : 'Unable to add the project.';

			return false;
		}
	}

	async refreshSessions(): Promise<void> {
		const { sessions } = await listSessions();
		this.sessions = sessions;
	}

	async startChat(tab: NewTab, openingPrompt: ChatSubmission): Promise<ChatTab> {
		const model = this.selectedModel(tab.draft.modelKey);
		if (!tab.draft.projectId || !model) {
			throw new Error('Choose a project and model before sending a message.');
		}

		try {
			localStorage.setItem(LAST_PROJECT_KEY, tab.draft.projectId);
			const { checkpoint } = await createRuntime({
				mode: 'new',
				projectId: tab.draft.projectId,
				model,
				thinkingLevel: tab.draft.thinkingLevel
			});
			const chat = this.#createChatTab(tab.id, checkpoint);
			this.tabs = this.tabs.map((candidate) => (candidate.id === tab.id ? chat : candidate));
			const accepted = await this.sendPrompt(chat, openingPrompt);
			if (!accepted) {
				chat.draft = openingPrompt.text;
			}

			this.persist();

			return chat;
		} catch (error) {
			throw normalizeError(error, 'Unable to start the chat.');
		}
	}

	async ensureChat(projectId: string, sessionId: string): Promise<ChatTab | undefined> {
		let chat = this.findChat(projectId, sessionId);
		if (!chat) {
			chat = {
				id: randomId(),
				kind: 'chat',
				title: 'Loading chat',
				projectId,
				sessionId,
				hydrationState: 'unhydrated',
				hydrationGeneration: 0,
				bufferedEvents: [],
				needsCheckpoint: false,
				draft: '',
				queueMode: 'followUp',
				streamText: '',
				streamRenderedText: '',
				streamThinking: '',
				streamTools: [],
				streamToolsByCallId: new SvelteMap(),
				transientNotices: [],
				permissionRequests: [],
				pendingUserMessages: []
			};
			this.tabs.push(chat);
		}

		this.#setActiveChat(chat);

		return this.#loadChat(chat);
	}

	async sendPrompt(chat: ChatTab, submission: ChatSubmission): Promise<boolean> {
		const message = submission.text.trim();
		if ((!message && !submission.attachments.length) || !chat.runtimeId) {
			return false;
		}

		const knownUserItemIds = this.#userItemIds(chat.snapshot);
		try {
			const result = await promptRuntime(chat.runtimeId, {
				text: message,
				attachments: submission.attachments,
				streamingBehavior: chat.queueMode
			});
			if (result.userMessageText !== undefined) {
				chat.pendingUserMessages.push({
					id: `pending-${randomId()}`,
					text: result.userMessageText,
					attachments: submission.attachments,
					timestamp: new SvelteDate().toISOString(),
					knownUserItemIds
				});
				// An entry can arrive over SSE before the prompt response does.
				this.#reconcilePendingUserMessages(chat);
			}

			this.persist();

			return true;
		} catch (error) {
			throw normalizeError(error, 'Unable to send the message.');
		}
	}

	async stopChat(chat: ChatTab): Promise<void> {
		if (!chat.runtimeId) {
			return;
		}

		try {
			await abortRuntime(chat.runtimeId);
		} catch (error) {
			errorNotices.show(normalizeError(error, 'Unable to stop the response.'));
		}
	}

	async setMcpServerEnabled(chat: ChatTab, serverName: string, enabled: boolean): Promise<void> {
		if (!chat.runtimeId) {
			throw new Error('Chat tab is no longer active.');
		}

		const response = await setRuntimeMcpServerEnabled(chat.runtimeId, { serverName, enabled });
		this.#applyCheckpoint(chat, response.checkpoint);
	}

	clearTransientNotices(chat: ChatTab): void {
		chat.transientNotices = [];
	}

	async respondToPermission(
		chat: ChatTab,
		request: PendingPermission,
		value: string
	): Promise<void> {
		if (!chat.runtimeId || request.responding) {
			return;
		}

		request.error = undefined;
		request.responding = true;
		try {
			await respondToPermission(chat.runtimeId, { requestId: request.id, value });
			chat.permissionRequests = chat.permissionRequests.filter(
				(candidate) => candidate.id !== request.id
			);
		} catch (error) {
			request.error =
				error instanceof Error ? error.message : 'Unable to submit the permission response.';
		} finally {
			request.responding = false;
		}
	}

	async confirmPermission(
		chat: ChatTab,
		request: PendingPermission,
		confirmed: boolean
	): Promise<void> {
		if (!chat.runtimeId || request.responding) {
			return;
		}

		request.error = undefined;
		request.responding = true;
		try {
			await respondToPermission(chat.runtimeId, { requestId: request.id, confirmed });
			chat.permissionRequests = chat.permissionRequests.filter(
				(candidate) => candidate.id !== request.id
			);
		} catch (error) {
			request.error =
				error instanceof Error ? error.message : 'Unable to submit the permission response.';
		} finally {
			request.responding = false;
		}
	}

	async cancelPermission(chat: ChatTab, request: PendingPermission): Promise<void> {
		if (!chat.runtimeId || request.responding) {
			return;
		}

		request.error = undefined;
		request.responding = true;
		try {
			await respondToPermission(chat.runtimeId, { requestId: request.id, cancelled: true });
			chat.permissionRequests = chat.permissionRequests.filter(
				(candidate) => candidate.id !== request.id
			);
		} catch (error) {
			request.error =
				error instanceof Error ? error.message : 'Unable to submit the permission response.';
		} finally {
			request.responding = false;
		}
	}

	async changeModel(chat: ChatTab, key: string): Promise<void> {
		const model = this.selectedModel(key);
		if (!model || !chat.runtimeId) {
			return;
		}

		try {
			const { checkpoint } = await setRuntimeModel(chat.runtimeId, model);
			this.#applyCheckpoint(chat, checkpoint);
			localStorage.setItem(LAST_MODEL_KEY, key);
			if (model.reasoning === false) {
				localStorage.setItem(LAST_THINKING_LEVEL_KEY, 'off');
			}
		} catch (error) {
			errorNotices.show(normalizeError(error, 'Unable to change the model.'));
		}
	}

	async changeThinking(chat: ChatTab, thinkingLevel: ThinkingLevel): Promise<void> {
		if (!chat.runtimeId) {
			return;
		}

		try {
			const { checkpoint } = await setRuntimeThinking(chat.runtimeId, thinkingLevel);
			this.#applyCheckpoint(chat, checkpoint);
			localStorage.setItem(LAST_THINKING_LEVEL_KEY, thinkingLevel);
		} catch (error) {
			errorNotices.show(normalizeError(error, 'Unable to change reasoning.'));
		}
	}

	async closeTab(tab: WorkspaceTab): Promise<void> {
		if (tab.kind === 'chat') {
			this.#cancelInactiveRuntimeDisposal(tab);
			this.#invalidateHydration(tab);
			if (this.#activeChatId === tab.id) {
				this.#activeChatId = undefined;
			}
		}

		const index = this.tabs.findIndex((candidate) => candidate.id === tab.id);
		this.tabs = this.tabs.filter((candidate) => candidate.id !== tab.id);
		if (this.activeTabId === tab.id) {
			this.activeTabId = this.tabs[index]?.id ?? this.tabs[index - 1]?.id;
		}

		this.removeScrollState(`tab:${tab.id}`);
		this.#streamUpdates.discard(tab.id);
		this.persist();
		if (tab.kind === 'chat' && tab.runtimeId) {
			try {
				await disposeRuntime(tab.runtimeId);
			} catch {
				// A stale server runtime must not prevent closing the local tab.
			}
		}
	}

	applyTheme(theme: Theme): void {
		this.theme = theme;
		localStorage.setItem(THEME_KEY, theme);
		document.documentElement.dataset.theme = theme;
	}

	setShowReasoning(show: boolean): void {
		this.showReasoning = show;
		localStorage.setItem(SHOW_REASONING_KEY, String(show));
	}

	setShowModelChanges(show: boolean): void {
		this.showModelChanges = show;
		localStorage.setItem(SHOW_MODEL_CHANGES_KEY, String(show));
	}

	async refreshRuntime(chat: ChatTab): Promise<void> {
		await this.#loadChat(chat, true);
	}

	#defaultDraft(): NewDraft {
		const remembered = localStorage.getItem(LAST_PROJECT_KEY);
		const projectId = this.projects.some((project) => project.id === remembered)
			? (remembered ?? '')
			: (this.projects[0]?.id ?? '');
		const rememberedModel = localStorage.getItem(LAST_MODEL_KEY);
		const model = this.selectedModel(rememberedModel ?? '') ?? this.models[0];
		const rememberedThinking = localStorage.getItem(LAST_THINKING_LEVEL_KEY);
		const thinkingLevel =
			model?.reasoning === false
				? 'off'
				: isThinkingLevel(rememberedThinking)
					? rememberedThinking
					: 'medium';

		return {
			projectId,
			modelKey: model ? modelKey(model) : '',
			thinkingLevel,
			prompt: ''
		};
	}

	async #initialize(): Promise<void> {
		this.#restoreTheme();
		this.#restoreShowReasoning();
		this.#restoreShowModelChanges();
		try {
			const [projects, models, sessions] = await Promise.all([
				listProjects(),
				listModels(),
				listSessions()
			]);
			this.projects = projects.projects;
			this.models = models.models;
			this.sessions = sessions.sessions;
			this.#restoreTabs();
			this.#connectEvents();
		} catch (error) {
			this.error = error instanceof Error ? error.message : 'Unable to load the harness.';
		} finally {
			this.initializing = false;
		}
	}

	#connectEvents(): void {
		if (this.#events) {
			return;
		}

		this.#events = openEventStream(this.#lastEventId, (event) => this.#handleEvent(event));
	}

	#handleEvent(message: StreamMessage): void {
		if (!('id' in message)) {
			this.#lastEventId = undefined;
			const activeChat = this.tabs.find(
				(tab): tab is ChatTab => tab.kind === 'chat' && tab.id === this.#activeChatId
			);
			if (activeChat) {
				void this.#loadChat(activeChat, true);
			}

			return;
		}

		this.#lastEventId = message.id;
		const chat = this.tabs.find(
			(tab): tab is ChatTab => tab.kind === 'chat' && tab.runtimeId === message.runtimeId
		);
		if (!chat || chat.hydrationState === 'unhydrated' || chat.hydrationState === 'failed') {
			return;
		}

		if (chat.hydrationState === 'hydrating') {
			this.#bufferHydrationEvent(chat, message);

			return;
		}

		this.#applyEnvelope(chat, message);
	}

	#applyEnvelope(chat: ChatTab, envelope: StreamEnvelope): void {
		const event = envelope.event;
		if (event.type === 'notice') {
			if (event.message.trim()) {
				chat.transientNotices.push({ id: `notice-${envelope.id}`, message: event.message });
			}

			if (chat.transientNotices.length > 20) {
				chat.transientNotices.splice(0, 1);
			}

			return;
		}

		if (event.type === 'error') {
			errorNotices.show(event.message);

			return;
		}

		if (!chat.runtime) {
			return;
		}

		const result = applyRuntimeEvent(chat.runtime, event);
		if (result === 'recovery') {
			if (chat.hydrationState === 'hydrating') {
				this.#bufferHydrationEvent(chat, envelope);
				chat.needsCheckpoint = true;
			} else if (chat.id === this.#activeChatId) {
				this.#bufferHydrationEvent(chat, envelope);
				void this.#loadChat(chat, true);
			} else {
				this.#invalidateHydration(chat);
			}

			return;
		}

		if (result === 'duplicate') {
			return;
		}

		if (event.type !== 'assistant_delta' && event.type !== 'tool_update') {
			chat.snapshot = snapshotFromState(chat.runtime);
			chat.permissionRequests = chat.snapshot.permissionRequests.map((request) => ({ ...request }));
			this.#reconcilePendingUserMessages(chat);
		}

		if (event.type === 'assistant_delta') {
			this.#queueAssistantDelta(chat, event.text ?? '', event.thinking ?? '');
		}

		if (event.type === 'tool_update') {
			this.#queueToolUpdate(chat, {
				id: event.toolCallId,
				name: event.toolName,
				status: event.status,
				...(event.arguments !== undefined ? { arguments: event.arguments } : {}),
				...(event.text !== undefined ? { text: event.text } : {})
			});
		}

		if (
			(event.type === 'metadata_updated' && event.patch.isStreaming === false) ||
			((event.type === 'items_appended' || event.type === 'items_replaced') &&
				chat.snapshot?.isStreaming === false)
		) {
			this.#streamUpdates.discard(chat.id);
			chat.streamText = '';
			chat.streamRenderedText = '';
			chat.streamThinking = '';
			chat.streamTools = [];
			chat.streamToolsByCallId?.clear();
		}

		this.#scheduleInactiveRuntimeDisposal(chat);
	}

	#chatKey(chat: Pick<ChatTab, 'projectId' | 'sessionId'>): string {
		return `${chat.projectId}:${chat.sessionId}`;
	}

	#setActiveChat(chat: ChatTab | undefined): void {
		if (this.#activeChatId === chat?.id) {
			return;
		}

		const previous = this.tabs.find(
			(tab): tab is ChatTab => tab.kind === 'chat' && tab.id === this.#activeChatId
		);
		if (previous?.hydrationState === 'hydrating') {
			this.#invalidateHydration(previous);
		}

		this.#activeChatId = chat?.id;
		if (chat) {
			this.#cancelInactiveRuntimeDisposal(chat);
		}

		if (previous?.hydrationState === 'ready') {
			this.#scheduleInactiveRuntimeDisposal(previous);
		}
	}

	#isCurrentHydration(chat: ChatTab, generation: number): boolean {
		return (
			chat.hydrationGeneration === generation &&
			this.tabs.some((tab) => tab === chat) &&
			chat.hydrationState === 'hydrating'
		);
	}

	#invalidateHydration(chat: ChatTab): void {
		chat.hydrationGeneration += 1;
		chat.hydrationState = 'unhydrated';
		chat.error = undefined;
		chat.bufferedEvents = [];
		chat.needsCheckpoint = false;
		this.#hydrationControllers.get(chat.id)?.abort();
		this.#hydrationControllers.delete(chat.id);
		this.#chatLoads.delete(this.#chatKey(chat));
	}

	#scheduleInactiveRuntimeDisposal(chat: ChatTab): void {
		if (
			this.#activeChatId === chat.id ||
			chat.hydrationState !== 'ready' ||
			!chat.runtimeId ||
			chat.snapshot?.isStreaming ||
			chat.permissionRequests.length ||
			chat.pendingUserMessages.length ||
			this.#inactiveRuntimeTimers.has(chat.id)
		) {
			return;
		}

		const runtimeId = chat.runtimeId;
		const timer = setTimeout(() => {
			this.#inactiveRuntimeTimers.delete(chat.id);
			void this.#disposeInactiveRuntime(chat, runtimeId);
		}, INACTIVE_RUNTIME_DISPOSAL_MS);
		this.#inactiveRuntimeTimers.set(chat.id, timer);
	}

	#cancelInactiveRuntimeDisposal(chat: ChatTab): void {
		const timer = this.#inactiveRuntimeTimers.get(chat.id);
		if (timer) {
			clearTimeout(timer);
			this.#inactiveRuntimeTimers.delete(chat.id);
		}
	}

	async #disposeInactiveRuntime(chat: ChatTab, runtimeId: string): Promise<void> {
		if (
			this.#activeChatId === chat.id ||
			chat.runtimeId !== runtimeId ||
			chat.hydrationState !== 'ready' ||
			chat.snapshot?.isStreaming ||
			chat.permissionRequests.length ||
			chat.pendingUserMessages.length
		) {
			return;
		}

		// Clear local runtime state before the request so a simultaneous activation resumes a
		// fresh runtime instead of using one that is being disposed.
		this.#invalidateHydration(chat);
		chat.runtimeId = undefined;
		chat.runtime = undefined;
		chat.snapshot = undefined;
		chat.streamText = '';
		chat.streamRenderedText = '';
		chat.streamThinking = '';
		chat.streamTools = [];
		chat.streamToolsByCallId?.clear();
		chat.permissionRequests = [];
		this.#streamUpdates.discard(chat.id);
		this.persist();

		try {
			await disposeRuntime(runtimeId);
		} catch {
			// A failed teardown leaves no usable local runtime ID; the next activation resumes it.
		}
	}

	#bufferHydrationEvent(chat: ChatTab, envelope: StreamEnvelope): void {
		if (chat.needsCheckpoint) {
			return;
		}

		if (chat.bufferedEvents.length >= MAX_HYDRATION_BUFFERED_EVENTS) {
			chat.bufferedEvents = [];
			chat.needsCheckpoint = true;

			return;
		}

		chat.bufferedEvents.push(envelope);
	}

	async #loadChat(chat: ChatTab, force = false): Promise<ChatTab | undefined> {
		const key = this.#chatKey(chat);
		const existingLoad = this.#chatLoads.get(key);
		if (existingLoad) {
			return existingLoad;
		}

		if (!force && chat.hydrationState === 'ready') {
			return chat;
		}

		const generation = chat.hydrationGeneration + 1;
		chat.hydrationGeneration = generation;
		chat.hydrationState = 'hydrating';
		chat.error = undefined;
		const controller = new AbortController();
		this.#hydrationControllers.set(chat.id, controller);

		const load = this.#hydrateChat(chat, generation, controller.signal)
			.then(() => {
				if (!this.#isCurrentHydration(chat, generation)) {
					return undefined;
				}

				chat.hydrationState = 'ready';
				this.#scheduleInactiveRuntimeDisposal(chat);

				return chat;
			})
			.catch((error: unknown) => {
				if (this.#isCurrentHydration(chat, generation)) {
					chat.hydrationState = 'failed';
					chat.error = error instanceof Error ? error.message : 'Unable to open this session.';
				}

				return undefined;
			})
			.finally(() => {
				if (this.#hydrationControllers.get(chat.id) === controller) {
					this.#hydrationControllers.delete(chat.id);
				}

				if (this.#chatLoads.get(key) === load) {
					this.#chatLoads.delete(key);
				}

				if (chat.hydrationGeneration === generation && this.tabs.some((tab) => tab === chat)) {
					this.persist();
				}
			});
		this.#chatLoads.set(key, load);

		return load;
	}

	async #hydrateChat(chat: ChatTab, generation: number, signal: AbortSignal): Promise<void> {
		const createdRuntimeIds: string[] = [];
		try {
			while (this.#isCurrentHydration(chat, generation)) {
				chat.needsCheckpoint = false;
				const { checkpoint, createdRuntimeId } = await this.#fetchCheckpoint(
					chat,
					generation,
					signal
				);
				if (createdRuntimeId) {
					createdRuntimeIds.push(createdRuntimeId);
				}

				if (!this.#isCurrentHydration(chat, generation)) {
					await this.#disposeCreatedRuntimes(createdRuntimeIds);

					return;
				}

				this.#applyCheckpoint(chat, checkpoint);
				if (chat.needsCheckpoint) {
					chat.bufferedEvents = [];

					continue;
				}

				const buffered = chat.bufferedEvents;
				chat.bufferedEvents = [];
				for (const envelope of buffered) {
					if (
						envelope.cursor.epoch !== checkpoint.cursor.epoch ||
						envelope.cursor.sequence > checkpoint.cursor.sequence
					) {
						this.#applyEnvelope(chat, envelope);
					}
				}

				if (chat.needsCheckpoint) {
					chat.bufferedEvents = [];

					continue;
				}

				return;
			}
		} catch (error) {
			if (!this.#isCurrentHydration(chat, generation)) {
				await this.#disposeCreatedRuntimes(createdRuntimeIds);

				return;
			}

			throw error;
		}
	}

	async #fetchCheckpoint(
		chat: ChatTab,
		generation: number,
		signal: AbortSignal
	): Promise<{ checkpoint: RuntimeCheckpoint; createdRuntimeId?: string }> {
		if (chat.runtimeId) {
			try {
				const response = await getRuntime(chat.runtimeId, signal);
				if (
					response.checkpoint.snapshot.project.id === chat.projectId &&
					response.checkpoint.snapshot.sessionId === chat.sessionId
				) {
					return { checkpoint: response.checkpoint };
				}
			} catch (error) {
				if (signal.aborted) {
					throw error;
				}
			}
		}

		if (!this.#isCurrentHydration(chat, generation)) {
			throw new Error('Chat hydration was superseded.');
		}

		// Do not abort the resume request: if it succeeds after cancellation, we need its
		// checkpoint to dispose the runtime rather than leaving an orphan on the server.
		const response = await createRuntime({
			mode: 'resume',
			projectId: chat.projectId,
			sessionId: chat.sessionId
		});

		return {
			checkpoint: response.checkpoint,
			createdRuntimeId: response.checkpoint.snapshot.runtimeId
		};
	}

	async #disposeCreatedRuntimes(runtimeIds: string[]): Promise<void> {
		await Promise.all(
			runtimeIds.map(async (runtimeId) => {
				try {
					await disposeRuntime(runtimeId);
				} catch {
					// The runtime may already have been removed server-side.
				}
			})
		);
	}

	#queueAssistantDelta(chat: ChatTab, text: string, thinking: string): void {
		this.#streamUpdates.queueAssistantDelta(chat, text, thinking);
	}

	#queueToolUpdate(chat: ChatTab, tool: StreamingTool): void {
		this.#streamUpdates.queueToolUpdate(chat, tool);
	}

	#applyCheckpoint(chat: ChatTab, checkpoint: RuntimeCheckpoint): void {
		this.#streamUpdates.discard(chat.id);
		chat.runtime = stateFromCheckpoint(checkpoint, chat.runtime);
		const snapshot = snapshotFromState(chat.runtime);
		chat.snapshot = snapshot;
		chat.permissionRequests = snapshot.permissionRequests.map((request) => ({ ...request }));
		this.#reconcilePendingUserMessages(chat);
		chat.runtimeId = snapshot.runtimeId;
		chat.title = this.#chatTitle(snapshot);
		chat.streamText = checkpoint.live.text;
		chat.streamRenderedText = checkpoint.live.text;
		chat.streamThinking = checkpoint.live.thinking;
		chat.streamTools = checkpoint.live.tools.map((tool) => ({ ...tool }));
		chat.streamToolsByCallId = streamToolMap(chat.streamTools);
	}

	#createChatTab(id: string, checkpoint: RuntimeCheckpoint): ChatTab {
		const runtime = stateFromCheckpoint(checkpoint);
		const snapshot = snapshotFromState(runtime);
		const streamTools = checkpoint.live.tools.map((tool) => ({ ...tool }));

		return {
			id,
			kind: 'chat',
			title: this.#chatTitle(snapshot),
			projectId: snapshot.project.id,
			sessionId: snapshot.sessionId,
			runtimeId: snapshot.runtimeId,
			snapshot,
			runtime,
			bufferedEvents: [],
			needsCheckpoint: false,
			hydrationState: 'ready',
			hydrationGeneration: 0,
			draft: '',
			queueMode: 'followUp',
			streamText: checkpoint.live.text,
			streamRenderedText: checkpoint.live.text,
			streamThinking: checkpoint.live.thinking,
			streamTools,
			streamToolsByCallId: streamToolMap(streamTools),
			transientNotices: [],
			permissionRequests: snapshot.permissionRequests.map((request) => ({ ...request })),
			pendingUserMessages: []
		};
	}

	#userItemIds(snapshot: RuntimeSnapshot | undefined): string[] {
		return snapshot?.items.filter((item) => item.role === 'user').map((item) => item.id) ?? [];
	}

	#reconcilePendingUserMessages(chat: ChatTab): void {
		if (!chat.snapshot || !chat.pendingUserMessages.length) {
			return;
		}

		chat.pendingUserMessages = reconcilePendingUserMessages(
			chat.pendingUserMessages,
			chat.snapshot.items
		);
	}

	#chatTitle(snapshot: RuntimeSnapshot): string {
		if (snapshot.sessionName) {
			return snapshot.sessionName;
		}

		const firstMessage = snapshot.items.find((item) => item.role === 'user')?.text;

		return firstMessage ? firstMessage.slice(0, 42) : 'New chat';
	}

	#restoreTheme(): void {
		const stored = localStorage.getItem(THEME_KEY);
		if (isTheme(stored)) {
			this.applyTheme(stored);
		}
	}

	#restoreShowReasoning(): void {
		this.showReasoning = localStorage.getItem(SHOW_REASONING_KEY) === 'true';
	}

	#restoreShowModelChanges(): void {
		this.showModelChanges = localStorage.getItem(SHOW_MODEL_CHANGES_KEY) === 'true';
	}

	#restoreTabs(): void {
		const restored = this.#readStoredWorkspace();
		if (!restored) {
			return;
		}

		this.#lastEventId = restored.lastEventId;
		const tabs: WorkspaceTab[] = [];
		const tabIds = new SvelteSet<string>();
		const chatSessions = new SvelteSet<string>();
		for (const tab of restored.tabs) {
			if (tabIds.has(tab.id)) {
				continue;
			}

			if (tab.kind === 'chat') {
				const sessionKey = `${tab.projectId}:${tab.sessionId}`;
				if (chatSessions.has(sessionKey)) {
					continue;
				}

				chatSessions.add(sessionKey);
			}

			tabIds.add(tab.id);
			tabs.push(tab.kind === 'new' ? this.#fromStoredNew(tab) : this.#fromStoredChat(tab));
		}

		this.tabs = tabs;
		this.activeTabId = tabs.some((tab) => tab.id === restored.activeTabId)
			? restored.activeTabId
			: undefined;
		if (tabs.length !== restored.tabs.length || this.activeTabId !== restored.activeTabId) {
			this.persist();
		}
	}

	#readStoredWorkspace(): StoredWorkspaceV1 | undefined {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const parsed: unknown = JSON.parse(raw);
				if (isRecord(parsed) && parsed.version === 1 && Array.isArray(parsed.tabs)) {
					const tabs = parsed.tabs.flatMap((tab) => this.#parseStoredTab(tab));

					return {
						version: 1,
						// Numeric v1 cursors cannot be interpreted as epoch-qualified v2 cursors.
						lastEventId: typeof parsed.lastEventId === 'string' ? parsed.lastEventId : undefined,
						activeTabId: typeof parsed.activeTabId === 'string' ? parsed.activeTabId : undefined,
						tabs
					};
				}
			}

			const legacyRaw = localStorage.getItem(LEGACY_OPEN_CHATS_KEY);
			if (!legacyRaw) {
				return undefined;
			}

			const legacy: unknown = JSON.parse(legacyRaw);
			if (!Array.isArray(legacy)) {
				return undefined;
			}

			const seen = new SvelteSet<string>();
			const tabs: StoredChatTab[] = [];
			for (const value of legacy) {
				if (
					!isRecord(value) ||
					typeof value.projectId !== 'string' ||
					typeof value.sessionId !== 'string'
				) {
					continue;
				}

				const key = `${value.projectId}:${value.sessionId}`;
				if (seen.has(key)) {
					continue;
				}

				seen.add(key);
				tabs.push({
					kind: 'chat',
					id: randomId(),
					title: 'Loading chat',
					projectId: value.projectId,
					sessionId: value.sessionId,
					draft: '',
					queueMode: 'followUp'
				});
			}

			const migrated: StoredWorkspaceV1 = { version: 1, tabs };
			this.#writeStoredWorkspace(migrated);
			localStorage.removeItem(LEGACY_OPEN_CHATS_KEY);

			return migrated;
		} catch {
			localStorage.removeItem(STORAGE_KEY);

			return undefined;
		}
	}

	#parseStoredTab(value: unknown): Array<StoredNewTab | StoredChatTab> {
		if (
			!isRecord(value) ||
			typeof value.kind !== 'string' ||
			typeof value.id !== 'string' ||
			typeof value.title !== 'string'
		) {
			return [];
		}

		if (value.kind === 'new' && isRecord(value.draft)) {
			const draft = value.draft;
			if (
				typeof draft.projectId === 'string' &&
				typeof draft.modelKey === 'string' &&
				isThinkingLevel(draft.thinkingLevel) &&
				typeof draft.prompt === 'string'
			) {
				return [
					{
						kind: 'new',
						id: value.id,
						title: value.title,
						draft: {
							projectId: draft.projectId,
							modelKey: draft.modelKey,
							thinkingLevel: draft.thinkingLevel,
							prompt: draft.prompt
						}
					}
				];
			}
		}

		if (
			value.kind === 'chat' &&
			typeof value.projectId === 'string' &&
			typeof value.sessionId === 'string' &&
			typeof value.draft === 'string' &&
			isQueueMode(value.queueMode)
		) {
			return [
				{
					kind: 'chat',
					id: value.id,
					title: value.title,
					projectId: value.projectId,
					sessionId: value.sessionId,
					runtimeId: typeof value.runtimeId === 'string' ? value.runtimeId : undefined,
					draft: value.draft,
					queueMode: value.queueMode
				}
			];
		}

		return [];
	}

	#fromStoredNew(tab: StoredNewTab): NewTab {
		return {
			id: tab.id,
			kind: 'new',
			title: tab.title,
			draft: tab.draft,
			addingProject: false,
			projectPath: '',
			projectName: ''
		};
	}

	#fromStoredChat(tab: StoredChatTab): ChatTab {
		return {
			id: tab.id,
			kind: 'chat',
			title: tab.title,
			projectId: tab.projectId,
			sessionId: tab.sessionId,
			runtimeId: tab.runtimeId,
			hydrationState: 'unhydrated',
			hydrationGeneration: 0,
			bufferedEvents: [],
			needsCheckpoint: false,
			draft: tab.draft,
			queueMode: tab.queueMode,
			streamText: '',
			streamRenderedText: '',
			streamThinking: '',
			streamTools: [],
			streamToolsByCallId: new SvelteMap(),
			transientNotices: [],
			permissionRequests: [],
			pendingUserMessages: []
		};
	}

	persist(): void {
		const document: StoredWorkspaceV1 = {
			version: 1,
			lastEventId: this.#lastEventId,
			activeTabId: this.tabs.some((tab) => tab.id === this.activeTabId)
				? this.activeTabId
				: undefined,
			tabs: this.tabs.map((tab) => {
				if (tab.kind === 'new') {
					return { kind: 'new', id: tab.id, title: tab.title, draft: tab.draft };
				}

				return {
					kind: 'chat',
					id: tab.id,
					title: tab.title,
					projectId: tab.projectId,
					sessionId: tab.sessionId,
					runtimeId: tab.runtimeId,
					draft: tab.draft,
					queueMode: tab.queueMode
				};
			})
		};
		this.#writeStoredWorkspace(document);
	}

	#writeStoredWorkspace(document: StoredWorkspaceV1): void {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
	}
}

export const workspace = new HarnessWorkspace();

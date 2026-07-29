import type {
	HistoricalSession,
	ModelOption,
	Project,
	RuntimeSnapshot,
	StreamEnvelope,
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
	setRuntimeModel,
	setRuntimeThinking
} from '$lib/harness/api';
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
	type Theme,
	type WorkspaceTab
} from '$lib/harness/types';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';

const STORAGE_KEY = 'pi-squared:workspace:v1';
const LEGACY_OPEN_CHATS_KEY = 'pi-squared:open-chats';
const LAST_PROJECT_KEY = 'pi-squared:last-project';
const LAST_MODEL_KEY = 'pi-squared:last-model';
const LAST_THINKING_LEVEL_KEY = 'pi-squared:last-thinking-level';
const THEME_KEY = 'pi-squared:theme';

export const THEME_LABELS: Record<Theme, string> = {
	graphite: 'Graphite',
	paper: 'Paper',
	nord: 'Nord',
	solarized: 'Solarized',
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

export class HarnessWorkspace {
	projects = $state<Project[]>([]);
	models = $state<ModelOption[]>([]);
	sessions = $state<HistoricalSession[]>([]);
	tabs = $state<WorkspaceTab[]>([]);
	theme = $state<Theme>('graphite');
	initializing = $state(true);
	error = $state('');

	#started = false;
	#startPromise: Promise<void> | undefined;
	#events: EventSource | undefined;
	#lastEventId: number | undefined;
	#chatLoads = new SvelteMap<string, Promise<ChatTab | undefined>>();
	#scrollPositions = new SvelteMap<string, number>();
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
	}

	schedulePersist(): void {
		if (this.#persistTimer) clearTimeout(this.#persistTimer);
		this.#persistTimer = setTimeout(() => {
			this.#persistTimer = undefined;
			this.persist();
		}, 150);
	}

	rememberScrollPosition(pathname: string, scrollTop: number): void {
		this.#scrollPositions.set(pathname, scrollTop);
	}

	scrollPosition(pathname: string): number {
		return this.#scrollPositions.get(pathname) ?? 0;
	}

	newHref(tabId: string): string {
		return `/new/${encodeURIComponent(tabId)}`;
	}

	chatHref(projectId: string, sessionId: string): string {
		return `/chat/${encodeURIComponent(projectId)}/${encodeURIComponent(sessionId)}`;
	}

	hrefForTab(tab: WorkspaceTab): string {
		return tab.kind === 'new' ? this.newHref(tab.id) : this.chatHref(tab.projectId, tab.sessionId);
	}

	createNewTab(tabId = randomId()): NewTab {
		const existing = this.findNewTab(tabId);
		if (existing) return existing;
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
		if (existing || this.tabs.some((tab) => tab.id === tabId)) return existing;
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
		if (!model) return;
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

	async startChat(tab: NewTab, openingPrompt: string): Promise<ChatTab | undefined> {
		tab.error = '';
		const model = this.selectedModel(tab.draft.modelKey);
		if (!tab.draft.projectId || !model) {
			tab.error = 'Choose a project and model before sending a message.';
			return undefined;
		}

		try {
			localStorage.setItem(LAST_PROJECT_KEY, tab.draft.projectId);
			const { snapshot } = await createRuntime({
				mode: 'new',
				projectId: tab.draft.projectId,
				model,
				thinkingLevel: tab.draft.thinkingLevel
			});
			const chat = this.#createChatTab(tab.id, snapshot);
			this.tabs = this.tabs.map((candidate) => (candidate.id === tab.id ? chat : candidate));
			const accepted = await this.sendPrompt(chat, openingPrompt);
			if (!accepted) chat.draft = openingPrompt;
			this.persist();
			return chat;
		} catch (error) {
			tab.error = error instanceof Error ? error.message : 'Unable to start the chat.';
			return undefined;
		}
	}

	async ensureChat(projectId: string, sessionId: string): Promise<ChatTab | undefined> {
		const key = `${projectId}:${sessionId}`;
		const existingLoad = this.#chatLoads.get(key);
		if (existingLoad) return existingLoad;

		const existing = this.findChat(projectId, sessionId);
		if (existing?.snapshot) return existing;

		let chat =
			existing ??
			({
				id: randomId(),
				kind: 'chat',
				title: 'Loading chat',
				projectId,
				sessionId,
				hydrating: true,
				draft: '',
				queueMode: 'followUp',
				streamText: '',
				streamThinking: '',
				streamTools: [],
				transientNotices: [],
				permissionRequests: []
			} satisfies ChatTab);
		if (!existing) {
			this.tabs.push(chat);
			chat = this.findChat(projectId, sessionId) ?? chat;
		}

		const load = this.#hydrateChat(chat)
			.then(() => chat)
			.catch((error: unknown) => {
				chat.error = error instanceof Error ? error.message : 'Unable to open this session.';
				return undefined;
			})
			.finally(() => {
				chat.hydrating = false;
				this.#chatLoads.delete(key);
				this.persist();
			});
		this.#chatLoads.set(key, load);
		return load;
	}

	async sendPrompt(chat: ChatTab, text: string): Promise<boolean> {
		const message = text.trim();
		if (!message || !chat.runtimeId) return false;
		chat.error = '';
		try {
			await promptRuntime(chat.runtimeId, { text: message, streamingBehavior: chat.queueMode });
			this.persist();
			return true;
		} catch (error) {
			chat.error = error instanceof Error ? error.message : 'Unable to send the message.';
			return false;
		}
	}

	async stopChat(chat: ChatTab): Promise<void> {
		if (!chat.runtimeId) return;
		try {
			await abortRuntime(chat.runtimeId);
		} catch (error) {
			chat.error = error instanceof Error ? error.message : 'Unable to stop the response.';
		}
	}

	clearTransientNotices(chat: ChatTab): void {
		chat.transientNotices = [];
	}

	async respondToPermission(
		chat: ChatTab,
		request: PendingPermission,
		value: string
	): Promise<void> {
		if (!chat.runtimeId || request.responding) return;
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
		if (!chat.runtimeId || request.responding) return;
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
		if (!chat.runtimeId || request.responding) return;
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
		if (!model || !chat.runtimeId) return;
		try {
			const { snapshot } = await setRuntimeModel(chat.runtimeId, model);
			this.#applySnapshot(chat, snapshot);
			localStorage.setItem(LAST_MODEL_KEY, key);
			if (model.reasoning === false) localStorage.setItem(LAST_THINKING_LEVEL_KEY, 'off');
		} catch (error) {
			chat.error = error instanceof Error ? error.message : 'Unable to change the model.';
		}
	}

	async changeThinking(chat: ChatTab, thinkingLevel: ThinkingLevel): Promise<void> {
		if (!chat.runtimeId) return;
		try {
			const { snapshot } = await setRuntimeThinking(chat.runtimeId, thinkingLevel);
			this.#applySnapshot(chat, snapshot);
			localStorage.setItem(LAST_THINKING_LEVEL_KEY, thinkingLevel);
		} catch (error) {
			chat.error = error instanceof Error ? error.message : 'Unable to change reasoning.';
		}
	}

	async closeTab(tab: WorkspaceTab): Promise<void> {
		this.tabs = this.tabs.filter((candidate) => candidate.id !== tab.id);
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

	async refreshRuntime(chat: ChatTab): Promise<void> {
		await this.#hydrateChat(chat);
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
			await Promise.all(
				this.tabs
					.filter((tab): tab is ChatTab => tab.kind === 'chat')
					.map((tab) => this.ensureChat(tab.projectId, tab.sessionId))
			);
		} catch (error) {
			this.error = error instanceof Error ? error.message : 'Unable to load the harness.';
		} finally {
			this.initializing = false;
		}
	}

	#connectEvents(): void {
		if (this.#events) return;
		this.#events = openEventStream(this.#lastEventId, (event) => this.#handleEvent(event));
	}

	#handleEvent(envelope: StreamEnvelope): void {
		this.#lastEventId = envelope.id;
		this.schedulePersist();
		const chat = this.tabs.find(
			(tab): tab is ChatTab => tab.kind === 'chat' && tab.runtimeId === envelope.runtimeId
		);
		if (!chat) return;

		const event = envelope.event;
		if (event.type === 'snapshot') {
			this.#applySnapshot(chat, event.snapshot);
			this.persist();
			return;
		}
		if (event.type === 'assistant_delta') {
			chat.streamText += event.text ?? '';
			chat.streamThinking += event.thinking ?? '';
			return;
		}
		if (event.type === 'tool_update') {
			const tool = chat.streamTools.find((candidate) => candidate.id === event.toolCallId);
			if (tool) {
				tool.text = event.text;
				tool.isError = event.isError;
			} else {
				chat.streamTools.push({
					id: event.toolCallId,
					name: event.toolName,
					text: event.text,
					isError: event.isError
				});
			}
			return;
		}
		if (event.type === 'state') {
			if (chat.snapshot) chat.snapshot.isStreaming = event.isStreaming;
			return;
		}
		if (event.type === 'notice') {
			if (!event.message.trim()) return;
			chat.transientNotices.push({ id: `notice-${envelope.id}`, message: event.message });
			if (chat.transientNotices.length > 20) chat.transientNotices.splice(0, 1);
			return;
		}
		if (event.type === 'permission_request') {
			if (!chat.permissionRequests.some((request) => request.id === event.request.id)) {
				chat.permissionRequests.push({ ...event.request });
			}
			return;
		}
		if (event.type === 'permission_resolved') {
			chat.permissionRequests = chat.permissionRequests.filter(
				(request) => request.id !== event.requestId
			);
			return;
		}
		if (event.type === 'error') chat.error = event.message;
	}

	async #hydrateChat(chat: ChatTab): Promise<void> {
		let snapshot: RuntimeSnapshot | undefined;
		if (chat.runtimeId) {
			try {
				const response = await getRuntime(chat.runtimeId);
				if (
					response.snapshot.project.id === chat.projectId &&
					response.snapshot.sessionId === chat.sessionId
				) {
					snapshot = response.snapshot;
				}
			} catch {
				chat.runtimeId = undefined;
			}
		}
		if (!snapshot) {
			const response = await createRuntime({
				mode: 'resume',
				projectId: chat.projectId,
				sessionId: chat.sessionId
			});
			snapshot = response.snapshot;
		}
		this.#applySnapshot(chat, snapshot);
	}

	#applySnapshot(chat: ChatTab, snapshot: RuntimeSnapshot): void {
		chat.snapshot = snapshot;
		chat.runtimeId = snapshot.runtimeId;
		chat.title = this.#chatTitle(snapshot);
		chat.hydrating = false;
		chat.streamText = '';
		chat.streamThinking = '';
		chat.streamTools = [];
	}

	#createChatTab(id: string, snapshot: RuntimeSnapshot): ChatTab {
		return {
			id,
			kind: 'chat',
			title: this.#chatTitle(snapshot),
			projectId: snapshot.project.id,
			sessionId: snapshot.sessionId,
			runtimeId: snapshot.runtimeId,
			snapshot,
			hydrating: false,
			draft: '',
			queueMode: 'followUp',
			streamText: '',
			streamThinking: '',
			streamTools: [],
			transientNotices: [],
			permissionRequests: []
		};
	}

	#chatTitle(snapshot: RuntimeSnapshot): string {
		if (snapshot.sessionName) return snapshot.sessionName;
		const firstMessage = snapshot.items.find((item) => item.role === 'user')?.text;
		return firstMessage ? firstMessage.slice(0, 42) : 'New chat';
	}

	#restoreTheme(): void {
		const stored = localStorage.getItem(THEME_KEY);
		if (isTheme(stored)) this.applyTheme(stored);
	}

	#restoreTabs(): void {
		const restored = this.#readStoredWorkspace();
		if (!restored) return;
		this.#lastEventId = restored.lastEventId;
		const tabs: WorkspaceTab[] = [];
		const tabIds = new SvelteSet<string>();
		const chatSessions = new SvelteSet<string>();
		for (const tab of restored.tabs) {
			if (tabIds.has(tab.id)) continue;
			if (tab.kind === 'chat') {
				const sessionKey = `${tab.projectId}:${tab.sessionId}`;
				if (chatSessions.has(sessionKey)) continue;
				chatSessions.add(sessionKey);
			}
			tabIds.add(tab.id);
			tabs.push(tab.kind === 'new' ? this.#fromStoredNew(tab) : this.#fromStoredChat(tab));
		}
		this.tabs = tabs;
		if (tabs.length !== restored.tabs.length) this.persist();
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
						lastEventId: typeof parsed.lastEventId === 'number' ? parsed.lastEventId : undefined,
						tabs
					};
				}
			}

			const legacyRaw = localStorage.getItem(LEGACY_OPEN_CHATS_KEY);
			if (!legacyRaw) return undefined;
			const legacy: unknown = JSON.parse(legacyRaw);
			if (!Array.isArray(legacy)) return undefined;
			const seen = new SvelteSet<string>();
			const tabs: StoredChatTab[] = [];
			for (const value of legacy) {
				if (
					!isRecord(value) ||
					typeof value.projectId !== 'string' ||
					typeof value.sessionId !== 'string'
				)
					continue;
				const key = `${value.projectId}:${value.sessionId}`;
				if (seen.has(key)) continue;
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
			hydrating: true,
			draft: tab.draft,
			queueMode: tab.queueMode,
			streamText: '',
			streamThinking: '',
			streamTools: [],
			transientNotices: [],
			permissionRequests: []
		};
	}

	persist(): void {
		const document: StoredWorkspaceV1 = {
			version: 1,
			lastEventId: this.#lastEventId,
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

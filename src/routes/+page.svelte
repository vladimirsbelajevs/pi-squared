<script lang="ts">
	import { onMount } from 'svelte';
	import {
		THINKING_LEVELS,
		type HistoricalSession,
		type ModelOption,
		type Project,
		type RuntimeSnapshot,
		type StreamEnvelope,
		type ThinkingLevel
	} from '$lib/contracts';

	type UtilitySection = 'history' | 'settings';
	type Theme = 'graphite' | 'paper' | 'nord' | 'solarized' | 'system';

	interface NewDraft {
		projectId: string;
		modelKey: string;
		thinkingLevel: ThinkingLevel;
		prompt: string;
	}

	interface NewTab {
		id: string;
		kind: 'new';
		title: string;
		draft: NewDraft;
		error?: string;
	}

	interface StreamingTool {
		id: string;
		name: string;
		text: string;
		isError?: boolean;
	}

	interface ChatTab {
		id: string;
		kind: 'chat';
		title: string;
		snapshot: RuntimeSnapshot;
		draft: string;
		queueMode: 'followUp' | 'steer';
		streamText: string;
		streamThinking: string;
		streamTools: StreamingTool[];
		error?: string;
	}

	type Tab = NewTab | ChatTab;

	interface SavedChat {
		projectId: string;
		sessionId: string;
	}

	const THEME_LABELS: Record<Theme, string> = {
		graphite: 'Graphite',
		paper: 'Paper',
		nord: 'Nord',
		solarized: 'Solarized',
		system: 'Follow system'
	};

	let projects = $state<Project[]>([]);
	let models = $state<ModelOption[]>([]);
	let sessions = $state<HistoricalSession[]>([]);
	let tabs = $state<Tab[]>([]);
	let activeTabId = $state('utility');
	let utilitySection = $state<UtilitySection>('history');
	let theme = $state<Theme>('graphite');
	let historyQuery = $state('');
	let historyProjectId = $state('');
	let addingProject = $state(false);
	let projectPath = $state('');
	let projectName = $state('');
	let projectError = $state('');
	let loading = $state(true);
	let generalError = $state('');

	let activeTab = $derived(tabs.find((tab) => tab.id === activeTabId));
	let filteredSessions = $derived(
		sessions.filter((session) => {
			const needle = historyQuery.trim().toLowerCase();
			const matchesProject = !historyProjectId || session.projectId === historyProjectId;
			const matchesQuery =
				!needle ||
				[session.name, session.firstMessage, session.projectName].some((value) =>
					value?.toLowerCase().includes(needle)
				);
			return matchesProject && matchesQuery;
		})
	);

	function modelKey(model: Pick<ModelOption, 'provider' | 'id'>): string {
		return `${model.provider}::${model.id}`;
	}

	function selectedModel(key: string): ModelOption | undefined {
		return models.find((model) => modelKey(model) === key);
	}

	function newId(): string {
		return crypto.randomUUID();
	}

	function defaultDraft(): NewDraft {
		const rememberedProject = localStorage.getItem('pi-squared:last-project');
		const projectId =
			rememberedProject && projects.some((project) => project.id === rememberedProject)
				? rememberedProject
				: (projects[0]?.id ?? '');
		const model = models[0];
		return {
			projectId,
			modelKey: model ? modelKey(model) : '',
			thinkingLevel: 'medium',
			prompt: ''
		};
	}

	function createNewTab(): void {
		const tab: NewTab = { id: newId(), kind: 'new', title: 'New chat', draft: defaultDraft() };
		tabs.push(tab);
		activeTabId = tab.id;
	}

	function chatTitle(snapshot: RuntimeSnapshot): string {
		if (snapshot.sessionName) return snapshot.sessionName;
		const firstMessage = snapshot.items.find((item) => item.role === 'user')?.text;
		return firstMessage ? firstMessage.slice(0, 42) : 'New chat';
	}

	async function api<T>(url: string, init?: RequestInit): Promise<T> {
		const response = await fetch(url, {
			headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
			...init
		});
		const body: unknown = response.status === 204 ? undefined : await response.json();
		if (!response.ok) {
			const message =
				body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
					? body.error
					: 'Request failed.';
			throw new Error(message);
		}
		return body as T;
	}

	async function loadWorkspace(): Promise<void> {
		try {
			const [projectResponse, modelResponse, sessionResponse] = await Promise.all([
				api<{ projects: Project[] }>('/api/projects'),
				api<{ models: ModelOption[] }>('/api/models'),
				api<{ sessions: HistoricalSession[] }>('/api/sessions')
			]);
			projects = projectResponse.projects;
			models = modelResponse.models;
			sessions = sessionResponse.sessions;
			await restoreSavedChats();
		} catch (error) {
			generalError = error instanceof Error ? error.message : 'Unable to load the harness.';
		} finally {
			loading = false;
		}
	}

	function saveChats(): void {
		const openChats: SavedChat[] = tabs
			.filter((tab): tab is ChatTab => tab.kind === 'chat')
			.map((tab) => ({ projectId: tab.snapshot.project.id, sessionId: tab.snapshot.sessionId }));
		localStorage.setItem('pi-squared:open-chats', JSON.stringify(openChats));
	}

	async function restoreSavedChats(): Promise<void> {
		try {
			const stored = localStorage.getItem('pi-squared:open-chats');
			if (!stored) return;
			const chats: unknown = JSON.parse(stored);
			if (!Array.isArray(chats)) return;
			for (const chat of chats) {
				if (!chat || typeof chat !== 'object') continue;
				const saved = chat as Partial<SavedChat>;
				if (typeof saved.projectId !== 'string' || typeof saved.sessionId !== 'string') continue;
				await openHistoricalSession(saved.projectId, saved.sessionId, false);
			}
		} catch {
			localStorage.removeItem('pi-squared:open-chats');
		}
	}

	function applyTheme(nextTheme: Theme): void {
		theme = nextTheme;
		localStorage.setItem('pi-squared:theme', nextTheme);
		document.documentElement.dataset.theme = nextTheme;
	}

	async function addNewProject(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		projectError = '';
		try {
			const response = await api<{ project: Project }>('/api/projects', {
				method: 'POST',
				body: JSON.stringify({ cwd: projectPath, name: projectName })
			});
			projects = [response.project, ...projects];
			for (const tab of tabs) {
				if (tab.kind === 'new' && !tab.draft.projectId) tab.draft.projectId = response.project.id;
			}
			projectPath = '';
			projectName = '';
			addingProject = false;
			await refreshSessions();
		} catch (error) {
			projectError = error instanceof Error ? error.message : 'Unable to add the project.';
		}
	}

	async function refreshSessions(): Promise<void> {
		const response = await api<{ sessions: HistoricalSession[] }>('/api/sessions');
		sessions = response.sessions;
	}

	async function startChat(tab: NewTab): Promise<void> {
		tab.error = '';
		const model = selectedModel(tab.draft.modelKey);
		if (!tab.draft.projectId || !model || !tab.draft.prompt.trim()) {
			tab.error = 'Choose a project and model, then enter an opening prompt.';
			return;
		}

		try {
			localStorage.setItem('pi-squared:last-project', tab.draft.projectId);
			const response = await api<{ snapshot: RuntimeSnapshot }>('/api/runtimes', {
				method: 'POST',
				body: JSON.stringify({
					mode: 'new',
					projectId: tab.draft.projectId,
					model,
					thinkingLevel: tab.draft.thinkingLevel
				})
			});
			const openingPrompt = tab.draft.prompt;
			const chat: ChatTab = {
				id: tab.id,
				kind: 'chat',
				title: chatTitle(response.snapshot),
				snapshot: response.snapshot,
				draft: '',
				queueMode: 'followUp',
				streamText: '',
				streamThinking: '',
				streamTools: []
			};
			tabs = tabs.map((candidate) => (candidate.id === tab.id ? chat : candidate));
			await sendPrompt(chat, openingPrompt);
			saveChats();
		} catch (error) {
			tab.error = error instanceof Error ? error.message : 'Unable to start the chat.';
		}
	}

	async function openHistoricalSession(
		projectId: string,
		sessionId: string,
		focus = true
	): Promise<void> {
		const existing = tabs.find(
			(tab) =>
				tab.kind === 'chat' &&
				tab.snapshot.project.id === projectId &&
				tab.snapshot.sessionId === sessionId
		);
		if (existing) {
			if (focus) activeTabId = existing.id;
			return;
		}

		try {
			const response = await api<{ snapshot: RuntimeSnapshot }>('/api/runtimes', {
				method: 'POST',
				body: JSON.stringify({ mode: 'resume', projectId, sessionId })
			});
			const tab: ChatTab = {
				id: newId(),
				kind: 'chat',
				title: chatTitle(response.snapshot),
				snapshot: response.snapshot,
				draft: '',
				queueMode: 'followUp',
				streamText: '',
				streamThinking: '',
				streamTools: []
			};
			tabs.push(tab);
			if (focus) activeTabId = tab.id;
			saveChats();
		} catch (error) {
			generalError = error instanceof Error ? error.message : 'Unable to resume the session.';
		}
	}

	async function sendPrompt(chat: ChatTab, text = chat.draft): Promise<void> {
		const message = text.trim();
		if (!message) return;
		chat.error = '';
		chat.draft = '';
		try {
			await api(`/api/runtimes/${chat.snapshot.runtimeId}/prompt`, {
				method: 'POST',
				body: JSON.stringify({ text: message, streamingBehavior: chat.queueMode })
			});
		} catch (error) {
			chat.draft = message;
			chat.error = error instanceof Error ? error.message : 'Unable to send the message.';
		}
	}

	function sendChat(event: SubmitEvent, chat: ChatTab): void {
		event.preventDefault();
		void sendPrompt(chat);
	}

	async function stopChat(chat: ChatTab): Promise<void> {
		try {
			await api(`/api/runtimes/${chat.snapshot.runtimeId}/abort`, { method: 'POST' });
		} catch (error) {
			chat.error = error instanceof Error ? error.message : 'Unable to stop the response.';
		}
	}

	async function changeModel(chat: ChatTab, key: string): Promise<void> {
		const model = selectedModel(key);
		if (!model) return;
		try {
			const response = await api<{ snapshot: RuntimeSnapshot }>(
				`/api/runtimes/${chat.snapshot.runtimeId}/model`,
				{
					method: 'POST',
					body: JSON.stringify(model)
				}
			);
			chat.snapshot = response.snapshot;
			chat.title = chatTitle(response.snapshot);
		} catch (error) {
			chat.error = error instanceof Error ? error.message : 'Unable to change the model.';
		}
	}

	async function changeThinking(chat: ChatTab, thinkingLevel: ThinkingLevel): Promise<void> {
		try {
			const response = await api<{ snapshot: RuntimeSnapshot }>(
				`/api/runtimes/${chat.snapshot.runtimeId}/thinking`,
				{
					method: 'POST',
					body: JSON.stringify({ thinkingLevel })
				}
			);
			chat.snapshot = response.snapshot;
		} catch (error) {
			chat.error = error instanceof Error ? error.message : 'Unable to change reasoning.';
		}
	}

	async function closeTab(tab: Tab, event: MouseEvent): Promise<void> {
		event.stopPropagation();
		if (tab.kind === 'chat') {
			try {
				await fetch(`/api/runtimes/${tab.snapshot.runtimeId}`, { method: 'DELETE' });
			} catch {
				// Closing the local tab should not be blocked by an unavailable server runtime.
			}
		}
		tabs = tabs.filter((candidate) => candidate.id !== tab.id);
		if (activeTabId === tab.id) activeTabId = tabs.at(-1)?.id ?? 'utility';
		saveChats();
	}

	function updateFromEvent(envelope: StreamEnvelope): void {
		const tab = tabs.find(
			(candidate): candidate is ChatTab =>
				candidate.kind === 'chat' && candidate.snapshot.runtimeId === envelope.runtimeId
		);
		if (!tab) return;

		const event = envelope.event;
		if (event.type === 'snapshot') {
			tab.snapshot = event.snapshot;
			tab.title = chatTitle(event.snapshot);
			tab.streamText = '';
			tab.streamThinking = '';
			tab.streamTools = [];
			saveChats();
			return;
		}
		if (event.type === 'assistant_delta') {
			tab.streamText += event.text ?? '';
			tab.streamThinking += event.thinking ?? '';
			return;
		}
		if (event.type === 'tool_update') {
			const existing = tab.streamTools.find((tool) => tool.id === event.toolCallId);
			if (existing) {
				existing.text = event.text;
				existing.isError = event.isError;
			} else {
				tab.streamTools.push({
					id: event.toolCallId,
					name: event.toolName,
					text: event.text,
					isError: event.isError
				});
			}
			return;
		}
		if (event.type === 'state') {
			tab.snapshot.isStreaming = event.isStreaming;
			return;
		}
		if (event.type === 'error') tab.error = event.message;
	}

	function formatDate(value: string): string {
		return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
			new Date(value)
		);
	}

	onMount(() => {
		const rememberedTheme = localStorage.getItem('pi-squared:theme');
		if (rememberedTheme && rememberedTheme in THEME_LABELS) applyTheme(rememberedTheme as Theme);
		void loadWorkspace();

		const stream = new EventSource('/api/events');
		stream.onmessage = (message) => {
			try {
				const envelope: unknown = JSON.parse(message.data);
				if (
					envelope &&
					typeof envelope === 'object' &&
					'id' in envelope &&
					'runtimeId' in envelope &&
					'event' in envelope
				) {
					updateFromEvent(envelope as StreamEnvelope);
				}
			} catch {
				// A malformed event is ignored; EventSource will reconnect automatically.
			}
		};

		return () => stream.close();
	});
</script>

<svelte:head>
	<title>Pi Squared</title>
	<meta name="description" content="A local, tab-first coding harness for the Pi SDK." />
</svelte:head>

<main class="harness-shell">
	<div class="tab-strip" aria-label="Harness tabs" role="tablist">
		<button
			class:active={activeTabId === 'utility'}
			class="utility-tab"
			type="button"
			role="tab"
			aria-selected={activeTabId === 'utility'}
			aria-label="Historical sessions and harness settings"
			onclick={() => (activeTabId = 'utility')}
		>
			<span aria-hidden="true">◫</span>
		</button>
		<div class="tab-divider"></div>
		{#each tabs as tab (tab.id)}
			<div class:active={activeTabId === tab.id} class="chat-tab-wrap">
				<button
					class="chat-tab"
					type="button"
					role="tab"
					aria-selected={activeTabId === tab.id}
					onclick={() => (activeTabId = tab.id)}
				>
					{#if tab.kind === 'chat'}
						<span class:live={tab.snapshot.isStreaming} class="tab-status"></span>
					{:else}
						<span class="tab-plus">+</span>
					{/if}
					<span class="tab-title">{tab.title}</span>
				</button>
				<button
					class="tab-close"
					type="button"
					aria-label={`Close ${tab.title}`}
					onclick={(event) => closeTab(tab, event)}>×</button
				>
			</div>
		{/each}
		<button class="add-tab" type="button" aria-label="New chat tab" onclick={createNewTab}>+</button
		>
	</div>

	{#if generalError}
		<div class="app-error" role="alert">{generalError}</div>
	{/if}

	{#if loading}
		<section class="loading-state"><span class="pulse"></span>Loading local harness…</section>
	{:else if activeTabId === 'utility'}
		<section class="utility-view" role="tabpanel">
			<nav class="utility-nav" aria-label="Harness utility">
				<p class="eyebrow">Pi Squared</p>
				<button
					class:active={utilitySection === 'history'}
					type="button"
					onclick={() => (utilitySection = 'history')}
				>
					Historical sessions
				</button>
				<button
					class:active={utilitySection === 'settings'}
					type="button"
					onclick={() => (utilitySection = 'settings')}
				>
					Harness settings
				</button>
			</nav>

			<div class="utility-content">
				{#if utilitySection === 'history'}
					<header class="section-heading">
						<p class="eyebrow">All projects</p>
						<h1>Historical sessions</h1>
						<p>Open any saved conversation in its own continuable chat tab.</p>
					</header>
					<div class="history-controls">
						<input
							bind:value={historyQuery}
							aria-label="Search historical sessions"
							placeholder="Search sessions"
						/>
						<select bind:value={historyProjectId} aria-label="Filter sessions by project">
							<option value="">All projects</option>
							{#each projects as project (project.id)}
								<option value={project.id}>{project.name}</option>
							{/each}
						</select>
					</div>
					<div class="session-list">
						{#each filteredSessions as session (`${session.projectId}:${session.sessionId}`)}
							<button
								class="session-card"
								type="button"
								onclick={() => openHistoricalSession(session.projectId, session.sessionId)}
							>
								<strong>{session.name || session.firstMessage || 'Untitled session'}</strong>
								<span>{session.projectName} · {session.messageCount} messages</span>
								<time datetime={session.modifiedAt}>{formatDate(session.modifiedAt)}</time>
							</button>
						{:else}
							<div class="empty-list">No saved sessions match this view.</div>
						{/each}
					</div>
				{:else}
					<header class="section-heading">
						<p class="eyebrow">Local preferences</p>
						<h1>Harness settings</h1>
						<p>Visual preferences remain in this browser. Pi settings remain project-owned.</p>
					</header>
					<section class="settings-card" aria-labelledby="theme-heading">
						<div>
							<h2 id="theme-heading">Theme</h2>
							<p>Applies to tabs, history, settings, and every chat.</p>
						</div>
						<div class="theme-grid">
							{#each Object.entries(THEME_LABELS) as [value, label] (value)}
								<button
									class:chosen={theme === value}
									class={`theme-choice theme-${value}`}
									type="button"
									onclick={() => applyTheme(value as Theme)}
								>
									<span></span>{label}
								</button>
							{/each}
						</div>
					</section>
				{/if}
			</div>
		</section>
	{:else if activeTab?.kind === 'new'}
		<section class="new-tab-view" role="tabpanel">
			<div class="launchpad">
				<p class="eyebrow">New tab</p>
				<h1>Start a project conversation</h1>
				<p class="launchpad-intro">
					Choose where Pi works, select an authenticated model, then send the opening instruction.
				</p>

				<div class="launch-form">
					<label>
						<span>Project</span>
						<select bind:value={activeTab.draft.projectId}>
							<option value="" disabled>Select an added project</option>
							{#each projects as project (project.id)}
								<option value={project.id}>{project.name} · {project.cwd}</option>
							{/each}
						</select>
					</label>
					<button
						class="subtle-button"
						type="button"
						onclick={() => (addingProject = !addingProject)}
					>
						{addingProject ? 'Cancel project' : '+ Add project'}
					</button>

					{#if addingProject}
						<div class="add-project-panel">
							<p>
								Added projects are trusted local workspaces. Pi can read, edit, and run commands
								there.
							</p>
							<form onsubmit={addNewProject}>
								<label>
									<span>Absolute directory</span>
									<input bind:value={projectPath} placeholder="/home/me/code/project" required />
								</label>
								<label>
									<span>Display name <em>optional</em></span>
									<input bind:value={projectName} placeholder="Project name" />
								</label>
								{#if projectError}<p class="form-error" role="alert">{projectError}</p>{/if}
								<button class="primary-button" type="submit">Add trusted project</button>
							</form>
						</div>
					{/if}

					<div class="control-pair">
						<label>
							<span>Model</span>
							<select bind:value={activeTab.draft.modelKey}>
								<option value="" disabled>Select a configured model</option>
								{#each models as model (modelKey(model))}
									<option value={modelKey(model)}>{model.name} · {model.provider}</option>
								{/each}
							</select>
						</label>
						<label>
							<span>Reasoning</span>
							<select bind:value={activeTab.draft.thinkingLevel}>
								{#each THINKING_LEVELS as level (level)}
									<option value={level}>{level}</option>
								{/each}
							</select>
						</label>
					</div>

					<label>
						<span>Opening instruction</span>
						<textarea
							bind:value={activeTab.draft.prompt}
							placeholder="Ask Pi about this project…"
							rows="5"></textarea>
					</label>
					{#if activeTab.error}<p class="form-error" role="alert">{activeTab.error}</p>{/if}
					<button
						class="primary-button launch-button"
						type="button"
						disabled={!projects.length || !models.length}
						onclick={() => startChat(activeTab)}
					>
						Start chat
					</button>
				</div>
			</div>
		</section>
	{:else if activeTab?.kind === 'chat'}
		<section class="chat-view" role="tabpanel">
			<div class="chat-controls">
				<div class="project-lockup">
					<span class="eyebrow">Project</span>
					<strong>{activeTab.snapshot.project.name}</strong>
					<span title={activeTab.snapshot.project.cwd}>{activeTab.snapshot.project.cwd}</span>
				</div>
				<label class="compact-control">
					<span>Model</span>
					<select
						value={activeTab.snapshot.model ? modelKey(activeTab.snapshot.model) : ''}
						disabled={activeTab.snapshot.isStreaming}
						onchange={(event) =>
							changeModel(activeTab, (event.currentTarget as HTMLSelectElement).value)}
					>
						{#each models as model (modelKey(model))}
							<option value={modelKey(model)}>{model.name}</option>
						{/each}
					</select>
				</label>
				<label class="compact-control">
					<span>Reasoning</span>
					<select
						value={activeTab.snapshot.thinkingLevel}
						disabled={activeTab.snapshot.isStreaming}
						onchange={(event) =>
							changeThinking(
								activeTab,
								(event.currentTarget as HTMLSelectElement).value as ThinkingLevel
							)}
					>
						{#each THINKING_LEVELS as level (level)}
							<option value={level}>{level}</option>
						{/each}
					</select>
				</label>
				{#if activeTab.snapshot.isStreaming}
					<button class="stop-button" type="button" onclick={() => stopChat(activeTab)}>Stop</button
					>
				{/if}
			</div>

			<div class="chat-scroll">
				{#if activeTab.snapshot.modelFallbackMessage}
					<p class="form-error">{activeTab.snapshot.modelFallbackMessage}</p>
				{/if}
				{#each activeTab.snapshot.items as item (item.id)}
					{#if item.kind === 'notice'}
						<p class="timeline-notice">{item.text}</p>
					{:else}
						<article class={`message message-${item.role ?? 'assistant'}`}>
							<header>{item.label || item.role || 'message'}</header>
							{#if item.thinking}
								<details class="thinking">
									<summary>Reasoning</summary>
									<pre>{item.thinking}</pre>
								</details>
							{/if}
							{#if item.text}<pre class="message-text">{item.text}</pre>{/if}
							{#if item.toolCalls}
								{#each item.toolCalls as tool (tool.id)}
									<details class="tool-call">
										<summary>{tool.name}</summary>
										<pre>{tool.arguments}</pre>
									</details>
								{/each}
							{/if}
						</article>
					{/if}
				{/each}
				{#if activeTab.streamThinking || activeTab.streamText}
					<article class="message message-assistant streaming">
						<header>Pi <span>streaming</span></header>
						{#if activeTab.streamThinking}<details class="thinking" open>
								<summary>Reasoning</summary>
								<pre>{activeTab.streamThinking}</pre>
							</details>{/if}
						{#if activeTab.streamText}<pre class="message-text">{activeTab.streamText}</pre>{/if}
					</article>
				{/if}
				{#each activeTab.streamTools as tool (tool.id)}
					<article class:message-error={tool.isError} class="message message-tool streaming-tool">
						<header>{tool.name} <span>running</span></header>
						<pre class="message-text">{tool.text}</pre>
					</article>
				{/each}
			</div>

			{#if activeTab.error}<p class="chat-error" role="alert">{activeTab.error}</p>{/if}
			<form class="composer" onsubmit={(event) => sendChat(event, activeTab)}>
				<textarea
					bind:value={activeTab.draft}
					aria-label="Message Pi"
					placeholder="Message Pi…"
					rows="3"></textarea>
				<div class="composer-actions">
					{#if activeTab.snapshot.isStreaming}
						<label class="queue-control"
							>Queue as
							<select bind:value={activeTab.queueMode}>
								<option value="followUp">follow-up</option>
								<option value="steer">steer</option>
							</select>
						</label>
					{/if}
					<button class="primary-button" type="submit"
						>{activeTab.snapshot.isStreaming ? 'Queue message' : 'Send message'}</button
					>
				</div>
			</form>
		</section>
	{/if}
</main>

<script lang="ts">
	import type { Pathname } from '$app/types';
	import { Command, computeCommandScore, Dialog } from 'bits-ui';
	import {
		THINKING_LEVELS,
		type HistoricalSession,
		type ModelOption,
		type ThinkingLevel
	} from '$lib/contracts';
	import type { HarnessWorkspace } from '$lib/harness/workspace.svelte';
	import { modelKey, type ChatTab, type WorkspaceTab } from '$lib/harness/types';

	type Page = 'root' | 'model' | 'thinking';

	type Props = {
		workspace: HarnessWorkspace;
		pathname: string;
		activeTab?: WorkspaceTab;
		onNew: () => void;
		onClose: (tab: WorkspaceTab) => void;
		onNavigate: (pathname: Pathname) => void | Promise<void>;
	};

	let { workspace, pathname, activeTab, onNew, onClose, onNavigate }: Props = $props();
	let open = $state(false);
	let page = $state<Page>('root');
	let query = $state('');
	let input = $state<HTMLInputElement | null>(null);

	let isUtilityRoute = $derived(pathname === '/history' || pathname === '/settings');
	let isActiveTab = $derived(
		activeTab !== undefined && pathname === workspace.hrefForTab(activeTab)
	);
	let activeChat = $derived(
		isActiveTab && activeTab?.kind === 'chat' ? (activeTab as ChatTab) : undefined
	);
	let hasContext = $derived(isActiveTab && !isUtilityRoute && activeTab !== undefined);
	let chatBusy = $derived(
		activeChat !== undefined &&
			(activeChat.hydrationState !== 'ready' ||
				!activeChat.snapshot ||
				activeChat.snapshot.isStreaming === true)
	);
	let activeModelKey = $derived.by(() => {
		if (!hasContext || !activeTab) {
			return '';
		}

		return activeTab.kind === 'new'
			? activeTab.draft.modelKey
			: activeTab.snapshot?.model
				? modelKey(activeTab.snapshot.model)
				: '';
	});
	let activeThinkingLevel = $derived(
		hasContext && activeTab
			? activeTab.kind === 'new'
				? activeTab.draft.thinkingLevel
				: activeTab.snapshot?.thinkingLevel
			: undefined
	);
	let selectedModel = $derived(
		activeModelKey
			? workspace.models.find((model) => modelKey(model) === activeModelKey)
			: undefined
	);
	let thinkingDisabled = $derived(chatBusy || selectedModel?.reasoning === false);
	let sessionMode = $derived(page === 'root' && query.startsWith('!'));
	let tabMode = $derived(page === 'root' && query.startsWith('@'));
	let openTabEntries = $derived.by(() =>
		workspace.tabs.map((tab) => {
			const projectId = tab.kind === 'new' ? tab.draft.projectId : tab.projectId;
			const projectName = projectId
				? workspace.projects.find((project) => project.id === projectId)?.name ||
					(tab.kind === 'chat' ? tab.snapshot?.project.name : undefined)
				: undefined;
			const projectLabel = projectName || projectId || 'No project';

			return {
				tab,
				title: tab.title,
				projectId,
				projectLabel,
				pathname: workspace.hrefForTab(tab)
			};
		})
	);

	function handleKeydown(event: KeyboardEvent): void {
		if (
			event.ctrlKey &&
			event.shiftKey &&
			!event.metaKey &&
			!event.altKey &&
			event.key.toLowerCase() === 'p'
		) {
			event.preventDefault();
			openMenu();
		}
	}

	function openMenu(): void {
		page = 'root';
		query = '';
		open = true;
	}

	function closeMenu(): void {
		open = false;
	}

	function navigate(path: Pathname): void {
		closeMenu();
		void onNavigate(path);
	}

	function startNewChat(): void {
		closeMenu();
		onNew();
	}

	function closeCurrentTab(): void {
		if (!activeTab || !isActiveTab) {
			return;
		}

		closeMenu();
		onClose(activeTab);
	}

	function showPage(nextPage: Page): void {
		page = nextPage;
		query = '';
		requestAnimationFrame(() => input?.focus());
	}

	function goBack(): void {
		if (page !== 'root') {
			showPage('root');
		}
	}

	function handleInputKeydown(event: KeyboardEvent): void {
		if (page !== 'root' && event.key === 'Backspace' && query.length === 0) {
			event.preventDefault();
			goBack();
		}
	}

	function filterCommand(value: string, search: string, keywords?: string[]): number {
		const normalizedSearch =
			page === 'root' && (search.startsWith('@') || search.startsWith('!'))
				? search.slice(1).trim()
				: search;

		return computeCommandScore(value, normalizedSearch, keywords);
	}

	function selectModel(model: ModelOption): void {
		if (!activeTab || !isActiveTab || chatBusy) {
			return;
		}

		if (activeTab.kind === 'new') {
			workspace.changeNewTabModel(activeTab, modelKey(model));
		} else {
			void workspace.changeModel(activeTab, modelKey(model));
		}

		closeMenu();
	}

	function selectThinking(level: ThinkingLevel): void {
		if (!activeTab || !isActiveTab || thinkingDisabled) {
			return;
		}

		if (activeTab.kind === 'new') {
			workspace.changeNewTabThinking(activeTab, level);
		} else {
			void workspace.changeThinking(activeTab, level);
		}

		closeMenu();
	}

	function selectSession(session: HistoricalSession): void {
		navigate(
			`/chat/${encodeURIComponent(session.projectId)}/${encodeURIComponent(session.sessionId)}`
		);
	}

	function tabPath(tab: WorkspaceTab): Pathname {
		return tab.kind === 'new'
			? `/new/${encodeURIComponent(tab.id)}`
			: `/chat/${encodeURIComponent(tab.projectId)}/${encodeURIComponent(tab.sessionId)}`;
	}

	function selectTab(tab: WorkspaceTab): void {
		navigate(tabPath(tab));
	}

	function sessionTitle(session: HistoricalSession): string {
		return session.name || session.firstMessage || 'Untitled session';
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="command-menu-overlay" data-command-menu />
		<Dialog.Content class="command-menu-content" data-command-menu>
			<Dialog.Title class="command-menu-title" data-command-menu
				>Workspace command menu</Dialog.Title
			>
			<Dialog.Description class="command-menu-description" data-command-menu>
				Search workspace actions, model settings, open tabs with @tabs, and saved sessions with
				!history.
			</Dialog.Description>

			<Command.Root
				label="Workspace command menu"
				filter={filterCommand}
				loop
				class="command-menu-root"
			>
				<div class="command-menu-input-wrap">
					{#if page !== 'root'}
						<button class="command-menu-back" type="button" aria-label="Back" onclick={goBack}>
							<span aria-hidden="true">←</span>
						</button>
					{/if}
					<Command.Input
						bind:value={query}
						bind:ref={input}
						autofocus
						placeholder={page === 'model'
							? 'Change model…'
							: page === 'thinking'
								? 'Change thinking mode…'
								: 'Search commands, @tabs, or !history…'}
						onkeydown={handleInputKeydown}
					/>
				</div>

				<Command.List class="command-menu-list">
					<Command.Viewport>
						<Command.Empty class="command-menu-empty">
							{#if sessionMode}
								No saved sessions match this search.
							{:else if tabMode}
								No open tabs match this search.
							{:else if page === 'model'}
								No models are loaded.
							{:else if page === 'thinking'}
								No thinking modes match this search.
							{:else}
								No commands match this search.
							{/if}
						</Command.Empty>

						{#if page !== 'root'}
							<Command.Item value="Back" onSelect={goBack}>
								<span>Back</span>
							</Command.Item>
						{/if}

						{#if page === 'root'}
							{#if sessionMode}
								<Command.Group value="saved-sessions">
									<Command.GroupHeading>Saved sessions</Command.GroupHeading>
									<Command.GroupItems>
										{#each workspace.sessions as session (`${session.projectId}:${session.sessionId}`)}
											<Command.Item
												value={`${sessionTitle(session)} ${session.sessionId}`}
												keywords={[session.name ?? '', session.firstMessage, session.projectName]}
												onSelect={() => selectSession(session)}
											>
												<span class="command-item-copy">
													<strong>{sessionTitle(session)}</strong>
													<small>{session.projectName}</small>
												</span>
											</Command.Item>
										{/each}
									</Command.GroupItems>
								</Command.Group>
							{:else if tabMode}
								<Command.Group value="open-tabs">
									<Command.GroupHeading>Open tabs</Command.GroupHeading>
									<Command.GroupItems>
										{#each openTabEntries as entry (entry.tab.id)}
											<Command.Item
												value={entry.tab.id}
												keywords={[entry.title, entry.projectLabel, entry.projectId]}
												aria-label={`${entry.title} (${entry.projectLabel})${pathname === entry.pathname ? ' Current' : ''}`}
												onSelect={() => selectTab(entry.tab)}
											>
												<span class="command-item-copy">
													<strong>{entry.title}</strong>
													<small>{entry.projectLabel}</small>
												</span>
												{#if pathname === entry.pathname}
													<span class="command-current">Current</span>
												{/if}
											</Command.Item>
										{/each}
									</Command.GroupItems>
								</Command.Group>
							{:else}
								<Command.Group value="workspace">
									<Command.GroupHeading>Workspace</Command.GroupHeading>
									<Command.GroupItems>
										<Command.Item value="Start new chat" onSelect={startNewChat}>
											<span>Start new chat</span><kbd>↵</kbd>
										</Command.Item>
										<Command.Item value="Go to history" onSelect={() => navigate('/history')}>
											<span>Go to history</span>
										</Command.Item>
										<Command.Item value="Go to settings" onSelect={() => navigate('/settings')}>
											<span>Go to settings</span>
										</Command.Item>
										{#if hasContext}
											<Command.Item value="Close current tab" onSelect={closeCurrentTab}>
												<span>Close current tab</span>
											</Command.Item>
											<Command.Item
												value="Change model"
												disabled={chatBusy}
												onSelect={() => showPage('model')}
											>
												<span>Change model</span>
											</Command.Item>
											<Command.Item
												value="Change thinking mode"
												disabled={thinkingDisabled}
												onSelect={() => showPage('thinking')}
											>
												<span>Change thinking mode</span>
											</Command.Item>
										{/if}
									</Command.GroupItems>
								</Command.Group>
							{/if}
						{:else if page === 'model'}
							<Command.Group value="models">
								<Command.GroupHeading>Models</Command.GroupHeading>
								<Command.GroupItems>
									{#each workspace.models as model (modelKey(model))}
										<Command.Item
											value={`${model.name} ${model.provider} ${model.id}`}
											keywords={[model.provider, model.id]}
											aria-label={`${model.name} (${model.provider})${modelKey(model) === activeModelKey ? ' Current' : ''}`}
											disabled={chatBusy}
											onSelect={() => selectModel(model)}
										>
											<span>{model.name}</span><small>{model.provider}</small>
											{#if modelKey(model) === activeModelKey}
												<span class="command-current">Current</span>
											{/if}
										</Command.Item>
									{/each}
								</Command.GroupItems>
							</Command.Group>
						{:else}
							<Command.Group value="thinking-modes">
								<Command.GroupHeading>Thinking mode</Command.GroupHeading>
								<Command.GroupItems>
									{#each THINKING_LEVELS as level (level)}
										<Command.Item
											value={level}
											aria-label={`${level}${level === activeThinkingLevel ? ' Current' : ''}`}
											disabled={thinkingDisabled}
											onSelect={() => selectThinking(level)}
										>
											<span>{level}</span>
											{#if level === activeThinkingLevel}
												<span class="command-current">Current</span>
											{/if}
										</Command.Item>
									{/each}
								</Command.GroupItems>
							</Command.Group>
						{/if}
					</Command.Viewport>
				</Command.List>
			</Command.Root>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	:global([data-command-menu].command-menu-title),
	:global([data-command-menu].command-menu-description) {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	:global([data-command-menu].command-menu-overlay) {
		position: fixed;
		z-index: 20;
		inset: 0;
		background: color-mix(in srgb, var(--shadow) 60%, transparent);
	}

	:global([data-command-menu].command-menu-content) {
		position: fixed;
		top: 12vh;
		left: 50%;
		z-index: 21;
		width: min(36rem, calc(100vw - 2rem));
		transform: translateX(-50%);
		border: 1px solid var(--border-strong);
		border-radius: 0.7rem;
		background: var(--surface);
		box-shadow: 0 1rem 3rem var(--shadow);
		color: var(--text);
	}

	:global([data-command-menu] [data-command-root].command-menu-root) {
		overflow: hidden;
	}

	.command-menu-input-wrap {
		display: flex;
		align-items: center;
		border-bottom: 1px solid var(--border);
	}

	:global([data-command-menu] [data-command-input]) {
		width: 100%;
		min-height: 3.25rem;
		border: 0;
		outline: none;
		background: transparent;
		color: var(--text);
		padding: 0 1rem;
		font-size: 0.95rem;
	}

	:global([data-command-menu] [data-command-input]::placeholder) {
		color: var(--text-muted);
	}

	.command-menu-back {
		width: 2.75rem;
		border: 0;
		background: transparent;
		color: var(--text-muted);
		font-size: 1.15rem;
	}

	:global([data-command-menu] [data-command-list].command-menu-list) {
		max-height: min(24rem, 55dvh);
		overflow-y: auto;
		padding: 0.4rem;
		scrollbar-width: thin;
	}

	:global([data-command-menu] [data-command-group-heading]) {
		padding: 0.65rem 0.7rem 0.3rem;
		color: var(--text-muted);
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
	}

	:global([data-command-menu] [data-command-item]) {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 2.35rem;
		border-radius: 0.4rem;
		padding: 0.45rem 0.7rem;
		color: var(--text);
		cursor: default;
	}

	:global([data-command-menu] [data-command-item][data-selected]) {
		background: var(--surface-strong);
	}

	:global([data-command-menu] [data-command-item][data-disabled]) {
		cursor: not-allowed;
		opacity: 0.45;
	}

	:global([data-command-menu] [data-command-item] small) {
		color: var(--text-muted);
		font-size: 0.72rem;
	}

	.command-item-copy {
		display: grid;
		min-width: 0;
		gap: 0.1rem;
	}

	.command-item-copy small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.command-current {
		margin-left: auto;
		color: var(--accent);
		font-size: 0.7rem;
	}

	:global([data-command-menu] [data-command-item] kbd) {
		margin-left: auto;
		color: var(--text-muted);
		font-size: 0.7rem;
	}

	:global([data-command-menu] [data-command-empty].command-menu-empty) {
		padding: 2rem 1rem;
		color: var(--text-muted);
		font-size: 0.82rem;
		text-align: center;
	}

	@media (prefers-reduced-motion: reduce) {
		:global([data-command-menu].command-menu-content) {
			transition: none;
		}
	}
</style>

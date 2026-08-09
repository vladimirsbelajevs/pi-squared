<script lang="ts">
	import { resolve } from '$app/paths';
	import PiWorkingSpinner from '$lib/components/PiWorkingSpinner.svelte';
	import type { HarnessWorkspace } from '$lib/harness/workspace.svelte';
	import type { WorkspaceTab } from '$lib/harness/types';

	type ProjectGroup = {
		projectId: string;
		name: string;
		tabs: WorkspaceTab[];
	};

	type Props = {
		workspace: HarnessWorkspace;
		pathname: string;
		open: boolean;
		collapsed: boolean;
		onNew: () => void;
		onClose: (tab: WorkspaceTab, event: MouseEvent) => void;
		onCollapse: () => void;
		onCloseDrawer: () => void;
	};

	let { workspace, pathname, open, collapsed, onNew, onClose, onCollapse, onCloseDrawer }: Props =
		$props();

	let unassignedDrafts = $derived(
		workspace.tabs.filter((tab) => tab.kind === 'new' && !tab.draft.projectId)
	);
	let projectGroups = $derived.by(() => {
		const groups: ProjectGroup[] = [];

		for (const tab of workspace.tabs) {
			const projectId = tab.kind === 'new' ? tab.draft.projectId : tab.projectId;
			if (!projectId) {
				continue;
			}

			let group = groups.find((candidate) => candidate.projectId === projectId);
			if (!group) {
				group = {
					projectId,
					name: workspace.projects.find((project) => project.id === projectId)?.name ?? projectId,
					tabs: []
				};
				groups.push(group);
			}

			group.tabs.push(tab);
		}

		return groups;
	});

	function isActive(tab: WorkspaceTab): boolean {
		return pathname === workspace.hrefForTab(tab);
	}

	function focusDrawerWhenOpen(element: HTMLButtonElement): void {
		if (!open || !window.matchMedia('(max-width: 700px)').matches) {
			return;
		}

		requestAnimationFrame(() => {
			if (open) {
				element.focus();
			}
		});
	}
</script>

<div class:open class:collapsed class="sidebar-shell">
	<button
		class="sidebar-backdrop"
		type="button"
		aria-label="Dismiss navigation menu"
		aria-hidden={open && !collapsed ? undefined : 'true'}
		tabindex={open && !collapsed ? 0 : -1}
		onclick={onCloseDrawer}
	></button>

	<aside
		id="workspace-sidebar"
		class="workspace-sidebar"
		aria-label="Workspace sidebar"
		aria-hidden={open && !collapsed ? undefined : 'true'}
		inert={!open || collapsed}
	>
		<div class="sidebar-top">
			<div class="sidebar-heading">
				<strong>Pi²</strong>
				<div class="sidebar-actions">
					<button
						class="sidebar-collapse"
						type="button"
						aria-label="Collapse sidebar"
						onclick={onCollapse}
					>
						<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
							<path d="M4 5h16v14H4zM9 5v14M14 9l-3 3 3 3" />
						</svg>
					</button>
					<button
						class="sidebar-close"
						type="button"
						aria-label="Close navigation menu"
						{@attach focusDrawerWhenOpen}
						onclick={onCloseDrawer}
					>
						<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
							<path d="m6 6 12 12M18 6 6 18" />
						</svg>
					</button>
				</div>
			</div>

			<button class="new-chat-button" type="button" onclick={onNew}>
				<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
					<path d="M12 5v14M5 12h14" />
				</svg>
				<span>New chat</span>
			</button>

			<nav class="utility-nav" aria-label="Harness utility">
				<a
					class:active={pathname === '/history'}
					aria-current={pathname === '/history' ? 'page' : undefined}
					href={resolve('/history')}
				>
					<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
						<circle cx="12" cy="12" r="8" />
						<path d="M12 8v4l2.5 1.5" />
					</svg>
					<span>History</span>
				</a>
				<a
					class:active={pathname === '/settings'}
					aria-current={pathname === '/settings' ? 'page' : undefined}
					href={resolve('/settings')}
				>
					<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
						<path
							d="m9.5 4 .5 1.8a6.8 6.8 0 0 1 4 0l.5-1.8 2 .9-.8 1.7a7 7 0 0 1 2.8 2.8l1.7-.8.9 2-1.8.5a6.8 6.8 0 0 1 0 4l1.8.5-.9 2-1.7-.8a7 7 0 0 1-2.8 2.8l.8 1.7-2 .9-.5-1.8a6.8 6.8 0 0 1-4 0l-.5 1.8-2-.9.8-1.7a7 7 0 0 1-2.8-2.8l-1.7.8-.9-2 1.8-.5a6.8 6.8 0 0 1 0-4l-1.8-.5.9-2 1.7.8a7 7 0 0 1 2.8-2.8L7.5 4.9l2-.9ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"
						/>
					</svg>
					<span>Settings</span>
				</a>
			</nav>
		</div>

		<div class="sidebar-separator" aria-hidden="true"></div>

		<nav class="sidebar-bottom" aria-label="Open workspace entries">
			{#each unassignedDrafts as tab (tab.id)}
				<div class:active={isActive(tab)} class="workspace-entry-wrap">
					<a
						class="workspace-entry"
						class:active={isActive(tab)}
						href={resolve(`/new/${encodeURIComponent(tab.id)}`)}
						aria-current={isActive(tab) ? 'page' : undefined}
					>
						<span class="entry-title">{tab.title}</span>
					</a>
					<button
						class="entry-close"
						type="button"
						aria-label={`Close ${tab.title}`}
						onclick={(event) => onClose(tab, event)}
					>
						<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
							<path d="m6 6 12 12M18 6 6 18" />
						</svg>
					</button>
				</div>
			{/each}

			{#each projectGroups as group (group.projectId)}
				<section class="project-group" aria-labelledby={`project-${group.projectId}`}>
					<h2 id={`project-${group.projectId}`}>{group.name}</h2>
					{#each group.tabs as tab (tab.id)}
						<div class:active={isActive(tab)} class="workspace-entry-wrap">
							<a
								class="workspace-entry"
								class:active={isActive(tab)}
								href={resolve(
									tab.kind === 'new'
										? `/new/${encodeURIComponent(tab.id)}`
										: `/chat/${encodeURIComponent(tab.projectId)}/${encodeURIComponent(tab.sessionId)}`
								)}
								aria-current={isActive(tab) ? 'page' : undefined}
							>
								<span class="entry-title">{tab.title}</span>
							</a>
							{#if tab.kind === 'chat' && tab.snapshot?.isStreaming}
								<PiWorkingSpinner class="entry-working" tone="sidebar" />
							{/if}
							<button
								class="entry-close"
								type="button"
								aria-label={`Close ${tab.title}`}
								onclick={(event) => onClose(tab, event)}
							>
								<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
									<path d="m6 6 12 12M18 6 6 18" />
								</svg>
							</button>
						</div>
					{/each}
				</section>
			{/each}
		</nav>
	</aside>
</div>

<style>
	.sidebar-shell {
		position: relative;
		z-index: 4;
		width: 100%;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}

	.sidebar-backdrop {
		display: none;
	}

	.sidebar-shell.collapsed .workspace-sidebar {
		visibility: hidden;
	}

	.workspace-sidebar {
		display: flex;
		flex-direction: column;
		width: 16rem;
		height: 100%;
		min-height: 0;
		border-right: 1px solid var(--border);
		background: var(--surface-muted);
		color: var(--text);
	}

	.sidebar-top {
		padding: 0.8rem 0.7rem 0.7rem;
	}

	.sidebar-bottom {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0.55rem 0.7rem 0.8rem;
		scrollbar-width: thin;
	}

	.sidebar-separator {
		height: 1px;
		margin: 0 0.7rem;
		background: var(--border);
		opacity: 0.7;
	}

	.sidebar-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 2rem;
		margin-bottom: 0.7rem;
		padding: 0 0.3rem;
	}

	.sidebar-heading strong {
		font-size: 1rem;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.sidebar-actions {
		display: flex;
		align-items: center;
		gap: 0.15rem;
	}

	.sidebar-collapse,
	.sidebar-close {
		display: grid;
		width: 1.8rem;
		height: 1.8rem;
		place-items: center;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: var(--text-muted);
	}

	.sidebar-collapse:hover,
	.sidebar-collapse:focus-visible,
	.sidebar-close:hover,
	.sidebar-close:focus-visible {
		background: var(--surface-strong);
		color: var(--text);
	}

	.sidebar-collapse svg,
	.sidebar-close svg,
	.entry-close svg,
	.new-chat-button svg,
	.utility-nav svg {
		width: 1rem;
		height: 1rem;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.8;
	}

	.sidebar-collapse svg {
		width: 1.05rem;
		height: 1.05rem;
	}

	.sidebar-close {
		display: none;
	}

	.new-chat-button {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		width: 100%;
		min-height: 2.35rem;
		margin-bottom: 0.45rem;
		border: 1px solid transparent;
		border-radius: 6px;
		background: transparent;
		color: var(--text);
		padding: 0.3rem 0.55rem;
		font-size: 0.82rem;
		font-weight: 600;
		text-align: left;
		transition:
			background 160ms ease,
			border-color 160ms ease;
	}

	.new-chat-button svg {
		color: var(--accent);
	}

	.new-chat-button:hover,
	.new-chat-button:focus-visible {
		border-color: transparent;
		background: var(--surface-strong);
	}

	.utility-nav {
		display: grid;
		gap: 0.1rem;
	}

	.utility-nav a {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-height: 2.35rem;
		border: 1px solid transparent;
		border-radius: 6px;
		color: var(--text-muted);
		padding: 0.3rem 0.55rem;
		font-size: 0.82rem;
		font-weight: 500;
		text-decoration: none;
		transition:
			background 160ms ease,
			color 160ms ease;
	}

	.utility-nav a:hover,
	.utility-nav a.active,
	.utility-nav a:focus-visible {
		border-color: transparent;
		background: var(--surface-strong);
		color: var(--text);
	}

	.utility-nav svg {
		width: 0.95rem;
		height: 0.95rem;
		flex: 0 0 0.95rem;
	}

	.project-group + .project-group {
		margin-top: 0.85rem;
	}

	.project-group h2 {
		margin: 0 0 0.25rem;
		padding: 0 0.55rem;
		color: var(--text-muted);
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.025em;
		overflow: hidden;
		text-overflow: ellipsis;
		text-transform: uppercase;
		white-space: nowrap;
	}

	.workspace-entry-wrap {
		display: flex;
		align-items: stretch;
		min-width: 0;
		min-height: 2.35rem;
		margin: 0.08rem 0;
		border: 1px solid transparent;
		border-radius: 6px;
		background: transparent;
		transition: background 160ms ease;
	}

	.workspace-entry-wrap:hover,
	.workspace-entry-wrap:focus-within {
		background: var(--surface-strong);
	}

	.workspace-entry-wrap.active {
		background: color-mix(in srgb, var(--accent) 12%, var(--surface-strong));
	}

	.workspace-entry {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		flex: 1;
		color: var(--text-muted);
		padding: 0.3rem 0.25rem 0.3rem 0.55rem;
		font-size: 0.82rem;
		text-align: left;
		text-decoration: none;
	}

	.workspace-entry.active,
	.workspace-entry-wrap:hover .workspace-entry,
	.workspace-entry-wrap:focus-within .workspace-entry {
		color: var(--text);
	}

	.project-group .workspace-entry {
		padding-left: 1.47rem;
	}

	.entry-title {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.entry-working) {
		display: grid;
		align-self: center;
		width: 1.8rem;
		min-width: 1.8rem;
		place-items: center;
		font-size: 0.82rem;
	}

	.entry-close {
		display: grid;
		width: 1.8rem;
		min-width: 1.8rem;
		place-items: center;
		border: 0;
		background: transparent;
		color: var(--text-muted);
		padding: 0;
		opacity: 0;
		transition:
			color 120ms ease,
			opacity 120ms ease;
	}

	.workspace-entry-wrap:hover .entry-close,
	.workspace-entry-wrap:focus-within .entry-close,
	.workspace-entry-wrap.active .entry-close {
		opacity: 1;
	}

	.entry-close:hover,
	.entry-close:focus-visible {
		color: var(--danger);
	}

	@media (max-width: 700px) {
		.sidebar-shell {
			position: fixed;
			inset: 0;
			width: 100%;
			pointer-events: none;
		}

		.sidebar-shell.open {
			pointer-events: auto;
		}

		.sidebar-backdrop {
			position: absolute;
			inset: 0;
			display: block;
			width: 100%;
			border: 0;
			background: color-mix(in srgb, var(--shadow) 70%, transparent);
			opacity: 0;
			pointer-events: none;
			transition: opacity 180ms ease;
		}

		.sidebar-shell.open .sidebar-backdrop {
			opacity: 1;
			pointer-events: auto;
		}

		.workspace-sidebar {
			position: absolute;
			inset: 0 auto 0 0;
			visibility: hidden;
			width: min(18rem, 86vw);
			box-shadow: 0 0 2rem var(--shadow);
			transform: translateX(-100%);
			transition: transform 180ms ease;
		}

		.sidebar-shell.open .workspace-sidebar {
			visibility: visible;
			transform: translateX(0);
		}

		.sidebar-collapse {
			display: none;
		}

		.sidebar-close {
			display: grid;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.sidebar-backdrop,
		.workspace-sidebar,
		.sidebar-shell.collapsed .workspace-sidebar,
		.workspace-entry-wrap,
		.entry-close,
		.utility-nav a,
		.new-chat-button,
		.sidebar-collapse,
		.sidebar-close {
			transition: none;
		}
	}
</style>

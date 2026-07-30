<script lang="ts">
	import type { HarnessWorkspace } from '$lib/harness/workspace.svelte';
	import type { WorkspaceTab } from '$lib/harness/types';
	import { resolve } from '$app/paths';

	type Props = {
		workspace: HarnessWorkspace;
		pathname: string;
		onNew: () => void;
		onClose: (tab: WorkspaceTab, event: MouseEvent) => void;
	};

	let { workspace, pathname, onNew, onClose }: Props = $props();

	function isActive(tab: WorkspaceTab): boolean {
		return pathname === workspace.hrefForTab(tab);
	}
</script>

<div class="tab-strip" aria-label="Harness tabs" role="tablist">
	<a
		class:active={pathname === '/history' || pathname === '/settings'}
		class="utility-tab"
		href={resolve('/history')}
		role="tab"
		aria-selected={pathname === '/history' || pathname === '/settings'}
		aria-label="Historical sessions and harness settings"
	>
		<span aria-hidden="true">◫</span>
	</a>
	<div class="tab-divider"></div>
	{#each workspace.tabs as tab (tab.id)}
		<div class:active={isActive(tab)} class="chat-tab-wrap">
			<a
				class="chat-tab"
				href={resolve(
					tab.kind === 'new'
						? `/new/${encodeURIComponent(tab.id)}`
						: `/chat/${encodeURIComponent(tab.projectId)}/${encodeURIComponent(tab.sessionId)}`
				)}
				role="tab"
				aria-selected={isActive(tab)}
			>
				{#if tab.kind === 'chat'}
					<span class:live={tab.snapshot?.isStreaming} class="tab-status"></span>
				{:else}
					<span class="tab-plus">+</span>
				{/if}
				<span class="tab-title">{tab.title}</span>
			</a>
			<button
				class="tab-close"
				type="button"
				aria-label={`Close ${tab.title}`}
				onclick={(event) => onClose(tab, event)}
			>
				×
			</button>
		</div>
	{/each}
	<button class="add-tab" type="button" aria-label="New chat tab" onclick={onNew}>+</button>
</div>

<style>
	.tab-strip {
		position: sticky;
		top: 0;
		z-index: 3;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
		overflow-x: auto;
		overflow-y: hidden;
		border-bottom: 1px solid var(--border);
		background: var(--surface-muted);
		padding: 0.4rem 0.55rem;
		scrollbar-width: thin;
	}

	.utility-tab,
	.chat-tab,
	.add-tab {
		border: 0;
		background: transparent;
		color: var(--text-muted);
		text-decoration: none;
	}

	.utility-tab {
		display: grid;
		width: 1.875rem;
		height: 1.875rem;
		flex: 0 0 1.875rem;
		place-items: center;
		border: 1px solid transparent;
		border-radius: 8px;
		font-size: 1.15rem;
		transition:
			background 160ms ease,
			border-color 160ms ease,
			color 160ms ease;
	}

	.utility-tab.active,
	.chat-tab-wrap.active {
		height: calc(1.875rem + 0.4rem + 1px);
		margin-bottom: calc(-0.4rem - 1px);
		border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
		border-bottom-right-radius: 0;
		border-bottom-left-radius: 0;
		background: color-mix(in srgb, var(--surface-strong) 88%, var(--accent) 12%);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 10%, transparent);
	}

	.utility-tab.active,
	.chat-tab-wrap.active .chat-tab {
		color: var(--text);
	}

	.tab-divider {
		width: 1px;
		height: 1.25rem;
		background: var(--border);
	}

	.chat-tab-wrap {
		display: flex;
		height: 1.875rem;
		min-width: 10rem;
		max-width: 16rem;
		overflow: hidden;
		border: 1px solid transparent;
		border-radius: 8px;
		background: color-mix(in srgb, var(--surface) 88%, var(--border) 12%);
		transition:
			background 160ms ease,
			border-color 160ms ease,
			box-shadow 160ms ease;
	}

	.chat-tab,
	.tab-close {
		transition:
			background 160ms ease,
			color 160ms ease;
	}

	.chat-tab {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		flex: 1;
		padding: 0.2rem 0.3rem 0.2rem 0.65rem;
		text-align: left;
	}

	.chat-tab-wrap:hover,
	.utility-tab:hover {
		border-color: var(--border-strong);
		background: var(--surface-strong);
		color: var(--text);
	}

	.chat-tab-wrap:hover .chat-tab,
	.chat-tab-wrap:hover .tab-close {
		color: var(--text);
	}

	.tab-title {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tab-status {
		width: 0.5rem;
		height: 0.5rem;
		border: 1px solid var(--text-muted);
		border-radius: 50%;
	}

	.tab-status.live {
		border-color: var(--success);
		background: var(--success);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 16%, transparent);
	}

	.tab-plus {
		color: var(--accent);
		font-weight: 700;
	}

	.tab-close {
		border: 0;
		background: transparent;
		color: var(--text-muted);
		padding: 0 0.65rem 0 0.35rem;
		font-size: 1.05rem;
		line-height: 1;
	}

	.tab-close:hover {
		color: var(--danger) !important;
	}

	.add-tab {
		display: grid;
		width: 1.875rem;
		height: 1.875rem;
		flex: 0 0 1.875rem;
		place-items: center;
		border: 1px solid transparent;
		border-radius: 8px;
		font-size: 1.35rem;
		line-height: 1;
		transition:
			background 160ms ease,
			border-color 160ms ease,
			color 160ms ease;
	}

	.add-tab:hover,
	.add-tab:focus-visible {
		border-color: var(--border-strong);
		background: var(--surface-strong);
		color: var(--text);
	}

	@media (max-width: 700px) {
		.chat-tab-wrap {
			min-width: 8rem;
			max-width: 11rem;
		}
	}
</style>

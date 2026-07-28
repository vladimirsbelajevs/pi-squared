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
				href={tab.kind === 'new'
					? resolve(`/new/${encodeURIComponent(tab.id)}`)
					: resolve(
							`/chat/${encodeURIComponent(tab.projectId)}/${encodeURIComponent(tab.sessionId)}`
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
		display: flex;
		align-items: stretch;
		min-width: 0;
		overflow-x: auto;
		border-bottom: 1px solid var(--border);
		background: var(--surface-muted);
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
		width: 48px;
		flex: 0 0 48px;
		place-items: center;
		border-right: 1px solid var(--border);
		font-size: 1.15rem;
	}

	.utility-tab.active,
	.chat-tab-wrap.active {
		background: var(--surface);
		box-shadow: inset 0 -2px var(--accent);
	}

	.utility-tab.active,
	.chat-tab-wrap.active .chat-tab {
		color: var(--text);
	}

	.tab-divider {
		width: 1px;
		background: var(--border-strong);
	}

	.chat-tab-wrap {
		display: flex;
		min-width: 10rem;
		max-width: 16rem;
		border-right: 1px solid var(--border);
	}

	.chat-tab {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		flex: 1;
		padding: 0.7rem 0.4rem 0.7rem 0.75rem;
		text-align: left;
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
		padding: 0 0.65rem 0 0.15rem;
		font-size: 1.15rem;
		line-height: 1;
	}

	.tab-close:hover {
		color: var(--danger);
	}

	.add-tab {
		width: 44px;
		flex: 0 0 44px;
		border-left: 1px solid var(--border);
		font-size: 1.35rem;
	}

	.add-tab:hover,
	.utility-tab:hover,
	.chat-tab:hover {
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

<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount, tick } from 'svelte';
	import WorkspaceTabs from '$lib/components/WorkspaceTabs.svelte';
	import { workspace } from '$lib/harness/workspace.svelte';
	import type { WorkspaceTab } from '$lib/harness/types';

	let { children } = $props();
	let scrollContainer = $state<HTMLElement>();
	let restoringScroll = false;

	function rememberScrollPosition(event: Event): void {
		if (restoringScroll) return;
		workspace.rememberScrollPosition(
			page.url.pathname,
			(event.currentTarget as HTMLElement).scrollTop
		);
	}

	function restoreScrollPosition(): void {
		const pathname = page.url.pathname;
		if (!scrollContainer) return;
		const scrollTop = workspace.scrollPosition(pathname);
		restoringScroll = true;
		void tick().then(() => {
			if (scrollContainer && page.url.pathname === pathname) scrollContainer.scrollTop = scrollTop;
			requestAnimationFrame(() => (restoringScroll = false));
		});
	}

	afterNavigate(restoreScrollPosition);

	function createNewTab(): void {
		const tab = workspace.createNewTab();
		workspace.rememberTabForPathname(workspace.hrefForTab(tab));
		void goto(resolve(`/new/${encodeURIComponent(tab.id)}`));
	}

	function fallbackTab(tab: WorkspaceTab): WorkspaceTab | undefined {
		const index = workspace.tabs.findIndex((candidate) => candidate.id === tab.id);
		return workspace.tabs[index + 1] ?? workspace.tabs[index - 1];
	}

	function navigateToFallback(tab: WorkspaceTab | undefined): Promise<void> {
		if (!tab) return goto(resolve('/history'), { replaceState: true });
		if (tab.kind === 'new') {
			return goto(resolve(`/new/${encodeURIComponent(tab.id)}`), { replaceState: true });
		}
		return goto(
			resolve(`/chat/${encodeURIComponent(tab.projectId)}/${encodeURIComponent(tab.sessionId)}`),
			{ replaceState: true }
		);
	}

	function closeTab(tab: WorkspaceTab, event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();
		const wasActive = page.url.pathname === workspace.hrefForTab(tab);
		const fallback = fallbackTab(tab);
		if (wasActive) {
			void navigateToFallback(fallback).then(() => workspace.closeTab(tab));
			return;
		}
		void workspace.closeTab(tab);
	}

	onMount(() => {
		void workspace.start();
		restoreScrollPosition();
		return () => workspace.disposeConnection();
	});
</script>

<svelte:head>
	<title>Pi Squared</title>
	<meta name="description" content="A local, tab-first coding harness for the Pi SDK." />
</svelte:head>

<main class="harness-shell">
	<WorkspaceTabs {workspace} pathname={page.url.pathname} onNew={createNewTab} onClose={closeTab} />

	<div
		id="workspace-content"
		class="workspace-content"
		bind:this={scrollContainer}
		onscroll={rememberScrollPosition}
	>
		{#if workspace.error}
			<div class="app-error" role="alert">{workspace.error}</div>
		{/if}

		{#if workspace.initializing}
			<section class="loading-state"><span class="pulse"></span>Loading local harness…</section>
		{:else}
			{@render children()}
		{/if}
	</div>
</main>

<style>
	.harness-shell {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		height: 100vh;
		height: 100dvh;
		overflow: hidden;
	}

	.workspace-content {
		min-height: 0;
		overflow: auto;
	}

	.app-error {
		position: fixed;
		top: 3.5rem;
		right: 1rem;
		z-index: 10;
		max-width: 28rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--danger);
		background: var(--surface);
		color: var(--danger);
		box-shadow: 0 0.5rem 2rem var(--shadow);
	}

	.loading-state {
		display: grid;
		place-content: center;
		gap: 1rem;
		color: var(--text-muted);
	}

	.pulse {
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 50%;
		background: var(--accent);
		animation: pulse 1.2s ease-in-out infinite;
	}

	@keyframes pulse {
		50% {
			opacity: 0.3;
			transform: scale(0.7);
		}
	}
</style>

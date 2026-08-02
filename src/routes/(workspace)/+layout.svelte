<script lang="ts">
	import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import WorkspaceScrollArea from '$lib/components/WorkspaceScrollArea.svelte';
	import { setWorkspaceScrollController } from '$lib/workspace-scroll';
	import WorkspaceTabs from './WorkspaceTabs.svelte';
	import { workspace } from '$lib/harness/workspace.svelte';
	import type { WorkspaceTab } from '$lib/harness/types';

	let { children } = $props();
	let scrollArea = $state<{
		captureScrollBeforeContentChange: (key: string) => void;
		restoreActiveKey: () => void;
	} | null>(null);
	let activeScrollKey = $derived(scrollKeyForPathname(page.url.pathname));

	setWorkspaceScrollController({
		captureScrollBeforeContentChange: (key) => scrollArea?.captureScrollBeforeContentChange(key)
	});

	function scrollKeyForPathname(pathname: string): string | undefined {
		const tab = workspace.tabs.find((candidate) => workspace.hrefForTab(candidate) === pathname);
		if (tab) {
			return `tab:${tab.id}`;
		}

		if (pathname === '/history' || pathname === '/settings') {
			return `utility:${pathname}`;
		}
	}

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
		if (!tab) {
			return goto(resolve('/history'), { replaceState: true });
		}

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

	beforeNavigate(() => {
		if (activeScrollKey) {
			scrollArea?.captureScrollBeforeContentChange(activeScrollKey);
		}
	});

	afterNavigate(() => {
		workspace.setRoutePathname(page.url.pathname);
		scrollArea?.restoreActiveKey();
	});

	onMount(() => {
		void workspace.start().then(() => workspace.setRoutePathname(page.url.pathname));

		return () => workspace.disposeConnection();
	});
</script>

<svelte:head>
	<title>Pi²</title>
	<meta name="description" content="A local, tab-first coding harness for the Pi SDK." />
</svelte:head>

<main class="harness-shell">
	<WorkspaceTabs {workspace} pathname={page.url.pathname} onNew={createNewTab} onClose={closeTab} />

	{#key activeScrollKey}
		<WorkspaceScrollArea
			bind:this={scrollArea}
			activeKey={activeScrollKey}
			workspaceState={workspace.initializing || !!workspace.error}
			rememberScroll={(key, state) => workspace.rememberScroll(key, state)}
			scrollState={(key) => workspace.scrollState(key)}
		>
			{#if workspace.initializing}
				<section class="loading-state"><span class="pulse"></span>Loading harness…</section>
			{:else if workspace.error}
				<div class="app-error" role="alert">{workspace.error}</div>
			{:else}
				{@render children()}
			{/if}
		</WorkspaceScrollArea>
	{/key}
</main>

<style>
	.harness-shell {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		height: 100vh;
		height: 100dvh;
		overflow: hidden;
	}

	.app-error {
		width: min(100%, 28rem);
		place-self: center;
		padding: 0.75rem 1rem;
		border: 1px solid var(--danger);
		background: var(--surface);
		color: var(--danger);
		box-shadow: 0 0.5rem 2rem var(--shadow);
	}

	.loading-state {
		display: grid;
		place-self: stretch;
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

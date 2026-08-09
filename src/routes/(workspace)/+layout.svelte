<script lang="ts">
	import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { gotoResolvedHref } from '$lib/client-navigation';
	import { page } from '$app/state';
	import type { Pathname } from '$app/types';
	import { onMount } from 'svelte';
	import WorkspaceScrollArea from '$lib/components/WorkspaceScrollArea.svelte';
	import { setWorkspaceScrollController } from '$lib/workspace-scroll';
	import WorkspaceCommandMenu from './WorkspaceCommandMenu.svelte';
	import WorkspaceSidebar from './WorkspaceSidebar.svelte';
	import { workspace } from '$lib/harness/workspace.svelte';
	import type { WorkspaceTab } from '$lib/harness/types';

	let { children } = $props();
	let sidebarOpen = $state(true);
	let sidebarCollapsed = $state(false);
	let narrowLayout = $state(false);
	let focusedSidebarControl: 'collapse' | 'close' | null = null;
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

	function openSidebar(): void {
		if (narrowLayout) {
			sidebarOpen = true;

			return;
		}

		sidebarCollapsed = false;
		requestAnimationFrame(() =>
			document.querySelector<HTMLButtonElement>('.sidebar-collapse')?.focus()
		);
	}

	function collapseSidebar(): void {
		if (narrowLayout) {
			return;
		}

		sidebarCollapsed = true;
		requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.menu-button')?.focus());
	}

	function closeSidebar(restoreFocus = true): void {
		if (!narrowLayout) {
			return;
		}

		sidebarOpen = false;
		if (restoreFocus) {
			requestAnimationFrame(() =>
				document.querySelector<HTMLButtonElement>('.menu-button')?.focus()
			);
		}
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (narrowLayout && sidebarOpen && event.key === 'Escape') {
			event.preventDefault();
			closeSidebar();
		}
	}

	function trackSidebarFocus(event: FocusEvent): void {
		const target = event.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}

		if (target.matches('.sidebar-collapse')) {
			focusedSidebarControl = 'collapse';
		} else if (target.matches('.sidebar-close')) {
			focusedSidebarControl = 'close';
		} else {
			focusedSidebarControl = null;
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

	function navigateWorkspace(pathname: Pathname): Promise<void> {
		return goto(resolve(pathname));
	}

	function closeCurrentTab(tab: WorkspaceTab): void {
		const wasActive = page.url.pathname === workspace.hrefForTab(tab);
		const fallback = fallbackTab(tab);
		if (wasActive) {
			void navigateToFallback(fallback).then(() => workspace.closeTab(tab));

			return;
		}

		void workspace.closeTab(tab);
	}

	function closeTab(tab: WorkspaceTab, event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();
		closeCurrentTab(tab);
	}

	workspace.setNotificationNavigation(gotoResolvedHref);

	beforeNavigate(() => {
		if (activeScrollKey) {
			scrollArea?.captureScrollBeforeContentChange(activeScrollKey);
		}
	});

	afterNavigate(() => {
		workspace.setRoutePathname(page.url.pathname);
		scrollArea?.restoreActiveKey();
		// Let SvelteKit perform its normal route focus management after navigation.
		closeSidebar(false);
	});

	onMount(() => {
		const mediaQuery = window.matchMedia('(max-width: 700px)');
		let layoutInitialized = false;
		const updateLayout = (): void => {
			const nextNarrowLayout = mediaQuery.matches;
			const movingToMobile = layoutInitialized && !narrowLayout && nextNarrowLayout;
			const movingToDesktop = layoutInitialized && narrowLayout && !nextNarrowLayout;
			const focusedElement = document.activeElement;
			const focusMobileMenu =
				movingToMobile &&
				(focusedSidebarControl === 'collapse' ||
					focusedElement === document.querySelector('.sidebar-collapse'));
			const focusDesktopCollapse =
				movingToDesktop &&
				(focusedSidebarControl === 'close' ||
					focusedElement === document.querySelector('.sidebar-close'));

			narrowLayout = nextNarrowLayout;
			sidebarCollapsed = false;
			sidebarOpen = !nextNarrowLayout;
			layoutInitialized = true;

			if (focusMobileMenu || focusDesktopCollapse) {
				requestAnimationFrame(() =>
					document
						.querySelector<HTMLButtonElement>(
							focusMobileMenu ? '.menu-button' : '.sidebar-collapse'
						)
						?.focus()
				);
			}
		};

		updateLayout();
		mediaQuery.addEventListener('change', updateLayout);

		void workspace.start().then(() => workspace.setRoutePathname(page.url.pathname));

		return () => {
			mediaQuery.removeEventListener('change', updateLayout);
			workspace.disposeConnection();
		};
	});
</script>

<svelte:window onfocusin={trackSidebarFocus} onkeydown={handleKeydown} />

<svelte:head>
	<title>Pi²</title>
	<meta name="description" content="A local, tab-first coding harness for the Pi SDK." />
</svelte:head>

<main class="harness-shell" class:sidebar-collapsed={sidebarCollapsed}>
	<WorkspaceSidebar
		{workspace}
		pathname={page.url.pathname}
		open={sidebarOpen}
		collapsed={sidebarCollapsed}
		onNew={createNewTab}
		onClose={closeTab}
		onCollapse={collapseSidebar}
		onCloseDrawer={closeSidebar}
	/>

	<WorkspaceCommandMenu
		{workspace}
		pathname={page.url.pathname}
		activeTab={workspace.tabs.find((tab) => workspace.hrefForTab(tab) === page.url.pathname)}
		onNew={createNewTab}
		onClose={closeCurrentTab}
		onNavigate={navigateWorkspace}
	/>

	<section class="workspace-content">
		<button
			class="menu-button"
			type="button"
			aria-label="Open navigation menu"
			aria-controls="workspace-sidebar"
			aria-expanded={narrowLayout ? sidebarOpen : !sidebarCollapsed}
			onclick={openSidebar}
		>
			<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
				<path d="M4 6h16M4 12h16M4 18h16" />
			</svg>
		</button>
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
	</section>
</main>

<style>
	.harness-shell {
		display: grid;
		grid-template-columns: 16rem minmax(0, 1fr);
		height: 100vh;
		height: 100dvh;
		overflow: hidden;
		transition: grid-template-columns 180ms ease;
	}

	.harness-shell.sidebar-collapsed {
		grid-template-columns: 0 minmax(0, 1fr);
	}

	.workspace-content {
		position: relative;
		min-width: 0;
		min-height: 0;
	}

	.menu-button {
		position: absolute;
		top: 0.75rem;
		left: 0.75rem;
		z-index: 2;
		display: none;
		width: 2.25rem;
		height: 2.25rem;
		place-items: center;
		border: 1px solid var(--border);
		border-radius: 7px;
		background: var(--surface-muted);
		color: var(--text);
	}

	.menu-button svg {
		width: 1rem;
		height: 1rem;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-width: 1.8;
	}

	.harness-shell.sidebar-collapsed .menu-button {
		display: grid;
	}

	.menu-button:hover,
	.menu-button:focus-visible {
		border-color: var(--border-strong);
		background: var(--surface-strong);
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

	@media (max-width: 700px) {
		.harness-shell,
		.harness-shell.sidebar-collapsed {
			grid-template-columns: minmax(0, 1fr);
		}

		.menu-button {
			display: grid;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.harness-shell {
			transition: none;
		}
	}
</style>

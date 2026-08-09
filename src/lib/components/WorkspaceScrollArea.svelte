<script lang="ts">
	import { ScrollArea } from 'bits-ui';
	import type { Attachment } from 'svelte/attachments';
	import type { ScrollState } from '$lib/harness/workspace.svelte';

	type PendingRestore = {
		key: string;
		state: ScrollState;
		sawResize: boolean;
	};

	type Props = {
		activeKey?: string;
		workspaceState?: boolean;
		rememberScroll: (key: string, state: ScrollState) => void;
		scrollState: (key: string) => ScrollState | undefined;
		children: import('svelte').Snippet;
	};

	const BOTTOM_EPSILON = 24;

	let {
		activeKey,
		workspaceState = false,
		rememberScroll,
		scrollState,
		children
	}: Props = $props();
	let viewport = $state<HTMLDivElement | null>(null);
	let content: HTMLDivElement | null = null;
	let pendingFrame: number | undefined;
	let restoreFrame: number | undefined;
	let pendingRestore: PendingRestore | undefined;
	let restoring = false;

	function readState(element: HTMLElement): ScrollState {
		const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;

		return {
			top: element.scrollTop,
			pinnedToBottom: remaining <= BOTTOM_EPSILON
		};
	}

	function scheduleFrame(callback: () => void): void {
		if (pendingFrame !== undefined) {
			return;
		}

		pendingFrame = requestAnimationFrame(() => {
			pendingFrame = undefined;
			callback();
		});
	}

	function restore(element: HTMLElement, key: string, state: ScrollState): boolean {
		if (activeKey !== key) {
			return false;
		}

		restoring = true;
		element.scrollTop = state.pinnedToBottom ? element.scrollHeight : state.top;

		if (restoreFrame !== undefined) {
			cancelAnimationFrame(restoreFrame);
		}

		restoreFrame = requestAnimationFrame(() => {
			restoreFrame = undefined;
			restoring = false;
		});

		return state.pinnedToBottom || Math.abs(element.scrollTop - state.top) < 1;
	}

	function rememberContent(element: HTMLDivElement): ReturnType<Attachment> {
		content = element;

		return () => {
			if (content === element) {
				content = null;
			}
		};
	}

	function observeViewport(element: HTMLDivElement): ReturnType<Attachment> {
		let contentResized = false;
		let scrollDirty = false;

		function flush(): void {
			if (viewport !== element) {
				return;
			}

			const key = activeKey;
			const resized = contentResized;
			contentResized = false;
			if (!key) {
				return;
			}

			if (scrollDirty) {
				scrollDirty = false;
				rememberScroll(key, readState(element));
			}

			const restoreRequest = pendingRestore;
			if (restoreRequest?.key === key) {
				const restored = restore(element, key, restoreRequest.state);
				if (!restoreRequest.state.pinnedToBottom && restored) {
					pendingRestore = undefined;
				} else if (restoreRequest.state.pinnedToBottom && restoreRequest.sawResize) {
					pendingRestore = undefined;
				}

				return;
			}

			if (restoreRequest) {
				return;
			}

			const state = scrollState(key);
			if (resized && state?.pinnedToBottom && !restoring) {
				element.scrollTop = element.scrollHeight;
			}
		}

		function handleScroll(): void {
			if (restoring) {
				return;
			}

			pendingRestore = undefined;
			scrollDirty = true;
			scheduleFrame(flush);
		}

		function handleResize(): void {
			contentResized = true;

			const restoreRequest = pendingRestore;
			if (restoreRequest && restoreRequest.key === activeKey) {
				restoreRequest.sawResize = true;
			}

			scheduleFrame(flush);
		}

		const observedContent =
			content ?? element.querySelector<HTMLDivElement>('.workspace-scroll-content');

		const observer = observedContent ? new ResizeObserver(handleResize) : undefined;
		if (observedContent) {
			observer?.observe(observedContent);
		}

		element.addEventListener('scroll', handleScroll, { passive: true });

		return () => {
			element.removeEventListener('scroll', handleScroll);
			observer?.disconnect();
			if (pendingFrame !== undefined) {
				cancelAnimationFrame(pendingFrame);
				pendingFrame = undefined;
			}

			if (restoreFrame !== undefined) {
				cancelAnimationFrame(restoreFrame);
				restoreFrame = undefined;
			}
		};
	}

	export function captureScrollBeforeContentChange(key: string): void {
		if (viewport && activeKey === key) {
			rememberScroll(key, readState(viewport));
		}
	}

	export function restoreActiveKey(): void {
		const key = activeKey;
		const state = key ? scrollState(key) : undefined;
		if (!viewport || !key || !state) {
			return;
		}

		pendingRestore = { key, state, sawResize: false };
		scheduleFrame(() => {
			if (viewport) {
				const restoreRequest = pendingRestore;
				if (restoreRequest?.key === activeKey) {
					restore(viewport, restoreRequest.key, restoreRequest.state);
					if (!restoreRequest.state.pinnedToBottom) {
						if (Math.abs(viewport.scrollTop - restoreRequest.state.top) < 1) {
							pendingRestore = undefined;
						}
					}
				}
			}
		});
	}
</script>

<ScrollArea.Root class="workspace-scroll-root" type="scroll">
	<ScrollArea.Viewport
		bind:ref={viewport}
		id="workspace-content"
		class="workspace-scroll-viewport"
		{@attach observeViewport}
	>
		<div
			class:workspace-state={workspaceState}
			class="workspace-scroll-content"
			{@attach rememberContent}
		>
			{@render children()}
		</div>
	</ScrollArea.Viewport>

	<ScrollArea.Scrollbar class="workspace-scrollbar" orientation="vertical" forceMount>
		<ScrollArea.Thumb class="workspace-scroll-thumb" />
	</ScrollArea.Scrollbar>
	<ScrollArea.Corner />
</ScrollArea.Root>

<style>
	:global([data-scroll-area-root].workspace-scroll-root) {
		position: relative;
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}

	:global([data-scroll-area-viewport].workspace-scroll-viewport) {
		height: 100%;
		width: 100%;
	}

	.workspace-scroll-content {
		width: 100%;
		min-width: 0;
		height: 100%;
		min-height: 100%;
		overflow-wrap: anywhere;
	}

	.workspace-scroll-content.workspace-state {
		display: grid;
		min-height: 100%;
		grid-template-rows: minmax(0, 1fr);
	}

	:global([data-scroll-area-scrollbar][data-orientation='vertical'].workspace-scrollbar) {
		display: flex;
		width: 0.625rem;
		touch-action: none;
		user-select: none;
		border-left: 1px solid transparent;
		border-radius: 999px;
		background: var(--surface-muted);
		padding: 1px;
		transition:
			width 200ms ease,
			background 200ms ease,
			opacity 200ms ease;
	}

	:global([data-scroll-area-scrollbar][data-orientation='vertical'].workspace-scrollbar:hover) {
		width: 0.75rem;
		background: var(--surface-strong);
	}

	:global(
		[data-scroll-area-scrollbar][data-orientation='vertical'].workspace-scrollbar[data-state='hidden']
	) {
		opacity: 0;
	}

	:global(
		[data-scroll-area-scrollbar][data-orientation='vertical'].workspace-scrollbar[data-state='hidden']:hover
	) {
		opacity: 1;
	}

	:global([data-scroll-area-thumb].workspace-scroll-thumb) {
		min-height: 2.75rem;
		flex: 1;
		border-radius: inherit;
		background: color-mix(in srgb, var(--text-muted) 70%, transparent);
	}

	:global([data-scroll-area-thumb].workspace-scroll-thumb:hover) {
		background: var(--text-muted);
	}
</style>

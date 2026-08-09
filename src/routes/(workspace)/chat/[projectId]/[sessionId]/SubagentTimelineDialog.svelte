<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Dialog } from 'bits-ui';
	import type {
		ChatItem,
		RuntimeSnapshot,
		SubagentRun,
		SubagentTimelineResponse
	} from '$lib/contracts';
	import PiWorkingSpinner from '$lib/components/PiWorkingSpinner.svelte';
	import { getSubagentTimeline } from '$lib/harness/api';
	import type { ChatTab } from '$lib/harness/types';
	import ChatTimeline from './ChatTimeline.svelte';

	type Props = {
		run: SubagentRun;
		projectId: string;
		parentSessionId: string;
		children?: Snippet;
	};
	let { run, projectId, parentSessionId, children }: Props = $props();
	const statusLabel: Record<SubagentRun['status'], string> = {
		running: 'Working',
		completed: 'Completed',
		failed: 'Failed',
		paused: 'Paused',
		stopped: 'Stopped'
	};
	let open = $state(false);
	let loadState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let response = $state<SubagentTimelineResponse>();
	let errorMessage = $state('');
	let closeButton = $state<HTMLButtonElement | null>(null);

	function readOnlyChat(items: ChatItem[]): ChatTab {
		const snapshot: RuntimeSnapshot = {
			runtimeId: `subagent-${run.childId}`,
			project: {
				id: projectId,
				name: 'Child timeline',
				cwd: '',
				addedAt: '',
				lastOpenedAt: ''
			},
			sessionId: run.childSessionId ?? run.childId,
			isStreaming: run.status === 'running',
			items,
			thinkingLevel: 'off',
			permissionRequests: []
		};

		return {
			id: `subagent-timeline-${run.childId}`,
			kind: 'chat',
			title: `${run.agent} timeline`,
			projectId,
			sessionId: snapshot.sessionId,
			snapshot,
			hydrationState: 'ready',
			hydrationGeneration: 0,
			bufferedEvents: [],
			needsCheckpoint: false,
			draft: '',
			queueMode: 'followUp',
			streamText: '',
			streamRenderedText: '',
			streamThinking: '',
			streamTools: [],
			transientNotices: [],
			permissionRequests: [],
			pendingUserMessages: []
		};
	}

	function handleOpenAutoFocus(event: Event): void {
		event.preventDefault();
		closeButton?.parentElement
			?.querySelector<HTMLElement>('.subagent-dialog-body')
			?.scrollTo({ top: 0, left: 0 });
		closeButton?.focus({ preventScroll: true });
	}

	async function loadTimeline(signal?: AbortSignal): Promise<void> {
		if (!run.childSessionId) {
			loadState = 'idle';
			response = undefined;

			return;
		}

		const hasTimeline = loadState === 'ready' && response !== undefined;
		if (!hasTimeline) {
			loadState = 'loading';
		}

		errorMessage = '';
		try {
			response = await getSubagentTimeline(projectId, parentSessionId, run.childSessionId, signal);
			loadState = 'ready';
		} catch (error) {
			if (signal?.aborted) {
				return;
			}

			if (hasTimeline) {
				return;
			}

			loadState = 'error';
			errorMessage = error instanceof Error ? error.message : 'Unable to load the child timeline.';
		}
	}

	function refreshWhileOpen(node: HTMLElement): () => void {
		void node;
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		let disposed = false;
		const refresh = async (): Promise<void> => {
			await loadTimeline(controller.signal);
			if (!disposed && run.status === 'running' && !controller.signal.aborted) {
				timer = setTimeout(() => void refresh(), 1000);
			}
		};

		queueMicrotask(() => {
			if (!disposed) {
				void refresh();
			}
		});

		return () => {
			disposed = true;
			controller.abort();
			if (timer !== undefined) {
				clearTimeout(timer);
			}
		};
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger
		class="subagent-card-trigger"
		type="button"
		aria-label={`${run.agent}: ${statusLabel[run.status]}`}
	>
		{@render children?.()}
	</Dialog.Trigger>
	<Dialog.Portal>
		<Dialog.Overlay data-subagent-dialog class="subagent-dialog-overlay" />
		<Dialog.Content
			data-subagent-dialog
			class="subagent-dialog-content"
			onOpenAutoFocus={handleOpenAutoFocus}
		>
			<Dialog.Title data-subagent-dialog class="subagent-dialog-title"
				>{run.agent} timeline</Dialog.Title
			>
			<div
				data-subagent-dialog
				class="subagent-dialog-body"
				class:subagent-dialog-body-loading={loadState === 'loading' || loadState === 'idle'}
				{@attach refreshWhileOpen}
			>
				{#if run.timelineAvailable === false}
					<p class="subagent-dialog-state" role="status">Timeline unavailable</p>
				{:else if !run.childSessionId}
					<p class="subagent-dialog-state" role="status">Initializing child session…</p>
				{:else if loadState === 'loading' || loadState === 'idle'}
					<p class="subagent-dialog-state subagent-dialog-loading" role="status">
						<PiWorkingSpinner tone="timeline" />
						<span>Loading child timeline…</span>
					</p>
				{:else if loadState === 'error'}
					<p class="subagent-dialog-state subagent-dialog-error" role="alert">{errorMessage}</p>
				{:else if response && !response.initialized}
					<p class="subagent-dialog-state" role="status">Timeline unavailable</p>
				{:else if response && !response.items.length}
					<p class="subagent-dialog-state" role="status">No child timeline entries yet.</p>
				{:else if response}
					<ChatTimeline
						chat={readOnlyChat(response.items)}
						showSubagentCards={false}
						showReasoning
					/>
				{/if}
			</div>
			<Dialog.Close
				bind:ref={closeButton}
				data-subagent-dialog
				class="subagent-dialog-close"
				type="button"
				aria-label="Close child timeline"
				title="Close child timeline"
			>
				<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
					<path
						d="M5 5L15 15M15 5L5 15"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
					/>
				</svg>
			</Dialog.Close>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	:global(.subagent-card-trigger) {
		display: block;
		width: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		text-align: left;
	}

	:global([data-subagent-dialog].subagent-dialog-overlay) {
		position: fixed;
		z-index: 20;
		inset: 0;
		background: color-mix(in srgb, var(--surface-strong) 78%, transparent);
	}

	:global([data-subagent-dialog].subagent-dialog-overlay[data-state='open']) {
		animation: subagent-overlay-in 120ms ease-out both;
	}

	:global([data-subagent-dialog].subagent-dialog-overlay[data-state='closed']) {
		animation: subagent-overlay-out 100ms ease-in both;
	}

	:global([data-subagent-dialog].subagent-dialog-content) {
		position: fixed;
		z-index: 21;
		top: 50%;
		left: 50%;
		display: flex;
		width: min(58rem, calc(100vw - 2rem));
		height: min(90dvh, 52rem);
		transform: translate(-50%, -50%);
		flex-direction: column;
		overflow: hidden;
		border: 1px solid var(--border-strong);
		border-radius: 0.4rem;
		background: var(--canvas);
		box-shadow: 0 0.35rem 1rem color-mix(in srgb, var(--shadow) 45%, transparent);
		outline: none;
	}

	:global([data-subagent-dialog].subagent-dialog-content[data-state='open']) {
		animation: subagent-dialog-in 120ms cubic-bezier(0.16, 1, 0.3, 1) both;
	}

	:global([data-subagent-dialog].subagent-dialog-content[data-state='closed']) {
		animation: subagent-dialog-out 100ms ease-in both;
	}

	:global([data-subagent-dialog].subagent-dialog-title) {
		margin: 0;
		padding: 0.3rem 3.75rem 0.6rem 1.25rem;
		color: var(--text);
		font-size: 1rem;
	}

	:global([data-subagent-dialog].subagent-dialog-body) {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 0.35rem 1rem 1rem;
	}

	:global([data-subagent-dialog].subagent-dialog-body-loading) {
		display: grid;
		place-items: center;
	}

	:global([data-subagent-dialog].subagent-dialog-state) {
		padding: 2rem 1rem;
		color: var(--text-muted);
		text-align: center;
	}

	:global([data-subagent-dialog].subagent-dialog-loading) {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
	}

	:global([data-subagent-dialog].subagent-dialog-error) {
		color: var(--danger);
	}

	:global([data-subagent-dialog].subagent-dialog-close) {
		position: absolute;
		top: 0.2rem;
		right: 0.2rem;
		display: grid;
		width: 2rem;
		height: 2rem;
		place-items: center;
		padding: 0;
		border: 1px solid transparent;
		border-radius: 0.4rem;
		background: transparent;
		color: var(--text-muted);
	}

	:global([data-subagent-dialog].subagent-dialog-close:hover) {
		border-color: var(--border-strong);
		background: var(--surface-muted);
		color: var(--text);
	}

	:global([data-subagent-dialog].subagent-dialog-close svg) {
		width: 1.2rem;
		height: 1.2rem;
	}

	:global([data-subagent-dialog].subagent-dialog-close):focus-visible,
	:global(.subagent-card-trigger):focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	@keyframes subagent-dialog-in {
		from {
			opacity: 0;
			transform: translate(-50%, -50%) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1);
		}
	}

	@keyframes subagent-dialog-out {
		from {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1);
		}
		to {
			opacity: 0;
			transform: translate(-50%, -50%) scale(0.96);
		}
	}

	@keyframes subagent-overlay-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes subagent-overlay-out {
		from {
			opacity: 1;
		}
		to {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		:global([data-subagent-dialog].subagent-dialog-overlay),
		:global([data-subagent-dialog].subagent-dialog-content) {
			animation: none;
		}
	}

	@media (max-width: 700px) {
		:global([data-subagent-dialog].subagent-dialog-content) {
			width: calc(100vw - 1rem);
			height: calc(100dvh - 1rem);
		}
	}
</style>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Dialog } from 'bits-ui';
	import type {
		ChatItem,
		RuntimeSnapshot,
		SubagentRun,
		SubagentTimelineResponse
	} from '$lib/contracts';
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

	async function loadTimeline(signal?: AbortSignal): Promise<void> {
		if (!run.childSessionId) {
			loadState = 'idle';
			response = undefined;

			return;
		}

		loadState = 'loading';
		errorMessage = '';
		try {
			response = await getSubagentTimeline(projectId, parentSessionId, run.childSessionId, signal);
			loadState = 'ready';
		} catch (error) {
			if (signal?.aborted) {
				return;
			}

			loadState = 'error';
			errorMessage = error instanceof Error ? error.message : 'Unable to load the child timeline.';
		}
	}

	function refreshWhileOpen(): (node: HTMLElement) => () => void {
		return (node) => {
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

			void refresh();

			return () => {
				disposed = true;
				controller.abort();
				if (timer !== undefined) {
					clearTimeout(timer);
				}
			};
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
		<Dialog.Content data-subagent-dialog class="subagent-dialog-content">
			<Dialog.Title data-subagent-dialog class="subagent-dialog-title"
				>{run.agent} timeline</Dialog.Title
			>
			<Dialog.Description data-subagent-dialog class="subagent-dialog-description">
				Read-only delegated child transcript{run.task ? `: ${run.task}` : '.'}
			</Dialog.Description>
			<div data-subagent-dialog class="subagent-dialog-body" {@attach refreshWhileOpen()}>
				{#if run.timelineAvailable === false}
					<p class="subagent-dialog-state" role="status">Timeline unavailable</p>
				{:else if !run.childSessionId}
					<p class="subagent-dialog-state" role="status">Initializing child session…</p>
				{:else if loadState === 'loading' || loadState === 'idle'}
					<p class="subagent-dialog-state" role="status">Loading child timeline…</p>
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

	:global([data-subagent-dialog].subagent-dialog-content) {
		position: fixed;
		z-index: 21;
		top: 50%;
		left: 50%;
		display: flex;
		width: min(58rem, calc(100vw - 2rem));
		max-height: min(90dvh, 52rem);
		transform: translate(-50%, -50%);
		flex-direction: column;
		overflow: hidden;
		border: 1px solid var(--border-strong);
		border-radius: 0.7rem;
		background: var(--canvas);
		box-shadow: 0 1.4rem 4rem var(--shadow);
		outline: none;
	}

	:global([data-subagent-dialog].subagent-dialog-title) {
		margin: 0;
		padding: 1rem 3.75rem 0.35rem 1.25rem;
		color: var(--text);
		font-size: 1rem;
	}

	:global([data-subagent-dialog].subagent-dialog-description) {
		padding: 0 1.25rem 0.8rem;
		color: var(--text-muted);
		font-size: 0.78rem;
	}

	:global([data-subagent-dialog].subagent-dialog-body) {
		min-height: 8rem;
		overflow: auto;
		padding: 0.35rem 1rem 1rem;
	}

	:global([data-subagent-dialog].subagent-dialog-state) {
		padding: 2rem 1rem;
		color: var(--text-muted);
		text-align: center;
	}

	:global([data-subagent-dialog].subagent-dialog-error) {
		color: var(--danger);
	}

	:global([data-subagent-dialog].subagent-dialog-close) {
		position: absolute;
		top: 0.8rem;
		right: 0.9rem;
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

	@media (max-width: 700px) {
		:global([data-subagent-dialog].subagent-dialog-content) {
			width: calc(100vw - 1rem);
			max-height: calc(100dvh - 1rem);
		}
	}
</style>

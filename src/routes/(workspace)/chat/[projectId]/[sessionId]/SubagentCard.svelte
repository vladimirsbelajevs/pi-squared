<script lang="ts">
	import type { SubagentRun } from '$lib/contracts';
	import PiWorkingSpinner from '$lib/components/PiWorkingSpinner.svelte';
	import SubagentTimelineDialog from './SubagentTimelineDialog.svelte';

	type Props = {
		run: SubagentRun;
		projectId: string;
		parentSessionId: string;
	};
	let { run, projectId, parentSessionId }: Props = $props();

	const statusLabel: Record<SubagentRun['status'], string> = {
		running: 'Working',
		completed: 'Completed',
		failed: 'Failed',
		paused: 'Paused',
		stopped: 'Stopped'
	};

	function icon(status: SubagentRun['status']): string {
		if (status === 'completed') {
			return '✓';
		}

		if (status === 'failed') {
			return '×';
		}

		if (status === 'paused') {
			return 'Ⅱ';
		}

		if (status === 'stopped') {
			return '⚠';
		}

		return '';
	}
</script>

<SubagentTimelineDialog {run} {projectId} {parentSessionId}>
	<div class={['subagent-card', `subagent-card-${run.status}`]}>
		<div class="subagent-card-status" aria-hidden={run.status !== 'running'}>
			{#if run.status === 'running'}
				<PiWorkingSpinner tone="timeline" />
			{:else}
				<span class="subagent-card-icon">{icon(run.status)}</span>
			{/if}
		</div>
		<div class="subagent-card-copy">
			<strong>{run.agent}</strong>
			{#if run.task}<span>{run.task}</span>{/if}
		</div>
		<span class="subagent-card-label" aria-live="polite">{statusLabel[run.status]}</span>
	</div>
</SubagentTimelineDialog>

<style>
	.subagent-card {
		display: flex;
		width: min(54rem, 100%);
		min-height: 2.8rem;
		align-items: center;
		gap: 0.65rem;
		margin: 0.35rem auto;
		padding: 0.55rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: 0.55rem;
		background: var(--surface-muted);
		color: var(--text);
		cursor: pointer;
		transition:
			border-color 140ms ease,
			background 140ms ease;
	}

	.subagent-card:hover {
		border-color: var(--accent);
		background: var(--surface);
	}

	.subagent-card-running {
		border-color: color-mix(in srgb, var(--accent) 60%, var(--border));
	}

	.subagent-card-failed {
		border-color: color-mix(in srgb, var(--danger) 60%, var(--border));
	}

	.subagent-card-paused,
	.subagent-card-stopped {
		border-color: color-mix(in srgb, var(--warning) 60%, var(--border));
	}

	.subagent-card-status {
		display: grid;
		width: 1.2rem;
		place-items: center;
		color: var(--accent);
	}

	.subagent-card-icon {
		font-size: 1.1rem;
		font-weight: 700;
	}

	.subagent-card-failed .subagent-card-icon {
		color: var(--danger);
	}

	.subagent-card-paused .subagent-card-icon,
	.subagent-card-stopped .subagent-card-icon {
		color: var(--warning);
	}

	.subagent-card-copy {
		display: grid;
		min-width: 0;
		gap: 0.15rem;
	}

	.subagent-card-copy strong {
		font-size: 0.8rem;
	}

	.subagent-card-copy span {
		overflow: hidden;
		color: var(--text-muted);
		font-size: 0.72rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.subagent-card-label {
		margin-left: auto;
		color: var(--text-muted);
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	@media (prefers-reduced-motion: reduce) {
		.subagent-card {
			transition: none;
		}
	}
</style>

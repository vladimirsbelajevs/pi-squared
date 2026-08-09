<script lang="ts">
	import type { FinalActivityEntry } from '$lib/harness/timeline';
	import type { StreamingTool } from '$lib/harness/types';
	import ToolGroup, { type ToolGroupTool } from './ToolGroup.svelte';
	import ReasoningMarkdown from './ReasoningMarkdown.svelte';

	type ExpansionState = Pick<Set<string>, 'add' | 'delete' | 'has'>;
	type Props = {
		chatId: string;
		activityId: string;
		activityAliasIds?: string[];
		entries: FinalActivityEntry[];
		liveTools?: ToolGroupTool[];
		liveToolForCallId?: (callId: string) => StreamingTool | undefined;
		showReasoning?: boolean;
		expandedActivityIds: ExpansionState;
		expandedToolIds: ExpansionState;
	};
	let {
		chatId,
		activityId,
		activityAliasIds = [],
		entries,
		liveTools = [],
		liveToolForCallId,
		showReasoning = false,
		expandedActivityIds,
		expandedToolIds
	}: Props = $props();

	function activityKey(): string {
		return `${chatId}:activity:${activityId}`;
	}

	let groupOpen = $derived(
		expandedActivityIds.has(activityKey()) ||
			activityAliasIds.some((alias) => expandedActivityIds.has(`${chatId}:activity:${alias}`))
	);
	let visibleEntries = $derived(entries.filter((entry) => entry.kind === 'tools' || showReasoning));
	let hasVisibleEntries = $derived(visibleEntries.length > 0 || liveTools.length > 0);
	let toolCount = $derived(
		visibleEntries.reduce(
			(count, entry) => count + (entry.kind === 'tools' ? entry.tools.length : 0),
			0
		) + liveTools.length
	);

	function setGroupOpen(open: boolean): void {
		if (open) {
			expandedActivityIds.add(activityKey());
		} else {
			expandedActivityIds.delete(activityKey());
			for (const alias of activityAliasIds) {
				expandedActivityIds.delete(`${chatId}:activity:${alias}`);
			}
		}
	}

	function summary(): string {
		return toolCount
			? `Agent activity · ${toolCount} tool${toolCount === 1 ? '' : 's'}`
			: 'Agent activity';
	}
</script>

{#if hasVisibleEntries}
	<details
		class="activity-group"
		open={groupOpen}
		ontoggle={(event) => setGroupOpen((event.currentTarget as HTMLDetailsElement).open)}
	>
		<summary class="activity-summary">{summary()}</summary>
		{#if groupOpen}
			<div class="activity-events">
				{#each visibleEntries as entry (entry.id)}
					{#if entry.kind === 'reasoning'}
						<ReasoningMarkdown text={entry.text} />
					{:else}
						<ToolGroup
							{chatId}
							finalizedTools={entry.tools}
							{liveToolForCallId}
							{expandedToolIds}
						/>
					{/if}
				{/each}
				{#if liveTools.length}
					<ToolGroup {chatId} tools={liveTools} {expandedToolIds} />
				{/if}
			</div>
		{/if}
	</details>
{/if}

<style>
	.activity-group {
		max-width: 54rem;
		margin: 0.25rem auto;
		content-visibility: auto;
		contain-intrinsic-size: auto 240px;
	}

	.activity-summary {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding-left: 0.2rem;
		color: var(--text-muted);
		font-size: 0.8rem;
		cursor: pointer;
		list-style: none;
	}

	.activity-summary::-webkit-details-marker {
		display: none;
	}

	.activity-summary::before {
		display: inline-block;
		flex: 0 0 1rem;
		width: 1rem;
		color: var(--accent);
		content: '›';
		font-size: 0.95rem;
		line-height: 1;
		text-align: center;
		transform-origin: center;
		transition: transform 160ms ease;
	}

	.activity-group[open] > .activity-summary::before {
		transform: rotate(90deg);
	}

	.activity-events {
		display: grid;
		gap: 0.25rem;
		padding-left: 1.5rem;
	}

	.activity-events > :global(.tool-group) {
		width: 100%;
		margin-right: 0;
		margin-left: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.activity-summary::before {
			transition: none;
		}
	}
</style>

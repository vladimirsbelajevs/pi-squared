<script lang="ts">
	import type { ToolStatus } from '$lib/contracts';

	export type ToolGroupTool = {
		id: string;
		name: string;
		status: ToolStatus;
		arguments?: string;
		hasResult: boolean;
		resultText?: string;
	};

	type ExpansionState = Pick<Set<string>, 'add' | 'delete' | 'has'>;
	type Props = {
		chatId: string;
		tools: ToolGroupTool[];
		thinking?: string;
		showReasoning?: boolean;
		expandedToolIds: ExpansionState;
	};
	let { chatId, tools, thinking, showReasoning = false, expandedToolIds }: Props = $props();

	let groupOpen = $derived(tools.some((tool) => expandedToolIds.has(groupKey(tool.id))));

	function groupKey(toolId: string): string {
		return `${chatId}:group:${toolId}`;
	}

	function resultKey(toolId: string): string {
		return `${chatId}:result:${toolId}`;
	}

	function setGroupOpen(open: boolean): void {
		for (const tool of tools) {
			const key = groupKey(tool.id);
			if (open) {
				expandedToolIds.add(key);
			} else {
				expandedToolIds.delete(key);
			}
		}
	}

	function setResultOpen(toolId: string, open: boolean): void {
		const key = resultKey(toolId);
		if (open) {
			expandedToolIds.add(key);
		} else {
			expandedToolIds.delete(key);
		}
	}

	function toolCountLabel(count: number): string {
		return `${count} tool${count === 1 ? '' : 's'} called`;
	}

	function summary(): string {
		const counts = { completed: 0, running: 0, failed: 0, cancelled: 0 };
		for (const tool of tools) {
			if (tool.status !== 'pending') {
				counts[tool.status] += 1;
			}
		}

		return [
			toolCountLabel(tools.length),
			...(['completed', 'running', 'failed', 'cancelled'] as const)
				.filter((status) => counts[status] > 0)
				.map((status) => `${counts[status]} ${status}`)
		].join(' · ');
	}
</script>

<details
	class={['tool-group', tools.some((tool) => tool.status === 'failed') && 'tool-group-error']}
	open={groupOpen}
	ontoggle={(event) => setGroupOpen((event.currentTarget as HTMLDetailsElement).open)}
>
	<summary class="tool-group-summary">{summary()}</summary>
	{#if groupOpen}
		{#if showReasoning && thinking}
			<details class="thinking tool-thinking">
				<summary>Reasoning</summary>
				<pre>{thinking}</pre>
			</details>
		{/if}
		<div class="tool-list">
			{#each tools as tool (tool.id)}
				<section class:tool-entry-error={tool.status === 'failed'} class="tool-entry">
					<div class="tool-entry-heading">
						<strong>{tool.name}</strong>
						<span>{tool.status}</span>
					</div>
					{#if tool.arguments !== undefined}
						<div class="tool-detail">
							<span>Arguments</span>
							<pre>{tool.arguments}</pre>
						</div>
					{/if}
					{#if tool.hasResult}
						{@const isResultOpen = expandedToolIds.has(resultKey(tool.id))}
						<details
							class="tool-detail tool-result"
							open={isResultOpen}
							ontoggle={(event) =>
								setResultOpen(tool.id, (event.currentTarget as HTMLDetailsElement).open)}
						>
							<summary>Result</summary>
							{#if isResultOpen}
								<pre>{tool.resultText ?? 'No output.'}</pre>
							{/if}
						</details>
					{/if}
				</section>
			{/each}
		</div>
	{/if}
</details>

<style>
	.tool-group {
		max-width: 54rem;
		margin: 0.25rem auto;
		overflow: hidden;
	}

	.tool-group-summary {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0;
		color: var(--text-muted);
		font-size: 0.8rem;
		cursor: pointer;
		list-style: none;
	}

	.tool-group-summary::-webkit-details-marker,
	.tool-result summary::-webkit-details-marker {
		display: none;
	}

	.tool-group-error > .tool-group-summary,
	.tool-entry-error .tool-entry-heading span {
		color: var(--danger);
	}

	.tool-list {
		display: grid;
		gap: 0.65rem;
		padding: 0.75rem;
	}

	.tool-entry {
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 0.45rem;
		background: var(--surface-muted);
	}

	.tool-entry-error {
		border-color: color-mix(in srgb, var(--danger) 65%, var(--border));
	}

	.tool-entry-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.5rem 0.65rem;
		border-bottom: 1px solid var(--border);
		color: var(--text);
		font-size: 0.75rem;
	}

	.tool-entry-heading span,
	.tool-detail > span,
	.tool-result summary {
		color: var(--text-muted);
		font-size: 0.65rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.tool-detail + .tool-detail {
		border-top: 1px solid var(--border);
	}

	.tool-detail > span {
		display: block;
		padding: 0.5rem 0.65rem 0;
	}

	.tool-detail pre,
	.thinking pre {
		margin: 0;
		overflow-x: auto;
		padding: 0.8rem;
		font:
			0.85rem/1.55 ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.thinking {
		border-top: 1px solid var(--border);
	}

	.thinking summary {
		padding: 0.6rem 0.8rem;
		color: var(--text-muted);
		font-size: 0.8rem;
		cursor: pointer;
	}

	.thinking pre {
		color: var(--text-muted);
	}

	.tool-result summary {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.5rem 0.65rem;
		cursor: pointer;
		list-style: none;
	}

	.tool-result summary::before {
		content: '›';
		color: var(--accent);
		font-size: 0.9rem;
		transition: transform 160ms ease;
	}

	.tool-result[open] summary::before {
		transform: rotate(90deg);
	}

	@media (prefers-reduced-motion: reduce) {
		.tool-result summary::before {
			transition: none;
		}
	}
</style>

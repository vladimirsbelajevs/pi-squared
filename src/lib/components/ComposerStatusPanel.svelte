<script lang="ts">
	import type { ContextUsageSnapshot, McpStatusSnapshot, SessionTokenUsage } from '$lib/contracts';
	import McpInfo from './McpInfo.svelte';

	type UsageEntry = {
		abbreviation: string;
		label: string;
		value: number;
	};

	type Props = {
		status?: McpStatusSnapshot;
		contextUsage?: ContextUsageSnapshot;
		sessionTokens?: SessionTokenUsage;
		disabled?: boolean;
		onToggle?: (serverName: string, enabled: boolean) => Promise<void>;
		projectName?: string;
		projectCwd?: string;
	};

	let {
		status,
		contextUsage,
		sessionTokens,
		disabled = false,
		onToggle,
		projectName,
		projectCwd
	}: Props = $props();

	const panelId = $props.id();
	let expanded = $state(false);
	let servers = $derived(status?.servers ?? []);
	let enabledCount = $derived(servers.filter((server) => !server.disabled).length);
	let usageEntries = $derived.by((): UsageEntry[] => {
		if (!sessionTokens) {
			return [];
		}

		return [
			{ abbreviation: '↑', label: 'input tokens', value: sessionTokens.input },
			{ abbreviation: '↓', label: 'output tokens', value: sessionTokens.output },
			{ abbreviation: 'R', label: 'cached tokens read', value: sessionTokens.cacheRead },
			{ abbreviation: 'W', label: 'cached tokens written', value: sessionTokens.cacheWrite }
		].filter((entry) => entry.value !== 0);
	});
	let cacheHitRate = $derived(
		sessionTokens &&
			(sessionTokens.cacheRead > 0 || sessionTokens.cacheWrite > 0) &&
			sessionTokens.cacheHitRate !== undefined
			? sessionTokens.cacheHitRate
			: undefined
	);
	let contextText = $derived(
		contextUsage
			? `${hasKnownContext(contextUsage) ? `${contextUsage.percent.toFixed(1)}%` : '?'}/${formatTokens(contextUsage.contextWindow)}`
			: undefined
	);
	let contextTone = $derived(
		hasKnownContext(contextUsage) && contextUsage.percent > 90
			? 'context-danger'
			: hasKnownContext(contextUsage) && contextUsage.percent > 70
				? 'context-warning'
				: 'context-normal'
	);
	let usageLabel = $derived.by(() => {
		const usage = sessionTokens
			? usageEntries.length
				? `Session token usage: ${usageEntries.map((entry) => `${formatFullTokens(entry.value)} ${entry.label}`).join(', ')}${cacheHitRate !== undefined ? `, ${cacheHitRate.toFixed(1)}% latest cache hit rate` : ''}.`
				: 'Session token usage: no tokens used.'
			: '';
		const context = !contextUsage
			? ''
			: !hasKnownContext(contextUsage)
				? `Context usage: unknown of ${formatFullTokens(contextUsage.contextWindow)} tokens.`
				: `Context usage: ${formatFullTokens(contextUsage.tokens)} of ${formatFullTokens(contextUsage.contextWindow)} tokens (${contextUsage.percent.toFixed(1)} percent).`;

		return [usage, context].filter(Boolean).join(' ');
	});

	function hasKnownContext(
		context: ContextUsageSnapshot | undefined
	): context is ContextUsageSnapshot & { tokens: number; percent: number } {
		return context?.tokens != null && context.percent != null;
	}

	function formatTokens(tokens: number): string {
		if (tokens >= 1_000_000) {
			return `${(tokens / 1_000_000).toFixed(1)}m`;
		}

		if (tokens >= 100_000) {
			return `${Math.round(tokens / 1_000)}k`;
		}

		if (tokens >= 1_000) {
			return `${(tokens / 1_000).toFixed(1)}k`;
		}

		return `${tokens}`;
	}

	function formatFullTokens(tokens: number): string {
		return new Intl.NumberFormat('en-US').format(tokens);
	}

	function closeOnEscape(event: KeyboardEvent): void {
		if (!expanded || event.key !== 'Escape') {
			return;
		}

		event.preventDefault();
		expanded = false;
	}
</script>

<div class="status-panel">
	<div class="status-panel-row">
		{#if servers.length}
			<button
				class="mcp-summary"
				type="button"
				aria-expanded={expanded}
				aria-controls={panelId}
				{disabled}
				onclick={() => (expanded = !expanded)}
				onkeydown={closeOnEscape}
			>
				<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
					<path
						d="M7.25 2.75V7.5M12.75 2.75V7.5M5 7.5H15V11.25C15 14.01 12.76 16.25 10 16.25C7.24 16.25 5 14.01 5 11.25V7.5Z"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
				<span>MCP: {enabledCount}/{servers.length}</span>
			</button>
		{:else}
			<span class="mcp-empty">MCP: No servers configured</span>
		{/if}

		{#if usageLabel || projectName}
			<div class="thread-project-cluster">
				{#if usageLabel}
					<div class="usage-indicator">
						<span class="visually-hidden">{usageLabel}</span>
						{#each usageEntries as entry (entry.abbreviation)}
							<span class="token-usage" aria-hidden="true"
								>{entry.abbreviation}{formatTokens(entry.value)}</span
							>
						{/each}
						{#if cacheHitRate !== undefined}
							<span class="token-usage" aria-hidden="true">CH{cacheHitRate.toFixed(1)}%</span>
						{/if}
						{#if contextText}
							<span class={['context-usage', contextTone]} aria-hidden="true">{contextText}</span>
						{/if}
					</div>
				{/if}

				{#if projectName}
					<div class="thread-project" title={projectCwd}>
						<span class="project-dot"></span>
						<span class="project-name">{projectName}</span>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<McpInfo
		{expanded}
		{servers}
		totalTools={status?.totalTools ?? 0}
		{panelId}
		{disabled}
		{onToggle}
		onClose={() => (expanded = false)}
	/>
</div>

<style>
	.status-panel {
		display: grid;
		position: relative;
		width: 100%;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.status-panel-row {
		display: flex;
		align-items: center;
		min-height: 2.25rem;
		min-width: 0;
		gap: 1rem;
		border: 1px solid color-mix(in srgb, var(--accent) 52%, var(--border));
		border-radius: 0.65rem 0.65rem 0 0;
		background: color-mix(in srgb, var(--accent) 8%, var(--surface));
		padding: 0.48rem 0.6rem 1.2rem;
		color: var(--accent);
	}

	.mcp-summary {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		appearance: none;
		border: 0;
		background: transparent;
		padding: 0;
		color: inherit;
		font: inherit;
		font-size: 0.74rem;
		font-weight: 650;
		text-align: left;
		cursor: pointer;
	}

	.mcp-empty {
		display: flex;
		align-items: center;
		color: inherit;
		font-size: 0.74rem;
		font-weight: 650;
	}

	.mcp-summary:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.mcp-summary:disabled {
		cursor: not-allowed;
		opacity: 0.65;
	}

	.mcp-summary svg {
		width: 1rem;
		height: 1rem;
		flex: none;
	}

	.usage-indicator {
		display: flex;
		align-items: center;
		min-width: 0;
		gap: 0.4rem;
		color: var(--text-muted);
		font-size: 0.68rem;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.thread-project-cluster {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		min-width: 0;
		gap: 1rem;
		margin-left: auto;
	}

	.token-usage,
	.context-usage {
		font-weight: 650;
	}

	.context-warning {
		color: var(--warning);
	}

	.context-danger {
		color: var(--danger);
	}

	.thread-project {
		display: flex;
		align-items: center;
		min-width: 0;
		max-width: min(65%, 32rem);
		gap: 0.4rem;
		color: var(--text-muted);
		font-size: 0.74rem;
	}

	.project-dot {
		flex-shrink: 0;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--success);
	}

	.project-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	@media (max-width: 500px) {
		.status-panel-row {
			flex-wrap: wrap;
			gap: 0.5rem;
		}

		.usage-indicator {
			order: 3;
			width: 100%;
		}

		.thread-project-cluster {
			display: contents;
		}

		.thread-project {
			margin-left: auto;
			max-width: 55%;
		}
	}
</style>

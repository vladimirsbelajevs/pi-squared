<script lang="ts">
	import type { McpServerStatus, McpStatusSnapshot } from '$lib/contracts';

	type Props = {
		status?: McpStatusSnapshot;
		disabled?: boolean;
		onToggle?: (serverName: string, enabled: boolean) => Promise<void>;
		projectName?: string;
		projectCwd?: string;
	};

	let { status, disabled = false, onToggle, projectName, projectCwd }: Props = $props();

	const panelId = $props.id();
	const panelTitleId = `${panelId}-title`;
	let expanded = $state(false);
	let pendingServerNames = $state.raw<string[]>([]);
	let toggleError = $state<string>();
	let servers = $derived(status?.servers ?? []);
	let enabledCount = $derived(servers.filter((server) => !server.disabled).length);
	let summaryTone = $derived(
		status?.connectedCount && status.connectedCount > 0
			? 'tone-connected'
			: enabledCount > 0
				? 'tone-warning'
				: 'tone-muted'
	);

	function stateLabel(server: McpServerStatus): string {
		if (server.disabled) return 'Disabled';

		switch (server.state) {
			case 'connected':
				return 'Connected';
			case 'cached':
				return 'Cached';
			case 'failed':
				return 'Failed';
			case 'needs-auth':
				return 'Needs authentication';
			case 'not-connected':
				return 'Not connected';
			case 'disabled':
				return 'Disabled';
		}
	}

	function isPending(serverName: string): boolean {
		return pendingServerNames.includes(serverName);
	}

	function closeOnEscape(event: KeyboardEvent): void {
		if (!expanded || event.key !== 'Escape') return;
		event.preventDefault();
		expanded = false;
	}

	async function toggleServer(server: McpServerStatus): Promise<void> {
		if (disabled || !onToggle || isPending(server.name)) return;

		toggleError = undefined;
		pendingServerNames = [...pendingServerNames, server.name];
		try {
			await onToggle(server.name, server.disabled);
		} catch (error) {
			toggleError = error instanceof Error ? error.message : 'Unable to update this MCP server.';
		} finally {
			pendingServerNames = pendingServerNames.filter((serverName) => serverName !== server.name);
		}
	}
</script>

<div class="mcp-status">
	<div class="mcp-status-row">
		{#if servers.length}
			<button
				class={['mcp-summary', summaryTone]}
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
				<span>MCP: {enabledCount} {enabledCount === 1 ? 'server' : 'servers'} enabled</span>
			</button>
		{:else}
			<span class="mcp-empty">MCP: No servers configured</span>
		{/if}

		{#if projectName}
			<div class="thread-project" title={projectCwd}>
				<span class="project-dot"></span>
				<span class="project-name">{projectName}</span>
			</div>
		{/if}
	</div>

	{#if expanded && servers.length}
		<section id={panelId} class="mcp-panel" aria-labelledby={panelTitleId}>
			<div class="mcp-panel-header">
				<h2 id={panelTitleId}>MCP servers</h2>
				<span>{status?.totalTools ?? 0} {(status?.totalTools ?? 0) === 1 ? 'tool' : 'tools'}</span>
			</div>

			{#if toggleError}
				<p class="mcp-error" role="alert">Unable to update MCP server: {toggleError}</p>
			{/if}

			<ul class="mcp-server-list" aria-label="MCP servers">
				{#each servers as server (server.name)}
					<li class="mcp-server">
						<div class="server-details">
							<strong title={server.name}>{server.name}</strong>
							<div class="server-meta">
								<span
									class={['server-state', `state-${server.disabled ? 'disabled' : server.state}`]}
								>
									{stateLabel(server)}
								</span>
								<span>{server.toolCount} {server.toolCount === 1 ? 'tool' : 'tools'}</span>
							</div>
						</div>
						<button
							class="server-switch"
							type="button"
							role="switch"
							aria-checked={!server.disabled}
							aria-label={`${server.disabled ? 'Enable' : 'Disable'} ${server.name}`}
							aria-busy={isPending(server.name)}
							disabled={disabled || !onToggle || isPending(server.name)}
							onclick={() => void toggleServer(server)}
							onkeydown={closeOnEscape}
						>
							{server.disabled ? 'Enable' : 'Disable'}
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

<style>
	.mcp-status {
		display: grid;
		width: 100%;
		gap: 0.45rem;
	}

	.mcp-status-row {
		display: flex;
		align-items: center;
		min-width: 0;
		gap: 1rem;
	}

	.mcp-summary {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		border: 1px solid var(--border);
		border-radius: 0.55rem;
		background: var(--surface-muted);
		padding: 0.48rem 0.6rem;
		color: var(--text-muted);
		font-size: 0.74rem;
		font-weight: 650;
		text-align: left;
		transition:
			border-color 140ms ease,
			background 140ms ease,
			color 140ms ease;
	}

	.mcp-empty {
		display: flex;
		align-items: center;
		min-height: 2.25rem;
		color: var(--text-muted);
		padding: 0.48rem 0.6rem;
		font-size: 0.74rem;
		font-weight: 650;
	}

	.mcp-summary:hover:not(:disabled) {
		border-color: var(--border-strong);
		background: var(--surface-strong);
	}

	.mcp-summary:focus-visible,
	.server-switch:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.mcp-summary:disabled,
	.server-switch:disabled {
		cursor: not-allowed;
		opacity: 0.65;
	}

	.mcp-summary svg {
		width: 1rem;
		height: 1rem;
		flex: none;
	}

	.thread-project {
		display: flex;
		align-items: center;
		min-width: 0;
		max-width: min(65%, 32rem);
		gap: 0.4rem;
		margin-left: auto;
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

	.tone-connected {
		border-color: color-mix(in srgb, var(--success) 52%, var(--border));
		background: color-mix(in srgb, var(--success) 9%, var(--surface));
		color: var(--success);
	}

	.tone-warning {
		border-color: color-mix(in srgb, var(--warning) 52%, var(--border));
		background: color-mix(in srgb, var(--warning) 8%, var(--surface));
		color: var(--warning);
	}

	.tone-muted {
		color: var(--text-muted);
	}

	.mcp-panel {
		display: flex;
		width: 100%;
		max-height: min(21.75rem, 45dvh);
		flex-direction: column;
		overflow: hidden;
		border: 1px solid var(--border-strong);
		border-radius: 0.65rem;
		background: color-mix(in srgb, var(--surface-muted) 92%, var(--surface));
		box-shadow: 0 14px 30px var(--shadow);
	}

	.mcp-panel-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		flex: none;
		border-bottom: 1px solid var(--border);
		background: var(--surface-muted);
		padding: 0.5rem 0.75rem;
	}

	.mcp-panel-header h2 {
		margin: 0;
		color: var(--text);
		font-size: 0.76rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.mcp-panel-header span,
	.server-meta {
		color: var(--text-muted);
		font-size: 0.68rem;
	}

	.mcp-error {
		margin: 0;
		border-bottom: 1px solid color-mix(in srgb, var(--danger) 36%, var(--border));
		background: color-mix(in srgb, var(--danger) 8%, var(--surface));
		color: var(--danger);
		padding: 0.45rem 0.75rem;
		font-size: 0.72rem;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}

	.mcp-server-list {
		min-height: 0;
		margin: 0;
		overflow-y: auto;
		padding: 0;
		list-style: none;
	}

	.mcp-server {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.75rem;
		border-bottom: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
		padding: 0.52rem 0.75rem;
	}

	.mcp-server:last-child {
		border-bottom: 0;
	}

	.server-details {
		min-width: 0;
	}

	.server-details strong {
		display: block;
		overflow: hidden;
		color: var(--text);
		font-size: 0.78rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.server-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.12rem;
	}

	.server-state {
		font-weight: 600;
	}

	.state-connected {
		color: var(--success);
	}

	.state-cached {
		color: var(--accent);
	}

	.state-failed {
		color: var(--danger);
	}

	.state-needs-auth {
		color: var(--warning);
	}

	.state-not-connected,
	.state-disabled {
		color: var(--text-muted);
	}

	.server-switch {
		border: 1px solid var(--border-strong);
		border-radius: 0.42rem;
		background: var(--surface-strong);
		color: var(--text);
		padding: 0.32rem 0.48rem;
		font-size: 0.68rem;
		font-weight: 600;
		transition:
			border-color 140ms ease,
			background 140ms ease;
	}

	.server-switch:hover:not(:disabled) {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, var(--surface-strong));
	}

	@media (max-width: 500px) {
		.mcp-status-row {
			gap: 0.5rem;
		}

		.thread-project {
			max-width: 55%;
		}

		.mcp-server {
			gap: 0.5rem;
			padding-inline: 0.6rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.mcp-summary,
		.server-switch {
			transition: none;
		}
	}
</style>

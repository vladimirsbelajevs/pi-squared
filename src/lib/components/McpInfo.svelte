<script lang="ts">
	import { MediaQuery } from 'svelte/reactivity';
	import { fly } from 'svelte/transition';
	import type { McpServerStatus } from '$lib/contracts';

	type Props = {
		expanded: boolean;
		servers: McpServerStatus[];
		totalTools: number;
		panelId: string;
		disabled?: boolean;
		onToggle?: (serverName: string, enabled: boolean) => Promise<void>;
		onClose: () => void;
	};

	let {
		expanded,
		servers,
		totalTools,
		panelId,
		disabled = false,
		onToggle,
		onClose
	}: Props = $props();

	let panelTitleId = $derived(`${panelId}-title`);
	const reducedMotion = new MediaQuery('prefers-reduced-motion: reduce', false);
	let pendingServerNames = $state.raw<string[]>([]);
	let toggleError = $state<string>();
	let panelTransition = $derived({ y: 8, duration: reducedMotion.current ? 0 : 160 });

	function stateLabel(server: McpServerStatus): string {
		if (server.disabled) {
			return 'Disabled';
		}

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
		if (event.key !== 'Escape') {
			return;
		}

		event.preventDefault();
		onClose();
	}

	async function toggleServer(server: McpServerStatus): Promise<void> {
		if (disabled || !onToggle || isPending(server.name)) {
			return;
		}

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

{#if expanded && servers.length}
	<section
		id={panelId}
		class="mcp-panel"
		aria-labelledby={panelTitleId}
		transition:fly|global={panelTransition}
	>
		<div class="mcp-panel-header">
			<h2 id={panelTitleId}>MCP servers</h2>
			<span>{totalTools} {totalTools === 1 ? 'tool' : 'tools'}</span>
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

<style>
	.mcp-panel {
		position: absolute;
		z-index: 2;
		right: 0;
		bottom: calc(100% + 0.45rem);
		left: 0;
		display: flex;
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

	.server-switch:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.server-switch:disabled {
		cursor: not-allowed;
		opacity: 0.65;
	}

	.server-switch:hover:not(:disabled) {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, var(--surface-strong));
	}

	@media (max-width: 500px) {
		.mcp-server {
			gap: 0.5rem;
			padding-inline: 0.6rem;
		}
	}

	@media (max-width: 700px) {
		.mcp-panel {
			max-height: min(17rem, 38dvh);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.server-switch {
			transition: none;
		}
	}
</style>

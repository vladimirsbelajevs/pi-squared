<script lang="ts">
	import { onMount } from 'svelte';
	import type { PiSquaredDesktopWindowControls } from '$lib/desktop-contract';

	interface Props {
		api: PiSquaredDesktopWindowControls;
	}

	let { api }: Props = $props();
	let maximized = $state(false);

	onMount(() => {
		let mounted = true;
		let stateUpdates = 0;
		const unsubscribe = api.onStateChange((state) => {
			stateUpdates += 1;
			if (mounted) {
				maximized = state.maximized;
			}
		});
		const stateUpdatesAtQuery = stateUpdates;

		void api
			.getState()
			.then((state) => {
				if (mounted && stateUpdates === stateUpdatesAtQuery) {
					maximized = state.maximized;
				}
			})
			.catch(() => {
				// The window may close while the titlebar is mounting.
			});

		return () => {
			mounted = false;
			unsubscribe();
		};
	});

	function minimize(): void {
		void api.minimize();
	}

	function toggleMaximize(): void {
		void api.toggleMaximize();
	}

	function close(): void {
		void api.close();
	}
</script>

<header class="titlebar" aria-label="Pi² window controls">
	<div class="titlebar-brand" aria-label="Pi²">Pi²</div>
	<div class="titlebar-drag-region" aria-hidden="true"></div>
	<div class="titlebar-controls">
		<button type="button" aria-label="Minimize window" title="Minimize" onclick={minimize}>
			<svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
				<path d="M3 8.5h10" />
			</svg>
		</button>
		<button
			type="button"
			aria-label={maximized ? 'Restore window' : 'Maximize window'}
			title={maximized ? 'Restore' : 'Maximize'}
			onclick={toggleMaximize}
		>
			{#if maximized}
				<svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
					<path d="M5.5 5.5h7v7h-7zM3.5 3.5h7v2" />
				</svg>
			{:else}
				<svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
					<path d="M4 4h8v8H4z" />
				</svg>
			{/if}
		</button>
		<button class="close" type="button" aria-label="Close window" title="Close" onclick={close}>
			<svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
				<path d="m4 4 8 8M12 4l-8 8" />
			</svg>
		</button>
	</div>
</header>

<style>
	.titlebar {
		display: flex;
		flex: 0 0 2.25rem;
		align-items: center;
		height: 2.25rem;
		border-bottom: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		user-select: none;
		-webkit-app-region: drag;
	}

	.titlebar-brand {
		padding: 0 0.8rem;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		white-space: nowrap;
	}

	.titlebar-drag-region {
		align-self: stretch;
		flex: 1;
	}

	.titlebar-controls {
		display: flex;
		align-self: stretch;
		-webkit-app-region: no-drag;
	}

	.titlebar-controls button {
		display: grid;
		width: 2.75rem;
		place-items: center;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-muted);
		-webkit-app-region: no-drag;
	}

	.titlebar-controls button:hover {
		background: var(--surface-strong);
		color: var(--text);
	}

	.titlebar-controls button:focus-visible {
		position: relative;
		z-index: 1;
		outline: 2px solid var(--accent-strong);
		outline-offset: -3px;
	}

	.titlebar-controls button.close:hover {
		background: var(--danger);
		color: var(--surface-muted);
	}

	.titlebar-controls svg {
		width: 0.9rem;
		height: 0.9rem;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.35;
	}
</style>

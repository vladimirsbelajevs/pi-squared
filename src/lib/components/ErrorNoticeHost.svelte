<script lang="ts">
	import { onMount } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { fly } from 'svelte/transition';
	import { registerErrorNoticeHost } from '$lib/error-notices';

	const autoDismissMs = 6_000;
	const reducedMotion = new MediaQuery('prefers-reduced-motion: reduce', false);
	let queue = $state.raw<string[]>([]);
	let active = $state<string | undefined>();
	let dismissing = $state(false);
	let timeout: number | undefined;
	let enterTransition = $derived({ y: 18, duration: reducedMotion.current ? 0 : 180 });
	let exitTransition = $derived({ y: -18, duration: reducedMotion.current ? 0 : 180 });

	function showNext(): void {
		if (dismissing || active !== undefined || queue.length === 0) {
			return;
		}

		active = queue[0];
		queue = queue.slice(1);
		timeout = window.setTimeout(dismiss, autoDismissMs);
	}

	function enqueue(message: string): void {
		queue = [...queue, message];
		showNext();
	}

	function dismiss(): void {
		if (active === undefined || dismissing) {
			return;
		}

		if (timeout !== undefined) {
			window.clearTimeout(timeout);
		}
		timeout = undefined;
		dismissing = true;
		active = undefined;
	}

	function handleOutroEnd(): void {
		dismissing = false;
		showNext();
	}

	onMount(() => {
		const unregister = registerErrorNoticeHost(enqueue);

		return () => {
			unregister();
			if (timeout !== undefined) {
				window.clearTimeout(timeout);
			}
		};
	});
</script>

{#if active !== undefined}
	<section
		class="error-notice"
		role="alert"
		aria-live="assertive"
		aria-atomic="true"
		in:fly={enterTransition}
		out:fly={exitTransition}
		onoutroend={handleOutroEnd}
	>
		<p>{active}</p>
		<button type="button" aria-label="Dismiss error notification" onclick={dismiss}>
			<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
				<path
					d="M5 5L15 15M15 5L5 15"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
				/>
			</svg>
		</button>
	</section>
{/if}

<style>
	.error-notice {
		position: fixed;
		z-index: 1000;
		right: max(1rem, env(safe-area-inset-right));
		bottom: max(1rem, env(safe-area-inset-bottom));
		left: max(1rem, env(safe-area-inset-left));
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		width: min(34rem, auto);
		max-width: calc(100vw - 2rem);
		align-items: start;
		gap: 0.75rem;
		margin-inline: auto;
		border: 1px solid color-mix(in srgb, var(--danger) 55%, var(--border));
		border-radius: 0.65rem;
		background: color-mix(in srgb, var(--danger) 10%, var(--surface));
		box-shadow: 0 16px 34px var(--shadow);
		padding: 0.75rem;
		color: var(--text);
	}

	.error-notice p {
		margin: 0;
		min-width: 0;
		font-size: 0.82rem;
		line-height: 1.45;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	.error-notice button {
		display: grid;
		width: 1.8rem;
		height: 1.8rem;
		place-items: center;
		border: 1px solid transparent;
		border-radius: 0.42rem;
		background: transparent;
		color: var(--text-muted);
		padding: 0;
		transition:
			background 140ms ease,
			border-color 140ms ease,
			color 140ms ease;
	}

	.error-notice button:hover {
		border-color: var(--border-strong);
		background: var(--surface-strong);
		color: var(--text);
	}

	.error-notice button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.error-notice svg {
		width: 0.9rem;
		height: 0.9rem;
	}

	@media (prefers-reduced-motion: reduce) {
		.error-notice button {
			transition: none;
		}
	}
</style>

<script lang="ts">
	import { MediaQuery } from 'svelte/reactivity';
	import { fly } from 'svelte/transition';
	import type { TransientNotice } from '$lib/harness/types';

	type Props = {
		notices: TransientNotice[];
		onClear: () => void;
	};

	let { notices, onClear }: Props = $props();
	const reducedMotion = new MediaQuery('prefers-reduced-motion: reduce', false);
	let popupTransition = $derived({ y: 8, duration: reducedMotion.current ? 0 : 160 });
</script>

{#if notices.length}
	<section
		class="transient-notice-popup"
		role="status"
		aria-label="Session notices"
		aria-live="polite"
		aria-atomic="true"
		transition:fly|global={popupTransition}
	>
		<div class="notice-header">
			<div>
				<strong>Session notices</strong>
				<span>{notices.length} new</span>
			</div>
			<button
				type="button"
				aria-label="Clear all notices"
				title="Clear all notices"
				onclick={onClear}
			>
				<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
					<path
						d="M5 5L15 15M15 5L5 15"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
					/>
				</svg>
			</button>
		</div>

		<div class="notice-list">
			{#each notices as notice (notice.id)}
				<p>{notice.message}</p>
			{/each}
		</div>
	</section>
{/if}

<style>
	.transient-notice-popup {
		display: flex;
		width: 100%;
		max-height: min(21.75rem, 45dvh);
		flex-direction: column;
		margin: 0 0 1rem;
		overflow: hidden;
		border: 1px solid var(--border-strong);
		border-radius: 0.65rem;
		background: color-mix(in srgb, var(--surface-muted) 92%, var(--surface));
		box-shadow: 0 16px 34px var(--shadow);
	}

	.notice-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex: none;
		border-bottom: 1px solid var(--border);
		background: var(--surface-muted);
		padding: 0.5rem 0.6rem 0.5rem 0.75rem;
	}

	.notice-header > div {
		display: flex;
		align-items: baseline;
		min-width: 0;
		gap: 0.45rem;
	}

	.notice-header strong {
		color: var(--text);
		font-size: 0.76rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.notice-header span {
		color: var(--text-muted);
		font-size: 0.68rem;
	}

	.notice-header button {
		display: grid;
		width: 1.8rem;
		height: 1.8rem;
		place-items: center;
		flex: none;
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

	.notice-header button:hover {
		border-color: var(--border-strong);
		background: var(--surface-strong);
		color: var(--text);
	}

	.notice-header button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.notice-header svg {
		width: 0.9rem;
		height: 0.9rem;
	}

	.notice-list {
		min-height: 0;
		overflow-y: auto;
		padding: 0.2rem 0;
	}

	.notice-list p {
		margin: 0;
		border-bottom: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
		color: var(--text);
		padding: 0.5rem 0.75rem;
		font-size: 0.78rem;
		line-height: 1.45;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	.notice-list p:last-child {
		border-bottom: 0;
	}

	@media (max-width: 700px) {
		.transient-notice-popup {
			max-height: min(17rem, 38dvh);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.notice-header button {
			transition: none;
		}
	}
</style>

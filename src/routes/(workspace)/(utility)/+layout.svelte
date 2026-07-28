<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	let { children } = $props();
</script>

<section class="utility-view" role="tabpanel">
	<nav class="utility-nav" aria-label="Harness utility">
		<p class="eyebrow">Pi Squared</p>
		<a class:active={page.url.pathname === '/history'} href={resolve('/history')}
			>Historical sessions</a
		>
		<a class:active={page.url.pathname === '/settings'} href={resolve('/settings')}
			>Harness settings</a
		>
	</nav>

	<div class="utility-content">{@render children()}</div>
</section>

<style>
	.utility-view {
		display: grid;
		grid-template-columns: 13rem minmax(0, 1fr);
		min-height: 0;
	}

	.utility-nav {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 1.5rem 0.8rem;
		border-right: 1px solid var(--border);
		background: var(--surface-muted);
	}

	.utility-nav a {
		padding: 0.65rem 0.75rem;
		border: 1px solid transparent;
		border-radius: 0.35rem;
		color: var(--text-muted);
		text-decoration: none;
	}

	.utility-nav a:hover,
	.utility-nav a.active {
		border-color: var(--border);
		background: var(--surface);
		color: var(--text);
	}

	.utility-content {
		overflow: auto;
		padding: clamp(1.5rem, 5vw, 4.5rem);
	}

	.eyebrow {
		margin: 0 0 0.35rem;
		color: var(--accent);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	@media (max-width: 700px) {
		.utility-view {
			grid-template-columns: 1fr;
		}

		.utility-nav {
			flex-direction: row;
			align-items: center;
			overflow-x: auto;
			padding: 0.7rem;
			border-right: 0;
			border-bottom: 1px solid var(--border);
		}

		.utility-nav .eyebrow {
			display: none;
		}

		.utility-nav a {
			white-space: nowrap;
		}
	}
</style>

<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	let { children } = $props();
</script>

<section class="utility-view" role="tabpanel">
	<nav class="utility-nav" aria-label="Harness utility">
		<a
			class:active={page.url.pathname === '/history'}
			aria-current={page.url.pathname === '/history' ? 'page' : undefined}
			href={resolve('/history')}>Sessions</a
		>
		<a
			class:active={page.url.pathname === '/settings'}
			aria-current={page.url.pathname === '/settings' ? 'page' : undefined}
			href={resolve('/settings')}>Settings</a
		>
	</nav>

	<div class="utility-content">{@render children()}</div>
</section>

<style>
	.utility-view {
		min-height: 0;
		padding: clamp(1.5rem, 5vw, 4.5rem);
	}

	.utility-nav {
		display: flex;
		width: fit-content;
		gap: 0.2rem;
		margin: 0 auto clamp(1.75rem, 4vw, 3.25rem);
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface-muted);
		padding: 0.2rem;
	}

	.utility-nav a {
		border: 1px solid transparent;
		border-radius: 999px;
		padding: 0.4rem 0.8rem;
		color: var(--text-muted);
		font-size: 0.78rem;
		font-weight: 600;
		text-decoration: none;
	}

	.utility-nav a:hover,
	.utility-nav a.active {
		border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
		background: var(--surface);
		color: var(--text);
	}

	.utility-content {
		width: min(100%, 54rem);
		margin: 0 auto;
	}

	@media (max-width: 700px) {
		.utility-view {
			padding: 1.25rem 0.75rem;
		}

		.utility-nav {
			margin-bottom: 1.75rem;
		}
	}
</style>

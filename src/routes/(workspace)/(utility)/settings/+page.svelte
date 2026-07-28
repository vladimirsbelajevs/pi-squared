<script lang="ts">
	import { THEME_LABELS, workspace } from '$lib/harness/workspace.svelte';
	import type { Theme } from '$lib/harness/types';
</script>

<header class="section-heading">
	<p class="eyebrow">Local preferences</p>
	<h1>Harness settings</h1>
	<p>Visual preferences remain in this browser. Pi settings remain project-owned.</p>
</header>

<section class="settings-card" aria-labelledby="theme-heading">
	<div>
		<h2 id="theme-heading">Theme</h2>
		<p>Applies to tabs, history, settings, and every chat.</p>
	</div>
	<div class="theme-grid">
		{#each Object.entries(THEME_LABELS) as [value, label] (value)}
			<button
				class:chosen={workspace.theme === value}
				class={`theme-choice theme-${value}`}
				type="button"
				onclick={() => workspace.applyTheme(value as Theme)}
			>
				<span></span>{label}
			</button>
		{/each}
	</div>
</section>

<style>
	.section-heading {
		max-width: 54rem;
	}

	.section-heading h1 {
		margin: 0.2rem 0 0.55rem;
		font-size: clamp(2rem, 4vw, 3.2rem);
		line-height: 1.05;
		letter-spacing: -0.04em;
	}

	.section-heading p {
		margin: 0;
		color: var(--text-muted);
		line-height: 1.6;
	}

	.eyebrow {
		margin: 0 0 0.35rem;
		color: var(--accent);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.settings-card {
		display: grid;
		max-width: 54rem;
		gap: 1.5rem;
		margin-top: 2rem;
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		background: var(--surface);
		padding: 1.25rem;
	}

	.settings-card h2 {
		margin: 0;
		font-size: 1.2rem;
	}

	.settings-card p {
		margin: 0.25rem 0 0;
		color: var(--text-muted);
	}

	.theme-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 0.6rem;
	}

	.theme-choice {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--surface-muted);
		color: var(--text);
		padding: 0.65rem;
	}

	.theme-choice:hover,
	.theme-choice.chosen {
		border-color: var(--accent);
	}

	.theme-choice span {
		width: 1rem;
		height: 1rem;
		border-radius: 50%;
		background: var(--accent-strong);
	}

	.theme-paper span {
		border: 1px solid #aaa08e;
		background: #f0ebe0;
	}

	.theme-nord span {
		background: #88c0d0;
	}

	.theme-solarized span {
		background: #2aa198;
	}

	.theme-system span {
		background: linear-gradient(135deg, #111 50%, #f6f3ec 50%);
	}
</style>

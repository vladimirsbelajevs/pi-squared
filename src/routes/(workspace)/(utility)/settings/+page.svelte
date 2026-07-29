<script lang="ts">
	import { THEME_LABELS, workspace } from '$lib/harness/workspace.svelte';
	import type { Theme } from '$lib/harness/types';

	function handleShowReasoningChange(event: Event): void {
		workspace.setShowReasoning((event.currentTarget as HTMLInputElement).checked);
	}
</script>

<h1 class="visually-hidden">Settings</h1>

<section class="settings-card" aria-labelledby="theme-heading">
	<h2 id="theme-heading">Theme</h2>
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

<section class="settings-card" aria-labelledby="chat-display-heading">
	<h2 id="chat-display-heading">Chat display</h2>
	<label class="display-preference">
		<input type="checkbox" checked={workspace.showReasoning} onchange={handleShowReasoningChange} />
		<span>
			<strong>Show model reasoning</strong>
			<small>Display-only; it does not alter model reasoning level.</small>
		</span>
	</label>
</section>

<style>
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

	.settings-card {
		display: grid;
		width: min(100%, 38rem);
		gap: 1rem;
		margin: 0 auto;
	}

	.settings-card h2 {
		margin: 0;
		font-size: 1.2rem;
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

	.theme-everforest-dark-hard span {
		background: #7fbbb3;
	}

	.theme-everforest-dark-medium span {
		background: #83c092;
	}

	.theme-everforest-dark-soft span {
		background: #a7c080;
	}

	.theme-everforest-light-hard span,
	.theme-everforest-light-medium span,
	.theme-everforest-light-soft span {
		border: 1px solid #829181;
		background: #3a94c5;
	}

	.theme-system span {
		background: linear-gradient(135deg, #111 50%, #f6f3ec 50%);
	}

	.display-preference {
		display: flex;
		align-items: flex-start;
		gap: 0.65rem;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--surface-muted);
		padding: 0.75rem;
		color: var(--text);
		cursor: pointer;
	}

	.display-preference:hover {
		border-color: var(--accent);
	}

	.display-preference input {
		width: 1rem;
		height: 1rem;
		margin: 0.15rem 0 0;
		accent-color: var(--accent);
	}

	.display-preference input:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
	}

	.display-preference span {
		display: grid;
		gap: 0.2rem;
	}

	.display-preference small {
		color: var(--text-muted);
		font-size: 0.82rem;
	}
</style>

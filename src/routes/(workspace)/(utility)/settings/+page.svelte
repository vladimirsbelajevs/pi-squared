<script lang="ts">
	import Switch from '$lib/components/Switch.svelte';
	import { THEME_LABELS, workspace } from '$lib/harness/workspace.svelte';
	import type { Theme } from '$lib/harness/types';

	function handleShowReasoningChange(checked: boolean): void {
		workspace.setShowReasoning(checked);
	}

	function handleShowModelChangesChange(checked: boolean): void {
		workspace.setShowModelChanges(checked);
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
				aria-pressed={workspace.theme === value}
				onclick={() => workspace.applyTheme(value as Theme)}
			>
				<span></span>{label}
			</button>
		{/each}
	</div>
</section>

<section class="settings-card" aria-labelledby="chat-display-heading">
	<h2 id="chat-display-heading">Chat display</h2>
	<div class="display-preferences">
		<div class="display-preference">
			<div class="display-copy">
				<strong>Show model reasoning</strong>
				<small>Display-only; it does not alter model reasoning level.</small>
			</div>
			<Switch
				checked={workspace.showReasoning}
				label="Show model reasoning"
				onchange={handleShowReasoningChange}
			/>
		</div>
		<div class="display-preference">
			<div class="display-copy">
				<strong>Display model changes in chat</strong>
				<small>Show notices when the model or reasoning level changes.</small>
			</div>
			<Switch
				checked={workspace.showModelChanges}
				label="Display model changes in chat"
				onchange={handleShowModelChangesChange}
			/>
		</div>
	</div>
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

	.settings-card + .settings-card {
		padding-top: 2rem;
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
		flex: 0 0 1rem;
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

	.theme-tokyonight-night span,
	.theme-tokyonight-storm span {
		background: #7aa2f7;
	}

	.theme-tokyonight-moon span {
		background: #82aaff;
	}

	.theme-tokyonight-day span {
		border: 1px solid #4094a3;
		background: #2e7de9;
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

	.display-preferences {
		display: grid;
		gap: 1rem;
	}

	.display-preference {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		color: var(--text);
	}

	.display-copy {
		display: grid;
		gap: 0.2rem;
		min-width: 0;
	}

	.display-copy small {
		color: var(--text-muted);
		font-size: 0.82rem;
	}
</style>

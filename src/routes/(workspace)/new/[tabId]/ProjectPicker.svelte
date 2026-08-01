<script lang="ts">
	import { slide } from 'svelte/transition';
	import Selector from '$lib/components/Selector.svelte';
	import type { Project } from '$lib/contracts';
	import type { NewTab } from '$lib/harness/types';

	type Props = {
		tab: NewTab;
		projects: Project[];
		onProjectChange: (projectId: string) => void;
		onAddProject: (tab: NewTab) => Promise<boolean>;
	};

	let { tab = $bindable(), projects, onProjectChange, onAddProject }: Props = $props();

	async function addProject(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		await onAddProject(tab);
	}
</script>

<div class="project-row">
	<Selector
		label="Project"
		value={tab.draft.projectId}
		options={[
			{ value: '', label: 'Select an added project', disabled: true },
			...projects.map((project) => ({
				value: project.id,
				label: `${project.name} · ${project.cwd}`
			}))
		]}
		invalid={!tab.draft.projectId}
		onChange={onProjectChange}
	/>
	<button
		class="add-project-button"
		type="button"
		aria-label={tab.addingProject ? 'Cancel adding project' : 'Add project'}
		title={tab.addingProject ? 'Cancel adding project' : 'Add project'}
		onclick={() => (tab.addingProject = !tab.addingProject)}
	>
		{#if tab.addingProject}
			<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
				<path
					d="M5 5L15 15M15 5L5 15"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
				/>
			</svg>
		{:else}
			<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
				<path
					d="M10 4.5V15.5M4.5 10H15.5"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
				/>
			</svg>
		{/if}
	</button>
</div>

{#if tab.addingProject}
	<div class="add-project-panel" transition:slide={{ duration: 240 }}>
		<form onsubmit={addProject}>
			<label>
				<span>Absolute directory</span>
				<input bind:value={tab.projectPath} placeholder="/home/me/code/project" required />
			</label>
			<label>
				<span>Display name <em>optional</em></span>
				<input bind:value={tab.projectName} placeholder="Project name" />
			</label>
			{#if tab.projectError}<p class="form-error" role="alert">{tab.projectError}</p>{/if}
			<button class="add-project-submit" type="submit">
				<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
					<path
						d="M10 4.5V15.5M4.5 10H15.5"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
					/>
				</svg>
				Add project
			</button>
		</form>
	</div>
{/if}

<style>
	.project-row {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		margin-top: 0.65rem;
	}

	label {
		display: grid;
		gap: 0.4rem;
		color: var(--text-muted);
		font-size: 0.85rem;
	}

	label > span {
		color: var(--text);
		font-weight: 600;
	}

	label em {
		color: var(--text-muted);
		font-style: normal;
		font-weight: 400;
	}

	.add-project-button {
		display: grid;
		width: 1.9rem;
		height: 1.9rem;
		place-items: center;
		border: 1px solid var(--border);
		border-radius: 0.35rem;
		background: transparent;
		color: var(--accent);
		padding: 0;
	}

	.add-project-button:hover {
		border-color: var(--border-strong);
		background: var(--surface-muted);
	}

	.add-project-button svg {
		width: 1rem;
		height: 1rem;
	}

	.add-project-panel {
		margin-top: 0.75rem;
		border: 1px dashed var(--border-strong);
		border-radius: 0.65rem;
		background: var(--surface-muted);
		padding: 1rem;
	}

	.add-project-panel form {
		display: grid;
		gap: 0.8rem;
	}

	.add-project-submit {
		display: inline-flex;
		align-items: center;
		justify-self: end;
		gap: 0.35rem;
		height: 2rem;
		border: 1px solid var(--border);
		border-radius: 0.35rem;
		background: var(--surface-strong);
		color: var(--accent);
		padding: 0 0.65rem;
		font-size: 0.75rem;
		font-weight: 600;
	}

	.add-project-submit:hover {
		border-color: var(--border-strong);
		background: color-mix(in srgb, var(--surface-strong) 88%, var(--accent) 12%);
	}

	.add-project-submit svg {
		width: 0.9rem;
		height: 0.9rem;
	}

	.form-error {
		margin: 0;
		color: var(--danger);
		font-size: 0.9rem;
	}
</style>

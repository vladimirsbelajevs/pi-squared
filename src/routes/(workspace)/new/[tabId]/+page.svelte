<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { fly, slide } from 'svelte/transition';
	import ChatComposer from '$lib/components/ChatComposer.svelte';
	import { workspace } from '$lib/harness/workspace.svelte';

	let tabId = $derived(page.params.tabId ?? '');
	let tab = $derived(workspace.findNewTab(tabId));

	$effect(() => {
		workspace.ensureNewTab(tabId);
	});

	$effect(() => {
		if (tab) {
			workspace.schedulePersist(
				tab.draft.prompt,
				tab.draft.projectId,
				tab.draft.modelKey,
				tab.draft.thinkingLevel
			);
		}
	});

	async function startChat(message: string): Promise<boolean> {
		if (!tab) return false;
		const chat = await workspace.startChat(tab, message);
		if (!chat) return false;
		await goto(
			resolve(`/chat/${encodeURIComponent(chat.projectId)}/${encodeURIComponent(chat.sessionId)}`),
			{ replaceState: true }
		);
		return true;
	}

	async function addProject(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (tab) await workspace.addProject(tab);
	}
</script>

{#if tab}
	<section class="new-tab-view" role="tabpanel">
		<div class="new-chat-center" in:fly={{ y: 20, duration: 520 }}>
			<header class="new-chat-intro">
				<p class="eyebrow">New chat</p>
				<h1>What do you want to build?</h1>
			</header>

			<ChatComposer
				bind:draft={tab.draft.prompt}
				models={workspace.models}
				modelKey={tab.draft.modelKey}
				thinkingLevel={tab.draft.thinkingLevel}
				disabled={!tab.draft.projectId || !tab.draft.modelKey}
				error={tab.error}
				onSend={startChat}
				onModelChange={(key) => workspace.changeNewTabModel(tab, key)}
				onThinkingChange={(level) => {
					tab.draft.thinkingLevel = level;
					workspace.persist();
				}}
			/>

			<div class:missing={!tab.draft.projectId} class="project-row">
				<label>
					<span>Working project</span>
					<select bind:value={tab.draft.projectId} onchange={() => workspace.persist()}>
						<option value="" disabled>Select an added project</option>
						{#each workspace.projects as project (project.id)}
							<option value={project.id}>{project.name} · {project.cwd}</option>
						{/each}
					</select>
				</label>
				<button
					class="add-project-button"
					type="button"
					onclick={() => (tab.addingProject = !tab.addingProject)}
				>
					{tab.addingProject ? 'Cancel' : '+ Add project'}
				</button>
			</div>

			{#if tab.addingProject}
				<div class="add-project-panel" transition:slide={{ duration: 240 }}>
					<p>
						Added projects are trusted local workspaces. Pi can read, edit, and run commands there.
					</p>
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
						<button class="primary-button" type="submit">Add trusted project</button>
					</form>
				</div>
			{/if}
		</div>
	</section>
{/if}

<style>
	.new-tab-view {
		display: grid;
		place-items: center;
		overflow: auto;
		padding: clamp(1rem, 4vw, 3rem);
	}

	.new-chat-center {
		width: min(100%, 48rem);
		transform: translateY(-3vh);
	}

	.new-chat-intro {
		margin-bottom: 1.5rem;
		text-align: center;
	}

	.new-chat-intro h1 {
		margin: 0;
		font-size: clamp(1.7rem, 4vw, 2.65rem);
		font-weight: 500;
		letter-spacing: -0.035em;
		text-wrap: balance;
	}

	.eyebrow {
		margin: 0 0 0.35rem;
		color: var(--accent);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.project-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: end;
		gap: 0.7rem;
		margin-top: 0.85rem;
		padding: 0 0.25rem;
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

	.project-row label > span {
		color: var(--text-muted);
		font-size: 0.72rem;
		font-weight: 500;
	}

	.project-row select {
		padding: 0.55rem 0.65rem;
		background: var(--surface-muted);
		font-size: 0.8rem;
	}

	.project-row.missing select {
		border-color: color-mix(in srgb, var(--warning) 55%, var(--border));
	}

	.add-project-button {
		height: 2.45rem;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: transparent;
		color: var(--accent);
		padding: 0 0.8rem;
		font-size: 0.8rem;
		white-space: nowrap;
	}

	.add-project-button:hover {
		border-color: var(--border-strong);
		background: var(--surface-muted);
	}

	.add-project-panel {
		margin-top: 0.75rem;
		border: 1px dashed var(--border-strong);
		border-radius: 0.65rem;
		background: var(--surface-muted);
		padding: 1rem;
	}

	.add-project-panel > p {
		margin: 0;
		color: var(--warning);
		font-size: 0.85rem;
		line-height: 1.5;
	}

	.add-project-panel form {
		display: grid;
		gap: 0.8rem;
		margin-top: 1rem;
	}

	.primary-button {
		border: 1px solid transparent;
		border-radius: 0.35rem;
		background: var(--accent-strong);
		color: var(--accent-ink);
		padding: 0.7rem 1rem;
		font-weight: 700;
	}

	.primary-button:hover {
		filter: brightness(1.08);
	}

	.form-error {
		margin: 0;
		color: var(--danger);
		font-size: 0.9rem;
	}

	@media (max-width: 700px) {
		.new-chat-center {
			transform: none;
		}

		.project-row {
			grid-template-columns: 1fr;
		}

		.add-project-button {
			justify-self: start;
		}
	}
</style>

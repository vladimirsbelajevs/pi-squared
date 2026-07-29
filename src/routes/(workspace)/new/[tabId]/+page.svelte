<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { fade, fly, slide } from 'svelte/transition';
	import ChatComposer from '$lib/components/ChatComposer.svelte';
	import { workspace } from '$lib/harness/workspace.svelte';

	let tabId = $derived(page.params.tabId ?? '');
	let tab = $derived(workspace.findNewTab(tabId));
	let introReady = $state(false);

	function ensureNewTabForRoute(): void {
		const id = page.params.tabId;
		if (!id) return;
		workspace.ensureNewTab(id);
		workspace.rememberTabForPathname(page.url.pathname);
	}

	afterNavigate(ensureNewTabForRoute);
	onMount(() => {
		ensureNewTabForRoute();
		let restoreFrame: number | undefined;
		const introFrame = requestAnimationFrame(() => {
			introReady = true;
			const pathname = page.url.pathname;
			restoreFrame = requestAnimationFrame(() => {
				if (page.url.pathname !== pathname) return;
				const scrollContainer = document.getElementById('workspace-content');
				if (scrollContainer) scrollContainer.scrollTop = workspace.scrollPosition(pathname);
			});
		});
		return () => {
			cancelAnimationFrame(introFrame);
			if (restoreFrame) cancelAnimationFrame(restoreFrame);
		};
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
	{#key tab.id}
		<section class="new-tab-view" role="tabpanel">
			<div class="new-chat-center">
				{#if introReady}
					<header class="new-chat-intro" in:fly={{ y: -24, duration: 800 }}>
						<h1>Pi²</h1>
					</header>

					<div class="composer-wrap" in:fly={{ y: 24, duration: 800, delay: 200 }}>
						<ChatComposer
							bind:draft={tab.draft.prompt}
							projectId={tab.draft.projectId}
							showStatusPanel={false}
							models={workspace.models}
							modelKey={tab.draft.modelKey}
							thinkingLevel={tab.draft.thinkingLevel}
							disabled={!tab.draft.projectId || !tab.draft.modelKey}
							error={tab.error}
							onSend={startChat}
							onDraftChange={() => workspace.schedulePersist()}
							onModelChange={(key) => workspace.changeNewTabModel(tab, key)}
							onThinkingChange={(level) => workspace.changeNewTabThinking(tab, level)}
						/>
					</div>

					<div
						class:missing={!tab.draft.projectId}
						class="project-row"
						in:fade={{ duration: 240, delay: 1000 }}
					>
						<label class="project-picker">
							<span>Project</span>
							<select
								class="dropdown"
								value={tab.draft.projectId}
								onchange={(event) => workspace.selectNewTabProject(tab, event.currentTarget.value)}
							>
								<option value="" disabled>Select an added project</option>
								{#each workspace.projects as project (project.id)}
									<option value={project.id}>{project.name} · {project.cwd}</option>
								{/each}
							</select>
						</label>
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
									<input
										bind:value={tab.projectPath}
										placeholder="/home/me/code/project"
										required
									/>
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
				{/if}
			</div>
		</section>
	{/key}
{/if}

<style>
	.new-tab-view {
		display: grid;
		min-height: 100%;
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

	.composer-wrap {
		width: 100%;
	}

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

	.project-picker {
		display: flex;
		align-items: center;
		min-width: 0;
	}

	.project-picker span {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
	}

	.project-picker select {
		width: auto;
		max-width: 18rem;
	}

	.project-row.missing .project-picker select {
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warning) 55%, transparent);
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

	.add-project-panel > p {
		margin: 0;
		color: var(--warning);
		font-size: 0.85rem;
		line-height: 1.5;
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

	@media (max-width: 700px) {
		.new-chat-center {
			transform: none;
		}

		.project-picker select {
			max-width: min(16rem, calc(100vw - 6rem));
		}
	}
</style>

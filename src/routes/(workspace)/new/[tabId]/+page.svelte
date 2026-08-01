<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import ChatComposer from '$lib/components/ChatComposer/ChatComposer.svelte';
	import ProjectPicker from './ProjectPicker.svelte';
	import type { ChatSubmission } from '$lib/contracts';
	import { workspace } from '$lib/harness/workspace.svelte';

	let tabId = $derived(page.params.tabId ?? '');
	let tab = $derived(workspace.findNewTab(tabId));
	let introReady = $state(false);

	function ensureNewTabForRoute(): void {
		const id = page.params.tabId;
		if (!id) {
			return;
		}

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
				if (page.url.pathname !== pathname) {
					return;
				}

				const scrollContainer = document.getElementById('workspace-content');
				if (scrollContainer) {
					scrollContainer.scrollTop = workspace.scrollPosition(pathname);
				}
			});
		});

		return () => {
			cancelAnimationFrame(introFrame);
			if (restoreFrame) {
				cancelAnimationFrame(restoreFrame);
			}
		};
	});

	async function startChat(submission: ChatSubmission): Promise<boolean> {
		if (!tab) {
			return false;
		}

		const chat = await workspace.startChat(tab, submission);
		if (!chat) {
			return false;
		}

		await goto(
			resolve(`/chat/${encodeURIComponent(chat.projectId)}/${encodeURIComponent(chat.sessionId)}`),
			{ replaceState: true }
		);

		return true;
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
							onSend={startChat}
							onDraftChange={() => workspace.schedulePersist()}
							onModelChange={(key) => workspace.changeNewTabModel(tab!, key)}
							onThinkingChange={(level) => workspace.changeNewTabThinking(tab!, level)}
						/>
					</div>

					<div in:fade={{ duration: 240, delay: 1000 }}>
						<ProjectPicker
							bind:tab
							projects={workspace.projects}
							onProjectChange={(projectId) => workspace.selectNewTabProject(tab!, projectId)}
							onAddProject={(project) => workspace.addProject(project)}
						/>
					</div>
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

	@media (max-width: 700px) {
		.new-chat-center {
			transform: none;
		}
	}
</style>

<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { fly } from 'svelte/transition';
	import ChatComposer from '$lib/components/ChatComposer.svelte';
	import ChatTimeline from '$lib/components/ChatTimeline.svelte';
	import PermissionApproval from '$lib/components/PermissionApproval.svelte';
	import { workspace } from '$lib/harness/workspace.svelte';

	let projectId = $derived(page.params.projectId ?? '');
	let sessionId = $derived(page.params.sessionId ?? '');
	let chat = $derived(workspace.findChat(projectId, sessionId));

	$effect(() => {
		void workspace.ensureChat(projectId, sessionId);
	});

	$effect(() => {
		if (chat) workspace.schedulePersist(chat.draft, chat.queueMode);
	});
</script>

{#if !chat || chat.hydrating}
	<section class="route-state">Opening session…</section>
{:else if !chat.snapshot}
	<section class="route-state route-error" role="alert">
		{chat.error || 'This project session could not be opened.'}
		<a href={resolve('/history')}>Back to history</a>
	</section>
{:else}
	<section class="chat-view" role="tabpanel">
		<div class="chat-scroll">
			<ChatTimeline {chat} />
		</div>

		<div class="thread-composer-dock" in:fly={{ y: 18, duration: 420 }}>
			{#each chat.permissionRequests as request (request.id)}
				<PermissionApproval
					{request}
					onSelect={(request, value) => workspace.respondToPermission(chat, request, value)}
					onConfirm={(request, confirmed) => workspace.confirmPermission(chat, request, confirmed)}
					onCancel={(request) => workspace.cancelPermission(chat, request)}
				/>
			{/each}
			<div class="thread-project" title={chat.snapshot.project.cwd}>
				<span class="project-dot"></span>{chat.snapshot.project.name}
			</div>
			<ChatComposer
				bind:draft={chat.draft}
				models={workspace.models}
				modelKey={chat.snapshot.model
					? `${chat.snapshot.model.provider}::${chat.snapshot.model.id}`
					: ''}
				thinkingLevel={chat.snapshot.thinkingLevel}
				queueMode={chat.queueMode}
				isStreaming={chat.snapshot.isStreaming}
				autoFocus
				error={chat.error}
				onSend={(message) => workspace.sendPrompt(chat, message)}
				onStop={() => workspace.stopChat(chat)}
				onModelChange={(key) => workspace.changeModel(chat, key)}
				onThinkingChange={(level) => workspace.changeThinking(chat, level)}
				onQueueModeChange={(mode) => {
					chat.queueMode = mode;
					workspace.persist();
				}}
			/>
		</div>
	</section>
{/if}

<style>
	.chat-view {
		display: grid;
		grid-template-rows: minmax(0, 1fr) auto;
		min-height: 0;
	}

	.chat-scroll {
		overflow: auto;
		padding: 1.5rem max(1rem, calc((100vw - 54rem) / 2)) 2rem;
	}

	.thread-composer-dock {
		position: relative;
		z-index: 2;
		padding: 1.65rem max(1rem, calc((100vw - 54rem) / 2)) calc(1rem + env(safe-area-inset-bottom));
		background: linear-gradient(180deg, transparent, var(--canvas) 28%, var(--canvas));
	}

	.thread-project {
		display: flex;
		align-items: center;
		max-width: 54rem;
		gap: 0.4rem;
		margin: 0 auto 0.45rem;
		color: var(--text-muted);
		font-size: 0.7rem;
	}

	.project-dot {
		width: 0.42rem;
		height: 0.42rem;
		border-radius: 50%;
		background: var(--success);
	}

	.route-state {
		display: grid;
		place-content: center;
		min-height: 0;
		color: var(--text-muted);
	}

	.route-error {
		color: var(--danger);
	}

	.route-error a {
		color: var(--accent);
	}

	@media (max-width: 700px) {
		.thread-composer-dock {
			padding-inline: 0.75rem;
		}
	}
</style>

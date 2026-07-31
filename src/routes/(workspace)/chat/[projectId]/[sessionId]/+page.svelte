<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { fly } from 'svelte/transition';
	import ChatComposer from '$lib/components/ChatComposer/ChatComposer.svelte';
	import type { ChatSubmission } from '$lib/contracts';
	import { workspace } from '$lib/harness/workspace.svelte';
	import ChatTimeline from './ChatTimeline.svelte';
	import PermissionApproval from './PermissionApproval.svelte';
	import TransientNoticePopup from './TransientNoticePopup.svelte';

	let projectId = $derived(page.params.projectId ?? '');
	let sessionId = $derived(page.params.sessionId ?? '');
	let chat = $derived(workspace.findChat(projectId, sessionId));
	let scrollContainer: HTMLElement | undefined;
	let observedChatId: string | undefined;
	let observedContentKey: string | undefined;
	let scrollAfterUpdate = false;
	let contentKey = $derived.by(() => {
		if (!chat?.snapshot) return undefined;
		return JSON.stringify({
			items: chat.snapshot.items.map((item) => [
				item.id,
				item.attachments?.map((attachment) => [
					attachment.id,
					attachment.kind,
					attachment.name,
					attachment.mimeType,
					attachment.size,
					attachment.data
				])
			]),
			isStreaming: chat.snapshot.isStreaming,
			pendingMessages: chat.pendingUserMessages.map((message) => [
				message.id,
				message.text,
				message.attachments.map((attachment) => [
					attachment.id,
					attachment.kind,
					attachment.name,
					attachment.mimeType,
					attachment.size,
					attachment.data
				])
			]),
			streamText: chat.streamText,
			streamThinking: workspace.showReasoning ? chat.streamThinking : '',
			streamTools: chat.streamTools.map((tool) => [tool.id, tool.text, tool.isError])
		});
	});

	function ensureChatForRoute(): void {
		const projectId = page.params.projectId;
		const sessionId = page.params.sessionId;
		if (!projectId || !sessionId) return;
		void workspace.ensureChat(projectId, sessionId);
		workspace.rememberTabForPathname(page.url.pathname);
	}

	afterNavigate(ensureChatForRoute);
	onMount(() => {
		scrollContainer = document.getElementById('workspace-content') ?? undefined;
		ensureChatForRoute();
	});

	$effect.pre(() => {
		scrollAfterUpdate = false;
		if (!chat?.snapshot || !contentKey) return;
		if (chat.id !== observedChatId) {
			observedChatId = chat.id;
			observedContentKey = contentKey;
			return;
		}
		if (contentKey === observedContentKey) return;
		observedContentKey = contentKey;
		if (!scrollContainer) return;
		const isPinnedToBottom =
			scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < 24;
		scrollAfterUpdate = isPinnedToBottom;
	});

	$effect(() => {
		const activeChat = chat;
		const currentContentKey = contentKey;
		if (
			!scrollAfterUpdate ||
			!activeChat?.snapshot ||
			!currentContentKey ||
			activeChat.id !== observedChatId ||
			currentContentKey !== observedContentKey ||
			!scrollContainer
		)
			return;
		scrollAfterUpdate = false;
		scrollContainer.scrollTop = scrollContainer.scrollHeight;
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
			<ChatTimeline
				{chat}
				showReasoning={workspace.showReasoning}
				showModelChanges={workspace.showModelChanges}
			/>
		</div>

		<div class="thread-composer-dock" in:fly={{ y: 24, duration: 800, delay: 200 }}>
			<ChatComposer
				bind:draft={chat.draft}
				projectId={chat.snapshot.project.id}
				projectName={chat.snapshot.project.name}
				projectCwd={chat.snapshot.project.cwd}
				runtimeId={chat.snapshot.runtimeId}
				models={workspace.models}
				modelKey={chat.snapshot.model
					? `${chat.snapshot.model.provider}::${chat.snapshot.model.id}`
					: ''}
				thinkingLevel={chat.snapshot.thinkingLevel}
				queueMode={chat.queueMode}
				isStreaming={chat.snapshot.isStreaming}
				autoFocus
				error={chat.error}
				mcpStatus={chat.snapshot.mcpStatus}
				contextUsage={chat.snapshot.contextUsage}
				sessionTokens={chat.snapshot.sessionTokens}
				onMcpToggle={(serverName, enabled) =>
					workspace.setMcpServerEnabled(chat, serverName, enabled)}
				onSend={(submission: ChatSubmission) => workspace.sendPrompt(chat, submission)}
				onDraftChange={() => workspace.schedulePersist()}
				onStop={() => workspace.stopChat(chat)}
				onModelChange={(key) => workspace.changeModel(chat, key)}
				onThinkingChange={(level) => workspace.changeThinking(chat, level)}
				onQueueModeChange={(mode) => {
					chat.queueMode = mode;
					workspace.persist();
				}}
			>
				{#snippet overlay()}
					<TransientNoticePopup
						notices={chat.transientNotices}
						onClear={() => workspace.clearTransientNotices(chat)}
					/>
					{#each chat.permissionRequests as request (request.id)}
						<PermissionApproval
							{request}
							onSelect={(request, value) => workspace.respondToPermission(chat, request, value)}
							onConfirm={(request, confirmed) =>
								workspace.confirmPermission(chat, request, confirmed)}
							onCancel={(request) => workspace.cancelPermission(chat, request)}
						/>
					{/each}
				{/snippet}
			</ChatComposer>
		</div>
	</section>
{/if}

<style>
	.chat-view {
		position: relative;
		display: flex;
		min-height: 100%;
		flex-direction: column;
	}

	.chat-scroll {
		flex: 1;
		padding: 1.5rem max(1rem, calc((100vw - 54rem) / 2)) 2rem;
	}

	.thread-composer-dock {
		position: sticky;
		bottom: 0;
		width: 100%;
		flex-shrink: 0;
		z-index: 2;
		padding: 1.65rem max(1rem, calc((100vw - 54rem) / 2)) calc(1rem + env(safe-area-inset-bottom));
		background: linear-gradient(180deg, transparent, var(--canvas) 28%, var(--canvas));
	}

	.route-state {
		display: grid;
		place-content: center;
		min-height: 100%;
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

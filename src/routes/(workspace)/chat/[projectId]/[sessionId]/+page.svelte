<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { fly } from 'svelte/transition';
	import ChatComposer from '$lib/components/ChatComposer/ChatComposer.svelte';
	import type { ChatSubmission } from '$lib/contracts';
	import { workspace } from '$lib/harness/workspace.svelte';
	import { getWorkspaceScrollController } from '$lib/workspace-scroll';
	import ChatTimeline from './ChatTimeline.svelte';
	import PermissionApproval from './PermissionApproval.svelte';
	import TransientNoticePopup from './TransientNoticePopup.svelte';

	const scrollController = getWorkspaceScrollController();
	let projectId = $derived(page.params.projectId ?? '');
	let sessionId = $derived(page.params.sessionId ?? '');
	let chat = $derived(workspace.findChat(projectId, sessionId));
	function ensureChatForRoute(): void {
		const projectId = page.params.projectId;
		const sessionId = page.params.sessionId;
		if (!projectId || !sessionId) {
			return;
		}

		void workspace.ensureChat(projectId, sessionId);
		workspace.rememberTabForPathname(page.url.pathname);
	}

	afterNavigate(ensureChatForRoute);
	onMount(ensureChatForRoute);
</script>

{#if !chat || chat.hydrationState === 'unhydrated' || chat.hydrationState === 'hydrating'}
	<section class="route-state">Opening session…</section>
{:else if chat.hydrationState === 'failed' || !chat.snapshot}
	<section class="route-state route-error" role="alert">
		{chat.error || 'This project session could not be opened.'}
		<a href={resolve('/history')}>Back to history</a>
	</section>
{:else}
	<section class="chat-view">
		<div class="chat-content">
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
				mcpStatus={chat.snapshot.mcpStatus}
				contextUsage={chat.snapshot.contextUsage}
				sessionTokens={chat.snapshot.sessionTokens}
				onMcpToggle={(serverName, enabled) =>
					workspace.setMcpServerEnabled(chat, serverName, enabled)}
				onSend={(submission: ChatSubmission) => {
					scrollController.captureScrollBeforeContentChange(`tab:${chat.id}`);

					return workspace.sendPrompt(chat, submission);
				}}
				onDraftChange={() => workspace.schedulePersist()}
				onStop={() => workspace.stopChat(chat)}
				onModelChange={(key) => workspace.changeModel(chat, key)}
				onThinkingChange={(level) => workspace.changeThinking(chat, level)}
				onQueueModeChange={(mode) => workspace.setQueueMode(chat, mode)}
			>
				{#snippet overlay()}
					<TransientNoticePopup
						notices={chat.transientNotices}
						onClear={() => workspace.clearTransientNotices(chat)}
					/>
					<PermissionApproval
						requests={chat.permissionRequests}
						onSelect={(request, value) => workspace.respondToPermission(chat, request, value)}
						onConfirm={(request, confirmed) =>
							workspace.confirmPermission(chat, request, confirmed)}
						onCancel={(request) => workspace.cancelPermission(chat, request)}
					/>
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

	.chat-content {
		width: min(100%, 54rem);
		flex: 1;
		align-self: center;
		min-width: 0;
		padding: 1.5rem 0 2rem;
	}

	.thread-composer-dock {
		position: sticky;
		bottom: 0;
		width: min(100%, 54rem);
		align-self: center;
		flex-shrink: 0;
		z-index: 2;
		padding: 1.65rem 0 calc(1rem + env(safe-area-inset-bottom));
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
		.chat-content,
		.thread-composer-dock {
			padding-inline: 0.75rem;
		}
	}
</style>

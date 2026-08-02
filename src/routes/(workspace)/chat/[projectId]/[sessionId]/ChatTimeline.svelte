<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { on } from 'svelte/events';
	import type { ChatItem } from '$lib/contracts';
	import { buildFinalizedTimeline } from '$lib/harness/timeline';
	import type { ChatTab } from '$lib/harness/types';
	import { renderAssistantMarkdown, renderStreamingMarkdown } from '$lib/markdown';
	import AttachmentPreview from '$lib/components/AttachmentPreview.svelte';
	import ImageViewer, { type ImageViewerImage } from '$lib/components/ImageViewer.svelte';
	import ToolGroup, { type ToolGroupTool } from './ToolGroup.svelte';
	import { SvelteSet } from 'svelte/reactivity';

	type Props = { chat: ChatTab; showReasoning?: boolean; showModelChanges?: boolean };
	let { chat, showReasoning = false, showModelChanges = false }: Props = $props();
	let copiedMessageId = $state<string>();
	let copyError = $state<string>();
	let copiedMessageTimer: ReturnType<typeof setTimeout> | undefined;
	const copiedCodeTimers = new WeakMap<HTMLButtonElement, ReturnType<typeof setTimeout>>();
	let hoveredMessageId = $state<string>();
	let selectedImage = $state<ImageViewerImage>();
	const expandedToolIds = new SvelteSet<string>();
	let waitingForResponse = $derived(
		chat.snapshot?.isStreaming === true &&
			(!showReasoning || !chat.streamThinking) &&
			!chat.streamText &&
			chat.streamTools.length === 0 &&
			chat.permissionRequests.length === 0
	);
	let timeline = $derived.by(() =>
		buildFinalizedTimeline(chat.snapshot?.items ?? [], chat.pendingUserMessages, showModelChanges)
	);
	let finalizedToolCallIds = $derived(
		new Set(
			timeline.flatMap((entry) =>
				entry.kind === 'tools' ? entry.tools.map((tool) => tool.id) : []
			)
		)
	);
	let liveTools = $derived(chat.streamTools.filter((tool) => !finalizedToolCallIds.has(tool.id)));

	function liveToolForCallId(callId: string) {
		return chat.streamToolsByCallId?.get(callId);
	}

	function liveToolGroupTools(): ToolGroupTool[] {
		return liveTools.map((tool) => ({
			id: tool.id,
			name: tool.name,
			status: tool.status ?? 'running',
			arguments: tool.arguments,
			hasResult: true,
			resultText: tool.text
		}));
	}

	function formatTimestamp(timestamp: string | undefined): string | undefined {
		if (!timestamp) {
			return undefined;
		}

		const date = new Date(timestamp);
		if (Number.isNaN(date.getTime())) {
			return undefined;
		}

		return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
	}

	function formatTimestampTitle(timestamp: string): string {
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(timestamp));
	}

	function openImageViewer(image: ImageViewerImage): void {
		selectedImage = image;
	}

	function modelName(item: ChatItem): string | undefined {
		return item.modelName ?? chat.snapshot?.model?.name;
	}

	async function copyText(text: string, fallbackError: string): Promise<boolean> {
		try {
			if (!navigator.clipboard?.writeText) {
				throw new Error('Clipboard access is unavailable.');
			}

			await navigator.clipboard.writeText(text);
			copyError = undefined;

			return true;
		} catch (error) {
			copyError = error instanceof Error ? error.message : fallbackError;

			return false;
		}
	}

	async function copyMessage(item: ChatItem): Promise<void> {
		if (!item.text || !(await copyText(item.text, 'Unable to copy the message.'))) {
			return;
		}

		copiedMessageId = item.id;
		if (copiedMessageTimer) {
			clearTimeout(copiedMessageTimer);
		}

		copiedMessageTimer = setTimeout(() => {
			copiedMessageId = undefined;
		}, 1600);
	}

	async function copyCodeBlock(button: HTMLButtonElement, code: string): Promise<void> {
		if (!(await copyText(code, 'Unable to copy the code.'))) {
			return;
		}

		const previousTimer = copiedCodeTimers.get(button);
		if (previousTimer) {
			clearTimeout(previousTimer);
		}

		button.classList.add('copied');
		button.setAttribute('aria-label', 'Copied code');
		button.title = 'Copied code';
		copiedCodeTimers.set(
			button,
			setTimeout(() => {
				button.classList.remove('copied');
				button.setAttribute('aria-label', 'Copy code');
				button.title = 'Copy code';
				copiedCodeTimers.delete(button);
			}, 1600)
		);
	}

	function codeCopyControls(container: HTMLElement): () => void {
		return on(container, 'click', (event) => {
			if (!(event.target instanceof Element)) {
				return;
			}

			const button = event.target.closest<HTMLButtonElement>('button[data-code-copy]');
			if (!button || !container.contains(button)) {
				return;
			}

			const code = button
				.closest<HTMLElement>('[data-code-block]')
				?.querySelector<HTMLElement>('pre > code')?.textContent;
			if (code === undefined || code === null) {
				return;
			}

			void copyCodeBlock(button, code);
		});
	}
</script>

{#if chat.snapshot?.modelFallbackMessage}
	<p class="fallback-error">{chat.snapshot.modelFallbackMessage}</p>
{/if}

{#if copyError}
	<p class="copy-error" role="alert">{copyError}</p>
{/if}

{#each timeline as entry (entry.id)}
	{#if entry.kind === 'stopped'}
		<p class="stopped-row" role="status">Stopped</p>
	{:else if entry.kind === 'tools'}
		<ToolGroup
			chatId={chat.id}
			finalizedTools={entry.tools}
			{liveToolForCallId}
			thinking={entry.thinking}
			{showReasoning}
			{expandedToolIds}
		/>
	{:else if entry.item.kind === 'notice'}
		<p class="timeline-notice">{entry.item.text}</p>
	{:else}
		{@const item = entry.item}
		{@const role = item.role ?? 'assistant'}
		{@const isConversational = role === 'user' || role === 'assistant'}
		{@const timestamp = formatTimestamp(item.timestamp)}
		{@const showMessageMeta = hoveredMessageId === item.id}
		<div
			class={`message-entry message-entry-${role}`}
			role="group"
			aria-label={`${role} message`}
			onmouseenter={() => (hoveredMessageId = item.id)}
			onmouseleave={() => {
				if (hoveredMessageId === item.id) {
					hoveredMessageId = undefined;
				}
			}}
		>
			<article class={['message', `message-${role}`, isConversational && 'message-conversational']}>
				{#if !isConversational}
					<header>{item.label || role}</header>
				{/if}
				{#if showReasoning && entry.thinking}
					<details class="thinking">
						<summary>Reasoning</summary>
						<pre>{entry.thinking}</pre>
					</details>
				{/if}
				{#if item.text}
					{#if item.role === 'assistant'}
						{@const markdown = renderAssistantMarkdown(item.text)}
						<!-- eslint-disable-next-line svelte/no-at-html-tags -- markdown-it output is constrained in $lib/markdown -->
						<div class="message-markdown" {@attach codeCopyControls}>{@html markdown}</div>
					{:else}
						<pre class="message-text">{item.text}</pre>
					{/if}
				{/if}
			</article>
			{#if item.attachments?.length}
				<ul class="message-attachments" aria-label={`${role} attachments`}>
					{#each item.attachments as attachment (attachment.id)}
						<AttachmentPreview {attachment} onOpen={openImageViewer} />
					{/each}
				</ul>
			{/if}
			{#if item.role === 'user' || item.role === 'assistant'}
				<div class="message-meta-row">
					{#if showMessageMeta}
						<div
							class="message-meta-content"
							in:fly={{ y: -3, duration: 140 }}
							out:fade={{ duration: 100 }}
						>
							{#if item.role === 'assistant' && modelName(item)}
								<span>{modelName(item)}</span>
							{/if}
							{#if item.role === 'assistant' && chat.snapshot?.thinkingLevel}
								<span>-</span>
								<span>{chat.snapshot.thinkingLevel}</span>
							{/if}
							{#if timestamp && item.timestamp}
								<time datetime={item.timestamp} title={formatTimestampTitle(item.timestamp)}
									>{timestamp}</time
								>
							{/if}
							{#if item.text}
								<button
									class:copied={copiedMessageId === item.id}
									class="copy-action"
									type="button"
									aria-label={copiedMessageId === item.id ? 'Copied message' : 'Copy message'}
									title="Copy message"
									onclick={() => copyMessage(item)}
								>
									<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
										<rect
											x="7"
											y="6"
											width="8"
											height="9"
											rx="1.25"
											stroke="currentColor"
											stroke-width="1.5"
										/>
										<path
											d="M5 12V5.25C5 4.56 5.56 4 6.25 4H12"
											stroke="currentColor"
											stroke-width="1.5"
											stroke-linecap="round"
										/>
									</svg>
									<span>{copiedMessageId === item.id ? 'Copied' : 'Copy'}</span>
								</button>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
{/each}

{#if liveTools.length}
	<ToolGroup chatId={chat.id} tools={liveToolGroupTools()} {showReasoning} {expandedToolIds} />
{/if}

{#if waitingForResponse}
	<div class="thinking-indicator" role="status">
		<span>Pi is thinking</span>
		<span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>
	</div>
{/if}

{#if (showReasoning && chat.streamThinking) || chat.streamText}
	<article
		class="message message-assistant streaming"
		role="group"
		aria-label="assistant message, streaming"
	>
		{#if showReasoning && chat.streamThinking}
			<details class="thinking" open>
				<summary>Reasoning</summary>
				<pre>{chat.streamThinking}</pre>
			</details>
		{/if}
		{#if chat.streamRenderedText}
			{@const markdown = renderStreamingMarkdown(chat.streamRenderedText)}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- markdown-it output is constrained in $lib/markdown -->
			<div class="message-markdown">{@html markdown}</div>
		{/if}
	</article>
{/if}

<ImageViewer bind:image={selectedImage} />

<style>
	.fallback-error {
		width: min(54rem, 100%);
		margin: 0 auto 1rem;
		color: var(--danger);
		font-size: 0.9rem;
	}

	.copy-error {
		width: min(54rem, 100%);
		margin: 0 auto 1rem;
		color: var(--danger);
		font-size: 0.82rem;
	}

	.message-entry,
	.timeline-notice,
	.stopped-row {
		content-visibility: auto;
		contain-intrinsic-size: auto 240px;
	}

	.message-entry {
		max-width: 54rem;
		margin: 0 auto 1rem;
	}

	.message {
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 0.55rem;
		background: var(--surface);
	}

	.message-attachments {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		margin: 0.45rem 0 0;
		padding: 0;
		list-style: none;
	}

	.message header {
		display: flex;
		justify-content: space-between;
		padding: 0.45rem 0.75rem;
		border-bottom: 1px solid var(--border);
		color: var(--text-muted);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.message-meta-row {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		height: 1.75rem;
	}

	.message-meta-content {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.3rem;
		color: var(--text-muted);
		font-size: 0.72rem;
		white-space: nowrap;
	}

	.copy-action {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		border: 0;
		border-radius: 0.25rem;
		background: transparent;
		color: inherit;
		padding: 0.2rem;
		font: inherit;
	}

	.copy-action:hover:not(:disabled),
	.copy-action:focus-visible,
	.copy-action.copied {
		background: var(--surface-muted);
		color: var(--text);
	}

	.copy-action:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}

	.copy-action svg {
		width: 0.9rem;
		height: 0.9rem;
	}

	.message-entry-user {
		margin-left: max(0px, calc((100% - 54rem) / 2 + 7rem));
	}

	.message-user {
		background: color-mix(in srgb, var(--accent-strong) 12%, var(--surface));
	}

	.message-assistant {
		border: 0;
		border-radius: 0;
		background: transparent;
	}

	.message-tool,
	.message-bash {
		background: var(--surface-muted);
	}

	.message-error {
		border-color: var(--danger);
	}

	.message-markdown {
		color: var(--text);
		overflow-wrap: anywhere;
		padding: 0;
		font-size: 0.92rem;
		line-height: 1.6;
	}

	.message-markdown :global(h1),
	.message-markdown :global(h2),
	.message-markdown :global(h3),
	.message-markdown :global(h4),
	.message-markdown :global(h5),
	.message-markdown :global(h6) {
		margin: 1.2rem 0 0.55rem;
		color: var(--text);
		font-weight: 700;
		line-height: 1.25;
	}

	.message-markdown :global(h1) {
		font-size: 1.4rem;
	}

	.message-markdown :global(h2) {
		font-size: 1.2rem;
	}

	.message-markdown :global(h3),
	.message-markdown :global(h4),
	.message-markdown :global(h5),
	.message-markdown :global(h6) {
		font-size: 1rem;
	}

	.message-markdown :global(p) {
		margin: 0.75rem 0;
	}

	.message-markdown :global(ol),
	.message-markdown :global(ul) {
		margin: 0.75rem 0;
		padding-left: 1.5rem;
	}

	.message-markdown :global(li + li) {
		margin-top: 0.25rem;
	}

	.message-markdown :global(blockquote) {
		margin: 0.85rem 0;
		border-left: 0.2rem solid var(--accent);
		background: var(--surface-muted);
		color: var(--text-muted);
		padding: 0.1rem 0.8rem;
	}

	.message-markdown :global(blockquote p) {
		margin: 0.65rem 0;
	}

	.message-markdown :global(a) {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}

	.message-markdown :global(a:hover),
	.message-markdown :global(a:focus-visible) {
		color: var(--accent-strong);
	}

	.message-markdown :global(code) {
		border: 1px solid var(--border);
		border-radius: 0.25rem;
		background: var(--surface-muted);
		padding: 0.08rem 0.3rem;
		font:
			0.85em ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
	}

	.message-markdown :global(pre) {
		max-width: 100%;
		margin: 0.9rem 0;
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--surface-muted);
		padding: 0.75rem;
		color: var(--text);
		font:
			0.85rem/1.55 ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
		white-space: pre;
	}

	.message-markdown :global(.markdown-code-block) {
		margin: 0.9rem 0;
		position: relative;
	}

	.message-markdown :global(.markdown-code-block > pre) {
		margin: 0;
		padding-right: 2.8rem;
	}

	.message-markdown :global(.code-copy-action) {
		position: absolute;
		top: 0.45rem;
		right: 0.45rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: 0.25rem;
		background: transparent;
		color: var(--text-muted);
		padding: 0.25rem;
		opacity: 0;
		transition: opacity 160ms ease;
	}

	.message-markdown :global(.markdown-code-block:hover .code-copy-action),
	.message-markdown :global(.code-copy-action:focus-visible) {
		opacity: 1;
	}

	.message-markdown :global(.code-copy-action:hover:not(:disabled)),
	.message-markdown :global(.code-copy-action:focus-visible),
	.message-markdown :global(.code-copy-action.copied) {
		background: var(--surface);
		color: var(--text);
	}

	.message-markdown :global(.code-copy-action svg) {
		width: 1.35rem;
		height: 1.35rem;
	}

	.message-markdown :global(pre code) {
		border: 0;
		border-radius: 0;
		background: transparent;
		padding: 0;
		font: inherit;
	}

	.message-markdown :global(pre code .hljs-keyword) {
		color: var(--accent);
	}

	.message-markdown :global(pre code .hljs-string) {
		color: var(--success);
	}

	.message-markdown :global(pre code .hljs-comment) {
		color: var(--text-muted);
		font-style: italic;
	}

	.message-markdown :global(pre code .hljs-title) {
		color: var(--accent-strong);
	}

	.message-markdown :global(pre code .hljs-built_in) {
		color: var(--warning);
	}

	.message-markdown :global(pre code .hljs-number) {
		color: var(--warning);
	}

	.message-markdown :global(pre code .hljs-attribute) {
		color: var(--accent);
	}

	.message-markdown :global(pre code .hljs-meta) {
		color: var(--danger);
	}

	.message-markdown > :global(:first-child) {
		margin-top: 0;
	}

	.message-markdown > :global(:last-child) {
		margin-bottom: 0;
	}

	.message-text,
	.thinking pre {
		margin: 0;
		overflow-x: auto;
		padding: 0.8rem;
		font:
			0.85rem/1.55 ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.thinking {
		border-top: 1px solid var(--border);
	}

	.message-conversational > .thinking:first-child {
		border-top: 0;
	}

	.thinking summary {
		padding: 0.6rem 0.8rem;
		color: var(--text-muted);
		font-size: 0.8rem;
		cursor: pointer;
	}

	.thinking pre {
		color: var(--text-muted);
	}

	.timeline-notice {
		max-width: 54rem;
		margin: 1rem auto;
		color: var(--text-muted);
		font-size: 0.78rem;
		text-align: center;
		white-space: pre-wrap;
	}

	.stopped-row {
		max-width: 54rem;
		margin: 0.25rem auto;
		color: var(--danger);
		font-size: 0.72rem;
		text-align: center;
	}

	.thinking-indicator {
		display: flex;
		align-items: center;
		box-sizing: border-box;
		width: min(54rem, 100%);
		gap: 0.5rem;
		margin: 1rem auto;
		color: var(--text-muted);
		padding: 0.45rem 0.8rem;
		font-size: 0.78rem;
	}

	.thinking-dots {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
	}

	.thinking-dots i {
		width: 0.3rem;
		height: 0.3rem;
		border-radius: 50%;
		background: var(--accent);
		animation: thinking-dot 1.1s ease-in-out infinite;
	}

	.thinking-dots i:nth-child(2) {
		animation-delay: 140ms;
	}

	.thinking-dots i:nth-child(3) {
		animation-delay: 280ms;
	}

	.streaming {
		border-color: var(--accent);
	}

	@keyframes thinking-dot {
		50% {
			opacity: 0.35;
			transform: translateY(-0.16rem);
		}
	}

	@media (max-width: 700px) {
		.message-entry-user {
			margin-left: 1.5rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.thinking-dots i {
			animation: none;
		}
	}
</style>

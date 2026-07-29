<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import type { ChatItem, ChatToolCall } from '$lib/contracts';
	import type { ChatTab, StreamingTool } from '$lib/harness/types';
	import { renderAssistantMarkdown } from '$lib/markdown';

	type ToolView = {
		call: ChatToolCall;
		result?: ChatItem;
		stream?: StreamingTool;
	};

	type TimelineEntry = {
		item: ChatItem;
		tools: ToolView[];
		thinking?: string;
	};

	type Props = { chat: ChatTab; showReasoning?: boolean };
	let { chat, showReasoning = false }: Props = $props();
	let copiedMessageId = $state<string>();
	let copyError = $state<string>();
	let copiedMessageTimer: ReturnType<typeof setTimeout> | undefined;
	let hoveredMessageId = $state<string>();
	let waitingForResponse = $derived(
		chat.snapshot?.isStreaming === true &&
			(!showReasoning || !chat.streamThinking) &&
			!chat.streamText &&
			chat.streamTools.length === 0 &&
			chat.permissionRequests.length === 0
	);
	let timeline = $derived.by(() => {
		const items = chat.snapshot?.items ?? [];
		const calledIds = items.flatMap((item) => item.toolCalls?.map((tool) => tool.id) ?? []);
		const timeline: TimelineEntry[] = [];
		let activeToolEntry: TimelineEntry | undefined;

		for (const item of items) {
			if (item.role === 'tool' && item.toolCallId && calledIds.includes(item.toolCallId)) {
				continue;
			}

			const tools = (item.toolCalls ?? []).map((call) => ({
				call,
				result: items.find(
					(candidate) => candidate.role === 'tool' && candidate.toolCallId === call.id
				),
				stream: chat.streamTools.find((candidate) => candidate.id === call.id)
			}));
			const isToolOnlyAssistant = item.role === 'assistant' && !item.text && tools.length > 0;

			if (isToolOnlyAssistant && activeToolEntry) {
				activeToolEntry.tools.push(...tools);
				if (item.thinking) {
					activeToolEntry.thinking = [activeToolEntry.thinking, item.thinking]
						.filter(Boolean)
						.join('\n\n');
				}
				continue;
			}

			const entry = { item, tools, thinking: item.thinking };
			timeline.push(entry);
			activeToolEntry = isToolOnlyAssistant ? entry : undefined;
		}

		return timeline;
	});
	let unmatchedStreamingTools = $derived(
		chat.streamTools.filter(
			(stream) => !timeline.some((entry) => entry.tools.some((tool) => tool.call.id === stream.id))
		)
	);

	function toolCountLabel(count: number, action = 'called'): string {
		return `${count} tool${count === 1 ? '' : 's'} ${action}`;
	}

	function toolStatus(tool: ToolView): 'pending' | 'running' | 'completed' | 'failed' {
		if (tool.result) return tool.result.isError ? 'failed' : 'completed';
		if (tool.stream?.isError) return 'failed';
		return tool.stream ? 'running' : 'pending';
	}

	function toolGroupStatus(tools: ToolView[]): string {
		const failed = tools.filter((tool) => toolStatus(tool) === 'failed').length;
		if (failed) return `${failed} failed`;
		const completed = tools.filter((tool) => toolStatus(tool) === 'completed').length;
		if (completed === tools.length) return 'completed';
		if (tools.some((tool) => toolStatus(tool) === 'running')) return 'running';
		return `${completed}/${tools.length} complete`;
	}

	function formatTimestamp(timestamp: string | undefined): string | undefined {
		if (!timestamp) return undefined;
		const date = new Date(timestamp);
		if (Number.isNaN(date.getTime())) return undefined;
		return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
	}

	function formatTimestampTitle(timestamp: string): string {
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(timestamp));
	}

	function modelName(item: ChatItem): string | undefined {
		return item.modelName ?? chat.snapshot?.model?.name;
	}

	async function copyMessage(item: ChatItem): Promise<void> {
		if (!item.text) return;
		try {
			if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
			await navigator.clipboard.writeText(item.text);
			copyError = undefined;
			copiedMessageId = item.id;
			if (copiedMessageTimer) clearTimeout(copiedMessageTimer);
			copiedMessageTimer = setTimeout(() => {
				copiedMessageId = undefined;
			}, 1600);
		} catch (error) {
			copyError = error instanceof Error ? error.message : 'Unable to copy the message.';
		}
	}
</script>

{#if chat.snapshot?.modelFallbackMessage}
	<p class="fallback-error">{chat.snapshot.modelFallbackMessage}</p>
{/if}

{#if copyError}
	<p class="copy-error" role="alert">{copyError}</p>
{/if}

{#each timeline as entry (entry.item.id)}
	{@const item = entry.item}
	{#if item.kind === 'notice'}
		<p class="timeline-notice">{item.text}</p>
	{:else}
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
				if (hoveredMessageId === item.id) hoveredMessageId = undefined;
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
						<!-- eslint-disable-next-line svelte/no-at-html-tags -- markdown-it output is constrained in $lib/markdown -->
						<div class="message-markdown">{@html renderAssistantMarkdown(item.text)}</div>
					{:else}
						<pre class="message-text">{item.text}</pre>
					{/if}
				{/if}
				{#if entry.tools.length}
					<details
						class:tool-group-error={entry.tools.some((tool) => toolStatus(tool) === 'failed')}
						class="tool-group"
					>
						<summary class="tool-group-summary">
							<span>{toolCountLabel(entry.tools.length)}</span>
							<span class="tool-group-status">{toolGroupStatus(entry.tools)}</span>
						</summary>
						<div class="tool-list">
							{#each entry.tools as tool (tool.call.id)}
								<section class:tool-entry-error={toolStatus(tool) === 'failed'} class="tool-entry">
									<div class="tool-entry-heading">
										<strong>{tool.call.name}</strong>
										<span>{toolStatus(tool)}</span>
									</div>
									<div class="tool-detail">
										<span>Arguments</span>
										<pre>{tool.call.arguments}</pre>
									</div>
									{#if tool.result || tool.stream}
										<details class="tool-detail tool-result">
											<summary>Result</summary>
											<pre>{tool.result?.text || tool.stream?.text || 'No output.'}</pre>
										</details>
									{/if}
								</section>
							{/each}
						</div>
					</details>
				{/if}
			</article>
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
		{#if chat.streamText}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- markdown-it output is constrained in $lib/markdown -->
			<div class="message-markdown">{@html renderAssistantMarkdown(chat.streamText)}</div>
		{/if}
	</article>
{/if}

{#if unmatchedStreamingTools.length}
	<details
		class:tool-group-error={unmatchedStreamingTools.some((tool) => tool.isError)}
		class="tool-group live-tool-group streaming-tool"
	>
		<summary class="tool-group-summary">
			<span>{toolCountLabel(unmatchedStreamingTools.length, 'running')}</span>
			<span class="tool-group-status">running</span>
		</summary>
		<div class="tool-list">
			{#each unmatchedStreamingTools as tool (tool.id)}
				<section class:tool-entry-error={tool.isError} class="tool-entry">
					<div class="tool-entry-heading">
						<strong>{tool.name}</strong>
						<span>{tool.isError ? 'failed' : 'running'}</span>
					</div>
					<details class="tool-detail tool-result">
						<summary>Result</summary>
						<pre>{tool.text || 'Waiting for output.'}</pre>
					</details>
				</section>
			{/each}
		</div>
	</details>
{/if}

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

	.message-entry {
		max-width: 54rem;
		margin: 0 auto 0.25rem;
	}

	.message {
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 0.55rem;
		background: var(--surface);
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
		gap: 0.55rem;
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
		padding: 0.8rem;
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

	.message-markdown :global(pre code) {
		border: 0;
		border-radius: 0;
		background: transparent;
		padding: 0;
		font: inherit;
	}

	.message-markdown > :global(:first-child) {
		margin-top: 0;
	}

	.message-markdown > :global(:last-child) {
		margin-bottom: 0;
	}

	.message-text,
	.thinking pre,
	.tool-detail pre {
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

	.thinking,
	.tool-group {
		border-top: 1px solid var(--border);
	}

	.message-conversational > .thinking:first-child,
	.message-conversational > .tool-group:first-child {
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

	.tool-group-summary {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.6rem 0.8rem;
		color: var(--text-muted);
		font-size: 0.8rem;
		cursor: pointer;
		list-style: none;
	}

	.tool-group-summary::-webkit-details-marker {
		display: none;
	}

	.tool-group-summary::after {
		content: '›';
		color: var(--accent);
		font-size: 1rem;
		transition: transform 160ms ease;
	}

	.tool-group[open] > .tool-group-summary::after {
		transform: rotate(90deg);
	}

	.tool-group-status {
		margin-left: auto;
		color: var(--accent);
		font-size: 0.68rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.tool-group-error > .tool-group-summary,
	.tool-group-error > .tool-group-summary .tool-group-status {
		color: var(--danger);
	}

	.tool-list {
		display: grid;
		gap: 0.65rem;
		padding: 0 0.75rem 0.75rem;
	}

	.tool-entry {
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 0.45rem;
		background: var(--surface-muted);
	}

	.tool-entry-error {
		border-color: color-mix(in srgb, var(--danger) 65%, var(--border));
	}

	.tool-entry-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.5rem 0.65rem;
		border-bottom: 1px solid var(--border);
		color: var(--text);
		font-size: 0.75rem;
	}

	.tool-entry-heading span,
	.tool-detail > span,
	.tool-result summary {
		color: var(--text-muted);
		font-size: 0.65rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.tool-entry-error .tool-entry-heading span {
		color: var(--danger);
	}

	.tool-detail + .tool-detail {
		border-top: 1px solid var(--border);
	}

	.tool-detail > span {
		display: block;
		padding: 0.5rem 0.65rem 0;
	}

	.tool-result summary {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.5rem 0.65rem;
		cursor: pointer;
		list-style: none;
	}

	.tool-result summary::-webkit-details-marker {
		display: none;
	}

	.tool-result summary::before {
		content: '›';
		color: var(--accent);
		font-size: 0.9rem;
		transition: transform 160ms ease;
	}

	.tool-result[open] summary::before {
		transform: rotate(90deg);
	}

	.live-tool-group {
		max-width: 54rem;
		margin: 0 auto 1rem;
		border: 1px solid var(--accent);
		border-radius: 0.55rem;
		background: var(--surface-muted);
	}

	.timeline-notice {
		max-width: 54rem;
		margin: 1rem auto;
		color: var(--text-muted);
		font-size: 0.78rem;
		text-align: center;
		white-space: pre-wrap;
	}

	.thinking-indicator {
		display: flex;
		align-items: center;
		width: fit-content;
		max-width: 54rem;
		gap: 0.5rem;
		margin: 1rem auto;
		border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
		border-radius: 999px;
		background: color-mix(in srgb, var(--accent) 8%, var(--surface));
		color: var(--text-muted);
		padding: 0.45rem 0.75rem;
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

	.streaming-tool {
		border-style: dashed;
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
		.thinking-dots i,
		.tool-group-summary::after,
		.tool-result summary::before {
			animation: none;
			transition: none;
		}
	}
</style>

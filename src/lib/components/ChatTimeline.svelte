<script lang="ts">
	import type { ChatTab } from '$lib/harness/types';

	type Props = { chat: ChatTab };
	let { chat }: Props = $props();
	let waitingForResponse = $derived(
		chat.snapshot?.isStreaming === true &&
			!chat.streamThinking &&
			!chat.streamText &&
			chat.streamTools.length === 0 &&
			chat.permissionRequests.length === 0
	);
</script>

{#if chat.snapshot?.modelFallbackMessage}
	<p class="fallback-error">{chat.snapshot.modelFallbackMessage}</p>
{/if}

{#each chat.transientNotices as notice (notice.id)}
	<p class="timeline-notice">{notice.message}</p>
{/each}

{#each chat.snapshot?.items ?? [] as item (item.id)}
	{#if item.kind === 'notice'}
		<p class="timeline-notice">{item.text}</p>
	{:else}
		<article class={`message message-${item.role ?? 'assistant'}`}>
			<header>{item.label || item.role || 'message'}</header>
			{#if item.thinking}
				<details class="thinking">
					<summary>Reasoning</summary>
					<pre>{item.thinking}</pre>
				</details>
			{/if}
			{#if item.text}<pre class="message-text">{item.text}</pre>{/if}
			{#if item.toolCalls}
				{#each item.toolCalls as tool (tool.id)}
					<details class="tool-call">
						<summary>{tool.name}</summary>
						<pre>{tool.arguments}</pre>
					</details>
				{/each}
			{/if}
		</article>
	{/if}
{/each}

{#if waitingForResponse}
	<div class="thinking-indicator" role="status">
		<span>Pi is thinking</span>
		<span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>
	</div>
{/if}

{#if chat.streamThinking || chat.streamText}
	<article class="message message-assistant streaming">
		<header>Pi <span>streaming</span></header>
		{#if chat.streamThinking}
			<details class="thinking" open>
				<summary>Reasoning</summary>
				<pre>{chat.streamThinking}</pre>
			</details>
		{/if}
		{#if chat.streamText}<pre class="message-text">{chat.streamText}</pre>{/if}
	</article>
{/if}

{#each chat.streamTools as tool (tool.id)}
	<article class:message-error={tool.isError} class="message message-tool streaming-tool">
		<header>{tool.name} <span>running</span></header>
		<pre class="message-text">{tool.text}</pre>
	</article>
{/each}

<style>
	.fallback-error {
		width: min(54rem, 100%);
		margin: 0 auto 1rem;
		color: var(--danger);
		font-size: 0.9rem;
	}

	.message {
		max-width: 54rem;
		margin: 0 auto 1rem;
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

	.message header span {
		color: var(--accent);
	}

	.message-user {
		margin-left: max(0px, calc((100% - 54rem) / 2 + 7rem));
		background: color-mix(in srgb, var(--accent-strong) 12%, var(--surface));
	}

	.message-tool,
	.message-bash {
		background: var(--surface-muted);
	}

	.message-error {
		border-color: var(--danger);
	}

	.message-text,
	.thinking pre,
	.tool-call pre {
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
	.tool-call {
		border-top: 1px solid var(--border);
	}

	.thinking summary,
	.tool-call summary {
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
		.message-user {
			margin-left: 1.5rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.thinking-dots i {
			animation: none;
		}
	}
</style>

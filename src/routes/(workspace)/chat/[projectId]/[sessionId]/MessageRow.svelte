<script lang="ts">
	import { onDestroy, type Snippet } from 'svelte';
	import type { ChatItem } from '$lib/contracts';

	type TimestampView = {
		datetime: string;
		text: string;
		title: string;
	};

	type Props = {
		item: ChatItem;
		modelName?: string;
		thinkingLevel?: string;
		timestamp?: TimestampView;
		content: Snippet;
		attachments?: Snippet;
		onCopyMessage: (text: string) => Promise<boolean>;
	};

	let { item, modelName, thinkingLevel, timestamp, content, attachments, onCopyMessage }: Props =
		$props();
	let copied = $state(false);
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;
	let role = $derived(item.role ?? 'assistant');
	let isConversational = $derived(role === 'user' || role === 'assistant');

	async function copyMessage(): Promise<void> {
		if (!item.text) {
			return;
		}

		if (!(await onCopyMessage(item.text))) {
			return;
		}

		copied = true;
		if (copiedTimer) {
			clearTimeout(copiedTimer);
		}

		copiedTimer = setTimeout(() => {
			copied = false;
			copiedTimer = undefined;
		}, 1600);
	}

	onDestroy(() => {
		if (copiedTimer) {
			clearTimeout(copiedTimer);
		}
	});
</script>

<div class={`message-entry message-entry-${role}`} role="group" aria-label={`${role} message`}>
	{@render content()}
	{@render attachments?.()}

	{#if isConversational}
		<div class="message-meta-row">
			<div class="message-meta-content">
				{#if role === 'assistant' && modelName}
					<span>{modelName}</span>
				{/if}
				{#if role === 'assistant' && thinkingLevel}
					<span>-</span>
					<span>{thinkingLevel}</span>
				{/if}
				{#if timestamp}
					<time datetime={timestamp.datetime} title={timestamp.title}>{timestamp.text}</time>
				{/if}
				{#if item.text}
					<button
						class:copied
						class="copy-action"
						type="button"
						aria-label={copied ? 'Copied message' : 'Copy message'}
						title="Copy message"
						onclick={copyMessage}
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
						<span>{copied ? 'Copied' : 'Copy'}</span>
					</button>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.message-entry {
		content-visibility: auto;
		contain-intrinsic-size: auto 240px;
		max-width: 54rem;
		margin: 0 auto 1rem;
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
		opacity: 0;
		pointer-events: none;
		transform: translateY(-0.15rem);
		transition:
			opacity 100ms ease,
			transform 100ms ease;
	}

	.message-entry:hover .message-meta-content,
	.message-entry:focus-within .message-meta-content {
		opacity: 1;
		pointer-events: auto;
		transform: none;
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

	@media (max-width: 700px) {
		.message-entry-user {
			margin-left: 1.5rem;
		}
	}

	@media (hover: none), (pointer: coarse) {
		.message-meta-content {
			opacity: 1;
			pointer-events: auto;
			transform: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.message-meta-content {
			transition: none;
		}
	}
</style>

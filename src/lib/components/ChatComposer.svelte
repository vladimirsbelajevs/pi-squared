<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { THINKING_LEVELS, type ModelOption, type ThinkingLevel } from '$lib/contracts';

	type QueueMode = 'followUp' | 'steer';

	type Props = {
		draft?: string;
		models: ModelOption[];
		modelKey: string;
		thinkingLevel: ThinkingLevel;
		queueMode?: QueueMode;
		isStreaming?: boolean;
		disabled?: boolean;
		autoFocus?: boolean;
		error?: string;
		onSend: (message: string) => Promise<boolean>;
		onDraftChange?: (draft: string) => void;
		onStop?: () => void | Promise<void>;
		onModelChange: (modelKey: string) => void | Promise<void>;
		onThinkingChange: (level: ThinkingLevel) => void | Promise<void>;
		onQueueModeChange?: (mode: QueueMode) => void;
	};

	let {
		draft = $bindable(''),
		models,
		modelKey,
		thinkingLevel,
		queueMode = 'followUp',
		isStreaming = false,
		disabled = false,
		autoFocus = false,
		error,
		onSend,
		onDraftChange,
		onStop,
		onModelChange,
		onThinkingChange,
		onQueueModeChange
	}: Props = $props();

	const inputId = $props.id();
	const placeholderExamples = [
		'Find the cause of this failing test',
		'Implement the next feature',
		'Explain how this codebase works',
		'Review the current changes'
	];
	const placeholderTransition = { duration: 260 };

	let submitting = $state(false);
	let localError = $state<string>();
	let placeholderIndex = $state(0);
	let textarea = $state<HTMLTextAreaElement>();
	let selectedModel = $derived(models.find((model) => keyForModel(model) === modelKey));
	let submitDisabled = $derived(disabled || submitting || !draft.trim());
	let placeholder = $derived(placeholderExamples[placeholderIndex]);

	onMount(() => {
		const interval = window.setInterval(() => {
			placeholderIndex = (placeholderIndex + 1) % placeholderExamples.length;
		}, 3600);

		if (autoFocus && window.matchMedia('(min-width: 641px)').matches) textarea?.focus();
		resizeTextarea();

		return () => window.clearInterval(interval);
	});

	function keyForModel(model: Pick<ModelOption, 'provider' | 'id'>): string {
		return `${model.provider}::${model.id}`;
	}

	function resizeTextarea(): void {
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = `${Math.min(textarea.scrollHeight, 192)}px`;
	}

	function updateDraft(value: string): void {
		draft = value;
		onDraftChange?.(value);
	}

	function handleDraftInput(event: Event): void {
		resizeTextarea();
		onDraftChange?.((event.currentTarget as HTMLTextAreaElement).value);
	}

	function submitOnEnter(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
		event.preventDefault();
		if (!draft.trim()) return;
		(event.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
	}

	async function submitMessage(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const message = draft.trim();
		if (!message || submitDisabled) return;

		localError = undefined;
		submitting = true;
		updateDraft('');
		await Promise.resolve();
		resizeTextarea();

		try {
			if (!(await onSend(message))) {
				updateDraft(message);
				localError = 'Message was not accepted. Please try again.';
			}
		} catch (sendError) {
			updateDraft(message);
			localError = sendError instanceof Error ? sendError.message : 'Unable to send this message.';
		} finally {
			submitting = false;
			await Promise.resolve();
			resizeTextarea();
		}
	}

	function changeQueueMode(event: Event): void {
		onQueueModeChange?.((event.currentTarget as HTMLSelectElement).value as QueueMode);
	}
</script>

<form class="chat-composer" aria-busy={submitting} onsubmit={submitMessage}>
	<label class="visually-hidden" for={inputId}>Message Pi</label>
	<div class="composer-shell">
		<div class="input-row">
			<div class="textarea-wrap">
				{#if !draft}
					<div class="animated-placeholder" aria-hidden="true">
						<span>Ask Pi to</span>
						<span class="placeholder-slot">
							{#key placeholder}
								<span transition:fade={placeholderTransition}>“{placeholder}”</span>
							{/key}
						</span>
					</div>
				{/if}
				<textarea
					id={inputId}
					bind:this={textarea}
					bind:value={draft}
					rows="1"
					oninput={handleDraftInput}
					onkeydown={submitOnEnter}></textarea>
			</div>

			<div class="composer-actions">
				{#if isStreaming && onStop}
					<button class="stop-action" type="button" aria-label="Stop response" onclick={onStop}>
						<span aria-hidden="true"></span>
					</button>
				{/if}
				<button
					class="send-action"
					type="submit"
					disabled={submitDisabled}
					aria-label={isStreaming ? 'Queue message' : 'Send message'}
				>
					<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
						<path
							d="M10 15.5V4.5"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
						/>
						<path
							d="M5.75 8.75L10 4.5L14.25 8.75"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</button>
			</div>
		</div>

		<div class="composer-footer">
			<label class="composer-picker">
				<span>Model</span>
				<select
					value={modelKey}
					disabled={isStreaming || submitting || !models.length}
					onchange={(event) => onModelChange(event.currentTarget.value)}
				>
					<option value="" disabled>No model selected</option>
					{#each models as model (keyForModel(model))}
						<option value={keyForModel(model)}>{model.name} · {model.provider}</option>
					{/each}
				</select>
			</label>

			<label class="composer-picker">
				<span>Reasoning</span>
				<select
					value={thinkingLevel}
					disabled={isStreaming || submitting || selectedModel?.reasoning === false}
					onchange={(event) => onThinkingChange(event.currentTarget.value as ThinkingLevel)}
				>
					{#each THINKING_LEVELS as level (level)}
						<option value={level}>{level}</option>
					{/each}
				</select>
			</label>

			{#if isStreaming}
				<label class="composer-picker queue-picker">
					<span>Queue</span>
					<select value={queueMode} onchange={changeQueueMode}>
						<option value="followUp">follow-up</option>
						<option value="steer">steer</option>
					</select>
				</label>
			{/if}

			<span class="keyboard-hint">Enter to send · Shift Enter for a new line</span>
		</div>
	</div>

	{#if error || localError}
		<p class="composer-error" role="alert" transition:fade={{ duration: 160 }}>
			{error || localError}
		</p>
	{/if}
</form>

<style>
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.chat-composer {
		display: grid;
		gap: 0.55rem;
		width: 100%;
	}

	.composer-shell {
		border: 1px solid var(--border);
		border-radius: 0.8rem;
		background: var(--surface);
		box-shadow:
			0 14px 32px var(--shadow),
			inset 0 1px 0 color-mix(in srgb, var(--text) 7%, transparent);
		transition:
			border-color 180ms ease,
			box-shadow 180ms ease,
			background 180ms ease;
	}

	.composer-shell:focus-within {
		border-color: var(--border-strong);
		background: color-mix(in srgb, var(--surface) 94%, var(--accent) 6%);
		box-shadow:
			0 18px 40px var(--shadow),
			0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
	}

	.input-row {
		display: flex;
		align-items: flex-end;
		gap: 0.65rem;
		padding: 0.65rem;
	}

	.textarea-wrap {
		position: relative;
		min-width: 0;
		flex: 1;
	}

	textarea {
		position: relative;
		z-index: 1;
		display: block;
		width: 100%;
		min-height: 3.15rem;
		max-height: 12rem;
		resize: none;
		overflow-y: auto;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text);
		padding: 0.78rem 0.7rem;
		line-height: 1.6;
		outline: none;
		box-shadow: none;
	}

	.animated-placeholder {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: flex-start;
		min-width: 0;
		overflow: hidden;
		padding: 0.78rem 0.7rem;
		color: var(--text-muted);
		line-height: 1.6;
		white-space: nowrap;
		pointer-events: none;
	}

	.placeholder-slot {
		position: relative;
		min-width: 0;
		height: 1.6em;
		flex: 1;
		margin-left: 0.35rem;
		overflow: hidden;
	}

	.placeholder-slot > span {
		position: absolute;
		inset: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.composer-actions {
		display: flex;
		gap: 0.45rem;
		padding-bottom: 0.15rem;
	}

	.send-action,
	.stop-action {
		display: grid;
		width: 2.8rem;
		height: 2.8rem;
		min-height: 2.8rem;
		place-items: center;
		border-radius: 0.6rem;
		padding: 0;
		transition:
			background 180ms ease,
			box-shadow 180ms ease,
			transform 180ms ease;
	}

	.send-action {
		border: 0;
		background: var(--accent-strong);
		color: var(--accent-ink);
	}

	.send-action:hover:not(:disabled) {
		filter: brightness(1.08);
		box-shadow: 0 7px 18px color-mix(in srgb, var(--accent-strong) 28%, transparent);
		transform: translateY(-2px);
	}

	.send-action:active:not(:disabled),
	.stop-action:active {
		transform: translateY(0);
	}

	.send-action:disabled {
		background: var(--surface-strong);
		color: var(--text-muted);
		box-shadow: none;
	}

	.stop-action {
		border: 1px solid color-mix(in srgb, var(--danger) 60%, var(--border));
		background: color-mix(in srgb, var(--danger) 9%, var(--surface));
		color: var(--danger);
	}

	.stop-action:hover {
		background: color-mix(in srgb, var(--danger) 17%, var(--surface));
		transform: translateY(-2px);
	}

	.stop-action span {
		width: 0.72rem;
		height: 0.72rem;
		border-radius: 0.16rem;
		background: currentColor;
	}

	.send-action svg {
		width: 1.2rem;
		height: 1.2rem;
	}

	.composer-footer {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		min-width: 0;
		padding: 0.55rem 0.65rem;
		border-top: 1px solid var(--border);
	}

	.composer-picker {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
		color: var(--text-muted);
		font-size: 0.72rem;
	}

	.composer-picker span {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
	}

	.composer-picker select {
		width: auto;
		max-width: 15rem;
		border: 0;
		border-radius: 0.35rem;
		background: var(--surface-muted);
		color: var(--text-muted);
		padding: 0.35rem 1.7rem 0.35rem 0.5rem;
		font-size: 0.72rem;
		text-overflow: ellipsis;
	}

	.composer-picker select:hover:not(:disabled),
	.composer-picker select:focus {
		background: var(--surface-strong);
		color: var(--text);
	}

	.queue-picker select {
		color: var(--accent);
	}

	.keyboard-hint {
		margin-left: auto;
		color: var(--text-muted);
		font-size: 0.68rem;
		white-space: nowrap;
	}

	.composer-error {
		margin: 0;
		color: var(--danger);
		font-size: 0.82rem;
	}

	@media (max-width: 700px) {
		.composer-shell {
			border-radius: 1.1rem;
		}

		.composer-footer {
			flex-wrap: wrap;
		}

		.composer-picker {
			max-width: calc(50% - 0.25rem);
		}

		.composer-picker select {
			max-width: 100%;
		}

		.keyboard-hint {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.composer-shell,
		.send-action,
		.stop-action {
			transition: none;
		}
	}
</style>

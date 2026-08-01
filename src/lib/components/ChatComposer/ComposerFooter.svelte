<script lang="ts">
	import { THINKING_LEVELS, type ModelOption, type ThinkingLevel } from '$lib/contracts';
	import ComposerSelector from './ComposerSelector.svelte';

	type QueueMode = 'followUp' | 'steer';

	type Props = {
		models: ModelOption[];
		modelKey: string;
		thinkingLevel: ThinkingLevel;
		queueMode: QueueMode;
		isStreaming: boolean;
		disabled: boolean;
		submitting: boolean;
		readingAttachments: boolean;
		selectedModel?: ModelOption;
		onAttach: () => void;
		onModelChange: (modelKey: string) => void | Promise<void>;
		onThinkingChange: (level: ThinkingLevel) => void | Promise<void>;
		onQueueModeChange: (mode: QueueMode) => void;
	};

	let {
		models,
		modelKey,
		thinkingLevel,
		queueMode,
		isStreaming,
		disabled,
		submitting,
		readingAttachments,
		selectedModel,
		onAttach,
		onModelChange,
		onThinkingChange,
		onQueueModeChange
	}: Props = $props();

	let modelOptions = $derived(
		models.map((model) => ({
			value: keyForModel(model),
			label: `${model.name} (${model.provider})`
		}))
	);
	let thinkingOptions = $derived(THINKING_LEVELS.map((level) => ({ value: level, label: level })));

	function keyForModel(model: Pick<ModelOption, 'provider' | 'id'>): string {
		return `${model.provider}::${model.id}`;
	}
</script>

<div class="composer-footer">
	<button
		class="attach-action"
		type="button"
		aria-label="Attach files"
		title="Attach files"
		disabled={disabled || submitting || readingAttachments}
		onclick={onAttach}
	>
		<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
			<path
				d="M7.2 10.8L11.9 6.1A2.65 2.65 0 1 1 15.65 9.85L9.2 16.3A4 4 0 0 1 3.55 10.65L9.3 4.9"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	</button>
	<div class="model-controls">
		<ComposerSelector
			label="Model"
			value={modelKey}
			options={modelOptions}
			triggerLabel={selectedModel?.name}
			disabled={isStreaming || submitting || !models.length}
			onChange={onModelChange}
		/>
		<span class="selector-separator" aria-hidden="true">·</span>
		<ComposerSelector
			label="Reasoning"
			value={thinkingLevel}
			options={thinkingOptions}
			disabled={isStreaming || submitting || selectedModel?.reasoning === false}
			onChange={(level) => onThinkingChange(level as ThinkingLevel)}
		/>
	</div>

	{#if isStreaming}
		<ComposerSelector
			label="Queue"
			value={queueMode}
			options={[
				{ value: 'followUp', label: 'follow-up' },
				{ value: 'steer', label: 'steer' }
			]}
			onChange={(mode) => onQueueModeChange(mode as QueueMode)}
		/>
	{/if}

	<span class="keyboard-hint">Enter to send · Shift Enter for a new line</span>
</div>

<style>
	.attach-action {
		display: grid;
		width: 1.9rem;
		height: 1.9rem;
		min-height: 1.9rem;
		place-items: center;
		border: 0;
		border-radius: 0.35rem;
		background: transparent;
		color: var(--text-muted);
		padding: 0;
		transition:
			background 180ms ease,
			box-shadow 180ms ease,
			transform 180ms ease;
	}

	.attach-action:hover:not(:disabled),
	.attach-action:focus-visible {
		background: var(--surface-muted);
		color: var(--text);
	}

	.attach-action:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.attach-action:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.attach-action svg {
		width: 1rem;
		height: 1rem;
	}

	.composer-footer {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		min-width: 0;
		border-top: 1px solid var(--border);
		padding: 0.25rem 0.65rem;
	}

	.model-controls {
		display: flex;
		align-items: center;
		gap: 0;
	}

	.selector-separator {
		color: var(--text-muted);
	}

	.keyboard-hint {
		margin-left: auto;
		color: var(--text-muted);
		font-size: 0.68rem;
		white-space: nowrap;
	}

	@media (max-width: 700px) {
		.composer-footer {
			flex-wrap: wrap;
		}

		.keyboard-hint {
			display: none;
		}
	}
</style>

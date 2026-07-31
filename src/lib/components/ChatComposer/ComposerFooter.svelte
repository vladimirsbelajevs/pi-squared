<script lang="ts">
	import { THINKING_LEVELS, type ModelOption, type ThinkingLevel } from '$lib/contracts';

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
	<label class="composer-picker">
		<span>Model</span>
		<select
			class="dropdown"
			value={modelKey}
			disabled={isStreaming || submitting || !models.length}
			onchange={(event) => void onModelChange(event.currentTarget.value)}
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
			class="dropdown"
			value={thinkingLevel}
			disabled={isStreaming || submitting || selectedModel?.reasoning === false}
			onchange={(event) => void onThinkingChange(event.currentTarget.value as ThinkingLevel)}
		>
			{#each THINKING_LEVELS as level (level)}
				<option value={level}>{level}</option>
			{/each}
		</select>
	</label>

	{#if isStreaming}
		<label class="composer-picker queue-picker">
			<span>Queue</span>
			<select
				class="dropdown"
				value={queueMode}
				onchange={(event) => onQueueModeChange(event.currentTarget.value as QueueMode)}
			>
				<option value="followUp">follow-up</option>
				<option value="steer">steer</option>
			</select>
		</label>
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
		padding: 0.55rem 0.65rem;
	}

	.composer-picker {
		display: flex;
		align-items: center;
		min-width: 0;
		gap: 0.25rem;
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

	@media (max-width: 700px) {
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
</style>

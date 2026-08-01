<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import ComposerAutocomplete from './ComposerAutocomplete.svelte';

	type Props = {
		inputId: string;
		draft: string;
		projectId?: string;
		runtimeId?: string;
		autoFocus?: boolean;
		isStreaming?: boolean;
		hasAttachments: boolean;
		submitDisabled: boolean;
		onDraftChange: (draft: string) => void;
		onPaste?: (event: ClipboardEvent) => void;
		onStop?: () => void | Promise<void>;
	};

	let {
		inputId,
		draft,
		projectId,
		runtimeId,
		autoFocus = false,
		isStreaming = false,
		hasAttachments,
		submitDisabled,
		onDraftChange,
		onPaste,
		onStop
	}: Props = $props();

	const placeholderExamples = [
		'Find the cause of this failing test',
		'Implement the next feature',
		'Explain how this codebase works',
		'Review the current changes'
	];
	const placeholderTransition = { duration: 260 };

	let placeholderIndex = $state(0);
	let textarea = $state<HTMLTextAreaElement>();
	let caret = $state(0);
	let isComposing = $state(false);
	let autocompleteAria = $state<{ controls?: string; activeDescendant?: string }>({});
	let autocomplete = $state<{
		handleInput: (value: string, selectionStart: number) => void;
		handleFocus: (value: string, selectionStart: number) => void;
		handleBlur: () => void;
		handleSelection: (value: string, selectionStart: number) => void;
		handleCompositionStart: () => void;
		handleCompositionEnd: (value: string, selectionStart: number) => void;
		handleDraftReset: (value: string, selectionStart: number) => void;
		handleKeydown: (event: KeyboardEvent) => boolean;
	}>();
	let placeholder = $derived(placeholderExamples[placeholderIndex]);

	onMount(() => {
		const interval = window.setInterval(() => {
			placeholderIndex = (placeholderIndex + 1) % placeholderExamples.length;
		}, 3600);

		if (autoFocus && window.matchMedia('(min-width: 641px)').matches) {
			textarea?.focus();
		}

		resizeTextarea();

		return () => window.clearInterval(interval);
	});

	function resizeTextarea(): void {
		if (!textarea) {
			return;
		}

		textarea.style.height = 'auto';
		textarea.style.height = `${Math.min(textarea.scrollHeight, 192)}px`;
	}

	function captureTextarea(element: HTMLTextAreaElement): () => void {
		textarea = element;

		return () => {
			if (textarea === element) {
				textarea = undefined;
			}
		};
	}

	function handleDraftInput(event: Event): void {
		const target = event.currentTarget as HTMLTextAreaElement;
		onDraftChange(target.value);
		if (isComposing) {
			resizeTextarea();

			return;
		}

		captureCaret(target);
		autocomplete?.handleInput(target.value, caret);
		resizeTextarea();
	}

	function submitOnEnter(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
			return;
		}

		event.preventDefault();
		if (!draft.trim() && !hasAttachments) {
			return;
		}

		(event.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
	}

	function captureCaret(target: HTMLTextAreaElement): void {
		caret = target.selectionStart ?? target.value.length;
	}

	function handleFocus(event: FocusEvent): void {
		const target = event.currentTarget as HTMLTextAreaElement;
		captureCaret(target);
		autocomplete?.handleFocus(target.value, caret);
	}

	function handleBlur(): void {
		autocomplete?.handleBlur();
	}

	function handleSelectionChange(event: Event): void {
		const target = event.currentTarget as HTMLTextAreaElement;
		captureCaret(target);
		autocomplete?.handleSelection(target.value, caret);
	}

	function handleCompositionStart(): void {
		isComposing = true;
		autocomplete?.handleCompositionStart();
	}

	function handleCompositionEnd(event: CompositionEvent): void {
		isComposing = false;
		const target = event.currentTarget as HTMLTextAreaElement;
		captureCaret(target);
		autocomplete?.handleCompositionEnd(target.value, caret);
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (autocomplete?.handleKeydown(event)) {
			return;
		}

		submitOnEnter(event);
	}

	export function resetAutocomplete(value = draft): void {
		const selectionStart = textarea?.selectionStart ?? value.length;
		caret = selectionStart;
		autocomplete?.handleDraftReset(value, selectionStart);
	}

	async function handleAutocompleteSelection(selection: {
		value: string;
		caret: number;
	}): Promise<void> {
		onDraftChange(selection.value);
		caret = selection.caret;

		await tick();
		textarea?.focus();
		textarea?.setSelectionRange(selection.caret, selection.caret);
		resizeTextarea();
	}
</script>

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
			{@attach captureTextarea}
			value={draft}
			rows="1"
			aria-autocomplete="list"
			aria-controls={autocompleteAria.controls}
			aria-activedescendant={autocompleteAria.activeDescendant}
			aria-haspopup="listbox"
			oninput={handleDraftInput}
			onkeydown={handleKeydown}
			onfocus={handleFocus}
			onblur={handleBlur}
			onselect={handleSelectionChange}
			onclick={handleSelectionChange}
			onpaste={onPaste}
			oncompositionstart={handleCompositionStart}
			oncompositionend={handleCompositionEnd}></textarea>

		<ComposerAutocomplete
			bind:this={autocomplete}
			bind:aria={autocompleteAria}
			{inputId}
			{projectId}
			{runtimeId}
			onSelect={handleAutocompleteSelection}
		/>
	</div>

	<div class="composer-actions">
		{#if isStreaming}
			<button
				class="stop-action"
				type="button"
				aria-label="Stop response"
				disabled={!onStop}
				onclick={() => onStop?.()}
			>
				<span aria-hidden="true"></span>
			</button>
		{:else}
			<button class="send-action" type="submit" disabled={submitDisabled} aria-label="Send message">
				<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
					<path d="M10 15.5V4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
					<path
						d="M5.75 8.75L10 4.5L14.25 8.75"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</button>
		{/if}
	</div>
</div>

<style>
	.input-row {
		display: flex;
		align-items: flex-end;
		gap: 0.65rem;
		padding: 0.65rem;
	}

	.textarea-wrap {
		position: relative;
		isolation: isolate;
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

	@media (prefers-reduced-motion: reduce) {
		.send-action,
		.stop-action {
			transition: none;
		}
	}
</style>

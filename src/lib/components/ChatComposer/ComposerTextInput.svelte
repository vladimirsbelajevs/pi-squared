<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import {
		listProjectSlashCommands,
		listRuntimeSlashCommands,
		searchProjectFiles
	} from '$lib/harness/api';
	import type { ProjectFileSuggestion, SlashCommand } from '$lib/contracts';
	import {
		getChatAutocompleteToken,
		insertProjectFile,
		insertSlashCommand,
		rankSlashCommands,
		type ChatAutocompleteToken
	} from '../chat-autocomplete';

	type AutocompleteSuggestion =
		{ kind: 'command'; command: SlashCommand } | { kind: 'file'; file: ProjectFileSuggestion };

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

	let autocompleteListboxId = $derived(`${inputId}-autocomplete`);
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
	let isFocused = $state(false);
	let isComposing = $state(false);
	let dismissedToken = $state<string>();
	let selectedAutocompleteIndex = $state(0);
	let commands = $state.raw<SlashCommand[]>([]);
	let loadedCommandKey = $state<string>();
	let fileSuggestions = $state.raw<ProjectFileSuggestion[]>([]);
	let loadedFileKey = $state<string>();
	let commandController: AbortController | undefined;
	let fileController: AbortController | undefined;
	let fileDebounce: number | undefined;
	let fileGeneration = 0;
	let placeholder = $derived(placeholderExamples[placeholderIndex]);
	let detectedAutocompleteToken = $derived.by(() => getChatAutocompleteToken(draft, caret));
	let activeAutocompleteToken = $derived.by(() => {
		if (!isFocused || isComposing || !detectedAutocompleteToken) {
			return undefined;
		}
		return tokenKey(detectedAutocompleteToken) === dismissedToken
			? undefined
			: detectedAutocompleteToken;
	});
	let expectedCommandKey = $derived(commandRequestKey());
	let expectedFileKey = $derived.by(() => {
		if (activeAutocompleteToken?.kind !== 'file' || !projectId) {
			return undefined;
		}
		return fileRequestKey(activeAutocompleteToken);
	});
	let autocompleteSuggestions = $derived.by((): AutocompleteSuggestion[] => {
		if (activeAutocompleteToken?.kind === 'command') {
			if (loadedCommandKey !== expectedCommandKey) {
				return [];
			}
			return rankSlashCommands(commands, activeAutocompleteToken.query).map((command) => ({
				kind: 'command',
				command
			}));
		}

		if (activeAutocompleteToken?.kind === 'file' && loadedFileKey === expectedFileKey) {
			return fileSuggestions.map((file) => ({ kind: 'file', file }));
		}

		return [];
	});
	let normalizedAutocompleteIndex = $derived(
		autocompleteSuggestions.length
			? ((selectedAutocompleteIndex % autocompleteSuggestions.length) +
					autocompleteSuggestions.length) %
					autocompleteSuggestions.length
			: 0
	);
	let activeSuggestion = $derived(autocompleteSuggestions[normalizedAutocompleteIndex]);
	let menuOpen = $derived(autocompleteSuggestions.length > 0);
	let activeDescendant = $derived(
		menuOpen ? autocompleteOptionId(normalizedAutocompleteIndex) : undefined
	);

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

	onDestroy(() => {
		commandController?.abort();
		cancelFileSearch();
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
		dismissedToken = undefined;
		if (isComposing) {
			resizeTextarea();
			return;
		}
		selectedAutocompleteIndex = 0;
		syncAutocomplete(target);
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

	function tokenKey(token: ChatAutocompleteToken): string {
		return `${token.kind}:${token.start}:${token.end}:${token.query}`;
	}

	function commandRequestKey(): string | undefined {
		if (runtimeId) {
			return `runtime:${runtimeId}`;
		}
		if (projectId) {
			return `project:${projectId}`;
		}
		return undefined;
	}

	function fileRequestKey(token: Extract<ChatAutocompleteToken, { kind: 'file' }>): string {
		return `${projectId}\u0000${token.query}`;
	}

	function autocompleteOptionId(index: number): string {
		return `${autocompleteListboxId}-option-${index}`;
	}

	function cancelFileSearch(): void {
		if (fileDebounce !== undefined) {
			window.clearTimeout(fileDebounce);
		}
		fileDebounce = undefined;
		fileController?.abort();
		fileController = undefined;
		fileGeneration += 1;
	}

	async function loadCommands(): Promise<void> {
		const requestKey = commandRequestKey();
		if (!requestKey || loadedCommandKey === requestKey) {
			return;
		}

		commandController?.abort();
		const controller = new AbortController();
		commandController = controller;
		try {
			const response = runtimeId
				? await listRuntimeSlashCommands(runtimeId, controller.signal)
				: projectId
					? await listProjectSlashCommands(projectId, controller.signal)
					: undefined;
			if (!response || controller.signal.aborted || requestKey !== commandRequestKey()) {
				return;
			}
			commands = response.commands;
			loadedCommandKey = requestKey;
			selectedAutocompleteIndex = 0;
		} catch {
			// Autocomplete is optional; keep composing usable if suggestions cannot load.
		} finally {
			if (commandController === controller) {
				commandController = undefined;
			}
		}
	}

	function queueFileSearch(token: Extract<ChatAutocompleteToken, { kind: 'file' }>): void {
		if (!projectId) {
			return;
		}
		cancelFileSearch();
		const searchProjectId = projectId;
		const requestKey = fileRequestKey(token);
		const generation = fileGeneration;
		const controller = new AbortController();
		fileController = controller;
		fileDebounce = window.setTimeout(async () => {
			fileDebounce = undefined;
			try {
				const response = await searchProjectFiles(searchProjectId, token.query, controller.signal);
				if (
					controller.signal.aborted ||
					generation !== fileGeneration ||
					requestKey !== expectedFileKey
				) {
					return;
				}
				fileSuggestions = response.files;
				loadedFileKey = requestKey;
				selectedAutocompleteIndex = 0;
			} catch {
				// File completion must never interfere with normal composition.
			} finally {
				if (fileController === controller) {
					fileController = undefined;
				}
			}
		}, 180);
	}

	function syncAutocomplete(target: HTMLTextAreaElement): void {
		caret = target.selectionStart ?? target.value.length;
		const token = getChatAutocompleteToken(target.value, caret);
		if (token?.kind === 'command') {
			void loadCommands();
		} else if (token?.kind === 'file') {
			queueFileSearch(token);
		} else {
			cancelFileSearch();
		}
	}

	function handleFocus(event: FocusEvent): void {
		isFocused = true;
		syncAutocomplete(event.currentTarget as HTMLTextAreaElement);
		void loadCommands();
	}

	function handleBlur(): void {
		isFocused = false;
	}

	function handleSelectionChange(event: Event): void {
		syncAutocomplete(event.currentTarget as HTMLTextAreaElement);
	}

	function handleCompositionStart(): void {
		isComposing = true;
		cancelFileSearch();
	}

	function handleCompositionEnd(event: CompositionEvent): void {
		isComposing = false;
		dismissedToken = undefined;
		syncAutocomplete(event.currentTarget as HTMLTextAreaElement);
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.isComposing || isComposing) {
			return;
		}

		if (event.key === 'Escape' && activeAutocompleteToken) {
			dismissedToken = tokenKey(activeAutocompleteToken);
			cancelFileSearch();
			return;
		}

		if (menuOpen) {
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				selectedAutocompleteIndex = normalizedAutocompleteIndex + 1;
				return;
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				selectedAutocompleteIndex = normalizedAutocompleteIndex - 1;
				return;
			}
			if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
				event.preventDefault();
				if (activeSuggestion) {
					void selectAutocompleteSuggestion(activeSuggestion);
				}
				return;
			}
		}

		submitOnEnter(event);
	}

	async function selectAutocompleteSuggestion(suggestion: AutocompleteSuggestion): Promise<void> {
		const token = activeAutocompleteToken;
		if (!token) {
			return;
		}

		let insertion: ReturnType<typeof insertSlashCommand>;
		if (suggestion.kind === 'command' && token.kind === 'command') {
			insertion = insertSlashCommand(draft, token, suggestion.command.name);
		} else if (suggestion.kind === 'file' && token.kind === 'file') {
			insertion = insertProjectFile(draft, token, suggestion.file.path);
		} else {
			return;
		}
		onDraftChange(insertion.value);
		caret = insertion.caret;
		selectedAutocompleteIndex = 0;
		cancelFileSearch();

		await tick();
		textarea?.focus();
		textarea?.setSelectionRange(insertion.caret, insertion.caret);
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
			aria-controls={menuOpen ? autocompleteListboxId : undefined}
			aria-activedescendant={activeDescendant}
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

		{#if menuOpen}
			<div
				id={autocompleteListboxId}
				class="autocomplete-menu"
				role="listbox"
				aria-label="Autocomplete suggestions"
			>
				{#each autocompleteSuggestions as suggestion, index (suggestion.kind === 'command' ? suggestion.command.name : suggestion.file.path)}
					<button
						id={autocompleteOptionId(index)}
						type="button"
						role="option"
						tabindex={-1}
						class={['autocomplete-option', { selected: index === normalizedAutocompleteIndex }]}
						aria-selected={index === normalizedAutocompleteIndex}
						onmousedown={(event) => event.preventDefault()}
						onclick={() => void selectAutocompleteSuggestion(suggestion)}
					>
						{#if suggestion.kind === 'command'}
							<span class="autocomplete-primary">/{suggestion.command.name}</span>
							{#if suggestion.command.description}
								<span class="autocomplete-description">{suggestion.command.description}</span>
							{/if}
						{:else}
							<span class="autocomplete-primary">@{suggestion.file.path}</span>
							<span class="autocomplete-description">Project file</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
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

	.autocomplete-menu {
		position: absolute;
		z-index: 3;
		bottom: calc(100% + 0.45rem);
		left: 0.2rem;
		display: grid;
		width: min(100% - 0.4rem, 34rem);
		max-height: min(15rem, 46vh);
		overflow-y: auto;
		border: 1px solid var(--border-strong);
		border-radius: 0.65rem;
		background: color-mix(in srgb, var(--surface) 96%, var(--canvas));
		padding: 0.25rem;
		box-shadow: 0 14px 30px var(--shadow);
	}

	.autocomplete-option {
		display: flex;
		align-items: baseline;
		min-width: 0;
		gap: 0.5rem;
		border: 0;
		border-radius: 0.42rem;
		background: transparent;
		color: var(--text);
		padding: 0.42rem 0.5rem;
		text-align: left;
		transition: background 120ms ease;
	}

	.autocomplete-option:hover,
	.autocomplete-option.selected {
		background: color-mix(in srgb, var(--accent) 15%, var(--surface-strong));
	}

	.autocomplete-option:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}

	.autocomplete-primary,
	.autocomplete-description {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.autocomplete-primary {
		flex: 0 1 auto;
		min-width: 0;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.78rem;
		font-weight: 600;
	}

	.autocomplete-description {
		min-width: 0;
		flex: 1 1 0;
		color: var(--text-muted);
		font-size: 0.68rem;
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

	@media (max-width: 700px) {
		.autocomplete-menu {
			left: 0;
			width: 100%;
			max-height: min(13rem, 42vh);
		}

		.autocomplete-option {
			display: grid;
			gap: 0.1rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.send-action,
		.stop-action,
		.autocomplete-option {
			transition: none;
		}
	}
</style>

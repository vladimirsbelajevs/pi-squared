<script lang="ts">
	import { onDestroy, onMount, tick, type Snippet } from 'svelte';
	import { fade } from 'svelte/transition';
	import {
		THINKING_LEVELS,
		type ChatSubmission,
		type ContextUsageSnapshot,
		type McpStatusSnapshot,
		type ModelOption,
		type PromptAttachment,
		type ProjectFileSuggestion,
		type SessionTokenUsage,
		type SlashCommand,
		type ThinkingLevel
	} from '$lib/contracts';
	import {
		attachmentDataUrl,
		attachmentKind,
		attachmentMimeType,
		MAX_ATTACHMENTS,
		MAX_IMAGE_BYTES,
		MAX_TEXT_FILE_BYTES,
		MAX_TOTAL_ATTACHMENT_BYTES,
		validatePromptAttachments
	} from '$lib/attachments';
	import {
		listProjectSlashCommands,
		listRuntimeSlashCommands,
		searchProjectFiles
	} from '$lib/harness/api';
	import {
		getChatAutocompleteToken,
		insertProjectFile,
		insertSlashCommand,
		rankSlashCommands,
		type ChatAutocompleteToken
	} from './chat-autocomplete';
	import type { TransientNotice } from '$lib/harness/types';
	import ComposerStatusPanel from './ComposerStatusPanel.svelte';
	import TransientNoticePopup from './TransientNoticePopup.svelte';

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
		showStatusPanel?: boolean;
		error?: string;
		transientNotices?: TransientNotice[];
		onClearTransientNotices?: () => void;
		overlay?: Snippet;
		mcpStatus?: McpStatusSnapshot;
		contextUsage?: ContextUsageSnapshot;
		sessionTokens?: SessionTokenUsage;
		onMcpToggle?: (serverName: string, enabled: boolean) => Promise<void>;
		projectName?: string;
		projectCwd?: string;
		projectId?: string;
		runtimeId?: string;
		onSend: (submission: ChatSubmission) => Promise<boolean>;
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
		showStatusPanel = true,
		error,
		transientNotices = [],
		onClearTransientNotices,
		overlay,
		mcpStatus,
		contextUsage,
		sessionTokens,
		onMcpToggle,
		projectName,
		projectCwd,
		projectId,
		runtimeId,
		onSend,
		onDraftChange,
		onStop,
		onModelChange,
		onThinkingChange,
		onQueueModeChange
	}: Props = $props();

	const inputId = $props.id();
	const autocompleteListboxId = `${inputId}-autocomplete`;
	const placeholderExamples = [
		'Find the cause of this failing test',
		'Implement the next feature',
		'Explain how this codebase works',
		'Review the current changes'
	];
	const placeholderTransition = { duration: 260 };
	const attachmentAccept =
		'image/png,image/jpeg,image/gif,image/webp,text/*,.txt,.md,.markdown,.json,.js,.mjs,.cjs,.ts,.mts,.cts,.jsx,.tsx,.css,.html,.htm,.xml,.yaml,.yml,.toml,.py,.rb,.go,.rs,.java,.c,.h,.cc,.cpp,.cxx,.hpp,.cs,.sh,.bash,.zsh,.fish,.sql,.csv';

	let submitting = $state(false);
	let localError = $state<string>();
	let placeholderIndex = $state(0);
	let textarea = $state<HTMLTextAreaElement>();
	let caret = $state(0);
	let isFocused = $state(false);
	let isComposing = $state(false);
	let dismissedToken = $state<string>();
	let selectedAutocompleteIndex = $state(0);
	let attachments = $state.raw<PromptAttachment[]>([]);
	let readingAttachmentCount = $state(0);
	let fileInput: HTMLInputElement | undefined;
	let commands = $state.raw<SlashCommand[]>([]);
	let loadedCommandKey = $state<string>();
	let fileSuggestions = $state.raw<ProjectFileSuggestion[]>([]);
	let loadedFileKey = $state<string>();
	let commandController: AbortController | undefined;
	let fileController: AbortController | undefined;
	let fileDebounce: number | undefined;
	let fileGeneration = 0;
	let selectedModel = $derived(models.find((model) => keyForModel(model) === modelKey));
	let selectedModelAllowsImages = $derived(
		selectedModel?.input === undefined || selectedModel.input.includes('image')
	);
	let submitDisabled = $derived(
		disabled ||
			submitting ||
			readingAttachmentCount > 0 ||
			(!draft.trim() && attachments.length === 0)
	);
	let placeholder = $derived(placeholderExamples[placeholderIndex]);
	let detectedAutocompleteToken = $derived.by(() => getChatAutocompleteToken(draft, caret));
	let activeAutocompleteToken = $derived.by(() => {
		if (!isFocused || isComposing || !detectedAutocompleteToken) return undefined;
		return tokenKey(detectedAutocompleteToken) === dismissedToken
			? undefined
			: detectedAutocompleteToken;
	});
	let expectedCommandKey = $derived(commandRequestKey());
	let expectedFileKey = $derived.by(() => {
		if (activeAutocompleteToken?.kind !== 'file' || !projectId) return undefined;
		return fileRequestKey(activeAutocompleteToken);
	});
	let autocompleteSuggestions = $derived.by((): AutocompleteSuggestion[] => {
		if (activeAutocompleteToken?.kind === 'command') {
			if (loadedCommandKey !== expectedCommandKey) return [];
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

		if (autoFocus && window.matchMedia('(min-width: 641px)').matches) textarea?.focus();
		resizeTextarea();

		return () => window.clearInterval(interval);
	});

	onDestroy(() => {
		commandController?.abort();
		cancelFileSearch();
	});

	function keyForModel(model: Pick<ModelOption, 'provider' | 'id'>): string {
		return `${model.provider}::${model.id}`;
	}

	function resizeTextarea(): void {
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = `${Math.min(textarea.scrollHeight, 192)}px`;
	}

	function captureTextarea(element: HTMLTextAreaElement): () => void {
		textarea = element;
		return () => {
			if (textarea === element) textarea = undefined;
		};
	}

	function captureFileInput(element: HTMLInputElement): () => void {
		fileInput = element;
		return () => {
			if (fileInput === element) fileInput = undefined;
		};
	}

	function updateDraft(value: string): void {
		draft = value;
		onDraftChange?.(value);
	}

	function formatFileSize(bytes: number): string {
		if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB'];
		const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
		const value = bytes / 1024 ** exponent;
		return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${
			units[exponent]
		}`;
	}

	function attachmentLimitError(kind: PromptAttachment['kind'], size: number): string | undefined {
		if (attachments.length >= MAX_ATTACHMENTS) {
			return `You can attach up to ${MAX_ATTACHMENTS} files.`;
		}

		const maximumSize = kind === 'image' ? MAX_IMAGE_BYTES : MAX_TEXT_FILE_BYTES;
		if (size > maximumSize) {
			return `${kind === 'image' ? 'Images' : 'Text files'} must be ${formatFileSize(
				maximumSize
			)} or smaller.`;
		}

		const totalSize = attachments.reduce((total, attachment) => total + attachment.size, 0);
		if (totalSize + size > MAX_TOTAL_ATTACHMENT_BYTES) {
			return `Attachments must total ${formatFileSize(MAX_TOTAL_ATTACHMENT_BYTES)} or less.`;
		}
	}

	function supportedAttachment(
		file: File
	): { kind: PromptAttachment['kind']; mimeType: string } | undefined {
		const kind = attachmentKind(file.name, file.type);
		const mimeType = attachmentMimeType(file.name, file.type);
		if (!kind || !mimeType) return undefined;
		return { kind, mimeType };
	}

	async function verifyUtf8Text(file: File): Promise<void> {
		try {
			const bytes = await file.arrayBuffer();
			new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		} catch {
			throw new Error(`“${file.name}” must be UTF-8 text.`);
		}
	}

	function readFileAsBase64(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onerror = () => reject(new Error(`Unable to read “${file.name}”.`));
			reader.onload = () => {
				if (typeof reader.result !== 'string') {
					reject(new Error(`Unable to read “${file.name}”.`));
					return;
				}
				const delimiter = reader.result.indexOf(',');
				if (delimiter === -1) {
					reject(new Error(`Unable to read “${file.name}”.`));
					return;
				}
				resolve(reader.result.slice(delimiter + 1));
			};
			reader.readAsDataURL(file);
		});
	}

	async function addFiles(files: Iterable<File>): Promise<void> {
		const selectedFiles = [...files];
		if (!selectedFiles.length) return;

		readingAttachmentCount += 1;
		localError = undefined;
		try {
			for (const file of selectedFiles) {
				const supported = supportedAttachment(file);
				if (!supported) {
					localError = `“${file.name}” is not a supported image or UTF-8 text/code file.`;
					continue;
				}
				if (supported.kind === 'image' && !selectedModelAllowsImages) {
					localError = 'The selected model does not support image attachments.';
					continue;
				}

				const limitError = attachmentLimitError(supported.kind, file.size);
				if (limitError) {
					localError = limitError;
					continue;
				}

				try {
					if (supported.kind === 'text') await verifyUtf8Text(file);
					const attachment: PromptAttachment = {
						id: crypto.randomUUID(),
						kind: supported.kind,
						name: file.name,
						mimeType: supported.mimeType,
						size: file.size,
						data: await readFileAsBase64(file)
					};
					validatePromptAttachments([...attachments, attachment]);
					attachments = [...attachments, attachment];
				} catch (error) {
					localError = error instanceof Error ? error.message : `Unable to attach “${file.name}”.`;
				}
			}
		} finally {
			readingAttachmentCount -= 1;
		}
	}

	function handleFileInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		void addFiles(files);
	}

	function handlePaste(event: ClipboardEvent): void {
		const files = Array.from(event.clipboardData?.items ?? []).flatMap((item) => {
			if (item.kind !== 'file') return [];
			const file = item.getAsFile();
			return file ? [file] : [];
		});
		void addFiles(files);
	}

	function removeAttachment(id: string): void {
		attachments = attachments.filter((attachment) => attachment.id !== id);
	}

	async function clearTransientNotices(): Promise<void> {
		onClearTransientNotices?.();
		await tick();
		textarea?.focus();
	}

	function handleDraftInput(event: Event): void {
		const target = event.currentTarget as HTMLTextAreaElement;
		updateDraft(target.value);
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
		if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
		event.preventDefault();
		if (!draft.trim() && !attachments.length) return;
		(event.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
	}

	function tokenKey(token: ChatAutocompleteToken): string {
		return `${token.kind}:${token.start}:${token.end}:${token.query}`;
	}

	function commandRequestKey(): string | undefined {
		if (runtimeId) return `runtime:${runtimeId}`;
		if (projectId) return `project:${projectId}`;
		return undefined;
	}

	function fileRequestKey(token: Extract<ChatAutocompleteToken, { kind: 'file' }>): string {
		return `${projectId}\u0000${token.query}`;
	}

	function autocompleteOptionId(index: number): string {
		return `${autocompleteListboxId}-option-${index}`;
	}

	function cancelFileSearch(): void {
		if (fileDebounce !== undefined) window.clearTimeout(fileDebounce);
		fileDebounce = undefined;
		fileController?.abort();
		fileController = undefined;
		fileGeneration += 1;
	}

	async function loadCommands(): Promise<void> {
		const requestKey = commandRequestKey();
		if (!requestKey || loadedCommandKey === requestKey) return;

		commandController?.abort();
		const controller = new AbortController();
		commandController = controller;
		try {
			const response = runtimeId
				? await listRuntimeSlashCommands(runtimeId, controller.signal)
				: projectId
					? await listProjectSlashCommands(projectId, controller.signal)
					: undefined;
			if (!response || controller.signal.aborted || requestKey !== commandRequestKey()) return;
			commands = response.commands;
			loadedCommandKey = requestKey;
			selectedAutocompleteIndex = 0;
		} catch {
			// Autocomplete is optional; keep composing usable if suggestions cannot load.
		} finally {
			if (commandController === controller) commandController = undefined;
		}
	}

	function queueFileSearch(token: Extract<ChatAutocompleteToken, { kind: 'file' }>): void {
		if (!projectId) return;
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
				)
					return;
				fileSuggestions = response.files;
				loadedFileKey = requestKey;
				selectedAutocompleteIndex = 0;
			} catch {
				// File completion must never interfere with normal composition.
			} finally {
				if (fileController === controller) fileController = undefined;
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
		if (event.isComposing || isComposing) return;

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
				if (activeSuggestion) void selectAutocompleteSuggestion(activeSuggestion);
				return;
			}
		}

		submitOnEnter(event);
	}

	type AutocompleteSuggestion =
		{ kind: 'command'; command: SlashCommand } | { kind: 'file'; file: ProjectFileSuggestion };

	async function selectAutocompleteSuggestion(suggestion: AutocompleteSuggestion): Promise<void> {
		const token = activeAutocompleteToken;
		if (!token) return;

		let insertion: ReturnType<typeof insertSlashCommand>;
		if (suggestion.kind === 'command' && token.kind === 'command') {
			insertion = insertSlashCommand(draft, token, suggestion.command.name);
		} else if (suggestion.kind === 'file' && token.kind === 'file') {
			insertion = insertProjectFile(draft, token, suggestion.file.path);
		} else {
			return;
		}
		updateDraft(insertion.value);
		caret = insertion.caret;
		selectedAutocompleteIndex = 0;
		cancelFileSearch();

		await tick();
		textarea?.focus();
		textarea?.setSelectionRange(insertion.caret, insertion.caret);
		resizeTextarea();
	}

	async function submitMessage(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const previousDraft = draft;
		const text = previousDraft.trim();
		const previousAttachments = attachments;
		if ((!text && !previousAttachments.length) || submitDisabled) return;
		if (
			previousAttachments.some((attachment) => attachment.kind === 'image') &&
			!selectedModelAllowsImages
		) {
			localError = 'The selected model does not support image attachments.';
			return;
		}

		localError = undefined;
		submitting = true;
		updateDraft('');
		attachments = [];
		await Promise.resolve();
		resizeTextarea();

		try {
			validatePromptAttachments(previousAttachments);
			if (!(await onSend({ text, attachments: previousAttachments }))) {
				updateDraft(previousDraft);
				attachments = previousAttachments;
				localError = 'Message was not accepted. Please try again.';
			}
		} catch (sendError) {
			updateDraft(previousDraft);
			attachments = previousAttachments;
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
	<input
		{@attach captureFileInput}
		class="visually-hidden"
		type="file"
		multiple
		accept={attachmentAccept}
		onchange={handleFileInput}
	/>
	<div class="composer-stack">
		{#if transientNotices.length || overlay}
			<div class="composer-popups">
				{#if transientNotices.length}
					<TransientNoticePopup notices={transientNotices} onClear={clearTransientNotices} />
				{/if}
				{@render overlay?.()}
			</div>
		{/if}
		{#if showStatusPanel}
			<ComposerStatusPanel
				status={mcpStatus}
				{contextUsage}
				{sessionTokens}
				onToggle={onMcpToggle}
				{projectName}
				{projectCwd}
				disabled={isStreaming || submitting}
			/>
		{/if}
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
						{@attach captureTextarea}
						bind:value={draft}
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
						onpaste={handlePaste}
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
									class={[
										'autocomplete-option',
										{ selected: index === normalizedAutocompleteIndex }
									]}
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
						<button
							class="send-action"
							type="submit"
							disabled={submitDisabled}
							aria-label="Send message"
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
					{/if}
				</div>
			</div>

			{#if attachments.length}
				<ul class="attachment-draft-list" aria-label="Attached files">
					{#each attachments as attachment, index (attachment.id)}
						<li class="attachment-draft-card">
							{#if attachment.kind === 'image'}
								<img
									class="attachment-thumbnail"
									src={attachmentDataUrl(attachment)}
									alt={`Preview of ${attachment.name}`}
								/>
							{:else}
								<span class="attachment-file-icon" aria-hidden="true">&lt;/&gt;</span>
							{/if}
							<span class="attachment-draft-details">
								<strong>{attachment.name}</strong>
								<small>{formatFileSize(attachment.size)}</small>
							</span>
							<button
								class="remove-attachment"
								type="button"
								aria-label={`Remove ${attachment.name} attachment ${index + 1}`}
								onclick={() => removeAttachment(attachment.id)}
							>
								×
							</button>
						</li>
					{/each}
				</ul>
			{/if}

			<div class="composer-footer">
				<button
					class="attach-action"
					type="button"
					aria-label="Attach files"
					title="Attach files"
					disabled={disabled || submitting || readingAttachmentCount > 0}
					onclick={() => fileInput?.click()}
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
						class="dropdown"
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
						<select class="dropdown" value={queueMode} onchange={changeQueueMode}>
							<option value="followUp">follow-up</option>
							<option value="steer">steer</option>
						</select>
					</label>
				{/if}

				<span class="keyboard-hint">Enter to send · Shift Enter for a new line</span>
			</div>
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

	.composer-stack {
		display: grid;
		position: relative;
		isolation: isolate;
		gap: 1rem;
	}

	.composer-popups {
		position: absolute;
		z-index: 4;
		right: 0;
		bottom: calc(100% + 0.5rem);
		left: 0;
		display: grid;
		max-height: min(28rem, 45dvh);
		gap: 0.5rem;
		overflow-y: auto;
	}

	.composer-popups :global(.transient-notice-popup),
	.composer-popups :global(.permission-request) {
		margin: 0;
	}

	.composer-stack > :global(.mcp-status) {
		margin-bottom: -2rem;
	}

	.composer-shell {
		position: relative;
		z-index: 1;
		border: 1px solid var(--border);
		border-radius: 0.8rem;
		background: var(--surface);
		transition:
			border-color 180ms ease,
			background 180ms ease;
	}

	.composer-shell:focus-within {
		border-color: var(--border-strong);
		background: color-mix(in srgb, var(--surface) 94%, var(--accent) 6%);
	}

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
	.stop-action,
	.attach-action {
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

	.attach-action {
		width: 1.9rem;
		height: 1.9rem;
		min-height: 1.9rem;
		border: 0;
		border-radius: 0.35rem;
		background: transparent;
		color: var(--text-muted);
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

	.attachment-draft-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		margin: -0.05rem 0 0;
		border-top: 1px solid var(--border);
		padding: 0.6rem 0.65rem;
		list-style: none;
	}

	.attachment-draft-card {
		display: flex;
		align-items: center;
		min-width: 0;
		max-width: min(100%, 18rem);
		gap: 0.45rem;
		border: 1px solid var(--border);
		border-radius: 0.45rem;
		background: var(--surface-muted);
		padding: 0.35rem;
	}

	.attachment-thumbnail,
	.attachment-file-icon {
		width: 2.25rem;
		height: 2.25rem;
		flex: 0 0 auto;
		border-radius: 0.3rem;
	}

	.attachment-thumbnail {
		object-fit: cover;
		background: var(--surface-strong);
	}

	.attachment-file-icon {
		display: grid;
		place-items: center;
		background: color-mix(in srgb, var(--accent) 12%, var(--surface-strong));
		color: var(--accent);
		font:
			600 0.62rem ui-monospace,
			SFMono-Regular,
			Menlo,
			Monaco,
			Consolas,
			monospace;
	}

	.attachment-draft-details {
		display: grid;
		min-width: 0;
		gap: 0.08rem;
	}

	.attachment-draft-details strong,
	.attachment-draft-details small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.attachment-draft-details strong {
		font-size: 0.72rem;
		font-weight: 600;
	}

	.attachment-draft-details small {
		color: var(--text-muted);
		font-size: 0.66rem;
	}

	.remove-attachment {
		display: grid;
		width: 1.45rem;
		height: 1.45rem;
		flex: 0 0 auto;
		place-items: center;
		border: 0;
		border-radius: 0.3rem;
		background: transparent;
		color: var(--text-muted);
		padding: 0;
		font-size: 1.1rem;
		line-height: 1;
	}

	.remove-attachment:hover,
	.remove-attachment:focus-visible {
		background: color-mix(in srgb, var(--danger) 12%, var(--surface));
		color: var(--danger);
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
		.composer-popups {
			max-height: min(22rem, 38dvh);
		}

		.autocomplete-menu {
			left: 0;
			width: 100%;
			max-height: min(13rem, 42vh);
		}

		.autocomplete-option {
			display: grid;
			gap: 0.1rem;
		}

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

		.autocomplete-option {
			transition: none;
		}
	}
</style>

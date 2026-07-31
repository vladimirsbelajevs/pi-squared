<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade } from 'svelte/transition';
	import type {
		ChatSubmission,
		ContextUsageSnapshot,
		McpStatusSnapshot,
		ModelOption,
		PromptAttachment,
		SessionTokenUsage,
		ThinkingLevel
	} from '$lib/contracts';
	import { validatePromptAttachments } from '$lib/attachments';
	import AttachmentPreview from '../AttachmentPreview.svelte';
	import ComposerStatusPanel from '../ComposerStatusPanel.svelte';
	import ImageViewer, { type ImageViewerImage } from '../ImageViewer.svelte';
	import ComposerFooter from './ComposerFooter.svelte';
	import ComposerTextInput from './ComposerTextInput.svelte';
	import { ATTACHMENT_ACCEPT, createPromptAttachmentDrafts } from './attachment-draft';

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
		externalError?: string;
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
		externalError,
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

	let submitting = $state(false);
	let localError = $state<string>();
	let attachments = $state.raw<PromptAttachment[]>([]);
	let selectedImage = $state<ImageViewerImage>();
	let readingAttachmentCount = $state(0);
	let fileInput: HTMLInputElement | undefined;
	let selectedModel = $derived(
		models.find((model) => `${model.provider}::${model.id}` === modelKey)
	);
	let selectedModelAllowsImages = $derived(
		selectedModel?.input === undefined || selectedModel.input.includes('image')
	);
	let submitDisabled = $derived(
		disabled ||
			submitting ||
			readingAttachmentCount > 0 ||
			(!draft.trim() && attachments.length === 0)
	);

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

	async function addFiles(files: readonly File[]): Promise<void> {
		if (!files.length) return;

		readingAttachmentCount += 1;
		localError = undefined;
		try {
			const result = await createPromptAttachmentDrafts(
				files,
				attachments,
				selectedModelAllowsImages
			);
			attachments = [...attachments, ...result.attachments];
			localError = result.errors.at(-1);
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

	function openImageViewer(image: ImageViewerImage): void {
		selectedImage = image;
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
		}
	}
</script>

<form class="chat-composer" aria-busy={submitting} onsubmit={submitMessage}>
	<label class="visually-hidden" for={inputId}>Message Pi</label>
	<input
		{@attach captureFileInput}
		class="visually-hidden"
		type="file"
		multiple
		accept={ATTACHMENT_ACCEPT}
		onchange={handleFileInput}
	/>
	<div class="composer-stack">
		{#if overlay}
			<div class="composer-popups">
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
			<ComposerTextInput
				{inputId}
				{draft}
				{projectId}
				{runtimeId}
				{autoFocus}
				{isStreaming}
				hasAttachments={attachments.length > 0}
				{submitDisabled}
				onDraftChange={updateDraft}
				onPaste={handlePaste}
				{onStop}
			/>

			{#if attachments.length}
				<ul class="attachment-draft-list" aria-label="Attached files">
					{#each attachments as attachment, index (attachment.id)}
						<AttachmentPreview
							{attachment}
							onOpen={openImageViewer}
							onRemove={() => removeAttachment(attachment.id)}
							removeLabel={`Remove ${attachment.name} attachment ${index + 1}`}
						/>
					{/each}
				</ul>
			{/if}

			<ComposerFooter
				{models}
				{modelKey}
				{thinkingLevel}
				{queueMode}
				{isStreaming}
				{disabled}
				{submitting}
				readingAttachments={readingAttachmentCount > 0}
				{selectedModel}
				onAttach={() => fileInput?.click()}
				{onModelChange}
				{onThinkingChange}
				onQueueModeChange={(mode) => onQueueModeChange?.(mode)}
			/>
		</div>
	</div>

	{#if externalError || localError}
		<p class="composer-error" role="alert" transition:fade={{ duration: 160 }}>
			{externalError || localError}
		</p>
	{/if}
</form>

<ImageViewer bind:image={selectedImage} />

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

	.attachment-draft-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		margin: -0.05rem 0 0;
		border-top: 1px solid var(--border);
		padding: 0.6rem 0.65rem;
		list-style: none;
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

		.composer-shell {
			border-radius: 1.1rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.composer-shell {
			transition: none;
		}
	}
</style>

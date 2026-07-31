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
	import {
		attachmentKind,
		attachmentMimeType,
		MAX_ATTACHMENTS,
		MAX_IMAGE_BYTES,
		MAX_TEXT_FILE_BYTES,
		MAX_TOTAL_ATTACHMENT_BYTES,
		validatePromptAttachments
	} from '$lib/attachments';
	import AttachmentPreview from '../AttachmentPreview.svelte';
	import ComposerStatusPanel from '../ComposerStatusPanel.svelte';
	import ImageViewer, { type ImageViewerImage } from '../ImageViewer.svelte';
	import ComposerFooter from './ComposerFooter.svelte';
	import ComposerTextInput from './ComposerTextInput.svelte';

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
	const attachmentAccept =
		'image/png,image/jpeg,image/gif,image/webp,text/*,.txt,.md,.markdown,.json,.js,.mjs,.cjs,.ts,.mts,.cts,.jsx,.tsx,.css,.html,.htm,.xml,.yaml,.yml,.toml,.py,.rb,.go,.rs,.java,.c,.h,.cc,.cpp,.cxx,.hpp,.cs,.sh,.bash,.zsh,.fish,.sql,.csv';

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
		accept={attachmentAccept}
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

	{#if error || localError}
		<p class="composer-error" role="alert" transition:fade={{ duration: 160 }}>
			{error || localError}
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

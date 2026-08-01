<script lang="ts">
	import { attachmentDataUrl } from '$lib/attachments';

	type Attachment = {
		id: string;
		kind: 'image' | 'text';
		name: string;
		mimeType: string;
		size: number;
		data?: string;
	};

	type PreviewImage = {
		name: string;
		src: string;
	};

	type Props = {
		attachment: Attachment;
		onOpen: (image: PreviewImage) => void;
		onRemove?: () => void;
		removeLabel?: string;
	};

	let { attachment, onOpen, onRemove, removeLabel }: Props = $props();
	let preview = $derived(attachmentDataUrl(attachment));

	function attachmentName(): string {
		return attachment.name || 'Unnamed attachment';
	}

	function formatFileSize(bytes: number): string {
		if (!Number.isFinite(bytes) || bytes <= 0) {
			return '0 B';
		}

		const units = ['B', 'KB', 'MB', 'GB'];
		const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
		const value = bytes / 1024 ** exponent;

		return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${
			units[exponent]
		}`;
	}
</script>

<li class="attachment-preview">
	{#if preview}
		<button
			class="attachment-preview-thumbnail-button"
			type="button"
			aria-label={`Open preview of ${attachmentName()}`}
			onclick={() => onOpen({ name: attachmentName(), src: preview })}
		>
			<img
				class="attachment-preview-thumbnail"
				src={preview}
				alt={`Preview of ${attachmentName()}`}
			/>
		</button>
	{:else}
		<span class="attachment-preview-file-icon" aria-hidden="true"
			>{attachment.kind === 'image' ? 'Image' : '</>'}</span
		>
	{/if}
	<span class="attachment-preview-details">
		<strong>{attachmentName()}</strong>
		<small>{formatFileSize(attachment.size)}</small>
	</span>
	{#if onRemove}
		<button
			class="attachment-preview-remove"
			type="button"
			aria-label={removeLabel ?? `Remove ${attachmentName()} attachment`}
			onclick={onRemove}
		>
			×
		</button>
	{/if}
</li>

<style>
	.attachment-preview {
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

	.attachment-preview-thumbnail-button,
	.attachment-preview-file-icon {
		width: 2.25rem;
		height: 2.25rem;
		flex: 0 0 auto;
		border-radius: 0.3rem;
	}

	.attachment-preview-thumbnail-button {
		overflow: hidden;
		border: 0;
		background: var(--surface-strong);
		padding: 0;
		cursor: zoom-in;
	}

	.attachment-preview-thumbnail-button:hover {
		outline: 1px solid var(--accent);
	}

	.attachment-preview-thumbnail-button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.attachment-preview-thumbnail {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		background: var(--surface-strong);
	}

	.attachment-preview-file-icon {
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

	.attachment-preview-details {
		display: grid;
		min-width: 0;
		gap: 0.08rem;
	}

	.attachment-preview-details strong,
	.attachment-preview-details small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.attachment-preview-details strong {
		font-size: 0.72rem;
		font-weight: 600;
	}

	.attachment-preview-details small {
		color: var(--text-muted);
		font-size: 0.66rem;
	}

	.attachment-preview-remove {
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

	.attachment-preview-remove:hover,
	.attachment-preview-remove:focus-visible {
		background: color-mix(in srgb, var(--danger) 12%, var(--surface));
		color: var(--danger);
	}
</style>

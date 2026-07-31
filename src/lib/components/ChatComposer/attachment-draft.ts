import type { PromptAttachment } from '$lib/contracts';
import {
	attachmentKind,
	attachmentMimeType,
	MAX_ATTACHMENTS,
	MAX_IMAGE_BYTES,
	MAX_TEXT_FILE_BYTES,
	MAX_TOTAL_ATTACHMENT_BYTES
} from '$lib/attachments';

export type AttachmentClassification = Pick<PromptAttachment, 'kind' | 'mimeType'>;

export function classifyAttachment(
	name: string,
	mimeType: string
): AttachmentClassification | undefined {
	const kind = attachmentKind(name, mimeType);
	const resolvedMimeType = attachmentMimeType(name, mimeType);
	if (!kind || !resolvedMimeType) return undefined;
	return { kind, mimeType: resolvedMimeType };
}

export function attachmentLimitError(
	existing: readonly Pick<PromptAttachment, 'size'>[],
	kind: PromptAttachment['kind'],
	size: number
): string | undefined {
	if (existing.length >= MAX_ATTACHMENTS) {
		return `You can attach up to ${MAX_ATTACHMENTS} files.`;
	}

	const maximumSize = kind === 'image' ? MAX_IMAGE_BYTES : MAX_TEXT_FILE_BYTES;
	if (size > maximumSize) {
		return `${kind === 'image' ? 'Images' : 'Text files'} must be ${formatFileSize(
			maximumSize
		)} or smaller.`;
	}

	const totalSize = existing.reduce((total, attachment) => total + attachment.size, 0);
	if (totalSize + size > MAX_TOTAL_ATTACHMENT_BYTES) {
		return `Attachments must total ${formatFileSize(MAX_TOTAL_ATTACHMENT_BYTES)} or less.`;
	}
}

export async function verifyUtf8Text(file: File): Promise<void> {
	try {
		new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(await file.arrayBuffer()));
	} catch {
		throw new Error(`“${file.name}” must be UTF-8 text.`);
	}
}

export async function readFileAsBase64(file: File): Promise<string> {
	try {
		const bytes = new Uint8Array(await file.arrayBuffer());
		let binary = '';
		const chunkSize = 0x8000;
		for (let start = 0; start < bytes.length; start += chunkSize) {
			binary += String.fromCharCode(...bytes.subarray(start, start + chunkSize));
		}
		return btoa(binary);
	} catch {
		throw new Error(`Unable to read “${file.name}”.`);
	}
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

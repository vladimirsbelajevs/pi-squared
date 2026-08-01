import type { PromptAttachment } from '$lib/contracts';
import {
	attachmentKind,
	attachmentMimeType,
	MAX_ATTACHMENTS,
	MAX_IMAGE_BYTES,
	MAX_TEXT_FILE_BYTES,
	MAX_TOTAL_ATTACHMENT_BYTES,
	validatePromptAttachments
} from '$lib/attachments';

export const ATTACHMENT_ACCEPT =
	'image/png,image/jpeg,image/gif,image/webp,text/*,.txt,.md,.markdown,.json,.js,.mjs,.cjs,.ts,.mts,.cts,.jsx,.tsx,.css,.html,.htm,.xml,.yaml,.yml,.toml,.py,.rb,.go,.rs,.java,.c,.h,.cc,.cpp,.cxx,.hpp,.cs,.sh,.bash,.zsh,.fish,.sql,.csv';

export type AttachmentClassification = Pick<PromptAttachment, 'kind' | 'mimeType'>;

export function classifyAttachment(
	name: string,
	mimeType: string
): AttachmentClassification | undefined {
	const kind = attachmentKind(name, mimeType);
	const resolvedMimeType = attachmentMimeType(name, mimeType);
	if (!kind || !resolvedMimeType) {
		return undefined;
	}

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

export async function createPromptAttachmentDrafts(
	files: readonly File[],
	existing: readonly PromptAttachment[],
	allowsImages: boolean
): Promise<{ attachments: PromptAttachment[]; errors: string[] }> {
	const attachments: PromptAttachment[] = [];
	const errors: string[] = [];

	for (const file of files) {
		const supported = classifyAttachment(file.name, file.type);
		if (!supported) {
			errors.push(`“${file.name}” is not a supported image or UTF-8 text/code file.`);
			continue;
		}

		if (supported.kind === 'image' && !allowsImages) {
			errors.push('The selected model does not support image attachments.');
			continue;
		}

		const limitError = attachmentLimitError(
			[...existing, ...attachments],
			supported.kind,
			file.size
		);
		if (limitError) {
			errors.push(limitError);
			continue;
		}

		try {
			if (supported.kind === 'text') {
				await verifyUtf8Text(file);
			}

			const attachment: PromptAttachment = {
				id: crypto.randomUUID(),
				kind: supported.kind,
				name: file.name,
				mimeType: supported.mimeType,
				size: file.size,
				data: await readFileAsBase64(file)
			};
			validatePromptAttachments([...existing, ...attachments, attachment]);
			attachments.push(attachment);
		} catch (error) {
			errors.push(error instanceof Error ? error.message : `Unable to attach “${file.name}”.`);
		}
	}

	return { attachments, errors };
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

import type { ChatAttachmentKind, PromptAttachment } from '$lib/contracts';

export const MAX_ATTACHMENTS = 5;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_TEXT_FILE_BYTES = 512 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const IMAGE_MIME_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);
const TEXT_MIME_TYPES = new Set([
	'application/graphql',
	'application/javascript',
	'application/json',
	'application/sql',
	'application/toml',
	'application/typescript',
	'application/x-sh',
	'application/xml',
	'application/x-yaml',
	'application/yaml',
	'text/css',
	'text/csv',
	'text/html',
	'text/javascript',
	'text/markdown',
	'text/plain',
	'text/typescript',
	'text/xml'
]);
const TEXT_FILE_EXTENSIONS = new Set([
	'c',
	'cc',
	'conf',
	'cpp',
	'cs',
	'css',
	'csv',
	'cts',
	'dockerfile',
	'env',
	'go',
	'graphql',
	'gql',
	'h',
	'hpp',
	'html',
	'ini',
	'java',
	'js',
	'json',
	'jsx',
	'kt',
	'kts',
	'log',
	'md',
	'mdwn',
	'mjs',
	'mts',
	'php',
	'py',
	'rb',
	'rs',
	'scss',
	'sh',
	'sql',
	'svelte',
	'toml',
	'ts',
	'tsx',
	'txt',
	'xml',
	'yaml',
	'yml'
]);
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
	gif: 'image/gif',
	jpeg: 'image/jpeg',
	jpg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp'
};

function extensionFor(name: string): string | undefined {
	const normalized = name.trim().toLowerCase();
	if (normalized === 'dockerfile') {
		return 'dockerfile';
	}

	const index = normalized.lastIndexOf('.');

	return index > 0 && index < normalized.length - 1 ? normalized.slice(index + 1) : undefined;
}

export function attachmentKind(name: string, mimeType: string): ChatAttachmentKind | undefined {
	const normalizedMimeType = mimeType.toLowerCase().split(';', 1)[0].trim();
	if (
		IMAGE_MIME_TYPES.has(normalizedMimeType) ||
		IMAGE_MIME_BY_EXTENSION[extensionFor(name) ?? '']
	) {
		return 'image';
	}

	if (TEXT_MIME_TYPES.has(normalizedMimeType) || normalizedMimeType.startsWith('text/')) {
		return 'text';
	}

	return TEXT_FILE_EXTENSIONS.has(extensionFor(name) ?? '') ? 'text' : undefined;
}

export function attachmentMimeType(name: string, mimeType: string): string | undefined {
	const normalizedMimeType = mimeType.toLowerCase().split(';', 1)[0].trim();
	const kind = attachmentKind(name, normalizedMimeType);
	if (!kind) {
		return undefined;
	}

	if (kind === 'image') {
		return IMAGE_MIME_TYPES.has(normalizedMimeType)
			? normalizedMimeType
			: IMAGE_MIME_BY_EXTENSION[extensionFor(name) ?? ''];
	}

	return TEXT_MIME_TYPES.has(normalizedMimeType) || normalizedMimeType.startsWith('text/')
		? normalizedMimeType
		: 'text/plain';
}

export function hasExpectedImageSignature(mimeType: string, bytes: Uint8Array): boolean {
	if (mimeType === 'image/png') {
		const signature = [137, 80, 78, 71, 13, 10, 26, 10];

		return (
			bytes.length >= signature.length && signature.every((byte, index) => byte === bytes[index])
		);
	}

	if (mimeType === 'image/jpeg') {
		return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
	}

	if (mimeType === 'image/gif') {
		const header = String.fromCharCode(...bytes.slice(0, 6));

		return header === 'GIF87a' || header === 'GIF89a';
	}

	return (
		bytes.length >= 12 &&
		String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
		String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
	);
}

export function attachmentDataUrl(attachment: {
	kind: PromptAttachment['kind'];
	mimeType: string;
	data?: string;
}): string | undefined {
	return attachment.kind === 'image' && attachment.data
		? `data:${attachment.mimeType};base64,${attachment.data}`
		: undefined;
}

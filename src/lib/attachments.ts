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

function decodedBytes(data: string): Uint8Array {
	if (!data || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
		throw new Error('Attachment data must be valid base64.');
	}
	const binary = atob(data);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

function hasExpectedImageSignature(mimeType: string, bytes: Uint8Array): boolean {
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

function validId(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function validName(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.trim().length > 0 &&
		value.length <= 255 &&
		[...value].every(
			(character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127
		)
	);
}

/**
 * Revalidates browser-provided attachment payloads before their bytes enter a Pi session.
 * It is intentionally isomorphic so the composer can use the same limits and MIME policy.
 */
export function validatePromptAttachments(value: unknown): PromptAttachment[] {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw new Error('Attachments must be an array.');
	}
	if (value.length > MAX_ATTACHMENTS) {
		throw new Error(`Attach at most ${MAX_ATTACHMENTS} files.`);
	}

	let totalSize = 0;
	return value.map((candidate, index) => {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			throw new Error(`Attachment ${index + 1} is invalid.`);
		}
		const attachment = candidate as Record<string, unknown>;
		if (!validId(attachment.id)) {
			throw new Error(`Attachment ${index + 1} needs an ID.`);
		}
		if (!validName(attachment.name)) {
			throw new Error(`Attachment ${index + 1} has an invalid filename.`);
		}
		if (typeof attachment.mimeType !== 'string') {
			throw new Error(`Attachment ${index + 1} has an invalid MIME type.`);
		}
		if (typeof attachment.data !== 'string') {
			throw new Error(`Attachment ${index + 1} has no data.`);
		}
		if (
			typeof attachment.size !== 'number' ||
			!Number.isSafeInteger(attachment.size) ||
			attachment.size < 1
		) {
			throw new Error(`Attachment ${index + 1} has an invalid size.`);
		}

		const mimeType = attachmentMimeType(attachment.name, attachment.mimeType);
		const kind = mimeType ? attachmentKind(attachment.name, mimeType) : undefined;
		if (!mimeType || !kind) {
			throw new Error(`Unsupported attachment: ${attachment.name}.`);
		}
		if (attachment.kind !== kind) {
			throw new Error(`Attachment ${attachment.name} has an invalid kind.`);
		}

		const bytes = decodedBytes(attachment.data);
		if (bytes.length !== attachment.size) {
			throw new Error(`Attachment ${attachment.name} has an invalid size.`);
		}
		const maximumSize = kind === 'image' ? MAX_IMAGE_BYTES : MAX_TEXT_FILE_BYTES;
		if (bytes.length > maximumSize) {
			const limit =
				maximumSize >= 1024 * 1024
					? `${maximumSize / 1024 / 1024} MiB`
					: `${maximumSize / 1024} KiB`;
			throw new Error(`${attachment.name} exceeds the ${limit} limit.`);
		}
		totalSize += bytes.length;
		if (totalSize > MAX_TOTAL_ATTACHMENT_BYTES) {
			throw new Error(
				`Attachments exceed the ${MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024} MiB total limit.`
			);
		}
		if (kind === 'image' && !hasExpectedImageSignature(mimeType, bytes)) {
			throw new Error(`${attachment.name} does not match its image type.`);
		}
		if (kind === 'text') {
			try {
				new TextDecoder('utf-8', { fatal: true }).decode(bytes);
			} catch {
				throw new Error(`${attachment.name} is not valid UTF-8 text.`);
			}
		}

		return {
			id: attachment.id,
			kind,
			name: attachment.name,
			mimeType,
			size: bytes.length,
			data: attachment.data
		};
	});
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

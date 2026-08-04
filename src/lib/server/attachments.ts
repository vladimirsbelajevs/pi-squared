import type { PromptAttachment } from '$lib/contracts';
import {
	attachmentKind,
	attachmentMimeType,
	hasExpectedImageSignature,
	MAX_ATTACHMENTS,
	MAX_IMAGE_BYTES,
	MAX_TEXT_FILE_BYTES,
	MAX_TOTAL_ATTACHMENT_BYTES
} from '$lib/attachments';

type ValidatedAttachmentMetadata = Omit<PromptAttachment, 'data'>;

declare const validatedPromptAttachmentBrand: unique symbol;
type ValidatedPromptAttachmentBrand = {
	readonly [validatedPromptAttachmentBrand]: true;
};

type ValidatedPromptAttachmentContent =
	| (ValidatedAttachmentMetadata & {
			kind: 'image';
			bytes: Uint8Array;
			/** The original base64 is retained for Pi's image content block API. */
			data: string;
	  })
	| (ValidatedAttachmentMetadata & {
			kind: 'text';
			bytes: Uint8Array;
			/** Decoded once at the HTTP boundary for prompt persistence. */
			text: string;
	  });

export type ValidatedPromptAttachment = ValidatedPromptAttachmentContent &
	ValidatedPromptAttachmentBrand;

function decodeAttachmentBase64(data: string): Uint8Array {
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

function invalidSizeMessage(name: string, maximumSize: number): string {
	const limit =
		maximumSize >= 1024 * 1024 ? `${maximumSize / 1024 / 1024} MiB` : `${maximumSize / 1024} KiB`;

	return `${name} exceeds the ${limit} limit.`;
}

/**
 * Validates untrusted prompt attachments and retains the decoded representation for the runtime.
 * This module is server-only by convention: its returned bytes must never cross the HTTP boundary.
 */
export function validatePromptAttachmentsAtHttpBoundary(
	value: unknown
): ValidatedPromptAttachment[] {
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

		const bytes = decodeAttachmentBase64(attachment.data);
		if (bytes.length !== attachment.size) {
			throw new Error(`Attachment ${attachment.name} has an invalid size.`);
		}

		const maximumSize = kind === 'image' ? MAX_IMAGE_BYTES : MAX_TEXT_FILE_BYTES;
		if (bytes.length > maximumSize) {
			throw new Error(invalidSizeMessage(attachment.name, maximumSize));
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
			let text: string;
			try {
				text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
			} catch {
				throw new Error(`${attachment.name} is not valid UTF-8 text.`);
			}

			return {
				id: attachment.id,
				kind,
				name: attachment.name,
				mimeType,
				size: bytes.length,
				bytes,
				text
			} as ValidatedPromptAttachment;
		}

		return {
			id: attachment.id,
			kind,
			name: attachment.name,
			mimeType,
			size: bytes.length,
			bytes,
			data: attachment.data
		} as ValidatedPromptAttachment;
	});
}

import type { ChatAttachment, PromptAttachment } from '$lib/contracts';

const START = '\n\n<pi-squared-attachments>\n';
const END = '\n</pi-squared-attachments>';

type PromptAttachmentMetadata = Omit<PromptAttachment, 'data'>;

export type PromptAttachmentContent =
	| (PromptAttachmentMetadata & {
			kind: 'image';
			/** Retained for Pi's image content block API. */
			data: string;
	  })
	| (PromptAttachmentMetadata & {
			kind: 'text';
			/** Retained by HTTP-boundary validation; no base64 decode is needed here. */
			text: string;
	  });

type AttachmentManifest = {
	version: 1;
	visibleText: string;
	attachments: Array<{
		id: string;
		kind: 'image' | 'text';
		name: string;
		mimeType: string;
		size: number;
		text?: string;
	}>;
};

function attachmentManifest(
	visibleText: string,
	attachments: readonly PromptAttachmentContent[]
): AttachmentManifest {
	return {
		version: 1,
		visibleText,
		attachments: attachments.map((attachment) => ({
			id: attachment.id,
			kind: attachment.kind,
			name: attachment.name,
			mimeType: attachment.mimeType,
			size: attachment.size,
			...(attachment.kind === 'text' ? { text: attachment.text } : {})
		}))
	};
}

function attachmentOnlyInstruction(attachments: readonly PromptAttachmentContent[]): string {
	const hasImages = attachments.some((attachment) => attachment.kind === 'image');
	const hasTextFiles = attachments.some((attachment) => attachment.kind === 'text');
	if (hasImages && hasTextFiles) {
		return 'Review the attached files and images.';
	}

	if (hasImages) {
		return 'Describe the attached image or images.';
	}

	return 'Review the attached file or files.';
}

/** Formats text/code file contents into the persisted text prompt while images travel in Pi content blocks. */
export function promptWithAttachments(
	visibleText: string,
	attachments: readonly PromptAttachmentContent[]
): string {
	if (!attachments.length) {
		return visibleText;
	}

	const basePrompt = visibleText || attachmentOnlyInstruction(attachments);

	return `${basePrompt}${START}${JSON.stringify(attachmentManifest(visibleText, attachments))}${END}`;
}

function manifestFrom(value: unknown): AttachmentManifest | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}

	const manifest = value as Record<string, unknown>;
	if (
		manifest.version !== 1 ||
		typeof manifest.visibleText !== 'string' ||
		!Array.isArray(manifest.attachments)
	) {
		return undefined;
	}

	const attachments: AttachmentManifest['attachments'] = manifest.attachments.flatMap(
		(attachment) => {
			if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) {
				return [];
			}

			const item = attachment as Record<string, unknown>;
			if (
				typeof item.id !== 'string' ||
				(item.kind !== 'image' && item.kind !== 'text') ||
				typeof item.name !== 'string' ||
				typeof item.mimeType !== 'string' ||
				typeof item.size !== 'number' ||
				!Number.isSafeInteger(item.size) ||
				item.size < 1 ||
				(item.kind === 'text' && typeof item.text !== 'string')
			) {
				return [];
			}

			return [
				{
					id: item.id,
					kind: item.kind as 'image' | 'text',
					name: item.name,
					mimeType: item.mimeType,
					size: item.size,
					...(item.kind === 'text' ? { text: item.text as string } : {})
				}
			];
		}
	);

	return attachments.length === manifest.attachments.length
		? { version: 1, visibleText: manifest.visibleText, attachments }
		: undefined;
}

export function userPromptFromStoredText(text: string): {
	text: string;
	attachments: Omit<ChatAttachment, 'data'>[];
} {
	const start = text.lastIndexOf(START);
	if (start === -1 || !text.endsWith(END)) {
		return { text, attachments: [] };
	}

	let manifest: AttachmentManifest | undefined;
	try {
		manifest = manifestFrom(JSON.parse(text.slice(start + START.length, -END.length)) as unknown);
	} catch {
		return { text, attachments: [] };
	}

	if (!manifest) {
		return { text, attachments: [] };
	}

	return {
		text: manifest.visibleText,
		attachments: manifest.attachments.map(({ id, kind, name, mimeType, size }) => ({
			id,
			kind,
			name,
			mimeType,
			size
		}))
	};
}

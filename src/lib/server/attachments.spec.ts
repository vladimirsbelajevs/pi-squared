import { describe, expect, it, vi } from 'vitest';
import { MAX_IMAGE_BYTES } from '$lib/attachments';
import { validatePromptAttachmentsAtHttpBoundary } from './attachments';

describe('HTTP-boundary attachment validation', () => {
	it('keeps the established total-limit error message', () => {
		const size = MAX_IMAGE_BYTES - 1;
		const binary = '\x89PNG\r\n\x1a\n' + 'a'.repeat(size - 8);
		const atobSpy = vi.spyOn(globalThis, 'atob').mockImplementation(() => binary);
		const attachments = Array.from({ length: 5 }, (_, index) => ({
			id: `image-${index}`,
			kind: 'image',
			name: `image-${index}.png`,
			mimeType: 'image/png',
			size,
			data: 'AAAA'
		}));

		try {
			expect(() => validatePromptAttachmentsAtHttpBoundary(attachments)).toThrow(
				'Attachments exceed the 20 MiB total limit.'
			);
			expect(atobSpy).toHaveBeenCalledTimes(5);
		} finally {
			atobSpy.mockRestore();
		}
	});
});

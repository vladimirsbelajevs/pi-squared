import { describe, expect, it, vi } from 'vitest';
import { promptWithAttachments, userPromptFromStoredText } from './prompt-attachments';

describe('prompt attachments', () => {
	it('keeps visible text separate from injected UTF-8 file content', () => {
		const prompt = promptWithAttachments('Review this.', [
			{
				id: 'text-1',
				kind: 'text',
				name: 'config.ts',
				mimeType: 'text/plain',
				size: 28,
				text: 'export const enabled = true;'
			}
		]);

		expect(prompt).toContain('export const enabled = true;');
		expect(userPromptFromStoredText(prompt)).toEqual({
			text: 'Review this.',
			attachments: [
				{
					id: 'text-1',
					kind: 'text',
					name: 'config.ts',
					mimeType: 'text/plain',
					size: 28
				}
			]
		});
	});

	it('uses server-retained text without decoding base64 again', () => {
		const atobSpy = vi.spyOn(globalThis, 'atob');
		const prompt = promptWithAttachments('Review this.', [
			{
				id: 'text-1',
				kind: 'text',
				name: 'config.ts',
				mimeType: 'text/plain',
				size: 5,
				text: 'Hello'
			}
		]);

		expect(prompt).toContain('Hello');
		expect(atobSpy).not.toHaveBeenCalled();
		atobSpy.mockRestore();
	});

	it('adds a private instruction for image-only prompts while retaining an empty visible message', () => {
		const prompt = promptWithAttachments('', [
			{
				id: 'image-1',
				kind: 'image',
				name: 'diagram.png',
				mimeType: 'image/png',
				size: 8,
				data: 'iVBORw0KGgo='
			}
		]);

		expect(prompt).toMatch(/^Describe the attached image or images\./);
		expect(userPromptFromStoredText(prompt).text).toBe('');
	});

	it('uses a file-specific instruction for text/code-only prompts', () => {
		const prompt = promptWithAttachments('', [
			{
				id: 'text-1',
				kind: 'text',
				name: 'config.ts',
				mimeType: 'text/plain',
				size: 28,
				text: 'export const enabled = true;'
			}
		]);

		expect(prompt).toMatch(/^Review the attached file or files\./);
		expect(userPromptFromStoredText(prompt).text).toBe('');
	});

	it('leaves malformed stored attachment data visible as ordinary text', () => {
		const text = 'Before\n\n<pi-squared-attachments>\nnot json\n</pi-squared-attachments>';
		expect(userPromptFromStoredText(text)).toEqual({ text, attachments: [] });
	});
});

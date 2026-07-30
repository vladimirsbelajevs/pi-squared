import { describe, expect, it } from 'vitest';
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
				data: 'ZXhwb3J0IGNvbnN0IGVuYWJsZWQgPSB0cnVlOw=='
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
				data: 'ZXhwb3J0IGNvbnN0IGVuYWJsZWQgPSB0cnVlOw=='
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

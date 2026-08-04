import { describe, expect, it, vi } from 'vitest';
import {
	attachmentLimitError,
	classifyAttachment,
	createPromptAttachmentDrafts,
	readFileAsBase64,
	verifyUtf8Text
} from './attachment-draft';

describe('attachment draft helpers', () => {
	it('classifies supported files from MIME types and extensions', () => {
		expect(classifyAttachment('photo.JPG', '')).toEqual({
			kind: 'image',
			mimeType: 'image/jpeg'
		});
		expect(classifyAttachment('notes.TS', '')).toEqual({ kind: 'text', mimeType: 'text/plain' });
		expect(classifyAttachment('data.json', 'Application/JSON; charset=utf-8')).toEqual({
			kind: 'text',
			mimeType: 'application/json'
		});
		expect(classifyAttachment('archive.zip', 'application/zip')).toBeUndefined();
	});

	it('enforces count, per-file, and total attachment limits', () => {
		const existing = Array.from({ length: 5 }, () => ({ size: 1 }));
		expect(attachmentLimitError(existing, 'text', 1)).toBe('You can attach up to 5 files.');
		expect(attachmentLimitError([], 'text', 512 * 1024 + 1)).toBe(
			'Text files must be 512 KB or smaller.'
		);
		expect(attachmentLimitError([], 'image', 5 * 1024 * 1024 + 1)).toBe(
			'Images must be 5.0 MB or smaller.'
		);
		expect(attachmentLimitError([{ size: 20 * 1024 * 1024 }], 'text', 1)).toBe(
			'Attachments must total 20 MB or less.'
		);
	});

	it('accepts valid UTF-8 and reports invalid text with the filename', async () => {
		await expect(
			verifyUtf8Text(new File([new TextEncoder().encode('Hello, π')], 'notes.txt'))
		).resolves.toBeUndefined();
		await expect(
			verifyUtf8Text(new File([new Uint8Array([0xc3, 0x28])], 'bad.txt'))
		).rejects.toThrow('“bad.txt” must be UTF-8 text.');
	});

	it('preserves file read errors', async () => {
		const unreadableText = new File([], 'unreadable.txt');
		vi.spyOn(unreadableText, 'arrayBuffer').mockRejectedValue(new Error('read failed'));
		await expect(verifyUtf8Text(unreadableText)).rejects.toThrow(
			'“unreadable.txt” must be UTF-8 text.'
		);

		const unreadableBinary = new File([], 'unreadable.bin');
		vi.spyOn(unreadableBinary, 'arrayBuffer').mockRejectedValue(new Error('read failed'));
		await expect(readFileAsBase64(unreadableBinary)).rejects.toThrow(
			'Unable to read “unreadable.bin”.'
		);
	});

	it('encodes binary files as base64', async () => {
		await expect(
			readFileAsBase64(new File([new Uint8Array([0, 255, 10, 20])], 'data.bin'))
		).resolves.toBe('AP8KFA==');
	});

	it('reads a selected file once while preparing all browser feedback and encoding', async () => {
		const file = new File(['Hello, π'], 'notes.txt', { type: 'text/plain' });
		const arrayBuffer = vi.spyOn(file, 'arrayBuffer');

		const result = await createPromptAttachmentDrafts([file], [], true);

		expect(result.errors).toEqual([]);
		expect(result.attachments[0]).toMatchObject({
			name: 'notes.txt',
			kind: 'text',
			size: new TextEncoder().encode('Hello, π').length
		});
		expect(arrayBuffer).toHaveBeenCalledOnce();
	});

	it('rejects zero-byte files after one read during candidate preparation', async () => {
		const file = new File([], 'empty.txt', { type: 'text/plain' });
		const arrayBuffer = vi.spyOn(file, 'arrayBuffer');

		const result = await createPromptAttachmentDrafts([file], [], true);

		expect(result).toEqual({
			attachments: [],
			errors: ['“empty.txt” cannot be empty.']
		});
		expect(arrayBuffer).toHaveBeenCalledOnce();
	});

	it('reports a stable filename-specific error when candidate reading fails', async () => {
		const file = new File(['content'], 'unreadable.txt', { type: 'text/plain' });
		const arrayBuffer = vi
			.spyOn(file, 'arrayBuffer')
			.mockRejectedValue(new Error('private underlying read detail'));

		const result = await createPromptAttachmentDrafts([file], [], true);

		expect(result).toEqual({
			attachments: [],
			errors: ['Unable to read “unreadable.txt”.']
		});
		expect(arrayBuffer).toHaveBeenCalledOnce();
	});

	it('keeps browser checks local to the selected file instead of revalidating existing drafts', async () => {
		const result = await createPromptAttachmentDrafts(
			[new File(['new'], 'new.txt', { type: 'text/plain' })],
			[
				{
					id: 'existing',
					kind: 'text',
					name: 'existing.txt',
					mimeType: 'text/plain',
					size: 1,
					data: 'not base64'
				}
			],
			true
		);

		expect(result.attachments).toHaveLength(1);
		expect(result.errors).toEqual([]);
	});

	it('checks image signatures from the single selected-file buffer', async () => {
		const invalid = await createPromptAttachmentDrafts(
			[new File(['not png'], 'diagram.png', { type: 'image/png' })],
			[],
			true
		);
		expect(invalid).toEqual({
			attachments: [],
			errors: ['diagram.png does not match its image type.']
		});

		const valid = await createPromptAttachmentDrafts(
			[
				new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'diagram.png', {
					type: 'image/png'
				})
			],
			[],
			true
		);
		expect(valid.attachments).toHaveLength(1);
	});

	it('keeps accepted and rejected files in input order', async () => {
		const result = await createPromptAttachmentDrafts(
			[
				new File(['first'], 'first.txt', { type: 'text/plain' }),
				new File(['archive'], 'archive.zip', { type: 'application/zip' }),
				new File(['last'], 'last.md', { type: 'text/markdown' })
			],
			[],
			true
		);

		expect(result.attachments.map((attachment) => attachment.name)).toEqual([
			'first.txt',
			'last.md'
		]);
		expect(result.errors).toEqual([
			'“archive.zip” is not a supported image or UTF-8 text/code file.'
		]);
	});

	it('rejects images when the selected model cannot accept them', async () => {
		const result = await createPromptAttachmentDrafts(
			[new File(['not read'], 'diagram.png', { type: 'image/png' })],
			[],
			false
		);

		expect(result).toEqual({
			attachments: [],
			errors: ['The selected model does not support image attachments.']
		});
	});

	it('applies the cumulative attachment count limit while continuing through the batch', async () => {
		const existing = Array.from({ length: 4 }, (_, index) => ({
			id: `existing-${index}`,
			kind: 'text' as const,
			name: `existing-${index}.txt`,
			mimeType: 'text/plain',
			size: 1,
			data: 'YQ=='
		}));
		const result = await createPromptAttachmentDrafts(
			[
				new File(['first'], 'first.txt', { type: 'text/plain' }),
				new File(['second'], 'second.txt', { type: 'text/plain' })
			],
			existing,
			true
		);

		expect(result.attachments.map((attachment) => attachment.name)).toEqual(['first.txt']);
		expect(result.errors).toEqual(['You can attach up to 5 files.']);
	});
});

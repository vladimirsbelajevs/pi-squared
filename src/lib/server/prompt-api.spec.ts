import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeApi = vi.hoisted(() => ({ promptRuntime: vi.fn() }));

vi.mock('$lib/server/runtimes', () => runtimeApi);

import {
	MAX_PROMPT_BODY_BYTES,
	POST
} from '../../routes/api/runtimes/[runtimeId]/prompt/+server.js';

const PNG_DATA = 'iVBORw0KGgo=';

function event(
	input: Record<string, unknown>,
	extraHeaders: Record<string, string> = {}
): RequestEvent {
	return {
		params: { runtimeId: 'runtime-1' },
		request: new Request('http://localhost/api/runtimes/runtime-1/prompt', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...extraHeaders },
			body: JSON.stringify({ streamingBehavior: 'followUp', ...input })
		})
	} as RequestEvent;
}

describe('POST /api/runtimes/[runtimeId]/prompt', () => {
	beforeEach(() => runtimeApi.promptRuntime.mockReset());

	it('returns the effective submitted text for a normal prompt', async () => {
		runtimeApi.promptRuntime.mockReturnValue({
			queued: false,
			userMessageText: 'Inspect the pending-message fix.'
		});

		const response = await POST(event({ text: 'Inspect the pending-message fix.' }));

		expect(await response.json()).toEqual({
			queued: false,
			userMessageText: 'Inspect the pending-message fix.'
		});
		expect(runtimeApi.promptRuntime).toHaveBeenCalledWith(
			'runtime-1',
			'Inspect the pending-message fix.',
			[],
			'followUp'
		);
	});

	it('omits optimistic message text when a command does not submit a prompt', async () => {
		runtimeApi.promptRuntime.mockReturnValue({ queued: false });

		const response = await POST(event({ text: '/mcp setup' }));

		expect(await response.json()).toEqual({ queued: false });
	});

	it('accepts an image-only prompt and passes validated image bytes to the runtime', async () => {
		runtimeApi.promptRuntime.mockReturnValue({ queued: false, userMessageText: '' });
		const atobSpy = vi.spyOn(globalThis, 'atob');
		const attachment = {
			id: 'image-1',
			kind: 'image',
			name: 'diagram.png',
			mimeType: 'image/png',
			size: 8,
			data: PNG_DATA
		};

		const response = await POST(event({ text: '', attachments: [attachment] }));

		expect(await response.json()).toEqual({ queued: false, userMessageText: '' });
		expect(atobSpy).toHaveBeenCalledOnce();
		expect(runtimeApi.promptRuntime).toHaveBeenCalledWith(
			'runtime-1',
			'',
			[
				{
					...attachment,
					bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
				}
			],
			'followUp'
		);
		atobSpy.mockRestore();
	});

	it('decodes each submitted attachment once and retains text for prompt construction', async () => {
		runtimeApi.promptRuntime.mockReturnValue({ queued: false, userMessageText: 'Inspect this.' });
		const atobSpy = vi.spyOn(globalThis, 'atob');
		const attachment = {
			id: 'text-1',
			kind: 'text',
			name: 'notes.txt',
			mimeType: 'text/plain',
			size: 5,
			data: 'SGVsbG8='
		};

		const response = await POST(event({ text: 'Inspect this.', attachments: [attachment] }));

		expect(response.status).toBe(200);
		expect(atobSpy).toHaveBeenCalledOnce();
		expect(runtimeApi.promptRuntime).toHaveBeenCalledWith(
			'runtime-1',
			'Inspect this.',
			[
				{
					id: 'text-1',
					kind: 'text',
					name: 'notes.txt',
					mimeType: 'text/plain',
					size: 5,
					bytes: new Uint8Array([72, 101, 108, 108, 111]),
					text: 'Hello'
				}
			],
			'followUp'
		);
		atobSpy.mockRestore();
	});

	it('rejects a prompt body above the request limit before JSON parsing', async () => {
		const response = await POST(
			event({ text: 'small' }, { 'Content-Length': String(MAX_PROMPT_BODY_BYTES + 1) })
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'Request body is too large.' });
		expect(runtimeApi.promptRuntime).not.toHaveBeenCalled();
	});

	it('keeps authoritative image-signature and UTF-8 checks at the HTTP boundary', async () => {
		const invalidImage = await POST(
			event({
				text: 'Inspect this.',
				attachments: [
					{
						id: 'image-1',
						kind: 'image',
						name: 'diagram.png',
						mimeType: 'image/png',
						size: 7,
						data: 'bm90IHBuZw=='
					}
				]
			})
		);
		expect(invalidImage.status).toBe(400);
		expect(await invalidImage.json()).toEqual({
			error: 'diagram.png does not match its image type.'
		});

		const invalidText = await POST(
			event({
				text: 'Inspect this.',
				attachments: [
					{
						id: 'text-1',
						kind: 'text',
						name: 'notes.txt',
						mimeType: 'text/plain',
						size: 2,
						data: 'wyg='
					}
				]
			})
		);
		expect(invalidText.status).toBe(400);
		expect(await invalidText.json()).toEqual({
			error: 'notes.txt is not valid UTF-8 text.'
		});
	});

	it('rejects malformed attachment bytes before they reach the runtime', async () => {
		const response = await POST(
			event({
				text: 'Inspect this.',
				attachments: [
					{
						id: 'image-1',
						kind: 'image',
						name: 'diagram.png',
						mimeType: 'image/png',
						size: 8,
						data: 'not base64'
					}
				]
			})
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'Attachment data must be valid base64.' });
		expect(runtimeApi.promptRuntime).not.toHaveBeenCalled();
	});
});

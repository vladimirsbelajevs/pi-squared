import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeApi = vi.hoisted(() => ({ promptRuntime: vi.fn() }));

vi.mock('$lib/server/runtimes', () => runtimeApi);

import { POST } from '../../routes/api/runtimes/[runtimeId]/prompt/+server.js';

const PNG_DATA = 'iVBORw0KGgo=';

function event(input: Record<string, unknown>): RequestEvent {
	return {
		params: { runtimeId: 'runtime-1' },
		request: new Request('http://localhost/api/runtimes/runtime-1/prompt', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
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
		expect(runtimeApi.promptRuntime).toHaveBeenCalledWith(
			'runtime-1',
			'',
			[attachment],
			'followUp'
		);
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

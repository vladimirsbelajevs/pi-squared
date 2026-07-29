import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';

const runtimeApi = vi.hoisted(() => ({ promptRuntime: vi.fn() }));

vi.mock('$lib/server/runtimes', () => runtimeApi);

import { POST } from '../../routes/api/runtimes/[runtimeId]/prompt/+server.js';

function event(text: string): RequestEvent {
	return {
		params: { runtimeId: 'runtime-1' },
		request: new Request('http://localhost/api/runtimes/runtime-1/prompt', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text, streamingBehavior: 'followUp' })
		})
	} as RequestEvent;
}

describe('POST /api/runtimes/[runtimeId]/prompt', () => {
	it('returns the effective submitted text for a normal prompt', async () => {
		runtimeApi.promptRuntime.mockReturnValue({
			queued: false,
			userMessageText: 'Inspect the pending-message fix.'
		});

		const response = await POST(event('Inspect the pending-message fix.'));

		expect(await response.json()).toEqual({
			queued: false,
			userMessageText: 'Inspect the pending-message fix.'
		});
		expect(runtimeApi.promptRuntime).toHaveBeenCalledWith(
			'runtime-1',
			'Inspect the pending-message fix.',
			'followUp'
		);
	});

	it('omits optimistic message text when a command does not submit a prompt', async () => {
		runtimeApi.promptRuntime.mockReturnValue({ queued: false });

		const response = await POST(event('/mcp setup'));

		expect(await response.json()).toEqual({ queued: false });
	});
});

import { describe, expect, it } from 'vitest';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { mapSessionEntry } from './pi.js';

describe('mapSessionEntry', () => {
	it('keeps assistant text, reasoning, and tool calls browser-safe', () => {
		const entry = {
			type: 'message',
			id: 'entry-1',
			parentId: null,
			timestamp: '2026-07-28T00:00:00.000Z',
			message: {
				role: 'assistant',
				content: [
					{ type: 'thinking', thinking: 'Inspect the repository.' },
					{ type: 'text', text: 'I found the relevant route.' },
					{
						type: 'toolCall',
						id: 'tool-1',
						name: 'read',
						arguments: { path: 'src/routes/+page.svelte' }
					}
				],
				stopReason: 'stop'
			}
		} as unknown as SessionEntry;

		expect(mapSessionEntry(entry)).toEqual({
			id: 'entry-1',
			kind: 'message',
			role: 'assistant',
			text: 'I found the relevant route.',
			thinking: 'Inspect the repository.',
			toolCalls: [
				{
					id: 'tool-1',
					name: 'read',
					arguments: '{\n  "path": "src/routes/+page.svelte"\n}'
				}
			],
			isError: false
		});
	});

	it('represents model changes as timeline notices', () => {
		const entry = {
			type: 'model_change',
			id: 'entry-2',
			parentId: 'entry-1',
			timestamp: '2026-07-28T00:01:00.000Z',
			provider: 'anthropic',
			modelId: 'claude-sonnet'
		} as SessionEntry;

		expect(mapSessionEntry(entry)).toEqual({
			id: 'entry-2',
			kind: 'notice',
			text: 'Model changed to anthropic/claude-sonnet'
		});
	});
});

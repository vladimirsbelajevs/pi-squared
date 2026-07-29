import { describe, expect, it } from 'vitest';
import type { AgentSession, SessionEntry } from '@earendil-works/pi-coding-agent';
import { listSessionSlashCommands, mapSessionEntry, normalizePiEvent } from './pi.js';

describe('mapSessionEntry', () => {
	it('keeps assistant text, reasoning, and tool calls browser-safe', () => {
		const entry = {
			type: 'message',
			id: 'entry-1',
			parentId: null,
			timestamp: '2026-07-28T00:00:00.000Z',
			message: {
				role: 'assistant',
				provider: 'openai',
				model: 'gpt-5.6-terra',
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
			timestamp: '2026-07-28T00:00:00.000Z',
			modelName: 'gpt-5.6-terra',
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

	it('keeps the originating tool call id on tool results', () => {
		const entry = {
			type: 'message',
			id: 'entry-tool-result',
			parentId: 'entry-assistant',
			timestamp: '2026-07-28T00:01:00.000Z',
			message: {
				role: 'toolResult',
				toolCallId: 'tool-1',
				toolName: 'read',
				content: [{ type: 'text', text: 'file contents' }],
				isError: false
			}
		} as unknown as SessionEntry;

		expect(mapSessionEntry(entry)).toEqual({
			id: 'entry-tool-result',
			kind: 'message',
			role: 'tool',
			text: 'file contents',
			timestamp: '2026-07-28T00:01:00.000Z',
			toolCallId: 'tool-1',
			label: 'read',
			isError: false
		});
	});

	it('forwards assistant text and reasoning deltas immediately', () => {
		expect(
			normalizePiEvent({
				type: 'message_update',
				assistantMessageEvent: { type: 'text_delta', delta: 'Streaming ' }
			} as never)
		).toEqual({ type: 'assistant_delta', text: 'Streaming ' });
		expect(
			normalizePiEvent({
				type: 'message_update',
				assistantMessageEvent: { type: 'thinking_delta', delta: 'Inspecting files.' }
			} as never)
		).toEqual({ type: 'assistant_delta', thinking: 'Inspecting files.' });
	});

	it('lists only prompt-executable extensions, templates, and skills', () => {
		const session = {
			extensionRunner: {
				getRegisteredCommands: () => [
					{ invocationName: 'review', description: 'Run the extension review command' }
				]
			},
			promptTemplates: [
				{ name: 'plan', description: 'Create a plan' },
				{ name: 'review', description: 'Template review command' }
			],
			resourceLoader: {
				getSkills: () => ({
					skills: [{ name: 'testing', description: 'Testing workflow' }],
					diagnostics: []
				})
			}
		} as unknown as AgentSession;

		expect(listSessionSlashCommands(session)).toEqual([
			{ name: 'plan', description: 'Create a plan', source: 'prompt' },
			{ name: 'review', description: 'Run the extension review command', source: 'extension' },
			{ name: 'skill:testing', description: 'Testing workflow', source: 'skill' }
		]);
	});
});

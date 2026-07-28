import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { ChatTab } from '$lib/harness/types';
import ChatTimeline from './ChatTimeline.svelte';

function chat(overrides: Partial<ChatTab> = {}): ChatTab {
	return {
		id: 'chat-tab',
		kind: 'chat',
		title: 'Test chat',
		projectId: 'project-1',
		sessionId: 'session-1',
		runtimeId: 'runtime-1',
		snapshot: {
			runtimeId: 'runtime-1',
			project: {
				id: 'project-1',
				name: 'Test project',
				cwd: '/tmp/test-project',
				addedAt: '2026-01-01T00:00:00.000Z',
				lastOpenedAt: '2026-01-01T00:00:00.000Z'
			},
			sessionId: 'session-1',
			thinkingLevel: 'medium',
			isStreaming: true,
			items: []
		},
		hydrating: false,
		draft: '',
		queueMode: 'followUp',
		streamText: '',
		streamThinking: '',
		streamTools: [],
		transientNotices: [],
		permissionRequests: [],
		...overrides
	};
}

describe('ChatTimeline', () => {
	it('shows an animated thinking status before the first response delta', async () => {
		const screen = render(ChatTimeline, { chat: chat() });

		await expect.element(screen.getByRole('status')).toHaveTextContent('Pi is thinking');
	});

	it('hides the thinking status once text, tools, or approval is visible', async () => {
		const screen = render(ChatTimeline, { chat: chat() });
		for (const override of [
			{ streamText: 'Working on it.' },
			{ streamTools: [{ id: 'tool-1', name: 'read', text: 'Reading file' }] },
			{
				permissionRequests: [
					{
						id: 'permission-1',
						method: 'confirm' as const,
						title: 'Permission required'
					}
				]
			}
		]) {
			await screen.rerender({ chat: chat(override) });
			await expect.element(screen.locator).not.toHaveTextContent('Pi is thinking');
		}
	});

	it('renders metadata and copy controls for user and assistant messages', async () => {
		const base = chat();
		const screen = render(ChatTimeline, {
			chat: chat({
				snapshot: {
					...base.snapshot!,
					isStreaming: false,
					items: [
						{
							id: 'user-1',
							kind: 'message',
							role: 'user',
							text: 'Inspect this message.',
							timestamp: '2026-07-28T23:35:00.000Z'
						},
						{
							id: 'assistant-1',
							kind: 'message',
							role: 'assistant',
							text: 'The message metadata is ready.',
							modelName: 'GPT-5.6 Terra',
							timestamp: '2026-07-28T23:36:00.000Z'
						}
					]
				}
			})
		});

		const messages = screen.container.querySelectorAll('.message-entry');
		expect(screen.container.querySelectorAll('.message-meta-row')).toHaveLength(2);
		expect(screen.container.querySelectorAll('.message-meta-content')).toHaveLength(0);

		await userEvent.hover(messages[0] as HTMLElement);
		await expect.element(screen.getByRole('button', { name: 'Copy message' })).toBeVisible();
		expect(screen.container.querySelectorAll('.message-meta-content time')).toHaveLength(1);

		await userEvent.hover(messages[1] as HTMLElement);
		await expect.element(screen.getByText('GPT-5.6 Terra')).toBeVisible();
	});

	it('groups tool calls with their results and keeps the group collapsed by default', async () => {
		const base = chat();
		const screen = render(ChatTimeline, {
			chat: chat({
				snapshot: {
					...base.snapshot!,
					isStreaming: false,
					items: [
						{
							id: 'assistant-1',
							kind: 'message',
							role: 'assistant',
							text: '',
							toolCalls: [
								{ id: 'tool-1', name: 'read', arguments: '{"path":"README.md"}' },
								{ id: 'tool-2', name: 'bash', arguments: '{"command":"npm test"}' }
							]
						},
						{
							id: 'result-1',
							kind: 'message',
							role: 'tool',
							toolCallId: 'tool-1',
							label: 'read',
							text: 'README contents'
						},
						{
							id: 'result-2',
							kind: 'message',
							role: 'tool',
							toolCallId: 'tool-2',
							label: 'bash',
							text: 'Tests failed',
							isError: true
						}
					]
				}
			})
		});
		const group = screen.container.querySelector('details.tool-group') as HTMLDetailsElement;

		await expect.element(screen.getByText('2 tools called')).toBeVisible();
		await expect.element(screen.getByText('1 failed')).toBeVisible();
		expect(group.open).toBe(false);
		expect(screen.container.querySelectorAll('.message-tool')).toHaveLength(0);

		await screen.getByText('2 tools called').click();
		expect(group.open).toBe(true);
		const result = screen.container.querySelector('.tool-result') as HTMLDetailsElement;
		const results = screen.container.querySelectorAll('.tool-result');
		expect(result.open).toBe(false);
		expect((results[1] as HTMLDetailsElement).open).toBe(false);
		await screen.getByText('Result').first().click();
		expect(result.open).toBe(true);
		expect((results[1] as HTMLDetailsElement).open).toBe(false);
		await expect.element(screen.getByText('README contents')).toBeVisible();
		await userEvent.hover(screen.container.querySelector('.message-entry') as HTMLElement);
		expect(screen.container.querySelectorAll('.copy-action')).toHaveLength(0);
	});

	it('merges consecutive assistant tool batches into one group', async () => {
		const base = chat();
		const screen = render(ChatTimeline, {
			chat: chat({
				snapshot: {
					...base.snapshot!,
					isStreaming: false,
					items: [
						{
							id: 'assistant-1',
							kind: 'message',
							role: 'assistant',
							text: '',
							thinking: 'I will inspect the project.',
							toolCalls: [{ id: 'tool-1', name: 'read', arguments: '{"path":"README.md"}' }]
						},
						{
							id: 'result-1',
							kind: 'message',
							role: 'tool',
							toolCallId: 'tool-1',
							text: 'README contents'
						},
						{
							id: 'assistant-2',
							kind: 'message',
							role: 'assistant',
							text: '',
							toolCalls: [
								{ id: 'tool-2', name: 'glob', arguments: '{"pattern":"src/**"}' },
								{ id: 'tool-3', name: 'read', arguments: '{"path":"package.json"}' }
							]
						},
						{
							id: 'result-2',
							kind: 'message',
							role: 'tool',
							toolCallId: 'tool-2',
							text: 'Source files'
						},
						{
							id: 'result-3',
							kind: 'message',
							role: 'tool',
							toolCallId: 'tool-3',
							text: 'Package details'
						},
						{
							id: 'assistant-3',
							kind: 'message',
							role: 'assistant',
							text: 'The project is ready to run.'
						}
					]
				}
			})
		});

		expect(screen.container.querySelectorAll('details.tool-group')).toHaveLength(1);
		await expect.element(screen.getByText('3 tools called')).toBeVisible();
		expect(screen.container.querySelector('.tool-group-status')).toHaveTextContent('completed');
		await expect.element(screen.getByText('The project is ready to run.')).toBeVisible();
	});

	it('groups unmatched live tools and leaves unmatched historical results visible', async () => {
		const base = chat();
		const screen = render(ChatTimeline, {
			chat: chat({
				snapshot: {
					...base.snapshot!,
					items: [
						{
							id: 'legacy-result',
							kind: 'message',
							role: 'tool',
							toolCallId: 'missing-call',
							label: 'legacy',
							text: 'Legacy result'
						}
					]
				},
				streamTools: [
					{ id: 'live-1', name: 'read', text: 'Reading' },
					{ id: 'live-2', name: 'bash', text: 'Running tests' }
				]
			})
		});

		await expect.element(screen.getByText('2 tools running')).toBeVisible();
		await expect.element(screen.getByText('Legacy result')).toBeVisible();
		expect(screen.container.querySelectorAll('.message-tool')).toHaveLength(1);
	});
});

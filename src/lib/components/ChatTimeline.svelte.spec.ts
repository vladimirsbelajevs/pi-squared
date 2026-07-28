import { describe, expect, it } from 'vitest';
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

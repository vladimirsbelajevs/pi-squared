import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ChatItem } from '$lib/contracts';
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
		pendingUserMessages: [],
		...overrides
	};
}

describe('ChatTimeline', () => {
	it('shows an animated thinking status before the first response delta', async () => {
		const screen = render(ChatTimeline, { chat: chat() });

		await expect.element(screen.getByRole('status')).toHaveTextContent('Pi is thinking');
	});

	it('renders pending user messages immediately and replaces them with their authoritative entry', async () => {
		const base = chat();
		const pendingMessage = {
			id: 'pending-user-1',
			text: 'Send this before Pi persists it.',
			timestamp: '2026-07-29T12:00:00.000Z',
			knownUserItemIds: []
		};
		const screen = render(ChatTimeline, {
			chat: chat({ pendingUserMessages: [pendingMessage] })
		});

		await expect.element(screen.getByText(pendingMessage.text)).toBeVisible();
		expect(screen.container.querySelectorAll('.message-entry-user')).toHaveLength(1);

		await screen.rerender({
			chat: chat({
				snapshot: {
					...base.snapshot!,
					isStreaming: false,
					items: [
						{
							id: 'authoritative-user-1',
							kind: 'message',
							role: 'user',
							text: pendingMessage.text,
							timestamp: pendingMessage.timestamp
						}
					]
				},
				pendingUserMessages: []
			})
		});

		expect(screen.container.querySelectorAll('.message-entry-user')).toHaveLength(1);
		await expect.element(screen.getByText(pendingMessage.text)).toBeVisible();
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

	it('does not render transient notices but keeps persisted snapshot notices', async () => {
		const base = chat();
		const screen = render(ChatTimeline, {
			chat: chat({
				snapshot: {
					...base.snapshot!,
					isStreaming: false,
					items: [
						{
							id: 'model-change',
							kind: 'notice',
							text: 'Model changed to openai/gpt-5.6'
						}
					]
				},
				transientNotices: [
					{ id: 'mcp-notice', message: 'The interactive MCP panel is terminal-only.' }
				]
			})
		});

		await expect.element(screen.getByText('Model changed to openai/gpt-5.6')).toBeVisible();
		expect(screen.container.textContent).not.toContain(
			'The interactive MCP panel is terminal-only.'
		);
		expect(screen.container.querySelectorAll('.timeline-notice')).toHaveLength(1);
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

		expect(screen.container.querySelectorAll('.message-meta-row')).toHaveLength(2);
		expect(screen.container.querySelectorAll('.message-meta-content')).toHaveLength(0);

		await screen.getByRole('group', { name: 'user message' }).hover();
		await expect.element(screen.getByRole('button', { name: 'Copy message' })).toBeVisible();
		expect(screen.container.querySelectorAll('.message-meta-content time')).toHaveLength(1);
		expect(screen.container.textContent).not.toContain('Reasoning: medium');

		await screen.getByRole('group', { name: 'assistant message' }).hover();
		await expect.element(screen.getByText('GPT-5.6 Terra')).toBeVisible();
		await expect.element(screen.getByText('Reasoning: medium')).toBeVisible();
	});

	it('renders persisted assistant text as Markdown', async () => {
		const base = chat();
		const screen = render(ChatTimeline, {
			chat: chat({
				snapshot: {
					...base.snapshot!,
					isStreaming: false,
					items: [
						{
							id: 'assistant-markdown',
							kind: 'message',
							role: 'assistant',
							text: '# Summary\n\n**Ready**\n\n- First\n- Second\n\n[Docs](https://example.test)'
						}
					]
				}
			})
		});

		const message = screen.container.querySelector('.message-markdown') as HTMLElement;
		expect(message.querySelector('h1')).toHaveTextContent('Summary');
		expect(message.querySelector('strong')).toHaveTextContent('Ready');
		expect(message.querySelectorAll('li')).toHaveLength(2);
		expect(message.querySelector('a')).toHaveAttribute('href', 'https://example.test');
	});

	it('omits ordinary empty assistant messages but renders empty aborted messages as stopped rows', async () => {
		const base = chat();
		const abortedItem: ChatItem = {
			id: 'assistant-aborted',
			kind: 'message',
			role: 'assistant',
			text: '',
			stopReason: 'aborted'
		};
		const screen = render(ChatTimeline, {
			chat: chat({
				snapshot: {
					...base.snapshot!,
					isStreaming: false,
					items: [
						{
							id: 'assistant-empty',
							kind: 'message',
							role: 'assistant',
							text: ''
						},
						abortedItem
					]
				}
			})
		});

		await expect.element(screen.getByText('Stopped')).toBeVisible();
		expect(screen.container.querySelectorAll('.stopped-row')).toHaveLength(1);
		expect(screen.container.querySelectorAll('.message-entry-assistant')).toHaveLength(0);
		expect(screen.container.querySelectorAll('.message-meta-row')).toHaveLength(0);
	});

	it('renders aborted assistant messages with text, reasoning, or tools normally', async () => {
		const base = chat();
		const abortedText: ChatItem = {
			id: 'assistant-aborted-text',
			kind: 'message',
			role: 'assistant',
			text: 'Partial response.',
			stopReason: 'aborted'
		};
		const abortedReasoning: ChatItem = {
			id: 'assistant-aborted-reasoning',
			kind: 'message',
			role: 'assistant',
			text: '',
			thinking: 'Partial reasoning.',
			stopReason: 'aborted'
		};
		const abortedTools: ChatItem = {
			id: 'assistant-aborted-tools',
			kind: 'message',
			role: 'assistant',
			text: '',
			toolCalls: [{ id: 'tool-1', name: 'read', arguments: '{}' }],
			stopReason: 'aborted'
		};
		const screen = render(ChatTimeline, {
			chat: chat({
				snapshot: {
					...base.snapshot!,
					isStreaming: false,
					items: [
						abortedText,
						abortedReasoning,
						abortedTools,
						{
							id: 'tool-result',
							kind: 'message',
							role: 'tool',
							toolCallId: 'tool-1',
							text: 'Partial tool output.'
						}
					]
				}
			}),
			showReasoning: true
		});

		await expect.element(screen.getByText('Partial response.')).toBeVisible();
		expect(screen.container.querySelector('.thinking')).toHaveTextContent('Partial reasoning.');
		await expect.element(screen.getByText('1 tool called')).toBeVisible();
		expect(screen.container.querySelectorAll('.message-entry-assistant')).toHaveLength(2);
		expect(screen.container.querySelector('.stopped-row')).toBeNull();
		expect((screen.container.querySelector('details.tool-group') as HTMLDetailsElement).open).toBe(
			false
		);
	});

	it('renders streaming assistant text as Markdown', async () => {
		const screen = render(ChatTimeline, {
			chat: chat({ streamText: '## Streaming\n\n**Partial answer**' })
		});

		const message = screen.container.querySelector('.streaming .message-markdown') as HTMLElement;
		expect(message.querySelector('h2')).toHaveTextContent('Streaming');
		expect(message.querySelector('strong')).toHaveTextContent('Partial answer');
	});

	it('keeps live tool calls above the streaming response', async () => {
		const base = chat();
		const screen = render(ChatTimeline, {
			chat: chat({
				streamText: 'Streaming response.',
				streamTools: [{ id: 'tool-1', name: 'read', text: 'Reading README.md' }]
			})
		});

		const liveTools = screen.container.querySelector('details.tool-group');
		const streamingMessage = screen.container.querySelector('article.streaming');
		expect([...screen.container.querySelectorAll('details.tool-group, article.streaming')]).toEqual(
			[liveTools, streamingMessage]
		);

		await screen.rerender({
			chat: chat({
				snapshot: {
					...base.snapshot!,
					isStreaming: false,
					items: [
						{
							id: 'assistant-tools',
							kind: 'message',
							role: 'assistant',
							text: '',
							toolCalls: [{ id: 'tool-1', name: 'read', arguments: '{}' }]
						},
						{
							id: 'tool-result',
							kind: 'message',
							role: 'tool',
							toolCallId: 'tool-1',
							text: 'README contents'
						},
						{
							id: 'assistant-response',
							kind: 'message',
							role: 'assistant',
							text: 'Streaming response.'
						}
					]
				}
			})
		});

		const persistedTools = screen.container.querySelector('details.tool-group');
		expect(persistedTools?.nextElementSibling?.textContent).toContain('Streaming response.');
	});

	it('omits conversational headers while retaining their accessible group labels', async () => {
		const base = chat();
		const screen = render(ChatTimeline, {
			chat: chat({
				snapshot: {
					...base.snapshot!,
					isStreaming: false,
					items: [
						{ id: 'user-1', kind: 'message', role: 'user', text: 'Inspect this.' },
						{ id: 'assistant-1', kind: 'message', role: 'assistant', text: 'Ready.' },
						{
							id: 'assistant-tools',
							kind: 'message',
							role: 'assistant',
							text: '',
							toolCalls: [{ id: 'tool-1', name: 'read', arguments: '{}' }]
						}
					]
				}
			})
		});

		await expect.element(screen.getByRole('group', { name: 'user message' })).toBeVisible();
		await expect
			.element(screen.getByRole('group', { name: 'assistant message' }).first())
			.toBeVisible();
		expect(screen.container.querySelectorAll('.message-user header')).toHaveLength(0);
		expect(screen.container.querySelectorAll('.message-assistant header')).toHaveLength(0);
	});

	it('keeps headers for tool, bash, and custom messages', () => {
		const base = chat();
		const screen = render(ChatTimeline, {
			chat: chat({
				snapshot: {
					...base.snapshot!,
					isStreaming: false,
					items: [
						{
							id: 'tool-1',
							kind: 'message',
							role: 'tool',
							label: 'Tool output',
							text: 'Result'
						},
						{
							id: 'bash-1',
							kind: 'message',
							role: 'bash',
							label: 'npm test',
							text: 'Passed'
						},
						{ id: 'custom-1', kind: 'message', role: 'custom', text: 'Custom content' }
					]
				}
			})
		});

		expect(
			Array.from(screen.container.querySelectorAll<HTMLElement>('.message header')).map((header) =>
				(header as HTMLElement).textContent?.trim()
			)
		).toEqual(['Tool output', 'npm test', 'custom']);
	});

	it('hides persisted reasoning by default and renders it when enabled', async () => {
		const base = chat();
		const chatWithReasoning = chat({
			snapshot: {
				...base.snapshot!,
				isStreaming: false,
				items: [
					{
						id: 'assistant-1',
						kind: 'message',
						role: 'assistant',
						text: 'Answer',
						thinking: 'Historical reasoning'
					}
				]
			}
		});
		const screen = render(ChatTimeline, { chat: chatWithReasoning });

		expect(screen.container.querySelectorAll('.thinking')).toHaveLength(0);
		await screen.rerender({ chat: chatWithReasoning, showReasoning: true });
		expect(screen.container.querySelector('.thinking')?.textContent).toContain(
			'Historical reasoning'
		);
	});

	it('hides reasoning-only stream deltas until reasoning display is enabled', async () => {
		const screen = render(ChatTimeline, { chat: chat({ streamThinking: 'Streaming reasoning' }) });

		expect(screen.container.querySelector('.streaming')).toBeNull();
		await expect.element(screen.getByRole('status')).toHaveTextContent('Pi is thinking');

		await screen.rerender({
			chat: chat({ streamThinking: 'Streaming reasoning' }),
			showReasoning: true
		});
		await expect
			.element(screen.getByRole('group', { name: 'assistant message, streaming' }))
			.toBeVisible();
		expect(screen.container.querySelector('.streaming .thinking')?.textContent).toContain(
			'Streaming reasoning'
		);
	});

	it('keeps user message text literal', async () => {
		const base = chat();
		const screen = render(ChatTimeline, {
			chat: chat({
				snapshot: {
					...base.snapshot!,
					isStreaming: false,
					items: [
						{
							id: 'user-literal',
							kind: 'message',
							role: 'user',
							text: '<strong>Do not render</strong>\n# Not a heading'
						}
					]
				}
			})
		});

		const message = screen.container.querySelector('.message-user') as HTMLElement;
		expect(message.querySelector('.message-text')?.textContent).toBe(
			'<strong>Do not render</strong>\n# Not a heading'
		);
		expect(message.querySelector('strong')).toBeNull();
		expect(message.querySelector('h1')).toBeNull();
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

		await expect.element(screen.getByText('2 tools called · 1 completed · 1 failed')).toBeVisible();
		expect(group.open).toBe(false);
		expect(screen.container.querySelectorAll('.message-tool')).toHaveLength(0);
		expect(screen.container.querySelector('.tool-group-status')).toBeNull();

		await screen.getByText('2 tools called · 1 completed · 1 failed').click();
		await vi.waitFor(() => expect(group.open).toBe(true));
		expect(group.open).toBe(true);
		const result = screen.container.querySelector('.tool-result') as HTMLDetailsElement;
		const results = screen.container.querySelectorAll('.tool-result');
		expect(result.open).toBe(false);
		expect((results[1] as HTMLDetailsElement).open).toBe(false);
		await screen.getByText('Result').first().click();
		await vi.waitFor(() => expect(result.open).toBe(true));
		expect(result.open).toBe(true);
		expect((results[1] as HTMLDetailsElement).open).toBe(false);
		await expect.element(screen.getByText('README contents')).toBeVisible();
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
		await expect.element(screen.getByText('3 tools called · 3 completed')).toBeVisible();
		expect(screen.container.querySelector('.tool-group-status')).toBeNull();
		await expect.element(screen.getByText('The project is ready to run.')).toBeVisible();
	});

	it('keeps tool batches separate across messages, notices, and stopped rows', async () => {
		const base = chat();
		const toolCall = (id: string): ChatItem => ({
			id: `assistant-${id}`,
			kind: 'message',
			role: 'assistant',
			text: '',
			toolCalls: [{ id, name: 'read', arguments: '{}' }]
		});
		const screen = render(ChatTimeline, {
			chat: chat({
				snapshot: {
					...base.snapshot!,
					isStreaming: false,
					items: [
						toolCall('tool-1'),
						{
							id: 'result-1',
							kind: 'message',
							role: 'tool',
							toolCallId: 'tool-1',
							text: 'First result'
						},
						{ id: 'user-message', kind: 'message', role: 'user', text: 'Continue.' },
						{ id: 'assistant-text', kind: 'message', role: 'assistant', text: 'Between calls.' },
						toolCall('tool-2'),
						{ id: 'notice', kind: 'notice', text: 'Persisted notice' },
						toolCall('tool-3'),
						{
							id: 'assistant-aborted',
							kind: 'message',
							role: 'assistant',
							text: '',
							stopReason: 'aborted'
						},
						toolCall('tool-4')
					]
				}
			})
		});

		expect(screen.container.querySelectorAll('details.tool-group')).toHaveLength(4);
		await expect.element(screen.getByText('Persisted notice')).toBeVisible();
		await expect.element(screen.getByText('Stopped')).toBeVisible();
	});

	it('upserts active streaming tools into the persisted standalone batch', async () => {
		const base = chat();
		const screen = render(ChatTimeline, {
			chat: chat({
				streamText: 'Streaming response.',
				streamTools: [
					{ id: 'tool-1', name: 'read', text: 'Reading README.md' },
					{ id: 'tool-2', name: 'bash', text: 'Running tests' }
				],
				snapshot: {
					...base.snapshot!,
					items: [
						{
							id: 'assistant-tools',
							kind: 'message',
							role: 'assistant',
							text: 'I will inspect the project.',
							toolCalls: [{ id: 'tool-1', name: 'read', arguments: '{"path":"README.md"}' }]
						},
						{
							id: 'tool-result',
							kind: 'message',
							role: 'tool',
							toolCallId: 'tool-1',
							text: 'README contents'
						}
					]
				}
			})
		});
		const group = screen.container.querySelector('details.tool-group') as HTMLDetailsElement;

		expect(screen.container.querySelectorAll('details.tool-group')).toHaveLength(1);
		expect(group.closest('.message-assistant')).toBeNull();
		await expect.element(screen.getByText('I will inspect the project.')).toBeVisible();
		expect(group.nextElementSibling).toBe(screen.container.querySelector('article.streaming'));
		await screen.getByText('2 tools called · 1 completed · 1 running').click();
		await vi.waitFor(() => expect(group.open).toBe(true));
		expect(screen.container.querySelectorAll('.tool-detail > span')).toHaveLength(1);
		const statuses = [
			...screen.container.querySelectorAll<HTMLElement>('.tool-entry-heading span')
		];
		expect(statuses.map((status) => status.textContent?.trim())).toEqual(['completed', 'running']);
		await screen.getByText('Result').last().click();
		await expect.element(screen.getByText('Running tests')).toBeVisible();
	});

	it('renders live-only tools as a standalone row and leaves unmatched historical results visible', async () => {
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

		await expect.element(screen.getByText('2 tools called · 2 running')).toBeVisible();
		await expect.element(screen.getByText('Legacy result')).toBeVisible();
		expect(screen.container.querySelectorAll('.message-tool')).toHaveLength(1);
	});
});

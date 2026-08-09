import { flushSync } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { StreamUpdateBatcher } from '$lib/harness/stream-update-batcher';
import { buildFinalizedTimeline } from '$lib/harness/timeline';
import type { ChatItem, SubagentRun } from '$lib/contracts';
import type { ChatTab } from '$lib/harness/types';
import ChatTimeline from './ChatTimeline.svelte';

function chat(overrides: Partial<ChatTab> = {}): ChatTab {
	const result: ChatTab = {
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
			items: [],
			permissionRequests: []
		},
		hydrationState: 'ready',
		hydrationGeneration: 0,
		bufferedEvents: [],
		needsCheckpoint: false,
		draft: '',
		queueMode: 'followUp',
		streamText: '',
		streamRenderedText: '',
		streamThinking: '',
		streamTools: [],
		transientNotices: [],
		permissionRequests: [],
		pendingUserMessages: [],
		...overrides
	};
	result.streamToolsByCallId = new SvelteMap(result.streamTools.map((tool) => [tool.id, tool]));

	return result;
}

function mockClipboard(writeText: ReturnType<typeof vi.fn>): () => void {
	const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: { writeText }
	});

	return () => {
		if (originalClipboard) {
			Object.defineProperty(navigator, 'clipboard', originalClipboard);
		} else {
			delete (navigator as unknown as { clipboard?: Clipboard }).clipboard;
		}
	};
}

describe('ChatTimeline', () => {
	it('shows the Pi working spinner before the first response delta', async () => {
		const screen = render(ChatTimeline, { chat: chat() });

		await expect.element(screen.getByRole('img', { name: 'Working' })).toBeVisible();
		await expect.element(screen.getByRole('status')).toHaveTextContent('Working');
	});

	it('places subagent cards after their activity while preserving the raw tool row', async () => {
		const base = chat();
		const run: SubagentRun = {
			runId: 'run-1',
			childId: 'index-0',
			toolCallId: 'subagent-call',
			agent: 'worker',
			task: 'Inspect the feature',
			status: 'running'
		};
		const screen = render(ChatTimeline, {
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
							toolCalls: [
								{ id: 'subagent-call', name: 'subagent', arguments: '{"agent":"worker"}' }
							]
						},
						{
							id: 'tool-result',
							kind: 'message',
							role: 'tool',
							toolCallId: 'subagent-call',
							text: 'running'
						}
					]
				}
			}),
			subagentRuns: [run]
		});

		const activity = screen.container.querySelector('.activity-group');
		const card = screen.container.querySelector('.subagent-card');
		expect(activity).not.toBeNull();
		expect(card).not.toBeNull();
		expect(activity!.compareDocumentPosition(card!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
		await screen.getByText('Agent activity · 1 tool').click();
		await vi.waitFor(() =>
			expect(screen.container.querySelector('.tool-group-summary')).not.toBeNull()
		);
		screen.container.querySelector<HTMLElement>('.tool-group-summary')?.click();
		await expect.element(screen.getByText('subagent')).toBeVisible();
		await expect.element(screen.getByText('Working')).toBeVisible();
		await screen.getByRole('button', { name: 'worker: Working' }).click();
		await expect.element(screen.getByRole('dialog')).toBeVisible();
		await expect.element(screen.getByText('Initializing child session…')).toBeVisible();
		expect(screen.container.querySelector('textarea')).toBeNull();
		await screen.getByRole('button', { name: 'Close child timeline' }).click();

		await screen.rerender({
			subagentRuns: [{ ...run, status: 'completed', timelineAvailable: false }]
		});
		await screen.getByRole('button', { name: 'worker: Completed' }).click();
		await expect.element(screen.getByText('Timeline unavailable')).toBeVisible();
		await screen.getByRole('button', { name: 'Close child timeline' }).click();

		await screen.rerender({
			subagentRuns: [{ ...run, status: 'completed', childSessionId: 'child-1' }]
		});
		expect(screen.container.querySelector('.subagent-card .pi-working-spinner')).toBeNull();
		await expect
			.element(screen.container.querySelector('.subagent-card-label') as HTMLElement)
			.toBeVisible();
	});

	it('contains off-screen finalized timeline rows', () => {
		const base = chat();
		const screen = render(ChatTimeline, {
			chat: chat({
				snapshot: {
					...base.snapshot!,
					isStreaming: false,
					items: [
						{ id: 'assistant-1', kind: 'message', role: 'assistant', text: 'Answer' },
						{ id: 'notice-1', kind: 'notice', text: 'Context compacted.' },
						{
							id: 'assistant-aborted',
							kind: 'message',
							role: 'assistant',
							text: '',
							stopReason: 'aborted'
						},
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
							text: 'Result'
						}
					]
				}
			})
		});

		for (const selector of [
			'.message-entry',
			'.timeline-notice',
			'.stopped-row',
			'.activity-group'
		]) {
			const element = screen.container.querySelector<HTMLElement>(selector)!;
			const style = getComputedStyle(element);
			expect(style.contentVisibility).toBe('auto');
			expect(style.containIntrinsicSize).toContain('240px');
		}
	});

	it('renders pending user messages immediately and replaces them with their authoritative entry', async () => {
		const base = chat();
		const pendingMessage = {
			id: 'pending-user-1',
			text: 'Send this before Pi persists it.',
			attachments: [],
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

	it('renders attachment cards below the message bubble without exposing text file contents', async () => {
		const base = chat();
		const imageData = 'iVBORw0KGgo=';
		const textData = 'Y29uc3Qgc2VjcmV0ID0gdHJ1ZTs=';
		const screen = render(ChatTimeline, {
			chat: chat({
				snapshot: {
					...base.snapshot!,
					isStreaming: false,
					items: [
						{
							id: 'assistant-attachments',
							kind: 'message',
							role: 'assistant',
							text: '',
							attachments: [
								{
									id: 'image-1',
									kind: 'image',
									name: 'diagram.png',
									mimeType: 'image/png',
									size: 8,
									data: imageData
								},
								{
									id: 'text-1',
									kind: 'text',
									name: 'secrets.ts',
									mimeType: 'text/plain',
									size: 20,
									data: textData
								}
							]
						}
					]
				}
			})
		});

		const bubble = screen.container.querySelector('article.message-assistant')!;
		const attachments = screen.container.querySelector<HTMLElement>('.message-attachments')!;
		expect(bubble.nextElementSibling).toBe(attachments);
		expect(attachments.nextElementSibling).toHaveClass('message-meta-row');
		await expect.element(screen.getByRole('list', { name: 'assistant attachments' })).toBeVisible();
		const preview = attachments.querySelector<HTMLImageElement>('.attachment-preview-thumbnail');
		expect(preview?.src).toMatch(/^data:image\/png;base64,/);
		expect(preview).toHaveAttribute('loading', 'lazy');
		expect(preview).toHaveAttribute('decoding', 'async');
		await expect
			.element(screen.getByRole('button', { name: 'Open preview of diagram.png' }))
			.toBeVisible();
		await expect.element(screen.getByText('diagram.png')).toBeVisible();
		await expect.element(screen.getByText('secrets.ts')).toBeVisible();
		expect(attachments.querySelector('button[aria-label^="Remove "]')).toBeNull();
		expect(screen.container.textContent).not.toContain('const secret = true;');
		expect(screen.container.textContent).not.toContain(textData);
	});

	it('opens and closes persisted image attachment previews', async () => {
		const base = chat();
		const screen = render(ChatTimeline, {
			chat: chat({
				snapshot: {
					...base.snapshot!,
					isStreaming: false,
					items: [
						{
							id: 'assistant-image',
							kind: 'message',
							role: 'assistant',
							text: '',
							attachments: [
								{
									id: 'image-1',
									kind: 'image',
									name: 'diagram.png',
									mimeType: 'image/png',
									size: 8,
									data: 'iVBORw0KGgo='
								}
							]
						}
					]
				}
			})
		});

		const thumbnail = screen.getByRole('button', { name: 'Open preview of diagram.png' });
		const thumbnailImage = screen.container.querySelector<HTMLImageElement>(
			'.attachment-preview-thumbnail'
		);
		const thumbnailSrc = thumbnailImage?.src;
		expect(thumbnailSrc).toMatch(/^data:image\/png;base64,/);

		await thumbnail.click();
		await expect
			.element(screen.getByRole('dialog', { name: 'Image preview: diagram.png' }))
			.toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Close image preview' })).toBeVisible();
		expect(screen.container.querySelector<HTMLImageElement>('.image-viewer-image')?.src).toBe(
			thumbnailSrc
		);

		await screen.getByRole('button', { name: 'Close image preview' }).click();
		await vi.waitFor(() => expect(screen.container.querySelector('[role="dialog"]')).toBeNull());

		thumbnailImage?.dispatchEvent(new Event('load'));
		await thumbnail.click();
		await expect
			.element(screen.getByRole('dialog', { name: 'Image preview: diagram.png' }))
			.toBeVisible();
		expect(screen.container.querySelector<HTMLImageElement>('.image-viewer-image')?.src).toBe(
			thumbnailSrc
		);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		await vi.waitFor(() => expect(screen.container.querySelector('[role="dialog"]')).toBeNull());
	});

	it('hides the timeline spinner while visible response text or approval is present', async () => {
		const screen = render(ChatTimeline, { chat: chat() });
		for (const override of [
			{ streamText: 'Working on it.' },
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
			expect(screen.container.querySelector('.pi-working-spinner')).toBeNull();
		}
	});

	it('keeps the timeline spinner visible alongside live tool calls', async () => {
		const screen = render(ChatTimeline, {
			chat: chat({
				streamTools: [{ id: 'tool-1', name: 'read', status: 'running', text: 'Reading file' }]
			})
		});

		await expect.element(screen.getByRole('img', { name: 'Working' })).toBeVisible();
		await expect.element(screen.getByText('Agent activity · 1 tool')).toBeVisible();

		await screen.rerender({
			chat: chat({
				streamTools: [{ id: 'tool-1', name: 'read', status: 'running', text: 'Reading file' }],
				permissionRequests: [
					{ id: 'permission-1', method: 'confirm', title: 'Permission required' }
				]
			})
		});
		expect(screen.container.querySelector('.pi-working-spinner')).toBeNull();

		await screen.rerender({
			chat: chat({
				streamTools: [{ id: 'tool-1', name: 'read', status: 'running', text: 'Reading file' }],
				streamText: 'The answer is ready.'
			})
		});
		expect(screen.container.querySelector('.pi-working-spinner')).toBeNull();
	});

	it('remains hidden after the runtime turn finishes', async () => {
		const screen = render(ChatTimeline, { chat: chat() });
		await expect.element(screen.getByRole('img', { name: 'Working' })).toBeVisible();

		await screen.rerender({
			chat: chat({ snapshot: { ...chat().snapshot!, isStreaming: false } })
		});
		expect(screen.container.querySelector('.pi-working-spinner')).toBeNull();
	});

	it('hides persisted model-change notices by default while keeping other notices visible', async () => {
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
						},
						{
							id: 'reasoning-change',
							kind: 'notice',
							text: 'Reasoning changed to high'
						},
						{
							id: 'compaction',
							kind: 'notice',
							text: 'Context compacted: Summary'
						},
						{
							id: 'branch-summary',
							kind: 'notice',
							text: 'Branch summary: Summary'
						},
						{
							id: 'session-name',
							kind: 'notice',
							text: 'Session named “My chat”'
						}
					]
				},
				transientNotices: [
					{ id: 'mcp-notice', message: 'The interactive MCP panel is terminal-only.' }
				]
			})
		});

		expect(screen.container.textContent).not.toContain('Model changed to openai/gpt-5.6');
		expect(screen.container.textContent).not.toContain('Reasoning changed to high');
		await expect.element(screen.getByText('Context compacted: Summary')).toBeVisible();
		await expect.element(screen.getByText('Branch summary: Summary')).toBeVisible();
		await expect.element(screen.getByText('Session named “My chat”')).toBeVisible();
		expect(screen.container.textContent).not.toContain(
			'The interactive MCP panel is terminal-only.'
		);
		expect(screen.container.querySelectorAll('.timeline-notice')).toHaveLength(3);

		await screen.rerender({
			chat: chat({
				snapshot: {
					...base.snapshot!,
					isStreaming: false,
					items: [
						{ id: 'model-change', kind: 'notice', text: 'Model changed to openai/gpt-5.6' },
						{ id: 'reasoning-change', kind: 'notice', text: 'Reasoning changed to high' }
					]
				}
			}),
			showModelChanges: true
		});
		await expect.element(screen.getByText('Model changed to openai/gpt-5.6')).toBeVisible();
		await expect.element(screen.getByText('Reasoning changed to high')).toBeVisible();
	});

	it('mounts metadata and copy controls before hover and preserves timestamp semantics', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		const restoreClipboard = mockClipboard(writeText);
		const base = chat();

		try {
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
			expect(screen.container.querySelectorAll('.message-meta-content')).toHaveLength(2);
			expect(screen.container.querySelectorAll('button[aria-label="Copy message"]')).toHaveLength(
				2
			);

			const times = [...screen.container.querySelectorAll('time')];
			expect(times).toHaveLength(2);
			for (const time of times) {
				expect(time.textContent?.trim()).not.toBe('');
				expect(time.getAttribute('datetime')).toMatch(/^2026-07-28T23:3[56]:00.000Z$/);
				expect(time.getAttribute('title')).not.toBe('');
			}

			expect(screen.container.textContent).toContain('GPT-5.6 Terra');
			expect(screen.container.textContent).toContain('medium');

			const firstCopy = screen.container.querySelector<HTMLButtonElement>(
				'button[aria-label="Copy message"]'
			)!;
			await firstCopy.click();
			await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('Inspect this message.'));
			await expect.element(screen.getByRole('button', { name: 'Copied message' })).toBeVisible();
		} finally {
			restoreClipboard();
		}
	});

	it('reveals only the hovered or focused message metadata', async () => {
		const base = chat();
		const screen = render(ChatTimeline, {
			chat: chat({
				snapshot: {
					...base.snapshot!,
					isStreaming: false,
					items: [
						{ id: 'user-1', kind: 'message', role: 'user', text: 'First message.' },
						{ id: 'assistant-1', kind: 'message', role: 'assistant', text: 'Second message.' }
					]
				}
			})
		});

		const entries = [...screen.container.querySelectorAll<HTMLElement>('.message-entry')];
		const metadata = [...screen.container.querySelectorAll<HTMLElement>('.message-meta-content')];
		expect(metadata.map((element) => getComputedStyle(element).opacity)).toEqual(['0', '0']);

		await screen.getByRole('group', { name: 'user message' }).hover();
		await vi.waitFor(() =>
			expect(Number(getComputedStyle(metadata[0]).opacity)).toBeGreaterThan(0.99)
		);
		expect(Number(getComputedStyle(metadata[1]).opacity)).toBeLessThan(0.01);

		await screen.getByRole('group', { name: 'assistant message' }).hover();
		await vi.waitFor(() =>
			expect(Number(getComputedStyle(metadata[1]).opacity)).toBeGreaterThan(0.99)
		);
		expect(Number(getComputedStyle(metadata[0]).opacity)).toBeLessThan(0.01);

		const focusStart = document.createElement('button');
		focusStart.type = 'button';
		focusStart.tabIndex = 0;
		screen.container.prepend(focusStart);
		focusStart.focus();
		await userEvent.tab();
		expect(document.activeElement).toBe(entries[0].querySelector('button'));
		await vi.waitFor(() =>
			expect(Number(getComputedStyle(metadata[0]).opacity)).toBeGreaterThan(0.99)
		);
		const firstFocusedButton = document.activeElement as HTMLButtonElement;
		expect(firstFocusedButton.matches(':focus-visible')).toBe(true);
		await userEvent.tab();
		expect(document.activeElement).toBe(entries[1].querySelector('button'));
		await vi.waitFor(() =>
			expect(Number(getComputedStyle(metadata[1]).opacity)).toBeGreaterThan(0.99)
		);
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

	it('copies persisted fenced code without adding controls to inline code', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		const restoreClipboard = mockClipboard(writeText);
		const base = chat();

		try {
			const screen = render(ChatTimeline, {
				chat: chat({
					snapshot: {
						...base.snapshot!,
						isStreaming: false,
						items: [
							{
								id: 'assistant-code',
								kind: 'message',
								role: 'assistant',
								text: 'Use `inlineCode`.\n\n```ts\nconst answer = 42;\n```'
							}
						]
					}
				})
			});
			const message = screen.container.querySelector('.message-markdown') as HTMLElement;

			expect(message.querySelectorAll('[data-code-copy]')).toHaveLength(1);
			expect(message.querySelector('p code [data-code-copy]')).toBeNull();
			const copyButton = message.querySelector<HTMLButtonElement>('[data-code-copy]')!;
			await copyButton.click();

			await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('const answer = 42;\n'));
			await vi.waitFor(() => expect(copyButton).toHaveAttribute('aria-label', 'Copied code'));
			expect(copyButton).toHaveClass('copied');
		} finally {
			restoreClipboard();
		}
	});

	it('does not add code controls or highlighting to streaming code', async () => {
		const text = '```bash\necho "done"\n```';
		const screen = render(ChatTimeline, {
			chat: chat({ streamText: text, streamRenderedText: text })
		});
		const message = screen.container.querySelector('.streaming .message-markdown') as HTMLElement;

		expect(message.querySelector('[data-code-copy]')).toBeNull();
		expect(message.querySelector('pre > code')).toHaveClass('language-bash');
		expect(message.innerHTML).not.toContain('hljs-');
	});

	it('reports finalized fenced code clipboard failures', async () => {
		const writeText = vi.fn().mockRejectedValue(new Error('Clipboard permission denied.'));
		const restoreClipboard = mockClipboard(writeText);
		const base = chat();

		try {
			const screen = render(ChatTimeline, {
				chat: chat({
					snapshot: {
						...base.snapshot!,
						isStreaming: false,
						items: [
							{
								id: 'assistant-code-failure',
								kind: 'message',
								role: 'assistant',
								text: '```\nsecret\n```'
							}
						]
					}
				})
			});
			await screen.getByRole('button', { name: 'Copy code' }).click();

			await expect
				.element(screen.getByRole('alert'))
				.toHaveTextContent('Clipboard permission denied.');
		} finally {
			restoreClipboard();
		}
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
		await expect.element(screen.getByText('Agent activity · 1 tool')).toBeVisible();
		expect(screen.container.querySelector('.thinking')).toBeNull();
		expect(screen.container.querySelectorAll('.message-entry-assistant')).toHaveLength(1);
		expect(screen.container.querySelector('.stopped-row')).toBeNull();
		const activity = [
			...screen.container.querySelectorAll<HTMLDetailsElement>('details.activity-group')
		].find((group) => group.textContent?.includes('1 tool')) as HTMLDetailsElement;
		expect(activity.open).toBe(false);
		await screen.getByText('Agent activity · 1 tool').click();
		await vi.waitFor(() => expect(activity.open).toBe(true));
		expect(screen.container.querySelector('.thinking')).toHaveTextContent('Partial reasoning.');
	});

	it('renders the throttled streaming snapshot as Markdown', async () => {
		const text = '## Streaming\n\n**Partial answer**';
		const screen = render(ChatTimeline, {
			chat: chat({ streamText: text, streamRenderedText: text })
		});

		const message = screen.container.querySelector('.streaming .message-markdown') as HTMLElement;
		expect(message.querySelector('h2')).toHaveTextContent('Streaming');
		expect(message.querySelector('strong')).toHaveTextContent('Partial answer');
	});

	it('replaces the unhighlighted streaming preview with finalized highlighted Markdown', async () => {
		const text = '```ts\nconst answer = 42;\n```';
		const base = chat();
		const screen = render(ChatTimeline, {
			chat: chat({ streamText: text, streamRenderedText: text })
		});

		const streamingMessage = screen.container.querySelector(
			'.streaming .message-markdown'
		) as HTMLElement;
		expect(streamingMessage.querySelector('[data-code-copy]')).toBeNull();
		expect(streamingMessage.innerHTML).not.toContain('hljs-');

		await screen.rerender({
			chat: chat({
				snapshot: {
					...base.snapshot!,
					isStreaming: false,
					items: [
						{
							id: 'assistant-final',
							kind: 'message',
							role: 'assistant',
							text
						}
					]
				},
				streamText: '',
				streamRenderedText: ''
			})
		});

		const finalMessage = screen.container.querySelector(
			'.message-entry-assistant .message-markdown'
		) as HTMLElement;
		expect(finalMessage.querySelector('[data-code-copy]')).not.toBeNull();
		expect(finalMessage.innerHTML).toContain('hljs-');
	});

	it('renders unsafe streaming HTML and links according to the shared safe policy', async () => {
		const text = '<script>alert("unsafe")</script>\n\n[unsafe](javascript:alert(1))';
		const screen = render(ChatTimeline, {
			chat: chat({ streamText: text, streamRenderedText: text })
		});
		const message = screen.container.querySelector('.streaming .message-markdown') as HTMLElement;

		expect(message.querySelector('script')).toBeNull();
		expect(message.querySelector('a')).toBeNull();
		expect(message.textContent).toContain('<script>alert("unsafe")</script>');
	});

	it('keeps live tool calls above the streaming response', async () => {
		const base = chat();
		const screen = render(ChatTimeline, {
			chat: chat({
				streamText: 'Streaming response.',
				streamTools: [{ id: 'tool-1', name: 'read', text: 'Reading README.md' }]
			})
		});

		const liveActivity = screen.container.querySelector('details.activity-group');
		const streamingMessage = screen.container.querySelector('article.streaming');
		expect([
			...screen.container.querySelectorAll('details.activity-group, article.streaming')
		]).toEqual([liveActivity, streamingMessage]);

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

		const persistedTools = screen.container.querySelector('details.activity-group');
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
						thinking: '**Historical reasoning**\n\n```ts\nconst answer = 42;\n```'
					}
				]
			}
		});
		const screen = render(ChatTimeline, { chat: chatWithReasoning });

		expect(screen.container.querySelectorAll('.thinking')).toHaveLength(0);
		expect(screen.container.querySelectorAll('details.activity-group')).toHaveLength(0);
		await screen.rerender({ chat: chatWithReasoning, showReasoning: true });
		const activity = screen.container.querySelector('details.activity-group') as HTMLDetailsElement;
		expect(activity.open).toBe(false);
		expect(screen.container.querySelector('.thinking')).toBeNull();
		await screen.getByText('Agent activity').click();
		await vi.waitFor(() => expect(activity.open).toBe(true));
		const thinking = activity.querySelector('.thinking');
		expect(thinking?.textContent).toContain('Historical reasoning');
		expect(thinking?.querySelector('strong')).toHaveTextContent('Historical reasoning');
		expect(thinking?.querySelector('code.language-ts')).toHaveTextContent('const answer = 42;');
		expect(thinking?.querySelector('.hljs-keyword')).toBeNull();
		expect(thinking?.querySelector('.code-copy-action')).toBeNull();
		expect(thinking?.tagName).toBe('DIV');
		expect(thinking?.querySelector('summary')).toBeNull();
		await expect.element(screen.getByText('Answer', { exact: true })).toBeVisible();
	});

	it('does not render a disclosure for hidden reasoning-only historical activity', async () => {
		const base = chat();
		const screen = render(ChatTimeline, {
			chat: chat({
				snapshot: {
					...base.snapshot!,
					isStreaming: false,
					items: [
						{
							id: 'reasoning-only',
							kind: 'message',
							role: 'assistant',
							text: '',
							thinking: 'Hidden reasoning'
						}
					]
				}
			})
		});

		expect(screen.container.querySelectorAll('details.activity-group')).toHaveLength(0);

		await screen.rerender({
			chat: chat({
				snapshot: {
					...base.snapshot!,
					isStreaming: false,
					items: [
						{
							id: 'reasoning-only',
							kind: 'message',
							role: 'assistant',
							text: '',
							thinking: 'Hidden reasoning'
						}
					]
				}
			}),
			showReasoning: true
		});

		expect(screen.container.querySelectorAll('details.activity-group')).toHaveLength(1);
	});

	it('hides reasoning-only stream deltas until reasoning display is enabled', async () => {
		const screen = render(ChatTimeline, {
			chat: chat({ streamThinking: '*Streaming reasoning*' })
		});

		expect(screen.container.querySelector('.streaming')).toBeNull();
		await expect.element(screen.getByRole('img', { name: 'Working' })).toBeVisible();

		await screen.rerender({
			chat: chat({ streamThinking: '*Streaming reasoning*' }),
			showReasoning: true
		});
		await expect.element(screen.getByText('Agent activity')).toBeVisible();
		expect(screen.container.querySelector('.pi-working-spinner')).toBeNull();
		expect(screen.container.querySelector('article.streaming')).toBeNull();
		const activity = screen.container.querySelector('details.activity-group') as HTMLDetailsElement;
		expect(activity.open).toBe(false);
		await screen.getByText('Agent activity').click();
		await vi.waitFor(() => expect(activity.open).toBe(true));
		const thinking = activity.querySelector('.thinking');
		expect(thinking?.textContent).toContain('Streaming reasoning');
		expect(thinking?.querySelector('em')).toHaveTextContent('Streaming reasoning');
		expect(thinking?.tagName).toBe('DIV');
		expect(thinking?.querySelector('summary')).toBeNull();
	});

	it('keeps a live reasoning activity open when its first tool arrives', async () => {
		const reactiveChat = $state(
			chat({
				pendingUserMessages: [
					{
						id: 'pending-user-1',
						text: 'Inspect the project.',
						attachments: [],
						timestamp: '2026-08-09T12:00:00.000Z',
						knownUserItemIds: []
					}
				],
				streamThinking: 'First, I will inspect the project.'
			})
		);
		const screen = render(ChatTimeline, { chat: reactiveChat, showReasoning: true });
		const activity = screen.container.querySelector('details.activity-group') as HTMLDetailsElement;

		expect(activity.open).toBe(false);
		await screen.getByText('Agent activity').click();
		await vi.waitFor(() => expect(activity.open).toBe(true));

		reactiveChat.streamTools.push({ id: 'tool-1', name: 'read', status: 'running' });
		flushSync();

		await vi.waitFor(() => {
			const updatedActivity = screen.container.querySelector(
				'details.activity-group'
			) as HTMLDetailsElement;
			expect(updatedActivity.open).toBe(true);
			expect(updatedActivity).toBe(activity);
		});
	});

	it('groups live reasoning and tools once while keeping the response outside', async () => {
		const screen = render(ChatTimeline, {
			chat: chat({
				streamThinking: '**Live reasoning**',
				streamTools: [{ id: 'live-tool', name: 'read', text: 'Live result' }],
				streamText: 'Live response.',
				streamRenderedText: 'Live response.'
			}),
			showReasoning: true
		});

		const activity = screen.container.querySelector('details.activity-group') as HTMLDetailsElement;
		expect(activity.open).toBe(false);
		expect(screen.container.querySelectorAll('.thinking')).toHaveLength(0);
		await expect.element(screen.getByText('Live response.', { exact: true })).toBeVisible();
		expect(screen.container.querySelector('article.streaming .thinking')).toBeNull();

		await screen.getByText('Agent activity · 1 tool').click();
		await vi.waitFor(() => expect(activity.open).toBe(true));
		const events = [
			...activity.querySelectorAll('.activity-events > .thinking, details.tool-group')
		];
		expect(events).toHaveLength(2);
		expect(events[0]).toHaveClass('thinking');
		expect(events[1]).toHaveClass('tool-group');
		expect(activity.querySelectorAll('.thinking')).toHaveLength(1);
		expect(activity.querySelector('.thinking strong')).toHaveTextContent('Live reasoning');
		expect(screen.container.querySelector('article.streaming .thinking')).toBeNull();
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
		const activity = screen.container.querySelector('details.activity-group') as HTMLDetailsElement;

		await expect.element(screen.getByText('Agent activity · 2 tools')).toBeVisible();
		expect(activity.open).toBe(false);
		expect(screen.container.querySelector('details.tool-group')).toBeNull();
		expect(screen.container.querySelector('.tool-list')).toBeNull();
		expect(screen.container.querySelector('.tool-detail pre')).toBeNull();
		expect(screen.container.querySelectorAll('.message-tool')).toHaveLength(0);

		await screen.getByText('Agent activity · 2 tools').click();
		await vi.waitFor(() => expect(activity.open).toBe(true));
		expect(activity.open).toBe(true);
		await expect.element(screen.getByText('2 tools called · 1 completed · 1 failed')).toBeVisible();
		const group = screen.container.querySelector('details.tool-group') as HTMLDetailsElement;
		expect(group.open).toBe(false);
		const resultsBeforeOpen = screen.container.querySelectorAll('.tool-result');
		expect(resultsBeforeOpen).toHaveLength(0);
		await screen.getByText('2 tools called · 1 completed · 1 failed').click();
		await vi.waitFor(() => expect(group.open).toBe(true));
		const results = screen.container.querySelectorAll('.tool-result');
		expect(results).toHaveLength(2);
		expect((results[0] as HTMLDetailsElement).open).toBe(false);
		expect((results[1] as HTMLDetailsElement).open).toBe(false);
		await screen.getByText('Result').first().click();
		await vi.waitFor(() =>
			expect(screen.container.querySelector('.tool-result')?.hasAttribute('open')).toBe(true)
		);
		await expect.element(screen.getByText('README contents')).toBeVisible();
		await screen.getByText('Agent activity · 2 tools').click();
		await vi.waitFor(() => expect(activity.open).toBe(false));
		expect(screen.container.querySelector('.tool-list')).toBeNull();
		await screen.getByText('Agent activity · 2 tools').click();
		await expect.element(screen.getByText('README contents')).toBeVisible();
		expect(screen.container.querySelectorAll('.copy-action')).toHaveLength(0);
	});

	it('keeps call-id-backed disclosure state during the live-to-final handoff', async () => {
		const base = chat();
		const screen = render(ChatTimeline, {
			chat: chat({
				streamTools: [
					{
						id: 'tool-1',
						name: 'read',
						status: 'completed',
						arguments: '{"path":"README.md"}',
						text: 'README contents'
					}
				]
			})
		});

		await screen.getByText('Agent activity · 1 tool').click();
		await screen.getByText('1 tool called · 1 completed').click();
		await screen.getByText('Result').click();
		await expect.element(screen.getByText('README contents')).toBeVisible();
		await screen.rerender({
			chat: chat({
				snapshot: {
					...base.snapshot!,
					isStreaming: false,
					items: [
						{
							id: 'assistant-final',
							kind: 'message',
							role: 'assistant',
							text: '',
							toolCalls: [{ id: 'tool-1', name: 'read', arguments: '{"path":"README.md"}' }]
						},
						{
							id: 'result-final',
							kind: 'message',
							role: 'tool',
							toolCallId: 'tool-1',
							text: 'README contents'
						}
					]
				},
				streamTools: []
			})
		});

		const activity = screen.container.querySelector('details.activity-group') as HTMLDetailsElement;
		expect(activity.open).toBe(true);
		const group = activity.querySelector('details.tool-group') as HTMLDetailsElement;
		expect(group.open).toBe(true);
		await expect.element(screen.getByText('README contents')).toBeVisible();
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
							text: 'The project is ready to run.',
							thinking: 'Final reasoning'
						}
					]
				}
			}),
			showReasoning: true
		});

		expect(screen.container.querySelectorAll('details.activity-group')).toHaveLength(1);
		await expect.element(screen.getByText('Agent activity · 3 tools')).toBeVisible();
		expect(screen.container.querySelectorAll('details.tool-group')).toHaveLength(0);
		expect(screen.container.querySelector('.thinking')).toBeNull();
		await expect.element(screen.getByText('The project is ready to run.')).toBeVisible();
		await screen.getByText('Agent activity · 3 tools').click();
		await expect.element(screen.getByText('3 tools called · 3 completed')).toBeVisible();
		expect(screen.container.querySelector('.tool-group-status')).toBeNull();
		await expect.element(screen.getByText('Final reasoning')).toBeVisible();
	});

	it('keeps text, reasoning, and tool calls in one unique activity group', async () => {
		const items: ChatItem[] = [
			{
				id: 'assistant-with-tools',
				kind: 'message',
				role: 'assistant',
				text: 'Visible response',
				thinking: 'Reasoning before tools',
				toolCalls: [{ id: 'tool-with-response', name: 'read', arguments: '{}' }]
			},
			{
				id: 'result-with-tools',
				kind: 'message',
				role: 'tool',
				toolCallId: 'tool-with-response',
				text: 'Tool result'
			}
		];
		const timeline = buildFinalizedTimeline(items, [], false);
		const activities = timeline.filter((entry) => entry.kind === 'activity');

		expect(activities).toHaveLength(1);
		expect(new Set(activities.map((entry) => entry.id)).size).toBe(activities.length);
		expect(timeline.map((entry) => entry.kind)).toEqual(['activity', 'item']);
		if (activities[0]?.kind === 'activity') {
			expect(activities[0].entries.map((entry) => entry.kind)).toEqual(['reasoning', 'tools']);
		}

		const screen = render(ChatTimeline, {
			chat: chat({
				snapshot: {
					...chat().snapshot!,
					isStreaming: false,
					items
				}
			})
		});
		await expect.element(screen.getByText('Visible response')).toBeVisible();
		expect(screen.container.querySelectorAll('details.activity-group')).toHaveLength(1);
		expect(
			(screen.container.querySelector('details.activity-group') as HTMLDetailsElement).open
		).toBe(false);
	});

	it('renders tool reasoning chronologically without a disclosure control', async () => {
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
							thinking: '**Reasoning A**',
							toolCalls: [{ id: 'tool-1', name: 'read', arguments: '{}' }]
						},
						{
							id: 'result-1',
							kind: 'message',
							role: 'tool',
							toolCallId: 'tool-1',
							text: 'Result A'
						},
						{
							id: 'assistant-2',
							kind: 'message',
							role: 'assistant',
							text: '',
							thinking: 'Reasoning B',
							toolCalls: [{ id: 'tool-2', name: 'bash', arguments: '{}' }]
						},
						{
							id: 'result-2',
							kind: 'message',
							role: 'tool',
							toolCallId: 'tool-2',
							text: 'Result B'
						}
					]
				}
			}),
			showReasoning: true
		});

		const activity = screen.container.querySelector('details.activity-group') as HTMLDetailsElement;
		expect(activity.open).toBe(false);
		expect(screen.container.querySelector('.activity-events')).toBeNull();
		expect(screen.container.querySelectorAll('.thinking')).toHaveLength(0);
		await screen.getByText('Agent activity · 2 tools').click();
		await vi.waitFor(() => expect(activity.open).toBe(true));

		const events = [
			...activity.querySelectorAll(
				'.activity-events > .thinking, .activity-events > details.tool-group'
			)
		];
		expect(events.map((event) => (event.matches('.thinking') ? 'reasoning' : 'tools'))).toEqual([
			'reasoning',
			'tools',
			'reasoning',
			'tools'
		]);
		expect(
			[...activity.querySelectorAll('.activity-events > .thinking')].map((event) =>
				event.textContent?.trim()
			)
		).toEqual(['Reasoning A', 'Reasoning B']);
		expect(activity.querySelector('.activity-events > .thinking strong')).toHaveTextContent(
			'Reasoning A'
		);
		expect(activity.querySelectorAll('.thinking details, .thinking summary')).toHaveLength(0);

		const groups = activity.querySelectorAll<HTMLDetailsElement>('details.tool-group');
		const groupSummaries = screen.getByText('1 tool called · 1 completed');
		await groupSummaries.first().click();
		await groupSummaries.last().click();
		await vi.waitFor(() => expect([...groups].every((group) => group.open)).toBe(true));
		expect(
			[...groups].map((group) => group.querySelector('.tool-entry-heading strong')?.textContent)
		).toEqual(['read', 'bash']);
		const resultSummaries = screen.getByText('Result');
		await resultSummaries.first().click();
		await resultSummaries.last().click();
		await vi.waitFor(() =>
			expect(
				[...groups].map((group) => group.querySelector('.tool-result pre')?.textContent)
			).toEqual(['Result A', 'Result B'])
		);
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

		expect(screen.container.querySelectorAll('details.activity-group')).toHaveLength(4);
		expect(screen.container.querySelectorAll('details.tool-group')).toHaveLength(0);
		await expect.element(screen.getByText('Persisted notice')).toBeVisible();
		await expect.element(screen.getByText('Stopped')).toBeVisible();
	});

	it('renders unmatched live tools separately from finalized groups', async () => {
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
		const groups = screen.container.querySelectorAll('details.activity-group');
		const finalizedGroup = groups[0] as HTMLDetailsElement;
		const liveGroup = groups[1] as HTMLDetailsElement;

		expect(groups).toHaveLength(2);
		expect(finalizedGroup.closest('.message-assistant')).toBeNull();
		expect(finalizedGroup.open).toBe(false);
		expect(liveGroup.open).toBe(false);
		await expect.element(screen.getByText('I will inspect the project.')).toBeVisible();
		expect(liveGroup.nextElementSibling).toBe(screen.container.querySelector('article.streaming'));
		await screen.getByText('Agent activity · 1 tool').last().click();
		await vi.waitFor(() => expect(liveGroup.open).toBe(true));
		const innerLiveGroup = liveGroup.querySelector('details.tool-group') as HTMLDetailsElement;
		expect(innerLiveGroup).not.toBeNull();
		await screen.getByText('1 tool called · 1 running').click();
		await vi.waitFor(() => expect(innerLiveGroup.open).toBe(true));
		expect(screen.container.querySelectorAll('.tool-detail > span')).toHaveLength(0);
		const statuses = [...liveGroup.querySelectorAll<HTMLElement>('.tool-entry-heading span')];
		expect(statuses.map((status) => status.textContent?.trim())).toEqual(['running']);
		await screen.getByText('Result').click();
		await expect.element(screen.getByText('Running tests')).toBeVisible();
	});

	it('updates only the finalized group that owns a live tool patch', async () => {
		const base = chat();
		const reactiveChat = $state(
			chat({
				snapshot: {
					...base.snapshot!,
					isStreaming: false,
					items: [
						{
							id: 'assistant-a',
							kind: 'message',
							role: 'assistant',
							text: '',
							toolCalls: [{ id: 'tool-a', name: 'read', arguments: '{}' }]
						},
						{ id: 'between-tools', kind: 'message', role: 'user', text: 'Continue.' },
						{
							id: 'assistant-b',
							kind: 'message',
							role: 'assistant',
							text: '',
							toolCalls: [{ id: 'tool-b', name: 'bash', arguments: '{}' }]
						}
					]
				},
				streamTools: [
					{ id: 'tool-a', name: 'read', status: 'running' },
					{ id: 'tool-b', name: 'bash', status: 'running' }
				]
			})
		);
		const screen = render(ChatTimeline, { chat: reactiveChat });

		await expect.element(screen.getByText('Agent activity · 1 tool').first()).toBeVisible();
		expect(screen.container.querySelectorAll('details.activity-group')).toHaveLength(2);
		expect(screen.container.querySelectorAll('details.tool-group')).toHaveLength(0);

		const batcher = new StreamUpdateBatcher();
		batcher.queueToolUpdate(reactiveChat, {
			id: 'tool-a',
			name: 'read',
			status: 'completed',
			text: 'README contents'
		});
		batcher.flush(reactiveChat.id);
		flushSync();

		await expect.element(screen.getByText('Agent activity · 1 tool').first()).toBeVisible();
		await expect.element(screen.getByText('Agent activity · 1 tool').last()).toBeVisible();
		await screen.getByText('Agent activity · 1 tool').first().click();
		await screen.getByText('Agent activity · 1 tool').last().click();
		await screen.getByText('1 tool called · 1 completed').click();
		await screen.getByText('1 tool called · 1 running').click();
		await vi.waitFor(() =>
			expect(
				[...screen.container.querySelectorAll<HTMLElement>('.tool-entry-heading span')].map(
					(status) => status.textContent?.trim()
				)
			).toEqual(['completed', 'running'])
		);
	});

	it('keeps the live activity open when its first tool finalizes before another', async () => {
		const base = chat();
		const reactiveChat = $state(
			chat({
				streamTools: [
					{ id: 'tool-first', name: 'read', status: 'running' },
					{ id: 'tool-second', name: 'bash', status: 'running' }
				]
			})
		);
		const screen = render(ChatTimeline, { chat: reactiveChat });

		const initialActivity = screen.container.querySelector(
			'details.activity-group'
		) as HTMLDetailsElement;
		await screen.getByText('Agent activity · 2 tools').click();
		await vi.waitFor(() => expect(initialActivity.open).toBe(true));

		reactiveChat.snapshot = {
			...base.snapshot!,
			isStreaming: false,
			items: [
				{
					id: 'assistant-finalized-first',
					kind: 'message',
					role: 'assistant',
					text: '',
					toolCalls: [{ id: 'tool-first', name: 'read', arguments: '{}' }]
				},
				{
					id: 'result-finalized-first',
					kind: 'message',
					role: 'tool',
					toolCallId: 'tool-first',
					text: 'First result'
				}
			]
		};
		flushSync();

		const groups = screen.container.querySelectorAll<HTMLDetailsElement>('details.activity-group');
		expect(groups).toHaveLength(2);
		expect(groups[1]?.open).toBe(true);
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

		await expect.element(screen.getByText('Agent activity · 2 tools')).toBeVisible();
		await expect.element(screen.getByText('Legacy result')).toBeVisible();
		expect(screen.container.querySelectorAll('.message-tool')).toHaveLength(1);
		expect(screen.container.querySelectorAll('details.tool-group')).toHaveLength(0);
		await screen.getByText('Agent activity · 2 tools').click();
		await screen.getByText('2 tools called · 2 running').click();
		await screen.getByText('Result').last().click();
		await expect.element(screen.getByText('Running tests')).toBeVisible();
	});
});

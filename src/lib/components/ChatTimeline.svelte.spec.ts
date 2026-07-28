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
});

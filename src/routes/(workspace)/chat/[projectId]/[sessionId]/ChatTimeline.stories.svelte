<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import ChatTimeline from './ChatTimeline.svelte';

	const baseChat = {
		id: 'storybook-chat',
		kind: 'chat' as const,
		title: 'Tool lifecycle',
		projectId: 'project-1',
		sessionId: 'session-1',
		runtimeId: 'runtime-1',
		hydrating: false,
		draft: '',
		queueMode: 'followUp' as const,
		streamText: '',
		streamRenderedText: '',
		streamThinking: '',
		transientNotices: [],
		permissionRequests: [],
		pendingUserMessages: [],
		snapshot: {
			runtimeId: 'runtime-1',
			project: {
				id: 'project-1',
				name: 'Storybook project',
				cwd: '/tmp/storybook-project',
				addedAt: '2026-01-01T00:00:00.000Z',
				lastOpenedAt: '2026-01-01T00:00:00.000Z'
			},
			sessionId: 'session-1',
			thinkingLevel: 'medium' as const,
			isStreaming: false,
			items: [],
			permissionRequests: []
		}
	};

	const completedCall = {
		id: 'assistant-tools',
		kind: 'message' as const,
		role: 'assistant' as const,
		text: '',
		toolCalls: [{ id: 'read-1', name: 'read', arguments: '{\n  "path": "README.md"\n}' }]
	};

	const { Story } = defineMeta({ component: ChatTimeline });
</script>

<Story
	name="Collapsed completed tool"
	args={{
		chat: {
			...baseChat,
			streamTools: [],
			snapshot: {
				...baseChat.snapshot,
				items: [
					completedCall,
					{
						id: 'read-result',
						kind: 'message',
						role: 'tool',
						toolCallId: 'read-1',
						text: 'A deliberately large result would remain unmounted while this group is closed.'
					}
				]
			}
		}
	}}
	play={async ({ canvas }) => {
		await expect(canvas.getByText('1 tool called · 1 completed')).toBeVisible();
		await expect(canvas.queryByText('Arguments')).not.toBeInTheDocument();
	}}
/>

<Story
	name="Running to completed"
	args={{
		chat: {
			...baseChat,
			streamTools: [
				{
					id: 'read-1',
					name: 'read',
					status: 'completed' as const,
					arguments: '{\n  "path": "README.md"\n}',
					text: 'README contents'
				}
			],
			snapshot: { ...baseChat.snapshot, isStreaming: true }
		}
	}}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByText('1 tool called · 1 completed'));
		await expect(canvas.getByText('Arguments')).toBeVisible();
		await expect(canvas.getByText('completed')).toBeVisible();
	}}
/>

<Story
	name="Failed tool"
	args={{
		chat: {
			...baseChat,
			streamTools: [
				{
					id: 'bash-1',
					name: 'bash',
					status: 'failed' as const,
					text: 'Command exited with code 1'
				}
			],
			snapshot: { ...baseChat.snapshot, isStreaming: true }
		}
	}}
/>

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

	const largeCodeBlock = `\`\`\`ts\n${Array.from(
		{ length: 80 },
		(_, index) => `const measuredValue${index} = ${index};`
	).join('\n')}\n\`\`\``;
	const fixtureImage = {
		id: 'fixture-image',
		kind: 'image' as const,
		name: 'fixture.png',
		mimeType: 'image/png',
		size: 68,
		data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9VQAAAABJRU5ErkJggg=='
	};
	const longConversationItems = Array.from({ length: 200 }, (_, index) => {
		if (index % 60 === 0) {
			return {
				id: `fixture-call-${index}`,
				kind: 'message' as const,
				role: 'assistant' as const,
				text: '',
				toolCalls: [
					{ id: `fixture-tool-${index}`, name: 'read', arguments: '{"path":"README.md"}' }
				]
			};
		}

		if (index % 60 === 1) {
			return {
				id: `fixture-result-${index}`,
				kind: 'message' as const,
				role: 'tool' as const,
				toolCallId: `fixture-tool-${index - 1}`,
				text: `Tool result ${index}`
			};
		}

		if (index % 25 === 0) {
			return {
				id: `fixture-notice-${index}`,
				kind: 'notice' as const,
				text: `Context compacted at fixture entry ${index}.`
			};
		}

		const isAssistant = index % 2 === 0;

		return {
			id: `fixture-message-${index}`,
			kind: 'message' as const,
			role: isAssistant ? ('assistant' as const) : ('user' as const),
			text:
				isAssistant && index % 20 === 0
					? `Large highlighted code block ${index}\n\n${largeCodeBlock}`
					: `Fixture message ${index}: representative conversation content for long-history profiling.`,
			attachments: index % 33 === 0 ? [{ ...fixtureImage, id: `fixture-image-${index}` }] : []
		};
	});

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

<Story
	name="200-message performance fixture"
	exportName="longConversationPerformanceFixture"
	args={{
		chat: {
			...baseChat,
			streamTools: [],
			snapshot: { ...baseChat.snapshot, items: longConversationItems }
		}
	}}
	play={async ({ canvasElement }) => {
		await expect(canvasElement.querySelectorAll('.message-entry')).toHaveLength(185);
		await expect(canvasElement.querySelectorAll('.timeline-notice')).toHaveLength(7);
		await expect(canvasElement.querySelectorAll('.tool-group')).toHaveLength(4);
		await expect(canvasElement.querySelectorAll('.attachment-preview')).toHaveLength(6);
		await expect(canvasElement.querySelectorAll('.message-markdown pre')).toHaveLength(5);
	}}
/>

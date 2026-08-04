<script lang="ts">
	import type { ChatItem, RuntimeSnapshot } from '$lib/contracts';
	import type { ChatTab } from '$lib/harness/types';
	import ChatTimeline from '../../(workspace)/chat/[projectId]/[sessionId]/ChatTimeline.svelte';

	const FIXTURE_MESSAGE_COUNT = 200;
	const FIXTURE_PAIR_COUNT = FIXTURE_MESSAGE_COUNT / 2;
	const FIXTURE_NOTICE_COUNT = 4;
	const FIXTURE_TOOL_GROUP_COUNT = 5;
	const FIXTURE_IMAGE_COUNT = 6;
	const FIXTURE_LARGE_CODE_BLOCK_COUNT = 5;
	const FIXTURE_IMAGE_DATA =
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
	const LARGE_CODE = Array.from(
		{ length: 48 },
		(_, line) =>
			`const fixtureRow${String(line + 1).padStart(2, '0')} = { index: ${line + 1}, stable: true };`
	).join('\n');

	function fixtureTimestamp(index: number): string {
		return new Date(Date.UTC(2026, 6, 1, 9, index)).toISOString();
	}

	function userText(index: number): string {
		return [
			`Please inspect fixture message ${index + 1} and summarize the result.`,
			`Compare row ${index + 1} with the previous result and note any changes.`,
			`Keep the response focused on the deterministic timeline fixture data.`,
			`Can you explain the expected output for fixture row ${index + 1}?`
		][index % 4];
	}

	function assistantText(index: number): string {
		const row = index + 1;
		if (index % 20 === 9) {
			return `## Fixture response ${row}\n\nThe long code sample exercises fenced Markdown and code-copy controls.\n\n\`\`\`ts\n${LARGE_CODE}\n\`\`\`\n\n- Stable row: ${row}\n- Deterministic content: yes`;
		}

		return [
			`## Fixture response ${row}\n\n**Ready.** The timeline row is stable and includes \`inline code\`.`,
			`> Fixture response ${row} remains deterministic.\n\nThe historical result includes a [stable reference](https://example.test/fixture/${row}).`,
			`Fixture response ${row} contains:\n\n- one rendered list\n- one preserved timestamp\n- one reusable metadata row`,
			`The fixture result for row ${row} is complete.\n\nThis paragraph intentionally varies the Markdown shape.`
		][index % 4];
	}

	function fixturePair(index: number): ChatItem[] {
		const timestamp = fixtureTimestamp(index * 2);
		const assistantTimestamp = fixtureTimestamp(index * 2 + 1);
		const assistant: ChatItem = {
			id: `assistant-${index + 1}`,
			kind: 'message',
			role: 'assistant',
			text: assistantText(index),
			modelName: 'Fixture model',
			timestamp: assistantTimestamp
		};

		if (index < FIXTURE_IMAGE_COUNT) {
			assistant.attachments = [
				{
					id: `fixture-image-${index + 1}`,
					kind: 'image',
					name: `fixture-image-${index + 1}.png`,
					mimeType: 'image/png',
					size: FIXTURE_IMAGE_DATA.length,
					data: FIXTURE_IMAGE_DATA
				}
			];
		}

		if (index % 20 === 19) {
			const toolId = `fixture-tool-${index + 1}`;
			assistant.toolCalls = [
				{
					id: toolId,
					name: 'read',
					arguments: JSON.stringify({ path: `fixture/row-${index + 1}.md` })
				}
			];

			return [
				{
					id: `user-${index + 1}`,
					kind: 'message',
					role: 'user',
					text: userText(index),
					timestamp
				},
				assistant,
				{
					id: `fixture-result-${index + 1}`,
					kind: 'message',
					role: 'tool',
					toolCallId: toolId,
					text: `Stable tool result for fixture row ${index + 1}.`
				}
			];
		}

		return [
			{
				id: `user-${index + 1}`,
				kind: 'message',
				role: 'user',
				text: userText(index),
				timestamp
			},
			assistant
		];
	}

	const fixtureItems: ChatItem[] = Array.from({ length: FIXTURE_PAIR_COUNT }, (_, index) => {
		const pair = fixturePair(index);
		if ((index + 1) % 25 === 0) {
			pair.push({
				id: `fixture-notice-${index + 1}`,
				kind: 'notice',
				text: `Fixture notice ${index / 25 + 1}: historical context remains stable.`
			});
		}

		return pair;
	}).flat();

	const fixtureCounts = {
		messages: fixtureItems.filter((item) => item.role === 'user' || item.role === 'assistant')
			.length,
		notices: fixtureItems.filter((item) => item.kind === 'notice').length,
		toolGroups: fixtureItems.filter((item) => item.toolCalls?.length).length,
		images: fixtureItems
			.flatMap((item) => item.attachments ?? [])
			.filter((item) => item.kind === 'image').length,
		largeCodeBlocks: fixtureItems.filter(
			(item) => item.role === 'assistant' && item.text.includes(LARGE_CODE)
		).length
	};

	if (
		fixtureCounts.messages !== FIXTURE_MESSAGE_COUNT ||
		fixtureCounts.notices !== FIXTURE_NOTICE_COUNT ||
		fixtureCounts.toolGroups !== FIXTURE_TOOL_GROUP_COUNT ||
		fixtureCounts.images !== FIXTURE_IMAGE_COUNT ||
		fixtureCounts.largeCodeBlocks !== FIXTURE_LARGE_CODE_BLOCK_COUNT
	) {
		throw new Error('Timeline performance fixture counts changed unexpectedly.');
	}

	const snapshot: RuntimeSnapshot = {
		runtimeId: 'timeline-performance-fixture',
		project: {
			id: 'timeline-performance-project',
			name: 'Timeline performance fixture',
			cwd: '/fixture/timeline-performance',
			addedAt: '2026-07-01T09:00:00.000Z',
			lastOpenedAt: '2026-07-01T09:00:00.000Z'
		},
		sessionId: 'timeline-performance-session',
		model: {
			provider: 'fixture',
			id: 'timeline-performance-model',
			name: 'Fixture model',
			reasoning: true
		},
		thinkingLevel: 'medium',
		isStreaming: false,
		items: fixtureItems,
		permissionRequests: []
	};

	const fixtureChat: ChatTab = {
		id: 'timeline-performance-chat',
		kind: 'chat',
		title: 'Timeline performance fixture',
		projectId: snapshot.project.id,
		sessionId: snapshot.sessionId,
		runtimeId: snapshot.runtimeId,
		snapshot,
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
		streamToolsByCallId: new Map()
	};
</script>

<svelte:head>
	<title>Timeline performance fixture</title>
</svelte:head>

<main
	class="timeline-performance-fixture"
	data-fixture="timeline-performance"
	data-message-count={fixtureCounts.messages}
	data-notice-count={fixtureCounts.notices}
	data-tool-group-count={fixtureCounts.toolGroups}
	data-image-count={fixtureCounts.images}
	data-large-code-block-count={fixtureCounts.largeCodeBlocks}
>
	<header class="fixture-header">
		<h1>Timeline performance fixture</h1>
		<p>Production-preview fixture for timeline rendering and keyboard traversal measurements.</p>
		<dl class="fixture-counts" aria-label="Fixture counts">
			<div data-fixture-stat="messages">
				<dt>Messages</dt>
				<dd>{fixtureCounts.messages}</dd>
			</div>
			<div data-fixture-stat="notices">
				<dt>Notices</dt>
				<dd>{fixtureCounts.notices}</dd>
			</div>
			<div data-fixture-stat="tool-groups">
				<dt>Closed tool groups</dt>
				<dd>{fixtureCounts.toolGroups}</dd>
			</div>
			<div data-fixture-stat="images">
				<dt>Images</dt>
				<dd>{fixtureCounts.images}</dd>
			</div>
			<div data-fixture-stat="large-code-blocks">
				<dt>Large code blocks</dt>
				<dd>{fixtureCounts.largeCodeBlocks}</dd>
			</div>
		</dl>
	</header>

	<section class="fixture-timeline" aria-label="Timeline performance messages">
		<ChatTimeline chat={fixtureChat} showReasoning showModelChanges />
	</section>
</main>

<style>
	.timeline-performance-fixture {
		min-height: 100vh;
		padding: 1.5rem max(1rem, calc((100vw - 58rem) / 2)) 3rem;
	}

	.fixture-header {
		max-width: 54rem;
		margin: 0 auto 1.5rem;
	}

	h1 {
		margin: 0;
		font-size: 1.5rem;
	}

	.fixture-header p {
		margin: 0.5rem 0 1rem;
		color: var(--text-muted);
		font-size: 0.85rem;
	}

	.fixture-counts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem 1rem;
		margin: 0;
		color: var(--text-muted);
		font-size: 0.78rem;
	}

	.fixture-counts div {
		display: flex;
		gap: 0.35rem;
	}

	.fixture-counts dd {
		margin: 0;
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}

	.fixture-timeline {
		max-width: 58rem;
		margin: 0 auto;
	}
</style>

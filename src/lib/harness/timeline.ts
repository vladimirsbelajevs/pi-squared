import type { ChatItem, ChatToolCall } from '$lib/contracts';
import type { PendingUserMessage } from '$lib/harness/types';

export type FinalToolView = {
	id: string;
	name: string;
	arguments?: string;
	result?: ChatItem;
	owner?: ChatItem;
};

export type FinalTimelineEntry =
	| { id: string; kind: 'item'; item: ChatItem; thinking?: string }
	| { id: string; kind: 'stopped' }
	| { id: string; kind: 'reasoning'; text: string }
	| { id: string; kind: 'tools'; tools: FinalToolView[] };

/** Builds historical rows only. Live assistant and tool state deliberately stay out of this function. */
export function buildFinalizedTimeline(
	persistedItems: ChatItem[],
	pendingMessages: PendingUserMessage[],
	showModelChanges: boolean
): FinalTimelineEntry[] {
	const items: ChatItem[] = [
		...persistedItems.filter(
			(item) =>
				showModelChanges ||
				item.kind !== 'notice' ||
				(!item.text.startsWith('Model changed to ') &&
					!item.text.startsWith('Reasoning changed to '))
		),
		...pendingMessages.map((message) => ({
			id: message.id,
			kind: 'message' as const,
			role: 'user' as const,
			text: message.text,
			attachments: message.attachments,
			timestamp: message.timestamp
		}))
	];
	const calledIds = new Set(items.flatMap((item) => item.toolCalls?.map((tool) => tool.id) ?? []));
	const resultsByCallId = new Map(
		items
			.filter((item) => item.role === 'tool' && item.toolCallId)
			.map((item) => [item.toolCallId!, item])
	);
	const timeline: FinalTimelineEntry[] = [];
	let activeTools: Extract<FinalTimelineEntry, { kind: 'tools' }> | undefined;

	function calls(item: ChatItem): FinalToolView[] {
		return (item.toolCalls ?? []).map((tool: ChatToolCall) => ({
			id: tool.id,
			name: tool.name,
			arguments: tool.arguments,
			result: resultsByCallId.get(tool.id),
			owner: item
		}));
	}

	for (const item of items) {
		if (item.role === 'tool' && item.toolCallId && calledIds.has(item.toolCallId)) {
			continue;
		}

		const tools = calls(item);
		const emptyAssistant =
			item.role === 'assistant' &&
			!item.text &&
			!item.thinking &&
			!tools.length &&
			!item.attachments?.length;
		if (emptyAssistant) {
			if (item.stopReason === 'aborted') {
				timeline.push({ id: `stopped-${item.id}`, kind: 'stopped' });
			}

			activeTools = undefined;
			continue;
		}

		const toolOnly = item.role === 'assistant' && !item.text && tools.length > 0;
		if (toolOnly && item.thinking) {
			timeline.push({ id: `reasoning-${item.id}`, kind: 'reasoning', text: item.thinking });
			activeTools = undefined;
		}

		if (toolOnly && activeTools) {
			activeTools.tools.push(...tools);
			continue;
		}

		if (toolOnly) {
			const entry: Extract<FinalTimelineEntry, { kind: 'tools' }> = {
				id: `tools-${item.id}`,
				kind: 'tools',
				tools
			};
			timeline.push(entry);
			activeTools = entry;
			continue;
		}

		timeline.push({ id: item.id, kind: 'item', item, thinking: item.thinking });
		activeTools = undefined;
		if (tools.length) {
			timeline.push({ id: `tools-${item.id}`, kind: 'tools', tools });
		}
	}

	return timeline;
}

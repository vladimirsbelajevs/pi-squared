import type { ChatItem, ChatToolCall } from '$lib/contracts';
import type { PendingUserMessage } from '$lib/harness/types';

export type FinalToolView = {
	id: string;
	name: string;
	arguments?: string;
	result?: ChatItem;
	owner?: ChatItem;
};

export type FinalActivityEntry =
	| { id: string; kind: 'reasoning'; text: string }
	| { id: string; kind: 'tools'; tools: FinalToolView[] };

export type FinalTimelineEntry =
	| { id: string; kind: 'item'; item: ChatItem; thinking?: string }
	| { id: string; kind: 'stopped' }
	| { id: string; kind: 'activity'; entries: FinalActivityEntry[] };

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
	let activeActivity: Extract<FinalTimelineEntry, { kind: 'activity' }> | undefined;
	let activityAnchorId: string | undefined;

	function calls(item: ChatItem): FinalToolView[] {
		return (item.toolCalls ?? []).map((tool: ChatToolCall) => ({
			id: tool.id,
			name: tool.name,
			arguments: tool.arguments,
			result: resultsByCallId.get(tool.id),
			owner: item
		}));
	}

	function ensureActivity(id: string): Extract<FinalTimelineEntry, { kind: 'activity' }> {
		if (activeActivity) {
			return activeActivity;
		}

		const activityId = activityAnchorId ?? id;
		const activity: Extract<FinalTimelineEntry, { kind: 'activity' }> = {
			id: `activity-${activityId}`,
			kind: 'activity',
			entries: []
		};
		timeline.push(activity);
		activeActivity = activity;

		return activity;
	}

	function appendReasoning(id: string, text: string): void {
		ensureActivity(id).entries.push({ id: `reasoning-${id}`, kind: 'reasoning', text });
	}

	function appendTools(id: string, tools: FinalToolView[]): void {
		const activity = ensureActivity(id);
		const previous = activity.entries.at(-1);
		if (previous?.kind === 'tools') {
			previous.tools.push(...tools);

			return;
		}

		activity.entries.push({ id: `tools-${id}`, kind: 'tools', tools });
	}

	function endActivity(): void {
		activeActivity = undefined;
		activityAnchorId = undefined;
	}

	for (const item of items) {
		if (item.role === 'tool' && item.toolCallId && calledIds.has(item.toolCallId)) {
			continue;
		}

		const tools = calls(item);
		if (item.role === 'user') {
			endActivity();
			activityAnchorId = item.id;
		}

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

			endActivity();
			continue;
		}

		const toolOnly = item.role === 'assistant' && !item.text && tools.length > 0;
		const reasoningOnly =
			item.role === 'assistant' &&
			!item.text &&
			!tools.length &&
			!item.attachments?.length &&
			Boolean(item.thinking);
		if (reasoningOnly) {
			appendReasoning(item.id, item.thinking!);
			continue;
		}

		if (toolOnly) {
			const activityId = tools[0]?.id ?? item.id;
			if (item.thinking) {
				appendReasoning(activityId, item.thinking);
			}

			appendTools(activityId, tools);
			continue;
		}

		const assistantReasoning = item.role === 'assistant' ? item.thinking : undefined;
		if (assistantReasoning) {
			appendReasoning(item.id, assistantReasoning);
		}

		timeline.push({
			id: item.id,
			kind: 'item',
			item,
			thinking: assistantReasoning ? undefined : item.thinking
		});

		if (tools.length) {
			appendTools(item.id, tools);
		}

		if (item.role !== 'user') {
			endActivity();
		}
	}

	return timeline;
}

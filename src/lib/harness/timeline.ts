import type { ChatItem, ChatToolCall, SubagentRun } from '$lib/contracts';
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
	| { id: string; kind: 'activity'; entries: FinalActivityEntry[] }
	| { id: string; kind: 'subagent-card'; run: SubagentRun };

function parseArguments(value: string | undefined): Record<string, unknown> | undefined {
	if (!value) {
		return undefined;
	}

	try {
		const parsed: unknown = JSON.parse(value);

		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

/** Conservative browser-side projection used before the server has persisted a live tool call. */
export function inferRunningSubagentRuns(items: ChatItem[], toolIds: string[] = []): SubagentRun[] {
	const runs: SubagentRun[] = [];
	for (const item of items) {
		for (const tool of item.toolCalls ?? []) {
			if (tool.name !== 'subagent') {
				continue;
			}

			const args = parseArguments(tool.arguments);
			if (
				!args ||
				('action' in args &&
					args.action !== undefined &&
					args.action !== null &&
					String(args.action).length > 0)
			) {
				continue;
			}

			const taskItems = Array.isArray(args.tasks)
				? args.tasks
				: Array.isArray(args.chain)
					? args.chain
					: [];
			const children =
				args.workflowScript !== undefined
					? [
							{
								agent: 'workflow',
								task:
									typeof args.workflowScript === 'string'
										? String(args.workflowScript).slice(0, 160)
										: undefined
							}
						]
					: taskItems.length
						? taskItems.flatMap((value) => {
								const child =
									value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
								const parallel = Array.isArray(child.parallel) ? child.parallel : [child];

								return parallel.map((parallelValue) => {
									const parallelChild =
										parallelValue && typeof parallelValue === 'object'
											? (parallelValue as Record<string, unknown>)
											: {};

									return {
										agent:
											typeof parallelChild.agent === 'string' ? parallelChild.agent : 'subagent',
										task: typeof parallelChild.task === 'string' ? parallelChild.task : undefined
									};
								});
							})
						: [
								{
									agent: typeof args.agent === 'string' ? args.agent : 'subagent',
									task:
										typeof args.task === 'string'
											? args.task
											: typeof args.goal === 'string'
												? args.goal
												: typeof args.workflowScript === 'string'
													? String(args.workflowScript).slice(0, 160)
													: undefined
								}
							];
			for (let index = 0; index < children.length; index += 1) {
				const child = children[index]!;
				if (toolIds.length && !toolIds.includes(tool.id)) {
					continue;
				}

				runs.push({
					runId: tool.id,
					childId: `index-${index}`,
					toolCallId: tool.id,
					agent: child.agent,
					...(child.task ? { task: child.task } : {}),
					status: 'running',
					...(args.workflowScript !== undefined ? { timelineAvailable: false } : {})
				});
			}
		}
	}

	return runs;
}

/**
 * Keep discovery polling alive while persistence catches up, but stop once the server has
 * authoritatively terminalized every inferred launch it knows about.
 */
export function shouldContinueSubagentPolling(
	serverRuns: SubagentRun[] | undefined,
	currentRuns: SubagentRun[],
	inferredRuns: SubagentRun[]
): boolean {
	const current = serverRuns?.length ? serverRuns : currentRuns;
	if (current.some((run) => run.status === 'running')) {
		return true;
	}

	if (serverRuns === undefined) {
		return false;
	}

	const serverByTool = new Map(serverRuns.map((run) => [run.toolCallId, run]));

	return inferredRuns.some((run) => {
		const known = serverByTool.get(run.toolCallId);

		return !known || known.status === 'running';
	});
}

/** Builds historical rows only. Live assistant and tool state deliberately stay out of this function. */
export function buildFinalizedTimeline(
	persistedItems: ChatItem[],
	pendingMessages: PendingUserMessage[],
	showModelChanges: boolean,
	subagentRuns: SubagentRun[] = []
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

	if (!subagentRuns.length) {
		return timeline;
	}

	const runsByToolCall = new Map<string, SubagentRun[]>();
	for (const run of subagentRuns) {
		const runs = runsByToolCall.get(run.toolCallId) ?? [];
		runs.push(run);
		runsByToolCall.set(run.toolCallId, runs);
	}

	const projected: FinalTimelineEntry[] = [];
	const emitted = new Set<string>();
	for (const entry of timeline) {
		projected.push(entry);
		if (entry.kind !== 'activity') {
			continue;
		}

		const toolIds = new Set(
			entry.entries.flatMap((activity) =>
				activity.kind === 'tools' ? activity.tools.map((tool) => tool.id) : []
			)
		);
		for (const toolId of toolIds) {
			const runs = runsByToolCall.get(toolId) ?? [];
			for (const run of runs) {
				const key = `${toolId}:${run.childId}`;
				if (emitted.has(key)) {
					continue;
				}

				emitted.add(key);
				projected.push({ id: `subagent-card-${key}`, kind: 'subagent-card', run });
			}
		}
	}

	return projected;
}

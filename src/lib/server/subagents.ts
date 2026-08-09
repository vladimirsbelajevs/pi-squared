import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep, resolve as resolvePath } from 'node:path';
import {
	SessionManager,
	type SessionEntry,
	type SessionInfo
} from '@earendil-works/pi-coding-agent';
import type {
	ChatItem,
	Project,
	SubagentRun,
	SubagentRunStatus,
	SubagentTimelineResponse
} from '$lib/contracts';
import { isSubagentSession, mapSessionEntry } from '$lib/server/pi';

const GENERATED_RUN_ID = '[0-9a-f]{8}(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?';
const SUBAGENT_NAME_PATTERN = new RegExp(`^subagent-(.+)-(${GENERATED_RUN_ID})(?:-(\\d+))?$`, 'i');
/** Keep the catalog warm across the normal one-second live polling interval. */
export const SUBAGENT_STATUS_FRESH_MS = 2500;

const MANAGEMENT_ACTIONS = new Set([
	'list',
	'status',
	'doctor',
	'wait',
	'steer',
	'resume',
	'stop',
	'interrupt',
	'approve-checkpoint',
	'reject-checkpoint',
	'append-step',
	'worktree.discard',
	'schedule.create',
	'schedule.list',
	'schedule.show',
	'schedule.history',
	'schedule.pause',
	'schedule.resume',
	'schedule.delete',
	'schedule.run',
	'schedule.run-due',
	'mission.create',
	'mission.list',
	'mission.show',
	'mission.update',
	'mission.close',
	'project.open',
	'project.status',
	'project.close'
]);

// Kept exported for callers/tests that need to document the management surface. The parser
// intentionally rejects every non-empty action, including future actions not in this set.
export { MANAGEMENT_ACTIONS };

type UnknownRecord = Record<string, unknown>;

type LaunchChild = {
	agent: string;
	task?: string;
	workflowKey?: string;
	/** The actual child run ID; workflow roots have one root ID and one per child. */
	correlationRunId?: string;
	index: number;
};

type ToolLaunch = {
	toolCallId: string;
	children: LaunchChild[];
	mode: 'single' | 'parallel' | 'chain' | 'workflow';
	args: UnknownRecord;
};

type SessionCatalog = {
	parent: SessionInfo;
	sessions: SessionInfo[];
};

export type SubagentDiscoveryOptions = {
	/** Test-only override for the pi-subagents async root. */
	asyncRoot?: string;
};

type AsyncStatus = UnknownRecord & {
	steps: UnknownRecord[];
};

type NotifyRecord = {
	status: SubagentRunStatus;
	agent: string;
	taskIndex?: number;
	totalTasks?: number;
	sessionPath?: string;
	sessionId?: string;
	runId?: string;
};

const catalogs = new Map<string, { expiresAt: number; value: SessionCatalog }>();

function containedPath(root: string, candidate: string): boolean {
	const relativePath = relative(root, candidate);

	return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`));
}

function defaultAsyncRoot(): string {
	const scope =
		typeof process.getuid === 'function'
			? `uid-${process.getuid()}`
			: `user-${process.env.USER ?? process.env.USERNAME ?? 'unknown'}`;

	return join(tmpdir(), `pi-subagents-${scope}`, 'async-subagent-runs');
}

function canonicalPath(path: string): string | undefined {
	try {
		return realpathSync(path);
	} catch {
		return undefined;
	}
}

function normalizedPath(value: string): string {
	return canonicalPath(resolvePath(value)) ?? resolvePath(value);
}

function matchesParentSessionIdentity(value: string | undefined, parent: SessionInfo): boolean {
	if (!value || value === parent.id) {
		return true;
	}

	return normalizedPath(value) === normalizedPath(parent.path);
}

function readAsyncStatus(
	runId: string,
	parent: SessionInfo,
	project: Project,
	options: SubagentDiscoveryOptions = {},
	configuredDir?: string
): AsyncStatus | undefined {
	const asyncRoot = canonicalPath(resolvePath(options.asyncRoot ?? defaultAsyncRoot()));
	if (!asyncRoot) {
		return undefined;
	}

	const runDir = resolvePath(configuredDir ?? join(asyncRoot, runId));
	const statusPath = join(runDir, 'status.json');
	const canonicalRunDir = canonicalPath(runDir);
	const canonicalStatusPath = canonicalPath(statusPath);
	if (
		!canonicalRunDir ||
		!canonicalStatusPath ||
		!containedPath(asyncRoot, canonicalRunDir) ||
		!containedPath(asyncRoot, canonicalStatusPath) ||
		!containedPath(canonicalRunDir, canonicalStatusPath)
	) {
		return undefined;
	}

	let parsed: unknown;
	try {
		if (!existsSync(statusPath)) {
			return undefined;
		}

		parsed = JSON.parse(readFileSync(statusPath, 'utf8')) as unknown;
	} catch {
		return undefined;
	}

	const status = record(parsed);
	if (!status || stringValue(status.runId) !== runId) {
		return undefined;
	}

	if (!matchesParentSessionIdentity(stringValue(status.sessionId), parent)) {
		return undefined;
	}

	const statusCwd = stringValue(status.cwd);
	if (statusCwd && resolvePath(statusCwd) !== resolvePath(project.cwd)) {
		return undefined;
	}

	const steps = Array.isArray(status.steps)
		? status.steps.map((step) => record(step)).filter((step): step is UnknownRecord => !!step)
		: [];

	return { ...status, steps };
}

function asyncStatusForDetails(
	details: UnknownRecord | undefined,
	parent: SessionInfo,
	project: Project,
	options: SubagentDiscoveryOptions = {}
): AsyncStatus | undefined {
	if (!details) {
		return undefined;
	}

	const asyncId = stringValue(details.asyncId) ?? stringValue(details.runId);
	if (!asyncId) {
		return undefined;
	}

	return readAsyncStatus(asyncId, parent, project, options, stringValue(details.asyncDir));
}

function record(value: unknown): UnknownRecord | undefined {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as UnknownRecord)
		: undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function integerValue(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function parseJson(value: unknown): unknown {
	if (typeof value !== 'string') {
		return value;
	}

	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
}

function contentText(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}

	if (!Array.isArray(value)) {
		return '';
	}

	return value
		.map((part) => stringValue(record(part)?.text) ?? '')
		.filter(Boolean)
		.join('\n');
}

export function parseSubagentSessionName(
	name: string | undefined
): { agent: string; runId: string; index?: number } | undefined {
	if (!name) {
		return undefined;
	}

	const match = name.match(SUBAGENT_NAME_PATTERN);
	if (!match) {
		return undefined;
	}

	const index = match[3] === undefined ? undefined : Number(match[3]);

	return {
		agent: match[1]!,
		runId: match[2]!,
		...(index !== undefined && Number.isInteger(index) ? { index } : {})
	};
}

function launchChildren(args: UnknownRecord): LaunchChild[] {
	const tasks = Array.isArray(args.tasks) ? args.tasks : undefined;
	if (tasks?.length) {
		return tasks.flatMap((task, index) => {
			const item = record(task);
			const agent = stringValue(item?.agent) ?? `step-${index + 1}`;

			return [
				{
					agent,
					...(stringValue(item?.task) ? { task: stringValue(item?.task) } : {}),
					index
				}
			];
		});
	}

	const chain = Array.isArray(args.chain) ? args.chain : undefined;
	if (chain?.length) {
		const children: LaunchChild[] = [];
		for (let stepIndex = 0; stepIndex < chain.length; stepIndex += 1) {
			const item = record(chain[stepIndex]);
			const parallel = Array.isArray(item?.parallel) ? item.parallel : undefined;
			const values = parallel?.length ? parallel : [item];
			for (const value of values) {
				const child = record(value);
				children.push({
					agent: stringValue(child?.agent) ?? `step-${stepIndex + 1}`,
					...(stringValue(child?.task) ? { task: stringValue(child?.task) } : {}),
					index: children.length
				});
			}
		}

		return children;
	}

	// A workflow's JavaScript can dynamically launch any number of children. Do not invent a
	// synthetic child from the script text; derive actual lanes from structured details below.
	if (args.workflowScript !== undefined) {
		return [];
	}

	const agent = stringValue(args.agent);
	const task = stringValue(args.task) ?? stringValue(args.goal);
	if (agent || task) {
		return [{ agent: agent ?? 'subagent', ...(task ? { task } : {}), index: 0 }];
	}

	return [];
}

function modeForArgs(args: UnknownRecord, children: LaunchChild[]): ToolLaunch['mode'] {
	if (args.workflowScript !== undefined) {
		return 'workflow';
	}

	if (Array.isArray(args.tasks)) {
		return 'parallel';
	}

	if (Array.isArray(args.chain)) {
		return 'chain';
	}

	return children.length > 1 ? 'parallel' : 'single';
}

export function parseSubagentToolLaunch(
	toolCallId: string,
	argumentsValue: unknown
): ToolLaunch | undefined {
	const args = record(parseJson(argumentsValue));
	if (!args) {
		return undefined;
	}

	// The extension reserves the mere presence of action for management/control calls. Reject
	// unknown future actions too; otherwise `{ action: "new-control", agent: "worker" }` leaks a card.
	if (
		'action' in args &&
		args.action !== undefined &&
		args.action !== null &&
		String(args.action).length > 0
	) {
		return undefined;
	}

	const children = launchChildren(args);
	if (!children.length && args.workflowScript === undefined) {
		return undefined;
	}

	return { toolCallId, children, mode: modeForArgs(args, children), args };
}

function terminalStatus(value: UnknownRecord | undefined): SubagentRunStatus | undefined {
	if (!value) {
		return undefined;
	}

	const state = (stringValue(value.state) ?? stringValue(value.status))?.toLowerCase();
	if (value.stopped === true || state === 'stopped' || state === 'cancelled') {
		return 'stopped';
	}

	if (state === 'paused' || value.interrupted === true) {
		return 'paused';
	}

	if (value.success === true || state === 'complete' || state === 'completed') {
		return 'completed';
	}

	if (
		value.success === false ||
		state === 'failed' ||
		state === 'rejected' ||
		value.timedOut === true ||
		value.turnBudgetExceeded === true ||
		(typeof value.exitCode === 'number' && value.exitCode !== 0)
	) {
		return 'failed';
	}

	if (typeof value.exitCode === 'number' && value.exitCode === 0) {
		return 'completed';
	}

	return undefined;
}

function detailObject(message: UnknownRecord): UnknownRecord | undefined {
	const details = record(message.details);
	if (details) {
		return details;
	}

	return record(parseJson(contentText(message.content)));
}

function resultForCall(entries: SessionEntry[], callId: string): UnknownRecord | undefined {
	let result: UnknownRecord | undefined;
	for (const entry of entries) {
		if (entry.type !== 'message') {
			continue;
		}

		const message = record(entry.message);
		if (message?.role === 'toolResult' && message.toolCallId === callId) {
			result = message;
		}
	}

	return result;
}

function childDetails(details: UnknownRecord | undefined): UnknownRecord[] {
	if (!details || !Array.isArray(details.results)) {
		return [];
	}

	return details.results
		.map((item) => record(item))
		.filter((item): item is UnknownRecord => !!item);
}

function sessionPathFromValue(value: UnknownRecord | undefined): string | undefined {
	return (
		stringValue(value?.sessionPath) ?? stringValue(value?.sessionFile) ?? stringValue(value?.path)
	);
}

function sessionIdFromValue(value: UnknownRecord | undefined): string | undefined {
	return stringValue(value?.childSessionId) ?? stringValue(value?.sessionId);
}

function runIdFromDetails(details: UnknownRecord | undefined, fallback: string): string {
	return stringValue(details?.asyncId) ?? stringValue(details?.runId) ?? fallback;
}

function taskForChild(child: LaunchChild | undefined, args: UnknownRecord): string | undefined {
	if (child?.task) {
		return child.task;
	}

	const workflow = stringValue(args.workflowScript);

	return workflow ? workflow.slice(0, 160) : undefined;
}

function sessionIndexMatches(sessionIndex: number | undefined, childIndex: number): boolean {
	// Pi session names historically used one-based suffixes; newer metadata uses zero-based
	// SingleResult.index. Accept both only when all other ownership fields match.
	return (
		sessionIndex === undefined || sessionIndex === childIndex || sessionIndex === childIndex + 1
	);
}

function authorizedSession(
	session: SessionInfo,
	parent: SessionInfo,
	runId: string,
	agent: string,
	childIndex: number,
	allowUnresolvedRunId = false
): boolean {
	if (
		!isSubagentSession(session) ||
		normalizedPath(session.parentSessionPath ?? '') !== normalizedPath(parent.path)
	) {
		return false;
	}

	const parsed = parseSubagentSessionName(session.name);
	if (!parsed || parsed.agent.toLowerCase() !== agent.toLowerCase()) {
		return false;
	}

	// A tool-* value is only a local fallback for old parent records. It must never
	// select an arbitrary same-agent/index session without an explicit trusted hint.
	if (runId.startsWith('tool-')) {
		return allowUnresolvedRunId && sessionIndexMatches(parsed.index, childIndex);
	}

	return (
		parsed.runId.toLowerCase() === runId.toLowerCase() &&
		sessionIndexMatches(parsed.index, childIndex)
	);
}

function resolveChildSession(
	sessions: SessionInfo[],
	parent: SessionInfo,
	runId: string,
	child: LaunchChild,
	pathHint?: string,
	sessionIdHint?: string
): SessionInfo | undefined {
	const unresolvedRunId = runId.startsWith('tool-');
	if (sessionIdHint) {
		const hintedById = sessions.find((session) => session.id === sessionIdHint);
		if (
			hintedById &&
			authorizedSession(hintedById, parent, runId, child.agent, child.index, unresolvedRunId)
		) {
			return hintedById;
		}
	}

	if (pathHint) {
		const normalized = normalizedPath(pathHint);
		const hinted = sessions.find((session) => normalizedPath(session.path) === normalized);
		if (
			hinted &&
			authorizedSession(hinted, parent, runId, child.agent, child.index, unresolvedRunId)
		) {
			return hinted;
		}
	}

	// Never scan by agent/index when the parent only has the tool-call fallback ID.
	if (unresolvedRunId) {
		return undefined;
	}

	return sessions.find((session) =>
		authorizedSession(session, parent, runId, child.agent, child.index)
	);
}

function parseTaskInfo(value: string | undefined): { taskIndex?: number; totalTasks?: number } {
	const match = value?.match(/^\((\d+)\/(\d+)\)$/);
	if (!match) {
		return {};
	}

	return { taskIndex: Number(match[1]) - 1, totalTasks: Number(match[2]) };
}

function notifyFromText(text: string): NotifyRecord[] {
	const lines = text.split(/\r?\n/);
	const header = lines[0] ?? '';
	const single = header.match(
		/^(?:Background task|Detached foreground task) (completed|failed|paused|stopped): \*\*(.+?)\*\*(?:\s+(\([^)]*\)))?$/i
	);
	if (single) {
		const task = parseTaskInfo(single[3]);
		const sessionLine = lines.slice(1).find((line) => /^(?:Session|Session file):\s+/i.test(line));

		return [
			{
				status: single[1]!.toLowerCase() as SubagentRunStatus,
				agent: single[2]!,
				...task,
				...(sessionLine ? { sessionPath: sessionLine.replace(/^[^:]+:\s+/i, '').trim() } : {})
			}
		];
	}

	if (!/^Background tasks completed \(\d+\):/i.test(header)) {
		return [];
	}

	const records: NotifyRecord[] = [];
	for (let index = 1; index < lines.length; index += 1) {
		const block = lines[index]?.match(/^(\d+)\.\s+(.+?)(?:\s+(\([^)]*\)))?$/);
		if (!block) {
			continue;
		}

		const body = lines.slice(index + 1).find((line) => /^(?:Session|Session file):\s+/i.test(line));
		const task = parseTaskInfo(block[3]);
		records.push({
			status: 'completed',
			agent: block[2]!,
			taskIndex: Number(block[1]) - 1,
			...task,
			...(body ? { sessionPath: body.replace(/^[^:]+:\s+/i, '').trim() } : {})
		});
	}

	return records;
}

function notifications(entries: SessionEntry[]): NotifyRecord[] {
	const result: NotifyRecord[] = [];
	for (const entry of entries) {
		if (entry.type !== 'custom_message' || entry.customType !== 'subagent-notify') {
			continue;
		}

		const details = record(entry.details);
		const status = terminalStatus(details);
		const agent = stringValue(details?.agent);
		if (status && agent && details) {
			result.push({
				status,
				agent,
				...(integerValue(details.index) !== undefined
					? { taskIndex: integerValue(details.index) }
					: {}),
				...(stringValue(details.totalTasks) ? { totalTasks: Number(details.totalTasks) } : {}),
				...(sessionPathFromValue(details) ? { sessionPath: sessionPathFromValue(details) } : {}),
				...(sessionIdFromValue(details) ? { sessionId: sessionIdFromValue(details) } : {}),
				...((stringValue(details.runId) ?? stringValue(details.id))
					? { runId: stringValue(details.runId) ?? stringValue(details.id) }
					: {})
			});
			continue;
		}

		result.push(...notifyFromText(contentText(entry.content)));
	}

	return result;
}

function notificationForChild(
	notifyEntries: NotifyRecord[],
	sessions: SessionInfo[],
	parent: SessionInfo,
	runId: string,
	child: LaunchChild,
	allCandidateChildren: LaunchChild[]
): NotifyRecord | undefined {
	const candidates = notifyEntries.filter(
		(notification) => notification.agent.toLowerCase() === child.agent.toLowerCase()
	);
	for (const notification of candidates) {
		if (
			notification.runId &&
			!runId.startsWith('tool-') &&
			notification.runId.toLowerCase() !== runId.toLowerCase()
		) {
			continue;
		}

		if (notification.taskIndex !== undefined && notification.taskIndex !== child.index) {
			continue;
		}

		// Structured notification run IDs are authoritative even when the parent record
		// predates persistence of its own run ID.
		if (
			notification.runId &&
			runId.startsWith('tool-') &&
			!notification.sessionId &&
			!notification.sessionPath
		) {
			return notification;
		}

		const session = notification.sessionId
			? sessions.find((candidate) => candidate.id === notification.sessionId)
			: notification.sessionPath
				? sessions.find(
						(candidate) => resolvePath(candidate.path) === resolvePath(notification.sessionPath!)
					)
				: undefined;
		if (session) {
			if (
				authorizedSession(
					session,
					parent,
					notification.runId ?? runId,
					child.agent,
					child.index,
					!notification.runId && runId.startsWith('tool-')
				)
			) {
				return notification;
			}

			continue;
		}

		// Plain text notifications have no run identity. Agent-only matching is safe only
		// when that agent/index tuple is unique across every launch in this parent session.
		const matchingChildren = allCandidateChildren.filter(
			(candidate) =>
				candidate.agent.toLowerCase() === child.agent.toLowerCase() &&
				(notification.taskIndex === undefined || candidate.index === notification.taskIndex)
		);
		if (matchingChildren.length === 1 && matchingChildren[0]?.index === child.index) {
			return notification;
		}
	}

	return undefined;
}

type WorkflowTraceEntry = {
	key: string;
	index: number;
	label?: string;
	runId?: string;
};

function workflowTraceEntries(
	details: UnknownRecord | undefined,
	asyncStatus: AsyncStatus | undefined
): WorkflowTraceEntry[] {
	const detailTrace = record(details?.workflow)?.trace;
	const asyncTrace = record(asyncStatus?.workflow)?.trace;
	const sources = [
		...(Array.isArray(detailTrace) ? detailTrace : []),
		...(Array.isArray(asyncTrace) ? asyncTrace : [])
	];
	if (!sources.length) {
		return [];
	}

	const latest = new Map<string, WorkflowTraceEntry>();
	for (const [index, value] of sources.entries()) {
		const item = record(value);
		const key = stringValue(item?.key);
		if (!item || !key || item.operation !== 'run') {
			continue;
		}

		const previous = latest.get(key);
		latest.set(key, {
			key,
			index,
			...((stringValue(item.label) ?? previous?.label)
				? { label: stringValue(item.label) ?? previous?.label }
				: {}),
			...((stringValue(item.runId) ?? previous?.runId)
				? { runId: stringValue(item.runId) ?? previous?.runId }
				: {})
		});
	}

	return [...latest.values()].sort((left, right) => left.index - right.index);
}

function workflowTraceMap(entries: WorkflowTraceEntry[]): Map<string, WorkflowTraceEntry> {
	return new Map(entries.map((entry) => [entry.key, entry]));
}

function workflowChildren(
	details: UnknownRecord | undefined,
	asyncStatus: AsyncStatus | undefined
): LaunchChild[] {
	const traceEntries = workflowTraceEntries(details, asyncStatus);
	const traces = workflowTraceMap(traceEntries);
	const detailsSteps = details && Array.isArray(details.steps) ? details.steps : [];
	const steps = detailsSteps.length ? detailsSteps : (asyncStatus?.steps ?? []);
	if (steps.length) {
		return steps.flatMap((value, index) => {
			const step = record(value);
			if (!step) {
				return [];
			}

			const workflowKey = stringValue(step.workflowKey);
			const trace = (workflowKey ? traces.get(workflowKey) : undefined) ?? traceEntries[index];
			const key = workflowKey ?? trace?.key;

			return [
				{
					index: integerValue(step.index) ?? index,
					agent:
						stringValue(step.agent) ??
						stringValue(step.label) ??
						trace?.label ??
						key ??
						`workflow-${index + 1}`,
					...(key ? { workflowKey: key } : {}),
					...(trace?.runId ? { correlationRunId: trace.runId } : {}),
					...((stringValue(step.task) ?? stringValue(step.description))
						? { task: stringValue(step.task) ?? stringValue(step.description) }
						: {})
				}
			];
		});
	}

	return traceEntries.map((trace, index) => ({
		index,
		agent: trace.label ?? trace.key,
		workflowKey: trace.key,
		...(trace.runId ? { correlationRunId: trace.runId } : {})
	}));
}

function childRows(
	launch: ToolLaunch,
	details: UnknownRecord | undefined,
	asyncStatus: AsyncStatus | undefined
): Array<{ child: LaunchChild; detail?: UnknownRecord; unavailable?: boolean }> {
	const traceEntries = workflowTraceEntries(details, asyncStatus);
	const traces = workflowTraceMap(traceEntries);
	const workflowChild = (
		child: LaunchChild,
		detail: UnknownRecord | undefined,
		position: number
	) => {
		if (launch.mode !== 'workflow') {
			return child;
		}

		const workflowKey = stringValue(detail?.workflowKey) ?? child.workflowKey;
		const trace = (workflowKey ? traces.get(workflowKey) : undefined) ?? traceEntries[position];
		const key = workflowKey ?? trace?.key;

		return {
			...child,
			...(key ? { workflowKey: key } : {}),
			...(trace?.runId ? { correlationRunId: trace.runId } : {})
		};
	};

	const resultDetails = childDetails(details);
	const results = resultDetails.length ? resultDetails : (asyncStatus?.steps ?? []);
	if (results.length) {
		const indexedResults = results.map((detail, position) => ({
			detail,
			position,
			index: integerValue(detail.index) ?? position
		}));
		const rows = launch.children.map((launchChild) => {
			const result = indexedResults.find((candidate) => candidate.index === launchChild.index);
			const detail = result?.detail;
			const child = workflowChild(
				{
					...launchChild,
					agent: stringValue(detail?.agent) ?? launchChild.agent,
					...((stringValue(detail?.workflowKey) ?? launchChild.workflowKey)
						? { workflowKey: stringValue(detail?.workflowKey) ?? launchChild.workflowKey }
						: {}),
					...((stringValue(detail?.task) ?? stringValue(detail?.description) ?? launchChild.task)
						? {
								task:
									stringValue(detail?.task) ?? stringValue(detail?.description) ?? launchChild.task
							}
						: {})
				},
				detail,
				result?.position ?? launchChild.index
			);

			return { child, ...(detail ? { detail } : {}) };
		});
		const knownIndexes = new Set(launch.children.map((child) => child.index));
		for (const result of indexedResults) {
			if (knownIndexes.has(result.index)) {
				continue;
			}

			rows.push({
				child: workflowChild(
					{
						index: result.index,
						agent: stringValue(result.detail.agent) ?? `child-${result.index + 1}`,
						...(stringValue(result.detail.workflowKey)
							? { workflowKey: stringValue(result.detail.workflowKey) }
							: {}),
						...((stringValue(result.detail.task) ?? stringValue(result.detail.description))
							? {
									task: stringValue(result.detail.task) ?? stringValue(result.detail.description)
								}
							: {})
					},
					result.detail,
					result.position
				),
				detail: result.detail
			});
		}

		return rows.sort((left, right) => left.child.index - right.child.index);
	}

	const structuredSteps =
		details && Array.isArray(details.steps) && details.steps.length
			? details.steps
					.map((value) => record(value))
					.filter((value): value is UnknownRecord => !!value)
			: (asyncStatus?.steps ?? []);
	if (launch.mode === 'workflow') {
		const workflow = workflowChildren(details, asyncStatus);
		if (workflow.length) {
			return workflow.map((child) => ({
				child,
				detail: structuredSteps.find(
					(step, index) => (integerValue(step.index) ?? index) === child.index
				)
			}));
		}

		return [{ child: { index: 0, agent: 'workflow' }, unavailable: true }];
	}

	return launch.children.map((child) => ({
		child,
		detail: structuredSteps.find(
			(step, index) => (integerValue(step.index) ?? index) === child.index
		)
	}));
}

function isAsyncLaunch(launch: ToolLaunch, details: UnknownRecord | undefined): boolean {
	if (details) {
		return Boolean(stringValue(details.asyncId) || stringValue(details.asyncDir));
	}

	// The extension defaults launches to async. An explicit false is the only safe legacy
	// fallback for a parent result that predates structured Details.asyncId.
	return launch.args.async !== false;
}

function childId(index: number): string {
	return `index-${index}`;
}

function correlatedWorkflowDetail(
	launch: ToolLaunch,
	child: LaunchChild,
	detail: UnknownRecord | undefined,
	parent: SessionInfo,
	project: Project,
	options: SubagentDiscoveryOptions
): UnknownRecord | undefined {
	if (launch.mode !== 'workflow' || !child.correlationRunId) {
		return detail;
	}

	const childStatus = readAsyncStatus(
		child.correlationRunId,
		parent,
		project,
		options,
		stringValue(detail?.asyncDir)
	);
	if (!childStatus) {
		return detail;
	}

	const childStep = childStatus.steps.find(
		(step) =>
			stringValue(step.workflowKey) === child.workflowKey || stringValue(step.agent) === child.agent
	);

	return {
		...(detail ?? {}),
		...childStatus,
		...(childStep ?? {}),
		...(child.workflowKey ? { workflowKey: child.workflowKey } : {})
	};
}

type ProjectedSubagentRun = SubagentRun & {
	/** Internal correlation ID used for child session authorization; never sent to the browser. */
	correlationRunId?: string;
};

type LaunchProjection = {
	launch: ToolLaunch;
	resultMessage?: UnknownRecord;
	details?: UnknownRecord;
	rootRunId: string;
	asyncLaunch: boolean;
	asyncStatus?: AsyncStatus;
	rows: Array<{ child: LaunchChild; detail?: UnknownRecord; unavailable?: boolean }>;
	rootStatus?: SubagentRunStatus;
};

function runKey(run: Pick<SubagentRun, 'toolCallId' | 'childId'>): string {
	return `${run.toolCallId}:${run.childId}`;
}

function deriveSubagentRunRecords(
	entries: SessionEntry[],
	parent: SessionInfo,
	sessions: SessionInfo[] = [],
	project: Project = { cwd: parent.cwd, id: '', name: '', addedAt: '', lastOpenedAt: '' },
	options: SubagentDiscoveryOptions = {}
): ProjectedSubagentRun[] {
	const launches: ToolLaunch[] = [];
	for (const entry of entries) {
		if (entry.type !== 'message') {
			continue;
		}

		const message = record(entry.message);
		if (message?.role !== 'assistant' || !Array.isArray(message.content)) {
			continue;
		}

		for (const block of message.content) {
			const item = record(block);
			if (item?.type !== 'toolCall' || item.name !== 'subagent' || typeof item.id !== 'string') {
				continue;
			}

			const launch = parseSubagentToolLaunch(item.id, item.arguments);
			if (launch) {
				launches.push(launch);
			}
		}
	}

	const runs: ProjectedSubagentRun[] = [];
	const notifyEntries = notifications(entries);
	const projections: LaunchProjection[] = launches.map((launch) => {
		const resultMessage = resultForCall(entries, launch.toolCallId);
		const details = resultMessage ? detailObject(resultMessage) : undefined;
		const rootRunId = runIdFromDetails(details, `tool-${launch.toolCallId}`);
		const asyncLaunch = isAsyncLaunch(launch, details);
		const asyncStatus = asyncStatusForDetails(details, parent, project, options);
		const rows = childRows(launch, details, asyncStatus);

		return {
			launch,
			...(resultMessage ? { resultMessage } : {}),
			...(details ? { details } : {}),
			rootRunId,
			asyncLaunch,
			...(asyncStatus ? { asyncStatus } : {}),
			rows,
			...((terminalStatus(asyncStatus) ?? terminalStatus(details))
				? { rootStatus: terminalStatus(asyncStatus) ?? terminalStatus(details) }
				: {})
		};
	});
	const allCandidateChildren = projections.flatMap((projection) =>
		projection.rows.map(({ child }) => child)
	);
	for (const projection of projections) {
		const { launch, resultMessage, details, rootRunId, asyncLaunch, rows, rootStatus } = projection;

		for (const row of rows) {
			const { child } = row;
			const correlationRunId = child.correlationRunId ?? rootRunId;
			const notification = notificationForChild(
				notifyEntries,
				sessions,
				parent,
				correlationRunId,
				child,
				allCandidateChildren
			);
			const resolvedCorrelationRunId = child.correlationRunId ?? notification?.runId ?? rootRunId;
			const detail = correlatedWorkflowDetail(launch, child, row.detail, parent, project, options);
			const resultStatus = terminalStatus(detail);
			const status =
				resultStatus ??
				notification?.status ??
				rootStatus ??
				(resultMessage && !asyncLaunch
					? resultMessage.isError === true
						? 'failed'
						: 'completed'
					: 'running');
			const effectiveChild = {
				...child,
				agent: stringValue(detail?.agent) ?? child.agent
			};
			const resolvedSession = resolveChildSession(
				sessions,
				parent,
				resolvedCorrelationRunId,
				effectiveChild,
				sessionPathFromValue(detail) ?? sessionPathFromValue(details) ?? notification?.sessionPath,
				sessionIdFromValue(detail) ?? sessionIdFromValue(details) ?? notification?.sessionId
			);
			const runner = record(detail?.runner);
			const runnerType = stringValue(detail?.runner) ?? stringValue(runner?.type);
			const external =
				runnerType === 'external-cli' ||
				record(detail?.externalProcess) !== undefined ||
				detail?.runnerType === 'external-cli';
			const unavailable = row.unavailable === true || external;
			const task =
				stringValue(detail?.task) ??
				stringValue(detail?.description) ??
				taskForChild(child, launch.args);
			const parsedResolvedSession = resolvedSession
				? parseSubagentSessionName(resolvedSession.name)
				: undefined;
			const internalCorrelationRunId =
				child.correlationRunId ??
				(resolvedCorrelationRunId.startsWith('tool-') ? parsedResolvedSession?.runId : undefined);
			runs.push({
				runId: rootRunId,
				...(internalCorrelationRunId ? { correlationRunId: internalCorrelationRunId } : {}),
				childId: childId(child.index),
				toolCallId: launch.toolCallId,
				agent: effectiveChild.agent,
				...(task ? { task } : {}),
				status,
				...(resolvedSession && !unavailable
					? { childSessionId: resolvedSession.id, timelineAvailable: true }
					: unavailable || status !== 'running'
						? { timelineAvailable: false }
						: {})
			});
		}
	}

	const unique = new Map<string, ProjectedSubagentRun>();
	for (const run of runs) {
		unique.set(runKey(run), run);
	}

	return [...unique.values()];
}

export function deriveSubagentRunsFromEntries(
	entries: SessionEntry[],
	parent: SessionInfo,
	sessions: SessionInfo[] = [],
	project: Project = { cwd: parent.cwd, id: '', name: '', addedAt: '', lastOpenedAt: '' },
	options: SubagentDiscoveryOptions = {}
): SubagentRun[] {
	return deriveSubagentRunRecords(entries, parent, sessions, project, options).map((run) => {
		const publicRun = { ...run };
		delete publicRun.correlationRunId;

		return publicRun;
	});
}

async function catalogFor(project: Project, sessionId: string): Promise<SessionCatalog> {
	const key = `${project.cwd}:${sessionId}`;
	const cached = catalogs.get(key);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.value;
	}

	const sessions = await SessionManager.list(project.cwd);
	const parent = sessions.find((session) => session.id === sessionId);
	if (!parent) {
		throw new Error('Session not found in this project.');
	}

	const value = { parent, sessions };
	catalogs.set(key, { expiresAt: Date.now() + SUBAGENT_STATUS_FRESH_MS, value });

	return value;
}

export async function listSubagentRuns(
	project: Project,
	sessionId: string
): Promise<SubagentRun[]> {
	const catalog = await catalogFor(project, sessionId);
	const manager = SessionManager.open(catalog.parent.path, undefined, project.cwd);

	return deriveSubagentRunsFromEntries(
		manager.getBranch(),
		catalog.parent,
		catalog.sessions,
		project
	);
}

export function sliceSubagentTimeline(
	entries: SessionEntry[],
	childSessionName?: string
): { initialized: boolean; items: ChatItem[] } {
	let markerIndex = -1;
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type !== 'session_info' || !isSubagentSession(entry)) {
			continue;
		}

		if (!childSessionName || entry.name === childSessionName) {
			markerIndex = index;
			break;
		}
	}

	if (markerIndex < 0) {
		return { initialized: false, items: [] };
	}

	return {
		initialized: true,
		items: entries.slice(markerIndex + 1).flatMap((entry) => {
			try {
				const item = mapSessionEntry(entry);

				return item ? [item] : [];
			} catch {
				return [];
			}
		})
	};
}

export async function readSubagentTimeline(
	project: Project,
	parentSessionId: string,
	childSessionId: string
): Promise<SubagentTimelineResponse> {
	const catalog = await catalogFor(project, parentSessionId);
	const parentManager = SessionManager.open(catalog.parent.path, undefined, project.cwd);
	const runs = deriveSubagentRunRecords(
		parentManager.getBranch(),
		catalog.parent,
		catalog.sessions,
		project
	);
	const run = runs.find((candidate) => candidate.childSessionId === childSessionId);
	if (!run || run.timelineAvailable === false) {
		throw new Error('Child session is not available for this parent session.');
	}

	const child = catalog.sessions.find((session) => session.id === childSessionId);
	if (
		!child ||
		!run.childSessionId ||
		!isSubagentSession(child) ||
		!child.parentSessionPath ||
		normalizedPath(child.parentSessionPath) !== normalizedPath(catalog.parent.path)
	) {
		throw new Error('Child session is not available for this parent session.');
	}

	const parsed = parseSubagentSessionName(child.name);
	const expectedRunId = run.correlationRunId ?? run.runId;
	if (!parsed || parsed.runId.toLowerCase() !== expectedRunId.toLowerCase()) {
		throw new Error('Child session is not authorized for this parent run.');
	}

	const manager = SessionManager.open(child.path, undefined, project.cwd);
	const timeline = sliceSubagentTimeline(manager.getBranch(), child.name);

	return { status: run.status, available: true, ...timeline };
}

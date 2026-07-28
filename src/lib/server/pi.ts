import {
	createAgentSession,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type AgentSession,
	type AgentSessionEvent,
	type SessionEntry
} from '@earendil-works/pi-coding-agent';
import type {
	ChatItem,
	ChatToolCall,
	HistoricalSession,
	ModelOption,
	Project,
	RuntimeSnapshot,
	ThinkingLevel
} from '$lib/contracts';

let modelRuntimePromise: Promise<ModelRuntime> | undefined;

export function getModelRuntime(): Promise<ModelRuntime> {
	modelRuntimePromise ??= ModelRuntime.create();
	return modelRuntimePromise;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function textFromContent(content: unknown, includeThinking = false): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';

	return content
		.map((block) => {
			const item = record(block);
			if (!item) return '';
			if (typeof item.text === 'string') return item.text;
			if (includeThinking && typeof item.thinking === 'string') return item.thinking;
			return '';
		})
		.filter(Boolean)
		.join('\n');
}

function thinkingFromContent(content: unknown): string | undefined {
	if (!Array.isArray(content)) return undefined;
	const thinking = content
		.map((block) => record(block)?.thinking)
		.filter((value): value is string => typeof value === 'string')
		.join('\n');
	return thinking || undefined;
}

function toolCallsFromContent(content: unknown): ChatToolCall[] | undefined {
	if (!Array.isArray(content)) return undefined;
	const calls = content.flatMap((block) => {
		const item = record(block);
		if (
			!item ||
			item.type !== 'toolCall' ||
			typeof item.id !== 'string' ||
			typeof item.name !== 'string'
		) {
			return [];
		}
		return [
			{
				id: item.id,
				name: item.name,
				arguments: JSON.stringify(item.arguments ?? {}, null, 2)
			}
		];
	});
	return calls.length ? calls : undefined;
}

function modelOption(model: {
	provider: string;
	id: string;
	name?: string;
	reasoning?: boolean;
}): ModelOption {
	return {
		provider: model.provider,
		id: model.id,
		name: model.name ?? model.id,
		reasoning: model.reasoning ?? false
	};
}

export async function listAvailableModels(): Promise<ModelOption[]> {
	const runtime = await getModelRuntime();
	return (await runtime.getAvailable()).map((model) => modelOption(model));
}

export async function resolveModel(provider: string, id: string) {
	const runtime = await getModelRuntime();
	const available = await runtime.getAvailable();
	const model = available.find(
		(candidate) => candidate.provider === provider && candidate.id === id
	);
	if (!model)
		throw new Error('The selected model is not available with the configured credentials.');
	return model;
}

export function mapSessionEntry(entry: SessionEntry): ChatItem | undefined {
	if (entry.type === 'message') {
		const message = entry.message as unknown as Record<string, unknown>;
		const role = message.role;
		if (role === 'user') {
			return {
				id: entry.id,
				kind: 'message',
				role: 'user',
				text: textFromContent(message.content)
			};
		}
		if (role === 'assistant') {
			return {
				id: entry.id,
				kind: 'message',
				role: 'assistant',
				text: textFromContent(message.content),
				thinking: thinkingFromContent(message.content),
				toolCalls: toolCallsFromContent(message.content),
				isError: message.stopReason === 'error'
			};
		}
		if (role === 'toolResult') {
			return {
				id: entry.id,
				kind: 'message',
				role: 'tool',
				text: textFromContent(message.content),
				toolCallId: typeof message.toolCallId === 'string' ? message.toolCallId : undefined,
				label: typeof message.toolName === 'string' ? message.toolName : 'Tool result',
				isError: message.isError === true
			};
		}
		if (role === 'bashExecution') {
			return {
				id: entry.id,
				kind: 'message',
				role: 'bash',
				text: typeof message.output === 'string' ? message.output : '',
				label: typeof message.command === 'string' ? message.command : 'bash',
				isError:
					message.cancelled === true || (message.exitCode !== undefined && message.exitCode !== 0)
			};
		}
		if (role === 'custom') {
			return {
				id: entry.id,
				kind: 'message',
				role: 'custom',
				text: textFromContent(message.content)
			};
		}
		return undefined;
	}

	if (entry.type === 'model_change') {
		return {
			id: entry.id,
			kind: 'notice',
			text: `Model changed to ${entry.provider}/${entry.modelId}`
		};
	}
	if (entry.type === 'thinking_level_change') {
		return { id: entry.id, kind: 'notice', text: `Reasoning changed to ${entry.thinkingLevel}` };
	}
	if (entry.type === 'compaction') {
		return { id: entry.id, kind: 'notice', text: `Context compacted: ${entry.summary}` };
	}
	if (entry.type === 'branch_summary') {
		return { id: entry.id, kind: 'notice', text: `Branch summary: ${entry.summary}` };
	}
	if (entry.type === 'session_info') {
		return entry.name
			? { id: entry.id, kind: 'notice', text: `Session named “${entry.name}”` }
			: undefined;
	}

	return undefined;
}

export function buildSnapshot(
	runtimeId: string,
	project: Project,
	session: AgentSession,
	modelFallbackMessage?: string
): RuntimeSnapshot {
	const currentModel = session.model;
	return {
		runtimeId,
		project,
		sessionId: session.sessionId,
		sessionName: session.sessionName,
		model: currentModel ? modelOption(currentModel) : undefined,
		thinkingLevel: session.thinkingLevel as ThinkingLevel,
		isStreaming: session.isStreaming,
		items: session.sessionManager.getBranch().flatMap((entry) => {
			const item = mapSessionEntry(entry);
			return item ? [item] : [];
		}),
		modelFallbackMessage
	};
}

export async function createPiSession(options: {
	project: Project;
	mode: 'new' | 'resume';
	sessionPath?: string;
	model?: { provider: string; id: string };
	thinkingLevel?: ThinkingLevel;
}): Promise<{ session: AgentSession; modelFallbackMessage?: string }> {
	const modelRuntime = await getModelRuntime();
	const settingsManager = SettingsManager.create(options.project.cwd, undefined, {
		projectTrusted: true
	});
	const sessionManager =
		options.mode === 'resume' && options.sessionPath
			? SessionManager.open(options.sessionPath, undefined, options.project.cwd)
			: SessionManager.create(options.project.cwd);
	const model = options.model
		? await resolveModel(options.model.provider, options.model.id)
		: undefined;

	return createAgentSession({
		cwd: options.project.cwd,
		model,
		thinkingLevel: options.thinkingLevel,
		modelRuntime,
		sessionManager,
		settingsManager
	});
}

export async function listHistoricalSessions(project: Project): Promise<HistoricalSession[]> {
	const sessions = await SessionManager.list(project.cwd);
	return sessions.map((session) => ({
		projectId: project.id,
		projectName: project.name,
		sessionId: session.id,
		name: session.name,
		firstMessage: session.firstMessage,
		createdAt: session.created.toISOString(),
		modifiedAt: session.modified.toISOString(),
		messageCount: session.messageCount
	}));
}

export async function resolveSessionPath(project: Project, sessionId: string): Promise<string> {
	const session = (await SessionManager.list(project.cwd)).find(
		(candidate) => candidate.id === sessionId
	);
	if (!session) throw new Error('Session not found in this project.');
	return session.path;
}

export function normalizePiEvent(
	event: AgentSessionEvent
):
	| { type: 'assistant_delta'; text?: string; thinking?: string }
	| { type: 'tool_update'; toolCallId: string; toolName: string; text: string; isError?: boolean }
	| { type: 'notice'; message: string }
	| undefined {
	if (event.type === 'message_update') {
		const update = event.assistantMessageEvent;
		if (update.type === 'text_delta') return { type: 'assistant_delta', text: update.delta };
		if (update.type === 'thinking_delta')
			return { type: 'assistant_delta', thinking: update.delta };
		if (update.type === 'error') return { type: 'notice', message: 'The model returned an error.' };
	}

	if (event.type === 'tool_execution_update') {
		return {
			type: 'tool_update',
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			text: textFromContent(record(event.partialResult)?.content ?? event.partialResult)
		};
	}

	if (event.type === 'tool_execution_end') {
		return {
			type: 'tool_update',
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			text: textFromContent(record(event.result)?.content ?? event.result),
			isError: event.isError
		};
	}

	if (event.type === 'compaction_start') return { type: 'notice', message: 'Compacting context…' };
	if (event.type === 'auto_retry_start')
		return { type: 'notice', message: 'Retrying model request…' };
	return undefined;
}

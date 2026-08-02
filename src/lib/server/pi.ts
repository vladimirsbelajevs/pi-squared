import {
	createAgentSession,
	createEventBus,
	DefaultResourceLoader,
	getAgentDir,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type AgentSession,
	type AgentSessionEvent,
	type EventBus,
	type SessionEntry
} from '@earendil-works/pi-coding-agent';
import type {
	ChatAttachment,
	ChatItem,
	ChatToolCall,
	HistoricalSession,
	ModelOption,
	PermissionRequest,
	Project,
	RuntimeSnapshot,
	RuntimeEvent,
	SessionTokenUsage,
	McpStatusSnapshot,
	SlashCommand,
	ThinkingLevel
} from '$lib/contracts';
import { attachmentKind } from '$lib/attachments';
import { userPromptFromStoredText } from '$lib/prompt-attachments';

let modelRuntimePromise: Promise<ModelRuntime> | undefined;

export function getModelRuntime(): Promise<ModelRuntime> {
	modelRuntimePromise ??= ModelRuntime.create();

	return modelRuntimePromise;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function textFromContent(content: unknown, includeThinking = false): string {
	if (typeof content === 'string') {
		return content;
	}

	if (!Array.isArray(content)) {
		return '';
	}

	return content
		.map((block) => {
			const item = record(block);
			if (!item) {
				return '';
			}

			if (typeof item.text === 'string') {
				return item.text;
			}

			if (includeThinking && typeof item.thinking === 'string') {
				return item.thinking;
			}

			return '';
		})
		.filter(Boolean)
		.join('\n');
}

function imagesFromContent(content: unknown): Array<{ data: string; mimeType: string }> {
	if (!Array.isArray(content)) {
		return [];
	}

	return content.flatMap((block) => {
		const item = record(block);
		if (
			!item ||
			item.type !== 'image' ||
			typeof item.data !== 'string' ||
			typeof item.mimeType !== 'string' ||
			attachmentKind('image', item.mimeType) !== 'image'
		) {
			return [];
		}

		return [{ data: item.data, mimeType: item.mimeType }];
	});
}

function userAttachmentsFromContent(content: unknown): {
	text: string;
	attachments?: ChatAttachment[];
} {
	const stored = userPromptFromStoredText(textFromContent(content));
	const images = imagesFromContent(content);
	let imageIndex = 0;
	const attachments = stored.attachments.map((attachment) => {
		if (attachment.kind !== 'image') {
			return attachment;
		}

		const image = images[imageIndex++];

		return image && image.mimeType === attachment.mimeType
			? { ...attachment, data: image.data }
			: attachment;
	});

	if (!stored.attachments.length && images.length) {
		return {
			text: stored.text,
			attachments: images.map((image, index) => ({
				id: `image-${index + 1}`,
				kind: 'image' as const,
				name: `Image ${index + 1}`,
				mimeType: image.mimeType,
				size: Math.floor((image.data.length * 3) / 4),
				data: image.data
			}))
		};
	}

	return { text: stored.text, ...(attachments.length ? { attachments } : {}) };
}

function thinkingFromContent(content: unknown): string | undefined {
	if (!Array.isArray(content)) {
		return undefined;
	}

	const thinking = content
		.map((block) => record(block)?.thinking)
		.filter((value): value is string => typeof value === 'string')
		.join('\n');

	return thinking || undefined;
}

export function serializeToolArguments(argumentsValue: unknown): string {
	try {
		return JSON.stringify(argumentsValue ?? {}, null, 2);
	} catch {
		return '[Unable to serialize tool arguments]';
	}
}

function toolCallsFromContent(content: unknown): ChatToolCall[] | undefined {
	if (!Array.isArray(content)) {
		return undefined;
	}

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
				arguments: serializeToolArguments(item.arguments)
			}
		];
	});

	return calls.length ? calls : undefined;
}

function latestCacheHitRate(entries: SessionEntry[]): number | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry.type !== 'message' || entry.message.role !== 'assistant') {
			continue;
		}

		const usage = entry.message.usage;
		const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;

		return promptTokens > 0 ? (usage.cacheRead / promptTokens) * 100 : undefined;
	}

	return undefined;
}

function modelOption(model: {
	provider: string;
	id: string;
	name?: string;
	reasoning?: boolean;
	input?: Array<'text' | 'image'>;
	contextWindow?: number;
}): ModelOption {
	return {
		provider: model.provider,
		id: model.id,
		name: model.name ?? model.id,
		reasoning: model.reasoning ?? false,
		...(model.input ? { input: [...model.input] } : {}),
		...(model.contextWindow ? { contextWindow: model.contextWindow } : {})
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
	if (!model) {
		throw new Error('The selected model is not available with the configured credentials.');
	}

	return model;
}

export function mapSessionEntry(entry: SessionEntry): ChatItem | undefined {
	if (entry.type === 'message') {
		const message = entry.message as unknown as Record<string, unknown>;
		const role = message.role;
		if (role === 'user') {
			const userContent = userAttachmentsFromContent(message.content);

			return {
				id: entry.id,
				kind: 'message',
				role: 'user',
				text: userContent.text,
				timestamp: entry.timestamp,
				...(userContent.attachments ? { attachments: userContent.attachments } : {})
			};
		}

		if (role === 'assistant') {
			return {
				id: entry.id,
				kind: 'message',
				role: 'assistant',
				text: textFromContent(message.content),
				timestamp: entry.timestamp,
				modelName:
					typeof message.responseModel === 'string'
						? message.responseModel
						: typeof message.model === 'string'
							? message.model
							: undefined,
				thinking: thinkingFromContent(message.content),
				toolCalls: toolCallsFromContent(message.content),
				isError: message.stopReason === 'error',
				...(message.stopReason === 'aborted' ? { stopReason: 'aborted' as const } : {})
			};
		}

		if (role === 'toolResult') {
			return {
				id: entry.id,
				kind: 'message',
				role: 'tool',
				text: textFromContent(message.content),
				timestamp: entry.timestamp,
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
				timestamp: entry.timestamp,
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
				text: textFromContent(message.content),
				timestamp: entry.timestamp
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
	modelFallbackMessage?: string,
	mcpStatus?: McpStatusSnapshot,
	permissionRequests: PermissionRequest[] = []
): RuntimeSnapshot {
	const currentModel = session.model;
	const sessionStats = session.getSessionStats();
	const entries = session.sessionManager.getBranch();
	const cacheHitRate = latestCacheHitRate(session.sessionManager.getEntries());
	const sessionTokens: SessionTokenUsage = {
		...sessionStats.tokens,
		...(cacheHitRate !== undefined ? { cacheHitRate } : {})
	};
	const contextUsage = session.getContextUsage();

	return {
		runtimeId,
		project,
		sessionId: session.sessionId,
		sessionName: session.sessionName,
		model: currentModel ? modelOption(currentModel) : undefined,
		thinkingLevel: session.thinkingLevel as ThinkingLevel,
		isStreaming: session.isStreaming,
		items: entries.flatMap((entry) => {
			const item = mapSessionEntry(entry);

			return item ? [item] : [];
		}),
		...(mcpStatus ? { mcpStatus } : {}),
		sessionTokens,
		...(contextUsage ? { contextUsage } : {}),
		modelFallbackMessage,
		permissionRequests
	};
}

export async function createPiSession(options: {
	project: Project;
	mode: 'new' | 'resume';
	sessionPath?: string;
	model?: { provider: string; id: string };
	thinkingLevel?: ThinkingLevel;
	ephemeral?: boolean;
}): Promise<{ session: AgentSession; extensionEvents: EventBus; modelFallbackMessage?: string }> {
	const modelRuntime = await getModelRuntime();
	const settingsManager = SettingsManager.create(options.project.cwd, undefined, {
		projectTrusted: true
	});
	const extensionEvents = createEventBus();
	const resourceLoader = new DefaultResourceLoader({
		cwd: options.project.cwd,
		agentDir: getAgentDir(),
		settingsManager,
		eventBus: extensionEvents
	});
	await resourceLoader.reload();
	const sessionManager = options.ephemeral
		? SessionManager.inMemory(options.project.cwd)
		: options.mode === 'resume' && options.sessionPath
			? SessionManager.open(options.sessionPath, undefined, options.project.cwd)
			: SessionManager.create(options.project.cwd);
	const model = options.model
		? await resolveModel(options.model.provider, options.model.id)
		: undefined;

	const created = await createAgentSession({
		cwd: options.project.cwd,
		model,
		thinkingLevel: options.thinkingLevel,
		modelRuntime,
		sessionManager,
		settingsManager,
		resourceLoader
	});

	return { ...created, extensionEvents };
}

export function listSessionSlashCommands(session: AgentSession): SlashCommand[] {
	const commands = new Map<string, SlashCommand>();

	for (const command of session.extensionRunner.getRegisteredCommands()) {
		commands.set(command.invocationName, {
			name: command.invocationName,
			description: command.description,
			source: 'extension'
		});
	}

	for (const template of session.promptTemplates) {
		if (commands.has(template.name)) {
			continue;
		}

		commands.set(template.name, {
			name: template.name,
			description: template.description,
			source: 'prompt'
		});
	}

	for (const skill of session.resourceLoader.getSkills().skills) {
		const name = `skill:${skill.name}`;
		if (commands.has(name)) {
			continue;
		}

		commands.set(name, { name, description: skill.description, source: 'skill' });
	}

	return [...commands.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Load project resources without creating a persisted session solely for completion. */
export async function listProjectSlashCommands(project: Project): Promise<SlashCommand[]> {
	const { session } = await createPiSession({ project, mode: 'new', ephemeral: true });
	try {
		return listSessionSlashCommands(session);
	} finally {
		session.dispose();
	}
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
	if (!session) {
		throw new Error('Session not found in this project.');
	}

	return session.path;
}

export function normalizePiEvent(
	event: AgentSessionEvent
): Extract<RuntimeEvent, { type: 'assistant_delta' | 'tool_update' | 'notice' }> | undefined {
	if (event.type === 'message_update') {
		const update = event.assistantMessageEvent;
		if (update.type === 'text_delta') {
			return { type: 'assistant_delta', text: update.delta };
		}

		if (update.type === 'thinking_delta') {
			return { type: 'assistant_delta', thinking: update.delta };
		}

		if (update.type === 'toolcall_end') {
			return {
				type: 'tool_update',
				toolCallId: update.toolCall.id,
				toolName: update.toolCall.name,
				status: 'pending',
				arguments: serializeToolArguments(update.toolCall.arguments)
			};
		}

		if (update.type === 'error') {
			return { type: 'notice', message: 'The model returned an error.' };
		}
	}

	if (event.type === 'tool_execution_start') {
		return {
			type: 'tool_update',
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			status: 'running',
			arguments: serializeToolArguments(event.args)
		};
	}

	if (event.type === 'tool_execution_update') {
		return {
			type: 'tool_update',
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			status: 'running',
			arguments: serializeToolArguments(event.args),
			text: textFromContent(record(event.partialResult)?.content ?? event.partialResult)
		};
	}

	if (event.type === 'tool_execution_end') {
		return {
			type: 'tool_update',
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			status: event.isError ? 'failed' : 'completed',
			text: textFromContent(record(event.result)?.content ?? event.result)
		};
	}

	if (event.type === 'compaction_start') {
		return { type: 'notice', message: 'Compacting context…' };
	}

	if (event.type === 'auto_retry_start') {
		return { type: 'notice', message: 'Retrying model request…' };
	}

	return undefined;
}

import { randomUUID } from 'node:crypto';
import type {
	ModelOption,
	McpStatusSnapshot,
	PermissionResponse,
	PromptAttachment,
	PromptRuntimeResult,
	Project,
	RuntimeEvent,
	RuntimeSnapshot,
	SlashCommand,
	ThinkingLevel
} from '$lib/contracts';
import { validatePromptAttachments } from '$lib/attachments';
import { promptWithAttachments } from '$lib/prompt-attachments';
import { AssistantDeltaBatcher } from '$lib/server/assistant-delta-batcher';
import { eventBroker } from '$lib/server/event-broker';
import { PermissionBridge } from '$lib/server/permission-bridge';
import { getProject, markProjectOpened, resolveProject } from '$lib/server/projects';
import {
	buildSnapshot,
	createPiSession,
	listProjectSlashCommands,
	listSessionSlashCommands,
	normalizePiEvent,
	resolveModel,
	resolveSessionPath
} from '$lib/server/pi';
import { MCP_STATUS_EVENT, parseMcpStatusSnapshot } from '$lib/server/mcp-status';
import type {
	AgentSession,
	EventBus,
	ExtensionUIContext,
	PromptOptions
} from '@earendil-works/pi-coding-agent';

const IDLE_RUNTIME_MS = 30 * 60 * 1000;

interface RuntimeRecord {
	id: string;
	project: Project;
	session: AgentSession;
	unsubscribe: () => void;
	modelFallbackMessage?: string;
	lastAccessedAt: number;
	promptActive: boolean;
	permissions: PermissionBridge;
	assistantDeltaBatcher: AssistantDeltaBatcher;
	mcpStatus?: McpStatusSnapshot;
	unsubscribeMcpStatus: () => void;
	mcpToggle?: Promise<void>;
	suppressMcpReloadNotice?: boolean;
}

const runtimes = new Map<string, RuntimeRecord>();
const projectCommandCache = new Map<string, { expiresAt: number; commands: SlashCommand[] }>();
const PROJECT_COMMAND_CACHE_MS = 30_000;

type WebExtensionCommand = { text?: string; notice?: string };

function messageFromError(error: unknown): string {
	return error instanceof Error ? error.message : 'An unexpected server error occurred.';
}

/** Avoid terminal-only MCP panels while retaining useful text commands in the web UI. */
export function resolveWebExtensionCommand(text: string): WebExtensionCommand {
	const trimmed = text.trim();
	if (!trimmed.startsWith('/mcp')) {
		return { text };
	}

	const [command, subcommand] = trimmed.split(/\s+/, 2);
	if (command === '/mcp') {
		if (!subcommand || subcommand === 'status') {
			return {
				text: '/mcp tools',
				notice: 'The interactive MCP panel is terminal-only. Showing discovered MCP tools instead.'
			};
		}

		if (subcommand === 'setup') {
			return {
				notice: 'MCP setup is terminal-only. Edit the project .mcp.json, then reopen the chat.'
			};
		}

		if (!['tools', 'prompts', 'reconnect', 'logout', 'disable', 'enable'].includes(subcommand)) {
			return {
				text: '/mcp tools',
				notice: 'The interactive MCP panel is terminal-only. Showing discovered MCP tools instead.'
			};
		}
	}

	if (trimmed === '/mcp-auth') {
		return { notice: 'Specify an MCP server: /mcp-auth <server>' };
	}

	return { text };
}

export function subscribeToMcpStatus(
	events: EventBus,
	onStatus: (status: McpStatusSnapshot) => void
): () => void {
	return events.on(MCP_STATUS_EVENT, (value) => {
		const status = parseMcpStatusSnapshot(value);
		if (status) {
			onStatus(status);
		}
	});
}

export type RuntimeEventRecord = {
	id: string;
	assistantDeltaBatcher: AssistantDeltaBatcher;
};

/**
 * Publishes runtime events in source order. Assistant deltas are append-only and
 * may wait briefly; every other event is a causal boundary and flushes them.
 */
export function publishRuntimeEvent(
	record: RuntimeEventRecord,
	event: RuntimeEvent,
	broker: Pick<typeof eventBroker, 'publish'> = eventBroker
): void {
	if (event.type === 'assistant_delta') {
		record.assistantDeltaBatcher.queue(event);

		return;
	}

	record.assistantDeltaBatcher.flush();
	broker.publish(record.id, event);
}

function publish(record: RuntimeRecord, event: RuntimeEvent): void {
	publishRuntimeEvent(record, event);
}

/**
 * Bind the SDK session like Pi's RPC mode so extensions receive session_start.
 * The web harness has no session-tree UI, so extension requests to replace the
 * current session are explicitly cancelled rather than silently doing nothing.
 */
export async function bindRuntimeExtensions(
	session: AgentSession,
	uiContext: ExtensionUIContext,
	onError: (message: string) => void,
	onShutdown: () => void
): Promise<void> {
	await session.bindExtensions({
		uiContext,
		mode: 'rpc',
		commandContextActions: {
			waitForIdle: () => session.waitForIdle(),
			newSession: async () => ({ cancelled: true }),
			fork: async () => ({ cancelled: true }),
			navigateTree: async () => ({ cancelled: true }),
			switchSession: async () => ({ cancelled: true }),
			reload: () => session.reload()
		},
		shutdownHandler: onShutdown,
		onError: (error) => onError(`Extension ${error.event} failed: ${error.error}`)
	});
}

export async function shutdownRuntimeSession(session: AgentSession): Promise<void> {
	try {
		await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
	} finally {
		session.dispose();
	}
}

function publishSnapshot(record: RuntimeRecord): RuntimeSnapshot {
	const snapshot = buildSnapshot(
		record.id,
		record.project,
		record.session,
		record.modelFallbackMessage,
		record.mcpStatus,
		record.permissions.pendingRequests
	);
	publish(record, { type: 'snapshot', snapshot });

	return snapshot;
}

function attachSessionEvents(record: RuntimeRecord): () => void {
	return record.session.subscribe((event) => {
		record.lastAccessedAt = Date.now();
		if (event.type === 'agent_start') {
			publish(record, { type: 'state', isStreaming: true });
		}

		if (event.type === 'agent_settled' || event.type === 'agent_end') {
			publish(record, { type: 'state', isStreaming: record.session.isStreaming });
		}

		if (event.type === 'entry_appended' || event.type === 'session_info_changed') {
			publishSnapshot(record);
		}

		const normalized = normalizePiEvent(event);
		if (normalized) {
			publish(record, normalized);
		}
	});
}

function getRecord(runtimeId: string): RuntimeRecord {
	const record = runtimes.get(runtimeId);
	if (!record) {
		throw new Error('Chat tab is no longer active.');
	}

	record.lastAccessedAt = Date.now();

	return record;
}

export async function createRuntime(input: {
	mode: 'new' | 'resume';
	projectId: string;
	sessionId?: string;
	model?: ModelOption;
	thinkingLevel?: ThinkingLevel;
}): Promise<RuntimeSnapshot> {
	const project = await getProject(input.projectId);
	if (!project) {
		throw new Error('Project not found.');
	}

	if (input.mode === 'new' && (!input.model || !input.thinkingLevel)) {
		throw new Error('New chats require a model and reasoning level.');
	}

	if (input.mode === 'resume' && !input.sessionId) {
		throw new Error('A session is required to resume a chat.');
	}

	const sessionPath = input.sessionId
		? await resolveSessionPath(project, input.sessionId)
		: undefined;
	const created = await createPiSession({
		project,
		mode: input.mode,
		sessionPath,
		model: input.model ? { provider: input.model.provider, id: input.model.id } : undefined,
		thinkingLevel: input.thinkingLevel
	});

	const id = randomUUID();
	const recordRef: { current?: RuntimeRecord } = {};
	const permissions = new PermissionBridge((event) => {
		const record = recordRef.current;
		if (
			record?.suppressMcpReloadNotice &&
			event.type === 'notice' &&
			event.message.includes('run /reload to apply')
		) {
			return;
		}

		// This direct path is only reachable during record construction, before a
		// batcher can have received session output.
		if (!record) {
			eventBroker.publish(id, event);

			return;
		}

		publish(record, event);
	});
	const record: RuntimeRecord = {
		id,
		project: await markProjectOpened(project.id),
		session: created.session,
		unsubscribe: () => undefined,
		modelFallbackMessage: created.modelFallbackMessage,
		lastAccessedAt: Date.now(),
		promptActive: false,
		permissions,
		assistantDeltaBatcher: new AssistantDeltaBatcher((event) => eventBroker.publish(id, event)),
		unsubscribeMcpStatus: () => undefined
	};
	recordRef.current = record;
	record.unsubscribeMcpStatus = subscribeToMcpStatus(created.extensionEvents, (snapshot) => {
		record.mcpStatus = snapshot;
		publish(record, { type: 'mcp_status', mcpStatus: snapshot });
	});
	try {
		await bindRuntimeExtensions(
			created.session,
			permissions.extensionUI,
			(message) => publish(record, { type: 'error', message }),
			() => void disposeRuntime(id)
		);
	} catch (error) {
		record.unsubscribeMcpStatus();
		await shutdownRuntimeSession(created.session);
		throw error;
	}

	record.unsubscribe = attachSessionEvents(record);
	runtimes.set(record.id, record);

	return buildSnapshot(
		record.id,
		record.project,
		record.session,
		record.modelFallbackMessage,
		record.mcpStatus,
		record.permissions.pendingRequests
	);
}

export function respondToPermissionRequest(runtimeId: string, response: PermissionResponse): void {
	getRecord(runtimeId).permissions.respond(response);
}

export function getRuntimeSnapshot(runtimeId: string): RuntimeSnapshot {
	const record = getRecord(runtimeId);

	return buildSnapshot(
		record.id,
		record.project,
		record.session,
		record.modelFallbackMessage,
		record.mcpStatus,
		record.permissions.pendingRequests
	);
}

export function listRuntimeSlashCommands(runtimeId: string): SlashCommand[] {
	return listSessionSlashCommands(getRecord(runtimeId).session);
}

export async function listProjectRuntimeSlashCommands(projectId: string): Promise<SlashCommand[]> {
	const project = await resolveProject(projectId);
	const cached = projectCommandCache.get(project.id);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.commands;
	}

	const commands = await listProjectSlashCommands(project);
	projectCommandCache.set(project.id, {
		commands,
		expiresAt: Date.now() + PROJECT_COMMAND_CACHE_MS
	});

	return commands;
}

export function promptRuntime(
	runtimeId: string,
	text: string,
	attachments: unknown = [],
	streamingBehavior?: 'steer' | 'followUp'
): PromptRuntimeResult {
	const record = getRecord(runtimeId);
	const validatedAttachments = validatePromptAttachments(attachments);
	const visibleText = text.trim();
	if (!visibleText && !validatedAttachments.length) {
		throw new Error('Messages cannot be empty.');
	}

	if (record.mcpToggle) {
		throw new Error('Wait for the MCP server change to finish.');
	}

	const resolved = resolveWebExtensionCommand(
		promptWithAttachments(visibleText, validatedAttachments)
	);
	if (resolved.notice) {
		publish(record, { type: 'notice', message: resolved.notice });
	}

	if (!resolved.text) {
		if (validatedAttachments.length) {
			throw new Error('Attachments cannot be sent with this command.');
		}

		return { queued: false };
	}

	text = resolved.text;
	const queued = record.promptActive || record.session.isStreaming;
	record.promptActive = true;
	const images: NonNullable<PromptOptions['images']> = validatedAttachments
		.filter(
			(attachment): attachment is PromptAttachment & { kind: 'image' } =>
				attachment.kind === 'image'
		)
		.map((attachment) => ({ type: 'image', data: attachment.data, mimeType: attachment.mimeType }));
	const options: PromptOptions = {
		...(images.length ? { images } : {}),
		...(queued ? { streamingBehavior: streamingBehavior ?? 'followUp' } : {})
	};

	void record.session
		.prompt(text, Object.keys(options).length ? options : undefined)
		.catch((error: unknown) => publish(record, { type: 'error', message: messageFromError(error) }))
		.finally(() => {
			record.promptActive = false;
			publish(record, { type: 'state', isStreaming: record.session.isStreaming });
			publishSnapshot(record);
		});

	return { queued, userMessageText: visibleText };
}

export async function setRuntimeModel(
	runtimeId: string,
	model: { provider: string; id: string }
): Promise<RuntimeSnapshot> {
	const record = getRecord(runtimeId);
	if (record.session.isStreaming) {
		throw new Error('Wait for the current response before changing the model.');
	}

	await record.session.setModel(await resolveModel(model.provider, model.id));

	return publishSnapshot(record);
}

export function setRuntimeThinkingLevel(
	runtimeId: string,
	thinkingLevel: ThinkingLevel
): RuntimeSnapshot {
	const record = getRecord(runtimeId);
	if (record.session.isStreaming) {
		throw new Error('Wait for the current response before changing reasoning.');
	}

	record.session.setThinkingLevel(thinkingLevel);

	return publishSnapshot(record);
}

/** Persist an adapter-compatible project override, then reload extensions to apply it. */
export async function setRuntimeMcpServerEnabled(
	runtimeId: string,
	serverName: string,
	enabled: boolean
): Promise<RuntimeSnapshot> {
	const record = getRecord(runtimeId);
	const previousToggle = record.mcpToggle ?? Promise.resolve();
	const toggle = previousToggle.then(async () => {
		if (record.session.isStreaming || record.promptActive) {
			throw new Error('Wait for the current response before changing MCP servers.');
		}

		const server = record.mcpStatus?.servers.find((candidate) => candidate.name === serverName);
		if (!server) {
			throw new Error('MCP server not found in this chat.');
		}

		if (server.disabled === !enabled) {
			return publishSnapshot(record);
		}

		record.suppressMcpReloadNotice = true;
		try {
			await record.session.prompt(`/mcp ${enabled ? 'enable' : 'disable'} ${serverName}`);
			await record.session.reload();

			return publishSnapshot(record);
		} finally {
			record.suppressMcpReloadNotice = false;
		}
	});
	const pending = toggle.then(
		() => undefined,
		() => undefined
	);
	record.mcpToggle = pending;
	void pending.finally(() => {
		if (record.mcpToggle === pending) {
			record.mcpToggle = undefined;
		}
	});

	return toggle;
}

export async function abortRuntime(runtimeId: string): Promise<void> {
	const record = getRecord(runtimeId);
	record.permissions.cancelAll();
	await record.session.abort();
	publishSnapshot(record);
}

export async function disposeRuntime(runtimeId: string): Promise<void> {
	const record = runtimes.get(runtimeId);
	if (!record) {
		return;
	}

	record.permissions.cancelAll();
	if (record.session.isStreaming) {
		await record.session.abort();
	}

	// Deliver output produced before teardown, then prevent a timer from
	// publishing after this runtime disappears.
	record.assistantDeltaBatcher.flush();
	record.unsubscribe();
	record.unsubscribeMcpStatus();
	record.assistantDeltaBatcher.cancel();
	runtimes.delete(runtimeId);
	await shutdownRuntimeSession(record.session);
}

export async function cleanupIdleRuntimes(): Promise<void> {
	const cutoff = Date.now() - IDLE_RUNTIME_MS;
	for (const [runtimeId, record] of runtimes) {
		if (record.lastAccessedAt < cutoff && !record.session.isStreaming) {
			await disposeRuntime(runtimeId);
		}
	}
}

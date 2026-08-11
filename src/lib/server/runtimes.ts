import { randomUUID } from 'node:crypto';
import type {
	ModelOption,
	McpStatusSnapshot,
	PermissionResponse,
	PromptRuntimeResult,
	Project,
	RuntimeCheckpoint,
	RuntimeEvent,
	RuntimeLiveState,
	RuntimeMetadataPatch,
	RuntimeMutation,
	RuntimeSnapshot,
	SlashCommand,
	ThinkingLevel
} from '$lib/contracts';
import { promptWithAttachments } from '$lib/prompt-attachments';
import type { ValidatedPromptAttachment } from '$lib/server/attachments';
import { AssistantDeltaBatcher } from '$lib/server/assistant-delta-batcher';
import { eventBroker } from '$lib/server/event-broker';
import { PermissionBridge } from '$lib/server/permission-bridge';
import { getProject, markProjectOpened, resolveProject } from '$lib/server/projects';
import {
	buildSnapshot,
	createPiSession,
	mapSessionEntry,
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
	projection: RuntimeProjection;
}

interface RuntimeProjection {
	snapshot: RuntimeSnapshot;
	live: RuntimeLiveState;
	revision: number;
	/** Last active-branch entry observed when persisted items were refreshed. */
	sourceLeafId?: string;
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

/**
 * Runtime projection mutation and publication are deliberately synchronous.
 * The revision is assigned only after all earlier delayed text has been flushed.
 */
function commitMutation(record: RuntimeRecord, mutation: RuntimeMutation): void {
	const baseRevision = record.projection.revision;
	record.projection.revision += 1;
	eventBroker.publish(record.id, {
		...mutation,
		baseRevision,
		revision: record.projection.revision
	});
}

function applyLiveMutation(projection: RuntimeProjection, mutation: RuntimeMutation): void {
	if (mutation.type === 'permission_request') {
		projection.snapshot = {
			...projection.snapshot,
			permissionRequests: [...projection.snapshot.permissionRequests, mutation.request]
		};

		return;
	}

	if (mutation.type === 'permission_resolved') {
		projection.snapshot = {
			...projection.snapshot,
			permissionRequests: projection.snapshot.permissionRequests.filter(
				(request) => request.id !== mutation.requestId
			)
		};

		return;
	}

	if (mutation.type === 'assistant_delta') {
		projection.live.text += mutation.text ?? '';
		projection.live.thinking += mutation.thinking ?? '';

		return;
	}

	if (mutation.type === 'tool_update') {
		const existing = projection.live.tools.find((tool) => tool.id === mutation.toolCallId);
		const tool = {
			id: mutation.toolCallId,
			name: mutation.toolName,
			status: mutation.status,
			...(mutation.arguments !== undefined ? { arguments: mutation.arguments } : {}),
			...(mutation.text !== undefined ? { text: mutation.text } : {})
		};
		if (existing) {
			Object.assign(existing, tool);
		} else {
			projection.live.tools.push(tool);
		}
	}
}

function publish(
	record: RuntimeRecord,
	mutation: RuntimeMutation | Extract<RuntimeEvent, { type: 'notice' | 'error' }>
): void {
	if (mutation.type === 'notice' || mutation.type === 'error') {
		record.assistantDeltaBatcher.flush();
		eventBroker.publish(record.id, mutation);

		return;
	}

	applyLiveMutation(record.projection, mutation);
	if (mutation.type === 'assistant_delta') {
		record.assistantDeltaBatcher.queue(mutation);

		return;
	}

	record.assistantDeltaBatcher.flush();
	commitMutation(record, mutation);
}

function checkpoint(record: RuntimeRecord): RuntimeCheckpoint {
	// Flushing first guarantees the reported cursor includes the complete live prefix.
	record.assistantDeltaBatcher.flush();

	return {
		protocolVersion: 2,
		cursor: eventBroker.currentCursor(),
		revision: record.projection.revision,
		snapshot: record.projection.snapshot,
		live: {
			text: record.projection.live.text,
			thinking: record.projection.live.thinking,
			tools: record.projection.live.tools.map((tool) => ({ ...tool }))
		}
	};
}

function metadataPatch(record: RuntimeRecord): RuntimeMetadataPatch {
	const session = record.session;
	const snapshot = record.projection.snapshot;
	const sessionStats = session.getSessionStats();
	const contextUsage = session.getContextUsage();
	const next: RuntimeMetadataPatch = {
		sessionName: session.sessionName,
		model: session.model
			? {
					provider: session.model.provider,
					id: session.model.id,
					name: session.model.name ?? session.model.id,
					reasoning: session.model.reasoning ?? false
				}
			: undefined,
		thinkingLevel: session.thinkingLevel as ThinkingLevel,
		isStreaming: session.isStreaming,
		mcpStatus: record.mcpStatus,
		modelFallbackMessage: record.modelFallbackMessage,
		permissionRequests: record.permissions.pendingRequests,
		sessionTokens: sessionStats.tokens,
		contextUsage
	};
	const patch: RuntimeMetadataPatch = {};
	for (const [key, value] of Object.entries(next) as Array<
		[keyof RuntimeMetadataPatch, RuntimeMetadataPatch[keyof RuntimeMetadataPatch]]
	>) {
		if (JSON.stringify(snapshot[key]) !== JSON.stringify(value)) {
			patch[key] = value as never;
		}
	}

	return patch;
}

function refreshMetadata(record: RuntimeRecord): void {
	const patch = metadataPatch(record);
	if (!Object.keys(patch).length) {
		return;
	}

	record.projection.snapshot = { ...record.projection.snapshot, ...patch };
	publish(record, { type: 'metadata_updated', patch });
}

function refreshPersistedItems(
	record: RuntimeRecord,
	reason: 'branch' | 'compaction' | 'recovery' = 'branch'
): void {
	const entries = record.session.sessionManager.getBranch();
	const leafId = entries.at(-1)?.id;
	if (leafId === record.projection.sourceLeafId) {
		return;
	}

	const knownIndex = record.projection.sourceLeafId
		? entries.findIndex((entry) => entry.id === record.projection.sourceLeafId)
		: -1;
	if (!record.projection.sourceLeafId || knownIndex < 0) {
		const items = entries.flatMap((entry) => {
			const item = mapSessionEntry(entry);

			return item ? [item] : [];
		});
		record.projection.snapshot = { ...record.projection.snapshot, items };
		if (!record.session.isStreaming) {
			record.projection.live = { text: '', thinking: '', tools: [] };
		}

		record.projection.sourceLeafId = leafId;
		publish(record, { type: 'items_replaced', items, reason });

		return;
	}

	const afterId = record.projection.snapshot.items.at(-1)?.id;
	const suffix = entries.slice(knownIndex + 1).flatMap((entry) => {
		const item = mapSessionEntry(entry);

		return item ? [item] : [];
	});
	record.projection.sourceLeafId = leafId;
	if (!suffix.length) {
		return;
	}

	record.projection.snapshot = {
		...record.projection.snapshot,
		items: [...record.projection.snapshot.items, ...suffix]
	};
	if (!record.session.isStreaming) {
		record.projection.live = { text: '', thinking: '', tools: [] };
	}

	publish(record, { type: 'items_appended', afterId, items: suffix });
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

function attachSessionEvents(record: RuntimeRecord): () => void {
	let refreshScheduled = false;
	const schedulePersistedRefresh = () => {
		if (refreshScheduled) {
			return;
		}

		refreshScheduled = true;
		queueMicrotask(() => {
			refreshScheduled = false;
			refreshPersistedItems(record);
			refreshMetadata(record);
		});
	};

	return record.session.subscribe((event) => {
		record.lastAccessedAt = Date.now();
		if (
			event.type === 'agent_start' ||
			event.type === 'agent_settled' ||
			event.type === 'agent_end'
		) {
			refreshMetadata(record);
		}

		if (event.type === 'entry_appended' || event.type === 'session_info_changed') {
			schedulePersistedRefresh();
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
}): Promise<RuntimeCheckpoint> {
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
	const openedProject = await markProjectOpened(project.id);
	const initialSnapshot = buildSnapshot(
		id,
		openedProject,
		created.session,
		created.modelFallbackMessage,
		undefined,
		[]
	);
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

		if (record) {
			publish(record, event);
		}
	});
	const record: RuntimeRecord = {
		id,
		project: openedProject,
		session: created.session,
		unsubscribe: () => undefined,
		modelFallbackMessage: created.modelFallbackMessage,
		lastAccessedAt: Date.now(),
		promptActive: false,
		permissions,
		assistantDeltaBatcher: new AssistantDeltaBatcher((event) => {
			const current = recordRef.current;
			if (current) {
				commitMutation(current, event);
			}
		}),
		unsubscribeMcpStatus: () => undefined,
		projection: {
			snapshot: initialSnapshot,
			live: { text: '', thinking: '', tools: [] },
			revision: 0,
			sourceLeafId: created.session.sessionManager.getBranch().at(-1)?.id
		}
	};
	recordRef.current = record;
	record.unsubscribeMcpStatus = subscribeToMcpStatus(created.extensionEvents, (snapshot) => {
		record.mcpStatus = snapshot;
		refreshMetadata(record);
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

	return checkpoint(record);
}

export function respondToPermissionRequest(runtimeId: string, response: PermissionResponse): void {
	getRecord(runtimeId).permissions.respond(response);
}

export function getRuntimeCheckpoint(runtimeId: string): RuntimeCheckpoint {
	return checkpoint(getRecord(runtimeId));
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
	validatedAttachments: readonly ValidatedPromptAttachment[] = [],
	streamingBehavior?: 'steer' | 'followUp'
): PromptRuntimeResult {
	const record = getRecord(runtimeId);
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
			(attachment): attachment is Extract<ValidatedPromptAttachment, { kind: 'image' }> =>
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
			refreshPersistedItems(record);
			refreshMetadata(record);
		});

	return { queued, userMessageText: visibleText };
}

export async function setRuntimeModel(
	runtimeId: string,
	model: { provider: string; id: string }
): Promise<RuntimeCheckpoint> {
	const record = getRecord(runtimeId);
	if (record.session.isStreaming) {
		throw new Error('Wait for the current response before changing the model.');
	}

	await record.session.setModel(await resolveModel(model.provider, model.id));
	refreshPersistedItems(record);
	refreshMetadata(record);

	return checkpoint(record);
}

export function setRuntimeThinkingLevel(
	runtimeId: string,
	thinkingLevel: ThinkingLevel
): RuntimeCheckpoint {
	const record = getRecord(runtimeId);
	if (record.session.isStreaming) {
		throw new Error('Wait for the current response before changing reasoning.');
	}

	record.session.setThinkingLevel(thinkingLevel);
	refreshPersistedItems(record);
	refreshMetadata(record);

	return checkpoint(record);
}

/** Persist an adapter-compatible project override, then reload extensions to apply it. */
export async function setRuntimeMcpServerEnabled(
	runtimeId: string,
	serverName: string,
	enabled: boolean
): Promise<RuntimeCheckpoint> {
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
			return checkpoint(record);
		}

		record.suppressMcpReloadNotice = true;
		try {
			await record.session.prompt(`/mcp ${enabled ? 'enable' : 'disable'} ${serverName}`);
			await record.session.reload();
			refreshPersistedItems(record);
			refreshMetadata(record);

			return checkpoint(record);
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
	refreshPersistedItems(record);
	refreshMetadata(record);
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

export async function disposeAllRuntimes(): Promise<void> {
	const failures: unknown[] = [];
	for (const runtimeId of [...runtimes.keys()]) {
		try {
			await disposeRuntime(runtimeId);
		} catch (error) {
			failures.push(error);
		}
	}

	if (failures.length > 0) {
		throw failures[0];
	}
}

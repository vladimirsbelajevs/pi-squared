import { randomUUID } from 'node:crypto';
import type {
	ModelOption,
	PermissionResponse,
	Project,
	RuntimeEvent,
	RuntimeSnapshot,
	ThinkingLevel
} from '$lib/contracts';
import { eventBroker } from '$lib/server/event-broker';
import { PermissionBridge } from '$lib/server/permission-bridge';
import { getProject, markProjectOpened } from '$lib/server/projects';
import {
	buildSnapshot,
	createPiSession,
	normalizePiEvent,
	resolveModel,
	resolveSessionPath
} from '$lib/server/pi';
import type { AgentSession } from '@earendil-works/pi-coding-agent';

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
}

const runtimes = new Map<string, RuntimeRecord>();

function messageFromError(error: unknown): string {
	return error instanceof Error ? error.message : 'An unexpected server error occurred.';
}

function publish(record: RuntimeRecord, event: RuntimeEvent): void {
	eventBroker.publish(record.id, event);
}

function publishSnapshot(record: RuntimeRecord): RuntimeSnapshot {
	const snapshot = buildSnapshot(
		record.id,
		record.project,
		record.session,
		record.modelFallbackMessage
	);
	publish(record, { type: 'snapshot', snapshot });
	return snapshot;
}

function attachSessionEvents(record: RuntimeRecord): () => void {
	return record.session.subscribe((event) => {
		record.lastAccessedAt = Date.now();
		if (event.type === 'agent_start') publish(record, { type: 'state', isStreaming: true });
		if (event.type === 'agent_settled' || event.type === 'agent_end') {
			publish(record, { type: 'state', isStreaming: record.session.isStreaming });
		}
		if (event.type === 'entry_appended' || event.type === 'session_info_changed')
			publishSnapshot(record);

		const normalized = normalizePiEvent(event);
		if (normalized) publish(record, normalized);
	});
}

function getRecord(runtimeId: string): RuntimeRecord {
	const record = runtimes.get(runtimeId);
	if (!record) throw new Error('Chat tab is no longer active.');
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
	if (!project) throw new Error('Project not found.');
	if (input.mode === 'new' && (!input.model || !input.thinkingLevel)) {
		throw new Error('New chats require a model and reasoning level.');
	}
	if (input.mode === 'resume' && !input.sessionId)
		throw new Error('A session is required to resume a chat.');

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
	const permissions = new PermissionBridge((event) => eventBroker.publish(id, event));
	created.session.extensionRunner.setUIContext(permissions.extensionUI, 'rpc');
	const record: RuntimeRecord = {
		id,
		project: await markProjectOpened(project.id),
		session: created.session,
		unsubscribe: () => undefined,
		modelFallbackMessage: created.modelFallbackMessage,
		lastAccessedAt: Date.now(),
		promptActive: false,
		permissions
	};
	record.unsubscribe = attachSessionEvents(record);
	runtimes.set(record.id, record);
	return buildSnapshot(record.id, record.project, record.session, record.modelFallbackMessage);
}

export function respondToPermissionRequest(runtimeId: string, response: PermissionResponse): void {
	getRecord(runtimeId).permissions.respond(response);
}

export function getRuntimeSnapshot(runtimeId: string): RuntimeSnapshot {
	const record = getRecord(runtimeId);
	return buildSnapshot(record.id, record.project, record.session, record.modelFallbackMessage);
}

export function promptRuntime(
	runtimeId: string,
	text: string,
	streamingBehavior?: 'steer' | 'followUp'
): { queued: boolean } {
	const record = getRecord(runtimeId);
	if (!text.trim()) throw new Error('Messages cannot be empty.');
	const queued = record.promptActive || record.session.isStreaming;
	record.promptActive = true;

	void record.session
		.prompt(text, queued ? { streamingBehavior: streamingBehavior ?? 'followUp' } : undefined)
		.catch((error: unknown) => publish(record, { type: 'error', message: messageFromError(error) }))
		.finally(() => {
			record.promptActive = false;
			publish(record, { type: 'state', isStreaming: record.session.isStreaming });
			publishSnapshot(record);
		});

	return { queued };
}

export async function setRuntimeModel(
	runtimeId: string,
	model: { provider: string; id: string }
): Promise<RuntimeSnapshot> {
	const record = getRecord(runtimeId);
	if (record.session.isStreaming)
		throw new Error('Wait for the current response before changing the model.');
	await record.session.setModel(await resolveModel(model.provider, model.id));
	return publishSnapshot(record);
}

export function setRuntimeThinkingLevel(
	runtimeId: string,
	thinkingLevel: ThinkingLevel
): RuntimeSnapshot {
	const record = getRecord(runtimeId);
	if (record.session.isStreaming)
		throw new Error('Wait for the current response before changing reasoning.');
	record.session.setThinkingLevel(thinkingLevel);
	return publishSnapshot(record);
}

export async function abortRuntime(runtimeId: string): Promise<void> {
	const record = getRecord(runtimeId);
	record.permissions.cancelAll();
	await record.session.abort();
	publishSnapshot(record);
}

export async function disposeRuntime(runtimeId: string): Promise<void> {
	const record = runtimes.get(runtimeId);
	if (!record) return;
	runtimes.delete(runtimeId);
	record.permissions.cancelAll();
	if (record.session.isStreaming) await record.session.abort();
	record.unsubscribe();
	record.session.dispose();
}

export async function cleanupIdleRuntimes(): Promise<void> {
	const cutoff = Date.now() - IDLE_RUNTIME_MS;
	for (const [runtimeId, record] of runtimes) {
		if (record.lastAccessedAt < cutoff && !record.session.isStreaming)
			await disposeRuntime(runtimeId);
	}
}

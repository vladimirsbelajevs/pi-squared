import type {
	HistoricalSession,
	ModelOption,
	PermissionResponse,
	PromptAttachment,
	Project,
	ProjectFileSuggestion,
	PromptRuntimeResult,
	RuntimeSnapshot,
	SlashCommand,
	StreamEnvelope,
	ThinkingLevel
} from '$lib/contracts';

function isStreamEnvelope(value: unknown): value is StreamEnvelope {
	if (!value || typeof value !== 'object') return false;
	const envelope = value as Record<string, unknown>;
	return (
		typeof envelope.id === 'number' &&
		typeof envelope.runtimeId === 'string' &&
		!!envelope.event &&
		typeof envelope.event === 'object'
	);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(url, {
		headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
		...init
	});
	const body: unknown = response.status === 204 ? undefined : await response.json();
	if (!response.ok) {
		const message =
			body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
				? body.error
				: 'Request failed.';
		throw new Error(message);
	}
	return body as T;
}

export function listProjects(): Promise<{ projects: Project[] }> {
	return request('/api/projects');
}

export function listModels(): Promise<{ models: ModelOption[] }> {
	return request('/api/models');
}

export function listSessions(): Promise<{ sessions: HistoricalSession[] }> {
	return request('/api/sessions');
}

export function addProject(input: { cwd: string; name: string }): Promise<{ project: Project }> {
	return request('/api/projects', { method: 'POST', body: JSON.stringify(input) });
}

export function listProjectSlashCommands(
	projectId: string,
	signal?: AbortSignal
): Promise<{ commands: SlashCommand[] }> {
	return request(`/api/projects/${encodeURIComponent(projectId)}/commands`, { signal });
}

export function searchProjectFiles(
	projectId: string,
	query: string,
	signal?: AbortSignal
): Promise<{ files: ProjectFileSuggestion[] }> {
	const parameters = new URLSearchParams({ q: query });
	return request(`/api/projects/${encodeURIComponent(projectId)}/files?${parameters}`, { signal });
}

export function createRuntime(input: {
	mode: 'new' | 'resume';
	projectId: string;
	sessionId?: string;
	model?: ModelOption;
	thinkingLevel?: ThinkingLevel;
}): Promise<{ snapshot: RuntimeSnapshot }> {
	return request('/api/runtimes', { method: 'POST', body: JSON.stringify(input) });
}

export function getRuntime(runtimeId: string): Promise<{ snapshot: RuntimeSnapshot }> {
	return request(`/api/runtimes/${encodeURIComponent(runtimeId)}`);
}

export function listRuntimeSlashCommands(
	runtimeId: string,
	signal?: AbortSignal
): Promise<{ commands: SlashCommand[] }> {
	return request(`/api/runtimes/${encodeURIComponent(runtimeId)}/commands`, { signal });
}

export function disposeRuntime(runtimeId: string): Promise<void> {
	return request(`/api/runtimes/${encodeURIComponent(runtimeId)}`, { method: 'DELETE' });
}

export function promptRuntime(
	runtimeId: string,
	input: {
		text: string;
		attachments: PromptAttachment[];
		streamingBehavior: 'steer' | 'followUp';
	}
): Promise<PromptRuntimeResult> {
	return request(`/api/runtimes/${encodeURIComponent(runtimeId)}/prompt`, {
		method: 'POST',
		body: JSON.stringify(input)
	});
}

export function abortRuntime(runtimeId: string): Promise<{ ok: true }> {
	return request(`/api/runtimes/${encodeURIComponent(runtimeId)}/abort`, { method: 'POST' });
}

export function respondToPermission(
	runtimeId: string,
	response: PermissionResponse
): Promise<{ ok: true }> {
	return request(`/api/runtimes/${encodeURIComponent(runtimeId)}/permission`, {
		method: 'POST',
		body: JSON.stringify(response)
	});
}

export function setRuntimeModel(
	runtimeId: string,
	model: ModelOption
): Promise<{ snapshot: RuntimeSnapshot }> {
	return request(`/api/runtimes/${encodeURIComponent(runtimeId)}/model`, {
		method: 'POST',
		body: JSON.stringify(model)
	});
}

export function setRuntimeThinking(
	runtimeId: string,
	thinkingLevel: ThinkingLevel
): Promise<{ snapshot: RuntimeSnapshot }> {
	return request(`/api/runtimes/${encodeURIComponent(runtimeId)}/thinking`, {
		method: 'POST',
		body: JSON.stringify({ thinkingLevel })
	});
}

export function setRuntimeMcpServerEnabled(
	runtimeId: string,
	input: { serverName: string; enabled: boolean }
): Promise<{ snapshot: RuntimeSnapshot }> {
	return request(`/api/runtimes/${encodeURIComponent(runtimeId)}/mcp`, {
		method: 'POST',
		body: JSON.stringify(input)
	});
}

export function openEventStream(
	lastEventId: number | undefined,
	onEvent: (event: StreamEnvelope) => void
): EventSource {
	const query = lastEventId === undefined ? '' : `?lastEventId=${encodeURIComponent(lastEventId)}`;
	const source = new EventSource(`/api/events${query}`);
	source.onmessage = (message) => {
		try {
			const parsed: unknown = JSON.parse(message.data);
			if (isStreamEnvelope(parsed)) onEvent(parsed);
		} catch {
			// EventSource reconnects automatically after a malformed or interrupted event.
		}
	};
	return source;
}

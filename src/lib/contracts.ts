export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface Project {
	id: string;
	name: string;
	cwd: string;
	addedAt: string;
	lastOpenedAt: string;
}

export type SlashCommandSource = 'extension' | 'prompt' | 'skill';

/** A slash command that AgentSession.prompt() can execute. */
export interface SlashCommand {
	name: string;
	description?: string;
	source: SlashCommandSource;
}

/** A project-relative file path suitable for an @ mention. */
export interface ProjectFileSuggestion {
	path: string;
}

export type McpServerState =
	'connected' | 'cached' | 'failed' | 'needs-auth' | 'not-connected' | 'disabled';

/** A browser-safe view of a configured MCP server. */
export interface McpServerStatus {
	name: string;
	state: McpServerState;
	toolCount: number;
	resourceCount?: number;
	failedAgoSeconds?: number;
	disabled: boolean;
}

/** A browser-safe snapshot emitted by pi-mcp-adapter over Pi's extension event bus. */
export interface McpStatusSnapshot {
	servers: McpServerStatus[];
	totalTools: number;
	totalResources: number;
	connectedCount: number;
	disabledCount: number;
}

export interface ModelOption {
	provider: string;
	id: string;
	name: string;
	reasoning: boolean;
	/** Input modalities reported by Pi's model catalog. Missing values are treated as unknown. */
	input?: Array<'text' | 'image'>;
	contextWindow?: number;
}

export type ChatAttachmentKind = 'image' | 'text';

export interface PromptAttachment {
	id: string;
	kind: ChatAttachmentKind;
	name: string;
	mimeType: string;
	size: number;
	data: string;
}

export interface ChatAttachment {
	id: string;
	kind: ChatAttachmentKind;
	name: string;
	mimeType: string;
	size: number;
	data?: string;
}

export interface ChatSubmission {
	text: string;
	attachments: PromptAttachment[];
}

export interface SessionTokenUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cacheHitRate?: number;
	total: number;
}

export interface ContextUsageSnapshot {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

export interface HistoricalSession {
	projectId: string;
	projectName: string;
	sessionId: string;
	name?: string;
	firstMessage: string;
	createdAt: string;
	modifiedAt: string;
	messageCount: number;
}

export interface ChatToolCall {
	id: string;
	name: string;
	arguments: string;
}

export type SubagentRunStatus = 'running' | 'completed' | 'failed' | 'paused' | 'stopped';

/** Browser-safe identity and lifecycle projection for one delegated child. */
export interface SubagentRun {
	/** Stable parent run identity, or a conservative owning-call fallback for legacy data. */
	runId: string;
	/** Stable child identity within the run. */
	childId: string;
	/** The parent assistant tool call that launched this child. */
	toolCallId: string;
	agent: string;
	task?: string;
	status: SubagentRunStatus;
	/** Opaque session ID; never a filesystem path. */
	childSessionId?: string;
	/** False when a terminal run has no persisted Pi session (for example external CLI). */
	timelineAvailable?: boolean;
}

export interface SubagentRunsResponse {
	runs: SubagentRun[];
	freshForMs: number;
}

export interface SubagentTimelineResponse {
	status: SubagentRunStatus;
	available: boolean;
	initialized: boolean;
	items: ChatItem[];
}

export type ToolStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ChatItem {
	id: string;
	kind: 'message' | 'notice';
	role?: 'user' | 'assistant' | 'tool' | 'bash' | 'custom';
	text: string;
	timestamp?: string;
	modelName?: string;
	thinking?: string;
	toolCalls?: ChatToolCall[];
	toolCallId?: string;
	attachments?: ChatAttachment[];
	isError?: boolean;
	stopReason?: 'aborted';
	label?: string;
}

export interface PermissionRequest {
	id: string;
	method: 'select' | 'confirm' | 'input';
	title: string;
	message?: string;
	options?: string[];
	placeholder?: string;
}

export interface RuntimeSnapshot {
	runtimeId: string;
	project: Project;
	sessionId: string;
	sessionName?: string;
	model?: ModelOption;
	thinkingLevel: ThinkingLevel;
	isStreaming: boolean;
	items: ChatItem[];
	mcpStatus?: McpStatusSnapshot;
	sessionTokens?: SessionTokenUsage;
	contextUsage?: ContextUsageSnapshot;
	modelFallbackMessage?: string;
	permissionRequests: PermissionRequest[];
}

/** Opaque process-local position in the SSE broker. Never compare cursor IDs lexically. */
export interface StreamCursor {
	epoch: string;
	sequence: number;
}

export interface RuntimeStreamingTool {
	id: string;
	name: string;
	status: ToolStatus;
	arguments?: string;
	text?: string;
}

/** State not persisted by Pi yet, but included in checkpoints while streaming. */
export interface RuntimeLiveState {
	text: string;
	thinking: string;
	tools: RuntimeStreamingTool[];
}

export interface RuntimeCheckpoint {
	protocolVersion: 2;
	cursor: StreamCursor;
	revision: number;
	snapshot: RuntimeSnapshot;
	live: RuntimeLiveState;
}

export type RuntimeMetadataPatch = Partial<
	Omit<RuntimeSnapshot, 'runtimeId' | 'project' | 'sessionId' | 'items'>
>;

type Revisioned = { baseRevision: number; revision: number };

export type RuntimeMutation =
	| { type: 'items_appended'; afterId?: string; items: ChatItem[] }
	| { type: 'item_updated'; item: ChatItem }
	| { type: 'items_replaced'; items: ChatItem[]; reason: 'branch' | 'compaction' | 'recovery' }
	| { type: 'metadata_updated'; patch: RuntimeMetadataPatch }
	| { type: 'assistant_delta'; text?: string; thinking?: string }
	| {
			type: 'tool_update';
			toolCallId: string;
			toolName: string;
			status: ToolStatus;
			arguments?: string;
			text?: string;
	  }
	| { type: 'permission_request'; request: PermissionRequest }
	| { type: 'permission_resolved'; requestId: string };

export type RevisionedRuntimeEvent = RuntimeMutation & Revisioned;
export type RuntimeEvent =
	RevisionedRuntimeEvent | { type: 'notice'; message: string } | { type: 'error'; message: string };

export interface StreamEnvelope {
	/** Opaque SSE ID in `epoch:sequence` form. */
	id: string;
	cursor: StreamCursor;
	runtimeId: string;
	event: RuntimeEvent;
}

export interface ResetRequired {
	type: 'reset_required';
	reason: 'expired_cursor' | 'foreign_epoch';
	cursor: StreamCursor;
}

export type StreamMessage = StreamEnvelope | ResetRequired;

/** Result returned after a prompt has been accepted by a runtime. */
export interface PromptRuntimeResult {
	queued: boolean;
	userMessageText?: string;
}

export type PermissionResponse =
	| { requestId: string; value: string }
	| { requestId: string; confirmed: boolean }
	| { requestId: string; cancelled: true };

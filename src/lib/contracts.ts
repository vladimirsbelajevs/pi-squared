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

/** An attachment submitted from the browser, including base64-encoded file bytes. */
export interface PromptAttachment {
	id: string;
	kind: ChatAttachmentKind;
	name: string;
	mimeType: string;
	size: number;
	data: string;
}

/** Browser-safe attachment metadata, with image bytes when a preview is available. */
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

/** Cumulative token usage across every entry in a Pi session. */
export interface SessionTokenUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
}

/** Current prompt-context occupancy, which may be unknown just after compaction. */
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
}

/** Result returned after a prompt has been accepted by a runtime. */
export interface PromptRuntimeResult {
	queued: boolean;
	/** User-visible prompt text, omitted when a command needs no prompt. */
	userMessageText?: string;
}

export interface PermissionRequest {
	id: string;
	method: 'select' | 'confirm' | 'input';
	title: string;
	message?: string;
	options?: string[];
	placeholder?: string;
}

export type PermissionResponse =
	| { requestId: string; value: string }
	| { requestId: string; confirmed: boolean }
	| { requestId: string; cancelled: true };

export type RuntimeEvent =
	| { type: 'snapshot'; snapshot: RuntimeSnapshot }
	| { type: 'assistant_delta'; text?: string; thinking?: string }
	| {
			type: 'tool_update';
			toolCallId: string;
			toolName: string;
			text: string;
			isError?: boolean;
	  }
	| { type: 'state'; isStreaming: boolean }
	| { type: 'mcp_status'; mcpStatus: McpStatusSnapshot }
	| { type: 'notice'; message: string }
	| { type: 'permission_request'; request: PermissionRequest }
	| { type: 'permission_resolved'; requestId: string }
	| { type: 'error'; message: string };

export interface StreamEnvelope {
	id: number;
	runtimeId: string;
	event: RuntimeEvent;
}

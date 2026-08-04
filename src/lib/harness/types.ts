import type { RuntimeConversationState } from '$lib/harness/runtime-state';
import type {
	ChatAttachment,
	ModelOption,
	PermissionRequest,
	RuntimeSnapshot,
	StreamEnvelope,
	ThinkingLevel,
	ToolStatus
} from '$lib/contracts';

export type Theme =
	| 'graphite'
	| 'paper'
	| 'nord'
	| 'solarized'
	| 'tokyonight-night'
	| 'tokyonight-storm'
	| 'tokyonight-moon'
	| 'tokyonight-day'
	| 'everforest-dark-hard'
	| 'everforest-dark-medium'
	| 'everforest-dark-soft'
	| 'everforest-light-hard'
	| 'everforest-light-medium'
	| 'everforest-light-soft'
	| 'system';
export type QueueMode = 'followUp' | 'steer';

export interface NewDraft {
	projectId: string;
	modelKey: string;
	thinkingLevel: ThinkingLevel;
	prompt: string;
}

export interface NewTab {
	id: string;
	kind: 'new';
	title: string;
	draft: NewDraft;
	addingProject: boolean;
	projectPath: string;
	projectName: string;
	projectError?: string;
}

export interface StreamingTool {
	id: string;
	name: string;
	/** Status is optional only for persisted local state created before tool lifecycle events existed. */
	status?: ToolStatus;
	arguments?: string;
	text?: string;
}

export interface TransientNotice {
	id: string;
	message: string;
}

export interface PendingPermission extends PermissionRequest {
	responding?: boolean;
	error?: string;
}

/** A submitted user message that has not appeared in an authoritative runtime snapshot yet. */
export interface PendingUserMessage {
	/** UI-only ID, kept separate from Pi's authoritative entry IDs. */
	id: string;
	text: string;
	attachments: ChatAttachment[];
	timestamp: string;
	/** User entry IDs already observed when this prompt was submitted. */
	knownUserItemIds: string[];
}

export type ChatHydrationState = 'unhydrated' | 'hydrating' | 'ready' | 'failed';

export interface ChatTab {
	id: string;
	kind: 'chat';
	title: string;
	projectId: string;
	sessionId: string;
	runtimeId?: string;
	snapshot?: RuntimeSnapshot;
	/** Normalized protocol authority; snapshot is a read-only compatibility projection. */
	runtime?: RuntimeConversationState;
	/** Runtime hydration is deferred until this chat is routed to. */
	hydrationState: ChatHydrationState;
	/** Invalidates stale async hydration completions. Runtime-only and never persisted. */
	hydrationGeneration: number;
	/** Bounded SSE replay buffer used only while a checkpoint is being fetched. */
	bufferedEvents: StreamEnvelope[];
	/** A buffer overflow requires another checkpoint before this chat can become ready. */
	needsCheckpoint: boolean;
	draft: string;
	queueMode: QueueMode;
	streamText: string;
	/** Recent throttled Markdown preview of streamText; transient and never persisted. */
	streamRenderedText: string;
	streamThinking: string;
	streamTools: StreamingTool[];
	/** Key-scoped reactive lookup for finalized tool groups. Runtime-only and never persisted. */
	streamToolsByCallId?: Map<string, StreamingTool>;
	transientNotices: TransientNotice[];
	permissionRequests: PendingPermission[];
	/** Runtime-only optimistic messages. Never persisted in StoredWorkspaceV1. */
	pendingUserMessages: PendingUserMessage[];
	error?: string;
}

export type WorkspaceTab = NewTab | ChatTab;

export interface StoredWorkspaceV1 {
	version: 1;
	activeTabId?: string;
	tabs: Array<StoredNewTab | StoredChatTab>;
}

export interface StoredNewTab {
	kind: 'new';
	id: string;
	title: string;
	draft: NewDraft;
}

export interface StoredChatTab {
	kind: 'chat';
	id: string;
	title: string;
	projectId: string;
	sessionId: string;
	runtimeId?: string;
	draft: string;
	queueMode: QueueMode;
}

export function modelKey(model: Pick<ModelOption, 'provider' | 'id'>): string {
	return `${model.provider}::${model.id}`;
}

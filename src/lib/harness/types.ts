import type {
	ChatAttachment,
	ModelOption,
	PermissionRequest,
	RuntimeSnapshot,
	ThinkingLevel
} from '$lib/contracts';

export type Theme =
	| 'graphite'
	| 'paper'
	| 'nord'
	| 'solarized'
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
	error?: string;
}

export interface StreamingTool {
	id: string;
	name: string;
	text: string;
	isError?: boolean;
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

export interface ChatTab {
	id: string;
	kind: 'chat';
	title: string;
	projectId: string;
	sessionId: string;
	runtimeId?: string;
	snapshot?: RuntimeSnapshot;
	hydrating: boolean;
	draft: string;
	queueMode: QueueMode;
	streamText: string;
	streamThinking: string;
	streamTools: StreamingTool[];
	transientNotices: TransientNotice[];
	permissionRequests: PendingPermission[];
	/** Runtime-only optimistic messages. Never persisted in StoredWorkspaceV1. */
	pendingUserMessages: PendingUserMessage[];
	error?: string;
}

export type WorkspaceTab = NewTab | ChatTab;

export interface StoredWorkspaceV1 {
	version: 1;
	lastEventId?: number;
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

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface Project {
	id: string;
	name: string;
	cwd: string;
	addedAt: string;
	lastOpenedAt: string;
}

export interface ModelOption {
	provider: string;
	id: string;
	name: string;
	reasoning: boolean;
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
	thinking?: string;
	toolCalls?: ChatToolCall[];
	isError?: boolean;
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
	modelFallbackMessage?: string;
}

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
	| { type: 'notice'; message: string }
	| { type: 'error'; message: string };

export interface StreamEnvelope {
	id: number;
	runtimeId: string;
	event: RuntimeEvent;
}

import type { StreamingTool } from '$lib/harness/types';

export type StreamUpdateTarget = {
	id: string;
	streamText: string;
	streamThinking: string;
	streamTools: StreamingTool[];
};

type PendingStreamUpdate = {
	chat: StreamUpdateTarget;
	text: string;
	thinking: string;
	tools: Map<string, StreamingTool>;
};

type FrameScheduler = (callback: FrameRequestCallback) => number;

/** Coalesces display-only stream mutations until the next animation frame. */
export class StreamUpdateBatcher {
	#pending = new Map<string, PendingStreamUpdate>();
	#frame: number | undefined;

	constructor(
		private readonly scheduleFrame: FrameScheduler = requestAnimationFrame,
		private readonly onFlush: () => void = () => undefined
	) {}

	queueAssistantDelta(chat: StreamUpdateTarget, text: string, thinking: string): void {
		const pending = this.#pendingFor(chat);
		pending.text += text;
		pending.thinking += thinking;
		this.#scheduleFlush();
	}

	queueToolUpdate(chat: StreamUpdateTarget, tool: StreamingTool): void {
		this.#pendingFor(chat).tools.set(tool.id, tool);
		this.#scheduleFlush();
	}

	discard(chatId: string): void {
		this.#pending.delete(chatId);
	}

	discardAll(): void {
		this.#pending.clear();
	}

	#pendingFor(chat: StreamUpdateTarget): PendingStreamUpdate {
		let pending = this.#pending.get(chat.id);
		if (!pending) {
			pending = { chat, text: '', thinking: '', tools: new Map() };
			this.#pending.set(chat.id, pending);
		}

		return pending;
	}

	#scheduleFlush(): void {
		if (this.#frame !== undefined) {
			return;
		}

		this.#frame = this.scheduleFrame(() => {
			this.#frame = undefined;
			if (!this.#pending.size) {
				return;
			}

			for (const pending of this.#pending.values()) {
				pending.chat.streamText += pending.text;
				pending.chat.streamThinking += pending.thinking;
				for (const tool of pending.tools.values()) {
					const current = pending.chat.streamTools.find((candidate) => candidate.id === tool.id);
					if (current) {
						current.name = tool.name;
						current.text = tool.text;
						current.isError = tool.isError;
					} else {
						pending.chat.streamTools.push(tool);
					}
				}
			}

			this.#pending.clear();
			this.onFlush();
		});
	}
}

import type { StreamingTool } from '$lib/harness/types';
import { mergeStreamingTool } from '$lib/harness/streaming-tools';

export const STREAM_RENDER_THROTTLE_MS = 100;

export type StreamUpdateTarget = {
	id: string;
	streamText: string;
	streamRenderedText: string;
	streamThinking: string;
	streamTools: StreamingTool[];
	streamToolsByCallId?: Map<string, StreamingTool>;
};

type PendingStreamUpdate = {
	chat: StreamUpdateTarget;
	text: string;
	thinking: string;
	tools: Map<string, StreamingTool>;
};

type PendingPreview = {
	chat: StreamUpdateTarget;
	handle?: ReturnType<typeof setTimeout>;
};

type FrameScheduler = (callback: FrameRequestCallback) => number;
type TimeoutScheduler = (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
type TimeoutCanceller = (handle: ReturnType<typeof setTimeout>) => void;

/** Coalesces display-only stream mutations until the next animation frame. */
export class StreamUpdateBatcher {
	#pending = new Map<string, PendingStreamUpdate>();
	#previewTimers = new Map<string, PendingPreview>();
	#frame: number | undefined;

	constructor(
		private readonly scheduleFrame: FrameScheduler = (callback) => requestAnimationFrame(callback),
		private readonly scheduleTimeout: TimeoutScheduler = (callback, delay) =>
			setTimeout(callback, delay),
		private readonly clearScheduledTimeout: TimeoutCanceller = (handle) => clearTimeout(handle)
	) {}

	queueAssistantDelta(chat: StreamUpdateTarget, text: string, thinking: string): void {
		const pending = this.#pendingFor(chat);
		pending.text += text;
		pending.thinking += thinking;
		this.#scheduleFlush();
	}

	queueToolUpdate(chat: StreamUpdateTarget, tool: StreamingTool): void {
		const pending = this.#pendingFor(chat);
		pending.tools.set(tool.id, mergeStreamingTool(pending.tools.get(tool.id), tool));
		this.#scheduleFlush();
	}

	/** Commits pending SSE updates before an SSE snapshot applies its lifecycle boundary. */
	flush(chatId: string): void {
		const pending = this.#pending.get(chatId);
		if (!pending) {
			return;
		}

		this.#commit(pending);
		this.#pending.delete(chatId);
	}

	discard(chatId: string): void {
		this.#pending.delete(chatId);
		this.#discardPreview(chatId);
	}

	discardAll(): void {
		this.#pending.clear();
		for (const chatId of this.#previewTimers.keys()) {
			this.#discardPreview(chatId);
		}
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
				this.#commit(pending);
			}

			this.#pending.clear();
		});
	}

	#commit(pending: PendingStreamUpdate): void {
		const hadStreamText = pending.chat.streamText.length > 0;
		pending.chat.streamText += pending.text;
		pending.chat.streamThinking += pending.thinking;
		for (const tool of pending.tools.values()) {
			const index = pending.chat.streamTools.findIndex((candidate) => candidate.id === tool.id);
			if (index >= 0) {
				const existing = pending.chat.streamTools[index];
				Object.assign(existing, mergeStreamingTool(existing, tool));
				pending.chat.streamToolsByCallId?.set(tool.id, existing);
			} else {
				pending.chat.streamTools.push(tool);
				pending.chat.streamToolsByCallId?.set(tool.id, tool);
			}
		}

		if (pending.text && !hadStreamText && pending.chat.streamText) {
			pending.chat.streamRenderedText = pending.chat.streamText;
		} else if (pending.text) {
			this.#schedulePreview(pending.chat);
		}
	}

	#schedulePreview(chat: StreamUpdateTarget): void {
		if (this.#previewTimers.has(chat.id)) {
			return;
		}

		const pendingPreview: PendingPreview = { chat };
		this.#previewTimers.set(chat.id, pendingPreview);
		pendingPreview.handle = this.scheduleTimeout(() => {
			if (this.#previewTimers.get(chat.id) !== pendingPreview) {
				return;
			}

			this.#previewTimers.delete(chat.id);
			chat.streamRenderedText = chat.streamText;
		}, STREAM_RENDER_THROTTLE_MS);
	}

	#discardPreview(chatId: string): void {
		const pendingPreview = this.#previewTimers.get(chatId);
		if (!pendingPreview) {
			return;
		}

		this.#previewTimers.delete(chatId);
		if (pendingPreview.handle !== undefined) {
			this.clearScheduledTimeout(pendingPreview.handle);
		}
	}
}

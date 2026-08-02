import type { RuntimeMutation } from '$lib/contracts';

type AssistantDelta = Extract<RuntimeMutation, { type: 'assistant_delta' }>;
type Timer = ReturnType<typeof setTimeout>;

export interface AssistantDeltaBatcherTimers {
	setTimeout(callback: () => void, delay: number): Timer;
	clearTimeout(timer: Timer): void;
}

const defaultTimers: AssistantDeltaBatcherTimers = {
	setTimeout: (callback, delay) => setTimeout(callback, delay),
	clearTimeout: (timer) => clearTimeout(timer)
};

/** Coalesces one runtime's append-only assistant output into short transport batches. */
export class AssistantDeltaBatcher {
	#text = '';
	#thinking = '';
	#timer: Timer | undefined;

	constructor(
		private readonly publish: (event: AssistantDelta) => void,
		private readonly timers: AssistantDeltaBatcherTimers = defaultTimers,
		private readonly delay = 25
	) {}

	queue(delta: Pick<AssistantDelta, 'text' | 'thinking'>): void {
		if (delta.text) {
			this.#text += delta.text;
		}

		if (delta.thinking) {
			this.#thinking += delta.thinking;
		}

		if (!this.#hasPending() || this.#timer !== undefined) {
			return;
		}

		this.#timer = this.timers.setTimeout(() => {
			this.#timer = undefined;
			this.flush();
		}, this.delay);
	}

	flush(): void {
		this.#clearTimer();
		if (!this.#hasPending()) {
			return;
		}

		const event: AssistantDelta = {
			type: 'assistant_delta',
			...(this.#text ? { text: this.#text } : {}),
			...(this.#thinking ? { thinking: this.#thinking } : {})
		};
		this.#text = '';
		this.#thinking = '';
		this.publish(event);
	}

	cancel(): void {
		this.#clearTimer();
		this.#text = '';
		this.#thinking = '';
	}

	#hasPending(): boolean {
		return Boolean(this.#text || this.#thinking);
	}

	#clearTimer(): void {
		if (this.#timer !== undefined) {
			this.timers.clearTimeout(this.#timer);
			this.#timer = undefined;
		}
	}
}

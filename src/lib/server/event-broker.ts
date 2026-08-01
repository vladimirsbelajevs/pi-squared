import type { RuntimeEvent, StreamEnvelope } from '$lib/contracts';

const REPLAY_LIMIT = 300;

class EventBroker {
	#nextId = 1;
	#replay: StreamEnvelope[] = [];
	#listeners = new Set<(event: StreamEnvelope) => void>();

	publish(runtimeId: string, event: RuntimeEvent): void {
		const envelope: StreamEnvelope = { id: this.#nextId++, runtimeId, event };
		this.#replay.push(envelope);
		if (this.#replay.length > REPLAY_LIMIT) {
			this.#replay.shift();
		}

		for (const listener of this.#listeners) {
			listener(envelope);
		}
	}

	subscribe(
		lastEventId: number | undefined,
		listener: (event: StreamEnvelope) => void
	): () => void {
		if (lastEventId !== undefined) {
			for (const event of this.#replay) {
				if (event.id > lastEventId) {
					listener(event);
				}
			}
		}

		this.#listeners.add(listener);

		return () => this.#listeners.delete(listener);
	}
}

export const eventBroker = new EventBroker();

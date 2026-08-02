import { randomUUID } from 'node:crypto';
import type { ResetRequired, RuntimeEvent, StreamCursor, StreamEnvelope } from '$lib/contracts';

const REPLAY_LIMIT = 300;

export function cursorId(cursor: StreamCursor): string {
	return `${cursor.epoch}:${cursor.sequence}`;
}

export function parseCursor(value: string | undefined): StreamCursor | undefined {
	if (!value) {
		return undefined;
	}

	const separator = value.lastIndexOf(':');
	const epoch = value.slice(0, separator);
	const sequence = Number(value.slice(separator + 1));

	return epoch && Number.isSafeInteger(sequence) && sequence >= 0 ? { epoch, sequence } : undefined;
}

/**
 * Process-local ordered SSE broker. A cursor from another process or before the
 * retained replay window explicitly requests a checkpoint instead of silently
 * applying an incomplete suffix.
 */
export class EventBroker {
	readonly epoch = randomUUID();
	#sequence = 0;
	#replay: StreamEnvelope[] = [];
	#listeners = new Set<(event: StreamEnvelope) => void>();

	currentCursor(): StreamCursor {
		return { epoch: this.epoch, sequence: this.#sequence };
	}

	publish(runtimeId: string, event: RuntimeEvent): StreamEnvelope {
		const cursor = { epoch: this.epoch, sequence: ++this.#sequence };
		const envelope: StreamEnvelope = { id: cursorId(cursor), cursor, runtimeId, event };
		this.#replay.push(envelope);
		if (this.#replay.length > REPLAY_LIMIT) {
			this.#replay.shift();
		}

		for (const listener of this.#listeners) {
			listener(envelope);
		}

		return envelope;
	}

	subscribe(
		lastEventId: string | undefined,
		listener: (event: StreamEnvelope) => void,
		onReset?: (control: ResetRequired) => void
	): () => void {
		const cursor = parseCursor(lastEventId);
		this.#listeners.add(listener);

		if (lastEventId && !cursor) {
			onReset?.({ type: 'reset_required', reason: 'foreign_epoch', cursor: this.currentCursor() });
		} else if (cursor && cursor.epoch !== this.epoch) {
			onReset?.({ type: 'reset_required', reason: 'foreign_epoch', cursor: this.currentCursor() });
		} else if (cursor) {
			const oldest = this.#replay[0]?.cursor.sequence;
			if (oldest !== undefined && cursor.sequence < oldest - 1) {
				onReset?.({
					type: 'reset_required',
					reason: 'expired_cursor',
					cursor: this.currentCursor()
				});
			} else {
				for (const event of this.#replay) {
					if (event.cursor.sequence > cursor.sequence) {
						listener(event);
					}
				}
			}
		}

		return () => this.#listeners.delete(listener);
	}
}

export const eventBroker = new EventBroker();

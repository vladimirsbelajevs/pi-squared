import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeEvent } from '$lib/contracts';
import { AssistantDeltaBatcher } from './assistant-delta-batcher';
import { EventBroker } from './event-broker';

afterEach(() => vi.useRealTimers());

describe('AssistantDeltaBatcher', () => {
	it('combines text and thinking deltas received in one 25 ms window', () => {
		vi.useFakeTimers();
		const publish = vi.fn();
		const batcher = new AssistantDeltaBatcher(publish);
		batcher.queue({ text: 'Hel' });
		batcher.queue({ thinking: 'Reason' });
		batcher.queue({ text: 'lo', thinking: 'ing' });
		vi.advanceTimersByTime(25);
		expect(publish).toHaveBeenCalledExactlyOnceWith({
			type: 'assistant_delta',
			text: 'Hello',
			thinking: 'Reasoning'
		});
	});

	it('flushes at a causal boundary without a duplicate timer', () => {
		vi.useFakeTimers();
		const publish = vi.fn();
		const batcher = new AssistantDeltaBatcher(publish);
		batcher.queue({ text: 'before boundary' });
		batcher.flush();
		vi.advanceTimersByTime(25);
		expect(publish).toHaveBeenCalledExactlyOnceWith({
			type: 'assistant_delta',
			text: 'before boundary'
		});
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('EventBroker protocol v2', () => {
	function stateEvent(): RuntimeEvent {
		return { type: 'metadata_updated', patch: { isStreaming: true }, baseRevision: 0, revision: 1 };
	}

	it('uses epoch-qualified, monotonic opaque IDs and exact replay', () => {
		const broker = new EventBroker();
		const first = broker.publish('runtime-1', stateEvent());
		const second = broker.publish('runtime-1', stateEvent());
		expect(first.cursor.epoch).toBe(second.cursor.epoch);
		expect(second.cursor.sequence).toBe(first.cursor.sequence + 1);
		const replayed: string[] = [];
		broker.subscribe(first.id, (event) => replayed.push(event.id));
		expect(replayed).toEqual([second.id]);
	});

	it('requests reset for a foreign or expired cursor', () => {
		const broker = new EventBroker();
		const resets: string[] = [];
		broker.subscribe(
			'previous-process:3',
			() => undefined,
			(reset) => resets.push(reset.reason)
		);
		for (let index = 0; index < 301; index += 1) {
			broker.publish('runtime-1', stateEvent());
		}

		broker.subscribe(
			`${broker.epoch}:0`,
			() => undefined,
			(reset) => resets.push(reset.reason)
		);
		expect(resets).toEqual(['foreign_epoch', 'expired_cursor']);
	});

	it('registers the listener before replay so synchronous publishes are not lost', () => {
		const broker = new EventBroker();
		const first = broker.publish('runtime-1', stateEvent());
		const received: string[] = [];
		broker.subscribe(first.id, (event) => received.push(event.id));
		const next = broker.publish('runtime-1', stateEvent());
		expect(received).toEqual([next.id]);
	});
});

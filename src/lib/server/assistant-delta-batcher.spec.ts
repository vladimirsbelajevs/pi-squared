import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeEvent, StreamEnvelope } from '$lib/contracts';
import { AssistantDeltaBatcher } from './assistant-delta-batcher';
import { EventBroker } from './event-broker';
import { publishRuntimeEvent } from './runtimes';

afterEach(() => {
	vi.useRealTimers();
});

describe('AssistantDeltaBatcher', () => {
	it('combines text and thinking deltas received in one 25 ms window', () => {
		vi.useFakeTimers();
		const publish = vi.fn();
		const batcher = new AssistantDeltaBatcher(publish);

		batcher.queue({ text: 'Hel' });
		batcher.queue({ thinking: 'Reason' });
		batcher.queue({ text: 'lo', thinking: 'ing' });
		vi.advanceTimersByTime(24);
		expect(publish).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(publish).toHaveBeenCalledExactlyOnceWith({
			type: 'assistant_delta',
			text: 'Hello',
			thinking: 'Reasoning'
		});
	});

	it('flushes immediately at a boundary and does not leave a duplicate timer publish', () => {
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

	it('cancels pending output without publishing it', () => {
		vi.useFakeTimers();
		const publish = vi.fn();
		const batcher = new AssistantDeltaBatcher(publish);

		batcher.queue({ text: 'discard me' });
		batcher.cancel();
		vi.advanceTimersByTime(25);
		batcher.flush();

		expect(publish).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('assistant delta broker integration', () => {
	it('assigns ordered broker IDs when a boundary flushes a runtime batch', () => {
		const broker = new EventBroker();
		const events: StreamEnvelope[] = [];
		broker.subscribe(undefined, (event) => events.push(event));
		const batcher = new AssistantDeltaBatcher((event) => broker.publish('runtime-1', event));
		const record = { id: 'runtime-1', assistantDeltaBatcher: batcher };

		publishRuntimeEvent(record, { type: 'assistant_delta', text: 'first' }, broker);
		publishRuntimeEvent(record, { type: 'state', isStreaming: false }, broker);

		expect(events).toEqual([
			{ id: 1, runtimeId: 'runtime-1', event: { type: 'assistant_delta', text: 'first' } },
			{ id: 2, runtimeId: 'runtime-1', event: { type: 'state', isStreaming: false } }
		]);
	});

	it('never merges output from separate runtime batchers', () => {
		const broker = new EventBroker();
		const events: StreamEnvelope[] = [];
		broker.subscribe(undefined, (event) => events.push(event));
		const first = new AssistantDeltaBatcher((event) => broker.publish('runtime-1', event));
		const second = new AssistantDeltaBatcher((event) => broker.publish('runtime-2', event));

		first.queue({ text: 'one' });
		second.queue({ thinking: 'two' });
		first.flush();
		second.flush();

		expect(events.map(({ runtimeId, event }) => ({ runtimeId, event }))).toEqual([
			{ runtimeId: 'runtime-1', event: { type: 'assistant_delta', text: 'one' } },
			{ runtimeId: 'runtime-2', event: { type: 'assistant_delta', thinking: 'two' } }
		]);
	});

	it('replays complete assistant batches after the requested event ID', () => {
		const broker = new EventBroker();
		broker.publish('runtime-1', { type: 'state', isStreaming: true });
		const batcher = new AssistantDeltaBatcher((event) => broker.publish('runtime-1', event));
		batcher.queue({ text: 'complete' });
		batcher.flush();
		const replayed: RuntimeEvent[] = [];

		broker.subscribe(1, (event) => replayed.push(event.event));

		expect(replayed).toEqual([{ type: 'assistant_delta', text: 'complete' }]);
	});
});

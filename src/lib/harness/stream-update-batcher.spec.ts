import { describe, expect, it } from 'vitest';
import { StreamUpdateBatcher, type StreamUpdateTarget } from './stream-update-batcher';

function chat(id: string): StreamUpdateTarget {
	return { id, streamText: '', streamThinking: '', streamTools: [] };
}

function createBatcher() {
	let frame: FrameRequestCallback | undefined;
	const onFlush = () => undefined;
	const batcher = new StreamUpdateBatcher((callback) => {
		frame = callback;

		return 1;
	}, onFlush);

	return {
		batcher,
		flushFrame: () => frame?.(0)
	};
}

describe('StreamUpdateBatcher', () => {
	it('concatenates text and thinking deltas in one animation-frame commit', () => {
		const { batcher, flushFrame } = createBatcher();
		const target = chat('chat-1');

		batcher.queueAssistantDelta(target, 'Hel', 'Reason');
		batcher.queueAssistantDelta(target, 'lo', 'ing');
		expect(target).toMatchObject({ streamText: '', streamThinking: '' });

		flushFrame();
		expect(target).toMatchObject({ streamText: 'Hello', streamThinking: 'Reasoning' });
	});

	it('keeps only the latest update for each tool until the frame', () => {
		const { batcher, flushFrame } = createBatcher();
		const target = chat('chat-1');

		batcher.queueToolUpdate(target, { id: 'read-1', name: 'read', text: 'Opening file' });
		batcher.queueToolUpdate(target, { id: 'read-1', name: 'read', text: 'Reading file' });
		batcher.queueToolUpdate(target, { id: 'write-1', name: 'write', text: 'Writing file' });
		flushFrame();

		expect(target.streamTools).toEqual([
			{ id: 'read-1', name: 'read', text: 'Reading file' },
			{ id: 'write-1', name: 'write', text: 'Writing file' }
		]);
	});

	it('makes a scheduled frame harmless when a snapshot discards its queued update', () => {
		const { batcher, flushFrame } = createBatcher();
		const target = chat('chat-1');

		batcher.queueAssistantDelta(target, 'stale', '');
		batcher.discard(target.id);
		flushFrame();

		expect(target.streamText).toBe('');
	});

	it('flushes independent chats in the same frame without mixing output', () => {
		const { batcher, flushFrame } = createBatcher();
		const first = chat('chat-1');
		const second = chat('chat-2');

		batcher.queueAssistantDelta(first, 'first', '');
		batcher.queueAssistantDelta(second, 'second', '');
		flushFrame();

		expect(first.streamText).toBe('first');
		expect(second.streamText).toBe('second');
	});

	it('discards queued updates when the connection is disposed', () => {
		const { batcher, flushFrame } = createBatcher();
		const target = chat('chat-1');

		batcher.queueAssistantDelta(target, 'disconnected', '');
		batcher.discardAll();
		flushFrame();

		expect(target.streamText).toBe('');
	});
});

import { describe, expect, it } from 'vitest';
import {
	STREAM_RENDER_THROTTLE_MS,
	StreamUpdateBatcher,
	type StreamUpdateTarget
} from './stream-update-batcher';

function chat(id: string): StreamUpdateTarget {
	return { id, streamText: '', streamRenderedText: '', streamThinking: '', streamTools: [] };
}

type FakeTimer = {
	callback: () => void;
	delay: number;
};

function createBatcher() {
	let frame: FrameRequestCallback | undefined;
	const timers: FakeTimer[] = [];
	const batcher = new StreamUpdateBatcher(
		(callback) => {
			frame = callback;

			return 1;
		},
		(callback, delay) => {
			const timer = { callback, delay };
			timers.push(timer);

			return timer as unknown as ReturnType<typeof setTimeout>;
		},
		(handle) => {
			const timer = handle as unknown as FakeTimer;
			const index = timers.indexOf(timer);
			if (index >= 0) {
				timers.splice(index, 1);
			}
		}
	);

	return {
		batcher,
		flushFrame: () => frame?.(0),
		flushPreview: () => {
			const timer = timers.shift();
			timer?.callback();
		},
		previewDelays: () => timers.map((timer) => timer.delay),
		pendingPreview: () => timers[0],
		pendingPreviews: () => [...timers]
	};
}

describe('StreamUpdateBatcher', () => {
	it('concatenates text and thinking deltas in one animation-frame commit', () => {
		const { batcher, flushFrame } = createBatcher();
		const target = chat('chat-1');

		batcher.queueAssistantDelta(target, 'Hel', 'Reason');
		batcher.queueAssistantDelta(target, 'lo', 'ing');
		expect(target).toMatchObject({ streamText: '', streamRenderedText: '', streamThinking: '' });

		flushFrame();
		expect(target).toMatchObject({
			streamText: 'Hello',
			streamRenderedText: 'Hello',
			streamThinking: 'Reasoning'
		});
	});

	it('throttles later preview snapshots while continuing to commit raw text', () => {
		const { batcher, flushFrame, flushPreview, previewDelays } = createBatcher();
		const target = chat('chat-1');

		batcher.queueAssistantDelta(target, 'A', '');
		flushFrame();
		expect(target).toMatchObject({ streamText: 'A', streamRenderedText: 'A' });

		batcher.queueAssistantDelta(target, 'B', '');
		flushFrame();
		expect(target).toMatchObject({ streamText: 'AB', streamRenderedText: 'A' });
		expect(previewDelays()).toEqual([STREAM_RENDER_THROTTLE_MS]);

		batcher.queueAssistantDelta(target, 'C', '');
		flushFrame();
		expect(target).toMatchObject({ streamText: 'ABC', streamRenderedText: 'A' });
		expect(previewDelays()).toHaveLength(1);

		flushPreview();
		expect(target.streamRenderedText).toBe('ABC');
	});

	it('keeps continuous output to one preview write per interval', () => {
		const { batcher, flushFrame, flushPreview, previewDelays } = createBatcher();
		const target = chat('chat-1');

		batcher.queueAssistantDelta(target, 'A', '');
		flushFrame();
		for (const text of ['B', 'C', 'D']) {
			batcher.queueAssistantDelta(target, text, '');
			flushFrame();
			expect(previewDelays()).toHaveLength(1);
		}

		expect(target.streamRenderedText).toBe('A');
		flushPreview();
		expect(target.streamRenderedText).toBe('ABCD');

		batcher.queueAssistantDelta(target, 'E', '');
		flushFrame();
		expect(target.streamRenderedText).toBe('ABCD');
		expect(previewDelays()).toHaveLength(1);
	});

	it('merges same-frame tool patches without losing arguments or terminal status', () => {
		const { batcher, flushFrame } = createBatcher();
		const target = chat('chat-1');

		batcher.queueToolUpdate(target, {
			id: 'read-1',
			name: 'read',
			status: 'running',
			arguments: '{"path":"README.md"}'
		});
		batcher.queueToolUpdate(target, {
			id: 'read-1',
			name: 'read',
			status: 'completed',
			text: 'file contents'
		});
		batcher.queueToolUpdate(target, {
			id: 'write-1',
			name: 'write',
			status: 'running',
			text: 'Writing file'
		});
		flushFrame();

		expect(target.streamTools).toEqual([
			{
				id: 'read-1',
				name: 'read',
				status: 'completed',
				arguments: '{"path":"README.md"}',
				text: 'file contents'
			},
			{ id: 'write-1', name: 'write', status: 'running', text: 'Writing file' }
		]);
	});

	it('preserves unrelated live tool identities when applying a patch', () => {
		const { batcher, flushFrame } = createBatcher();
		const target = chat('chat-1');
		target.streamTools = [
			{ id: 'read-1', name: 'read', status: 'running' },
			{ id: 'bash-1', name: 'bash', status: 'running', text: 'Running tests' }
		];
		const tools = target.streamTools;
		const unrelatedTool = target.streamTools[1];

		batcher.queueToolUpdate(target, {
			id: 'read-1',
			name: 'read',
			status: 'completed',
			text: 'README contents'
		});
		flushFrame();

		expect(target.streamTools).toBe(tools);
		expect(target.streamTools[1]).toBe(unrelatedTool);
		expect(target.streamTools[0]).toMatchObject({
			id: 'read-1',
			status: 'completed',
			text: 'README contents'
		});
	});

	it('flushes pending updates synchronously for an SSE snapshot boundary', () => {
		const { batcher } = createBatcher();
		const target = chat('chat-1');
		batcher.queueToolUpdate(target, { id: 'read-1', name: 'read', status: 'pending' });

		batcher.flush(target.id);

		expect(target.streamTools).toEqual([{ id: 'read-1', name: 'read', status: 'pending' }]);
	});

	it('makes scheduled frame and preview callbacks harmless when a snapshot discards its update', () => {
		const { batcher, flushFrame, flushPreview, pendingPreview } = createBatcher();
		const target = chat('chat-1');

		batcher.queueAssistantDelta(target, 'initial', '');
		flushFrame();
		batcher.queueAssistantDelta(target, 'stale', '');
		flushFrame();
		const stalePreview = pendingPreview()!;
		batcher.discard(target.id);
		stalePreview.callback();
		expect(target).toMatchObject({ streamText: 'initialstale', streamRenderedText: 'initial' });

		batcher.queueAssistantDelta(target, 'also stale', '');
		batcher.discard(target.id);
		flushFrame();
		expect(target.streamText).toBe('initialstale');
		flushPreview();
		expect(target.streamRenderedText).toBe('initial');
	});

	it('flushes separate chats without mixing raw or preview text', () => {
		const { batcher, flushFrame, flushPreview, previewDelays } = createBatcher();
		const first = chat('chat-1');
		const second = chat('chat-2');

		batcher.queueAssistantDelta(first, 'first', '');
		batcher.queueAssistantDelta(second, 'second', '');
		flushFrame();
		expect(first).toMatchObject({ streamText: 'first', streamRenderedText: 'first' });
		expect(second).toMatchObject({ streamText: 'second', streamRenderedText: 'second' });

		batcher.queueAssistantDelta(first, ' one', '');
		batcher.queueAssistantDelta(second, ' two', '');
		flushFrame();
		expect(previewDelays()).toHaveLength(2);
		flushPreview();
		flushPreview();
		expect(first.streamRenderedText).toBe('first one');
		expect(second.streamRenderedText).toBe('second two');
	});

	it('discards queued frames and preview callbacks for every chat', () => {
		const { batcher, flushFrame, pendingPreviews } = createBatcher();
		const first = chat('chat-1');
		const second = chat('chat-2');

		batcher.queueAssistantDelta(first, 'first', '');
		batcher.queueAssistantDelta(second, 'second', '');
		flushFrame();
		batcher.queueAssistantDelta(first, ' stale', '');
		batcher.queueAssistantDelta(second, ' stale', '');
		flushFrame();
		const stalePreviews = pendingPreviews();

		batcher.queueAssistantDelta(first, 'discarded', '');
		batcher.discardAll();
		flushFrame();
		for (const preview of stalePreviews) {
			preview.callback();
		}

		expect(first.streamText).toBe('first stale');
		expect(second.streamText).toBe('second stale');
		expect(first.streamRenderedText).toBe('first');
		expect(second.streamRenderedText).toBe('second');
	});
});

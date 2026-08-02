import { describe, expect, it } from 'vitest';
import {
	STREAM_RENDER_THROTTLE_MS,
	StreamUpdateBatcher,
	type StreamUpdateTarget
} from './stream-update-batcher';

function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe('StreamUpdateBatcher browser scheduling', () => {
	it('updates the throttled preview with native browser timers', async () => {
		const target: StreamUpdateTarget = {
			id: 'chat-1',
			streamText: '',
			streamRenderedText: '',
			streamThinking: '',
			streamTools: []
		};
		const batcher = new StreamUpdateBatcher();

		batcher.queueAssistantDelta(target, 'Initial', '');
		await nextFrame();
		expect(target.streamRenderedText).toBe('Initial');

		batcher.queueAssistantDelta(target, ' update', '');
		await nextFrame();
		expect(target.streamRenderedText).toBe('Initial');

		await new Promise((resolve) => setTimeout(resolve, STREAM_RENDER_THROTTLE_MS + 20));
		expect(target.streamRenderedText).toBe('Initial update');
	});
});

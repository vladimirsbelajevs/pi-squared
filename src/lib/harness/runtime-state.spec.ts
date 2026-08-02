import { describe, expect, it } from 'vitest';
import type { ChatItem, RuntimeCheckpoint, RuntimeEvent } from '$lib/contracts';

type AppendedEvent = Extract<RuntimeEvent, { type: 'items_appended' }>;
import { applyRuntimeEvent, snapshotFromState, stateFromCheckpoint } from './runtime-state';

const first: ChatItem = { id: 'one', kind: 'message', role: 'user', text: 'One' };
const checkpoint: RuntimeCheckpoint = {
	protocolVersion: 2,
	cursor: { epoch: 'test', sequence: 4 },
	revision: 4,
	snapshot: {
		runtimeId: 'runtime',
		project: { id: 'project', name: 'Project', cwd: '/tmp/project', addedAt: '', lastOpenedAt: '' },
		sessionId: 'session',
		thinkingLevel: 'medium',
		isStreaming: true,
		items: [first],
		permissionRequests: []
	},
	live: { text: 'partial', thinking: '', tools: [] }
};

function append(item: ChatItem): AppendedEvent {
	return { type: 'items_appended', afterId: 'one', items: [item], baseRevision: 4, revision: 5 };
}

describe('runtime-state', () => {
	it('preserves unaffected item references during an append', () => {
		const state = stateFromCheckpoint(checkpoint);
		const second = { id: 'two', kind: 'message' as const, role: 'assistant' as const, text: 'Two' };
		expect(applyRuntimeEvent(state, append(second))).toBe('applied');
		expect(snapshotFromState(state).items).toEqual([first, second]);
		expect(snapshotFromState(state).items[0]).toBe(first);
	});

	it('ignores duplicate revisions and requests recovery for a gap', () => {
		const state = stateFromCheckpoint(checkpoint);
		expect(
			applyRuntimeEvent(state, {
				...append({ id: 'two', kind: 'message', text: 'Two' }),
				revision: 4
			})
		).toBe('duplicate');
		expect(
			applyRuntimeEvent(state, {
				...append({ id: 'two', kind: 'message', text: 'Two' }),
				baseRevision: 6,
				revision: 7
			})
		).toBe('recovery');
		expect(state.recovering).toBe(true);
	});

	it('reuses equal checkpoint items while restoring the full live prefix', () => {
		const previous = stateFromCheckpoint(checkpoint);
		const restored = stateFromCheckpoint(
			{ ...checkpoint, live: { text: 'complete prefix', thinking: 'reasoning', tools: [] } },
			previous
		);
		expect(restored.itemsById.get('one')).toBe(previous.itemsById.get('one'));
		expect(restored.live).toEqual({ text: 'complete prefix', thinking: 'reasoning', tools: [] });
	});
});

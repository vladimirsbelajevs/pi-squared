import { describe, expect, it } from 'vitest';
import { mergeStreamingTool } from './streaming-tools';

describe('mergeStreamingTool', () => {
	it('preserves arguments and terminal status across ordered patches', () => {
		const started = mergeStreamingTool(undefined, {
			id: 'read-1',
			name: 'read',
			status: 'running',
			arguments: '{\n  "path": "README.md"\n}'
		});
		const completed = mergeStreamingTool(started, {
			id: 'read-1',
			name: 'read',
			status: 'completed',
			text: 'contents'
		});
		const lateUpdate = mergeStreamingTool(completed, {
			id: 'read-1',
			name: 'read',
			status: 'running',
			text: 'stale'
		});

		expect(lateUpdate).toEqual({
			id: 'read-1',
			name: 'read',
			status: 'completed',
			arguments: '{\n  "path": "README.md"\n}',
			text: 'stale'
		});
	});

	it('keeps different tool IDs isolated when each is merged independently', () => {
		const first = mergeStreamingTool(undefined, {
			id: 'read-1',
			name: 'read',
			status: 'running',
			arguments: '{"path":"a"}'
		});
		const second = mergeStreamingTool(undefined, {
			id: 'bash-1',
			name: 'bash',
			status: 'failed',
			text: 'exit 1'
		});

		expect(first).toMatchObject({ id: 'read-1', arguments: '{"path":"a"}' });
		expect(second).toMatchObject({ id: 'bash-1', status: 'failed', text: 'exit 1' });
	});
});

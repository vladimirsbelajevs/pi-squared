import { describe, expect, it } from 'vitest';
import type { SubagentRun } from '$lib/contracts';
import { shouldContinueSubagentPolling } from './timeline';

function run(overrides: Partial<SubagentRun> = {}): SubagentRun {
	return {
		runId: 'run-1',
		childId: 'index-0',
		toolCallId: 'tool-1',
		agent: 'worker',
		status: 'running',
		...overrides
	};
}

describe('subagent polling projection', () => {
	it('keeps polling after an empty persistence response while a local launch is running', () => {
		const inferred = run({ runId: 'tool-1' });

		expect(shouldContinueSubagentPolling([], [inferred], [inferred])).toBe(true);
	});

	it('keeps polling for an inferred launch not present in a partial server response', () => {
		const persisted = run({ toolCallId: 'tool-1', status: 'completed' });
		const inferred = run({ toolCallId: 'tool-2', runId: 'tool-2' });

		expect(shouldContinueSubagentPolling([persisted], [persisted], [inferred])).toBe(true);
	});

	it('stops when the server terminalizes the same inferred launch', () => {
		const terminal = run({ status: 'failed' });
		const inferred = run();

		expect(shouldContinueSubagentPolling([terminal], [terminal], [inferred])).toBe(false);
	});

	it('does not retry after an error when no local running projection remains', () => {
		expect(shouldContinueSubagentPolling(undefined, [run({ status: 'completed' })], [run()])).toBe(
			false
		);
	});
});

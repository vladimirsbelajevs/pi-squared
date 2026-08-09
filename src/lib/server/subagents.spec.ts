import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionEntry, SessionInfo } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatItem, Project } from '$lib/contracts';
import {
	deriveSubagentRunsFromEntries,
	parseSubagentSessionName,
	parseSubagentToolLaunch,
	sliceSubagentTimeline
} from './subagents';

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

const parent: SessionInfo = {
	path: '/tmp/project/parent.jsonl',
	id: 'parent-id',
	cwd: '/tmp/project',
	created: new Date('2026-01-01T00:00:00.000Z'),
	modified: new Date('2026-01-01T00:00:00.000Z'),
	messageCount: 1,
	firstMessage: 'delegate',
	allMessagesText: 'delegate'
};

function call(
	id: string,
	argumentsValue: Record<string, unknown>,
	result?: Record<string, unknown>
): SessionEntry[] {
	return [
		{
			type: 'message',
			id: `assistant-${id}`,
			parentId: null,
			timestamp: '2026-01-01T00:00:00.000Z',
			message: {
				role: 'assistant',
				content: [{ type: 'toolCall', id, name: 'subagent', arguments: argumentsValue }]
			}
		} as never,
		...(result
			? [
					{
						type: 'message',
						id: `result-${id}`,
						parentId: `assistant-${id}`,
						timestamp: '2026-01-01T00:00:01.000Z',
						message: {
							role: 'toolResult',
							toolCallId: id,
							content: [{ type: 'text', text: 'done' }],
							details: result.details,
							isError: result.isError === true
						}
					} as never
				]
			: [])
	];
}

function session(name: string, id: string, parentSessionPath = parent.path): SessionInfo {
	return {
		...parent,
		id,
		path: `/tmp/project/${id}.jsonl`,
		name,
		parentSessionPath
	};
}

function temporaryProject(): { project: Project; parent: SessionInfo; asyncRoot: string } {
	const root = mkdtempSync(join(tmpdir(), 'pi-squared-subagent-status-'));
	temporaryRoots.push(root);
	const projectRoot = join(root, 'project');
	const asyncRoot = join(projectRoot, '.pi-subagents', 'async-subagent-runs');
	mkdirSync(asyncRoot, { recursive: true });
	const project: Project = {
		id: 'project-status-test',
		name: 'Status test',
		cwd: projectRoot,
		addedAt: '',
		lastOpenedAt: ''
	};
	const projectParent: SessionInfo = {
		...parent,
		cwd: projectRoot,
		path: join(projectRoot, 'parent.jsonl')
	};

	return { project, parent: projectParent, asyncRoot };
}

function writeAsyncStatus(
	asyncRoot: string,
	runId: string,
	status: Record<string, unknown>,
	asyncDir = join(asyncRoot, runId)
): string {
	mkdirSync(asyncDir, { recursive: true });
	writeFileSync(join(asyncDir, 'status.json'), JSON.stringify(status));

	return asyncDir;
}

describe('subagent parser', () => {
	it('recognizes legacy and UUID generated names', () => {
		expect(parseSubagentSessionName('subagent-scout-436062b1-1')).toEqual({
			agent: 'scout',
			runId: '436062b1',
			index: 1
		});
		expect(
			parseSubagentSessionName('subagent-luna-developer-7925e6e7-2215-40f5-9161-213c89434d19')
		).toEqual({
			agent: 'luna-developer',
			runId: '7925e6e7-2215-40f5-9161-213c89434d19'
		});
		expect(parseSubagentSessionName('subagent notes')).toBeUndefined();
	});

	it('recognizes launches but excludes management calls', () => {
		expect(
			parseSubagentToolLaunch('tool-1', JSON.stringify({ agent: 'worker', task: 'Inspect' }))
		).toMatchObject({
			mode: 'single',
			children: [{ agent: 'worker', task: 'Inspect' }]
		});
		for (const action of ['list', 'status', 'doctor', 'wait', 'steer', 'resume', 'stop']) {
			expect(parseSubagentToolLaunch(`tool-${action}`, { action })).toBeUndefined();
		}
	});

	it('projects foreground completion and child session identity', () => {
		const child = session('subagent-worker-436062b1', 'child-1');
		const runs = deriveSubagentRunsFromEntries(
			call(
				'tool-1',
				{ agent: 'worker', task: 'Inspect' },
				{
					details: {
						mode: 'single',
						runId: '436062b1',
						results: [{ agent: 'worker', success: true, sessionFile: child.path }]
					}
				}
			),
			parent,
			[child]
		);
		expect(runs).toEqual([
			expect.objectContaining({
				runId: '436062b1',
				childId: 'index-0',
				toolCallId: 'tool-1',
				status: 'completed',
				childSessionId: 'child-1',
				timelineAvailable: true
			})
		]);
	});

	it('projects async and parallel children independently while they are active', () => {
		const asyncRuns = deriveSubagentRunsFromEntries(
			call(
				'tool-async',
				{ agent: 'worker', task: 'Inspect', async: true },
				{
					details: { mode: 'single', runId: 'async-1', asyncId: 'async-1', results: [] }
				}
			),
			parent
		);
		expect(asyncRuns).toHaveLength(1);
		expect(asyncRuns[0]).toMatchObject({ runId: 'async-1', status: 'running' });

		const parallelRuns = deriveSubagentRunsFromEntries(
			call(
				'tool-parallel',
				{
					tasks: [
						{ agent: 'scout', task: 'Find files' },
						{ agent: 'reviewer', task: 'Review files' }
					],
					async: true
				},
				{
					details: {
						mode: 'parallel',
						runId: 'parallel-1',
						results: [
							{ agent: 'scout', success: true },
							{ agent: 'reviewer', success: false, error: 'failed' }
						]
					}
				}
			),
			parent
		);
		expect(parallelRuns.map((run) => run.status)).toEqual(['completed', 'failed']);
		expect(new Set(parallelRuns.map((run) => run.childId)).size).toBe(2);
	});

	it('correlates persisted notify statuses and degrades malformed details safely', () => {
		const entries = [
			...call('tool-1', { agent: 'worker', task: 'Inspect', async: true }),
			{
				type: 'custom_message',
				id: 'notify-1',
				parentId: null,
				timestamp: '2026-01-01T00:00:02.000Z',
				customType: 'subagent-notify',
				content: 'Background task failed: **worker**\n\nNo output',
				display: false
			} as never
		] as SessionEntry[];
		expect(deriveSubagentRunsFromEntries(entries, parent)[0]?.status).toBe('failed');
		expect(
			deriveSubagentRunsFromEntries(call('tool-2', { workflowScript: '{ malformed' }), parent)[0]
		).toMatchObject({
			agent: 'workflow',
			status: 'running'
		});
	});

	it('slices child history after the generated session marker', () => {
		const entries = [
			{
				type: 'session_info',
				id: 'info',
				parentId: null,
				timestamp: '',
				name: 'subagent-worker-436062b1'
			},
			{
				type: 'message',
				id: 'task',
				parentId: 'info',
				timestamp: '',
				message: { role: 'user', content: [{ type: 'text', text: 'Task: Inspect files' }] }
			},
			{
				type: 'message',
				id: 'answer',
				parentId: 'task',
				timestamp: '',
				message: { role: 'assistant', content: [{ type: 'text', text: 'Done' }] }
			}
		] as unknown as SessionEntry[];
		expect(sliceSubagentTimeline(entries)).toEqual({
			initialized: true,
			items: [
				expect.objectContaining<ChatItem>({
					id: 'task',
					kind: 'message',
					role: 'user',
					text: 'Task: Inspect files'
				}),
				expect.objectContaining<ChatItem>({
					id: 'answer',
					kind: 'message',
					role: 'assistant',
					text: 'Done'
				})
			]
		});
	});

	it('rejects every non-empty action, including unknown future management actions', () => {
		for (const action of ['get', 'models', 'watchdog.configure', 'future-control']) {
			expect(
				parseSubagentToolLaunch(`tool-${action}`, { action, agent: 'worker', task: 'not a launch' })
			).toBeUndefined();
		}

		expect(parseSubagentToolLaunch('tool-empty', { action: '', agent: 'worker' })).toBeDefined();
		expect(
			parseSubagentToolLaunch('tool-whitespace', { action: ' ', agent: 'worker' })
		).toBeUndefined();
	});

	it('uses structured async identity instead of output mode or missing argument defaults', () => {
		const asyncRuns = deriveSubagentRunsFromEntries(
			call(
				'tool-default-async',
				{ agent: 'worker', task: 'Inspect' },
				{
					details: { mode: 'single', asyncId: 'async-default', results: [] }
				}
			),
			parent
		);
		expect(asyncRuns[0]).toMatchObject({ runId: 'async-default', status: 'running' });

		const foregroundRuns = deriveSubagentRunsFromEntries(
			call(
				'tool-file-only',
				{ agent: 'worker', task: 'Inspect', outputMode: 'file-only', async: false },
				{
					details: { mode: 'single', results: [{ index: 0, agent: 'worker', exitCode: 0 }] }
				}
			),
			parent
		);
		expect(foregroundRuns[0]).toMatchObject({ status: 'completed', childId: 'index-0' });
	});

	it('projects structured chain/workflow children without inventing workflow agents', () => {
		const chainRuns = deriveSubagentRunsFromEntries(
			call(
				'tool-chain',
				{ chain: [{ agent: 'scout' }, { agent: 'reviewer' }], async: true },
				{
					details: {
						mode: 'chain',
						asyncId: 'chain-1',
						results: [
							{ index: 1, agent: 'reviewer', exitCode: 0 },
							{ index: 0, agent: 'scout', exitCode: 1 }
						]
					}
				}
			),
			parent
		);
		expect(chainRuns.map((run) => [run.childId, run.agent, run.status])).toEqual([
			['index-0', 'scout', 'failed'],
			['index-1', 'reviewer', 'completed']
		]);

		const workflowRuns = deriveSubagentRunsFromEntries(
			call(
				'tool-workflow',
				{ workflowScript: "const x = await runs.run('scan', {})" },
				{
					details: {
						mode: 'workflow',
						asyncId: 'workflow-1',
						workflow: {
							trace: [
								{ operation: 'run', key: 'scan', state: 'started' },
								{ operation: 'status', key: 'scan', state: 'completed' }
							]
						},
						results: []
					}
				}
			),
			parent
		);
		expect(workflowRuns).toHaveLength(1);
		expect(workflowRuns[0]).toMatchObject({ agent: 'scan', childId: 'index-0', status: 'running' });
	});

	it('uses workflow trace child run IDs for session resolution and child status recovery', () => {
		const { project, parent: projectParent, asyncRoot } = temporaryProject();
		const rootRunId = '12345678';
		const childRunId = 'abcdef01';
		const child = session('subagent-scout-abcdef01', 'workflow-child', projectParent.path);
		const rootDir = writeAsyncStatus(asyncRoot, rootRunId, {
			runId: rootRunId,
			sessionId: projectParent.path,
			cwd: project.cwd,
			state: 'running',
			steps: [{ index: 0, agent: 'scan', workflowKey: 'scan', status: 'running' }],
			workflow: {
				trace: [
					{ operation: 'run', key: 'scan', state: 'started', runId: childRunId },
					{ operation: 'run', key: 'scan', state: 'completed' }
				]
			}
		});
		writeAsyncStatus(asyncRoot, childRunId, {
			runId: childRunId,
			sessionId: projectParent.path,
			cwd: project.cwd,
			state: 'complete',
			steps: [
				{
					index: 0,
					agent: 'scout',
					description: 'Recovered child task',
					workflowKey: 'scan',
					status: 'complete',
					sessionFile: child.path
				}
			]
		});
		const asyncRuns = deriveSubagentRunsFromEntries(
			call(
				'tool-workflow-async',
				{ workflowScript: 'return await runs.run("scan", {})' },
				{
					details: {
						mode: 'workflow',
						asyncId: rootRunId,
						asyncDir: rootDir,
						results: []
					}
				}
			),
			projectParent,
			[child],
			project,
			{ asyncRoot }
		);
		expect(asyncRuns[0]).toMatchObject({
			runId: rootRunId,
			agent: 'scout',
			task: 'Recovered child task',
			status: 'completed',
			childSessionId: child.id,
			timelineAvailable: true
		});

		const foregroundChild = session(
			'subagent-scan-fedcba09',
			'workflow-foreground-child',
			projectParent.path
		);
		const foregroundRuns = deriveSubagentRunsFromEntries(
			call(
				'tool-workflow-foreground',
				{ workflowScript: 'return await runs.run("scan", {})' },
				{
					details: {
						mode: 'workflow',
						runId: 'fedcba10',
						results: [{ index: 0, agent: 'scan', success: true }],
						workflow: {
							trace: [
								{
									operation: 'run',
									key: 'scan',
									state: 'completed',
									runId: 'fedcba09'
								}
							]
						}
					}
				}
			),
			projectParent,
			[foregroundChild]
		);
		expect(foregroundRuns[0]).toMatchObject({
			runId: 'fedcba10',
			status: 'completed',
			childSessionId: foregroundChild.id,
			timelineAvailable: true
		});
	});

	it('does not resolve tool-call fallback IDs broadly, but honors explicit trusted hints', () => {
		const child = session('subagent-worker-abcdef12', 'fallback-child');
		const initializing = deriveSubagentRunsFromEntries(
			call('tool-fallback', { agent: 'worker', task: 'Inspect', async: true }),
			parent,
			[child]
		);
		expect(initializing[0]).not.toHaveProperty('childSessionId');

		const hinted = deriveSubagentRunsFromEntries(
			call(
				'tool-fallback-hinted',
				{ agent: 'worker', task: 'Inspect', async: false },
				{
					details: {
						mode: 'single',
						results: [{ index: 0, agent: 'worker', success: true, sessionFile: child.path }]
					}
				}
			),
			parent,
			[child]
		);
		expect(hinted[0]).toMatchObject({
			status: 'completed',
			childSessionId: child.id,
			timelineAvailable: true
		});
	});

	it('does not cross-correlate plain text notifications across repeated launches', () => {
		const entries = [
			...call('tool-repeat-a', { agent: 'worker', task: 'First', async: true }),
			...call('tool-repeat-b', { agent: 'worker', task: 'Second', async: true }),
			{
				type: 'custom_message',
				id: 'notify-repeat',
				parentId: null,
				timestamp: '',
				customType: 'subagent-notify',
				display: false,
				content: 'Background task failed: **worker**\n\nNo output'
			} as never
		] as SessionEntry[];
		const runs = deriveSubagentRunsFromEntries(entries, parent);
		expect(runs).toHaveLength(2);
		expect(runs.map((run) => run.status)).toEqual(['running', 'running']);
	});

	it('correlates notifications by child session identity and keeps repeated agents independent', () => {
		const first = session('subagent-worker-abcdef12-1', 'child-notify-1');
		const second = session('subagent-worker-abcdef12-2', 'child-notify-2');
		const entries = [
			...call(
				'tool-notify',
				{ tasks: [{ agent: 'worker' }, { agent: 'worker' }], async: true },
				{
					details: { mode: 'parallel', asyncId: 'abcdef12', results: [] }
				}
			),
			{
				type: 'custom_message',
				id: 'notify',
				parentId: null,
				timestamp: '',
				customType: 'subagent-notify',
				display: false,
				content: `Background task stopped: **worker** (2/2)\n\nStopped\n\nSession file: ${second.path}`
			} as never
		] as SessionEntry[];
		const runs = deriveSubagentRunsFromEntries(entries, parent, [first, second]);
		expect(runs.map((run) => run.status)).toEqual(['running', 'stopped']);
	});

	it('rejects child sessions owned by a different parent even when the name and path look valid', () => {
		const foreign = session(
			'subagent-worker-deadbeef',
			'foreign',
			'/tmp/project/other-parent.jsonl'
		);
		const runs = deriveSubagentRunsFromEntries(
			call(
				'tool-auth',
				{ agent: 'worker', task: 'Inspect', async: false },
				{
					details: {
						mode: 'single',
						runId: 'deadbeef',
						results: [{ index: 0, agent: 'worker', exitCode: 0, sessionFile: foreign.path }]
					}
				}
			),
			parent,
			[foreign]
		);
		expect(runs[0]).not.toHaveProperty('childSessionId');
		expect(runs[0]?.timelineAvailable).toBe(false);
	});

	it('reads async status steps for every terminal state instead of stale launch results', () => {
		const { project, parent: projectParent, asyncRoot } = temporaryProject();
		const states = ['running', 'complete', 'failed', 'paused', 'stopped'] as const;
		const expected = ['running', 'completed', 'failed', 'paused', 'stopped'] as const;

		for (let index = 0; index < states.length; index += 1) {
			const runId = `single-status-${index}`;
			const asyncDir = join(asyncRoot, runId);
			writeAsyncStatus(
				asyncRoot,
				runId,
				{
					runId,
					sessionId: `${projectParent.cwd}/./parent.jsonl`,
					cwd: project.cwd,
					state: states[index],
					steps: [
						{
							index: 0,
							agent: 'worker',
							label: 'Status worker',
							description: 'Read status file',
							status: states[index],
							sessionFile: join(asyncDir, 'child.jsonl'),
							runner: { type: 'pi' },
							workflowKey: 'status-worker'
						}
					]
				},
				asyncDir
			);
			const runs = deriveSubagentRunsFromEntries(
				call(
					'tool-status-' + index,
					{ agent: 'worker', task: 'fallback', async: true },
					{
						details: { mode: 'single', asyncId: runId, asyncDir, results: [] }
					}
				),
				projectParent,
				[],
				project,
				{ asyncRoot }
			);

			expect(runs[0]).toMatchObject({
				agent: 'worker',
				task: 'Read status file',
				status: expected[index]
			});
		}
	});

	it('projects workflow status steps when the tool result has no children or trace', () => {
		const { project, parent: projectParent, asyncRoot } = temporaryProject();
		const runId = 'workflow-status-1';
		const asyncDir = writeAsyncStatus(asyncRoot, runId, {
			runId,
			sessionId: projectParent.id,
			cwd: project.cwd,
			state: 'complete',
			steps: [
				{
					index: 0,
					agent: 'scout',
					label: 'Scout lane',
					description: 'Find files',
					status: 'complete',
					workflowKey: 'scan'
				},
				{
					index: 1,
					agent: 'reviewer',
					label: 'Review lane',
					description: 'Review files',
					status: 'complete',
					workflowKey: 'review'
				}
			]
		});
		const runs = deriveSubagentRunsFromEntries(
			call(
				'tool-workflow-status',
				{ workflowScript: 'return await runs.run("scan", {})' },
				{
					details: { mode: 'workflow', asyncId: runId, asyncDir, results: [] }
				}
			),
			projectParent,
			[],
			project,
			{ asyncRoot }
		);

		expect(runs).toHaveLength(2);
		expect(runs.map((run) => [run.agent, run.status])).toEqual([
			['scout', 'completed'],
			['reviewer', 'completed']
		]);
	});

	it('keeps malformed, mismatched, and escaping async status unavailable without breaking the run', () => {
		const { project, parent: projectParent, asyncRoot } = temporaryProject();
		const runId = 'status-guarded-1';
		const asyncDir = join(asyncRoot, runId);
		mkdirSync(asyncDir, { recursive: true });
		const baseDetails = {
			mode: 'single',
			asyncId: runId,
			asyncDir,
			results: []
		};
		const derive = () =>
			deriveSubagentRunsFromEntries(
				call(
					'tool-status-guarded',
					{ agent: 'worker', task: 'fallback', async: true },
					{
						details: baseDetails
					}
				),
				projectParent,
				[],
				project,
				{ asyncRoot }
			)[0];

		writeFileSync(join(asyncDir, 'status.json'), '{ malformed');
		expect(derive()).toMatchObject({ status: 'running' });

		for (const identity of [
			{ runId: 'other-run', sessionId: projectParent.id, cwd: project.cwd, state: 'complete' },
			{ runId, sessionId: 'other-parent', cwd: project.cwd, state: 'complete' },
			{ runId, sessionId: projectParent.id, cwd: '/tmp/other-project', state: 'complete' }
		]) {
			writeFileSync(join(asyncDir, 'status.json'), JSON.stringify({ ...identity, steps: [] }));
			expect(derive()).toMatchObject({ status: 'running' });
		}

		const outside = mkdtempSync(join(tmpdir(), 'pi-squared-subagent-outside-'));
		temporaryRoots.push(outside);
		const outsideRun = join(outside, runId);
		writeAsyncStatus(outside, runId, {
			runId,
			sessionId: projectParent.id,
			cwd: project.cwd,
			state: 'complete',
			steps: [{ index: 0, agent: 'worker', status: 'complete' }]
		});
		rmSync(asyncDir, { recursive: true, force: true });
		symlinkSync(outsideRun, asyncDir, 'dir');
		expect(derive()).toMatchObject({ status: 'running' });
	});

	it('slices after the last exact child marker for nested sessions', () => {
		const entries = [
			{
				type: 'session_info',
				id: 'outer',
				parentId: null,
				timestamp: '',
				name: 'subagent-worker-abcdef12'
			},
			{
				type: 'message',
				id: 'outer-task',
				parentId: 'outer',
				timestamp: '',
				message: { role: 'user', content: [{ type: 'text', text: 'Task: outer' }] }
			},
			{
				type: 'session_info',
				id: 'inner',
				parentId: 'outer-task',
				timestamp: '',
				name: 'subagent-worker-abcdef12-1'
			},
			{
				type: 'message',
				id: 'inner-task',
				parentId: 'inner',
				timestamp: '',
				message: { role: 'user', content: [{ type: 'text', text: 'Task: inner' }] }
			}
		] as unknown as SessionEntry[];
		expect(sliceSubagentTimeline(entries, 'subagent-worker-abcdef12-1').items).toEqual([
			expect.objectContaining<ChatItem>({ kind: 'message', id: 'inner-task', text: 'Task: inner' })
		]);
	});
});

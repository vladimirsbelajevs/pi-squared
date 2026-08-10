import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, afterEach, vi } from 'vitest';
import {
	claimApplicationRestart,
	claimApplicationUpdate,
	createApplicationUpdateStream,
	getRepositoryRoot,
	isApplicationUpdateRunning,
	invokeApplicationRestart,
	scheduleApplicationManagementRelease,
	queryNativeRegistration,
	releaseApplicationUpdate,
	selectApplicationRestartCommand,
	selectApplicationUpdateCommand
} from './application-update.js';

afterEach(() => {
	releaseApplicationUpdate();
});

describe('application update commands', () => {
	it('selects fixed no-restart update commands for Linux and Windows', () => {
		const linux = selectApplicationUpdateCommand('linux');
		const windows = selectApplicationUpdateCommand('win32');

		expect(linux).toEqual({
			command: 'bash',
			args: [`${getRepositoryRoot()}/Linux/update.sh`, '--no-restart']
		});
		expect(windows?.command).toBe('powershell.exe');
		expect(windows?.args).toContain('-NoRestart');
		expect(windows?.args).toContain(`${getRepositoryRoot()}/Windows/update.ps1`);
	});

	it('selects only the fixed platform restart scripts', () => {
		expect(selectApplicationRestartCommand('linux')).toEqual({
			command: 'bash',
			args: [`${getRepositoryRoot()}/Linux/restart-service.sh`]
		});
		expect(selectApplicationRestartCommand('win32')?.args).toContain(
			`${getRepositoryRoot()}/Windows/restart-service.ps1`
		);
		expect(selectApplicationRestartCommand('darwin')).toBeUndefined();
	});

	it('distinguishes an absent native registration from a query failure', async () => {
		const absent = await queryNativeRegistration('linux', async () => ({
			code: 1,
			stdout: '',
			stderr: 'No files found for unit pi-squared.service.'
		}));
		expect(absent).toBe(false);

		await expect(
			queryNativeRegistration('linux', async () => ({
				code: 1,
				stdout: '',
				stderr: 'Failed to connect to bus'
			}))
		).rejects.toThrow('Unable to query user service');

		expect(
			await queryNativeRegistration('win32', async () => ({
				code: 3,
				stdout: '',
				stderr: 'CmdletizationQuery_NotFound_TaskName'
			}))
		).toBe(false);
	});

	it('keeps one update slot and releases it', () => {
		expect(isApplicationUpdateRunning()).toBe(false);
		expect(claimApplicationUpdate()).toBe(true);
		expect(claimApplicationUpdate()).toBe(false);
		expect(isApplicationUpdateRunning()).toBe(true);
		releaseApplicationUpdate();
		expect(claimApplicationUpdate()).toBe(true);
	});

	it('uses one management slot for update-vs-restart and restart-vs-restart races', () => {
		expect(claimApplicationUpdate()).toBe(true);
		expect(claimApplicationRestart()).toBe(false);
		releaseApplicationUpdate();

		expect(claimApplicationRestart()).toBe(true);
		expect(claimApplicationUpdate()).toBe(false);
		expect(claimApplicationRestart()).toBe(false);
	});

	it('releases a failed restart reservation after the bounded fallback timeout', () => {
		vi.useFakeTimers();
		try {
			expect(claimApplicationRestart()).toBe(true);
			const timeoutMs = 1000;
			scheduleApplicationManagementRelease(timeoutMs);
			vi.advanceTimersByTime(timeoutMs - 1);
			expect(claimApplicationUpdate()).toBe(false);
			vi.advanceTimersByTime(1);
			expect(claimApplicationUpdate()).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});
});

type FakeChild = EventEmitter & {
	stdout: EventEmitter & { setEncoding: (encoding: string) => void };
	stderr: EventEmitter & { setEncoding: (encoding: string) => void };
	unref: () => void;
};
type ProcessSpawner = Exclude<Parameters<typeof createApplicationUpdateStream>[0], undefined>;

function createFakeChild(): FakeChild {
	const child = new EventEmitter() as FakeChild;
	child.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
	child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
	child.unref = vi.fn();

	return child;
}

async function readRecords(
	stream: ReadableStream<Uint8Array>
): Promise<Array<Record<string, unknown>>> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let text = '';
	while (true) {
		const result = await reader.read();
		if (result.done) {
			break;
		}

		text += decoder.decode(result.value, { stream: true });
	}

	text += decoder.decode();

	return text
		.trim()
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('application update process streams', () => {
	it('streams stdout and stderr and releases the lock on success', async () => {
		const child = createFakeChild();
		const spawn = vi.fn(() => child) as unknown as ProcessSpawner;
		expect(claimApplicationUpdate()).toBe(true);
		const stream = createApplicationUpdateStream(spawn);
		child.stdout.emit('data', 'stdout chunk');
		child.stderr.emit('data', 'stderr chunk');
		child.emit('close', 0, null);

		expect(await readRecords(stream)).toEqual([
			{ type: 'output', stream: 'stdout', text: 'stdout chunk' },
			{ type: 'output', stream: 'stderr', text: 'stderr chunk' },
			{ type: 'complete', code: 0, signal: null }
		]);
		expect(isApplicationUpdateRunning()).toBe(false);
	});

	it('preserves nonzero completion and reports synchronous spawn failures', async () => {
		const child = createFakeChild();
		const nonzeroSpawn = vi.fn(() => child) as unknown as ProcessSpawner;
		expect(claimApplicationUpdate()).toBe(true);
		const nonzeroStream = createApplicationUpdateStream(nonzeroSpawn);
		child.stderr.emit('data', 'build failed');
		child.emit('close', 7, 'SIGTERM');
		const nonzeroRecords = await readRecords(nonzeroStream);
		expect(nonzeroRecords.at(-1)).toEqual({
			type: 'complete',
			code: 7,
			signal: 'SIGTERM'
		});
		expect(isApplicationUpdateRunning()).toBe(false);

		expect(claimApplicationUpdate()).toBe(true);
		const spawnError = vi.fn(() => {
			throw new Error('spawn failed');
		}) as unknown as ProcessSpawner;
		const failedStream = createApplicationUpdateStream(spawnError);
		expect(await readRecords(failedStream)).toEqual([
			{ type: 'error', message: 'spawn failed' },
			{ type: 'complete', code: null, signal: null, error: 'spawn failed' }
		]);
		expect(isApplicationUpdateRunning()).toBe(false);
	});

	it('keeps the child alive when the response reader disconnects', async () => {
		const child = createFakeChild();
		const spawn = vi.fn(() => child) as unknown as ProcessSpawner;
		expect(claimApplicationUpdate()).toBe(true);
		const stream = createApplicationUpdateStream(spawn);
		const reader = stream.getReader();
		await reader.cancel();
		child.stdout.emit('data', 'still running');
		child.emit('close', 0, null);
		expect(isApplicationUpdateRunning()).toBe(false);
		expect(child.listenerCount('close')).toBe(0);
	});

	it('dispatches the fixed restart command without waiting for helper exit', async () => {
		const child = createFakeChild();
		const spawn = vi.fn(() => {
			queueMicrotask(() => child.emit('spawn'));

			return child;
		}) as unknown as ProcessSpawner;
		await invokeApplicationRestart(spawn);
		expect(spawn).toHaveBeenCalledWith(
			'bash',
			[`${getRepositoryRoot()}/Linux/restart-service.sh`],
			expect.objectContaining({ cwd: getRepositoryRoot(), detached: true, stdio: 'ignore' })
		);
		expect(child.unref).toHaveBeenCalledOnce();
	});
});

describe('restart and update scripts', () => {
	it('delegate successful updates to reusable restart scripts', async () => {
		const [linux, linuxRestart, windows, windowsRestart] = await Promise.all([
			readFile(`${getRepositoryRoot()}/Linux/update.sh`, 'utf8'),
			readFile(`${getRepositoryRoot()}/Linux/restart-service.sh`, 'utf8'),
			readFile(`${getRepositoryRoot()}/Windows/update.ps1`, 'utf8'),
			readFile(`${getRepositoryRoot()}/Windows/restart-service.ps1`, 'utf8')
		]);
		expect(linux).toContain('Linux/restart-service.sh');
		expect(linux).toContain('--no-restart');
		expect(linuxRestart).toContain('systemctl --user --no-block restart');
		expect(windows).toContain('Windows\\restart-service.ps1');
		expect(windows).toContain('[switch]$NoRestart');
		expect(windowsRestart).toContain('Get-ScheduledTask -TaskName $taskName');
		expect(windowsRestart).toContain('Start-ScheduledTask -TaskName $taskName');
		expect(windowsRestart).toContain('[Console]::Error.WriteLine');
		expect(windowsRestart).not.toContain('Write-Error');
		expect(await readFile(`${getRepositoryRoot()}/package.json`, 'utf8')).toContain(
			"process.env.HOST='127.0.0.1'"
		);
	});
});

import { describe, expect, it, afterEach } from 'vitest';
import {
	claimApplicationUpdate,
	createApplicationUpdateStream,
	getApplicationRuntimeMode,
	getApplicationUpdateStatus,
	getRepositoryRoot,
	isApplicationUpdateRunning,
	releaseApplicationUpdate,
	selectApplicationUpdateCommand
} from './application-update.js';

afterEach(() => {
	releaseApplicationUpdate();
});

describe('application update modes', () => {
	it('uses explicit source-web status and foreground update commands', () => {
		const status = getApplicationUpdateStatus('linux');
		expect(status.mode).toBe('source-web');
		expect(status.canRestart).toBe(false);
		expect(selectApplicationUpdateCommand('linux')).toEqual({
			command: 'bash',
			args: [`${getRepositoryRoot()}/Linux/update.sh`]
		});
		expect(selectApplicationUpdateCommand('win32')?.command).toBe('powershell.exe');
	});

	it('keeps desktop mode from selecting repository scripts', () => {
		const previous = process.env.PI_SQUARED_DESKTOP;
		process.env.PI_SQUARED_DESKTOP = '1';
		try {
			expect(getApplicationRuntimeMode()).toBe('electron');
			expect(selectApplicationUpdateCommand('linux')).toBeUndefined();
			expect(getApplicationUpdateStatus('linux')).toMatchObject({
				mode: 'electron',
				supported: false,
				canRestart: false
			});
		} finally {
			if (previous === undefined) {
				delete process.env.PI_SQUARED_DESKTOP;
			} else {
				process.env.PI_SQUARED_DESKTOP = previous;
			}
		}
	});

	it('allows one source update at a time', () => {
		expect(isApplicationUpdateRunning()).toBe(false);
		expect(claimApplicationUpdate()).toBe(true);
		expect(claimApplicationUpdate()).toBe(false);
		releaseApplicationUpdate();
		expect(isApplicationUpdateRunning()).toBe(false);
	});
});

type FakeChild = {
	stdout: {
		setEncoding: (encoding: string) => void;
		on: (event: string, listener: (...args: unknown[]) => void) => void;
	};
	stderr: {
		setEncoding: (encoding: string) => void;
		on: (event: string, listener: (...args: unknown[]) => void) => void;
	};
	once: (event: string, listener: (...args: unknown[]) => void) => void;
};

it('the stream contract releases its lock after a child completes', async () => {
	const listeners = new Map<string, (...args: unknown[]) => void>();
	const child: FakeChild = {
		stdout: {
			setEncoding: () => undefined,
			on: (event, listener) => listeners.set(`stdout:${event}`, listener)
		},
		stderr: {
			setEncoding: () => undefined,
			on: (event, listener) => listeners.set(`stderr:${event}`, listener)
		},
		once: (event, listener) => listeners.set(event, listener)
	};
	const spawn = (() => child) as never;
	expect(claimApplicationUpdate()).toBe(true);
	const stream = createApplicationUpdateStream(spawn);
	listeners.get('stdout:data')?.('build output');
	listeners.get('close')?.(0, null);
	const records = new TextDecoder()
		.decode(await new Response(stream).arrayBuffer())
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line) as Record<string, unknown>);
	expect(records).toContainEqual({ type: 'output', stream: 'stdout', text: 'build output' });
	expect(records.at(-1)).toEqual({ type: 'complete', code: 0, signal: null });
	expect(isApplicationUpdateRunning()).toBe(false);
});

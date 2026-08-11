import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { getPiUpdateCommands, runPiUpdate } from './pi-updater.js';

describe('Electron Pi updater', () => {
	it('uses the Pi CLI directly on Linux and PowerShell on Windows', () => {
		expect(getPiUpdateCommands('linux').map(({ command, args }) => ({ command, args }))).toEqual([
			{ command: 'pi', args: ['update'] },
			{ command: 'pi', args: ['update', '--extensions'] }
		]);
		expect(getPiUpdateCommands('win32').map((step) => step.command)).toEqual([
			'powershell.exe',
			'powershell.exe'
		]);
		expect(() => getPiUpdateCommands('darwin')).toThrow('Pi updates are unsupported on darwin.');
	});

	it('runs the CLI and extension updates sequentially while streaming output', async () => {
		const calls: string[] = [];
		const spawnProcess = vi.fn((command: string, args: string[]) => {
			calls.push([command, ...args].join(' '));
			const child = new EventEmitter() as EventEmitter & {
				stdout: PassThrough;
				stderr: PassThrough;
			};
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			queueMicrotask(() => {
				child.stdout.write('updated\n');
				child.emit('close', 0, null);
			});

			return child;
		});
		const progress: string[] = [];

		await runPiUpdate({
			platform: 'linux',
			spawnProcess: spawnProcess as never,
			onOutput: ({ stream, text }) => progress.push(`${stream}:${text}`)
		});

		expect(calls).toEqual(['pi update', 'pi update --extensions']);
		expect(progress.filter((entry) => entry === 'stdout:updated\n')).toHaveLength(2);
		expect(progress.filter((entry) => entry.startsWith('system:'))).toHaveLength(2);
	});
});

import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { terminateChild } from './lifecycle.js';

function fakeChild(options: { exited?: boolean; exitsOnTerm?: boolean } = {}): ChildProcess & {
	kills: NodeJS.Signals[];
} {
	const emitter = new EventEmitter() as ChildProcess & { kills: NodeJS.Signals[] };
	const exitCode: number | null = options.exited ? 0 : null;
	let signalCode: NodeJS.Signals | null = null;
	emitter.kills = [];
	Object.defineProperties(emitter, {
		exitCode: { get: () => exitCode },
		signalCode: { get: () => signalCode }
	});
	emitter.kill = ((signal: NodeJS.Signals) => {
		emitter.kills.push(signal);
		if (signal === 'SIGTERM' && options.exitsOnTerm) {
			signalCode = signal;
			emitter.emit('exit', null, signal);
		}

		return true;
	}) as ChildProcess['kill'];

	return emitter;
}

describe('Electron child lifecycle', () => {
	it('does not skip a live child merely because a signal was sent', async () => {
		const child = fakeChild({ exitsOnTerm: true });
		expect(await terminateChild(child, 20)).toBe('graceful');
		expect(child.kills).toEqual(['SIGTERM']);
	});

	it('forces a child that ignores graceful termination', async () => {
		const child = fakeChild();
		expect(await terminateChild(child, 5)).toBe('forced');
		expect(child.kills).toEqual(['SIGTERM', 'SIGKILL']);
	});

	it('recognizes a child that exited before cleanup started', async () => {
		const child = fakeChild({ exited: true });
		expect(await terminateChild(child, 5)).toBe('already-exited');
		expect(child.kills).toEqual([]);
	});
});

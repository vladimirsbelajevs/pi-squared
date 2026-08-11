import type { ChildProcess } from 'node:child_process';

export type ChildTermination = 'already-exited' | 'graceful' | 'forced';

function hasExited(child: ChildProcess): boolean {
	return child.exitCode !== null || child.signalCode !== null;
}

export async function terminateChild(
	child: ChildProcess,
	gracePeriodMs = 5_000
): Promise<ChildTermination> {
	if (hasExited(child)) {
		return 'already-exited';
	}

	return new Promise<ChildTermination>((resolve) => {
		let settled = false;
		let termination: ChildTermination = 'graceful';
		const settle = (): void => {
			if (settled) {
				return;
			}

			settled = true;
			clearTimeout(timeout);
			resolve(termination);
		};

		const onExit = (): void => settle();
		const timeout = setTimeout(() => {
			if (!hasExited(child)) {
				termination = 'forced';
				child.kill('SIGKILL');
			}

			settle();
		}, gracePeriodMs);

		child.once('exit', onExit);
		if (!hasExited(child)) {
			child.kill('SIGTERM');
		}

		if (hasExited(child)) {
			onExit();
		}
	});
}

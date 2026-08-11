import { randomUUID } from 'node:crypto';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';

const encoder = new TextEncoder();
export const APPLICATION_UPDATE_OUTPUT_LIMIT = 256 * 1024;

export type ApplicationRuntimeMode = 'source-web' | 'electron';
export interface ApplicationCommand {
	command: string;
	args: string[];
}

export interface ApplicationUpdateStatus {
	mode: ApplicationRuntimeMode;
	supported: boolean;
	running: boolean;
	platform: NodeJS.Platform;
	canRestart: boolean;
	/** Changes when the running Node process is replaced by a restart. */
	instanceId: string;
}

type ProcessSpawner = (
	command: string,
	args: string[],
	options: {
		cwd: string;
		stdio: ['ignore', 'pipe', 'pipe'] | 'ignore';
		detached?: boolean;
	}
) => ChildProcess;

const repositoryRoot = resolve(process.cwd());
const applicationInstanceId = randomUUID();
let applicationUpdateRunning = false;
const spawnProcess = nodeSpawn as unknown as ProcessSpawner;

export function getApplicationRuntimeMode(): ApplicationRuntimeMode {
	return process.env.PI_SQUARED_DESKTOP === '1' ? 'electron' : 'source-web';
}

export function getRepositoryRoot(): string {
	return repositoryRoot;
}

export function selectApplicationUpdateCommand(
	platform: NodeJS.Platform = process.platform
): ApplicationCommand | undefined {
	if (getApplicationRuntimeMode() === 'electron') {
		return undefined;
	}

	if (platform === 'linux') {
		return {
			command: 'bash',
			args: [join(repositoryRoot, 'Linux', 'update.sh')]
		};
	}

	if (platform === 'win32') {
		return {
			command: 'powershell.exe',
			args: [
				'-NoLogo',
				'-NoProfile',
				'-ExecutionPolicy',
				'Bypass',
				'-File',
				join(repositoryRoot, 'Windows', 'update.ps1')
			]
		};
	}

	return undefined;
}

export function getApplicationUpdateStatus(
	platform: NodeJS.Platform = process.platform
): ApplicationUpdateStatus {
	const mode = getApplicationRuntimeMode();

	return {
		mode,
		supported: mode === 'source-web' && selectApplicationUpdateCommand(platform) !== undefined,
		running: applicationUpdateRunning,
		platform,
		canRestart: false,
		instanceId: applicationInstanceId
	};
}

export function isApplicationUpdateRunning(): boolean {
	return applicationUpdateRunning;
}

export function claimApplicationUpdate(): boolean {
	if (applicationUpdateRunning) {
		return false;
	}

	applicationUpdateRunning = true;

	return true;
}

export function releaseApplicationUpdate(): void {
	applicationUpdateRunning = false;
}

function record(value: unknown): Uint8Array {
	return encoder.encode(`${JSON.stringify(value)}\n`);
}

export function createApplicationUpdateStream(
	spawn: ProcessSpawner = spawnProcess
): ReadableStream<Uint8Array> {
	const command = selectApplicationUpdateCommand();
	if (!command) {
		throw new Error('Source checkout updates are unavailable in desktop mode.');
	}

	let connected = true;
	let completed = false;
	let child: ChildProcess | undefined;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const enqueue = (value: unknown): void => {
				if (connected && !completed) {
					controller.enqueue(record(value));
				}
			};

			const finish = (completion: Record<string, unknown>): void => {
				if (completed) {
					return;
				}

				if (connected) {
					controller.enqueue(record(completion));
				}

				completed = true;
				releaseApplicationUpdate();
				if (connected) {
					controller.close();
				}
			};

			try {
				child = spawn(command.command, command.args, {
					cwd: repositoryRoot,
					stdio: ['ignore', 'pipe', 'pipe']
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				enqueue({ type: 'error', message });
				finish({ type: 'complete', code: null, signal: null, error: message });

				return;
			}

			child.stdout?.setEncoding('utf8');
			child.stderr?.setEncoding('utf8');
			child.stdout?.on('data', (text: string) =>
				enqueue({ type: 'output', stream: 'stdout', text })
			);
			child.stderr?.on('data', (text: string) =>
				enqueue({ type: 'output', stream: 'stderr', text })
			);
			child.once('error', (error) => {
				const message = error instanceof Error ? error.message : String(error);
				enqueue({ type: 'error', message });
				finish({ type: 'complete', code: null, signal: null, error: message });
			});
			child.once('close', (code, signal) => finish({ type: 'complete', code, signal }));
		},
		cancel() {
			connected = false;
		}
	});

	return stream;
}

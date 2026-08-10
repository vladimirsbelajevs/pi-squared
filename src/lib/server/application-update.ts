import { randomUUID } from 'node:crypto';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';

const encoder = new TextEncoder();
export const APPLICATION_UPDATE_OUTPUT_LIMIT = 256 * 1024;
export const APPLICATION_RESTART_RESERVATION_TIMEOUT_MS = 30_000;
export const LINUX_SERVICE_NAME = 'pi-squared.service';
export const WINDOWS_TASK_NAME = 'Pi Squared';

export type SupportedApplicationPlatform = 'linux' | 'win32';
export interface ApplicationCommand {
	command: string;
	args: string[];
}

export interface ApplicationUpdateStatus {
	supported: boolean;
	nativeRegistration: boolean;
	running: boolean;
	platform: NodeJS.Platform;
	/** Changes when the running Node process is replaced by a restart. */
	instanceId: string;
}

interface CommandResult {
	code: number;
	stdout: string;
	stderr: string;
}

type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;
type ProcessSpawner = (
	command: string,
	args: string[],
	options: {
		cwd: string;
		stdio: ['ignore', 'pipe', 'pipe'] | 'ignore';
		detached?: boolean;
	}
) => ChildProcess;

// The production service and the development command both run with the repository as cwd.
// This remains an absolute, server-selected path and is never derived from request input.
const repositoryRoot = resolve(process.cwd());
const applicationInstanceId = randomUUID();
let applicationManagementSlot:
	| {
			kind: 'update' | 'restart';
			token: number;
			timer?: ReturnType<typeof setTimeout>;
	  }
	| undefined;
let nextApplicationManagementToken = 0;
const spawnProcess = nodeSpawn as unknown as ProcessSpawner;

function commandResult(command: string, args: string[]): Promise<CommandResult> {
	return new Promise((resolveResult) => {
		let child: ChildProcess;
		try {
			child = nodeSpawn(command, args, {
				cwd: repositoryRoot,
				stdio: ['ignore', 'pipe', 'pipe']
			});
		} catch (error) {
			resolveResult({
				code: 127,
				stdout: '',
				stderr: error instanceof Error ? error.message : String(error)
			});

			return;
		}

		let stdout = '';
		let stderr = '';
		child.stdout?.setEncoding('utf8');
		child.stderr?.setEncoding('utf8');
		child.stdout?.on('data', (chunk: string) => (stdout += chunk));
		child.stderr?.on('data', (chunk: string) => (stderr += chunk));
		child.once('error', (error) => {
			stderr += error instanceof Error ? error.message : String(error);
		});
		child.once('close', (code) => resolveResult({ code: code ?? 1, stdout, stderr }));
	});
}

function supportedPlatform(platform: NodeJS.Platform): platform is SupportedApplicationPlatform {
	return platform === 'linux' || platform === 'win32';
}

export function getSupportedApplicationPlatform(
	platform: NodeJS.Platform = process.platform
): SupportedApplicationPlatform | undefined {
	return supportedPlatform(platform) ? platform : undefined;
}

export function getRepositoryRoot(): string {
	return repositoryRoot;
}

export function selectApplicationUpdateCommand(
	platform: NodeJS.Platform = process.platform
): ApplicationCommand | undefined {
	if (platform === 'linux') {
		return {
			command: 'bash',
			args: [join(repositoryRoot, 'Linux', 'update.sh'), '--no-restart']
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
				join(repositoryRoot, 'Windows', 'update.ps1'),
				'-NoRestart'
			]
		};
	}

	return undefined;
}

export function selectApplicationRestartCommand(
	platform: NodeJS.Platform = process.platform
): ApplicationCommand | undefined {
	if (platform === 'linux') {
		return {
			command: 'bash',
			args: [join(repositoryRoot, 'Linux', 'restart-service.sh')]
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
				join(repositoryRoot, 'Windows', 'restart-service.ps1')
			]
		};
	}

	return undefined;
}

function isLinuxRegistrationAbsence(result: CommandResult): boolean {
	return (
		result.code !== 0 &&
		/no files found|not found|could not be found|unit .* does not exist/i.test(
			`${result.stdout}\n${result.stderr}`
		)
	);
}

function isWindowsRegistrationAbsence(result: CommandResult): boolean {
	return result.code === 3 || /CmdletizationQuery_NotFound_TaskName/i.test(result.stderr);
}

export async function queryNativeRegistration(
	platform: NodeJS.Platform = process.platform,
	runner: CommandRunner = commandResult
): Promise<boolean> {
	if (platform === 'linux') {
		const result = await runner('systemctl', ['--user', 'cat', LINUX_SERVICE_NAME]);
		if (result.code === 0) {
			return true;
		}

		if (isLinuxRegistrationAbsence(result)) {
			return false;
		}

		throw new Error(
			`Unable to query user service ${LINUX_SERVICE_NAME}: ${result.stderr || result.stdout || `command exited with code ${result.code}`}`
		);
	}

	if (platform === 'win32') {
		const command =
			"$ErrorActionPreference = 'Stop'; try { Get-ScheduledTask -TaskName 'Pi Squared' -ErrorAction Stop | Out-Null } catch { if ([string]$_.FullyQualifiedErrorId -match '^CmdletizationQuery_NotFound_TaskName,') { exit 3 }; [Console]::Error.WriteLine($_.Exception.Message); exit 1 }";
		const result = await runner('powershell.exe', [
			'-NoLogo',
			'-NoProfile',
			'-ExecutionPolicy',
			'Bypass',
			'-Command',
			command
		]);
		if (result.code === 0) {
			return true;
		}

		if (isWindowsRegistrationAbsence(result)) {
			return false;
		}

		throw new Error(
			`Unable to query Scheduled Task ${WINDOWS_TASK_NAME}: ${result.stderr || result.stdout || `command exited with code ${result.code}`}`
		);
	}

	return false;
}

export async function getApplicationUpdateStatus(
	platform: NodeJS.Platform = process.platform
): Promise<ApplicationUpdateStatus> {
	const supported = supportedPlatform(platform);

	return {
		supported,
		nativeRegistration: supported ? await queryNativeRegistration(platform) : false,
		running: applicationManagementSlot?.kind === 'update',
		platform,
		instanceId: applicationInstanceId
	};
}

export function isApplicationUpdateRunning(): boolean {
	return applicationManagementSlot?.kind === 'update';
}

function claimApplicationManagementSlot(kind: 'update' | 'restart'): boolean {
	if (applicationManagementSlot) {
		return false;
	}

	applicationManagementSlot = { kind, token: ++nextApplicationManagementToken };

	return true;
}

export function claimApplicationUpdate(): boolean {
	return claimApplicationManagementSlot('update');
}

export function claimApplicationRestart(): boolean {
	return claimApplicationManagementSlot('restart');
}

function releaseApplicationManagementSlot(token?: number): void {
	if (
		!applicationManagementSlot ||
		(token !== undefined && applicationManagementSlot.token !== token)
	) {
		return;
	}

	if (applicationManagementSlot.timer) {
		clearTimeout(applicationManagementSlot.timer);
	}

	applicationManagementSlot = undefined;
}

/**
 * Keep the restart reservation while the old process has a chance to be
 * replaced. A failed/no-op restart eventually releases the slot so the app
 * remains usable without requiring a process replacement.
 */
export function scheduleApplicationManagementRelease(
	timeoutMs = APPLICATION_RESTART_RESERVATION_TIMEOUT_MS
): void {
	if (!applicationManagementSlot || applicationManagementSlot.kind !== 'restart') {
		return;
	}

	const token = applicationManagementSlot.token;
	applicationManagementSlot.timer = setTimeout(() => {
		releaseApplicationManagementSlot(token);
	}, timeoutMs);
}

function record(value: unknown): Uint8Array {
	return encoder.encode(`${JSON.stringify(value)}\n`);
}

export function createApplicationUpdateStream(
	spawn: ProcessSpawner = spawnProcess
): ReadableStream<Uint8Array> {
	const command = selectApplicationUpdateCommand();
	if (!command) {
		throw new Error('Application updates are not supported on this platform.');
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
				releaseApplicationManagementSlot();
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
			child.once('close', (code, signal) => {
				finish({ type: 'complete', code, signal });
			});
		},
		cancel() {
			connected = false;
		}
	});

	return stream;
}

export async function invokeApplicationRestart(
	spawn: ProcessSpawner = spawnProcess
): Promise<void> {
	const command = selectApplicationRestartCommand();
	if (!command) {
		throw new Error('Application restart is not supported on this platform.');
	}

	await new Promise<void>((resolveResult, reject) => {
		let child: ChildProcess;
		try {
			child = spawn(command.command, command.args, {
				cwd: repositoryRoot,
				stdio: 'ignore',
				detached: true
			});
		} catch (error) {
			reject(error);

			return;
		}

		child.once('error', reject);
		child.once('spawn', () => {
			child.unref?.();
			resolveResult();
		});
	});
}

export function releaseApplicationUpdate(): void {
	releaseApplicationManagementSlot();
}

import { spawn, type ChildProcess } from 'node:child_process';

export interface PiUpdateProgress {
	stream: 'stdout' | 'stderr' | 'system';
	text: string;
}

export interface PiUpdateOptions {
	onOutput: (progress: PiUpdateProgress) => void;
	platform?: NodeJS.Platform;
	spawnProcess?: typeof spawn;
}

interface PiUpdateCommand {
	label: string;
	command: string;
	args: string[];
}

export function getPiUpdateCommands(
	platform: NodeJS.Platform = process.platform
): PiUpdateCommand[] {
	if (platform === 'win32') {
		return [
			{
				label: 'Updating the global Pi CLI…',
				command: 'powershell.exe',
				args: ['-NoLogo', '-NoProfile', '-Command', '& pi update; exit $LASTEXITCODE']
			},
			{
				label: 'Updating installed Pi extensions…',
				command: 'powershell.exe',
				args: ['-NoLogo', '-NoProfile', '-Command', '& pi update --extensions; exit $LASTEXITCODE']
			}
		];
	}

	if (platform === 'linux') {
		return [
			{ label: 'Updating the global Pi CLI…', command: 'pi', args: ['update'] },
			{
				label: 'Updating installed Pi extensions…',
				command: 'pi',
				args: ['update', '--extensions']
			}
		];
	}

	throw new Error(`Pi updates are unsupported on ${platform}.`);
}

async function runCommand(
	step: PiUpdateCommand,
	onOutput: PiUpdateOptions['onOutput'],
	spawnProcess: typeof spawn
): Promise<void> {
	onOutput({ stream: 'system', text: `${step.label}\n` });
	await new Promise<void>((resolve, reject) => {
		let child: ChildProcess;
		try {
			child = spawnProcess(step.command, step.args, {
				env: process.env,
				stdio: ['ignore', 'pipe', 'pipe'],
				windowsHide: true
			});
		} catch (error) {
			reject(error);

			return;
		}

		child.stdout?.setEncoding('utf8');
		child.stderr?.setEncoding('utf8');
		child.stdout?.on('data', (text: string) => onOutput({ stream: 'stdout', text }));
		child.stderr?.on('data', (text: string) => onOutput({ stream: 'stderr', text }));
		child.once('error', reject);
		child.once('close', (code, signal) => {
			if (code === 0) {
				resolve();

				return;
			}

			reject(
				new Error(
					`Pi update ${signal ? `was terminated by ${signal}` : `exited with code ${code ?? 'unknown'}`}.`
				)
			);
		});
	});
}

export async function runPiUpdate(options: PiUpdateOptions): Promise<void> {
	const spawnProcess = options.spawnProcess ?? spawn;

	for (const command of getPiUpdateCommands(options.platform)) {
		await runCommand(command, options.onOutput, spawnProcess);
	}
}

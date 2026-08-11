import { access, readdir, readFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { homedir, platform } from 'node:os';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

export const REQUIRED_PI_PACKAGES = [
	'npm:@gotgenes/pi-permission-system',
	'npm:pi-subagents',
	'npm:@narumitw/pi-plan-mode',
	'npm:@narumitw/pi-lsp',
	'npm:pi-mcp-adapter',
	'npm:pi-web-access'
] as const;

export const MINIMUM_NODE_VERSION = [22, 19, 0] as const;

export interface BootstrapPrerequisites {
	node: boolean;
	npm: boolean;
	pi: boolean;
}

export interface BootstrapStatus {
	phase: 'checking' | 'ready' | 'needs-setup' | 'running' | 'failed';
	configured: boolean;
	prerequisites: BootstrapPrerequisites;
	missingPackages: string[];
	permissionConfig: boolean;
	error?: string;
}

export interface BootstrapDependencies {
	agentDirectory?: string;
	commandExists?: (command: string) => Promise<boolean>;
	nodeVersion?: string;
	commandVersion?: (command: string) => Promise<string | undefined>;
	readJson?: (path: string) => Promise<unknown>;
	fileExists?: (path: string) => Promise<boolean>;
	readDirectory?: (path: string) => Promise<Dirent[]>;
	sharedPermissionConfigPath?: string;
}

export interface BootstrapRunnerOptions {
	resourceRoot: string;
	onOutput: (stream: 'stdout' | 'stderr' | 'system', text: string) => void;
	env?: NodeJS.ProcessEnv;
}

export function parseNodeVersion(value: string): [number, number, number] | undefined {
	const match = value
		.trim()
		.replace(/^v/, '')
		.match(/^(\d+)\.(\d+)\.(\d+)/);
	if (!match) {
		return undefined;
	}

	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function meetsMinimumNodeVersion(value: string, minimum = MINIMUM_NODE_VERSION): boolean {
	const parsed = parseNodeVersion(value);
	if (!parsed) {
		return false;
	}

	for (let index = 0; index < minimum.length; index += 1) {
		if (parsed[index] !== minimum[index]) {
			return parsed[index] > minimum[index];
		}
	}

	return true;
}

export function getPiAgentDirectory(env: NodeJS.ProcessEnv = process.env): string {
	if (env.PI_CODING_AGENT_DIR) {
		return env.PI_CODING_AGENT_DIR;
	}

	if (platform() === 'win32') {
		return join(env.USERPROFILE ?? homedir(), '.pi', 'agent');
	}

	return join(env.HOME ?? homedir(), '.pi', 'agent');
}

export function getPermissionConfigPath(
	agentDirectory = getPiAgentDirectory(),
	env: NodeJS.ProcessEnv = process.env
): string {
	return (
		env.PI_PERMISSION_SYSTEM_CONFIG_PATH ??
		join(agentDirectory, 'extensions', 'pi-permission-system', 'config.json')
	);
}

async function defaultCommandExists(command: string): Promise<boolean> {
	return new Promise((resolve) => {
		const child = spawn(command, ['--version'], { stdio: 'ignore', windowsHide: true });
		child.once('error', () => resolve(false));
		child.once('close', (code) => resolve(code === 0));
	});
}

async function defaultCommandVersion(command: string): Promise<string | undefined> {
	return new Promise((resolveVersion) => {
		const child = spawn(command, ['--version'], {
			stdio: ['ignore', 'pipe', 'ignore'],
			windowsHide: true
		});
		let output = '';
		child.stdout?.setEncoding('utf8');
		child.stdout?.on('data', (chunk: string) => (output += chunk));
		child.once('error', () => resolveVersion(undefined));
		child.once('close', (code) => resolveVersion(code === 0 ? output.trim() : undefined));
	});
}

async function defaultFileExists(path: string): Promise<boolean> {
	try {
		await access(path);

		return true;
	} catch {
		return false;
	}
}

async function defaultReadDirectory(path: string): Promise<Dirent[]> {
	try {
		return await readdir(path, { withFileTypes: true });
	} catch {
		return [];
	}
}

async function defaultReadJson(path: string): Promise<unknown> {
	try {
		return JSON.parse(await readFile(path, 'utf8')) as unknown;
	} catch {
		return undefined;
	}
}

function collectStrings(value: unknown): string[] {
	if (typeof value === 'string') {
		return [value];
	}

	if (Array.isArray(value)) {
		return value.flatMap(collectStrings);
	}

	if (value && typeof value === 'object') {
		return Object.values(value).flatMap(collectStrings);
	}

	return [];
}

function packageIdentity(value: string): string {
	const token = value.trim().replace(/^npm:/, '');
	if (token.startsWith('@')) {
		const versionSeparator = token.indexOf('@', 1);

		return versionSeparator === -1 ? token : token.slice(0, versionSeparator);
	}

	const versionSeparator = token.indexOf('@');

	return versionSeparator === -1 ? token : token.slice(0, versionSeparator);
}

function hasExpectedPackage(value: string, packageName: string): boolean {
	return packageIdentity(value) === packageIdentity(packageName);
}

async function hasPackageManifest(
	root: string,
	packageName: string,
	readJson: (path: string) => Promise<unknown>,
	readDirectory: (path: string) => Promise<Dirent[]>,
	depth = 0
): Promise<boolean> {
	if (depth > 5) {
		return false;
	}

	const manifest = await readJson(join(root, 'package.json'));
	if (
		manifest &&
		typeof manifest === 'object' &&
		'name' in manifest &&
		typeof manifest.name === 'string' &&
		hasExpectedPackage(manifest.name, packageName)
	) {
		return true;
	}

	for (const entry of await readDirectory(root)) {
		if (entry.isDirectory() && entry.name !== 'node_modules') {
			if (
				await hasPackageManifest(
					join(root, entry.name),
					packageName,
					readJson,
					readDirectory,
					depth + 1
				)
			) {
				return true;
			}
		}
	}

	return false;
}

async function hasInstalledPackage(
	packageName: string,
	agentDirectory: string,
	readJson: (path: string) => Promise<unknown>,
	fileExists: (path: string) => Promise<boolean>,
	readDirectory: (path: string) => Promise<Dirent[]>
): Promise<boolean> {
	const packageToken = packageName.replace(/^npm:/, '');
	const settingsFiles = [
		join(agentDirectory, 'settings.json'),
		join(agentDirectory, 'packages.json'),
		join(agentDirectory, 'package.json')
	];

	for (const settingsFile of settingsFiles) {
		const contents = await readJson(settingsFile);
		if (collectStrings(contents).some((item) => hasExpectedPackage(item, packageName))) {
			return true;
		}
	}

	const extensionName = packageIdentity(packageToken).split('/').pop() ?? packageToken;
	const extensionDirectory = join(agentDirectory, 'extensions', extensionName);
	if (await fileExists(extensionDirectory)) {
		return true;
	}

	const packageRoots = [
		join(agentDirectory, 'packages', packageToken),
		join(agentDirectory, 'packages'),
		join(agentDirectory, 'npm', 'node_modules'),
		join(agentDirectory, 'node_modules'),
		join(agentDirectory, 'extensions')
	];
	for (const root of packageRoots) {
		if (await hasPackageManifest(root, packageName, readJson, readDirectory)) {
			return true;
		}
	}

	return false;
}

function containsSharedConfig(target: unknown, shared: unknown): boolean {
	if (shared === null || typeof shared !== 'object') {
		return target === shared;
	}

	if (!target || typeof target !== 'object') {
		return false;
	}

	if (Array.isArray(shared)) {
		return (
			Array.isArray(target) &&
			target.length === shared.length &&
			shared.every((value, index) => containsSharedConfig(target[index], value))
		);
	}

	return Object.entries(shared).every(([key, value]) =>
		containsSharedConfig((target as Record<string, unknown>)[key], value)
	);
}

export function isPermissionConfigComplete(target: unknown, shared: unknown): boolean {
	return containsSharedConfig(target, shared);
}

async function hasValidPermissionConfig(
	agentDirectory: string,
	sharedPermissionConfigPath: string | undefined,
	readJson: (path: string) => Promise<unknown>,
	fileExists: (path: string) => Promise<boolean>
): Promise<boolean> {
	const targetPath = getPermissionConfigPath(agentDirectory);
	if (!sharedPermissionConfigPath || !(await fileExists(targetPath))) {
		return false;
	}

	const target = await readJson(targetPath);
	const shared = await readJson(sharedPermissionConfigPath);

	return isPermissionConfigComplete(target, shared);
}

export async function detectBootstrapStatus(
	dependencies: BootstrapDependencies = {}
): Promise<BootstrapStatus> {
	const agentDirectory = dependencies.agentDirectory ?? getPiAgentDirectory();
	const commandExists = dependencies.commandExists ?? defaultCommandExists;
	const commandVersion = dependencies.commandVersion ?? defaultCommandVersion;
	const readJson = dependencies.readJson ?? defaultReadJson;
	const fileExists = dependencies.fileExists ?? defaultFileExists;
	const readDirectory = dependencies.readDirectory ?? defaultReadDirectory;
	const nodeCommand = platform() === 'win32' ? 'node.exe' : 'node';
	const nodeAvailable = await commandExists(nodeCommand);
	const nodeVersion = dependencies.nodeVersion ?? (await commandVersion(nodeCommand)) ?? '';
	const prerequisites = {
		node: nodeAvailable && meetsMinimumNodeVersion(nodeVersion),
		npm: await commandExists(platform() === 'win32' ? 'npm.cmd' : 'npm'),
		pi: await commandExists(platform() === 'win32' ? 'pi.cmd' : 'pi')
	};
	const missingPackages: string[] = [];
	for (const packageName of REQUIRED_PI_PACKAGES) {
		if (
			!(await hasInstalledPackage(packageName, agentDirectory, readJson, fileExists, readDirectory))
		) {
			missingPackages.push(packageName);
		}
	}

	const permissionConfig = await hasValidPermissionConfig(
		agentDirectory,
		dependencies.sharedPermissionConfigPath,
		readJson,
		fileExists
	);
	const configured =
		prerequisites.node &&
		prerequisites.npm &&
		prerequisites.pi &&
		missingPackages.length === 0 &&
		permissionConfig;

	return {
		phase: configured ? 'ready' : 'needs-setup',
		configured,
		prerequisites,
		missingPackages,
		permissionConfig
	};
}

function splitOutput(
	buffer: { stdout: string; stderr: string },
	stream: 'stdout' | 'stderr',
	text: string,
	onOutput: BootstrapRunnerOptions['onOutput']
): void {
	buffer[stream] += text;
	const lines = buffer[stream].split(/\r?\n/);
	buffer[stream] = lines.pop() ?? '';
	for (const line of lines) {
		onOutput(stream, line ? `${line}\n` : '');
	}
}

export async function runBootstrap(options: BootstrapRunnerOptions): Promise<void> {
	const isWindows = platform() === 'win32';
	const script = isWindows
		? join(options.resourceRoot, 'pi_setup', 'Windows', 'pi-install.ps1')
		: join(options.resourceRoot, 'pi_setup', 'Linux', 'pi-install.sh');
	const command = isWindows ? 'powershell.exe' : 'bash';
	const args = isWindows
		? ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script]
		: [script];
	const buffer = { stdout: '', stderr: '' };
	options.onOutput('system', 'Checking Node.js, npm, Pi, and extension prerequisites…\n');

	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, {
			env: { ...process.env, ...options.env },
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true
		});
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (text: string) =>
			splitOutput(buffer, 'stdout', text, options.onOutput)
		);
		child.stderr.on('data', (text: string) =>
			splitOutput(buffer, 'stderr', text, options.onOutput)
		);
		child.once('error', reject);
		child.once('close', (code, signal) => {
			if (buffer.stdout) {
				options.onOutput('stdout', buffer.stdout);
			}

			if (buffer.stderr) {
				options.onOutput('stderr', buffer.stderr);
			}

			if (code === 0) {
				resolve();
			} else {
				reject(
					new Error(
						`Pi setup ${signal ? `was terminated by ${signal}` : `exited with code ${code ?? 'unknown'}`}.`
					)
				);
			}
		});
	});
}

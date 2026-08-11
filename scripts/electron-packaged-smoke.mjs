import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const executable =
	process.env.ELECTRON_PACKAGED_BINARY ??
	(process.platform === 'win32'
		? join(projectRoot, 'release', 'win-unpacked', 'Pi Squared.exe')
		: join(projectRoot, 'release', 'linux-unpacked', 'pi-squared'));
await access(executable);

const electron = spawn(executable, process.platform === 'linux' ? ['--no-sandbox'] : [], {
	cwd: projectRoot,
	env: { ...process.env, PI_SQUARED_PACKAGED_SMOKE: '1' },
	stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
let ready = false;
const fatalPattern = /Unable to start|Unable to load preload|ERR_MODULE|SyntaxError/;
electron.stdout.setEncoding('utf8');
electron.stderr.setEncoding('utf8');
electron.stdout.on('data', (chunk) => {
	output += chunk;
	if (chunk.includes('"type":"desktop-ready"')) {
		ready = true;
	}
});
electron.stderr.on('data', (chunk) => {
	output += chunk;
});

try {
	await new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error('Packaged Electron smoke test timed out.')),
			15_000
		);
		const onExit = (code, signal) => {
			clearTimeout(timeout);
			reject(new Error(`Packaged Electron exited before readiness (${code ?? signal}).`));
		};

		electron.once('exit', onExit);
		const check = setInterval(() => {
			if (ready) {
				clearTimeout(timeout);
				clearInterval(check);
				electron.off('exit', onExit);
				resolve();
			}
		}, 50);
	});
	if (fatalPattern.test(output)) {
		throw new Error(`Packaged Electron reported a startup failure:\n${output}`);
	}

	console.log('Packaged Electron smoke passed.');
} finally {
	if (electron.exitCode === null && electron.signalCode === null) {
		electron.kill('SIGTERM');
		await new Promise((resolve) => electron.once('exit', resolve));
	}
}

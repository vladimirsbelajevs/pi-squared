import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const electronCommand =
	process.platform === 'win32'
		? join(projectRoot, 'node_modules', '.bin', 'electron.cmd')
		: join(projectRoot, 'node_modules', '.bin', 'electron');
const devUrl = 'http://127.0.0.1:5173';

const vite = spawn(npmCommand, ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173'], {
	cwd: projectRoot,
	stdio: 'inherit',
	env: { ...process.env, HOST: '127.0.0.1', PI_SQUARED_DESKTOP: '1' }
});
let electron;
let shuttingDown = false;
function shutdown(code = 0) {
	if (shuttingDown) {
		return;
	}

	shuttingDown = true;
	if (!vite.killed) {
		vite.kill('SIGTERM');
	}

	if (electron && !electron.killed) {
		electron.kill('SIGTERM');
	}

	process.exitCode = code;
}

process.once('SIGINT', () => shutdown(130));
process.once('SIGTERM', () => shutdown(143));
vite.once('error', () => shutdown(1));

let ready = false;
for (let attempt = 0; attempt < 100; attempt += 1) {
	try {
		const response = await fetch(`${devUrl}/api/health`);
		if (response.ok) {
			ready = true;
			break;
		}
	} catch {
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

if (!ready) {
	shutdown(1);
	throw new Error('Vite did not start its local server.');
}

electron = spawn(electronCommand, ['electron/dist/electron/main.js'], {
	cwd: projectRoot,
	stdio: 'inherit',
	env: { ...process.env, PI_SQUARED_ELECTRON_DEV_URL: devUrl }
});
electron.once('exit', (code) => shutdown(code ?? 1));

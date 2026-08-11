import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const entry = join(projectRoot, 'electron', 'dist', 'electron', 'server-entry.js');
const gatewaySecret = randomBytes(32).toString('hex');
await access(entry);

const electron = spawn(process.execPath, [entry], {
	cwd: projectRoot,
	env: {
		...process.env,
		ELECTRON_RUN_AS_NODE: '1',
		HOST: '127.0.0.1',
		PORT: '0',
		PI_SQUARED_DESKTOP: '1',
		PI_SQUARED_SHUTDOWN_TOKEN: 'smoke-token',
		PI_SQUARED_GATEWAY_SECRET: gatewaySecret,
		PI_SQUARED_RENDERER_SECRET: randomBytes(32).toString('hex'),
		PI_SQUARED_BUILD_DIR: join(projectRoot, 'build')
	},
	stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
let errorOutput = '';
electron.stdout.setEncoding('utf8');
electron.stderr.setEncoding('utf8');
electron.stdout.on('data', (chunk) => (output += chunk));
electron.stderr.on('data', (chunk) => (errorOutput += chunk));

const port = await new Promise((resolve, reject) => {
	const timeout = setTimeout(
		() => reject(new Error('Electron server smoke test timed out.')),
		15_000
	);
	const onData = () => {
		const match = output.match(/\{"type":"ready","port":(\d+)\}/);
		if (!match) {
			return;
		}

		clearTimeout(timeout);
		electron.stdout.off('data', onData);
		resolve(Number(match[1]));
	};

	electron.stdout.on('data', onData);
	electron.once('error', reject);
	electron.once('exit', (code, signal) =>
		reject(new Error(`Electron server exited before readiness (${code ?? signal}). ${errorOutput}`))
	);
});

try {
	const baseUrl = `http://127.0.0.1:${port}`;
	const internalHeaders = { 'x-pi-squared-internal-auth': gatewaySecret };
	const health = await fetch(`${baseUrl}/__pi_squared_health`, { headers: internalHeaders });
	if (!health.ok || (await health.text()) !== 'ok') {
		throw new Error(`Unexpected Electron health response: ${health.status}`);
	}

	const updateStatus = await fetch(`${baseUrl}/api/application/update`, {
		headers: internalHeaders
	});
	const status = await updateStatus.json();
	if (!updateStatus.ok || status.mode !== 'electron' || status.supported !== false) {
		throw new Error(`Unexpected desktop update mode: ${JSON.stringify(status)}`);
	}

	const disabledUpdate = await fetch(`${baseUrl}/api/application/update`, {
		method: 'POST',
		headers: { ...internalHeaders, Origin: baseUrl, 'Sec-Fetch-Site': 'same-origin' }
	});
	if (disabledUpdate.status !== 501) {
		throw new Error(`Packaged update endpoint was not disabled: ${disabledUpdate.status}`);
	}

	const shutdown = await fetch(`${baseUrl}/api/application/shutdown`, {
		method: 'POST',
		headers: {
			Origin: baseUrl,
			'Sec-Fetch-Site': 'same-origin',
			...internalHeaders,
			'x-pi-squared-shutdown-token': 'smoke-token'
		}
	});
	if (shutdown.status !== 200) {
		throw new Error(`Packaged shutdown endpoint failed: ${shutdown.status}`);
	}

	console.log(`Electron server smoke passed on port ${port}.`);
} finally {
	if (electron.exitCode === null && electron.signalCode === null) {
		electron.kill('SIGTERM');
		await new Promise((resolve) => electron.once('exit', resolve));
	}
}

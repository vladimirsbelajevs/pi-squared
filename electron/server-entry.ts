import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 0);
const buildDirectory = resolve(
	process.env.PI_SQUARED_BUILD_DIR ??
		join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'build')
);

interface SvelteKitHandler {
	(request: IncomingMessage, response: ServerResponse): void | Promise<void>;
}

let requestHandlerPromise: Promise<SvelteKitHandler> | undefined;
let listeningPort: number | undefined;
const server = createServer((request, response) => {
	const requestUrl = new URL(request.url ?? '/', `http://${host}`);
	if (requestUrl.pathname === '/__pi_squared_health') {
		response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' });
		response.end('ok');

		return;
	}

	if (!requestHandlerPromise) {
		response.writeHead(503, { 'Content-Type': 'text/plain' });
		response.end('Pi Squared server is still starting.');

		return;
	}

	void requestHandlerPromise
		.then((handler) => handler(request, response))
		.catch((error: unknown) => {
			if (!response.headersSent) {
				response.writeHead(500, { 'Content-Type': 'text/plain' });
			}

			response.end(error instanceof Error ? error.message : 'Pi Squared request failed.');
		});
});

let closing = false;
async function shutdown(): Promise<void> {
	if (closing) {
		return;
	}

	closing = true;
	if (listeningPort && process.env.PI_SQUARED_SHUTDOWN_TOKEN && requestHandlerPromise) {
		try {
			await fetch(`http://${host}:${listeningPort}/api/application/shutdown`, {
				method: 'POST',
				headers: {
					Origin: `http://${host}:${listeningPort}`,
					'Sec-Fetch-Site': 'same-origin',
					'x-pi-squared-shutdown-token': process.env.PI_SQUARED_SHUTDOWN_TOKEN
				},
				signal: AbortSignal.timeout(5_000)
			});
		} catch (error) {
			console.error('Pi Squared runtime shutdown request failed:', error);
		}
	}

	server.closeIdleConnections?.();
	server.closeAllConnections?.();
	await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
	process.exit(0);
}

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());

server.listen(port, host, () => {
	const address = server.address();
	if (!address || typeof address === 'string') {
		console.error('Pi Squared server did not receive a TCP address.');
		process.exit(1);

		return;
	}

	// The adapter reads ORIGIN while its handler module is imported. Set it after
	// selecting the ephemeral port so same-origin API checks include that port.
	process.env.ORIGIN = `http://${host}:${address.port}`;
	listeningPort = address.port;
	requestHandlerPromise = import(pathToFileURL(join(buildDirectory, 'handler.js')).href).then(
		(module) => (module as { handler: SvelteKitHandler }).handler
	);
	void requestHandlerPromise
		.then(() => console.log(JSON.stringify({ type: 'ready', port: address.port })))
		.catch((error: unknown) => {
			console.error('Pi Squared server handler failed to load:', error);
			process.exit(1);
		});
});

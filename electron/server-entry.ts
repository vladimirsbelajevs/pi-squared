import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { isLoopbackRequestAuthenticated } from './loopback-auth.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 0);
const buildDirectory = resolve(
	process.env.PI_SQUARED_BUILD_DIR ??
		join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'build')
);

interface SvelteKitHandler {
	(request: IncomingMessage, response: ServerResponse): void | Promise<void>;
}

interface LoadedHandler {
	handler: SvelteKitHandler;
	handleWebSocket?: (request: IncomingMessage, socket: WebSocket) => void | Promise<void>;
}

function requestHeaders(request: IncomingMessage): Headers {
	const headers = new Headers();
	for (const [name, value] of Object.entries(request.headers)) {
		if (value !== undefined) {
			headers.set(name, Array.isArray(value) ? value.join(', ') : value);
		}
	}

	return headers;
}

function rejectUpgrade(
	socket: import('node:stream').Duplex,
	status: number,
	message: string
): void {
	socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
	socket.destroy();
}

let requestHandlerPromise: Promise<LoadedHandler> | undefined;
let listeningPort: number | undefined;
const websocketServer = new WebSocketServer({ noServer: true });
const server = createServer((request, response) => {
	if (!isLoopbackRequestAuthenticated(requestHeaders(request))) {
		response.writeHead(401, { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' });
		response.end('Unauthorized');

		return;
	}

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
		.then(({ handler }) => handler(request, response))
		.catch((error: unknown) => {
			if (!response.headersSent) {
				response.writeHead(500, { 'Content-Type': 'text/plain' });
			}

			response.end(error instanceof Error ? error.message : 'Pi Squared request failed.');
		});
});

server.on('upgrade', (request, socket, head) => {
	if (!isLoopbackRequestAuthenticated(requestHeaders(request))) {
		rejectUpgrade(socket, 401, 'Unauthorized');

		return;
	}

	if (!requestHandlerPromise) {
		rejectUpgrade(socket, 503, 'Service Unavailable');

		return;
	}

	void requestHandlerPromise
		.then(({ handleWebSocket }) => {
			websocketServer.handleUpgrade(request, socket, head, (client) => {
				if (!handleWebSocket) {
					// The application currently uses SSE, but accepting the authenticated
					// upgrade keeps the seam functional for future app WebSocket routes.
					client.close(1000, 'No WebSocket route');

					return;
				}

				void Promise.resolve(handleWebSocket(request, client)).catch((error: unknown) => {
					client.close(1011, error instanceof Error ? error.message : 'WebSocket handler failed');
				});
			});
		})
		.catch(() => rejectUpgrade(socket, 500, 'Internal Server Error'));
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
					'x-pi-squared-shutdown-token': process.env.PI_SQUARED_SHUTDOWN_TOKEN,
					'x-pi-squared-internal-auth': process.env.PI_SQUARED_GATEWAY_SECRET ?? ''
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

	process.env.ORIGIN = `http://${host}:${address.port}`;
	listeningPort = address.port;
	requestHandlerPromise = import(pathToFileURL(join(buildDirectory, 'handler.js')).href).then(
		(module) => ({
			handler: (module as { handler: SvelteKitHandler }).handler,
			handleWebSocket: (module as { handleWebSocket?: LoadedHandler['handleWebSocket'] })
				.handleWebSocket
		})
	);
	void requestHandlerPromise
		.then(() => console.log(JSON.stringify({ type: 'ready', port: address.port })))
		.catch((error: unknown) => {
			console.error('Pi Squared server handler failed to load:', error);
			process.exit(1);
		});
});

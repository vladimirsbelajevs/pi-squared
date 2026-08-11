import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { TLSSocket } from 'node:tls';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import ciao from '@homebridge/ciao';
import {
	defaultSelectedAddress,
	inventoryAddresses,
	normalizeBinding,
	validateDnsName,
	isAllowedExternalHost,
	type LanAddress,
	type SelectedBinding
} from './lan-addresses.js';
import { CertificateManager, certificateFiles, type CertificateState } from './tls-certificates.js';
import { KeyEnvelopeStore, type SafeStorageAdapter } from './key-envelopes.js';
import { PairingManager, type PairingPublicSnapshot } from './pairing.js';
import {
	constantTimeSecretEquals,
	parseCookieHeader,
	stripCookies,
	RENDERER_COOKIE,
	GATEWAY_AUTH_HEADER
} from './loopback-auth.js';

export const DEFAULT_LAN_PORT = 3049;
export const DEVICE_COOKIE = '__Host-pi-squared-device';
const RESERVED_PREFIX = '/__pi-squared/pair/';
const DEVICE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
const GATEWAY_COOKIES = new Set([DEVICE_COOKIE, RENDERER_COOKIE]);
const FORWARDED_HEADERS = new Set([
	'forwarded',
	'host',
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade',
	GATEWAY_AUTH_HEADER
]);

export interface LanSharingConfig {
	enabled: boolean;
	port: number;
	bindings: SelectedBinding[];
	dnsNames: string[];
}
export type ListenerState = 'listening' | 'missing' | 'error' | 'stopped';
export interface LanListenerStatus {
	binding: SelectedBinding;
	state: ListenerState;
	error?: string;
	url?: string;
}
export interface LanSharingStatus {
	available: LanAddress[];
	config: LanSharingConfig;
	listeners: LanListenerStatus[];
	urls: string[];
	caFingerprint?: string;
	caNotAfter?: string;
	leafNotAfter?: string;
	keyProtectionWarning?: string;
	pairing: PairingPublicSnapshot;
}
export interface LanSharingManagerOptions {
	dataDirectory: string;
	upstreamUrl: string;
	gatewaySecret: string;
	safeStorage?: SafeStorageAdapter;
	addresses?: () => LanAddress[];
	onStatus?: (status: LanSharingStatus) => void;
}

function json(
	response: ServerResponse,
	status: number,
	body: unknown,
	headers: Record<string, string> = {}
): void {
	const text = JSON.stringify(body);
	response.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
		...headers
	});
	response.end(text);
}

function pairingHeaders(): Record<string, string> {
	return {
		'Content-Security-Policy':
			"default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
		'X-Content-Type-Options': 'nosniff',
		'X-Frame-Options': 'DENY',
		'Referrer-Policy': 'no-referrer',
		'Cache-Control': 'no-store'
	};
}

function deviceCookie(value: string): string {
	return `${DEVICE_COOKIE}=${value}; Max-Age=${DEVICE_MAX_AGE_SECONDS}; Secure; HttpOnly; SameSite=Strict; Path=/`;
}

function normalizeHost(host: string): string {
	const value = host.trim().toLowerCase();
	if (value.startsWith('[') && value.endsWith(']')) {
		return value.slice(1, -1);
	}

	return value.replace(/:\d+$/, '');
}

function hostWithPort(host: string, port: number): string {
	return host.includes(':') && !host.startsWith('[') ? `[${host}]:${port}` : `${host}:${port}`;
}

function exactExternalOrigin(
	request: IncomingMessage,
	port: number,
	bindings: SelectedBinding[],
	dnsNames: string[]
): { host: string; origin: string } | undefined {
	if (!(request.socket as TLSSocket).encrypted) {
		return undefined;
	}

	const authority = request.headers.host;
	if (!authority || /[\s\\/#?]/.test(authority)) {
		return undefined;
	}

	let url: URL;
	try {
		url = new URL(`https://${authority}`);
	} catch {
		return undefined;
	}

	// The active listener port is part of the authority contract. Userinfo and
	// implicit/default ports are rejected rather than normalized.
	if (url.username || url.password || !url.port || Number(url.port) !== port) {
		return undefined;
	}

	const host = normalizeHost(url.hostname);
	if (!isAllowedExternalHost(host, bindings, dnsNames)) {
		return undefined;
	}

	return { host, origin: `https://${hostWithPort(host, port)}` };
}

function parseJsonBody(
	request: IncomingMessage,
	maxBytes: number
): Promise<Record<string, unknown>> {
	const type = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
	if (type !== 'application/json') {
		return Promise.reject(new Error('Content-Type must be application/json.'));
	}

	const declared = request.headers['content-length'];
	if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
		return Promise.reject(new Error('Request body is too large.'));
	}

	return new Promise((resolve, reject) => {
		let total = 0;
		const chunks: Buffer[] = [];
		request.on('data', (chunk: Buffer) => {
			total += chunk.length;
			if (total > maxBytes) {
				request.destroy();
				reject(new Error('Request body is too large.'));

				return;
			}

			chunks.push(chunk);
		});
		request.on('end', () => {
			try {
				const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
				if (!value || typeof value !== 'object' || Array.isArray(value)) {
					throw new Error('Expected a JSON object.');
				}

				resolve(value as Record<string, unknown>);
			} catch (error) {
				reject(error);
			}
		});
		request.on('error', reject);
	});
}

function validDeviceName(value: unknown): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error('deviceName is required.');
	}

	return value.trim().slice(0, 120);
}

function stripForwardedHeaders(
	headers: IncomingMessage['headers'],
	upstreamOrigin: string,
	gatewaySecret: string
): Record<string, string | string[]> {
	const result: Record<string, string | string[]> = {};
	for (const [key, value] of Object.entries(headers)) {
		const lowerKey = key.toLowerCase();
		if (
			FORWARDED_HEADERS.has(lowerKey) ||
			lowerKey === 'forwarded' ||
			lowerKey.startsWith('x-forwarded-') ||
			value === undefined
		) {
			continue;
		}

		if (lowerKey === 'cookie') {
			const cookieHeader = Array.isArray(value) ? value.join('; ') : value;
			const kept = stripCookies(cookieHeader, GATEWAY_COOKIES);
			if (kept) {
				result.cookie = kept;
			}

			continue;
		}

		result[key] = value;
	}

	result.host = new URL(upstreamOrigin).host;
	result.origin = upstreamOrigin;
	result[GATEWAY_AUTH_HEADER] = gatewaySecret;

	return result;
}

function rewriteLocation(
	value: string | undefined,
	upstreamOrigin: string,
	externalOrigin: string
): string | undefined {
	if (!value) {
		return undefined;
	}

	try {
		const parsed = new URL(value, upstreamOrigin);
		if (parsed.origin !== upstreamOrigin) {
			return value;
		}

		return `${externalOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return value;
	}
}

class Gateway {
	private readonly servers = new Map<string, HttpsServer>();
	private readonly sockets = new Set<Duplex>();
	private readonly socketServers = new Map<Duplex, HttpsServer>();
	private readonly socketCredentials = new Map<Duplex, string>();
	private readonly webSockets = new Set<WebSocket>();
	private readonly webSocketServers = new Map<WebSocket, HttpsServer>();
	private readonly webSocketCredentials = new Map<WebSocket, string>();
	private readonly activeProxies = new Map<
		IncomingMessage,
		{ response: ServerResponse; client?: ReturnType<typeof httpRequest>; credentialHash: string }
	>();
	private readonly wss = new WebSocketServer({
		noServer: true,
		handleProtocols: (protocols) => protocols.values().next().value ?? false
	});
	private service?: ReturnType<ReturnType<typeof ciao.getResponder>['createService']>;
	private responder?: ReturnType<typeof ciao.getResponder>;
	constructor(
		private readonly manager: LanSharingManager,
		private readonly options: { config: LanSharingConfig; certificate: CertificateState }
	) {}

	async start(): Promise<Map<string, ListenerState>> {
		const result = new Map<string, ListenerState>();
		try {
			await this.startBindings(this.options.config.bindings);
		} catch (error) {
			await this.stop();
			throw error;
		}

		for (const binding of this.options.config.bindings) {
			result.set(binding.address, 'listening');
		}

		return result;
	}

	activeBindings(): SelectedBinding[] {
		return [...this.servers.keys()].map((key) => {
			const [interfaceName, address, family] = key.split('|');

			return { interfaceName, address, family: family as SelectedBinding['family'] };
		});
	}

	async startBindings(bindings: SelectedBinding[]): Promise<void> {
		const started: Array<{ key: string; server: HttpsServer }> = [];
		try {
			for (const binding of bindings) {
				const key = this.bindingKey(binding);
				if (this.servers.has(key)) {
					continue;
				}

				started.push({ key, server: await this.listen(binding) });
			}
		} catch (error) {
			for (const item of started) {
				this.servers.delete(item.key);
			}

			await Promise.all(started.map((item) => this.closeServer(item.server)));
			throw error;
		}

		this.refreshMdns();
	}

	private bindingKey(binding: SelectedBinding): string {
		return `${binding.interfaceName}|${binding.address}|${binding.family}`;
	}

	private async closeServer(server: HttpsServer): Promise<void> {
		for (const [socket, owner] of this.socketServers) {
			if (owner === server) {
				socket.destroy();
			}
		}

		for (const [socket, owner] of this.webSocketServers) {
			if (owner === server) {
				socket.close(1001, 'Listener retired');
			}
		}

		server.closeIdleConnections?.();
		server.closeAllConnections?.();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}

	async stopBindings(bindings: SelectedBinding[]): Promise<void> {
		const keys = new Set(bindings.map((binding) => this.bindingKey(binding)));
		const servers = [...this.servers.entries()].filter(([key]) => keys.has(key));
		for (const [key, server] of servers) {
			this.servers.delete(key);
			await this.closeServer(server);
		}

		this.refreshMdns();
	}

	private async listen(binding: SelectedBinding): Promise<HttpsServer> {
		const server = createHttpsServer(
			{
				key: this.options.certificate.leafKey,
				cert: `${this.options.certificate.leafCertificate}\n${this.options.certificate.caCertificate}`
			},
			(request, response) => void this.handle(request, response)
		);
		server.on('connection', (socket) => {
			this.sockets.add(socket);
			this.socketServers.set(socket, server);
			socket.once('close', () => {
				this.sockets.delete(socket);
				this.socketServers.delete(socket);
				this.socketCredentials.delete(socket);
			});
		});
		server.on('upgrade', (request, socket, head) => void this.handleUpgrade(request, socket, head));
		try {
			await new Promise<void>((resolve, reject) => {
				server.once('error', reject);
				server.listen(
					{
						host: binding.address,
						port: this.options.config.port,
						ipv6Only: binding.family === 'IPv6'
					},
					() => resolve()
				);
			});
		} catch (error) {
			await this.closeServer(server).catch(() => undefined);
			throw error;
		}

		this.servers.set(this.bindingKey(binding), server);

		return server;
	}

	private refreshMdns(): void {
		void this.endMdns().then(() => {
			if (this.servers.size) {
				this.startMdns();
			}
		});
	}

	private async endMdns(): Promise<void> {
		await this.service?.end().catch(() => undefined);
		this.service = undefined;
		await this.responder?.shutdown().catch(() => undefined);
		this.responder = undefined;
	}

	private startMdns(): void {
		const successful = this.activeBindings();
		if (!successful.length) {
			return;
		}

		try {
			this.responder = ciao.getResponder({
				interface: [...new Set(successful.map((binding) => binding.interfaceName))]
			});
			this.service = this.responder.createService({
				name: 'Pi Squared',
				type: 'http',
				port: this.options.config.port,
				restrictedAddresses: successful.map((binding) => binding.address),
				txt: { product: 'Pi Squared', tls: '1' }
			});
			void this.service.advertise().catch(() => undefined);
		} catch {
			/* mDNS is explicitly non-fatal */
		}
	}

	currentCertificate(): CertificateState {
		return this.options.certificate;
	}

	currentConfig(): LanSharingConfig {
		return {
			...this.options.config,
			bindings: this.options.config.bindings.map((binding) => ({ ...binding })),
			dnsNames: [...this.options.config.dnsNames]
		};
	}

	hasBindings(bindings: SelectedBinding[]): boolean {
		const keys = new Set(
			bindings.map((binding) => `${binding.interfaceName}|${binding.address}|${binding.family}`)
		);

		return keys.size === this.servers.size && [...keys].every((key) => this.servers.has(key));
	}

	updateSecureContext(certificate: CertificateState, config: LanSharingConfig): void {
		this.options.certificate = certificate;
		this.options.config = config;
		const secureContext = {
			key: certificate.leafKey,
			cert: `${certificate.leafCertificate}\n${certificate.caCertificate}`
		};
		for (const server of this.servers.values()) {
			server.setSecureContext(secureContext);
		}

		this.refreshMdns();
	}

	async stop(): Promise<void> {
		await this.endMdns();

		for (const socket of this.sockets) {
			socket.destroy();
		}

		for (const proxy of this.activeProxies.values()) {
			proxy.client?.destroy();
			proxy.response.destroy();
		}

		this.activeProxies.clear();
		for (const socket of this.webSockets) {
			socket.close(1001, 'Gateway stopped');
		}

		this.webSocketCredentials.clear();
		this.webSocketServers.clear();
		this.socketCredentials.clear();
		this.socketServers.clear();
		await Promise.all([...this.servers.values()].map((server) => this.closeServer(server)));
		this.servers.clear();
	}

	private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const config = this.options.config;
		const authority = exactExternalOrigin(request, config.port, config.bindings, config.dnsNames);
		if (!authority) {
			json(response, 421, { error: 'The TLS authority is not allowed.' });

			return;
		}

		const pathname = new URL(request.url ?? '/', authority.origin).pathname;
		if (pathname.startsWith(RESERVED_PREFIX)) {
			await this.handlePairing(request, response, pathname, authority.origin, authority.host);

			return;
		}

		if (pathname.startsWith('/__pi-squared/pair')) {
			json(response, 404, { error: 'Not found.' });

			return;
		}

		if (!this.checkExternalOrigin(request, authority.origin)) {
			json(response, 403, { error: 'Unexpected request origin.' });

			return;
		}

		const credential = parseCookieHeader(request.headers.cookie, DEVICE_COOKIE);
		const refreshCookie =
			!!credential && this.manager.pairing.shouldRefresh(credential, authority.host);
		const device = credential
			? this.manager.pairing.authenticate(credential, authority.host)
			: undefined;
		if (!device) {
			json(response, 401, { error: 'A trusted device pairing is required.' });

			return;
		}

		this.socketCredentials.set(request.socket, device.credentialHash);
		request.socket.once('close', () => this.socketCredentials.delete(request.socket));
		this.proxy(
			request,
			response,
			authority.origin,
			device.credentialHash,
			refreshCookie,
			credential
		);
	}

	private checkExternalOrigin(request: IncomingMessage, origin: string): boolean {
		const supplied = request.headers.origin;
		if (supplied && supplied !== origin) {
			return false;
		}

		if (
			request.method &&
			!['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
			supplied !== origin
		) {
			return false;
		}

		return true;
	}

	private async handlePairing(
		request: IncomingMessage,
		response: ServerResponse,
		pathname: string,
		origin: string,
		host: string
	): Promise<void> {
		const headers = pairingHeaders();
		if (pathname === '/__pi-squared/pair/' && request.method === 'GET') {
			response.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
			response.end(PAIRING_PAGE);

			return;
		}

		if (pathname === '/__pi-squared/pair/request' && request.method === 'POST') {
			if (request.headers.origin !== origin) {
				json(response, 403, { error: 'Exact Origin is required.' }, headers);

				return;
			}

			try {
				const body = await parseJsonBody(request, 8 * 1024);
				const result = await this.manager.pairing.createRequest(
					host,
					validDeviceName(body.deviceName)
				);
				this.manager.emitStatus();
				json(response, 201, { nonce: result.nonce, expiresAt: result.expiresAt }, headers);
			} catch (error) {
				json(
					response,
					400,
					{ error: error instanceof Error ? error.message : 'Invalid pairing request.' },
					headers
				);
			}

			return;
		}

		const statusMatch = pathname.match(/^\/__pi-squared\/pair\/request\/([^/]+)$/);
		if (statusMatch && request.method === 'GET') {
			const pending = this.manager.pairing.getRequest(statusMatch[1]);
			if (!pending) {
				json(response, 404, { error: 'Pairing request not found.' }, headers);

				return;
			}

			json(
				response,
				200,
				{ nonce: pending.nonce, status: pending.status, expiresAt: pending.expiresAt },
				headers
			);

			return;
		}

		if (pathname === '/__pi-squared/pair/complete' && request.method === 'POST') {
			if (request.headers.origin !== origin) {
				json(response, 403, { error: 'Exact Origin is required.' }, headers);

				return;
			}

			try {
				const body = await parseJsonBody(request, 8 * 1024);
				const nonce = typeof body.nonce === 'string' ? body.nonce : '';
				const result = await this.manager.pairing.complete(nonce, host);
				json(
					response,
					200,
					{ ok: true },
					{ ...headers, 'Set-Cookie': deviceCookie(result.credential) }
				);
			} catch (error) {
				json(
					response,
					400,
					{ error: error instanceof Error ? error.message : 'Pairing completion failed.' },
					headers
				);
			}

			return;
		}

		if (pathname === '/__pi-squared/pair/code' && request.method === 'POST') {
			if (request.headers.origin !== origin) {
				json(response, 403, { error: 'Exact Origin is required.' }, headers);

				return;
			}

			try {
				const body = await parseJsonBody(request, 8 * 1024);
				const code = typeof body.code === 'string' ? body.code : '';
				const result = await this.manager.pairing.redeemCode(code, host);
				json(
					response,
					200,
					{ ok: true },
					{ ...headers, 'Set-Cookie': deviceCookie(result.credential) }
				);
			} catch (error) {
				json(
					response,
					400,
					{ error: error instanceof Error ? error.message : 'Pairing code redemption failed.' },
					headers
				);
			}

			return;
		}

		json(response, 404, { error: 'Not found.' }, headers);
	}

	private proxy(
		request: IncomingMessage,
		response: ServerResponse,
		externalOrigin: string,
		credentialHash: string,
		refreshCookie: boolean,
		credential: string | undefined
	): void {
		const target = new URL(this.manager.upstreamUrl);
		const headers = stripForwardedHeaders(
			request.headers,
			target.origin,
			this.manager.gatewaySecret
		);
		const client = httpRequest(
			{
				protocol: target.protocol,
				hostname: target.hostname,
				port: target.port,
				method: request.method,
				path: request.url,
				headers
			},
			(upstream) => {
				const responseHeaders: Record<string, string | string[]> = {};
				for (const [key, value] of Object.entries(upstream.headers)) {
					if (value === undefined || key === GATEWAY_AUTH_HEADER || key === 'connection') {
						continue;
					}

					if (key === 'set-cookie') {
						const cookies = (Array.isArray(value) ? value : [value]).filter((cookie) => {
							const separator = cookie.indexOf('=');

							return separator === -1 || !GATEWAY_COOKIES.has(cookie.slice(0, separator).trim());
						});
						if (cookies.length) {
							responseHeaders[key] = cookies;
						}

						continue;
					}

					if (key === 'location') {
						responseHeaders[key] =
							rewriteLocation(
								Array.isArray(value) ? value[0] : value,
								target.origin,
								externalOrigin
							) ?? '';
						continue;
					}

					responseHeaders[key] = value;
				}

				if (refreshCookie && credential) {
					const existing = responseHeaders['set-cookie'];
					responseHeaders['set-cookie'] = [
						...(Array.isArray(existing) ? existing : existing ? [existing] : []),
						deviceCookie(credential)
					];
				}

				response.writeHead(upstream.statusCode ?? 502, responseHeaders);
				upstream.pipe(response);
			}
		);
		const activeProxy = { response, client, credentialHash };
		this.activeProxies.set(request, activeProxy);
		const cleanup = () => this.activeProxies.delete(request);
		request.once('aborted', () => {
			cleanup();
			client.destroy();
		});
		response.once('close', () => {
			if (!response.writableEnded) {
				cleanup();
				client.destroy();
			}
		});
		client.once('close', cleanup);
		client.once('error', (error) => {
			if (!response.headersSent) {
				json(response, 502, { error: 'The local application is unavailable.' });
			} else {
				response.destroy(error);
			}
		});
		request.pipe(client);
	}

	private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
		const authority = exactExternalOrigin(
			request,
			this.options.config.port,
			this.options.config.bindings,
			this.options.config.dnsNames
		);
		if (!authority || request.headers.origin !== authority.origin) {
			socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
			socket.destroy();

			return;
		}

		const credential = parseCookieHeader(request.headers.cookie, DEVICE_COOKIE);
		if (!credential || !this.manager.pairing.authenticate(credential, authority.host)) {
			socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
			socket.destroy();

			return;
		}

		this.wss.handleUpgrade(request, socket, head, (client) => {
			this.webSockets.add(client);
			const owner = this.socketServers.get(request.socket);
			if (owner) {
				this.webSocketServers.set(client, owner);
			}

			const credentialHash = this.manager.credentialHashForRequest(request, authority.host);
			if (credentialHash) {
				this.webSocketCredentials.set(client, credentialHash);
				this.socketCredentials.set(request.socket, credentialHash);
				request.socket.once('close', () => this.socketCredentials.delete(request.socket));
			}

			client.once('close', () => {
				this.webSockets.delete(client);
				this.webSocketServers.delete(client);
				this.webSocketCredentials.delete(client);
			});
			const target = new URL(this.manager.upstreamUrl);
			const upstreamHeaders = stripForwardedHeaders(
				request.headers,
				target.origin,
				this.manager.gatewaySecret
			);
			for (const header of [
				'host',
				'origin',
				'connection',
				'upgrade',
				'sec-websocket-key',
				'sec-websocket-version',
				'sec-websocket-extensions',
				'sec-websocket-protocol'
			]) {
				delete upstreamHeaders[header];
			}

			const protocolHeader = request.headers['sec-websocket-protocol'];
			const protocols = (
				Array.isArray(protocolHeader) ? protocolHeader.join(',') : (protocolHeader ?? '')
			)
				.split(',')
				.map((protocol) => protocol.trim())
				.filter(Boolean);

			const upstreamUrl = `${target.protocol === 'https:' ? 'wss' : 'ws'}://${target.host}${request.url}`;
			const upstream = protocols.length
				? new WebSocket(upstreamUrl, protocols, {
						headers: upstreamHeaders,
						origin: target.origin
					})
				: new WebSocket(upstreamUrl, {
						headers: upstreamHeaders,
						origin: target.origin
					});

			const pendingMessages: Array<{ data: WebSocket.RawData; isBinary: boolean }> = [];
			client.on('message', (data, isBinary) => {
				if (upstream.readyState === WebSocket.OPEN) {
					upstream.send(data, { binary: isBinary });
				} else if (upstream.readyState === WebSocket.CONNECTING && pendingMessages.length < 32) {
					pendingMessages.push({ data, isBinary });
				}
			});
			upstream.once('open', () => {
				for (const message of pendingMessages.splice(0)) {
					upstream.send(message.data, { binary: message.isBinary });
				}
			});
			upstream.on('message', (data, isBinary) => {
				if (client.readyState === WebSocket.OPEN) {
					client.send(data, { binary: isBinary });
				}
			});
			client.on('close', () => upstream.close());
			upstream.on('close', () => client.close());
			upstream.on('error', () => client.close(1011, 'Upstream unavailable'));
		});
	}

	revoke(credentialHash: string): void {
		for (const [request, proxy] of this.activeProxies) {
			if (constantTimeSecretEquals(proxy.credentialHash, credentialHash)) {
				request.destroy();
				proxy.client?.destroy();
				proxy.response.destroy();
			}
		}

		for (const [socket, hash] of this.webSocketCredentials) {
			if (constantTimeSecretEquals(hash, credentialHash)) {
				socket.close(1008, 'Device revoked');
			}
		}

		for (const [socket, hash] of this.socketCredentials) {
			if (constantTimeSecretEquals(hash, credentialHash)) {
				socket.destroy();
				this.socketCredentials.delete(socket);
			}
		}
	}
}

export class LanSharingManager {
	readonly pairing: PairingManager;
	upstreamUrl: string;
	readonly gatewaySecret: string;
	private readonly options: LanSharingManagerOptions;
	private readonly configPath: string;
	private readonly certificate: CertificateManager;
	private config: LanSharingConfig = {
		enabled: false,
		port: DEFAULT_LAN_PORT,
		bindings: [],
		dnsNames: []
	};
	private gateway?: Gateway;
	private listeners = new Map<string, LanListenerStatus>();
	private lastStatus?: LanSharingStatus;
	constructor(options: LanSharingManagerOptions) {
		this.options = options;
		this.upstreamUrl = options.upstreamUrl;
		this.gatewaySecret = options.gatewaySecret;
		this.configPath = join(options.dataDirectory, 'lan-sharing.json');
		this.pairing = new PairingManager(join(options.dataDirectory, 'pairings.json'), (hash) =>
			this.gateway?.revoke(hash)
		);
		this.certificate = new CertificateManager(
			certificateFiles(options.dataDirectory),
			new KeyEnvelopeStore(options.safeStorage)
		);
	}

	async load(): Promise<void> {
		try {
			this.config = JSON.parse(await readFile(this.configPath, 'utf8')) as LanSharingConfig;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw new Error('LAN sharing configuration is corrupt.', { cause: error });
			}
		}

		this.config = this.normalizeConfig(this.config);
		await this.pairing.load();
		if (this.config.enabled) {
			try {
				await this.reconfigure(this.config);
			} catch (error) {
				if (!this.isBindFailure(error)) {
					throw error;
				}

				this.reportDegraded(error);
			}
		} else {
			this.emitStatus();
		}
	}
	get status(): LanSharingStatus {
		return this.buildStatus();
	}
	async updateUpstream(url: string): Promise<void> {
		const previous = this.upstreamUrl;
		this.upstreamUrl = url;
		try {
			if (this.config.enabled) {
				await this.reconfigure(this.config);
			}
		} catch (error) {
			this.upstreamUrl = previous;
			throw error;
		}

		this.emitStatus();
	}
	async reconcile(): Promise<void> {
		this.pairing.expireNow();
		if (!this.config.enabled) {
			return;
		}

		const available = this.options.addresses?.() ?? inventoryAddresses(networkInterfaces());
		const availableKeys = new Set(
			available.map((item) => `${item.interfaceName}|${item.address}|${item.family}`)
		);
		const needsReconfigure = this.config.bindings.some((binding) => {
			const key = this.bindingKey(binding);
			const expected = availableKeys.has(key) ? 'listening' : 'missing';

			return this.listeners.get(key)?.state !== expected;
		});
		if (needsReconfigure || !this.gateway) {
			try {
				await this.reconfigure(this.config);
				this.emitStatus();
			} catch (error) {
				if (!this.isBindFailure(error)) {
					throw error;
				}

				this.reportDegraded(error);
			}
		}
	}

	async stop(): Promise<void> {
		await this.gateway?.stop();
		this.gateway = undefined;
		for (const listener of this.listeners.values()) {
			listener.state = 'stopped';
		}

		this.emitStatus();
	}
	get currentConfig(): LanSharingConfig {
		return {
			...this.config,
			bindings: this.config.bindings.map((binding) => ({ ...binding })),
			dnsNames: [...this.config.dnsNames]
		};
	}
	async applyConfig(input: unknown): Promise<LanSharingStatus> {
		const next = this.normalizeConfig(input as LanSharingConfig);
		const previous = this.config;
		await this.reconfigure(next);
		this.config = next;
		try {
			await this.persistConfig();
		} catch (error) {
			this.config = previous;
			await this.reconfigure(previous).catch((restoreError) => {
				console.error('Unable to restore the previous LAN sharing configuration:', restoreError);
			});
			throw error;
		}

		this.emitStatus();

		return this.status;
	}
	async resetTls(): Promise<LanSharingStatus> {
		await this.pairing.clearAll();
		const available = this.options.addresses?.() ?? inventoryAddresses(networkInterfaces());
		const availableKeys = new Set(
			available.map((item) => `${item.interfaceName}|${item.address}|${item.family}`)
		);
		const addresses = this.config.bindings
			.filter((binding) => availableKeys.has(this.bindingKey(binding)))
			.map((binding) => binding.address);
		const previousCertificate = this.certificate.current;
		try {
			await this.certificate.reset(this.config.dnsNames, addresses);
			if (this.config.enabled) {
				await this.reconfigure(this.config);
			}
		} catch (error) {
			if (previousCertificate && this.gateway) {
				this.gateway.updateSecureContext(previousCertificate, {
					...this.config,
					bindings: this.config.bindings.filter((binding) =>
						availableKeys.has(this.bindingKey(binding))
					)
				});
			}

			throw error;
		}

		this.emitStatus();

		return this.status;
	}
	async exportCa(): Promise<{ path: string; fingerprint: string }> {
		const state = this.certificate.current;
		if (!state) {
			throw new Error('TLS has not been initialized.');
		}

		const path = join(this.options.dataDirectory, 'pi-squared-ca.crt');
		await writeFile(path, state.caCertificate, { mode: 0o644 });

		return { path, fingerprint: state.fingerprint };
	}
	async approvePairing(nonce: string): Promise<void> {
		await this.pairing.approve(nonce);
		this.emitStatus();
	}
	async rejectPairing(nonce: string): Promise<void> {
		await this.pairing.reject(nonce);
		this.emitStatus();
	}
	async createPairingCode(deviceName: string): Promise<{ code: string; expiresAt: string }> {
		const result = await this.pairing.createCode(deviceName);
		this.emitStatus();

		return result;
	}
	async revokeDevice(id: string): Promise<void> {
		await this.pairing.revoke(id);
		this.emitStatus();
	}
	recordListenerError(binding: SelectedBinding, error: string): void {
		this.listeners.set(this.bindingKey(binding), { binding, state: 'error', error });
	}
	private isBindFailure(error: unknown): boolean {
		let current: unknown = error;
		while (current instanceof Error) {
			if (current.message.includes('Unable to bind')) {
				return true;
			}

			current = current.cause;
		}

		return false;
	}
	private reportDegraded(error: unknown): void {
		const available = this.options.addresses?.() ?? inventoryAddresses(networkInterfaces());
		const availableKeys = new Set(
			available.map((item) => `${item.interfaceName}|${item.address}|${item.family}`)
		);
		const active = new Set(
			this.gateway?.activeBindings().map((binding) => this.bindingKey(binding))
		);
		const message = error instanceof Error ? error.message : String(error);
		this.listeners.clear();
		for (const binding of this.config.bindings) {
			const key = this.bindingKey(binding);
			const listening = active.has(key);
			const present = availableKeys.has(key);
			this.listeners.set(key, {
				binding,
				state: listening ? 'listening' : present ? 'error' : 'missing',
				error: listening || !present ? undefined : message,
				url: listening ? this.urlForBinding(binding, this.config.port) : undefined
			});
		}

		this.emitStatus();
	}
	emitStatus(): void {
		this.lastStatus = this.buildStatus();
		this.options.onStatus?.(this.lastStatus);
	}
	credentialHashForRequest(request: IncomingMessage, host: string): string | undefined {
		const credential = parseCookieHeader(request.headers.cookie, DEVICE_COOKIE);

		return credential ? this.pairing.authenticate(credential, host)?.credentialHash : undefined;
	}

	private async reconfigure(next: LanSharingConfig): Promise<void> {
		if (!next.enabled) {
			await this.gateway?.stop();
			this.gateway = undefined;
			this.listeners.clear();

			return;
		}

		const available = this.options.addresses?.() ?? inventoryAddresses(networkInterfaces());
		const present = next.bindings.filter((binding) =>
			available.some(
				(item) =>
					item.interfaceName === binding.interfaceName &&
					item.address === binding.address &&
					item.family === binding.family
			)
		);
		const certificate = await this.certificate.loadOrCreate(
			next.dnsNames,
			present.map((binding) => binding.address)
		);
		const nextGatewayConfig = { ...next, bindings: present };
		const previousGateway = this.gateway;
		if (!previousGateway) {
			const candidate = new Gateway(this, { config: nextGatewayConfig, certificate });
			try {
				await candidate.start();
			} catch (error) {
				await candidate.stop().catch(() => undefined);
				throw new Error('Unable to bind all selected LAN addresses.', { cause: error });
			}

			this.gateway = candidate;
			this.updateListenerStatus(next, present, candidate);

			return;
		}

		const previousConfig = previousGateway.currentConfig();
		const previousCertificate = previousGateway.currentCertificate();
		const currentKeys = new Set(
			previousGateway.activeBindings().map((binding) => this.bindingKey(binding))
		);
		const desiredKeys = new Set(present.map((binding) => this.bindingKey(binding)));
		const additions = present.filter((binding) => !currentKeys.has(this.bindingKey(binding)));
		const removals = previousGateway
			.activeBindings()
			.filter((binding) => !desiredKeys.has(this.bindingKey(binding)));

		if (previousConfig.port !== next.port) {
			const candidate = new Gateway(this, { config: nextGatewayConfig, certificate });
			try {
				await candidate.start();
			} catch (error) {
				await candidate.stop().catch(() => undefined);
				throw new Error('Unable to bind the new LAN port on all selected addresses.', {
					cause: error
				});
			}

			await previousGateway.stop();
			this.gateway = candidate;
			this.updateListenerStatus(next, present, candidate);

			return;
		}

		if (additions.length) {
			await previousGateway.startBindings(additions);
		}

		try {
			previousGateway.updateSecureContext(certificate, nextGatewayConfig);
			if (removals.length) {
				await previousGateway.stopBindings(removals);
			}
		} catch (error) {
			if (additions.length) {
				await previousGateway.stopBindings(additions).catch(() => undefined);
			}

			if (removals.length) {
				await previousGateway.startBindings(removals).catch(() => undefined);
			}

			if (previousCertificate) {
				previousGateway.updateSecureContext(previousCertificate, {
					...previousConfig,
					bindings: previousGateway.activeBindings()
				});
			}

			throw error;
		}

		this.updateListenerStatus(next, present, previousGateway);
	}

	private updateListenerStatus(
		config: LanSharingConfig,
		present: SelectedBinding[],
		gateway: Gateway
	): void {
		const active = new Set(gateway.activeBindings().map((binding) => this.bindingKey(binding)));
		this.listeners.clear();
		for (const binding of config.bindings) {
			const key = this.bindingKey(binding);
			const listening = active.has(key);
			const isPresent = present.some((item) => this.bindingKey(item) === key);
			this.listeners.set(key, {
				binding,
				state: listening ? 'listening' : isPresent ? 'error' : 'missing',
				error: listening || !isPresent ? undefined : 'Listener was not started.',
				url: listening ? this.urlForBinding(binding, config.port) : undefined
			});
		}
	}
	private normalizeConfig(input: LanSharingConfig): LanSharingConfig {
		const port = Number(input?.port ?? DEFAULT_LAN_PORT);
		if (!Number.isInteger(port) || port < 1024 || port > 65535) {
			throw new Error('LAN sharing port must be between 1024 and 65535.');
		}

		const bindings = Array.isArray(input?.bindings) ? input.bindings : [];
		const validated = bindings.map((binding) => normalizeBinding(binding));
		// A persisted address may disappear after a reboot. Keep it in the
		// configuration and report that listener as missing rather than selecting
		// another interface or broadening the bind.
		const deduplicated = new Map(validated.map((binding) => [this.bindingKey(binding), binding]));
		const validatedBindings = [...deduplicated.values()];
		if (input?.enabled === true && validatedBindings.length === 0) {
			throw new Error('Select at least one concrete address before enabling LAN sharing.');
		}

		const dnsNames = [
			...new Set((Array.isArray(input?.dnsNames) ? input.dnsNames : []).map(validateDnsName))
		].filter((name) => name !== 'pi-squared.local');

		return { enabled: input?.enabled === true, port, bindings: validatedBindings, dnsNames };
	}
	private async persistConfig(): Promise<void> {
		await mkdir(join(this.options.dataDirectory), { recursive: true });
		const temporary = `${this.configPath}.${process.pid}.tmp`;
		await writeFile(temporary, JSON.stringify(this.config), { mode: 0o600 });
		await chmod(temporary, 0o600);
		await rename(temporary, this.configPath);
	}
	private bindingKey(binding: SelectedBinding): string {
		return `${binding.interfaceName}|${binding.address}|${binding.family}`;
	}
	private urlForBinding(binding: SelectedBinding, port: number): string {
		return `https://${binding.family === 'IPv6' ? `[${binding.address}]` : binding.address}:${port}`;
	}
	private buildStatus(): LanSharingStatus {
		const rawAvailable = this.options.addresses?.() ?? inventoryAddresses(networkInterfaces());
		const recommended = defaultSelectedAddress(rawAvailable);
		const available = rawAvailable.map((address) => ({
			...address,
			recommended:
				recommended?.interfaceName === address.interfaceName &&
				recommended.address === address.address &&
				recommended.family === address.family
		}));
		const urls = this.config.enabled
			? this.config.dnsNames.map((name) => `https://${name}:${this.config.port}`)
			: [];
		if (this.config.enabled) {
			urls.push('https://pi-squared.local:' + this.config.port);
		}

		urls.push(
			...[...this.listeners.values()]
				.filter((item) => item.state === 'listening')
				.map((item) => item.url!)
		);
		const certificate = this.certificate.current;

		return {
			available,
			config: this.currentConfig,
			listeners: [...this.listeners.values()],
			urls,
			caFingerprint: certificate?.fingerprint,
			caNotAfter: certificate?.caNotAfter,
			leafNotAfter: certificate?.leafNotAfter,
			keyProtectionWarning: this.certificate.keyProtectionWarning,
			pairing: this.pairing.status
		};
	}
}

const PAIRING_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pair Pi Squared</title><style>body{font:16px system-ui;max-width:32rem;margin:4rem auto;padding:1rem}label{display:grid;gap:.4rem;margin:1rem 0}input,button{font:inherit;padding:.6rem}#status{margin-top:1rem}</style></head><body><h1>Pair Pi Squared</h1><p>Approve this device in Pi Squared Desktop, then complete pairing here.</p><label>Device name<input id="name" maxlength="120" value="Phone"></label><button id="request">Request pairing</button><label>One-use code<input id="code" inputmode="numeric" maxlength="8" pattern="[0-9]{8}"></label><button id="redeem">Use code</button><p id="status" role="status"></p><script>const s=document.querySelector('#status');let nonce;document.querySelector('#request').onclick=async()=>{const r=await fetch('/__pi-squared/pair/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceName:document.querySelector('#name').value})});const d=await r.json();if(!r.ok){s.textContent=d.error;return}nonce=d.nonce;s.textContent='Waiting for desktop approval…';const poll=async()=>{const p=await fetch('/__pi-squared/pair/request/'+encodeURIComponent(nonce));const d=await p.json();if(d.status==='approved'){const c=await fetch('/__pi-squared/pair/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nonce})});s.textContent=c.ok?'Paired. Reloading…':'Unable to complete pairing';if(c.ok)setTimeout(()=>location.href='/',500);return}if(d.status==='pending')setTimeout(poll,1000);else s.textContent='Pairing '+d.status+'.'};setTimeout(poll,500)};document.querySelector('#redeem').onclick=async()=>{const r=await fetch('/__pi-squared/pair/code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:document.querySelector('#code').value})});const d=await r.json();s.textContent=r.ok?'Paired. Reloading…':d.error;if(r.ok)setTimeout(()=>location.href='/',500)};</script></body></html>`;

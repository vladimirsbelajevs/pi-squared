import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LanSharingManager, type LanSharingStatus } from './lan-sharing.js';

let directory: string | undefined;
let upstream: Server | undefined;
let manager: LanSharingManager | undefined;

afterEach(async () => {
	await manager?.stop();
	await new Promise<void>((resolve) => upstream?.close(() => resolve()));
	if (directory) {
		await rm(directory, { recursive: true, force: true });
	}
});

function request(
	port: number,
	path: string,
	options: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<{
	status: number;
	headers: Record<string, string | string[] | undefined>;
	body: string;
}> {
	return new Promise((resolve, reject) => {
		const request = httpsRequest(
			{
				hostname: '127.0.0.1',
				port,
				path,
				method: options.method ?? 'GET',
				rejectUnauthorized: false,
				headers: options.headers
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on('data', (chunk: Buffer) => chunks.push(chunk));
				response.on('end', () =>
					resolve({
						status: response.statusCode ?? 0,
						headers: response.headers,
						body: Buffer.concat(chunks).toString()
					})
				);
			}
		);
		request.once('error', reject);
		if (options.body) {
			request.end(options.body);
		} else {
			request.end();
		}
	});
}

async function freePort(): Promise<number> {
	const server = createServer();
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const port = (server.address() as { port: number }).port;
	await new Promise<void>((resolve) => server.close(() => resolve()));

	return port;
}

describe('LAN HTTPS gateway', () => {
	it('keeps pairing routes local and proxies only an authenticated device', async () => {
		directory = await mkdtemp(join(tmpdir(), 'pi-lan-'));
		const statusEvents: LanSharingStatus[] = [];
		let receivedAuth = '';
		let receivedHeaders: Record<string, string | string[] | undefined> = {};
		let receivedUpgradeHeaders: Record<string, string | string[] | undefined> = {};
		let resolveUpgradeSeen: () => void = () => undefined;
		const upgradeSeen = new Promise<void>((resolve) => {
			resolveUpgradeSeen = resolve;
		});
		const upstreamSockets = new WebSocketServer({
			noServer: true,
			handleProtocols: (protocols) => protocols.values().next().value ?? false
		});
		upstream = createServer((request, response) => {
			receivedAuth = request.headers['x-pi-squared-internal-auth'] ?? '';
			receivedHeaders = request.headers;
			response.writeHead(200, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify({ path: request.url }));
		});
		upstream.on('upgrade', (request, socket, head) => {
			receivedUpgradeHeaders = request.headers;
			resolveUpgradeSeen();
			upstreamSockets.handleUpgrade(request, socket, head, (client) => {
				client.on('message', (message) => client.send(message));
			});
		});
		upstream.listen(0, '127.0.0.1');
		await once(upstream, 'listening');
		const upstreamPort = (upstream.address() as { port: number }).port;
		manager = new LanSharingManager({
			dataDirectory: directory,
			upstreamUrl: `http://127.0.0.1:${upstreamPort}`,
			gatewaySecret: 'gateway-secret',
			onStatus: (next) => statusEvents.push(next),
			addresses: () => [
				{
					interfaceName: 'lo',
					address: '127.0.0.1',
					family: 'IPv4',
					internal: true,
					risk: ['loopback'],
					label: 'loopback'
				}
			]
		});
		await manager.load();
		const port = await freePort();
		const status = await manager.applyConfig({
			enabled: true,
			port,
			bindings: [{ interfaceName: 'lo', address: '127.0.0.1', family: 'IPv4' }],
			dnsNames: ['pi-squared.local']
		});
		expect(status.listeners[0]?.state).toBe('listening');
		statusEvents.length = 0;

		const page = await request(port, '/__pi-squared/pair/');
		expect(page.status).toBe(200);
		const dnsPage = await request(port, '/__pi-squared/pair/', {
			headers: { Host: `pi-squared.local:${port}` }
		});
		expect(dnsPage.status).toBe(200);
		expect(page.headers['cache-control']).toBe('no-store');
		expect(page.headers['strict-transport-security']).toBeUndefined();
		expect(manager.status.pairing.pending).toHaveLength(0);
		const unauthorized = await request(port, '/api/health');
		expect(unauthorized.status).toBe(401);
		const reserved = await request(port, '/__pi-squared/pair/unknown');
		expect(reserved.status).toBe(404);

		const origin = `https://127.0.0.1:${port}`;
		const pairing = await request(port, '/__pi-squared/pair/request', {
			method: 'POST',
			headers: { Origin: origin, 'Content-Type': 'application/json' },
			body: JSON.stringify({ deviceName: 'Test phone' })
		});
		expect(pairing.status).toBe(201);
		expect(statusEvents).toHaveLength(1);
		expect(statusEvents[0]?.pairing.pending).toHaveLength(1);
		expect(statusEvents[0]?.pairing.pending[0]).not.toHaveProperty('codeHash');
		const nonce = (JSON.parse(pairing.body) as { nonce: string }).nonce;
		await manager.approvePairing(nonce);
		const complete = await request(port, '/__pi-squared/pair/complete', {
			method: 'POST',
			headers: { Origin: origin, 'Content-Type': 'application/json' },
			body: JSON.stringify({ nonce })
		});
		expect(complete.status).toBe(200);
		const cookie = (complete.headers['set-cookie'] as string[])[0].split(';', 1)[0];
		const proxied = await request(port, '/api/health', {
			headers: {
				Cookie: `${cookie}; app-session=keep-me`,
				Origin: origin,
				'X-Forwarded-For': 'spoofed',
				'X-Forwarded-Prefix': 'spoofed',
				Forwarded: 'for=spoofed',
				'X-Pi-Squared-Internal-Auth': 'spoofed'
			}
		});
		expect(proxied.status).toBe(200);
		expect(receivedAuth).toBe('gateway-secret');
		expect(receivedHeaders['x-forwarded-for']).toBeUndefined();
		expect(receivedHeaders['x-forwarded-prefix']).toBeUndefined();
		expect(receivedHeaders.forwarded).toBeUndefined();
		expect(receivedHeaders.cookie).toBe('app-session=keep-me');
		expect(receivedHeaders['x-pi-squared-internal-auth']).toBe('gateway-secret');

		const socket = new WebSocket(`wss://127.0.0.1:${port}/api/socket`, ['chat'], {
			rejectUnauthorized: false,
			origin,
			headers: {
				Cookie: `${cookie}; app-session=keep-me`,
				'X-Forwarded-For': 'spoofed',
				'X-Pi-Squared-Internal-Auth': 'spoofed'
			}
		});
		await once(socket, 'open');
		await upgradeSeen;
		expect(socket.protocol).toBe('chat');
		expect(receivedUpgradeHeaders.cookie).toBe('app-session=keep-me');
		expect(receivedUpgradeHeaders['x-forwarded-for']).toBeUndefined();
		expect(receivedUpgradeHeaders['x-pi-squared-internal-auth']).toBe('gateway-secret');
		expect(receivedUpgradeHeaders['sec-websocket-protocol']).toBe('chat');
		const echoed = new Promise<string>((resolve) =>
			socket.once('message', (message) => resolve(message.toString()))
		);
		socket.send('ping');
		expect(await echoed).toBe('ping');
		const deviceId = manager.status.pairing.devices[0]?.id;
		expect(deviceId).toBeDefined();
		const closed = once(socket, 'close');
		await manager.revokeDevice(deviceId!);
		await closed;
		await new Promise<void>((resolve) => upstreamSockets.close(() => resolve()));

		const wrongAuthority = await request(port, '/api/health', {
			headers: { Host: '127.0.0.1', Origin: origin }
		});
		expect(wrongAuthority.status).toBe(421);

		const blocker = createServer();
		blocker.listen(0, '127.0.0.1');
		await once(blocker, 'listening');
		const blockedPort = (blocker.address() as { port: number }).port;
		await expect(
			manager.applyConfig({
				enabled: true,
				port: blockedPort,
				bindings: [{ interfaceName: 'lo', address: '127.0.0.1', family: 'IPv4' }],
				dnsNames: []
			})
		).rejects.toThrow('Unable to bind');
		expect(manager.status.config.port).toBe(port);
		await new Promise<void>((resolve) => blocker.close(() => resolve()));

		const configPath = join(directory, 'lan-sharing.json');
		await rm(configPath);
		await mkdir(configPath);
		const rollbackPort = await freePort();
		await expect(
			manager.applyConfig({
				enabled: true,
				port: rollbackPort,
				bindings: [{ interfaceName: 'lo', address: '127.0.0.1', family: 'IPv4' }],
				dnsNames: ['pi-squared.local']
			})
		).rejects.toThrow();
		expect(manager.status.config.port).toBe(port);
		expect((await request(port, '/__pi-squared/pair/')).status).toBe(200);
	});

	it('keeps a persisted LAN configuration degraded when a listener cannot bind', async () => {
		directory = await mkdtemp(join(tmpdir(), 'pi-lan-load-'));
		const blocker = createServer();
		blocker.listen(0, '127.0.0.1');
		await once(blocker, 'listening');
		const blockedPort = (blocker.address() as { port: number }).port;
		await writeFile(
			join(directory, 'lan-sharing.json'),
			JSON.stringify({
				enabled: true,
				port: blockedPort,
				bindings: [{ interfaceName: 'lo', address: '127.0.0.1', family: 'IPv4' }],
				dnsNames: []
			})
		);
		manager = new LanSharingManager({
			dataDirectory: directory,
			upstreamUrl: 'http://127.0.0.1:1',
			gatewaySecret: 'gateway-secret',
			addresses: () => [
				{
					interfaceName: 'lo',
					address: '127.0.0.1',
					family: 'IPv4',
					internal: true,
					risk: ['loopback'],
					label: 'loopback'
				}
			]
		});

		await expect(manager.load()).resolves.toBeUndefined();
		expect(manager.status.config.enabled).toBe(true);
		expect(manager.status.listeners[0]?.state).toBe('error');
		expect(manager.status.listeners[0]?.error).toContain('Unable to bind');

		await new Promise<void>((resolve) => blocker.close(() => resolve()));
		await manager.reconcile();
		expect(manager.status.listeners[0]?.state).toBe('listening');
	});
});

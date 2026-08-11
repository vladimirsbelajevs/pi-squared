import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PairingManager } from './pairing.js';

let directory: string;
afterEach(async () => {
	if (directory) {
		await rm(directory, { recursive: true, force: true });
	}
});

describe('pairing lifecycle', () => {
	it('keeps GET-style reads side-effect free and consumes approval once', async () => {
		directory = await mkdtemp(join(tmpdir(), 'pi-pairing-'));
		const manager = new PairingManager(join(directory, 'pairings.json'));
		const request = await manager.createRequest('192.168.1.2', 'Phone');
		const before = manager.getRequest(request.nonce);
		expect(before?.status).toBe('pending');
		expect(manager.status.devices).toHaveLength(0);
		await manager.approve(request.nonce);
		const result = await manager.complete(request.nonce, '192.168.1.2');
		expect(result.credential).toHaveLength(43);
		expect(manager.getRequest(request.nonce)?.status).toBe('expired');
		expect(manager.authenticate(result.credential, '192.168.1.2')?.id).toBe(result.device.id);
		await expect(manager.complete(request.nonce, '192.168.1.2')).rejects.toThrow('not approved');
	});

	it('creates fallback codes only through the trusted manager API', async () => {
		directory = await mkdtemp(join(tmpdir(), 'pi-pairing-'));
		const path = join(directory, 'pairings.json');
		const manager = new PairingManager(path);
		const request = await manager.createRequest('192.168.1.8', 'Phone');
		expect(request).not.toHaveProperty('code');
		const code = await manager.createCode('Phone');
		expect(code.code).toMatch(/^[0-9]{8}$/);
		const persisted = await readFile(path, 'utf8');
		expect(persisted).not.toContain(code.code);
		const redeemed = await manager.redeemCode(code.code, '192.168.1.8');
		expect(manager.authenticate(redeemed.credential, '192.168.1.8')).toBeDefined();
		expect(manager.authenticate(redeemed.credential, '192.168.1.9')).toBeUndefined();
	});

	it('expires approved grants and revokes expired devices immediately', async () => {
		directory = await mkdtemp(join(tmpdir(), 'pi-pairing-'));
		const manager = new PairingManager();
		const request = await manager.createRequest('192.168.1.2', 'Phone');
		await manager.approve(request.nonce);
		vi.useFakeTimers();
		try {
			vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1);
			await expect(manager.complete(request.nonce, '192.168.1.2')).rejects.toThrow('not approved');
		} finally {
			vi.useRealTimers();
		}

		expect(manager.getRequest(request.nonce)?.status).toBe('expired');
	});

	it('clears all devices through the revocation callback', async () => {
		const revoked: string[] = [];
		const manager = new PairingManager(undefined, (hash) => revoked.push(hash));
		const request = await manager.createRequest('192.168.1.2', 'Phone');
		await manager.approve(request.nonce);
		const result = await manager.complete(request.nonce, '192.168.1.2');
		await manager.clearAll();
		expect(revoked).toContain(result.device.credentialHash);
	});

	it('persists hashes only and revokes devices', async () => {
		directory = await mkdtemp(join(tmpdir(), 'pi-pairing-'));
		const path = join(directory, 'pairings.json');
		const manager = new PairingManager(path);
		const request = await manager.createRequest('pi-squared.home.arpa', 'Tablet');
		await manager.approve(request.nonce);
		const result = await manager.complete(request.nonce, 'pi-squared.home.arpa');
		const persisted = await readFile(path, 'utf8');
		expect(persisted).not.toContain(result.credential);
		expect(persisted).toContain(result.device.credentialHash);
		await manager.revoke(result.device.id);
		expect(manager.authenticate(result.credential, 'pi-squared.home.arpa')).toBeUndefined();
	});
});

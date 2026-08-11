import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, rename, mkdir, writeFile, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';

export type PairingPendingStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export interface PendingPairing {
	nonce: string;
	status: PairingPendingStatus;
	createdAt: string;
	expiresAt: string;
	host: string;
	deviceName: string;
	codeHash?: string;
	codeExpiresAt?: string;
}
export interface TrustedDevice {
	id: string;
	credentialHash: string;
	host: string;
	deviceName: string;
	createdAt: string;
	lastSeenAt: string;
	expiresAt: string;
}
export interface PairingSnapshot {
	pending: PendingPairing[];
	devices: TrustedDevice[];
}
export interface PairingPublicSnapshot {
	pending: Omit<PendingPairing, 'codeHash' | 'codeExpiresAt'>[];
	devices: Omit<TrustedDevice, 'credentialHash'>[];
}

const PENDING_TTL = 10 * 60 * 1000;
const CODE_TTL = 5 * 60 * 1000;
const DEVICE_TTL = 180 * 24 * 60 * 60 * 1000;
const REFRESH_INTERVAL = 24 * 60 * 60 * 1000;
const MAX_PENDING = 32;
const MAX_HISTORY = 128;
const MAX_DEVICES = 128;

function opaque(bytes = 32): string {
	return randomBytes(bytes).toString('base64url');
}

function hash(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function sameSecret(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);

	return left.length === right.length && timingSafeEqual(left, right);
}

export class PairingManager {
	private snapshot: PairingSnapshot = { pending: [], devices: [] };
	private loaded = false;
	private requestTimestamps: number[] = [];
	private badCodeTimestamps: number[] = [];
	constructor(
		private readonly path?: string,
		private readonly onRevoked?: (credentialHash: string) => void
	) {}

	async load(): Promise<void> {
		if (this.loaded) {
			return;
		}

		this.loaded = true;
		if (!this.path) {
			return;
		}

		try {
			const parsed = JSON.parse(await readFile(this.path, 'utf8')) as PairingSnapshot;
			if (!parsed || !Array.isArray(parsed.pending) || !Array.isArray(parsed.devices)) {
				throw new Error('invalid pairing state');
			}

			this.snapshot = parsed;
			await this.expireAndPersist();
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return;
			}

			throw new Error('Pairing state is corrupt.', { cause: error });
		}
	}

	private async persist(): Promise<void> {
		if (!this.path) {
			return;
		}

		await mkdir(dirname(this.path), { recursive: true });
		const temporary = `${this.path}.${process.pid}.tmp`;
		await writeFile(temporary, JSON.stringify(this.snapshot), { mode: 0o600 });
		await chmod(temporary, 0o600);
		await rename(temporary, this.path);
	}

	private notifyRevoked(hashes: string[]): void {
		for (const credentialHash of hashes) {
			this.onRevoked?.(credentialHash);
		}
	}

	private expire(): { changed: boolean; revoked: string[] } {
		const now = Date.now();
		let changed = false;
		const revoked: string[] = [];
		for (const pending of this.snapshot.pending) {
			if (
				(pending.status === 'pending' || pending.status === 'approved') &&
				Date.parse(pending.expiresAt) <= now
			) {
				pending.status = 'expired';
				delete pending.codeHash;
				delete pending.codeExpiresAt;
				changed = true;
			}
		}

		const devices = this.snapshot.devices.filter((device) => {
			if (Date.parse(device.expiresAt) > now) {
				return true;
			}

			revoked.push(device.credentialHash);
			changed = true;

			return false;
		});
		this.snapshot.devices = devices;

		const active = this.snapshot.pending.filter(
			(item) => item.status === 'pending' || item.status === 'approved'
		);
		const history = this.snapshot.pending
			.filter((item) => item.status === 'rejected' || item.status === 'expired')
			.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
			.slice(0, Math.max(0, MAX_HISTORY - active.length));
		const bounded = [...active, ...history];
		if (bounded.length !== this.snapshot.pending.length) {
			this.snapshot.pending = bounded;
			changed = true;
		}

		return { changed, revoked };
	}

	private async expireAndPersist(): Promise<void> {
		const result = this.expire();
		this.notifyRevoked(result.revoked);
		if (result.changed) {
			await this.persist();
		}
	}

	expireNow(): void {
		const result = this.expire();
		this.notifyRevoked(result.revoked);
		if (result.changed) {
			void this.persist();
		}
	}

	get status(): PairingPublicSnapshot {
		const result = this.expire();
		this.notifyRevoked(result.revoked);
		if (result.changed) {
			void this.persist();
		}

		return {
			pending: this.snapshot.pending.map((item) => {
				const copy: Partial<PendingPairing> = { ...item };
				delete copy.codeHash;
				delete copy.codeExpiresAt;

				return copy as Omit<PendingPairing, 'codeHash' | 'codeExpiresAt'>;
			}),
			devices: this.snapshot.devices.map((item) => {
				const copy: Partial<TrustedDevice> = { ...item };
				delete copy.credentialHash;

				return copy as Omit<TrustedDevice, 'credentialHash'>;
			})
		};
	}

	private async createPending(
		host: string,
		deviceName: string,
		withCode: boolean
	): Promise<{ nonce: string; code?: string; expiresAt: string }> {
		await this.load();
		await this.expireAndPersist();
		const now = Date.now();
		const normalizedName = deviceName.trim().slice(0, 120);
		const existing = this.snapshot.pending.find(
			(item) =>
				!withCode &&
				item.status === 'pending' &&
				item.host === host &&
				item.deviceName === normalizedName
		);
		if (existing) {
			return { nonce: existing.nonce, expiresAt: existing.expiresAt };
		}

		this.requestTimestamps = this.requestTimestamps.filter((value) => now - value < 60_000);
		if (this.requestTimestamps.length >= 10) {
			throw new Error('Pairing requests are temporarily rate limited.');
		}

		if (
			this.snapshot.pending.filter(
				(item) => item.status === 'pending' || item.status === 'approved'
			).length >= MAX_PENDING
		) {
			throw new Error('Too many pending pairing requests.');
		}

		if (!normalizedName) {
			throw new Error('deviceName is required.');
		}

		this.requestTimestamps.push(now);
		const nonce = opaque();
		const expiresAt = new Date(now + PENDING_TTL).toISOString();
		const codeExpiresAt = new Date(now + CODE_TTL).toISOString();
		const code = withCode
			? String(randomBytes(4).readUInt32BE(0) % 100_000_000).padStart(8, '0')
			: undefined;
		this.snapshot.pending.push({
			nonce,
			status: 'pending',
			createdAt: new Date(now).toISOString(),
			expiresAt,
			host,
			deviceName: normalizedName,
			...(code ? { codeHash: hash(code), codeExpiresAt } : {})
		});
		await this.persist();

		return { nonce, ...(code ? { code } : {}), expiresAt };
	}

	async createRequest(
		host: string,
		deviceName: string
	): Promise<{ nonce: string; expiresAt: string }> {
		const request = await this.createPending(host, deviceName, false);

		return { nonce: request.nonce, expiresAt: request.expiresAt };
	}

	async createCode(deviceName: string): Promise<{ code: string; expiresAt: string }> {
		const request = await this.createPending('code', deviceName, true);
		if (!request.code) {
			throw new Error('Unable to create pairing code.');
		}

		const pending = this.snapshot.pending.find((item) => sameSecret(item.nonce, request.nonce));

		return { code: request.code, expiresAt: pending?.codeExpiresAt ?? request.expiresAt };
	}

	private findRequest(nonce: string): PendingPairing | undefined {
		return this.snapshot.pending.find((item) => sameSecret(item.nonce, nonce));
	}

	getRequest(nonce: string): PendingPairing | undefined {
		const pending = this.findRequest(nonce);
		if (!pending) {
			return undefined;
		}

		if (
			(pending.status === 'pending' || pending.status === 'approved') &&
			Date.parse(pending.expiresAt) <= Date.now()
		) {
			return { ...pending, status: 'expired' };
		}

		return { ...pending };
	}

	async approve(nonce: string): Promise<void> {
		await this.setApproval(nonce, 'approved');
	}
	async reject(nonce: string): Promise<void> {
		await this.setApproval(nonce, 'rejected');
	}
	private async setApproval(nonce: string, status: 'approved' | 'rejected'): Promise<void> {
		await this.load();
		await this.expireAndPersist();
		const pending = this.findRequest(nonce);
		if (!pending || pending.status !== 'pending' || Date.parse(pending.expiresAt) <= Date.now()) {
			throw new Error('Pairing request is no longer pending.');
		}

		pending.status = status;
		await this.persist();
	}

	async complete(
		nonce: string,
		host: string
	): Promise<{ credential: string; device: TrustedDevice }> {
		await this.load();
		await this.expireAndPersist();
		const pending = this.findRequest(nonce);
		if (
			!pending ||
			pending.status !== 'approved' ||
			pending.host !== host ||
			Date.parse(pending.expiresAt) <= Date.now()
		) {
			throw new Error('Pairing request is not approved for this host.');
		}

		return this.consume(pending, host);
	}

	async redeemCode(
		code: string,
		host: string
	): Promise<{ credential: string; device: TrustedDevice }> {
		await this.load();
		await this.expireAndPersist();
		const now = Date.now();
		this.badCodeTimestamps = this.badCodeTimestamps.filter((value) => now - value < 60_000);
		if (this.badCodeTimestamps.length >= 20) {
			throw new Error('Pairing code attempts are temporarily rate limited.');
		}

		const pending = this.snapshot.pending.find(
			(item) =>
				item.status === 'pending' &&
				item.host === 'code' &&
				item.codeHash &&
				sameSecret(item.codeHash, hash(code))
		);
		if (
			!pending ||
			!/^[0-9]{8}$/.test(code) ||
			!pending.codeExpiresAt ||
			Date.parse(pending.codeExpiresAt) <= now
		) {
			this.badCodeTimestamps.push(now);
			throw new Error('Invalid or expired pairing code.');
		}

		return this.consume(pending, host);
	}

	private async consume(
		pending: PendingPairing,
		host: string
	): Promise<{ credential: string; device: TrustedDevice }> {
		pending.status = 'expired';
		delete pending.codeHash;
		delete pending.codeExpiresAt;
		const credential = opaque(32);
		const now = Date.now();
		const device: TrustedDevice = {
			id: opaque(12),
			credentialHash: hash(credential),
			host,
			deviceName: pending.deviceName,
			createdAt: new Date(now).toISOString(),
			lastSeenAt: new Date(now).toISOString(),
			expiresAt: new Date(now + DEVICE_TTL).toISOString()
		};
		const evicted = this.snapshot.devices.slice(
			0,
			Math.max(0, this.snapshot.devices.length + 1 - MAX_DEVICES)
		);
		this.snapshot.devices = [...this.snapshot.devices, device].slice(-MAX_DEVICES);
		await this.persist();
		this.notifyRevoked(evicted.map((item) => item.credentialHash));

		return { credential, device };
	}

	shouldRefresh(credential: string, host: string): boolean {
		const result = this.expire();
		this.notifyRevoked(result.revoked);
		if (result.changed) {
			void this.persist();
		}

		const device = this.snapshot.devices.find(
			(item) => item.host === host && sameSecret(item.credentialHash, hash(credential))
		);

		return !!device && Date.now() - Date.parse(device.lastSeenAt) >= REFRESH_INTERVAL;
	}

	authenticate(credential: string, host: string): TrustedDevice | undefined {
		const result = this.expire();
		this.notifyRevoked(result.revoked);
		if (result.changed) {
			void this.persist();
		}

		const credentialHash = hash(credential);
		const device = this.snapshot.devices.find(
			(item) => item.host === host && sameSecret(item.credentialHash, credentialHash)
		);
		if (!device) {
			return undefined;
		}

		const now = Date.now();
		if (now - Date.parse(device.lastSeenAt) >= REFRESH_INTERVAL) {
			device.lastSeenAt = new Date(now).toISOString();
			device.expiresAt = new Date(now + DEVICE_TTL).toISOString();
			void this.persist();
		}

		return device;
	}

	async revoke(id: string): Promise<boolean> {
		await this.load();
		const index = this.snapshot.devices.findIndex((device) => device.id === id);
		if (index < 0) {
			return false;
		}

		const [removed] = this.snapshot.devices.splice(index, 1);
		await this.persist();
		this.notifyRevoked([removed.credentialHash]);

		return true;
	}

	async clearAll(): Promise<void> {
		await this.load();
		const revoked = this.snapshot.devices.map((device) => device.credentialHash);
		this.snapshot = { pending: [], devices: [] };
		await this.persist();
		this.notifyRevoked(revoked);
	}
}

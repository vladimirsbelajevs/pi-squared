import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface SafeStorageAdapter {
	isEncryptionAvailable(): boolean;
	getSelectedStorageBackend?(): string;
	encryptString(value: string): Buffer;
	decryptString(value: Buffer): string;
}

export interface KeyEnvelope {
	version: 1;
	backend: 'safeStorage' | 'file';
	algorithm: 'electron-safe-storage' | 'aes-256-gcm' | 'plain-restricted';
	iv?: string;
	authTag?: string;
	payload: string;
}

const REDUCED_PROTECTION_WARNING =
	'OS secure storage is unavailable; TLS keys are protected by restrictive per-user files.';

export class KeyEnvelopeStore {
	private protectionWarning?: string;
	constructor(private readonly safeStorage?: SafeStorageAdapter) {}

	get reducedProtectionWarning(): string | undefined {
		return this.protectionWarning;
	}
	get usesSecureStorage(): boolean {
		return this.hasSecureStorage();
	}

	private hasSecureStorage(): boolean {
		if (!this.safeStorage) {
			return false;
		}

		try {
			if (!this.safeStorage.isEncryptionAvailable()) {
				return false;
			}

			const backend = this.safeStorage.getSelectedStorageBackend?.();

			return backend !== 'basic_text' && backend !== 'unknown';
		} catch {
			return false;
		}
	}

	private parseEnvelope(value: string, path: string): KeyEnvelope {
		let envelope: KeyEnvelope;
		try {
			envelope = JSON.parse(value) as KeyEnvelope;
		} catch (error) {
			throw new Error(`Corrupt key envelope: ${path}`, { cause: error });
		}

		if (
			envelope.version !== 1 ||
			typeof envelope.payload !== 'string' ||
			(envelope.backend !== 'safeStorage' && envelope.backend !== 'file') ||
			(envelope.backend === 'safeStorage' && envelope.algorithm !== 'electron-safe-storage') ||
			(envelope.backend === 'file' && envelope.algorithm !== 'plain-restricted')
		) {
			throw new Error(`Unsupported key envelope: ${path}`);
		}

		return envelope;
	}

	async inspect(path: string): Promise<void> {
		const envelope = this.parseEnvelope(await readFile(path, 'utf8'), path);
		if (envelope.backend === 'file') {
			this.protectionWarning = REDUCED_PROTECTION_WARNING;
		}
	}

	/**
	 * Rewrite a fallback envelope with OS-backed protection when it becomes
	 * available. The decrypted value is intentionally kept inside this method so
	 * callers never retain a CA private key merely to migrate its envelope.
	 */
	async migrate(path: string): Promise<boolean> {
		const envelope = this.parseEnvelope(await readFile(path, 'utf8'), path);
		if (envelope.backend !== 'file') {
			return false;
		}

		if (!this.hasSecureStorage()) {
			this.protectionWarning = REDUCED_PROTECTION_WARNING;

			return false;
		}

		const value = Buffer.from(envelope.payload, 'base64').toString('utf8');
		await this.write(path, value);

		return true;
	}

	async write(path: string, value: string): Promise<void> {
		const envelope: KeyEnvelope = this.hasSecureStorage()
			? {
					version: 1,
					backend: 'safeStorage',
					algorithm: 'electron-safe-storage',
					payload: this.safeStorage!.encryptString(value).toString('base64')
				}
			: this.encryptFallback(value);
		if (envelope.backend === 'file') {
			this.protectionWarning = REDUCED_PROTECTION_WARNING;
		}

		await mkdir(dirname(path), { recursive: true });
		const temporary = `${path}.${process.pid}.tmp`;
		await writeFile(temporary, JSON.stringify(envelope), { mode: 0o600 });
		await chmod(temporary, 0o600);
		await rename(temporary, path);
	}

	async read(path: string): Promise<string> {
		const envelope = this.parseEnvelope(await readFile(path, 'utf8'), path);
		if (envelope.backend === 'safeStorage' && envelope.algorithm === 'electron-safe-storage') {
			if (!this.hasSecureStorage()) {
				throw new Error('Stored TLS key requires secure storage that is unavailable.');
			}

			try {
				return this.safeStorage!.decryptString(Buffer.from(envelope.payload, 'base64'));
			} catch {
				throw new Error(`Unable to decrypt key envelope: ${path}`);
			}
		}

		if (envelope.backend === 'file' && envelope.algorithm === 'plain-restricted') {
			this.protectionWarning = REDUCED_PROTECTION_WARNING;
			const value = Buffer.from(envelope.payload, 'base64').toString('utf8');
			if (this.hasSecureStorage()) {
				await this.write(path, value);
			}

			return value;
		}

		throw new Error(`Unsupported key envelope: ${path}`);
	}

	private encryptFallback(value: string): KeyEnvelope {
		return {
			version: 1,
			backend: 'file',
			algorithm: 'plain-restricted',
			payload: Buffer.from(value).toString('base64')
		};
	}
}

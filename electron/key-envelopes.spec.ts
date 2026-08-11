import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KeyEnvelopeStore, type SafeStorageAdapter } from './key-envelopes.js';

function fakeSafeStorage(): SafeStorageAdapter {
	return {
		isEncryptionAvailable: () => true,
		getSelectedStorageBackend: () => 'gnome_libsecret',
		encryptString: (value) => Buffer.from(value).reverse(),
		decryptString: (value) => Buffer.from(value).reverse().toString()
	};
}

describe('versioned TLS key envelopes', () => {
	it('migrates both fallback envelopes without returning private-key plaintext', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'pi-envelopes-'));
		try {
			const caPath = join(directory, 'ca.json');
			const leafPath = join(directory, 'leaf.json');
			const fallback = new KeyEnvelopeStore();
			await fallback.write(caPath, 'ca-private-key');
			await fallback.write(leafPath, 'leaf-private-key');

			const secure = new KeyEnvelopeStore(fakeSafeStorage());
			expect(await secure.migrate(caPath)).toBe(true);
			expect(await secure.migrate(leafPath)).toBe(true);
			expect(JSON.parse(await readFile(caPath, 'utf8')).backend).toBe('safeStorage');
			expect(JSON.parse(await readFile(leafPath, 'utf8')).backend).toBe('safeStorage');
			expect(secure.reducedProtectionWarning).toBeUndefined();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('uses secure storage and migrates restrictive files when available', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'pi-envelopes-'));
		try {
			const path = join(directory, 'key.json');
			const fallback = new KeyEnvelopeStore();
			await fallback.write(path, 'private-key');
			expect(fallback.reducedProtectionWarning).toContain('unavailable');
			const restartedFallback = new KeyEnvelopeStore();
			expect(await restartedFallback.read(path)).toBe('private-key');
			expect(restartedFallback.reducedProtectionWarning).toContain('unavailable');
			const secure = new KeyEnvelopeStore(fakeSafeStorage());
			expect(await secure.read(path)).toBe('private-key');
			expect(JSON.parse(await readFile(path, 'utf8')).backend).toBe('safeStorage');
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('rejects basic_text as secure storage', async () => {
		const store = new KeyEnvelopeStore({
			...fakeSafeStorage(),
			getSelectedStorageBackend: () => 'basic_text'
		});
		const path = join(await mkdtemp(join(tmpdir(), 'pi-envelopes-')), 'key.json');
		await store.write(path, 'value');
		expect(store.usesSecureStorage).toBe(false);
	});
});

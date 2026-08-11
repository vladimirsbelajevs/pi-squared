import 'reflect-metadata';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	BasicConstraintsExtension,
	ExtendedKeyUsageExtension,
	KeyUsagesExtension,
	SubjectAlternativeNameExtension,
	X509Certificate
} from '@peculiar/x509';
import { CertificateManager, certificateFiles } from './tls-certificates.js';
import { KeyEnvelopeStore } from './key-envelopes.js';

describe('managed local certificates', () => {
	it('creates the constrained CA and server profile with selected SANs', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'pi-certificates-'));
		try {
			const manager = new CertificateManager(certificateFiles(directory), new KeyEnvelopeStore());
			const state = await manager.loadOrCreate(['pi-squared.home.arpa'], ['192.168.1.20']);
			const ca = new X509Certificate(state.caCertificate);
			const leaf = new X509Certificate(state.leafCertificate);
			expect(ca.subject).toContain('Pi Squared Local CA');
			expect(ca.getExtension(BasicConstraintsExtension)?.ca).toBe(true);
			expect(ca.getExtension(KeyUsagesExtension)?.usages).toBe(96);
			expect(leaf.getExtension(BasicConstraintsExtension)?.ca).toBe(false);
			expect(leaf.getExtension(ExtendedKeyUsageExtension)?.usages).toContain('1.3.6.1.5.5.7.3.1');
			const names = leaf.getExtension(SubjectAlternativeNameExtension)?.names.toJSON() ?? [];
			expect(names).toEqual(
				expect.arrayContaining([
					{ type: 'dns', value: 'pi-squared.local' },
					{ type: 'dns', value: 'pi-squared.home.arpa' },
					{ type: 'ip', value: '192.168.1.20' }
				])
			);
			expect(ca.serialNumber).toMatch(/^[0-9a-f]+$/i);
			expect(ca.serialNumber).not.toMatch(/^0+$/);

			const secureStorage = {
				isEncryptionAvailable: () => true,
				getSelectedStorageBackend: () => 'gnome_libsecret',
				encryptString: (value: string) => Buffer.from(value).reverse(),
				decryptString: (value: Buffer) => Buffer.from(value).reverse().toString()
			};
			const restarted = new CertificateManager(
				certificateFiles(directory),
				new KeyEnvelopeStore(secureStorage)
			);
			const restored = await restarted.loadOrCreate(['pi-squared.home.arpa'], ['192.168.1.20']);
			expect(restored.fingerprint).toBe(state.fingerprint);
			expect(restored.leafCertificate).toBe(state.leafCertificate);
			expect(
				JSON.parse(await readFile(certificateFiles(directory).caKeyPath, 'utf8')).backend
			).toBe('safeStorage');
			expect(
				JSON.parse(await readFile(certificateFiles(directory).leafKeyPath, 'utf8')).backend
			).toBe('safeStorage');
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});

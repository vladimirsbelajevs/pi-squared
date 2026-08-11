import 'reflect-metadata';
import { Crypto } from '@peculiar/webcrypto';
import {
	AuthorityKeyIdentifierExtension,
	BasicConstraintsExtension,
	ExtendedKeyUsage,
	ExtendedKeyUsageExtension,
	KeyUsageFlags,
	KeyUsagesExtension,
	SubjectAlternativeNameExtension,
	SubjectKeyIdentifierExtension,
	X509Certificate,
	X509CertificateGenerator,
	cryptoProvider,
	DNS,
	IP,
	type JsonGeneralName,
	type GeneralNameType
} from '@peculiar/x509';
import { createHash, randomBytes } from 'node:crypto';
import { access, readFile, writeFile, mkdir, rename, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { KeyEnvelopeStore } from './key-envelopes.js';

const crypto = new Crypto();
cryptoProvider.set(crypto);
const RSA_ALGORITHM = {
	name: 'RSASSA-PKCS1-v1_5',
	hash: 'SHA-256',
	publicExponent: new Uint8Array([1, 0, 1]),
	modulusLength: 3072
} as const;
const BACKDATE_MS = 5 * 60 * 1000;
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
const LEAF_VALIDITY_MS = 397 * 24 * 60 * 60 * 1000;
const RENEWAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function pem(type: string, bytes: ArrayBuffer): string {
	const encoded = Buffer.from(bytes).toString('base64');

	return `-----BEGIN ${type}-----\n${encoded.match(/.{1,64}/g)?.join('\n') ?? ''}\n-----END ${type}-----\n`;
}

function positiveSerial(): string {
	const value = randomBytes(20);
	value[0] &= 0x7f;
	if (value.every((byte) => byte === 0)) {
		value[value.length - 1] = 1;
	}

	return value.toString('hex');
}

async function exportPkcs8(key: CryptoKey): Promise<string> {
	return pem('PRIVATE KEY', (await crypto.subtle.exportKey('pkcs8', key)) as ArrayBuffer);
}

async function importPkcs8(value: string): Promise<CryptoKey> {
	const bytes = Buffer.from(value.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), 'base64');

	return crypto.subtle.importKey('pkcs8', bytes, RSA_ALGORITHM, true, ['sign']);
}

function keyUsages(extension: KeyUsagesExtension | null): number | undefined {
	return extension?.usages;
}

export interface CertificateState {
	caCertificate: string;
	leafCertificate: string;
	leafKey: string;
	fingerprint: string;
	dnsNames: string[];
	addresses: string[];
	caNotAfter: string;
	leafNotAfter: string;
}

export interface CertificateFiles {
	caCertificatePath: string;
	caKeyPath: string;
	leafCertificatePath: string;
	leafKeyPath: string;
}

export function certificateFingerprint(certificate: string): string {
	const der = Buffer.from(certificate.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), 'base64');

	return (
		createHash('sha256')
			.update(der)
			.digest('hex')
			.match(/.{1,2}/g)
			?.join(':')
			.toUpperCase() ?? ''
	);
}

export function certificateFiles(root: string): CertificateFiles {
	return {
		caCertificatePath: `${root}/pi-squared-ca.crt`,
		caKeyPath: `${root}/pi-squared-ca.key.json`,
		leafCertificatePath: `${root}/pi-squared-server.crt`,
		leafKeyPath: `${root}/pi-squared-server.key.json`
	};
}

export class CertificateManager {
	private state?: CertificateState;
	constructor(
		private readonly files: CertificateFiles,
		private readonly envelopes: KeyEnvelopeStore
	) {}

	async loadOrCreate(dnsNames: string[], addresses: string[]): Promise<CertificateState> {
		const normalizedDns = [...new Set(dnsNames)].sort();
		const normalizedAddresses = [...new Set(addresses)].sort();
		try {
			// Migrate both key envelopes before loading the active leaf key. The
			// migration method keeps any CA plaintext scoped to its own call, while
			// the CA key remains unopened when no leaf issuance is needed.
			await Promise.all([
				this.envelopes.migrate(this.files.caKeyPath),
				this.envelopes.migrate(this.files.leafKeyPath)
			]);
			const [caCertificate, leafCertificate, leafKey] = await Promise.all([
				readFile(this.files.caCertificatePath, 'utf8'),
				readFile(this.files.leafCertificatePath, 'utf8'),
				this.envelopes.read(this.files.leafKeyPath)
			]);
			await this.envelopes.inspect(this.files.caKeyPath);
			await access(this.files.caKeyPath);
			const ca = new X509Certificate(caCertificate);
			const leaf = new X509Certificate(leafCertificate);
			await this.validateStoredState(ca, leaf, leafKey);
			const now = Date.now();
			if (ca.notAfter.getTime() <= now) {
				throw new Error('Stored TLS CA certificate is expired.');
			}

			const state: CertificateState = {
				caCertificate,
				leafCertificate,
				leafKey,
				fingerprint: certificateFingerprint(caCertificate),
				dnsNames: normalizedDns,
				addresses: normalizedAddresses,
				caNotAfter: ca.notAfter.toISOString(),
				leafNotAfter: leaf.notAfter.toISOString()
			};
			const needsRenewal =
				leaf.notAfter.getTime() <= now + RENEWAL_WINDOW_MS ||
				!this.sansMatch(leaf, normalizedDns, normalizedAddresses);
			if (!needsRenewal) {
				this.state = state;

				return state;
			}

			// The CA private key is decrypted only for leaf issuance/renewal.
			const caKey = await this.envelopes.read(this.files.caKeyPath);
			await this.assertPrivateKeyMatchesCertificate(caKey, ca);
			this.state = await this.issueLeaf(caCertificate, caKey, normalizedDns, normalizedAddresses);

			return this.state;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}

			const existingFiles = await Promise.all(
				Object.values(this.files).map(async (path) => {
					try {
						await access(path);

						return true;
					} catch {
						return false;
					}
				})
			);
			if (existingFiles.some(Boolean)) {
				throw new Error('Stored TLS certificate state is incomplete.', { cause: error });
			}

			this.state = await this.createAuthorityAndLeaf(normalizedDns, normalizedAddresses);

			return this.state;
		}
	}

	get current(): CertificateState | undefined {
		return this.state;
	}
	get keyProtectionWarning(): string | undefined {
		return this.envelopes.reducedProtectionWarning;
	}

	async reset(dnsNames: string[], addresses: string[]): Promise<CertificateState> {
		this.state = await this.createAuthorityAndLeaf(
			[...new Set(dnsNames)].sort(),
			[...new Set(addresses)].sort()
		);

		return this.state;
	}

	private async validateStoredState(
		ca: X509Certificate,
		leaf: X509Certificate,
		leafKey: string
	): Promise<void> {
		const caConstraints = ca.getExtension(BasicConstraintsExtension);
		const caUsage = ca.getExtension(KeyUsagesExtension);
		if (
			!caConstraints ||
			!caConstraints.critical ||
			!caConstraints.ca ||
			caConstraints.pathLength !== 0
		) {
			throw new Error('Stored TLS CA profile is invalid.');
		}

		if (
			!caUsage ||
			!caUsage.critical ||
			keyUsages(caUsage) !== (KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign)
		) {
			throw new Error('Stored TLS CA key usage is invalid.');
		}

		if (
			!ca.getExtension(SubjectKeyIdentifierExtension) ||
			!(await ca.isSelfSigned(crypto)) ||
			!(await ca.verify({ publicKey: ca.publicKey }, crypto))
		) {
			throw new Error('Stored TLS CA signature is invalid.');
		}

		const leafConstraints = leaf.getExtension(BasicConstraintsExtension);
		const leafUsage = leaf.getExtension(KeyUsagesExtension);
		const leafEku = leaf.getExtension(ExtendedKeyUsageExtension);
		if (!leafConstraints || !leafConstraints.critical || leafConstraints.ca) {
			throw new Error('Stored TLS server certificate profile is invalid.');
		}

		if (
			!leafUsage ||
			!leafUsage.critical ||
			keyUsages(leafUsage) !== (KeyUsageFlags.digitalSignature | KeyUsageFlags.keyEncipherment)
		) {
			throw new Error('Stored TLS server key usage is invalid.');
		}

		if (
			!leafEku ||
			!leafEku.usages.includes(ExtendedKeyUsage.serverAuth) ||
			!leaf.getExtension(SubjectAlternativeNameExtension) ||
			!leaf.getExtension(SubjectKeyIdentifierExtension) ||
			!leaf.getExtension(AuthorityKeyIdentifierExtension)
		) {
			throw new Error('Stored TLS server certificate extensions are invalid.');
		}

		if (leaf.issuer !== ca.subject || !(await leaf.verify({ publicKey: ca.publicKey }, crypto))) {
			throw new Error('Stored TLS server certificate signature is invalid.');
		}

		await this.assertPrivateKeyMatchesCertificate(leafKey, leaf);
	}

	private async assertPrivateKeyMatchesCertificate(
		keyPem: string,
		certificate: X509Certificate
	): Promise<void> {
		const privateKey = await importPkcs8(keyPem);
		const privateJwk = (await crypto.subtle.exportKey('jwk', privateKey)) as JsonWebKey;
		const publicKey = await certificate.publicKey.export(crypto);
		const certificateJwk = (await crypto.subtle.exportKey('jwk', publicKey)) as JsonWebKey;
		if (
			!privateJwk.n ||
			!privateJwk.e ||
			privateJwk.n !== certificateJwk.n ||
			privateJwk.e !== certificateJwk.e
		) {
			throw new Error('Stored TLS private key does not match its certificate.');
		}
	}

	private sansMatch(
		certificate: X509Certificate,
		dnsNames: string[],
		addresses: string[]
	): boolean {
		const extension = certificate.getExtension(SubjectAlternativeNameExtension);
		if (!extension) {
			return false;
		}

		const actual = extension.names
			.toJSON()
			.map((item) => `${item.type}:${item.value}`)
			.sort();
		const expected = [
			...dnsNames.map((name) => `${DNS}:${name}`),
			...addresses.map((address) => `${IP}:${address}`),
			`${DNS}:pi-squared.local`
		].sort();

		return JSON.stringify(actual) === JSON.stringify(expected);
	}

	private async createAuthorityAndLeaf(
		dnsNames: string[],
		addresses: string[]
	): Promise<CertificateState> {
		const authorityKeys = (await crypto.subtle.generateKey(RSA_ALGORITHM, true, [
			'sign',
			'verify'
		])) as CryptoKeyPair;
		const now = new Date(Date.now() - BACKDATE_MS);
		const ca = await X509CertificateGenerator.createSelfSigned(
			{
				serialNumber: positiveSerial(),
				name: 'CN=Pi Squared Local CA',
				keys: authorityKeys,
				notBefore: now,
				notAfter: new Date(now.getTime() + 10 * YEAR_MS),
				signingAlgorithm: RSA_ALGORITHM,
				extensions: [
					new BasicConstraintsExtension(true, 0, true),
					new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
					await SubjectKeyIdentifierExtension.create(authorityKeys.publicKey)
				]
			},
			crypto
		);
		const caCertificate = ca.toString('pem');
		const caKey = await exportPkcs8(authorityKeys.privateKey);
		await this.envelopes.write(this.files.caKeyPath, caKey);
		await writeAtomic(this.files.caCertificatePath, caCertificate);

		return this.issueLeaf(caCertificate, caKey, dnsNames, addresses);
	}

	private async issueLeaf(
		caCertificate: string,
		caKey: string,
		dnsNames: string[],
		addresses: string[]
	): Promise<CertificateState> {
		const ca = new X509Certificate(caCertificate);
		const authorityKey = await importPkcs8(caKey);
		const leafKeys = (await crypto.subtle.generateKey(RSA_ALGORITHM, true, [
			'sign',
			'verify'
		])) as CryptoKeyPair;
		const now = new Date(Date.now() - BACKDATE_MS);
		const names: JsonGeneralName[] = [
			{ type: DNS as GeneralNameType, value: 'pi-squared.local' },
			...dnsNames.map((value) => ({ type: DNS as GeneralNameType, value })),
			...addresses.map((value) => ({ type: IP as GeneralNameType, value }))
		];
		const leaf = await X509CertificateGenerator.create(
			{
				serialNumber: positiveSerial(),
				subject: 'CN=Pi Squared',
				issuer: ca.subject,
				publicKey: leafKeys.publicKey,
				signingKey: authorityKey,
				notBefore: now,
				notAfter: new Date(now.getTime() + LEAF_VALIDITY_MS),
				signingAlgorithm: RSA_ALGORITHM,
				extensions: [
					new BasicConstraintsExtension(false, undefined, true),
					new KeyUsagesExtension(
						KeyUsageFlags.digitalSignature | KeyUsageFlags.keyEncipherment,
						true
					),
					new ExtendedKeyUsageExtension([ExtendedKeyUsage.serverAuth]),
					new SubjectAlternativeNameExtension(names),
					await SubjectKeyIdentifierExtension.create(leafKeys.publicKey),
					await AuthorityKeyIdentifierExtension.create(ca.publicKey)
				]
			},
			crypto
		);
		const leafCertificate = leaf.toString('pem');
		const leafKey = await exportPkcs8(leafKeys.privateKey);
		await this.envelopes.write(this.files.leafKeyPath, leafKey);
		await writeAtomic(this.files.leafCertificatePath, leafCertificate);

		return {
			caCertificate,
			leafCertificate,
			leafKey,
			fingerprint: certificateFingerprint(caCertificate),
			dnsNames,
			addresses,
			caNotAfter: ca.notAfter.toISOString(),
			leafNotAfter: leaf.notAfter.toISOString()
		};
	}
}

async function writeAtomic(path: string, data: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, data, { encoding: 'utf8', mode: 0o600 });
	await chmod(temporary, 0o600);
	await rename(temporary, path);
}

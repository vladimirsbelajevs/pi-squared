import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { isIP } from 'node:net';

export type AddressFamily = 'IPv4' | 'IPv6';
export type AddressRisk =
	'private' | 'public' | 'link-local' | 'virtual' | 'temporary' | 'loopback';

export interface LanAddress {
	interfaceName: string;
	address: string;
	family: AddressFamily;
	netmask?: string;
	cidr?: string;
	internal: boolean;
	risk: AddressRisk[];
	label: string;
	recommended?: boolean;
}

export interface SelectedBinding {
	interfaceName: string;
	address: string;
	family: AddressFamily;
}

const PRIVATE_V4 = [
	[10, 0, 0, 0, 8],
	[172, 16, 0, 0, 12],
	[192, 168, 0, 0, 16]
] as const;

function v4Number(value: string): number {
	return value.split('.').reduce((result, octet) => (result << 8) | Number(octet), 0) >>> 0;
}

function inV4Range(value: string, base: number, bits: number): boolean {
	const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;

	return (v4Number(value) & mask) === (base & mask);
}

export function isWildcardAddress(address: string): boolean {
	const normalized = address.replace(/^\[|\]$/g, '').toLowerCase();

	return normalized === '0.0.0.0' || normalized === '::' || normalized === '::0';
}

export function isPrivateAddress(address: string): boolean {
	const normalized = address.replace(/^\[|\]$/g, '').toLowerCase();
	if (isIP(normalized) === 4) {
		return PRIVATE_V4.some(([a, b, c, d, bits]) =>
			inV4Range(normalized, v4Number(`${a}.${b}.${c}.${d}`), bits)
		);
	}

	return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd');
}

export function isLinkLocalAddress(address: string): boolean {
	const normalized = address.replace(/^\[|\]$/g, '').toLowerCase();

	return normalized.startsWith('169.254.') || normalized.startsWith('fe80:');
}

function riskForAddress(interfaceName: string, address: string, internal: boolean): AddressRisk[] {
	const risks: AddressRisk[] = [];
	const lowerInterface = interfaceName.toLowerCase();
	if (internal || address === '127.0.0.1' || address === '::1') {
		risks.push('loopback');
	}

	if (isPrivateAddress(address) && !risks.includes('loopback')) {
		risks.push('private');
	}

	if (isLinkLocalAddress(address)) {
		risks.push('link-local');
	}

	if (address.includes('%')) {
		risks.push('temporary');
	}

	if (!isPrivateAddress(address) && !isLinkLocalAddress(address) && !risks.includes('loopback')) {
		risks.push('public');
	}

	if (
		/(docker|podman|container|br-|veth|virbr|vmnet|wsl|tailscale|wireguard|tun|tap|vpn)/.test(
			lowerInterface
		)
	) {
		risks.push('virtual');
	}

	if (
		(address.includes('%') || address.toLowerCase().includes('temporary')) &&
		!risks.includes('temporary')
	) {
		risks.push('temporary');
	}

	return risks;
}

export function inventoryAddresses(
	interfaces: NodeJS.Dict<NetworkInterfaceInfo[] | undefined> = networkInterfaces()
): LanAddress[] {
	const result: LanAddress[] = [];
	for (const [interfaceName, entries] of Object.entries(interfaces)) {
		for (const entry of entries ?? []) {
			const family: AddressFamily = entry.family === 'IPv6' ? 'IPv6' : 'IPv4';
			const rawAddress = entry.address;
			const address = rawAddress.replace(/%.*$/, '');
			const risk = riskForAddress(interfaceName, rawAddress, entry.internal);
			result.push({
				interfaceName,
				address,
				family,
				netmask: entry.netmask,
				cidr: entry.cidr ?? undefined,
				internal: entry.internal,
				risk,
				label: risk.join(', ') || 'unclassified'
			});
		}
	}

	return result;
}

export function defaultSelectedAddress(addresses: LanAddress[]): LanAddress | undefined {
	return addresses.find(
		(address) =>
			address.family === 'IPv4' &&
			!address.internal &&
			address.risk.includes('private') &&
			!address.risk.includes('virtual') &&
			!address.risk.includes('link-local')
	);
}

export function normalizeBinding(binding: SelectedBinding): SelectedBinding {
	const address = binding.address.replace(/^\[|\]$/g, '').replace(/%.*$/, '');
	if (!binding.interfaceName.trim() || !address || isWildcardAddress(address) || !isIP(address)) {
		throw new Error('Selected listeners must use concrete IP addresses.');
	}

	const family: AddressFamily = isIP(address) === 6 ? 'IPv6' : 'IPv4';
	if (family !== binding.family) {
		throw new Error('Selected address family does not match the address.');
	}

	return { interfaceName: binding.interfaceName, address, family };
}

export function validateSelectedBindings(
	bindings: SelectedBinding[],
	addresses: LanAddress[] = inventoryAddresses()
): SelectedBinding[] {
	const current = new Map(
		addresses.map((item) => [`${item.interfaceName}|${item.address}|${item.family}`, item])
	);
	const normalized = bindings.map(normalizeBinding);
	const deduplicated = new Map<string, SelectedBinding>();
	for (const binding of normalized) {
		const key = `${binding.interfaceName}|${binding.address}|${binding.family}`;
		if (!current.has(key)) {
			throw new Error(`Selected address is no longer available: ${binding.address}`);
		}

		if (!deduplicated.has(key)) {
			deduplicated.set(key, binding);
		}
	}

	return [...deduplicated.values()];
}

export function isAllowedExternalHost(
	host: string,
	bindings: SelectedBinding[],
	dnsNames: string[]
): boolean {
	const value = host.trim().toLowerCase();
	const normalized =
		value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value.replace(/:\d+$/, '');

	return (
		bindings.some((binding) => binding.address.toLowerCase() === normalized) ||
		dnsNames.some((name) => name.toLowerCase() === normalized) ||
		normalized === 'pi-squared.local'
	);
}

export function validateDnsName(value: string): string {
	const name = value.trim().toLowerCase().replace(/\.$/, '');
	if (
		!name ||
		isIP(name) !== 0 ||
		name.length > 253 ||
		name.includes('..') ||
		name.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
	) {
		throw new Error(`Invalid DNS name: ${value}`);
	}

	return name;
}

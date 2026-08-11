import { describe, expect, it } from 'vitest';
import {
	defaultSelectedAddress,
	inventoryAddresses,
	isAllowedExternalHost,
	isWildcardAddress,
	validateSelectedBindings
} from './lan-addresses.js';

describe('LAN address selection', () => {
	const interfaces = {
		eth0: [
			{
				address: '192.168.1.20',
				netmask: '255.255.255.0',
				family: 'IPv4' as const,
				mac: '',
				internal: false,
				cidr: '192.168.1.20/24'
			}
		],
		docker0: [
			{
				address: '172.17.0.1',
				netmask: '255.255.0.0',
				family: 'IPv4' as const,
				mac: '',
				internal: false,
				cidr: '172.17.0.1/16'
			}
		],
		lo: [
			{
				address: '127.0.0.1',
				netmask: '255.0.0.0',
				family: 'IPv4' as const,
				mac: '',
				internal: true,
				cidr: '127.0.0.1/8'
			}
		]
	};

	it('inventories concrete addresses and labels virtual interfaces', () => {
		const addresses = inventoryAddresses(interfaces);
		expect(defaultSelectedAddress(addresses)?.address).toBe('192.168.1.20');
		expect(addresses.find((item) => item.address === '172.17.0.1')?.risk).toContain('virtual');
		expect(isWildcardAddress('0.0.0.0')).toBe(true);
		expect(isWildcardAddress('::')).toBe(true);
	});

	it('labels scoped IPv6 addresses as temporary and never selects them by default', () => {
		const addresses = inventoryAddresses({
			wlan0: [
				{
					address: 'fe80::20%wlan0',
					netmask: 'ffff:ffff:ffff:ffff::',
					family: 'IPv6' as const,
					mac: '',
					internal: false,
					cidr: 'fe80::20/64'
				}
			]
		});
		expect(addresses[0]?.address).toBe('fe80::20');
		expect(addresses[0]?.risk).toEqual(expect.arrayContaining(['link-local', 'temporary']));
		expect(defaultSelectedAddress(addresses)).toBeUndefined();
	});

	it('validates only explicitly selected concrete addresses', () => {
		const addresses = inventoryAddresses(interfaces);
		expect(() =>
			validateSelectedBindings(
				[{ interfaceName: 'eth0', address: '0.0.0.0', family: 'IPv4' }],
				addresses
			)
		).toThrow();
		const selected = validateSelectedBindings(
			[{ interfaceName: 'eth0', address: '192.168.1.20', family: 'IPv4' }],
			addresses
		);
		expect(selected).toEqual([{ interfaceName: 'eth0', address: '192.168.1.20', family: 'IPv4' }]);
	});

	it('allows only selected IPs and configured names as external authorities', () => {
		const bindings = [{ interfaceName: 'eth0', address: '192.168.1.20', family: 'IPv4' as const }];
		expect(isAllowedExternalHost('192.168.1.20', bindings, ['pi-squared.home.arpa'])).toBe(true);
		expect(isAllowedExternalHost('192.168.1.21', bindings, ['pi-squared.home.arpa'])).toBe(false);
		expect(isAllowedExternalHost('pi-squared.home.arpa', bindings, ['pi-squared.home.arpa'])).toBe(
			true
		);
		expect(
			isAllowedExternalHost(
				'[fd00::20]',
				[{ interfaceName: 'lan0', address: 'fd00::20', family: 'IPv6' }],
				[]
			)
		).toBe(true);
	});
});

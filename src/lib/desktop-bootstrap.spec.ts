import { describe, expect, it } from 'vitest';
import {
	detectBootstrapStatus,
	meetsMinimumNodeVersion,
	parseNodeVersion,
	REQUIRED_PI_PACKAGES
} from '../../electron/bootstrap.js';

describe('desktop Pi bootstrap detection', () => {
	it('parses and enforces the supported Node.js version', () => {
		expect(parseNodeVersion('v22.19.0')).toEqual([22, 19, 0]);
		expect(meetsMinimumNodeVersion('22.19.0')).toBe(true);
		expect(meetsMinimumNodeVersion('22.18.9')).toBe(false);
		expect(meetsMinimumNodeVersion('23.0.0')).toBe(true);
	});

	it('reports all required packages and permission state without a marker file', async () => {
		const packageSettings = JSON.stringify({ packages: REQUIRED_PI_PACKAGES });
		const sharedConfig = { permission: { '*': 'allow', path: { '*.env': 'deny' } } };
		const status = await detectBootstrapStatus({
			agentDirectory: '/agent',
			sharedPermissionConfigPath: '/shared/permissions.json',
			nodeVersion: '22.19.0',
			commandExists: async (command) => command !== 'pi',
			readJson: async (path) => {
				if (path.endsWith('settings.json')) {
					return JSON.parse(packageSettings);
				}

				if (path === '/shared/permissions.json' || path.endsWith('config.json')) {
					return { ...sharedConfig, custom: { enabled: true } };
				}

				return undefined;
			},
			fileExists: async (path) => path.endsWith('config.json')
		});

		expect(status.configured).toBe(false);
		expect(status.prerequisites.pi).toBe(false);
		expect(status.missingPackages).toEqual([]);
		expect(status.permissionConfig).toBe(true);
	});

	it('accepts pinned package specs and manifests in the managed package layout', async () => {
		const settings = { packages: ['npm:pi-mcp-adapter@2.18.0'] };
		const status = await detectBootstrapStatus({
			agentDirectory: '/agent',
			sharedPermissionConfigPath: '/shared/permissions.json',
			nodeVersion: '22.19.0',
			commandExists: async () => true,
			readJson: async (path) => {
				if (path.endsWith('settings.json')) {
					return settings;
				}

				if (path === '/agent/npm/node_modules/pi-subagents/package.json') {
					return { name: 'pi-subagents', version: '1.0.0' };
				}

				if (path === '/shared/permissions.json' || path.endsWith('config.json')) {
					return { permission: { '*': 'allow' } };
				}

				return undefined;
			},
			fileExists: async (path) => path.endsWith('config.json'),
			readDirectory: async (path) => {
				if (path === '/agent/npm/node_modules') {
					return [{ name: 'pi-subagents', isDirectory: () => true } as never];
				}

				return [];
			}
		});

		expect(status.missingPackages).not.toContain('npm:pi-mcp-adapter');
		expect(status.missingPackages).not.toContain('npm:pi-subagents');
	});

	it('rejects invalid or incomplete shared permission configuration', async () => {
		const readStatus = async (target: unknown) =>
			detectBootstrapStatus({
				agentDirectory: '/agent',
				sharedPermissionConfigPath: '/shared/permissions.json',
				commandExists: async () => true,
				nodeVersion: '22.19.0',
				readJson: async (path) => {
					if (path === '/shared/permissions.json') {
						return { permission: { '*': 'allow' } };
					}

					if (path.endsWith('config.json')) {
						return target;
					}

					return { packages: REQUIRED_PI_PACKAGES };
				},
				fileExists: async (path) => path.endsWith('config.json')
			});

		expect((await readStatus('{not json')).permissionConfig).toBe(false);
		expect((await readStatus({ permission: {} })).permissionConfig).toBe(false);
		expect(
			(await readStatus({ permission: { '*': 'allow' }, custom: true })).permissionConfig
		).toBe(true);
	});
});

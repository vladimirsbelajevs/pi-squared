import { describe, expect, it } from 'vitest';
import { parseMcpStatusSnapshot } from './mcp-status.js';

const validSnapshot = {
	version: 1,
	servers: [
		{
			name: 'svelte',
			status: 'connected',
			toolCount: 5,
			resourceCount: 2,
			disabled: false
		},
		{
			name: 'archive',
			status: 'disabled',
			toolCount: 0,
			disabled: true
		}
	],
	totalTools: 5,
	totalResources: 2,
	connectedCount: 1,
	disabledCount: 1
};

describe('MCP status snapshots', () => {
	it('normalizes adapter status into a browser-safe snapshot', () => {
		expect(parseMcpStatusSnapshot(validSnapshot)).toEqual({
			servers: [
				{
					name: 'svelte',
					state: 'connected',
					toolCount: 5,
					resourceCount: 2,
					disabled: false
				},
				{
					name: 'archive',
					state: 'disabled',
					toolCount: 0,
					disabled: true
				}
			],
			totalTools: 5,
			totalResources: 2,
			connectedCount: 1,
			disabledCount: 1
		});
	});

	it.each([
		{ ...validSnapshot, version: 2 },
		{ ...validSnapshot, connectedCount: -1 },
		{
			...validSnapshot,
			servers: [{ name: 'svelte', status: 'unknown', toolCount: 0, disabled: false }]
		},
		{
			...validSnapshot,
			servers: [{ name: '', status: 'connected', toolCount: 0, disabled: false }]
		}
	])('rejects malformed status payloads', (snapshot) => {
		expect(parseMcpStatusSnapshot(snapshot)).toBeUndefined();
	});
});

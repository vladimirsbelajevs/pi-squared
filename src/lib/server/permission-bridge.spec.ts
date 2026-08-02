import { describe, expect, it } from 'vitest';
import type { RuntimeEvent, RuntimeMutation } from '$lib/contracts';
import { PermissionBridge } from './permission-bridge.js';

type PublishedEvent = RuntimeMutation | RuntimeEvent;

describe('PermissionBridge', () => {
	it('publishes a selection request and resolves it from the browser response', async () => {
		const events: PublishedEvent[] = [];
		const bridge = new PermissionBridge((event) => events.push(event));
		const selection = bridge.select('Permission Required', ['Yes', 'No']);
		const request = events[0];
		expect(request).toMatchObject({
			type: 'permission_request',
			request: { method: 'select', title: 'Permission Required', options: ['Yes', 'No'] }
		});
		if (request?.type !== 'permission_request') {
			throw new Error('Expected a permission request.');
		}

		bridge.respond({ requestId: request.request.id, value: 'Yes' });
		await expect(selection).resolves.toBe('Yes');
		expect(events.at(-1)).toEqual({ type: 'permission_resolved', requestId: request.request.id });
	});

	it('lists unresolved requests for runtime checkpoints', async () => {
		const bridge = new PermissionBridge(() => undefined);
		const selection = bridge.select('Permission Required', ['Yes', 'No']);
		expect(bridge.pendingRequests).toMatchObject([
			{ method: 'select', title: 'Permission Required', options: ['Yes', 'No'] }
		]);
		const [request] = bridge.pendingRequests;
		if (!request) {
			throw new Error('Expected a pending permission request.');
		}

		bridge.respond({ requestId: request.id, value: 'Yes' });
		await expect(selection).resolves.toBe('Yes');
		expect(bridge.pendingRequests).toEqual([]);
	});

	it('cancels a pending confirmation when the agent aborts it', async () => {
		const events: PublishedEvent[] = [];
		const bridge = new PermissionBridge((event) => events.push(event));
		const controller = new AbortController();
		const confirmation = bridge.confirm('Approve command?', 'pwd', { signal: controller.signal });
		controller.abort();
		await expect(confirmation).resolves.toBe(false);
		expect(events.map((event) => event.type)).toEqual([
			'permission_request',
			'permission_resolved'
		]);
	});

	it('rejects a selection that was not offered', async () => {
		const events: PublishedEvent[] = [];
		const bridge = new PermissionBridge((event) => events.push(event));
		const selection = bridge.select('Permission Required', ['Yes', 'No']);
		const request = events[0];
		if (request?.type !== 'permission_request') {
			throw new Error('Expected a permission request.');
		}

		expect(() => bridge.respond({ requestId: request.request.id, value: 'Maybe' })).toThrow(
			'The response does not match the pending permission request.'
		);
		bridge.respond({ requestId: request.request.id, cancelled: true });
		await expect(selection).resolves.toBeUndefined();
	});

	it('reports unsupported custom dialogs without rejecting', async () => {
		const events: PublishedEvent[] = [];
		const bridge = new PermissionBridge((event) => events.push(event));
		await expect(bridge.extensionUI.custom(() => ({}) as never)).resolves.toBeUndefined();
		expect(events).toEqual([
			{ type: 'notice', message: 'This extension dialog is only available in the Pi terminal UI.' }
		]);
	});
});

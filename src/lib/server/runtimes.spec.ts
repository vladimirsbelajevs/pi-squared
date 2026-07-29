import { describe, expect, it, vi } from 'vitest';
import {
	createEventBus,
	type AgentSession,
	type ExtensionUIContext
} from '@earendil-works/pi-coding-agent';
import {
	bindRuntimeExtensions,
	resolveWebExtensionCommand,
	shutdownRuntimeSession,
	subscribeToMcpStatus
} from './runtimes.js';
import { MCP_STATUS_EVENT } from './mcp-status.js';

describe('runtime extension binding', () => {
	it('routes MCP panel commands to web-safe text behavior', () => {
		expect(resolveWebExtensionCommand('/mcp')).toEqual({
			text: '/mcp tools',
			notice: 'The interactive MCP panel is terminal-only. Showing discovered MCP tools instead.'
		});
		expect(resolveWebExtensionCommand('/mcp status')).toEqual({
			text: '/mcp tools',
			notice: 'The interactive MCP panel is terminal-only. Showing discovered MCP tools instead.'
		});
		expect(resolveWebExtensionCommand('/mcp unknown')).toEqual({
			text: '/mcp tools',
			notice: 'The interactive MCP panel is terminal-only. Showing discovered MCP tools instead.'
		});
		expect(resolveWebExtensionCommand('/mcp setup')).toEqual({
			notice: 'MCP setup is terminal-only. Edit the project .mcp.json, then reopen the chat.'
		});
		expect(resolveWebExtensionCommand('/mcp-auth')).toEqual({
			notice: 'Specify an MCP server: /mcp-auth <server>'
		});
		expect(resolveWebExtensionCommand('/mcp reconnect svelte')).toEqual({
			text: '/mcp reconnect svelte'
		});
	});

	it('forwards valid MCP extension-bus snapshots and ignores malformed data', () => {
		const events = createEventBus();
		const onStatus = vi.fn();
		const unsubscribe = subscribeToMcpStatus(events, onStatus);

		events.emit(MCP_STATUS_EVENT, {
			version: 1,
			servers: [{ name: 'svelte', status: 'connected', toolCount: 5, disabled: false }],
			totalTools: 5,
			totalResources: 0,
			connectedCount: 1,
			disabledCount: 0
		});
		events.emit(MCP_STATUS_EVENT, { version: 1, servers: [] });

		expect(onStatus).toHaveBeenCalledOnce();
		expect(onStatus).toHaveBeenCalledWith({
			servers: [{ name: 'svelte', state: 'connected', toolCount: 5, disabled: false }],
			totalTools: 5,
			totalResources: 0,
			connectedCount: 1,
			disabledCount: 0
		});

		unsubscribe();
		events.emit(MCP_STATUS_EVENT, {
			version: 1,
			servers: [],
			totalTools: 0,
			totalResources: 0,
			connectedCount: 0,
			disabledCount: 0
		});
		expect(onStatus).toHaveBeenCalledOnce();
	});

	it('uses Pi RPC lifecycle bindings and surfaces extension failures', async () => {
		const waitForIdle = vi.fn().mockResolvedValue(undefined);
		const reload = vi.fn().mockResolvedValue(undefined);
		const bindExtensions = vi.fn().mockResolvedValue(undefined);
		const session = { waitForIdle, reload, bindExtensions } as unknown as AgentSession;
		const onError = vi.fn();
		const onShutdown = vi.fn();

		await bindRuntimeExtensions(session, {} as ExtensionUIContext, onError, onShutdown);

		expect(bindExtensions).toHaveBeenCalledOnce();
		const bindings = bindExtensions.mock.calls[0][0];
		expect(bindings.mode).toBe('rpc');
		expect(await bindings.commandContextActions.waitForIdle()).toBeUndefined();
		expect(waitForIdle).toHaveBeenCalledOnce();
		expect(await bindings.commandContextActions.reload()).toBeUndefined();
		expect(reload).toHaveBeenCalledOnce();
		expect(await bindings.commandContextActions.newSession()).toEqual({ cancelled: true });
		expect(await bindings.commandContextActions.fork()).toEqual({ cancelled: true });
		expect(await bindings.commandContextActions.navigateTree()).toEqual({ cancelled: true });
		expect(await bindings.commandContextActions.switchSession()).toEqual({ cancelled: true });

		bindings.onError({ extensionPath: 'mcp', event: 'session_start', error: 'Connection refused' });
		expect(onError).toHaveBeenCalledWith('Extension session_start failed: Connection refused');
		bindings.shutdownHandler();
		expect(onShutdown).toHaveBeenCalledOnce();
	});

	it('emits session_shutdown before disposing the SDK session', async () => {
		const emit = vi.fn().mockResolvedValue(true);
		const dispose = vi.fn();
		const session = { extensionRunner: { emit }, dispose } as unknown as AgentSession;

		await shutdownRuntimeSession(session);

		expect(emit).toHaveBeenCalledWith({ type: 'session_shutdown', reason: 'quit' });
		expect(dispose).toHaveBeenCalledOnce();
	});

	it('still disposes the SDK session when an extension shutdown handler fails', async () => {
		const emit = vi.fn().mockRejectedValue(new Error('shutdown failed'));
		const dispose = vi.fn();
		const session = { extensionRunner: { emit }, dispose } as unknown as AgentSession;

		await expect(shutdownRuntimeSession(session)).rejects.toThrow('shutdown failed');
		expect(dispose).toHaveBeenCalledOnce();
	});
});

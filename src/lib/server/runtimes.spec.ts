import { describe, expect, it, vi } from 'vitest';
import type { AgentSession, ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import {
	bindRuntimeExtensions,
	resolveWebExtensionCommand,
	shutdownRuntimeSession
} from './runtimes.js';

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

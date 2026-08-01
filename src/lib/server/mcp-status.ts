import type { McpServerState, McpServerStatus, McpStatusSnapshot } from '$lib/contracts';

export const MCP_STATUS_EVENT = 'pi-mcp-adapter/status/v1';

const serverStates = new Set<McpServerState>([
	'connected',
	'cached',
	'failed',
	'needs-auth',
	'not-connected',
	'disabled'
]);

function numberAtLeastZero(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Validate and strip an extension-owned status payload before exposing it to the browser. */
export function parseMcpStatusSnapshot(value: unknown): McpStatusSnapshot | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}

	const snapshot = value as Record<string, unknown>;
	if (
		snapshot.version !== 1 ||
		!Array.isArray(snapshot.servers) ||
		!numberAtLeastZero(snapshot.totalTools) ||
		!numberAtLeastZero(snapshot.totalResources) ||
		!numberAtLeastZero(snapshot.connectedCount) ||
		!numberAtLeastZero(snapshot.disabledCount)
	) {
		return undefined;
	}

	const servers = snapshot.servers.map((value) => {
		if (!value || typeof value !== 'object') {
			return undefined;
		}

		const server = value as Record<string, unknown>;
		if (
			typeof server.name !== 'string' ||
			!server.name ||
			typeof server.status !== 'string' ||
			!serverStates.has(server.status as McpServerState) ||
			!numberAtLeastZero(server.toolCount) ||
			typeof server.disabled !== 'boolean'
		) {
			return undefined;
		}

		if (server.resourceCount !== undefined && !numberAtLeastZero(server.resourceCount)) {
			return undefined;
		}

		if (server.failedAgoSeconds !== undefined && !numberAtLeastZero(server.failedAgoSeconds)) {
			return undefined;
		}

		return {
			name: server.name,
			state: server.status as McpServerState,
			toolCount: server.toolCount,
			...(server.resourceCount === undefined ? {} : { resourceCount: server.resourceCount }),
			...(server.failedAgoSeconds === undefined
				? {}
				: { failedAgoSeconds: server.failedAgoSeconds }),
			disabled: server.disabled
		};
	});

	const validServers = servers.filter((server): server is McpServerStatus => server !== undefined);
	if (validServers.length !== snapshot.servers.length) {
		return undefined;
	}

	return {
		servers: validServers,
		totalTools: snapshot.totalTools,
		totalResources: snapshot.totalResources,
		connectedCount: snapshot.connectedCount,
		disabledCount: snapshot.disabledCount
	};
}

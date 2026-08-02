import type { ToolStatus } from '$lib/contracts';
import type { StreamingTool } from '$lib/harness/types';

function isTerminal(status: ToolStatus | undefined): status is ToolStatus {
	return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/** Merges ordered live-tool patches without dropping data omitted by later lifecycle events. */
export function mergeStreamingTool(
	previous: StreamingTool | undefined,
	patch: StreamingTool
): StreamingTool {
	if (!previous) {
		return { ...patch };
	}

	return {
		id: previous.id,
		name: patch.name,
		...(isTerminal(previous.status) && !isTerminal(patch.status)
			? { status: previous.status }
			: patch.status !== undefined
				? { status: patch.status }
				: previous.status !== undefined
					? { status: previous.status }
					: {}),
		...(previous.arguments !== undefined || patch.arguments !== undefined
			? { arguments: patch.arguments ?? previous.arguments }
			: {}),
		...(previous.text !== undefined || patch.text !== undefined
			? { text: patch.text ?? previous.text }
			: {})
	};
}

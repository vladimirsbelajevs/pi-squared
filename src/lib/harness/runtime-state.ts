import type {
	ChatItem,
	RuntimeCheckpoint,
	RuntimeEvent,
	RuntimeLiveState,
	RuntimeSnapshot
} from '$lib/contracts';

export interface RuntimeConversationState {
	revision: number;
	itemsById: Map<string, ChatItem>;
	itemOrder: string[];
	metadata: Omit<RuntimeSnapshot, 'items'>;
	live: RuntimeLiveState;
	recovering: boolean;
}

export type ApplyResult = 'applied' | 'duplicate' | 'recovery';

function sameItem(left: ChatItem | undefined, right: ChatItem): boolean {
	return left === right || (left !== undefined && JSON.stringify(left) === JSON.stringify(right));
}

function cloneLive(live: RuntimeLiveState): RuntimeLiveState {
	return {
		text: live.text,
		thinking: live.thinking,
		tools: live.tools.map((tool) => ({ ...tool }))
	};
}

export function snapshotFromState(state: RuntimeConversationState): RuntimeSnapshot {
	return {
		...state.metadata,
		items: state.itemOrder.flatMap((id) => {
			const item = state.itemsById.get(id);

			return item ? [item] : [];
		})
	};
}

export function stateFromCheckpoint(
	checkpoint: RuntimeCheckpoint,
	previous?: RuntimeConversationState
): RuntimeConversationState {
	const itemsById = new Map<string, ChatItem>();
	for (const item of checkpoint.snapshot.items) {
		const existing = previous?.itemsById.get(item.id);
		itemsById.set(item.id, sameItem(existing, item) ? existing! : item);
	}

	return {
		revision: checkpoint.revision,
		itemsById,
		itemOrder: checkpoint.snapshot.items.map((item) => item.id),
		metadata: { ...checkpoint.snapshot, items: undefined } as Omit<RuntimeSnapshot, 'items'>,
		live: cloneLive(checkpoint.live),
		recovering: false
	};
}

/** Applies only contiguous revisions. Callers must fetch a checkpoint after `recovery`. */
export function applyRuntimeEvent(
	state: RuntimeConversationState,
	event: RuntimeEvent
): ApplyResult {
	if (event.type === 'notice' || event.type === 'error') {
		return 'applied';
	}

	if (event.revision <= state.revision) {
		return 'duplicate';
	}

	if (event.baseRevision !== state.revision) {
		state.recovering = true;

		return 'recovery';
	}

	if (event.type === 'items_appended') {
		if (event.afterId !== undefined && state.itemOrder.at(-1) !== event.afterId) {
			state.recovering = true;

			return 'recovery';
		}

		for (const item of event.items) {
			const existing = state.itemsById.get(item.id);
			if (!existing) {
				state.itemOrder.push(item.id);
			}

			state.itemsById.set(item.id, sameItem(existing, item) ? existing! : item);
		}

		if (!state.metadata.isStreaming) {
			state.live = { text: '', thinking: '', tools: [] };
		}
	} else if (event.type === 'item_updated') {
		if (!state.itemsById.has(event.item.id)) {
			state.recovering = true;

			return 'recovery';
		}

		const existing = state.itemsById.get(event.item.id);
		state.itemsById.set(event.item.id, sameItem(existing, event.item) ? existing! : event.item);
	} else if (event.type === 'items_replaced') {
		const itemsById = new Map<string, ChatItem>();
		for (const item of event.items) {
			const existing = state.itemsById.get(item.id);
			itemsById.set(item.id, sameItem(existing, item) ? existing! : item);
		}

		state.itemsById = itemsById;
		state.itemOrder = event.items.map((item) => item.id);
		if (!state.metadata.isStreaming) {
			state.live = { text: '', thinking: '', tools: [] };
		}
	} else if (event.type === 'metadata_updated') {
		state.metadata = { ...state.metadata, ...event.patch };
		if (event.patch.isStreaming === false) {
			state.live = { text: '', thinking: '', tools: [] };
		}
	} else if (event.type === 'assistant_delta') {
		state.live = {
			...state.live,
			text: state.live.text + (event.text ?? ''),
			thinking: state.live.thinking + (event.thinking ?? '')
		};
	} else if (event.type === 'tool_update') {
		const index = state.live.tools.findIndex((tool) => tool.id === event.toolCallId);
		const next = {
			id: event.toolCallId,
			name: event.toolName,
			status: event.status,
			...(event.arguments !== undefined ? { arguments: event.arguments } : {}),
			...(event.text !== undefined ? { text: event.text } : {})
		};
		const tools = [...state.live.tools];
		if (index < 0) {
			tools.push(next);
		} else {
			tools[index] = { ...tools[index], ...next };
		}

		state.live = { ...state.live, tools };
	} else if (event.type === 'permission_request') {
		if (!state.metadata.permissionRequests.some((request) => request.id === event.request.id)) {
			state.metadata = {
				...state.metadata,
				permissionRequests: [...state.metadata.permissionRequests, event.request]
			};
		}
	} else if (event.type === 'permission_resolved') {
		state.metadata = {
			...state.metadata,
			permissionRequests: state.metadata.permissionRequests.filter(
				(request) => request.id !== event.requestId
			)
		};
	}

	state.revision = event.revision;

	return 'applied';
}

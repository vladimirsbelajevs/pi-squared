import type { ChatItem } from '$lib/contracts';
import type { PendingUserMessage } from './types';

/**
 * Removes optimistic messages once their corresponding persisted user entries appear.
 *
 * Each pending message tracks user IDs seen before it was submitted. After every
 * snapshot, remaining messages also remember every current user ID. This prevents
 * an older matching entry from acknowledging a later, identical prompt.
 */
export function reconcilePendingUserMessages(
	pendingMessages: readonly PendingUserMessage[],
	items: readonly ChatItem[]
): PendingUserMessage[] {
	if (!pendingMessages.length) return [];

	const userItems = items.filter((item) => item.role === 'user');
	const currentUserItemIds = userItems.map((item) => item.id);
	const consumedUserItemIds = new Set<string>();
	const remaining: PendingUserMessage[] = [];

	for (const pending of pendingMessages) {
		const knownUserItemIds = new Set(pending.knownUserItemIds);
		const matchingItem = userItems.find(
			(item) =>
				item.text === pending.text &&
				!knownUserItemIds.has(item.id) &&
				!consumedUserItemIds.has(item.id)
		);
		if (matchingItem) {
			consumedUserItemIds.add(matchingItem.id);
			continue;
		}

		remaining.push({
			...pending,
			knownUserItemIds: [...new Set([...pending.knownUserItemIds, ...currentUserItemIds])]
		});
	}

	return remaining;
}

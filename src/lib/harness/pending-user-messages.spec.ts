import { describe, expect, it } from 'vitest';
import type { ChatItem } from '$lib/contracts';
import type { PendingUserMessage } from './types';
import { reconcilePendingUserMessages } from './pending-user-messages';

function userItem(id: string, text: string): ChatItem {
	return { id, kind: 'message', role: 'user', text };
}

function pending(id: string, text: string, knownUserItemIds: string[]): PendingUserMessage {
	return {
		id,
		text,
		timestamp: '2026-07-29T12:00:00.000Z',
		knownUserItemIds
	};
}

describe('reconcilePendingUserMessages', () => {
	it('does not acknowledge a pending message with a pre-existing identical entry', () => {
		const existing = userItem('user-existing', 'Repeat this');
		const pendingMessage = pending('pending-1', existing.text, [existing.id]);

		expect(reconcilePendingUserMessages([pendingMessage], [existing])).toEqual([pendingMessage]);
		expect(
			reconcilePendingUserMessages(
				[pendingMessage],
				[existing, userItem('user-new', existing.text)]
			)
		).toEqual([]);
	});

	it('acknowledges repeated identical prompts in FIFO order without reusing an entry', () => {
		const existing = userItem('user-existing', 'Repeat this');
		const first = pending('pending-1', existing.text, [existing.id]);
		const second = pending('pending-2', existing.text, [existing.id]);
		const firstAuthoritative = userItem('user-first', existing.text);

		const afterFirstSnapshot = reconcilePendingUserMessages(
			[first, second],
			[existing, firstAuthoritative]
		);
		expect(afterFirstSnapshot).toEqual([
			{ ...second, knownUserItemIds: [existing.id, firstAuthoritative.id] }
		]);

		expect(
			reconcilePendingUserMessages(afterFirstSnapshot, [
				existing,
				firstAuthoritative,
				userItem('user-second', existing.text)
			])
		).toEqual([]);
	});
});

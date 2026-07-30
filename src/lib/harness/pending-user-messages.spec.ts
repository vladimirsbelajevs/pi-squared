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
		attachments: [],
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

	it('requires matching attachment identity before acknowledging an optimistic message', () => {
		const attachment = {
			id: 'image-1',
			kind: 'image' as const,
			name: 'diagram.png',
			mimeType: 'image/png',
			size: 8,
			data: 'iVBORw0KGgo='
		};
		const pendingMessage = {
			...pending('pending-1', '', []),
			attachments: [attachment]
		};

		expect(
			reconcilePendingUserMessages(
				[pendingMessage],
				[{ ...userItem('user-wrong', ''), attachments: [{ ...attachment, id: 'image-2' }] }]
			)
		).toEqual([{ ...pendingMessage, knownUserItemIds: ['user-wrong'] }]);
		expect(
			reconcilePendingUserMessages(
				[pendingMessage],
				[{ ...userItem('user-match', ''), attachments: [attachment] }]
			)
		).toEqual([]);
	});
});

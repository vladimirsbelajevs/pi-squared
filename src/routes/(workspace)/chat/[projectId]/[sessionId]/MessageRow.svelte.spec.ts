import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ChatItem } from '$lib/contracts';
import MessageRowTestWrapper from './MessageRowTestWrapper.svelte';

function item(overrides: Partial<ChatItem> = {}): ChatItem {
	return {
		id: 'message-1',
		kind: 'message',
		role: 'assistant',
		text: 'Message text',
		...overrides
	};
}

describe('MessageRow', () => {
	it('renders role labels, classes, assistant metadata, and authored snippets', async () => {
		const screen = render(MessageRowTestWrapper, {
			item: item(),
			modelName: 'GPT-5.6 Terra',
			thinkingLevel: 'medium',
			timestamp: {
				datetime: '2026-07-28T23:36:00.000Z',
				text: '11:36 PM',
				title: 'Jul 28, 2026, 11:36 PM'
			}
		});

		const group = screen.getByRole('group', { name: 'assistant message' });
		await expect.element(group).toHaveClass('message-entry-assistant');
		await expect.element(screen.getByText('Message content')).toBeVisible();
		await expect.element(screen.getByRole('list', { name: 'test attachments' })).toBeVisible();
		await expect.element(screen.getByText('GPT-5.6 Terra')).toBeVisible();
		await expect.element(screen.getByText('medium')).toBeVisible();
		const time = screen.container.querySelector('time');
		expect(time).toHaveAttribute('datetime', '2026-07-28T23:36:00.000Z');
		expect(time).toHaveAttribute('title', 'Jul 28, 2026, 11:36 PM');
		expect(time).toHaveTextContent('11:36 PM');
	});

	it('omits assistant metadata for user rows and omits copying empty text', async () => {
		const onCopyMessage = vi.fn().mockResolvedValue(true);
		const screen = render(MessageRowTestWrapper, {
			item: item({ role: 'user', text: '' }),
			modelName: 'Should not render',
			thinkingLevel: 'high',
			onCopyMessage
		});

		await expect
			.element(screen.getByRole('group', { name: 'user message' }))
			.toHaveClass('message-entry-user');
		expect(screen.container.querySelector('.message-meta-row')).not.toBeNull();
		expect(screen.container.querySelector('.message-meta-content')?.textContent?.trim()).toBe('');
		expect(screen.container.querySelector('button.copy-action')).toBeNull();
		expect(screen.container.textContent).not.toContain('Should not render');
	});

	it('shows copied state after successful copy and replaces the reset timer', async () => {
		vi.useFakeTimers();
		const onCopyMessage = vi.fn().mockResolvedValue(true);
		const screen = render(MessageRowTestWrapper, {
			item: item({ text: 'Copy this exact text.' }),
			onCopyMessage
		});

		try {
			const copy = screen.getByRole('button');
			await copy.click();
			await vi.waitFor(() => expect(onCopyMessage).toHaveBeenCalledWith('Copy this exact text.'));
			await expect
				.element(screen.getByRole('button', { name: 'Copied message' }))
				.toHaveTextContent('Copied');

			await vi.advanceTimersByTimeAsync(1200);
			await copy.click();
			await vi.waitFor(() => expect(onCopyMessage).toHaveBeenCalledTimes(2));
			await vi.advanceTimersByTimeAsync(399);
			await expect.element(screen.getByRole('button', { name: 'Copied message' })).toBeVisible();
			await vi.advanceTimersByTimeAsync(1201);
			await vi.waitFor(() =>
				expect(screen.getByRole('button', { name: 'Copy message' })).toBeVisible()
			);
		} finally {
			await screen.unmount();
			vi.useRealTimers();
		}
	});

	it('keeps normal state after a failed copy and clears its timer when destroyed', async () => {
		vi.useFakeTimers();
		const onCopyMessage = vi.fn().mockResolvedValue(false);
		const screen = render(MessageRowTestWrapper, {
			item: item(),
			onCopyMessage
		});

		try {
			const copy = screen.getByRole('button', { name: 'Copy message' });
			await copy.click();
			await vi.waitFor(() => expect(onCopyMessage).toHaveBeenCalledWith('Message text'));
			await expect.element(screen.getByRole('button', { name: 'Copy message' })).toBeVisible();
			expect(screen.container.querySelector('.copy-action')).not.toHaveClass('copied');

			onCopyMessage.mockResolvedValue(true);
			await copy.click();
			await vi.waitFor(() =>
				expect(screen.getByRole('button', { name: 'Copied message' })).toBeVisible()
			);
			expect(vi.getTimerCount()).toBe(1);
			await screen.unmount();
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('allows keyboard focus to reach the mounted copy action without hover', async () => {
		const screen = render(MessageRowTestWrapper, { item: item() });
		const copy = screen.getByRole('button', { name: 'Copy message' });

		copy.element().focus();
		flushSync();
		expect(document.activeElement).toBe(copy.element());
	});
});

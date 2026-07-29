import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TransientNoticePopup from './TransientNoticePopup.svelte';

const notices = [
	{ id: 'notice-1', message: 'Language server status:\n  Indexing workspace' },
	{ id: 'notice-2', message: 'A second notice' }
];

describe('TransientNoticePopup', () => {
	it('renders a named polite status with multiline notices', async () => {
		const screen = render(TransientNoticePopup, { notices, onClear: vi.fn() });
		const popup = screen.getByRole('status', { name: 'Session notices' });

		await expect.element(popup).toBeVisible();
		await expect.element(screen.getByText(notices[0].message)).toBeVisible();
		expect(popup.element().textContent).toContain(notices[0].message);
	});

	it('clears all notices through its native close button', async () => {
		const onClear = vi.fn();
		const screen = render(TransientNoticePopup, { notices, onClear });

		await screen.getByRole('button', { name: 'Clear all notices' }).click();
		expect(onClear).toHaveBeenCalledOnce();
	});

	it('adds and removes its transition root with the notice list', async () => {
		const screen = render(TransientNoticePopup, { notices, onClear: vi.fn() });

		await expect.element(screen.getByRole('status', { name: 'Session notices' })).toBeVisible();
		await screen.rerender({ notices: [], onClear: vi.fn() });
		await expect
			.element(screen.getByRole('status', { name: 'Session notices' }))
			.not.toBeInTheDocument();
	});
});

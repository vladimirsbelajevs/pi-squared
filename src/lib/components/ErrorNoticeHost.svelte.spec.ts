import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { errorNotices } from '$lib/error-notices';
import ErrorNoticeHost from './ErrorNoticeHost.svelte';

describe('ErrorNoticeHost', () => {
	it('flushes queued errors and advances through them in FIFO order', async () => {
		errorNotices.show(new Error('The first error'));
		errorNotices.show('The second error');
		const screen = render(ErrorNoticeHost);

		const alert = screen.getByRole('alert');
		await expect.element(alert).toHaveTextContent('The first error');
		await expect.element(alert).toHaveAttribute('aria-live', 'assertive');

		await screen.getByRole('button', { name: 'Dismiss error notification' }).click();
		alert.element().dispatchEvent(new Event('outroend'));

		await expect.element(screen.getByRole('alert')).toHaveTextContent('The second error');
	});
});

import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PiWorkingSpinner from './PiWorkingSpinner.svelte';

describe('PiWorkingSpinner', () => {
	it('exposes an accessible Working label', async () => {
		const screen = render(PiWorkingSpinner);

		await expect.element(screen.getByRole('img', { name: 'Working' })).toBeVisible();
	});
});

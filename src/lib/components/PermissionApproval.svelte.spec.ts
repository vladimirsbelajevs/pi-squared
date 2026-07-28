import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PermissionApproval from './PermissionApproval.svelte';

describe('PermissionApproval', () => {
	it('submits the selected permission decision', async () => {
		const onSelect = vi.fn().mockResolvedValue(undefined);
		const request = {
			id: 'permission-1',
			method: 'select' as const,
			title: 'Permission Required\nAllow `pwd`?',
			options: ['Yes', 'Yes, for this session', 'No']
		};
		const screen = render(PermissionApproval, {
			request,
			onSelect,
			onConfirm: vi.fn(),
			onCancel: vi.fn()
		});

		await expect.element(screen.getByRole('alert')).toBeVisible();
		await screen.getByRole('button', { name: 'Yes, for this session' }).click();
		expect(onSelect).toHaveBeenCalledWith(request, 'Yes, for this session');
	});

	it('submits a denial reason after the extension asks for one', async () => {
		const onSelect = vi.fn().mockResolvedValue(undefined);
		const request = {
			id: 'permission-2',
			method: 'input' as const,
			title: 'Why deny this request?',
			placeholder: 'Reason shown back to the agent'
		};
		const screen = render(PermissionApproval, {
			request,
			onSelect,
			onConfirm: vi.fn(),
			onCancel: vi.fn()
		});

		const input = screen.getByRole('textbox', { name: 'Reason' });
		await input.fill('Use the documented project command instead.');
		await screen.getByRole('button', { name: 'Submit reason' }).click();
		expect(onSelect).toHaveBeenCalledWith(request, 'Use the documented project command instead.');
	});
});

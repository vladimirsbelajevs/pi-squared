<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn } from 'storybook/test';
	import PermissionApproval from './PermissionApproval.svelte';

	const { Story } = defineMeta({
		title: 'Chat/PermissionApproval',
		component: PermissionApproval,
		args: {
			onSelect: fn(async () => undefined),
			onConfirm: fn(async () => undefined),
			onCancel: fn(async () => undefined)
		}
	});

	const selectRequest = {
		id: 'permission-select',
		method: 'select' as const,
		title: 'Allow `pwd`?',
		message: 'The agent needs the current working directory.',
		options: ['Yes', 'Yes, for this session', 'No']
	};

	const confirmRequest = {
		id: 'permission-confirm',
		method: 'confirm' as const,
		title: 'Approve this action?',
		message: 'This action writes files in the workspace.'
	};

	const inputRequest = {
		id: 'permission-input',
		method: 'input' as const,
		title: 'Why deny this request?',
		placeholder: 'Reason shown back to the agent'
	};
</script>

<Story
	name="Select option"
	args={{ request: selectRequest }}
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Yes, for this session' }));
		await expect(args.onSelect).toHaveBeenCalledWith(selectRequest, 'Yes, for this session');
	}}
/>

<Story
	name="Confirmation"
	args={{ request: confirmRequest }}
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Deny' }));
		await expect(args.onConfirm).toHaveBeenCalledWith(confirmRequest, false);
	}}
/>

<Story
	name="Reason required"
	args={{ request: inputRequest }}
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.type(
			canvas.getByRole('textbox', { name: 'Reason' }),
			'Use the documented project command instead.'
		);
		await userEvent.click(canvas.getByRole('button', { name: 'Submit reason' }));
		await expect(args.onSelect).toHaveBeenCalledWith(
			inputRequest,
			'Use the documented project command instead.'
		);
	}}
/>

<Story
	name="Responding with error"
	args={{
		request: {
			...confirmRequest,
			responding: true,
			error: 'The permission request has expired.'
		}
	}}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('button', { name: 'Approve' })).toBeDisabled();
		await expect(canvas.getByText('The permission request has expired.')).toBeVisible();
	}}
/>

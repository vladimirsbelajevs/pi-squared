<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import type { ComponentProps } from 'svelte';
	import { expect, fn, screen, waitFor } from 'storybook/test';
	import PermissionApproval from './PermissionApproval.svelte';
	import PermissionApprovalTransitionPreview from './PermissionApprovalTransitionPreview.svelte';

	type PermissionApprovalStoryArgs = ComponentProps<PermissionApproval> & {
		transitionDemo?: boolean;
	};

	const { Story } = defineMeta({
		title: 'Chat/PermissionApproval',
		component: PermissionApproval,
		render: permissionApprovalTemplate,
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

{#snippet permissionApprovalTemplate({
	transitionDemo = false,
	...args
}: PermissionApprovalStoryArgs)}
	{#if transitionDemo}
		<PermissionApprovalTransitionPreview {...args} />
	{:else}
		<PermissionApproval {...args} />
	{/if}
{/snippet}

<Story
	name="Select option"
	args={{ request: selectRequest }}
	play={async ({ args, userEvent }) => {
		await userEvent.click(screen.getByRole('button', { name: 'Yes, for this session' }));
		await expect(args.onSelect).toHaveBeenCalledWith(selectRequest, 'Yes, for this session');
	}}
/>

<Story
	name="Confirmation"
	args={{ request: confirmRequest }}
	play={async ({ args, userEvent }) => {
		await userEvent.click(screen.getByRole('button', { name: 'Deny' }));
		await expect(args.onConfirm).toHaveBeenCalledWith(confirmRequest, false);
	}}
/>

<Story
	name="Reason required"
	args={{ request: inputRequest }}
	play={async ({ args, userEvent }) => {
		await userEvent.type(
			screen.getByRole('textbox', { name: 'Reason' }),
			'Use the documented project command instead.'
		);
		await userEvent.click(screen.getByRole('button', { name: 'Submit reason' }));
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
	play={async () => {
		await expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
		await expect(screen.getByText('The permission request has expired.')).toBeVisible();
	}}
/>

<Story
	name="Requires a decision"
	args={{ request: confirmRequest, onConfirm: fn(async () => undefined) }}
	play={async ({ args, userEvent }) => {
		await expect(screen.getByRole('alertdialog', { name: 'Approval required' })).toBeVisible();

		await userEvent.keyboard('{Escape}');
		await waitFor(() =>
			expect(screen.getByRole('alertdialog', { name: 'Approval required' })).toBeVisible()
		);

		await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
		await expect(args.onConfirm).toHaveBeenCalledWith(confirmRequest, true);
	}}
/>

<Story
	name="Transitions"
	args={{ transitionDemo: true, request: confirmRequest }}
	play={async ({ userEvent }) => {
		await userEvent.click(screen.getByRole('button', { name: 'Open permission approval' }));
		await waitFor(() =>
			expect(screen.getByRole('alertdialog', { name: 'Approval required' })).toBeVisible()
		);

		await userEvent.click(screen.getByRole('button', { name: 'Close permission approval' }));
		await expect(screen.getByRole('alertdialog', { name: 'Approval required' })).toBeVisible();
		await waitFor(() =>
			expect(
				screen.queryByRole('alertdialog', { name: 'Approval required' })
			).not.toBeInTheDocument()
		);
	}}
/>

<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import type { ComponentProps } from 'svelte';
	import { expect, fn, screen, waitFor } from 'storybook/test';
	import type { PendingPermission } from '$lib/harness/types';
	import PermissionApproval from './PermissionApproval.svelte';

	type PermissionApprovalStoryArgs = ComponentProps<PermissionApproval>;

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

<script lang="ts">
	let transitionRequests = $state<PendingPermission[]>([confirmRequest, selectRequest]);

	function removeTransitionRequest(request: PendingPermission): void {
		transitionRequests = transitionRequests.filter(
			(activeRequest) => activeRequest.id !== request.id
		);
	}
</script>

{#snippet permissionApprovalTemplate(args: PermissionApprovalStoryArgs)}
	<PermissionApproval {...args} />
{/snippet}

{#snippet transitionTemplate(args: PermissionApprovalStoryArgs)}
	<PermissionApproval
		requests={transitionRequests}
		onSelect={(request, value) => {
			removeTransitionRequest(request);

			return args.onSelect(request, value);
		}}
		onConfirm={(request, confirmed) => {
			removeTransitionRequest(request);

			return args.onConfirm(request, confirmed);
		}}
		onCancel={(request) => {
			removeTransitionRequest(request);

			return args.onCancel(request);
		}}
	/>
{/snippet}

<Story
	name="Select option"
	template={permissionApprovalTemplate}
	args={{ requests: [selectRequest] }}
	play={async ({ args, userEvent }) => {
		await expect(screen.queryByLabelText('Approval progress')).not.toBeInTheDocument();
		await userEvent.click(screen.getByRole('button', { name: 'Yes, for this session' }));
		await expect(args.onSelect).toHaveBeenCalledWith(selectRequest, 'Yes, for this session');
	}}
/>

<Story
	name="Confirmation"
	template={permissionApprovalTemplate}
	args={{ requests: [confirmRequest] }}
	play={async ({ args, userEvent }) => {
		await userEvent.click(screen.getByRole('button', { name: 'Deny' }));
		await expect(args.onConfirm).toHaveBeenCalledWith(confirmRequest, false);
	}}
/>

<Story
	name="Reason required"
	template={permissionApprovalTemplate}
	args={{ requests: [inputRequest] }}
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
	template={permissionApprovalTemplate}
	args={{
		requests: [
			{
				...confirmRequest,
				responding: true,
				error: 'The permission request has expired.'
			}
		]
	}}
	play={async () => {
		await expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
		await expect(screen.getByText('The permission request has expired.')).toBeVisible();
	}}
/>

<Story
	name="Requires a decision"
	template={permissionApprovalTemplate}
	args={{ requests: [confirmRequest], onConfirm: fn(async () => undefined) }}
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
	name="Queued approvals"
	template={transitionTemplate}
	args={{ requests: [confirmRequest] }}
	play={async ({ userEvent }) => {
		await expect(screen.getByRole('alertdialog', { name: 'Approval required' })).toBeVisible();
		await expect(screen.getByLabelText('Approval progress')).toHaveTextContent('1/2');

		await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
		await expect(screen.getByText('Allow `pwd`?')).toBeVisible();
		await expect(screen.getByLabelText('Approval progress')).toHaveTextContent('2/2');

		await userEvent.click(screen.getByRole('button', { name: 'Yes' }));
		await waitFor(() =>
			expect(
				screen.queryByRole('alertdialog', { name: 'Approval required' })
			).not.toBeInTheDocument()
		);
	}}
/>

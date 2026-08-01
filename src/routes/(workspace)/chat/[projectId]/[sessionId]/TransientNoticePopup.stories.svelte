<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor } from 'storybook/test';
	import TransientNoticePopup from './TransientNoticePopup.svelte';

	const { Story } = defineMeta({
		title: 'Chat/TransientNoticePopup',
		component: TransientNoticePopup,
		args: {
			onClear: fn()
		}
	});

	const notices = [
		{ id: 'notice-1', message: 'Language server status:\n  Indexing workspace' },
		{ id: 'notice-2', message: 'A second notice' }
	];
</script>

<Story name="Single notice" args={{ notices: [notices[0]] }} />

<Story
	name="Multiple notices"
	args={{ notices, onClear: fn() }}
	play={async ({ args, canvas, userEvent }) => {
		await waitFor(() =>
			expect(canvas.getByRole('status', { name: 'Session notices' })).toBeVisible()
		);
		await expect(canvas.getByText(/Language server status:\s+Indexing workspace/)).toBeVisible();
		await userEvent.click(canvas.getByRole('button', { name: 'Clear all notices' }));
		await expect(args.onClear).toHaveBeenCalledOnce();
	}}
/>

<Story
	name="No notices"
	args={{ notices: [] }}
	play={async ({ canvas }) => {
		await expect(canvas.queryByRole('status', { name: 'Session notices' })).not.toBeInTheDocument();
	}}
/>

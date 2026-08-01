<script lang="ts">
	import type { PendingPermission } from '$lib/harness/types';
	import PermissionApproval from './PermissionApproval.svelte';

	type Props = {
		request: PendingPermission;
		onSelect: (request: PendingPermission, value: string) => Promise<void>;
		onConfirm: (request: PendingPermission, confirmed: boolean) => Promise<void>;
		onCancel: (request: PendingPermission) => Promise<void>;
	};

	let { request, onSelect, onConfirm, onCancel }: Props = $props();
	let open = $state(false);
</script>

<button class="transition-toggle" type="button" onclick={() => (open = !open)}>
	{open ? 'Close permission approval' : 'Open permission approval'}
</button>

<PermissionApproval {request} {onSelect} {onConfirm} {onCancel} {open} />

<style>
	.transition-toggle {
		position: fixed;
		top: 1rem;
		right: 1rem;
		z-index: 7;
		pointer-events: auto !important;
		border: 1px solid var(--border-strong);
		border-radius: 0.4rem;
		background: var(--surface-strong);
		color: var(--text);
		padding: 0.45rem 0.7rem;
		font-size: 0.8rem;
	}
</style>

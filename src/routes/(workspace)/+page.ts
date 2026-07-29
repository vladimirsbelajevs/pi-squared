import { resolve } from '$app/paths';
import { redirect } from '@sveltejs/kit';
import { workspace } from '$lib/harness/workspace.svelte';

export const load = async () => {
	await workspace.start();
	redirect(307, workspace.activeTabHref() ?? resolve('/history'));
};

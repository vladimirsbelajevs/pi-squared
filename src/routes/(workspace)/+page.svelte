<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { workspace } from '$lib/harness/workspace.svelte';
	import { onMount } from 'svelte';

	onMount(async () => {
		await workspace.start();
		const activeTab = workspace.tabs.find((tab) => tab.id === workspace.activeTabId);
		if (activeTab?.kind === 'new') {
			await goto(resolve(`/new/${encodeURIComponent(activeTab.id)}`), { replaceState: true });

			return;
		}

		if (activeTab) {
			await goto(
				resolve(
					`/chat/${encodeURIComponent(activeTab.projectId)}/${encodeURIComponent(activeTab.sessionId)}`
				),
				{ replaceState: true }
			);

			return;
		}

		await goto(resolve('/history'), { replaceState: true });
	});
</script>

<p role="status">Opening workspace…</p>

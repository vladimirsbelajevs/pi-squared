<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import WorkspaceScrollArea from './WorkspaceScrollArea.svelte';

	const { Story } = defineMeta({
		title: 'Workspace/Scroll area',
		component: WorkspaceScrollArea
	});
</script>

<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import type { ScrollState } from '$lib/harness/workspace.svelte';

	const scrollStates = new SvelteMap<string, ScrollState>();

	function rememberScroll(key: string, state: ScrollState): void {
		scrollStates.set(key, state);
	}

	function scrollState(key: string): ScrollState | undefined {
		return scrollStates.get(key);
	}
</script>

<Story
	name="Long workspace content"
	play={async ({ canvas }) => {
		await expect(canvas.getByText('Scroll area content')).toBeVisible();
		await expect(canvas.getByText('Workspace entry 40')).toBeVisible();
	}}
>
	{#snippet template()}
		<div style="height: 24rem">
			<WorkspaceScrollArea activeKey="tab:storybook" {rememberScroll} {scrollState}>
				<div style="padding: 1rem">
					<h2>Scroll area content</h2>
					{#each Array.from({ length: 40 }, (_, index) => index) as index (index)}
						<p>Workspace entry {index + 1}</p>
					{/each}
				</div>
			</WorkspaceScrollArea>
		</div>
	{/snippet}
</Story>

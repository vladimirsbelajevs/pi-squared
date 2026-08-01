<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import type { McpStatusSnapshot } from '$lib/contracts';
	import ComposerStatusPanel from './ComposerStatusPanel.svelte';

	const { Story } = defineMeta({
		title: 'Chat/ComposerStatusPanel',
		component: ComposerStatusPanel
	});

	const failedMcpStatus = {
		servers: [
			{
				name: 'Filesystem',
				state: 'connected',
				toolCount: 4,
				resourceCount: 2,
				disabled: false
			},
			{
				name: 'GitHub',
				state: 'failed',
				toolCount: 0,
				resourceCount: 0,
				disabled: false
			}
		],
		totalTools: 4,
		totalResources: 2,
		connectedCount: 1,
		disabledCount: 0
	} satisfies McpStatusSnapshot;
</script>

<Story
	name="Failed MCP server"
	args={{ status: failedMcpStatus, projectName: 'Pi Squared' }}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('button', { name: /MCP: 2\/2/ })).toBeVisible();
		await expect(canvas.getByTitle('One or more MCP servers failed')).toHaveTextContent('!');
	}}
/>

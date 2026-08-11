<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import ErrorNoticeHost from '$lib/components/ErrorNoticeHost.svelte';
	import ApplicationUpdater from '$lib/components/ApplicationUpdater.svelte';
	import DesktopOnboarding from '$lib/components/DesktopOnboarding.svelte';
	import DesktopTitlebar from '$lib/components/DesktopTitlebar.svelte';
	import { getDesktopApi } from '$lib/desktop';
	import type { PiSquaredDesktopWindowControls } from '$lib/desktop-contract';
	import { onMount } from 'svelte';

	let { children } = $props();
	let windowControls = $state<PiSquaredDesktopWindowControls | undefined>();

	onMount(() => {
		windowControls = getDesktopApi()?.windowControls;
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<div class="app-shell">
	{#if windowControls}
		<DesktopTitlebar api={windowControls} />
	{/if}
	<div class="app-content">{@render children()}</div>
</div>
<ErrorNoticeHost />
<ApplicationUpdater />
<DesktopOnboarding />

<style>
	.app-shell {
		display: flex;
		height: 100vh;
		height: 100dvh;
		min-height: 100%;
		flex-direction: column;
		overflow: hidden;
	}

	.app-content {
		min-height: 0;
		flex: 1;
	}
</style>

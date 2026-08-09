<script lang="ts">
	let { children } = $props();
</script>

<section class="utility-view">
	<div class="utility-content">{@render children()}</div>
</section>

<style>
	.utility-view {
		min-height: 0;
		padding: clamp(1.5rem, 5vw, 4.5rem);
	}

	.utility-content {
		width: min(100%, 54rem);
		margin: 0 auto;
	}

	@media (max-width: 700px) {
		.utility-view {
			padding: 1.25rem 0.75rem;
		}
	}
</style>

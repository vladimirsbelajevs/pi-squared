<script module lang="ts">
	export type ImageViewerImage = {
		name: string;
		src: string;
	};
</script>

<script lang="ts">
	import { MediaQuery } from 'svelte/reactivity';
	import { scale } from 'svelte/transition';

	type Props = {
		image?: ImageViewerImage;
	};

	let { image = $bindable<ImageViewerImage | undefined>() }: Props = $props();

	const reducedMotion = new MediaQuery('prefers-reduced-motion: reduce', false);
	let transition = $derived({ start: 0, duration: reducedMotion.current ? 0 : 180 });

	function close(): void {
		image = undefined;
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || !image) {
			return;
		}

		event.preventDefault();
		close();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if image}
	<div class="image-viewer-overlay">
		<div
			class="image-viewer"
			role="dialog"
			aria-modal="true"
			aria-label={`Image preview: ${image.name}`}
			transition:scale|global={transition}
		>
			<header class="image-viewer-header">
				<h2>{image.name}</h2>
				<button
					class="image-viewer-close"
					type="button"
					aria-label="Close image preview"
					title="Close image preview"
					onclick={close}
				>
					<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
						<path
							d="M5 5L15 15M15 5L5 15"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
						/>
					</svg>
				</button>
			</header>
			<img class="image-viewer-image" src={image.src} alt={image.name} />
		</div>
	</div>
{/if}

<style>
	.image-viewer-overlay {
		position: fixed;
		z-index: 10;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: color-mix(in srgb, var(--surface-strong) 82%, transparent);
	}

	.image-viewer {
		position: relative;
		display: flex;
		width: fit-content;
		max-width: min(100%, 80rem);
		max-height: calc(100dvh - 2rem);
		flex-direction: column;
		overflow: hidden;
		border: 1px solid var(--border-strong);
		border-radius: 0.65rem;
		background: var(--surface);
		box-shadow: 0 16px 34px var(--shadow);
	}

	.image-viewer-header {
		display: flex;
		min-height: 2.75rem;
		align-items: center;
		padding: 0.5rem 3rem 0.5rem 0.75rem;
		border-bottom: 1px solid var(--border);
		background: var(--surface-muted);
	}

	.image-viewer-header h2 {
		margin: 0;
		overflow: hidden;
		color: var(--text);
		font-size: 0.82rem;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.image-viewer-close {
		position: absolute;
		top: 0.45rem;
		right: 0.45rem;
		display: grid;
		width: 1.8rem;
		height: 1.8rem;
		place-items: center;
		border: 1px solid transparent;
		border-radius: 0.42rem;
		background: transparent;
		color: var(--text-muted);
		padding: 0;
	}

	.image-viewer-close:hover {
		border-color: var(--border-strong);
		background: var(--surface-strong);
		color: var(--text);
	}

	.image-viewer-close:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.image-viewer-close svg {
		width: 0.9rem;
		height: 0.9rem;
	}

	.image-viewer-image {
		display: block;
		max-width: min(100%, calc(100vw - 2rem));
		max-height: calc(100dvh - 5rem);
		margin: auto;
		object-fit: contain;
	}

	@media (prefers-reduced-motion: reduce) {
		.image-viewer-close {
			transition: none;
		}
	}
</style>

<script lang="ts">
	import { renderStreamingMarkdown } from '$lib/markdown';

	type Props = { text: string };
	let { text }: Props = $props();
	let markdown = $derived(renderStreamingMarkdown(text));
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- markdown-it output is constrained in $lib/markdown -->
<div class="message-markdown thinking">{@html markdown}</div>

<style>
	.message-markdown {
		color: var(--text);
		overflow-wrap: anywhere;
		font-size: 0.92rem;
		line-height: 1.6;
	}

	.message-markdown :global(h1),
	.message-markdown :global(h2),
	.message-markdown :global(h3),
	.message-markdown :global(h4),
	.message-markdown :global(h5),
	.message-markdown :global(h6) {
		margin: 1.2rem 0 0.55rem;
		color: var(--text);
		font-weight: 700;
		line-height: 1.25;
	}

	.message-markdown :global(h1) {
		font-size: 1.4rem;
	}

	.message-markdown :global(h2) {
		font-size: 1.2rem;
	}

	.message-markdown :global(h3),
	.message-markdown :global(h4),
	.message-markdown :global(h5),
	.message-markdown :global(h6) {
		font-size: 1rem;
	}

	.message-markdown :global(p) {
		margin: 0.75rem 0;
	}

	.message-markdown :global(ol),
	.message-markdown :global(ul) {
		margin: 0.75rem 0;
		padding-left: 1.5rem;
	}

	.message-markdown :global(li + li) {
		margin-top: 0.25rem;
	}

	.message-markdown :global(blockquote) {
		margin: 0.85rem 0;
		border-left: 0.2rem solid var(--accent);
		background: var(--surface-muted);
		color: var(--text-muted);
		padding: 0.1rem 0.8rem;
	}

	.message-markdown :global(blockquote p) {
		margin: 0.65rem 0;
	}

	.message-markdown :global(a) {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}

	.message-markdown :global(a:hover),
	.message-markdown :global(a:focus-visible) {
		color: var(--accent-strong);
	}

	.message-markdown :global(code) {
		border: 1px solid var(--border);
		border-radius: 0.25rem;
		background: var(--surface-muted);
		padding: 0.08rem 0.3rem;
		font:
			0.85em ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
	}

	.message-markdown :global(pre) {
		max-width: 100%;
		margin: 0.9rem 0;
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--surface-muted);
		padding: 0.75rem;
		color: var(--text);
		font:
			0.85rem/1.55 ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
		white-space: pre;
	}

	.message-markdown :global(pre code) {
		border: 0;
		border-radius: 0;
		background: transparent;
		padding: 0;
		font: inherit;
	}

	.message-markdown > :global(:first-child) {
		margin-top: 0;
	}

	.message-markdown > :global(:last-child) {
		margin-bottom: 0;
	}

	.thinking {
		color: var(--text-muted);
		font:
			0.85rem/1.55 ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
	}
</style>

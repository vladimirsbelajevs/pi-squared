<script lang="ts">
	type Tone = 'sidebar' | 'timeline';
	type Props = {
		class?: string;
		tone?: Tone;
	};

	let { class: className = '', tone = 'timeline' }: Props = $props();
</script>

<span
	class={['pi-working-spinner', `pi-working-spinner-${tone}`, className]}
	role="img"
	aria-label="Working"
></span>

<style>
	.pi-working-spinner {
		display: inline-block;
		flex: 0 0 auto;
		width: 1em;
		height: 1em;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 1em;
		line-height: 1;
		text-align: center;
	}

	.pi-working-spinner::before {
		content: '⠋';
		animation: pi-working-spinner 800ms steps(1, end) infinite;
	}

	.pi-working-spinner-sidebar {
		color: var(--success);
	}

	.pi-working-spinner-timeline {
		color: var(--accent);
	}

	@keyframes pi-working-spinner {
		0% {
			content: '⠋';
		}

		10% {
			content: '⠙';
		}

		20% {
			content: '⠹';
		}

		30% {
			content: '⠸';
		}

		40% {
			content: '⠼';
		}

		50% {
			content: '⠴';
		}

		60% {
			content: '⠦';
		}

		70% {
			content: '⠧';
		}

		80% {
			content: '⠇';
		}

		90%,
		100% {
			content: '⠏';
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.pi-working-spinner::before {
			animation: none;
		}
	}
</style>

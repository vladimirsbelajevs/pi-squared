<script lang="ts">
	interface Props {
		checked: boolean;
		label: string;
		disabled?: boolean;
		onchange: (checked: boolean) => void;
	}

	let { checked, label, disabled = false, onchange }: Props = $props();

	function handleChange(event: Event): void {
		onchange((event.currentTarget as HTMLInputElement).checked);
	}
</script>

<label class:disabled class="switch">
	<span class="visually-hidden">{label}</span>
	<input type="checkbox" role="switch" {checked} {disabled} onchange={handleChange} />
	<span class="track" aria-hidden="true">
		<span class="thumb"></span>
	</span>
</label>

<style>
	.switch {
		position: relative;
		display: inline-flex;
		width: 2.75rem;
		height: 1.5rem;
		flex: none;
		cursor: pointer;
	}

	input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		opacity: 0;
		cursor: inherit;
	}

	.track {
		display: flex;
		width: 100%;
		align-items: center;
		border-radius: 999px;
		background: var(--border-strong);
		padding: 0.1875rem;
		transition: background-color 150ms ease;
	}

	.thumb {
		width: 1.125rem;
		height: 1.125rem;
		border-radius: 50%;
		background: var(--surface);
		box-shadow: 0 1px 2px color-mix(in srgb, var(--text) 25%, transparent);
		transition: transform 150ms ease;
	}

	input:checked + .track {
		background: var(--accent-strong);
	}

	input:checked + .track .thumb {
		transform: translateX(1.25rem);
	}

	input:focus-visible + .track {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
	}

	.switch.disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>

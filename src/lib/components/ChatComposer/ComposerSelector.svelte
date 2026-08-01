<script lang="ts">
	import { tick } from 'svelte';

	type Option = {
		value: string;
		label: string;
		disabled?: boolean;
	};

	type Props = {
		label: string;
		value: string;
		options: Option[];
		disabled?: boolean;
		onChange: (value: string) => void | Promise<void>;
	};

	let { label, value, options, disabled = false, onChange }: Props = $props();

	const listboxId = $props.id();

	let isOpen = $state(false);
	let selector: HTMLDivElement | undefined;
	let trigger: HTMLButtonElement | undefined;
	let selectedOption = $derived(options.find((option) => option.value === value));

	function captureSelector(element: HTMLDivElement): () => void {
		selector = element;

		return () => {
			if (selector === element) {
				selector = undefined;
			}
		};
	}

	function captureTrigger(element: HTMLButtonElement): () => void {
		trigger = element;

		return () => {
			if (trigger === element) {
				trigger = undefined;
			}
		};
	}

	function close(): void {
		isOpen = false;
	}

	async function open(): Promise<void> {
		isOpen = true;
		await tick();
		selector
			?.querySelector<HTMLElement>('.selector-option.selected')
			?.scrollIntoView({ block: 'nearest' });
	}

	function toggle(): void {
		if (disabled) {
			return;
		}

		if (isOpen) {
			close();
		} else {
			void open();
		}
	}

	function select(option: Option): void {
		if (option.disabled) {
			return;
		}

		isOpen = false;
		void onChange(option.value);
		trigger?.focus();
	}

	function handleTriggerKeydown(event: KeyboardEvent): void {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			void open();
		}

		if (event.key === 'Escape') {
			close();
		}
	}

	function handleDocumentPointerDown(event: PointerEvent): void {
		if (event.target instanceof Node && !selector?.contains(event.target)) {
			close();
		}
	}
</script>

<svelte:document onpointerdown={handleDocumentPointerDown} />

<div class="composer-selector" {@attach captureSelector}>
	<span class="visually-hidden" id={`${listboxId}-label`}>{label}</span>
	<button
		{@attach captureTrigger}
		class="selector-trigger"
		type="button"
		role="combobox"
		aria-labelledby={`${listboxId}-label`}
		aria-controls={isOpen ? listboxId : undefined}
		aria-expanded={isOpen}
		aria-haspopup="listbox"
		{disabled}
		onclick={toggle}
		onkeydown={handleTriggerKeydown}
	>
		<span class="selector-value"
			>{selectedOption?.label ?? `No ${label.toLowerCase()} selected`}</span
		>
		<svg viewBox="0 0 12 12" aria-hidden="true">
			<path
				d="m3 4.5 3 3 3-3"
				fill="none"
				stroke="currentColor"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	</button>

	{#if isOpen}
		<div class="selector-menu" id={listboxId} role="listbox" aria-labelledby={`${listboxId}-label`}>
			{#each options as option (option.value)}
				<button
					class:selected={option.value === value}
					class="selector-option"
					type="button"
					role="option"
					aria-selected={option.value === value}
					disabled={option.disabled}
					onclick={() => select(option)}
				>
					{option.label}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
	}

	.composer-selector {
		position: relative;
		min-width: 0;
	}

	.selector-trigger {
		display: inline-flex;
		align-items: center;
		min-width: 0;
		max-width: 15rem;
		gap: 0.35rem;
		border: 0;
		border-radius: 0.4rem;
		background: transparent;
		color: var(--text-muted);
		padding: 0.3rem 0.35rem 0.3rem 0.45rem;
		font-size: 0.72rem;
		line-height: 1.2;
		transition:
			background 150ms ease,
			color 150ms ease;
	}

	.selector-trigger:hover:not(:disabled),
	.selector-trigger[aria-expanded='true'],
	.selector-trigger:focus-visible {
		background: var(--surface-muted);
		color: var(--text);
	}

	.selector-trigger:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.selector-trigger:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}

	.selector-value {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.selector-trigger svg {
		width: 0.8rem;
		height: 0.8rem;
		flex: none;
		transition: transform 150ms ease;
	}

	.selector-trigger[aria-expanded='true'] svg {
		transform: rotate(180deg);
	}

	.selector-menu {
		position: absolute;
		z-index: 5;
		bottom: calc(100% + 0.45rem);
		left: 0;
		display: grid;
		min-width: max(100%, 10rem);
		max-width: min(22rem, calc(100vw - 1.5rem));
		max-height: min(18rem, 45dvh);
		overflow-y: auto;
		border: 1px solid var(--border-strong);
		border-radius: 0.55rem;
		background: color-mix(in srgb, var(--surface) 94%, var(--canvas) 6%);
		box-shadow: 0 0.7rem 1.8rem color-mix(in srgb, var(--canvas) 72%, transparent);
		padding: 0.25rem;
	}

	.selector-option {
		width: 100%;
		overflow: hidden;
		border: 0;
		border-radius: 0.35rem;
		background: transparent;
		color: var(--text-muted);
		padding: 0.45rem 0.55rem;
		text-align: left;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.selector-option:hover:not(:disabled),
	.selector-option:focus-visible,
	.selector-option.selected {
		background: var(--surface-strong);
		color: var(--text);
	}

	.selector-option.selected::after {
		float: right;
		color: var(--accent);
		content: '✓';
	}

	.selector-option:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}

	@media (prefers-reduced-motion: reduce) {
		.selector-trigger,
		.selector-trigger svg {
			transition: none;
		}
	}
</style>

<script lang="ts">
	import { Select } from 'bits-ui';

	type Option = {
		value: string;
		label: string;
		disabled?: boolean;
	};

	type Props = {
		label: string;
		value: string;
		options: Option[];
		triggerLabel?: string;
		disabled?: boolean;
		onChange: (value: string) => void | Promise<void>;
	};

	let { label, value, options, triggerLabel, disabled = false, onChange }: Props = $props();

	let selectedOption = $derived(options.find((option) => option.value === value));
	let displayLabel = $derived(
		triggerLabel ?? selectedOption?.label ?? `No ${label.toLowerCase()} selected`
	);

	function getValue(): string {
		return value;
	}

	function setValue(nextValue: string): void {
		if (nextValue !== value) {
			void onChange(nextValue);
		}
	}
</script>

<Select.Root
	type="single"
	bind:value={getValue, setValue}
	items={options}
	{disabled}
	scrollAlignment="nearest"
>
	<Select.Trigger class="selector-trigger" aria-label={label} title={displayLabel}>
		<span class="selector-value">{displayLabel}</span>
		<svg viewBox="0 0 12 12" aria-hidden="true">
			<path
				d="m3 4.5 3 3 3-3"
				fill="none"
				stroke="currentColor"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	</Select.Trigger>

	<Select.Portal>
		<Select.Content class="selector-menu" side="top" sideOffset={6} align="start">
			<Select.Viewport class="selector-viewport">
				{#each options as option (option.value)}
					<Select.Item
						class="selector-option"
						value={option.value}
						label={option.label}
						title={option.label}
						disabled={option.disabled}
					>
						{#snippet children({ selected })}
							<span class="selector-option-label">{option.label}</span>
							{#if selected}
								<span class="selector-check" aria-hidden="true">✓</span>
							{/if}
						{/snippet}
					</Select.Item>
				{/each}
			</Select.Viewport>
		</Select.Content>
	</Select.Portal>
</Select.Root>

<style>
	:global(.selector-trigger) {
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

	:global(.selector-trigger:hover:not(:disabled)),
	:global(.selector-trigger[data-state='open']),
	:global(.selector-trigger:focus-visible) {
		background: var(--surface-muted);
		color: var(--text);
	}

	:global(.selector-trigger:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	:global(.selector-trigger:disabled) {
		cursor: not-allowed;
		opacity: 0.45;
	}

	:global(.selector-value) {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.selector-trigger svg) {
		width: 0.8rem;
		height: 0.8rem;
		flex: none;
		transition: transform 150ms ease;
	}

	:global(.selector-trigger[data-state='open'] svg) {
		transform: rotate(180deg);
	}

	:global(.selector-menu) {
		z-index: 5;
		min-width: max(var(--bits-select-anchor-width), 10rem);
		max-width: min(22rem, calc(100vw - 1.5rem));
		overflow: hidden;
		border: 1px solid var(--border-strong);
		border-radius: 0.55rem;
		background: color-mix(in srgb, var(--surface) 94%, var(--canvas) 6%);
		box-shadow: 0 0.7rem 1.8rem color-mix(in srgb, var(--canvas) 72%, transparent);
		padding: 0.25rem;
	}

	:global(.selector-viewport) {
		display: grid;
		max-height: min(18rem, 45dvh);
		overflow-y: auto;
	}

	:global(.selector-option) {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		width: 100%;
		min-width: 0;
		gap: 0.5rem;
		border-radius: 0.35rem;
		color: var(--text-muted);
		padding: 0.45rem 0.55rem;
		font-size: 0.72rem;
		line-height: 1.2;
		outline: none;
	}

	:global(.selector-option[data-highlighted]),
	:global(.selector-option[data-selected]) {
		background: var(--surface-strong);
		color: var(--text);
	}

	:global(.selector-option[data-disabled]) {
		cursor: not-allowed;
		opacity: 0.45;
	}

	:global(.selector-option:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}

	:global(.selector-option-label) {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.selector-check) {
		color: var(--accent);
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.selector-trigger),
		:global(.selector-trigger svg) {
			transition: none;
		}
	}
</style>

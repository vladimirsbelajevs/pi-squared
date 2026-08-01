<script lang="ts">
	import { Select, Tooltip } from 'bits-ui';

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
		invalid?: boolean;
		alignment?: 'start' | 'end';
		onChange: (value: string) => void | Promise<void>;
	};

	let {
		label,
		value,
		options,
		triggerLabel,
		disabled = false,
		invalid = false,
		alignment = 'start',
		onChange
	}: Props = $props();

	const optionTooltipTether = Tooltip.createTether<string>();
	let optionTooltipOpen = $state(false);

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

	function closeOptionTooltip(): void {
		optionTooltipOpen = false;
	}
</script>

<Tooltip.Provider delayDuration={400}>
	<Select.Root
		type="single"
		bind:value={getValue, setValue}
		items={options}
		{disabled}
		scrollAlignment="nearest"
	>
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<Select.Trigger
						{...props}
						class="selector-trigger"
						aria-label={label}
						data-selector
						data-align={alignment}
						data-invalid={invalid || undefined}
					>
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
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Portal>
				<Tooltip.Content class="selector-tooltip" side="top" sideOffset={6} data-selector>
					{label}: {displayLabel}
				</Tooltip.Content>
			</Tooltip.Portal>
		</Tooltip.Root>

		<Select.Portal>
			<Select.Content
				class="selector-menu"
				side="top"
				sideOffset={6}
				align={alignment}
				data-selector
			>
				<Select.Viewport class="selector-viewport" onscroll={closeOptionTooltip} data-selector>
					{#each options as option (option.value)}
						<Tooltip.Trigger tether={optionTooltipTether} payload={option.label}>
							{#snippet child({ props })}
								<Select.Item
									{...props}
									class="selector-option"
									data-selector
									data-align={alignment}
									value={option.value}
									label={option.label}
									disabled={option.disabled}
								>
									{#snippet children({ selected })}
										<span class="selector-option-label">{option.label}</span>
										{#if selected}
											<span class="selector-check" aria-hidden="true">✓</span>
										{/if}
									{/snippet}
								</Select.Item>
							{/snippet}
						</Tooltip.Trigger>
					{/each}
				</Select.Viewport>
			</Select.Content>
		</Select.Portal>
	</Select.Root>

	<Tooltip.Root tether={optionTooltipTether} bind:open={optionTooltipOpen}>
		{#snippet children({ payload })}
			<Tooltip.Portal>
				<Tooltip.Content class="selector-tooltip" side="right" sideOffset={6} data-selector>
					{payload}
				</Tooltip.Content>
			</Tooltip.Portal>
		{/snippet}
	</Tooltip.Root>
</Tooltip.Provider>

<style>
	:global([data-selector].selector-trigger) {
		display: inline-flex;
		align-items: center;
		max-width: 15rem;
		gap: 0.35rem;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--surface-muted);
		color: var(--text-muted);
		padding: 0.3rem 0.35rem 0.3rem 0.45rem;
		font-size: 0.72rem;
		transition:
			border-color 180ms ease,
			background 180ms ease,
			color 180ms ease;
	}

	:global([data-selector].selector-trigger:hover:not(:disabled)),
	:global([data-selector].selector-trigger[data-state='open']),
	:global([data-selector].selector-trigger:focus-visible) {
		border-color: var(--border-strong);
		background: var(--surface-strong);
		color: var(--text);
	}

	:global([data-selector].selector-trigger[data-invalid]) {
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warning) 55%, transparent);
	}

	:global([data-selector].selector-trigger[data-align='end']) {
		justify-content: flex-end;
		text-align: right;
	}

	:global([data-selector].selector-trigger:focus-visible),
	:global([data-selector].selector-option:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	:global([data-selector].selector-trigger:disabled),
	:global([data-selector].selector-option[data-disabled]) {
		opacity: 0.45;
	}

	.selector-value,
	.selector-option-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global([data-selector].selector-trigger svg) {
		width: 0.8rem;
		height: 0.8rem;
	}

	:global([data-selector].selector-trigger[data-state='open'] svg) {
		transform: rotate(180deg);
	}

	:global([data-selector].selector-menu) {
		z-index: 5;
		min-width: max(var(--bits-select-anchor-width), 10rem);
		max-width: min(22rem, calc(100vw - 1.5rem));
		border: 1px solid var(--border-strong);
		border-radius: 0.55rem;
		background: var(--surface);
		padding: 0.25rem;
	}

	:global([data-selector].selector-viewport[data-select-viewport]) {
		max-height: min(18rem, 45dvh);
		overflow-y: auto;
		scrollbar-color: var(--border-strong) transparent;
		scrollbar-width: thin !important;
	}

	:global([data-selector].selector-viewport[data-select-viewport]::-webkit-scrollbar) {
		display: block !important;
		width: 0.5rem;
	}

	:global([data-selector].selector-viewport[data-select-viewport]::-webkit-scrollbar-thumb) {
		border: 2px solid transparent;
		border-radius: 999px;
		background: var(--border-strong);
		background-clip: padding-box;
	}

	:global([data-selector].selector-tooltip) {
		z-index: 6;
		max-width: min(22rem, calc(100vw - 1.5rem));
		border: 1px solid var(--border-strong);
		border-radius: 0.35rem;
		background: var(--surface-strong);
		color: var(--text);
		padding: 0.35rem 0.5rem;
		font-size: 0.7rem;
	}

	:global([data-selector].selector-option) {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border-radius: 0.35rem;
		color: var(--text-muted);
		cursor: default;
		padding: 0.45rem 0.55rem;
		font-size: 0.72rem;
	}

	:global([data-selector].selector-option[data-highlighted]),
	:global([data-selector].selector-option[data-selected]) {
		background: var(--surface-strong);
		color: var(--text);
	}

	:global([data-selector].selector-option[data-align='end']) {
		justify-content: flex-end;
		text-align: right;
	}

	:global([data-selector].selector-option[data-align='end'] .selector-check) {
		margin-left: 0;
	}

	.selector-check {
		margin-left: auto;
		color: var(--accent);
	}
</style>

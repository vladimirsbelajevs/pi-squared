<script lang="ts">
	import { Popover } from 'bits-ui';
	import type { PendingPermission } from '$lib/harness/types';

	type Props = {
		request: PendingPermission;
		onSelect: (request: PendingPermission, value: string) => Promise<void>;
		onConfirm: (request: PendingPermission, confirmed: boolean) => Promise<void>;
		onCancel: (request: PendingPermission) => Promise<void>;
	};

	let { request, onSelect, onConfirm, onCancel }: Props = $props();
	let input = $state('');
	let open = $state(true);

	function submitInput(): void {
		if (!input.trim()) {
			return;
		}

		void onSelect(request, input);
	}

	function handleInputKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter') {
			return;
		}

		event.preventDefault();
		submitInput();
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class="permission-trigger"
		aria-label={`Permission approval: ${request.title}`}
		data-permission-trigger
	>
		<span aria-hidden="true">!</span>
		Approval required
	</Popover.Trigger>

	<Popover.Portal>
		<Popover.Content
			class="permission-content"
			aria-label="Permission approval"
			role="dialog"
			side="top"
			sideOffset={8}
			data-permission-approval
		>
			<header>
				<span class="permission-mark" aria-hidden="true">!</span>
				<h2>Approval required</h2>
			</header>
			<p class="permission-copy">{request.title}</p>
			{#if request.message}<p class="permission-message">{request.message}</p>{/if}

			{#if request.method === 'select'}
				<div class="permission-actions" aria-busy={request.responding}>
					{#each request.options ?? [] as option (option)}
						<button
							data-primary={option.startsWith('Yes') || undefined}
							type="button"
							disabled={request.responding}
							onclick={() => void onSelect(request, option)}
						>
							{option}
						</button>
					{/each}
				</div>
			{:else if request.method === 'confirm'}
				<div class="permission-actions" aria-busy={request.responding}>
					<button
						data-primary
						type="button"
						disabled={request.responding}
						onclick={() => void onConfirm(request, true)}
					>
						Approve
					</button>
					<button
						type="button"
						disabled={request.responding}
						onclick={() => void onConfirm(request, false)}
					>
						Deny
					</button>
				</div>
			{:else}
				<div class="permission-input" aria-busy={request.responding}>
					<label>
						<span>Reason</span>
						<input
							bind:value={input}
							disabled={request.responding}
							placeholder={request.placeholder ?? 'Reason'}
							onkeydown={handleInputKeydown}
						/>
					</label>
					<div class="permission-actions">
						<button
							data-primary
							type="button"
							disabled={request.responding || !input.trim()}
							onclick={submitInput}
						>
							Submit reason
						</button>
						<button
							type="button"
							disabled={request.responding}
							onclick={() => void onCancel(request)}
						>
							Cancel
						</button>
					</div>
				</div>
			{/if}

			{#if request.error}<p class="permission-error" role="alert">{request.error}</p>{/if}
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>

<style>
	:global([data-permission-trigger].permission-trigger) {
		display: flex;
		width: 100%;
		box-sizing: border-box;
		align-items: center;
		gap: 0.4rem;
		border: 1px solid color-mix(in srgb, var(--warning) 55%, var(--border));
		border-radius: 999px;
		background: var(--surface);
		color: var(--warning);
		padding: 0.4rem 0.65rem;
		font-size: 0.75rem;
		font-weight: 700;
	}

	:global([data-permission-trigger].permission-trigger > span),
	:global([data-permission-approval] .permission-mark) {
		display: grid;
		width: 1rem;
		height: 1rem;
		place-items: center;
		border: 1px solid currentColor;
		border-radius: 50%;
		font-size: 0.7rem;
	}

	:global([data-permission-trigger].permission-trigger:focus-visible),
	:global([data-permission-approval] button:focus-visible),
	:global([data-permission-approval] input:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	:global([data-permission-approval].permission-content) {
		z-index: 5;
		width: var(--bits-popover-anchor-width);
		box-sizing: border-box;
		border: 1px solid color-mix(in srgb, var(--warning) 55%, var(--border));
		border-radius: 0.75rem;
		background: var(--surface);
		box-shadow: 0 0.75rem 2rem var(--shadow);
		color: var(--text);
		padding: 1rem;
	}

	:global([data-permission-approval] header) {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--warning);
	}

	:global([data-permission-approval] h2),
	:global([data-permission-approval] p) {
		margin: 0;
	}

	:global([data-permission-approval] h2) {
		font-size: 0.9rem;
	}

	:global([data-permission-approval] .permission-copy) {
		margin-top: 0.8rem;
		font:
			0.85rem/1.5 ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
		white-space: pre-wrap;
	}

	:global([data-permission-approval] .permission-message) {
		margin-top: 0.45rem;
		color: var(--text-muted);
		font-size: 0.85rem;
		line-height: 1.5;
	}

	:global([data-permission-approval] .permission-actions) {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	:global([data-permission-approval] button) {
		border: 1px solid var(--border-strong);
		border-radius: 0.4rem;
		background: var(--surface-strong);
		color: var(--text);
		padding: 0.45rem 0.7rem;
		font-size: 0.8rem;
	}

	:global([data-permission-approval] button[data-primary]) {
		border-color: var(--success);
		background: var(--success);
		color: var(--accent-ink);
	}

	:global([data-permission-approval] button:disabled) {
		opacity: 0.55;
	}

	:global([data-permission-approval] .permission-input) {
		margin-top: 1rem;
	}

	:global([data-permission-approval] label) {
		display: grid;
		gap: 0.35rem;
		color: var(--text-muted);
		font-size: 0.8rem;
	}

	:global([data-permission-approval] input) {
		width: 100%;
		box-sizing: border-box;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--surface-muted);
		color: var(--text);
		padding: 0.5rem 0.6rem;
	}

	:global([data-permission-approval] .permission-error) {
		margin-top: 0.8rem;
		color: var(--danger);
		font-size: 0.8rem;
	}
</style>

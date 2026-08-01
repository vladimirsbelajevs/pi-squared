<script lang="ts">
	import type { PendingPermission } from '$lib/harness/types';

	type Props = {
		request: PendingPermission;
		onSelect: (request: PendingPermission, value: string) => Promise<void>;
		onConfirm: (request: PendingPermission, confirmed: boolean) => Promise<void>;
		onCancel: (request: PendingPermission) => Promise<void>;
	};

	let { request, onSelect, onConfirm, onCancel }: Props = $props();
	let input = $state('');

	function submitInput(event: SubmitEvent): void {
		event.preventDefault();
		if (!input.trim()) {
			return;
		}

		void onSelect(request, input);
	}
</script>

<section
	class="permission-request"
	aria-busy={request.responding}
	aria-live="assertive"
	role="alert"
>
	<header><span class="permission-mark">!</span>Approval required</header>
	<p class="permission-copy">{request.title}</p>
	{#if request.message}<p class="permission-copy permission-message">{request.message}</p>{/if}

	{#if request.method === 'select'}
		<div class="permission-options">
			{#each request.options ?? [] as option (option)}
				<button
					class:approve={option.startsWith('Yes')}
					type="button"
					disabled={request.responding}
					onclick={() => void onSelect(request, option)}
				>
					{option}
				</button>
			{/each}
		</div>
	{:else if request.method === 'confirm'}
		<div class="permission-options">
			<button
				class="approve"
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
		<form class="permission-input" onsubmit={submitInput}>
			<label>
				<span>Reason</span>
				<input
					bind:value={input}
					disabled={request.responding}
					placeholder={request.placeholder ?? 'Reason'}
				/>
			</label>
			<div class="permission-options">
				<button class="approve" type="submit" disabled={request.responding || !input.trim()}>
					Submit reason
				</button>
				<button type="button" disabled={request.responding} onclick={() => void onCancel(request)}>
					Cancel
				</button>
			</div>
		</form>
	{/if}

	{#if request.error}<p class="permission-error">{request.error}</p>{/if}
</section>

<style>
	.permission-request {
		max-width: 54rem;
		margin: 0 auto 1rem;
		border: 1px solid color-mix(in srgb, var(--warning) 62%, var(--border));
		border-radius: 0.6rem;
		background: color-mix(in srgb, var(--warning) 8%, var(--surface));
		box-shadow: 0 0.6rem 1.8rem var(--shadow);
	}

	.permission-request header {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.55rem 0.8rem;
		border-bottom: 1px solid color-mix(in srgb, var(--warning) 35%, var(--border));
		color: var(--warning);
		font-size: 0.74rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.permission-mark {
		display: grid;
		width: 1rem;
		height: 1rem;
		place-items: center;
		border: 1px solid currentColor;
		border-radius: 50%;
		font-size: 0.7rem;
	}

	.permission-copy {
		margin: 0;
		padding: 0.8rem 0.8rem 0;
		color: var(--text);
		font:
			0.85rem/1.5 ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
		white-space: pre-wrap;
	}

	.permission-message {
		padding-top: 0.45rem;
		color: var(--text-muted);
	}

	.permission-options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		padding: 0.8rem;
	}

	.permission-options button {
		border: 1px solid var(--border-strong);
		border-radius: 0.35rem;
		background: var(--surface-strong);
		color: var(--text);
		padding: 0.4rem 0.65rem;
		font-size: 0.75rem;
	}

	.permission-options button.approve {
		border-color: color-mix(in srgb, var(--success) 60%, var(--border));
		background: color-mix(in srgb, var(--success) 13%, var(--surface));
		color: var(--success);
	}

	.permission-options button:hover:not(:disabled) {
		filter: brightness(1.12);
	}

	.permission-options button:disabled {
		opacity: 0.55;
	}

	.permission-input {
		padding: 0.8rem 0.8rem 0;
	}

	.permission-input label {
		display: grid;
		gap: 0.35rem;
		color: var(--text-muted);
		font-size: 0.75rem;
	}

	.permission-input input {
		width: 100%;
		border: 1px solid var(--border);
		border-radius: 0.35rem;
		background: var(--surface);
		color: var(--text);
		padding: 0.5rem 0.6rem;
	}

	.permission-input .permission-options {
		padding-inline: 0;
	}

	.permission-error {
		margin: 0;
		padding: 0 0.8rem 0.8rem;
		color: var(--danger);
		font-size: 0.78rem;
	}
</style>

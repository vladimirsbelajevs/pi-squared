<script lang="ts">
	import { AlertDialog } from 'bits-ui';
	import type { PendingPermission } from '$lib/harness/types';
	import { fly } from 'svelte/transition';

	type Props = {
		requests: PendingPermission[];
		onSelect: (request: PendingPermission, value: string) => Promise<void>;
		onConfirm: (request: PendingPermission, confirmed: boolean) => Promise<void>;
		onCancel: (request: PendingPermission) => Promise<void>;
	};

	let { requests, onSelect, onConfirm, onCancel }: Props = $props();
	let inputs = $state<Record<string, string>>({});
	let closingRequests = $state<Record<string, PendingPermission>>({});
	let displayedRequests = $derived.by(() => {
		const activeRequestIds = new Set(requests.map((request) => request.id));

		return [
			...requests,
			...Object.values(closingRequests).filter((request) => !activeRequestIds.has(request.id))
		];
	});

	function submitInput(request: PendingPermission): void {
		const input = inputs[request.id] ?? '';
		if (!input.trim()) {
			return;
		}

		respond(request, () => onSelect(request, input));
	}

	function respond(request: PendingPermission, callback: () => Promise<void>): void {
		closingRequests[request.id] = request;
		void callback().finally(() => {
			if (requests.some((activeRequest) => activeRequest.id === request.id)) {
				delete closingRequests[request.id];
			}
		});
	}

	function handleInput(request: PendingPermission, event: Event): void {
		inputs[request.id] = (event.currentTarget as HTMLInputElement).value;
	}

	function handleInputKeydown(request: PendingPermission, event: KeyboardEvent): void {
		if (event.key !== 'Enter') {
			return;
		}

		event.preventDefault();
		submitInput(request);
	}
</script>

{#each displayedRequests as request (request.id)}
	<AlertDialog.Root open={!closingRequests[request.id]}>
		<AlertDialog.Portal>
			<AlertDialog.Overlay class="permission-overlay" data-permission-approval />
			<AlertDialog.Content
				forceMount
				restoreScrollDelay={150}
				interactOutsideBehavior="ignore"
				onEscapeKeydown={(event) => event.preventDefault()}
			>
				{#snippet child({ props, open })}
					{#if open}
						<div
							{...props}
							class="permission-content"
							aria-busy={request.responding}
							data-permission-approval
							transition:fly={{ y: 16, duration: 150 }}
							onoutroend={() => delete closingRequests[request.id]}
						>
							<header>
								<span class="permission-mark" aria-hidden="true">!</span>
								<AlertDialog.Title>Approval required</AlertDialog.Title>
							</header>
							<AlertDialog.Description class="permission-copy">
								{request.title}
								{#if request.message}<span class="permission-message">{request.message}</span>{/if}
							</AlertDialog.Description>

							{#if request.method === 'select'}
								<div class="permission-actions">
									{#each request.options ?? [] as option (option)}
										<button
											data-primary={option.startsWith('Yes') || undefined}
											type="button"
											disabled={request.responding}
											onclick={() => respond(request, () => onSelect(request, option))}
										>
											{option}
										</button>
									{/each}
								</div>
							{:else if request.method === 'confirm'}
								<div class="permission-actions">
									<button
										data-primary
										type="button"
										disabled={request.responding}
										onclick={() => respond(request, () => onConfirm(request, true))}
									>
										Approve
									</button>
									<button
										type="button"
										disabled={request.responding}
										onclick={() => respond(request, () => onConfirm(request, false))}
									>
										Deny
									</button>
								</div>
							{:else}
								<div class="permission-input">
									<label>
										<span>Reason</span>
										<input
											value={inputs[request.id] ?? ''}
											disabled={request.responding}
											placeholder={request.placeholder ?? 'Reason'}
											oninput={(event) => handleInput(request, event)}
											onkeydown={(event) => handleInputKeydown(request, event)}
										/>
									</label>
									<div class="permission-actions">
										<button
											data-primary
											type="button"
											disabled={request.responding || !(inputs[request.id] ?? '').trim()}
											onclick={() => submitInput(request)}
										>
											Submit reason
										</button>
										<button
											type="button"
											disabled={request.responding}
											onclick={() => respond(request, () => onCancel(request))}
										>
											Cancel
										</button>
									</div>
								</div>
							{/if}

							{#if request.error}<p class="permission-error" role="alert">{request.error}</p>{/if}
						</div>
					{/if}
				{/snippet}
			</AlertDialog.Content>
		</AlertDialog.Portal>
	</AlertDialog.Root>
{/each}

<style>
	:global([data-permission-approval].permission-overlay) {
		position: fixed;
		z-index: 5;
		inset: 0;
		background: rgb(0 0 0 / 45%);
	}

	:global([data-permission-approval].permission-content) {
		position: fixed;
		top: 50%;
		left: 50%;
		z-index: 6;
		width: min(54rem, calc(100vw - 2rem));
		box-sizing: border-box;
		border: 1px solid color-mix(in srgb, var(--warning) 55%, var(--border));
		border-radius: 0.75rem;
		background: var(--surface);
		box-shadow: 0 0.75rem 2rem var(--shadow);
		color: var(--text);
		padding: 1rem;
		transform: translate(-50%, -50%);
	}

	:global([data-permission-approval] header) {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--warning);
	}

	:global([data-permission-approval] .permission-mark) {
		display: grid;
		width: 1rem;
		height: 1rem;
		place-items: center;
		border: 1px solid currentColor;
		border-radius: 50%;
		font-size: 0.7rem;
	}

	:global([data-permission-approval] h2),
	:global([data-permission-approval] p) {
		margin: 0;
	}

	:global([data-permission-approval] h2) {
		font-size: 0.9rem;
	}

	:global([data-permission-approval] .permission-copy) {
		display: block;
		margin-top: 0.8rem;
		font:
			0.85rem/1.5 ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
		white-space: pre-wrap;
	}

	:global([data-permission-approval] .permission-message) {
		display: block;
		margin-top: 0.45rem;
		color: var(--text-muted);
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
		font-size: 0.85rem;
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

	:global([data-permission-approval] button:focus-visible),
	:global([data-permission-approval] input:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
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

	@media (max-width: 700px) {
		:global([data-permission-approval].permission-content) {
			width: calc(100vw - 1.5rem);
		}
	}
</style>

<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { onMount } from 'svelte';
	import { getDesktopApi } from '$lib/desktop';
	import type {
		DesktopBootstrapProgress,
		DesktopBootstrapStatus,
		PiSquaredDesktopApi
	} from '$lib/desktop-contract';

	let api = $state<PiSquaredDesktopApi | undefined>();
	let status = $state<DesktopBootstrapStatus | undefined>();
	let output = $state('');
	let errorMessage = $state('');
	let open = $derived(Boolean(api && status && !status.configured));
	let running = $derived(status?.phase === 'running');

	function appendOutput(progress: DesktopBootstrapProgress): void {
		const next = `${output}[${progress.stream}] ${progress.text}`;
		output = next.length > 128 * 1024 ? next.slice(-128 * 1024) : next;
	}

	async function startSetup(): Promise<void> {
		if (!api || running) {
			return;
		}

		errorMessage = '';
		output = '';
		if (status) {
			status = { ...status, phase: 'running' };
		}

		try {
			const next = await api.startBootstrap();
			status = next;
			if (!next.configured) {
				errorMessage = next.error ?? 'Pi setup did not complete.';
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errorMessage = message;
			if (status) {
				status = { ...status, phase: 'failed', error: message };
			}
		}
	}

	async function quit(): Promise<void> {
		await api?.quit();
	}

	onMount(() => {
		api = getDesktopApi();
		if (!api) {
			return;
		}

		let unsubscribe: () => void = () => undefined;
		void api
			.getBootstrapStatus()
			.then((next) => {
				status = next;
				unsubscribe = api?.onBootstrapProgress(appendOutput) ?? unsubscribe;
			})
			.catch((error: unknown) => {
				status = {
					phase: 'failed',
					configured: false,
					prerequisites: { node: false, npm: false, pi: false },
					missingPackages: [],
					permissionConfig: false,
					error: error instanceof Error ? error.message : String(error)
				};
				errorMessage = status.error ?? 'Unable to inspect Pi setup.';
			});

		return () => unsubscribe();
	});
</script>

{#if api && status && !status.configured}
	<Dialog.Root {open}>
		<Dialog.Portal>
			<Dialog.Overlay class="desktop-onboarding-overlay" />
			<Dialog.Content class="desktop-onboarding-content" data-desktop-onboarding>
				<Dialog.Title class="desktop-onboarding-title">Set up Pi Squared</Dialog.Title>
				<Dialog.Description class="desktop-onboarding-description">
					Pi Squared needs the global Pi command and its extensions before the desktop app can
					start. Your existing <code>~/.pi/agent</code> credentials, models, sessions, and settings are
					kept.
				</Dialog.Description>
				<div class="desktop-onboarding-prerequisites" aria-label="Setup prerequisites">
					<span class:ready={status.prerequisites.node}>Node.js ≥ 22.19</span>
					<span class:ready={status.prerequisites.npm}>npm</span>
					<span class:ready={status.prerequisites.pi}>Pi CLI</span>
				</div>
				{#if !status.prerequisites.node || !status.prerequisites.npm}
					<p class="desktop-onboarding-help">
						Install Node.js ≥ 22.19.0 and npm before retrying. The setup button will install the Pi
						CLI when those prerequisites are available.
					</p>
				{:else if !status.prerequisites.pi}
					<p class="desktop-onboarding-help">
						The Pi CLI is not installed yet. The setup button will install it and the required
						extensions.
					</p>
				{/if}
				{#if status.missingPackages.length > 0}
					<p class="desktop-onboarding-help">
						Missing required extensions: {status.missingPackages.join(', ')}
					</p>
				{/if}
				{#if !status.permissionConfig}
					<p class="desktop-onboarding-help">
						The shared permission configuration will be installed.
					</p>
				{/if}
				<p class="desktop-onboarding-provider" role="note">
					Provider credentials are not collected here. Configure at least one provider with Pi after
					setup; existing credentials continue to work.
				</p>
				<div class="desktop-onboarding-output" role="log" aria-live="polite">
					<pre>{output || 'Ready to install Pi and the required extensions.'}</pre>
				</div>
				{#if errorMessage || status.error}
					<p class="desktop-onboarding-error" role="alert">{errorMessage || status.error}</p>
				{/if}
				<div class="desktop-onboarding-actions">
					<button type="button" disabled={running} onclick={quit}>Quit</button>
					<button type="button" disabled={running} onclick={() => void startSetup()}>
						{running ? 'Installing…' : status.phase === 'failed' ? 'Retry' : 'Install Pi setup'}
					</button>
				</div>
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>
{/if}

<style>
	:global(.desktop-onboarding-overlay) {
		position: fixed;
		z-index: 40;
		inset: 0;
		background: color-mix(in srgb, var(--shadow) 75%, transparent);
	}

	:global(.desktop-onboarding-content) {
		position: fixed;
		top: 50%;
		left: 50%;
		z-index: 41;
		display: grid;
		width: min(42rem, calc(100vw - 2rem));
		max-height: calc(100dvh - 2rem);
		transform: translate(-50%, -50%);
		gap: 1rem;
		overflow: auto;
		border: 1px solid var(--border-strong);
		border-radius: 0.7rem;
		background: var(--canvas);
		box-shadow: 0 1rem 3rem var(--shadow);
		color: var(--text);
		padding: 1.3rem;
	}

	:global(.desktop-onboarding-title),
	:global(.desktop-onboarding-description),
	:global(.desktop-onboarding-help),
	:global(.desktop-onboarding-provider),
	:global(.desktop-onboarding-error) {
		margin: 0;
	}

	:global(.desktop-onboarding-title) {
		font-size: 1.2rem;
	}

	:global(.desktop-onboarding-description),
	:global(.desktop-onboarding-help),
	:global(.desktop-onboarding-provider) {
		color: var(--text-muted);
		font-size: 0.88rem;
		line-height: 1.5;
	}

	:global(.desktop-onboarding-prerequisites) {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	:global(.desktop-onboarding-prerequisites span) {
		border: 1px solid var(--border);
		border-radius: 999px;
		color: var(--danger);
		font-size: 0.78rem;
		padding: 0.3rem 0.6rem;
	}

	:global(.desktop-onboarding-prerequisites span.ready) {
		color: var(--success, #4ade80);
	}

	:global(.desktop-onboarding-output) {
		max-height: 14rem;
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--surface-muted);
		font:
			0.78rem/1.45 ui-monospace,
			SFMono-Regular,
			Menlo,
			Consolas,
			monospace;
		padding: 0.75rem;
	}

	:global(.desktop-onboarding-output pre) {
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
	}

	:global(.desktop-onboarding-error) {
		color: var(--danger);
		font-size: 0.86rem;
	}

	:global(.desktop-onboarding-actions) {
		display: flex;
		justify-content: flex-end;
		gap: 0.6rem;
	}

	:global(.desktop-onboarding-actions button) {
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--surface-muted);
		color: var(--text);
		padding: 0.55rem 0.8rem;
	}

	:global(.desktop-onboarding-actions button:hover:not(:disabled)) {
		border-color: var(--accent);
	}
</style>

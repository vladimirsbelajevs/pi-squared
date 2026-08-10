<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { onMount } from 'svelte';
	import {
		applicationUpdateEnvironment,
		applicationUpdateState,
		registerApplicationUpdateStarter
	} from '$lib/application-updater.svelte';

	type UpdatePhase = 'idle' | 'starting' | 'running' | 'success' | 'failed' | 'reconnecting';
	type OutputRecord = {
		type: 'output' | 'error' | 'complete';
		stream?: 'stdout' | 'stderr';
		text?: string;
		message?: string;
		code?: number | null;
		error?: string;
	};
	type UpdateStatus = {
		supported: boolean;
		nativeRegistration: boolean;
		running: boolean;
		platform: string;
		instanceId?: string;
	};

	const REMINDER_KEY = 'pi-squared.application-update-next-reminder';
	const REMINDER_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
	const FIRST_REMINDER_DELAY_MS = 1500;
	const RECONNECT_TIMEOUT_MS = 30_000;
	const MAX_OUTPUT_BYTES = 256 * 1024;

	let phase = $state<UpdatePhase>('idle');
	let dialogOpen = $state(false);
	let snackbarVisible = $state(false);
	let output = $state('');
	let latestOutputAnnouncement = $state('');
	let errorMessage = $state('');
	let status = $state<UpdateStatus | null>(null);
	let outputElement = $state<HTMLDivElement | null>(null);
	let activeReader = $state<ReadableStreamDefaultReader<Uint8Array> | null>(null);
	let activeUpdateController = $state<AbortController | null>(null);
	let runId = 0;
	let reconnectCancelled = false;
	let mounted = false;
	let reminderTimer: ReturnType<typeof setTimeout> | undefined;

	let updateBusy = $derived(
		phase === 'starting' || phase === 'running' || phase === 'reconnecting'
	);
	let statusText = $derived(
		phase === 'starting'
			? 'Starting application update…'
			: phase === 'running'
				? 'Updating Pi, extensions, dependencies, and the application build…'
				: phase === 'success'
					? 'Application update completed successfully.'
					: phase === 'failed'
						? 'Application update failed.'
						: phase === 'reconnecting'
							? 'Waiting for the updated application to restart…'
							: 'Application update is ready.'
	);

	function attachOutput(element: HTMLDivElement): () => void {
		outputElement = element;

		return () => {
			if (outputElement === element) {
				outputElement = null;
			}
		};
	}

	function appendOutput(text: string): void {
		const bytes = new TextEncoder().encode(output + text);
		const start = Math.max(0, bytes.byteLength - MAX_OUTPUT_BYTES);
		output = new TextDecoder().decode(bytes.slice(start));
		latestOutputAnnouncement = text.length > 500 ? text.slice(-500) : text;
		requestAnimationFrame(() => {
			if (mounted) {
				outputElement?.scrollTo(0, outputElement.scrollHeight);
			}
		});
	}

	function clearReminderTimer(): void {
		if (reminderTimer !== undefined) {
			clearTimeout(reminderTimer);
			reminderTimer = undefined;
		}
	}

	function recordReminderChoice(): void {
		localStorage.setItem(REMINDER_KEY, String(Date.now() + REMINDER_DELAY_MS));
		snackbarVisible = false;
	}

	function dismissReminder(): void {
		recordReminderChoice();
	}

	function parseRecords(buffer: string, id: number): string {
		const lines = buffer.split('\n');
		const remainder = lines.pop() ?? '';
		for (const line of lines) {
			if (!line.trim() || id !== runId) {
				continue;
			}

			try {
				handleRecord(JSON.parse(line) as OutputRecord, id);
			} catch {
				appendOutput(`[protocol] ${line}\n`);
			}
		}

		return remainder;
	}

	function handleRecord(record: OutputRecord, id: number): void {
		if (record.type === 'output') {
			const stream = record.stream === 'stderr' ? 'stderr' : 'stdout';
			appendOutput(`[${stream}] ${record.text ?? ''}`);

			return;
		}

		if (record.type === 'error') {
			errorMessage = record.message ?? 'The update process could not be started.';

			return;
		}

		if (record.type === 'complete') {
			if (record.code === 0) {
				phase = 'success';
				void loadStatus(id);
			} else {
				phase = 'failed';
				errorMessage =
					record.error ??
					`The update process exited with ${record.code === null ? 'an error' : `code ${record.code}`}.`;
			}
		}
	}

	async function loadStatus(id: number): Promise<void> {
		try {
			const response = await fetch('/api/application/update', { cache: 'no-store' });
			if (response.ok) {
				const nextStatus = (await response.json()) as UpdateStatus;
				if (mounted && id === runId) {
					status = nextStatus;
				}
			}
		} catch {
			// The update result remains useful even if the status query is interrupted.
		}
	}

	async function startUpdate(): Promise<void> {
		if (updateBusy || applicationUpdateState.busy) {
			return;
		}

		clearReminderTimer();
		const id = ++runId;
		applicationUpdateState.busy = true;
		reconnectCancelled = false;
		phase = 'starting';
		dialogOpen = true;
		snackbarVisible = false;
		output = '';
		latestOutputAnnouncement = '';
		errorMessage = '';
		status = null;
		let buffer = '';
		const decoder = new TextDecoder();
		const controller = new AbortController();
		activeUpdateController = controller;

		try {
			const response = await fetch('/api/application/update', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal: controller.signal
			});
			if (!response.ok) {
				throw new Error(await response.text());
			}

			if (!response.body) {
				throw new Error('The update stream was not provided by the server.');
			}

			phase = 'running';
			const reader = response.body.getReader();
			activeReader = reader;
			while (id === runId) {
				const result = await reader.read();
				if (result.done) {
					break;
				}

				buffer += decoder.decode(result.value, { stream: true });
				buffer = parseRecords(buffer, id);
			}

			buffer += decoder.decode();
			if (buffer.trim() && id === runId) {
				parseRecords(`${buffer}\n`, id);
			}

			if (id === runId && phase === 'running') {
				phase = 'failed';
				errorMessage = 'The update stream ended before completion was reported.';
			}
		} catch (error) {
			if (id === runId) {
				phase = 'failed';
				errorMessage = error instanceof Error ? error.message : String(error);
			}
		} finally {
			if (id === runId) {
				activeReader = null;
				activeUpdateController = null;
				applicationUpdateState.busy = false;
			}
		}
	}

	function chooseYes(): void {
		recordReminderChoice();
		void startUpdate();
	}

	function handleDialogOpenChange(open: boolean): void {
		if (!open && applicationUpdateState.busy) {
			return;
		}

		dialogOpen = open;
	}

	function closeDialog(): void {
		if (!updateBusy) {
			dialogOpen = false;
		}
	}

	function wait(milliseconds: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, milliseconds));
	}

	async function waitForRestart(baselineInstanceId: string | undefined): Promise<void> {
		const deadline = Date.now() + RECONNECT_TIMEOUT_MS;
		const graceDeadline = Date.now() + 1000;
		let offlineObserved = false;

		// Poll immediately, but do not reload a response from the old process. The
		// instance id makes a fast restart observable even when no request fails.
		while (!reconnectCancelled && Date.now() < deadline) {
			try {
				const response = await fetch('/api/application/update', { cache: 'no-store' });
				if (!response.ok) {
					offlineObserved = true;
				} else {
					const nextStatus = (await response.json()) as UpdateStatus;
					if (
						baselineInstanceId &&
						nextStatus.instanceId &&
						nextStatus.instanceId !== baselineInstanceId
					) {
						applicationUpdateEnvironment.reload();

						return;
					}

					// Older/custom servers may not expose an instance id. In that case
					// only reload after observing a real disconnect and a healthy response.
					if (!baselineInstanceId && offlineObserved && Date.now() >= graceDeadline) {
						applicationUpdateEnvironment.reload();

						return;
					}
				}
			} catch {
				offlineObserved = true;
			}

			await wait(350);
		}

		if (!reconnectCancelled) {
			phase = 'success';
			applicationUpdateState.busy = false;
			errorMessage = 'The updated application did not return within 30 seconds.';
		}
	}

	async function restartApplication(): Promise<void> {
		if (phase !== 'success' || status?.nativeRegistration !== true) {
			return;
		}

		phase = 'reconnecting';
		applicationUpdateState.busy = true;
		errorMessage = '';
		reconnectCancelled = false;
		const polling = waitForRestart(status.instanceId);
		try {
			const response = await fetch('/api/application/restart', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' }
			});
			if (!response.ok) {
				throw new Error(await response.text());
			}
		} catch (error) {
			// A restart normally interrupts this request when the old server exits.
			if (reconnectCancelled) {
				return;
			}

			if (error instanceof TypeError) {
				await polling;

				return;
			}

			reconnectCancelled = true;
			await polling;
			applicationUpdateState.busy = false;
			phase = 'success';
			errorMessage = error instanceof Error ? error.message : String(error);

			return;
		}

		await polling;
	}

	onMount(() => {
		mounted = true;
		const scheduleReminder = (): void => {
			const nextReminder = Number(localStorage.getItem(REMINDER_KEY) ?? '0');
			const delay = nextReminder > Date.now() ? nextReminder - Date.now() : FIRST_REMINDER_DELAY_MS;
			reminderTimer = setTimeout(() => {
				reminderTimer = undefined;
				if (!updateBusy && !applicationUpdateState.busy) {
					snackbarVisible = true;
				}
			}, delay);
		};

		scheduleReminder();
		const unregister = registerApplicationUpdateStarter(() => void startUpdate());

		return () => {
			mounted = false;
			runId += 1;
			unregister();
			clearReminderTimer();

			reconnectCancelled = true;
			activeUpdateController?.abort();
			void activeReader?.cancel();
			applicationUpdateState.busy = false;
		};
	});
</script>

{#if snackbarVisible}
	<aside class="application-update-snackbar" data-application-updater role="status">
		<strong>Update application?</strong>
		<div class="application-update-snackbar-actions">
			<button type="button" disabled={updateBusy} onclick={chooseYes}>Yes</button>
			<button type="button" disabled={updateBusy} onclick={dismissReminder}>No</button>
		</div>
	</aside>
{/if}

<Dialog.Root open={dialogOpen} onOpenChange={handleDialogOpenChange}>
	<Dialog.Portal>
		<Dialog.Overlay data-application-updater class="application-update-overlay" />
		<Dialog.Content
			data-application-updater
			class="application-update-content"
			escapeKeydownBehavior={updateBusy ? 'ignore' : 'close'}
			interactOutsideBehavior={updateBusy ? 'ignore' : 'close'}
		>
			<Dialog.Title data-application-updater class="application-update-title">
				Application update
			</Dialog.Title>
			<Dialog.Description data-application-updater class="application-update-description">
				This operation pulls repository changes, updates Pi and extensions and npm dependencies, and
				rebuilds the app.
			</Dialog.Description>
			<p class="application-update-status" role="status" aria-live="polite">{statusText}</p>
			{#if updateBusy}
				<progress class="application-update-progress" aria-label="Application update progress"
				></progress>
			{/if}
			<div
				{@attach attachOutput}
				class="application-update-output"
				data-application-updater
				tabindex="0"
				role="textbox"
				aria-readonly="true"
				aria-label="Application update output"
				aria-live="off"
			>
				<pre>{output || 'Waiting for update output…'}</pre>
			</div>
			<p class="visually-hidden" role="status" aria-live="polite">{latestOutputAnnouncement}</p>
			{#if phase === 'success' && status?.nativeRegistration === false}
				<p class="application-update-help" role="note">
					Restart app is unavailable because no native background registration was found. Rerun
					setup with background registration enabled.
				</p>
			{/if}
			{#if errorMessage}
				<p class="application-update-error" role="alert">{errorMessage}</p>
			{/if}
			<div class="application-update-actions">
				{#if !updateBusy}
					<button type="button" onclick={closeDialog}>Close</button>
				{/if}
				{#if phase === 'failed'}
					<button type="button" onclick={() => void startUpdate()}>Retry</button>
				{/if}
				{#if phase === 'success'}
					<button
						type="button"
						class="restart-action"
						disabled={status?.nativeRegistration !== true}
						onclick={() => void restartApplication()}
					>
						Restart app
					</button>
				{/if}
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	:global([data-application-updater].application-update-overlay) {
		position: fixed;
		z-index: 30;
		inset: 0;
		background: color-mix(in srgb, var(--shadow) 70%, transparent);
	}

	:global([data-application-updater].application-update-content) {
		position: fixed;
		top: 50%;
		left: 50%;
		z-index: 31;
		display: flex;
		width: min(58rem, calc(100vw - 2rem));
		height: min(80dvh, 46rem);
		transform: translate(-50%, -50%);
		flex-direction: column;
		gap: 0.8rem;
		overflow: hidden;
		border: 1px solid var(--border-strong);
		border-radius: 0.6rem;
		background: var(--canvas);
		box-shadow: 0 1rem 3rem var(--shadow);
		color: var(--text);
		outline: none;
		padding: 1.25rem;
	}

	:global([data-application-updater].application-update-title) {
		margin: 0;
		font-size: 1.15rem;
	}

	:global([data-application-updater].application-update-description) {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.88rem;
	}

	.application-update-status {
		margin: 0;
		font-weight: 600;
	}

	.application-update-progress {
		width: 100%;
		accent-color: var(--accent);
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

	:global([data-application-updater].application-update-output) {
		flex: 1;
		min-height: 8rem;
		margin: 0;
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--surface-muted);
		color: var(--text);
		font:
			0.78rem/1.45 ui-monospace,
			SFMono-Regular,
			Menlo,
			Consolas,
			monospace;
		padding: 0.8rem;
	}

	:global([data-application-updater].application-update-output pre) {
		margin: 0;
		font: inherit;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.application-update-help,
	.application-update-error {
		margin: 0;
		font-size: 0.85rem;
	}

	.application-update-help {
		color: var(--warning);
	}

	.application-update-error {
		color: var(--danger);
	}

	.application-update-actions,
	.application-update-snackbar-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.6rem;
	}

	.application-update-actions button,
	.application-update-snackbar button {
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--surface-muted);
		color: var(--text);
		padding: 0.55rem 0.8rem;
	}

	.application-update-actions button:hover:not(:disabled),
	.application-update-snackbar button:hover {
		border-color: var(--accent);
	}

	.application-update-actions button:disabled,
	.application-update-snackbar button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.application-update-actions .restart-action {
		margin-left: auto;
	}

	.application-update-snackbar {
		position: fixed;
		right: 1rem;
		bottom: 1rem;
		z-index: 25;
		display: flex;
		align-items: center;
		gap: 1rem;
		max-width: min(32rem, calc(100vw - 2rem));
		border: 1px solid var(--border-strong);
		border-radius: 0.5rem;
		background: var(--surface);
		box-shadow: 0 0.6rem 2rem var(--shadow);
		color: var(--text);
		padding: 0.8rem 1rem;
	}

	@media (prefers-reduced-motion: reduce) {
		:global([data-application-updater].application-update-overlay),
		:global([data-application-updater].application-update-content) {
			animation: none;
		}
	}

	@media (max-width: 700px) {
		:global([data-application-updater].application-update-content) {
			width: calc(100vw - 1rem);
			height: calc(100dvh - 1rem);
			padding: 1rem;
		}

		.application-update-snackbar {
			right: 0.5rem;
			bottom: 0.5rem;
			left: 0.5rem;
			align-items: stretch;
			flex-direction: column;
			gap: 0.6rem;
		}
	}
</style>

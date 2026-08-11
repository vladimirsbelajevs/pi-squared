<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { Slider } from 'bits-ui';
	import { onMount } from 'svelte';
	import Selector from '$lib/components/Selector.svelte';
	import {
		applicationUpdateState,
		requestApplicationUpdate
	} from '$lib/application-updater.svelte';
	import Switch from '$lib/components/Switch.svelte';
	import { getDesktopApi } from '$lib/desktop';
	import type {
		DesktopPiUpdateProgress,
		DesktopPiUpdateStatus,
		PiSquaredDesktopApi
	} from '$lib/desktop-contract';
	import { THEME_LABELS, workspace } from '$lib/harness/workspace.svelte';
	import type { Theme } from '$lib/harness/types';

	const THEME_SWATCHES: Record<Theme, { background: string; borderColor?: string }> = {
		graphite: { background: 'var(--accent-strong)' },
		paper: { background: '#f0ebe0', borderColor: '#aaa08e' },
		nord: { background: '#88c0d0' },
		solarized: { background: '#2aa198' },
		'tokyonight-night': { background: '#7aa2f7' },
		'tokyonight-storm': { background: '#7aa2f7' },
		'tokyonight-moon': { background: '#82aaff' },
		'tokyonight-day': { background: '#2e7de9', borderColor: '#4094a3' },
		'everforest-dark-hard': { background: '#7fbbb3' },
		'everforest-dark-medium': { background: '#83c092' },
		'everforest-dark-soft': { background: '#a7c080' },
		'everforest-light-hard': { background: '#3a94c5', borderColor: '#829181' },
		'everforest-light-medium': { background: '#3a94c5', borderColor: '#829181' },
		'everforest-light-soft': { background: '#3a94c5', borderColor: '#829181' },
		system: { background: 'linear-gradient(135deg, #111 50%, #f6f3ec 50%)' }
	};
	const themeOptions = (Object.keys(THEME_LABELS) as Theme[]).map((value) => ({
		value,
		label: THEME_LABELS[value],
		swatch: THEME_SWATCHES[value]
	}));

	let notificationStatusText = $derived(
		workspace.notificationPermission === 'unsupported'
			? 'This browser does not support system notifications.'
			: workspace.notificationPermission === 'granted'
				? 'Browser permission granted.'
				: workspace.notificationPermission === 'denied'
					? 'Permission was denied. Change it in your browser site settings.'
					: 'Permission has not been requested.'
	);
	let systemNotificationToggleDisabled = $derived(workspace.notificationPermission !== 'granted');
	let systemTestDisabled = $derived(
		workspace.notificationPermission !== 'granted' || !workspace.systemNotificationsEnabled
	);
	let desktopApi = $state<PiSquaredDesktopApi | undefined>();
	let piUpdateStatus = $state<DesktopPiUpdateStatus>({ phase: 'idle' });
	let piUpdateOutput = $state('');
	let piUpdateRunning = $derived(piUpdateStatus.phase === 'running');

	function appendPiUpdateOutput(progress: DesktopPiUpdateProgress): void {
		const next = `${piUpdateOutput}[${progress.stream}] ${progress.text}`;
		piUpdateOutput = next.length > 64 * 1024 ? next.slice(-64 * 1024) : next;
	}

	async function updatePiAndExtensions(): Promise<void> {
		if (!desktopApi || piUpdateRunning) {
			return;
		}

		piUpdateOutput = '';
		piUpdateStatus = { phase: 'running' };
		try {
			piUpdateStatus = await desktopApi.startPiUpdate();
		} catch (error) {
			piUpdateStatus = {
				phase: 'failed',
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}

	function handleShowReasoningChange(checked: boolean): void {
		workspace.setShowReasoning(checked);
	}

	function handleShowModelChangesChange(checked: boolean): void {
		workspace.setShowModelChanges(checked);
	}

	function handleSoundsChange(checked: boolean): void {
		workspace.setSoundsEnabled(checked);
	}

	function handleNotificationVolumeChange(volume: number): void {
		workspace.setNotificationVolume(volume);
	}

	function handleCompletionChange(checked: boolean): void {
		workspace.setNotifyOnCompletion(checked);
	}

	function handlePermissionChange(checked: boolean): void {
		workspace.setNotifyOnPermission(checked);
	}

	function handleSystemNotificationsChange(checked: boolean): void {
		workspace.setSystemNotificationsEnabled(checked);
	}

	async function requestSystemNotificationPermission(): Promise<void> {
		await workspace.requestSystemNotificationPermission();
	}

	afterNavigate(() => {
		workspace.refreshNotificationPermission();
	});

	onMount(() => {
		desktopApi = getDesktopApi();
		if (!desktopApi) {
			return;
		}

		return desktopApi.onPiUpdateProgress(appendPiUpdateOutput);
	});
</script>

<h1 class="visually-hidden">Settings</h1>

<section class="settings-card" aria-labelledby="theme-heading">
	<h2 id="theme-heading">Theme</h2>
	<Selector
		label="Select theme"
		value={workspace.theme}
		options={themeOptions}
		onChange={(value) => workspace.applyTheme(value as Theme)}
	/>
</section>

<section class="settings-card" aria-labelledby="chat-display-heading">
	<h2 id="chat-display-heading">Chat display</h2>
	<div class="display-preferences">
		<div class="display-preference">
			<div class="display-copy">
				<strong>Show model reasoning</strong>
				<small>Display-only; it does not alter model reasoning level.</small>
			</div>
			<Switch
				checked={workspace.showReasoning}
				label="Show model reasoning"
				onchange={handleShowReasoningChange}
			/>
		</div>
		<div class="display-preference">
			<div class="display-copy">
				<strong>Display model changes in chat</strong>
				<small>Show notices when the model or reasoning level changes.</small>
			</div>
			<Switch
				checked={workspace.showModelChanges}
				label="Display model changes in chat"
				onchange={handleShowModelChangesChange}
			/>
		</div>
	</div>
</section>

<section class="settings-card" aria-labelledby="application-update-heading">
	<h2 id="application-update-heading">Application update</h2>
	<div class="application-update-preference">
		<div class="display-copy">
			<strong>Pi Squared updates</strong>
			<small>
				Desktop releases are checked on GitHub. Manual web users can build the latest source
				checkout and then restart the foreground server.
			</small>
		</div>
		<button
			type="button"
			disabled={applicationUpdateState.busy || piUpdateRunning}
			onclick={() => requestApplicationUpdate()}
		>
			Check for updates
		</button>
	</div>
	{#if desktopApi}
		<div class="application-update-preference">
			<div class="display-copy">
				<strong>Pi CLI and extensions</strong>
				<small>
					Update the global Pi installation and all installed extensions, then restart the local Pi
					Squared server.
				</small>
			</div>
			<button
				type="button"
				disabled={piUpdateRunning || applicationUpdateState.busy}
				onclick={() => void updatePiAndExtensions()}
			>
				{piUpdateRunning ? 'Updating Pi…' : 'Update Pi and extensions'}
			</button>
		</div>
		{#if piUpdateOutput || piUpdateStatus.phase === 'failed'}
			<div class="pi-update-status" aria-live="polite">
				<pre>{piUpdateOutput || piUpdateStatus.error}</pre>
			</div>
		{/if}
	{/if}
</section>

<section class="settings-card" aria-labelledby="notifications-heading">
	<h2 id="notifications-heading">Notifications</h2>
	<div class="display-preferences">
		<div class="display-preference">
			<div class="display-copy">
				<strong>Enable notification sounds</strong>
				<small>Play a sound for enabled notification events.</small>
			</div>
			<Switch
				checked={workspace.soundsEnabled}
				label="Enable notification sounds"
				onchange={handleSoundsChange}
			/>
		</div>
		<div class="display-preference volume-preference">
			<div class="display-copy">
				<strong>Notification sound volume</strong>
				<small>Adjust the loudness of all notification sounds.</small>
			</div>
			<div class="notification-volume-control">
				<output aria-live="polite">{workspace.notificationVolume}%</output>
				<Slider.Root
					type="single"
					min={0}
					max={100}
					step={5}
					value={workspace.notificationVolume}
					onValueChange={handleNotificationVolumeChange}
					class="notification-volume-slider"
				>
					<span class="notification-volume-track">
						<Slider.Range class="notification-volume-range" />
					</span>
					<Slider.Thumb
						index={0}
						class="notification-volume-thumb"
						aria-label="Notification sound volume"
						aria-valuetext={`${workspace.notificationVolume}%`}
					/>
				</Slider.Root>
			</div>
		</div>
		<div class="display-preference">
			<div class="display-copy">
				<strong>Notify when agents complete</strong>
				<small>Use the selected sound and system notification channels.</small>
			</div>
			<Switch
				checked={workspace.notifyOnCompletion}
				label="Notify when agents complete"
				onchange={handleCompletionChange}
			/>
		</div>
		<div class="display-preference">
			<div class="display-copy">
				<strong>Notify when permission is required</strong>
				<small>Alert you when an agent is waiting for permission.</small>
			</div>
			<Switch
				checked={workspace.notifyOnPermission}
				label="Notify when permission is required"
				onchange={handlePermissionChange}
			/>
		</div>
		<div class="notification-actions">
			<button type="button" onclick={() => workspace.testCompletionSound()}>
				Test completion sound
			</button>
			<button type="button" onclick={() => workspace.testPermissionSound()}>
				Test permission sound
			</button>
		</div>
		<div class="system-notification-preference">
			<div class="display-preference">
				<div class="display-copy">
					<strong>Enable system notifications</strong>
					<small id="notification-permission-status" role="status" aria-live="polite">
						{notificationStatusText}
					</small>
				</div>
				<Switch
					checked={workspace.systemNotificationsEnabled}
					label="Enable system notifications"
					disabled={systemNotificationToggleDisabled}
					onchange={handleSystemNotificationsChange}
				/>
			</div>
			{#if workspace.notificationPermission === 'unsupported'}
				<p class="notification-help">System notifications are unavailable in this browser.</p>
			{:else if workspace.notificationPermission === 'denied'}
				<p class="notification-help">
					Notifications are blocked. Allow them in your browser or site settings, then return here.
				</p>
			{:else if workspace.notificationPermission !== 'granted'}
				<button type="button" onclick={requestSystemNotificationPermission}>
					Allow system notifications
				</button>
			{/if}
			<button
				type="button"
				disabled={systemTestDisabled}
				onclick={() => workspace.testSystemNotification()}
			>
				Test system notification
			</button>
		</div>
	</div>
</section>

<style>
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

	.settings-card {
		display: grid;
		width: min(100%, 38rem);
		gap: 1rem;
		margin: 0 auto;
	}

	.settings-card + .settings-card {
		padding-top: 2rem;
	}

	.settings-card h2 {
		margin: 0;
		font-size: 1.2rem;
	}

	.display-preferences {
		display: grid;
		gap: 1rem;
	}

	.application-update-preference {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.pi-update-status {
		max-height: 12rem;
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--surface-muted);
		color: var(--text-muted);
		padding: 0.75rem;
	}

	.pi-update-status pre {
		margin: 0;
		font:
			0.78rem/1.45 ui-monospace,
			SFMono-Regular,
			Menlo,
			Consolas,
			monospace;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.display-preference {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		color: var(--text);
	}

	.display-copy {
		display: grid;
		gap: 0.2rem;
		min-width: 0;
	}

	.display-copy small,
	.notification-help {
		color: var(--text-muted);
		font-size: 0.82rem;
	}

	.system-notification-preference {
		display: grid;
		gap: 0.75rem;
	}

	.notification-volume-control {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.notification-volume-control output {
		width: 2.8rem;
		color: var(--text-muted);
		font-size: 0.82rem;
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	.notification-volume-control :global(.notification-volume-slider) {
		position: relative;
		display: flex;
		align-items: center;
		width: 10rem;
		height: 1.5rem;
		touch-action: none;
		user-select: none;
	}

	.notification-volume-track {
		position: relative;
		width: 100%;
		height: 0.35rem;
		overflow: hidden;
		border-radius: 999px;
		background: var(--surface-strong);
	}

	.notification-volume-track :global(.notification-volume-range) {
		position: absolute;
		height: 100%;
		background: var(--accent);
	}

	.notification-volume-control :global(.notification-volume-thumb) {
		display: block;
		width: 1rem;
		height: 1rem;
		border: 2px solid var(--accent);
		border-radius: 50%;
		background: var(--surface);
		box-shadow: 0 1px 3px var(--shadow);
		cursor: pointer;
	}

	.notification-volume-control :global(.notification-volume-thumb:hover),
	.notification-volume-control :global(.notification-volume-thumb:focus-visible),
	.notification-volume-control :global(.notification-volume-thumb[data-active]) {
		border-color: var(--accent-strong);
		outline: none;
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
	}

	.notification-actions {
		display: flex;
		gap: 0.75rem;
	}

	.notification-actions button,
	.system-notification-preference button,
	.application-update-preference button {
		width: fit-content;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--surface-muted);
		color: var(--text);
		padding: 0.55rem 0.75rem;
	}

	.notification-actions button:hover,
	.system-notification-preference button:hover:not(:disabled),
	.application-update-preference button:hover:not(:disabled) {
		border-color: var(--accent);
	}

	.notification-actions button:disabled,
	.system-notification-preference button:disabled,
	.application-update-preference button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.notification-help {
		margin: 0;
	}

	@media (max-width: 520px) {
		.volume-preference {
			align-items: stretch;
			flex-direction: column;
		}

		.notification-volume-control {
			width: 100%;
		}

		.notification-volume-control :global(.notification-volume-slider) {
			flex: 1;
		}
	}
</style>

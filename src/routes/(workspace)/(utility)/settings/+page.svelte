<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import Selector from '$lib/components/Selector.svelte';
	import Switch from '$lib/components/Switch.svelte';
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

	function handleShowReasoningChange(checked: boolean): void {
		workspace.setShowReasoning(checked);
	}

	function handleShowModelChangesChange(checked: boolean): void {
		workspace.setShowModelChanges(checked);
	}

	function handleSoundsChange(checked: boolean): void {
		workspace.setSoundsEnabled(checked);
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

	.notification-actions {
		display: flex;
		gap: 0.75rem;
	}

	.notification-actions button,
	.system-notification-preference button {
		width: fit-content;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--surface-muted);
		color: var(--text);
		padding: 0.55rem 0.75rem;
	}

	.notification-actions button:hover,
	.system-notification-preference button:hover:not(:disabled) {
		border-color: var(--accent);
	}

	.notification-actions button:disabled,
	.system-notification-preference button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.notification-help {
		margin: 0;
	}
</style>

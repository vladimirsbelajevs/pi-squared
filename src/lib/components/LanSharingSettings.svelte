<script lang="ts">
	import { onMount } from 'svelte';
	import { getDesktopApi } from '$lib/desktop';
	import type {
		LanSharingBinding,
		LanSharingStatus,
		PiSquaredDesktopApi
	} from '$lib/desktop-contract';

	type LanApi = Required<
		Pick<
			PiSquaredDesktopApi,
			| 'getLanSharingStatus'
			| 'setLanSharingConfig'
			| 'onLanSharingStatus'
			| 'approveLanPairing'
			| 'createLanPairingCode'
			| 'rejectLanPairing'
			| 'revokeLanDevice'
			| 'exportLanCa'
			| 'resetLanTls'
		>
	>;
	let lanApi = $state<LanApi | undefined>();
	let status = $state<LanSharingStatus | undefined>();
	let config = $state<LanSharingStatus['config']>({
		enabled: false,
		port: 3049,
		bindings: [],
		dnsNames: []
	});
	let error = $state('');
	let notice = $state('');
	let saving = $state(false);
	let dnsInput = $state('');
	let pairingCode = $state<{ expiresAt: string } | undefined>();
	let initialized = $state(false);
	let draftDirty = $state(false);

	function updateStatus(next: LanSharingStatus): void {
		status = next;
		if (initialized && draftDirty) {
			return;
		}

		const suggested = next.available.find((address) => address.recommended);
		const bindings = next.config.bindings.length
			? next.config.bindings.map((binding) => ({ ...binding }))
			: !initialized && suggested
				? [
						{
							interfaceName: suggested.interfaceName,
							address: suggested.address,
							family: suggested.family
						}
					]
				: [];
		config = { ...next.config, bindings, dnsNames: [...next.config.dnsNames] };
		initialized = true;
		draftDirty = false;
	}

	function markDirty(): void {
		draftDirty = true;
	}

	function hasBinding(address: LanSharingStatus['available'][number]): boolean {
		return config.bindings.some(
			(binding) =>
				binding.interfaceName === address.interfaceName &&
				binding.address === address.address &&
				binding.family === address.family
		);
	}

	function toggleBinding(address: LanSharingStatus['available'][number]): void {
		if (hasBinding(address)) {
			config.bindings = config.bindings.filter(
				(binding) =>
					binding.interfaceName !== address.interfaceName ||
					binding.address !== address.address ||
					binding.family !== address.family
			);
		} else {
			const binding: LanSharingBinding = {
				interfaceName: address.interfaceName,
				address: address.address,
				family: address.family
			};
			config.bindings = [...config.bindings, binding];
		}

		markDirty();
	}

	async function save(): Promise<void> {
		if (!lanApi || saving) {
			return;
		}

		error = '';
		notice = '';
		if (
			config.enabled &&
			!status?.config.enabled &&
			!confirm('Enable HTTPS access on the selected addresses?')
		) {
			return;
		}

		saving = true;
		try {
			const enabled = config.enabled;
			updateStatus(await lanApi.setLanSharingConfig(config));
			draftDirty = false;
			notice = enabled ? 'LAN sharing is enabled.' : 'LAN sharing is disabled.';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			saving = false;
		}
	}

	function addDnsName(): void {
		const value = dnsInput.trim().toLowerCase().replace(/\.$/, '');
		if (!value || config.dnsNames.includes(value)) {
			return;
		}

		config.dnsNames = [...config.dnsNames, value];
		dnsInput = '';
		markDirty();
	}

	async function exportCa(): Promise<void> {
		if (!lanApi) {
			return;
		}

		try {
			const result = await lanApi.exportLanCa();
			notice = `CA exported to ${result.path}. Fingerprint: ${result.fingerprint}`;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}

	async function resetTls(): Promise<void> {
		if (!lanApi || !confirm('Reset the local CA and remove all paired devices?')) {
			return;
		}

		try {
			updateStatus(await lanApi.resetLanTls());
			notice = 'TLS and pairings were reset.';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}

	onMount(() => {
		const candidate = getDesktopApi();
		if (
			!candidate ||
			typeof candidate.getLanSharingStatus !== 'function' ||
			typeof candidate.setLanSharingConfig !== 'function' ||
			typeof candidate.onLanSharingStatus !== 'function' ||
			typeof candidate.approveLanPairing !== 'function' ||
			typeof candidate.createLanPairingCode !== 'function' ||
			typeof candidate.rejectLanPairing !== 'function' ||
			typeof candidate.revokeLanDevice !== 'function' ||
			typeof candidate.exportLanCa !== 'function' ||
			typeof candidate.resetLanTls !== 'function'
		) {
			return;
		}

		lanApi = candidate as LanApi;
		let active = true;
		void lanApi
			.getLanSharingStatus()
			.then((next) => active && updateStatus(next))
			.catch((cause: unknown) => {
				error = cause instanceof Error ? cause.message : String(cause);
			});
		const unsubscribe = lanApi.onLanSharingStatus((next) => active && updateStatus(next));

		return () => {
			active = false;
			unsubscribe();
		};
	});
</script>

{#if error && lanApi}
	<p class="error" role="alert">{error}</p>
{/if}
{#if lanApi && status}
	<section class="lan-sharing" aria-labelledby="lan-sharing-heading">
		<div class="section-heading">
			<div>
				<h2 id="lan-sharing-heading">LAN / VPN access</h2>
				<p>Opt-in HTTPS access for explicitly selected home-LAN or router-VPN addresses.</p>
			</div>
			<label class="enable-control">
				<input
					type="checkbox"
					checked={config.enabled}
					onchange={(event) => {
						config.enabled = (event.currentTarget as HTMLInputElement).checked;
						markDirty();
					}}
				/>
				Enable HTTPS access
			</label>
		</div>

		<div class="field-row">
			<label
				>Port <input
					type="number"
					min="1024"
					max="65535"
					value={config.port}
					oninput={(event) => {
						config.port = Number((event.currentTarget as HTMLInputElement).value);
						markDirty();
					}}
				/></label
			>
			<label class="dns-field"
				>Additional DNS name
				<span class="inline-input"
					><input
						bind:value={dnsInput}
						placeholder="pi-squared.home.arpa"
						onkeydown={(event) => event.key === 'Enter' && (event.preventDefault(), addDnsName())}
					/><button type="button" onclick={addDnsName}>Add</button></span
				>
			</label>
		</div>
		{#if config.dnsNames.length}
			<div class="chips">
				{#each config.dnsNames as name (name)}<button
						type="button"
						class="chip"
						onclick={() => {
							config.dnsNames = config.dnsNames.filter((item) => item !== name);
							markDirty();
						}}>{name} ×</button
					>{/each}
			</div>
		{/if}

		<h3>Explicit listener addresses</h3>
		<p class="hint">
			Select only addresses phones should reach. Virtual, public, link-local, and temporary
			addresses are never selected automatically. Prefer a DHCP reservation for the selected LAN
			address; Pi Squared does not configure your router, DNS, VPN, or firewall. Do not publicly
			forward this port.
		</p>
		<div class="address-list">
			{#each status.available as address (address.interfaceName + address.address + address.family)}
				<label class:chosen={hasBinding(address)} class="address-option">
					<input
						type="checkbox"
						checked={hasBinding(address)}
						onchange={() => toggleBinding(address)}
					/>
					<span
						><strong>{address.address}</strong><small
							>{address.interfaceName} · {address.family} · {address.label}{address.recommended
								? ' · suggested home LAN'
								: ''}</small
						></span
					>
				</label>
			{:else}<p class="hint">No concrete network addresses are currently available.</p>{/each}
		</div>
		<button
			type="button"
			class="primary"
			disabled={saving || (config.enabled && config.bindings.length === 0)}
			onclick={() => void save()}>{saving ? 'Applying…' : 'Apply LAN sharing settings'}</button
		>

		{#if status.listeners.length}
			<h3>Listener status</h3>
			<ul class="listener-list">
				{#each status.listeners as listener (listener.binding.interfaceName + listener.binding.address)}<li
					>
						<span>{listener.binding.address}</span><span class={listener.state}
							>{listener.state}{listener.error ? `: ${listener.error}` : ''}</span
						>
					</li>{/each}
			</ul>
		{/if}
		{#if status.urls.length}<h3>Phone URLs</h3>
			<ul class="url-list">
				{#each status.urls as url (url)}<li>
						<button
							type="button"
							class="url-link"
							onclick={() => window.open(url, '_blank', 'noopener,noreferrer')}>{url}</button
						>
					</li>{/each}
			</ul>{/if}

		<div class="certificate-panel">
			<h3>Local CA</h3>
			<p class="hint">
				Install the exported CA on each phone before opening an HTTPS URL. Pi Squared never installs
				trust automatically.
			</p>
			{#if status.caFingerprint}<code>{status.caFingerprint}</code>{/if}
			{#if status.caNotAfter}<p class="hint">CA expires {status.caNotAfter}.</p>{/if}
			{#if status.leafNotAfter}<p class="hint">
					Server certificate expires {status.leafNotAfter}.
				</p>{/if}
			{#if status.keyProtectionWarning}<p class="warning">{status.keyProtectionWarning}</p>{/if}
			<div class="actions">
				<button type="button" onclick={() => void exportCa()} disabled={!status.caFingerprint}
					>Export CA certificate</button
				><button type="button" onclick={() => void resetTls()}>Reset CA and pairings</button>
			</div>
		</div>

		<div class="devices-panel">
			<h3>Trusted devices</h3>
			<div class="pending">
				<span
					>Fallback one-use pairing code (shown in a desktop dialog; expires in five minutes)</span
				><button
					type="button"
					onclick={() =>
						lanApi &&
						void lanApi.createLanPairingCode('Phone').then((result) => (pairingCode = result))}
					>Generate code</button
				>
			</div>
			{#if pairingCode}<p class="pairing-code" aria-live="polite">
					Code displayed in the trusted desktop dialog · expires {pairingCode.expiresAt}
				</p>{/if}
			{#each status.pairing.pending.filter((item) => item.status === 'pending' && item.host !== 'code') as pending (pending.nonce)}
				<div class="pending">
					<span>{pending.deviceName} · {pending.host}</span><span class="actions"
						><button
							type="button"
							onclick={() => lanApi && void lanApi.approveLanPairing(pending.nonce)}>Approve</button
						><button
							type="button"
							onclick={() => lanApi && void lanApi.rejectLanPairing(pending.nonce)}>Reject</button
						></span
					>
				</div>
			{/each}
			{#each status.pairing.devices as device (device.id)}
				<div class="device">
					<span
						><strong>{device.deviceName}</strong><small
							>{device.host} · last seen {device.lastSeenAt} · expires {device.expiresAt}</small
						></span
					><button type="button" onclick={() => lanApi && void lanApi.revokeLanDevice(device.id)}
						>Revoke</button
					>
				</div>
			{:else}<p class="hint">No trusted devices.</p>{/each}
		</div>
		{#if notice}<p class="notice" role="status">
				{notice}
			</p>{/if}
	</section>
{/if}

<style>
	.lan-sharing {
		display: grid;
		gap: 1rem;
	}
	.section-heading,
	.field-row,
	.address-option,
	.device,
	.pending {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	h2,
	h3,
	p {
		margin: 0;
	}
	h3 {
		margin-top: 0.5rem;
		font-size: 1rem;
	}
	.section-heading p,
	.hint,
	small {
		color: var(--text-muted);
		font-size: 0.82rem;
	}
	.enable-control,
	label {
		display: grid;
		gap: 0.35rem;
	}
	.field-row {
		align-items: end;
		flex-wrap: wrap;
	}
	.field-row input {
		width: 9rem;
	}
	.dns-field {
		flex: 1;
		min-width: 16rem;
	}
	.inline-input {
		display: flex;
		gap: 0.4rem;
	}
	.inline-input input {
		flex: 1;
		width: auto;
	}
	.chips {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.chip {
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface-muted);
		color: var(--text);
		padding: 0.3rem 0.55rem;
	}
	.address-list,
	.listener-list,
	.url-list,
	.devices-panel {
		display: grid;
		gap: 0.5rem;
	}
	.address-option,
	.device,
	.pending {
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		padding: 0.65rem;
	}
	.address-option {
		justify-content: flex-start;
	}
	.address-option span,
	.device > span {
		display: grid;
		gap: 0.2rem;
	}
	.address-option.chosen {
		border-color: var(--accent);
	}
	.listener-list,
	.url-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.listener-list li {
		display: flex;
		justify-content: space-between;
	}
	.listener-list .error,
	.warning {
		color: var(--danger);
	}
	.listener-list .listening {
		color: var(--success, #3b8b5a);
	}
	.url-list .url-link {
		overflow-wrap: anywhere;
	}
	.certificate-panel {
		display: grid;
		gap: 0.6rem;
		border-top: 1px solid var(--border);
		padding-top: 1rem;
	}
	code {
		overflow-wrap: anywhere;
		font-size: 0.78rem;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	button {
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--surface-muted);
		color: var(--text);
		padding: 0.5rem 0.7rem;
	}
	button:hover:not(:disabled) {
		border-color: var(--accent);
	}
	button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}
	.primary {
		width: fit-content;
		background: var(--accent);
		color: var(--surface);
	}
	.device small {
		display: block;
	}
	.pairing-code {
		font-size: 1.3rem;
		letter-spacing: 0.12em;
	}
	.error {
		color: var(--danger);
	}
	.notice {
		color: var(--success, #3b8b5a);
	}
	@media (max-width: 520px) {
		.section-heading,
		.field-row {
			align-items: stretch;
			flex-direction: column;
		}
	}
</style>

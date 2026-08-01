<script lang="ts">
	import { resolve } from '$app/paths';
	import Selector from '$lib/components/Selector.svelte';
	import { workspace } from '$lib/harness/workspace.svelte';

	let query = $state('');
	let projectId = $state('');
	let sessions = $derived(
		workspace.sessions.filter((session) => {
			const needle = query.trim().toLowerCase();

			return (
				(!projectId || session.projectId === projectId) &&
				(!needle ||
					[session.name, session.firstMessage, session.projectName].some((value) =>
						value?.toLowerCase().includes(needle)
					))
			);
		})
	);

	function formatDate(value: string): string {
		return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
			new Date(value)
		);
	}
</script>

<h1 class="visually-hidden">Sessions</h1>

<div class="history-controls">
	<input
		class="input"
		bind:value={query}
		aria-label="Search historical sessions"
		placeholder="Search sessions"
	/>
	<Selector
		label="Filter sessions by project"
		value={projectId}
		options={[
			{ value: '', label: 'Any project' },
			...workspace.projects.map((project) => ({ value: project.id, label: project.name }))
		]}
		onChange={(value) => {
			projectId = value;
		}}
	/>
</div>

<div class="session-list">
	{#each sessions as session (`${session.projectId}:${session.sessionId}`)}
		<a
			class="session-card"
			href={resolve(
				`/chat/${encodeURIComponent(session.projectId)}/${encodeURIComponent(session.sessionId)}`
			)}
		>
			<strong>{session.name || session.firstMessage || 'Untitled session'}</strong>
			<span>{session.projectName} · {session.messageCount} messages</span>
			<time datetime={session.modifiedAt}>{formatDate(session.modifiedAt)}</time>
		</a>
	{:else}
		<div class="empty-list">No saved sessions match this view.</div>
	{/each}
</div>

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

	.history-controls {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 12rem;
		gap: 0.75rem;
		margin: 0 0 1rem;
	}

	.history-controls .input {
		height: 2.5rem;
	}

	.session-list {
		display: grid;
		gap: 0.6rem;
	}

	.session-card {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.25rem 1rem;
		border: 1px solid var(--border);
		border-radius: 0.45rem;
		background: var(--surface);
		color: var(--text);
		padding: 0.4rem;
		text-align: left;
		text-decoration: none;
	}

	.session-card:hover {
		border-color: var(--accent);
		transform: translateY(-1px);
	}

	.session-card strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.session-card span,
	.session-card time {
		color: var(--text-muted);
		font-size: 0.85rem;
	}

	.session-card time {
		grid-column: 2;
		grid-row: 1 / span 2;
		align-self: center;
		white-space: nowrap;
	}

	.empty-list {
		padding: 2rem 0;
		color: var(--text-muted);
	}

	@media (max-width: 700px) {
		.history-controls {
			grid-template-columns: 1fr;
		}

		.session-card {
			grid-template-columns: 1fr;
		}

		.session-card time {
			grid-column: 1;
			grid-row: auto;
		}
	}
</style>

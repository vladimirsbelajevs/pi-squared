<script lang="ts">
	import { workspace } from '$lib/harness/workspace.svelte';
	import { resolve } from '$app/paths';

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

<header class="section-heading">
	<p class="eyebrow">All projects</p>
	<h1>Historical sessions</h1>
	<p>Open any saved conversation in its own continuable chat tab.</p>
</header>

<div class="history-controls">
	<input bind:value={query} aria-label="Search historical sessions" placeholder="Search sessions" />
	<select bind:value={projectId} aria-label="Filter sessions by project">
		<option value="">All projects</option>
		{#each workspace.projects as project (project.id)}
			<option value={project.id}>{project.name}</option>
		{/each}
	</select>
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
	.section-heading {
		max-width: 54rem;
	}

	.section-heading h1 {
		margin: 0.2rem 0 0.55rem;
		font-size: clamp(2rem, 4vw, 3.2rem);
		line-height: 1.05;
		letter-spacing: -0.04em;
	}

	.section-heading p {
		margin: 0;
		color: var(--text-muted);
		line-height: 1.6;
	}

	.eyebrow {
		margin: 0 0 0.35rem;
		color: var(--accent);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.history-controls {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 12rem;
		gap: 0.75rem;
		max-width: 54rem;
		margin: 2rem 0 1rem;
	}

	.session-list {
		display: grid;
		max-width: 54rem;
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
		padding: 1rem;
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

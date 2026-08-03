<script lang="ts">
	import { onDestroy } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import {
		listProjectSlashCommands,
		listRuntimeSlashCommands,
		searchProjectFiles
	} from '$lib/harness/api';
	import type { ProjectFileSuggestion, SlashCommand } from '$lib/contracts';
	import {
		getChatAutocompleteToken,
		insertProjectFile,
		insertSlashCommand,
		rankSlashCommands,
		type ChatAutocompleteToken
	} from '../chat-autocomplete';

	type AutocompleteSuggestion =
		{ kind: 'command'; command: SlashCommand } | { kind: 'file'; file: ProjectFileSuggestion };
	type AutocompleteAria = { controls?: string; activeDescendant?: string };

	type Props = {
		inputId: string;
		projectId?: string;
		runtimeId?: string;
		onSelect: (selection: { value: string; caret: number }) => void;
		aria?: AutocompleteAria;
	};

	let {
		inputId,
		projectId,
		runtimeId,
		onSelect,
		aria = $bindable<AutocompleteAria>({})
	}: Props = $props();

	let draft = '';
	let caret = 0;
	let focused = $state(false);
	let composing = $state(false);
	let dismissedToken = $state<string>();
	let activeToken = $state<ChatAutocompleteToken>();
	let selectedIndex = $state(0);
	let commands = $state.raw<SlashCommand[]>([]);
	let loadedCommandKey = $state<string>();
	let loadingCommandKey = $state<string>();
	let fileSuggestions = $state.raw<ProjectFileSuggestion[]>([]);
	let loadedFileKey = $state<string>();
	let pendingFileKey = $state<string>();
	let loadedFileAt = $state<number>();
	let fileResultCache = $state.raw<
		SvelteMap<string, { files: ProjectFileSuggestion[]; loadedAt: number }>
	>(new SvelteMap());
	let commandController: AbortController | undefined;
	let fileController: AbortController | undefined;
	let fileDebounce: number | undefined;
	let fileGeneration = 0;
	const FILE_RESULT_TTL_MS = 30_000;
	const MAX_FILE_RESULT_CACHE_ENTRIES = 64;

	let listboxId = $derived(`${inputId}-autocomplete`);
	let suggestions = $derived.by((): AutocompleteSuggestion[] => {
		if (activeToken?.kind === 'command') {
			if (loadedCommandKey !== commandRequestKey()) {
				return [];
			}

			return rankSlashCommands(commands, activeToken.query).map((command) => ({
				kind: 'command',
				command
			}));
		}

		if (
			activeToken?.kind === 'file' &&
			(loadedFileKey === expectedFileRequestKey() || pendingFileKey === expectedFileRequestKey())
		) {
			return fileSuggestions.map((file) => ({ kind: 'file', file }));
		}

		return [];
	});
	let normalizedIndex = $derived(
		suggestions.length
			? ((selectedIndex % suggestions.length) + suggestions.length) % suggestions.length
			: 0
	);
	let activeSuggestion = $derived(suggestions[normalizedIndex]);
	let menuOpen = $derived(suggestions.length > 0);

	onDestroy(() => {
		commandController?.abort();
		cancelFileSearch();
	});

	function tokenKey(token: ChatAutocompleteToken): string {
		return `${token.kind}:${token.start}:${token.end}:${token.query}`;
	}

	function commandRequestKey(): string | undefined {
		if (runtimeId) {
			return `runtime:${runtimeId}`;
		}

		if (projectId) {
			return `project:${projectId}`;
		}

		return undefined;
	}

	function fileRequestKey(token: Extract<ChatAutocompleteToken, { kind: 'file' }>): string {
		return `${projectId}\u0000${token.query}`;
	}

	function expectedFileRequestKey(): string | undefined {
		return activeToken?.kind === 'file' && projectId ? fileRequestKey(activeToken) : undefined;
	}

	function optionId(index: number): string {
		return `${listboxId}-option-${index}`;
	}

	function updateAria(): void {
		const nextAria = menuOpen
			? { controls: listboxId, activeDescendant: optionId(normalizedIndex) }
			: {};
		if (
			aria.controls === nextAria.controls &&
			aria.activeDescendant === nextAria.activeDescendant
		) {
			return;
		}

		aria = nextAria;
	}

	function cancelFileSearch(): void {
		if (fileDebounce !== undefined) {
			window.clearTimeout(fileDebounce);
		}

		fileDebounce = undefined;
		fileController?.abort();
		fileController = undefined;
		pendingFileKey = undefined;
		fileGeneration += 1;
	}

	async function loadCommands(requestKey: string): Promise<void> {
		if (loadedCommandKey === requestKey || loadingCommandKey === requestKey) {
			return;
		}

		commandController?.abort();
		const controller = new AbortController();
		commandController = controller;
		loadingCommandKey = requestKey;
		try {
			const response = runtimeId
				? await listRuntimeSlashCommands(runtimeId, controller.signal)
				: projectId
					? await listProjectSlashCommands(projectId, controller.signal)
					: undefined;
			if (!response || controller.signal.aborted || requestKey !== commandRequestKey()) {
				return;
			}

			commands = response.commands;
			loadedCommandKey = requestKey;
			selectedIndex = 0;
			updateAria();
		} catch {
			// Autocomplete is optional; keep composing usable if suggestions cannot load.
		} finally {
			if (commandController === controller) {
				commandController = undefined;
			}

			if (loadingCommandKey === requestKey) {
				loadingCommandKey = undefined;
			}
		}
	}

	function rememberFileResult(
		requestKey: string,
		files: ProjectFileSuggestion[],
		loadedAt: number
	): void {
		const nextCache = new SvelteMap(fileResultCache);
		nextCache.delete(requestKey);
		nextCache.set(requestKey, { files, loadedAt });
		while (nextCache.size > MAX_FILE_RESULT_CACHE_ENTRIES) {
			const oldestKey = nextCache.keys().next().value;
			if (oldestKey === undefined) {
				break;
			}

			nextCache.delete(oldestKey);
		}

		fileResultCache = nextCache;
	}

	function queueFileSearch(token: Extract<ChatAutocompleteToken, { kind: 'file' }>): void {
		if (!projectId) {
			return;
		}

		const searchProjectId = projectId;
		const requestKey = fileRequestKey(token);
		if (pendingFileKey === requestKey) {
			return;
		}

		const cached = fileResultCache.get(requestKey);
		if (cached && Date.now() - cached.loadedAt < FILE_RESULT_TTL_MS) {
			cancelFileSearch();
			rememberFileResult(requestKey, cached.files, cached.loadedAt);
			fileSuggestions = cached.files;
			loadedFileKey = requestKey;
			loadedFileAt = cached.loadedAt;
			selectedIndex = 0;
			updateAria();

			return;
		}

		if (loadedFileKey === requestKey && loadedFileAt !== undefined) {
			if (Date.now() - loadedFileAt < FILE_RESULT_TTL_MS) {
				return;
			}
		}

		cancelFileSearch();
		const generation = fileGeneration;
		const controller = new AbortController();
		fileController = controller;
		pendingFileKey = requestKey;
		fileDebounce = window.setTimeout(async () => {
			fileDebounce = undefined;
			try {
				const response = await searchProjectFiles(searchProjectId, token.query, controller.signal);
				if (
					controller.signal.aborted ||
					generation !== fileGeneration ||
					requestKey !== expectedFileRequestKey()
				) {
					return;
				}

				const loadedAt = Date.now();
				rememberFileResult(requestKey, response.files, loadedAt);
				fileSuggestions = response.files;
				loadedFileKey = requestKey;
				loadedFileAt = loadedAt;
				selectedIndex = 0;
				updateAria();
			} catch {
				// File completion must never interfere with normal composition.
			} finally {
				if (fileController === controller) {
					fileController = undefined;
					pendingFileKey = undefined;
					updateAria();
				}
			}
		}, 180);
	}

	function synchronize(
		value: string,
		selectionStart: number,
		{
			resetDismissal = false,
			resetSelection = false
		}: { resetDismissal?: boolean; resetSelection?: boolean } = {}
	): void {
		draft = value;
		caret = selectionStart;
		if (resetDismissal) {
			dismissedToken = undefined;
		}

		const token =
			focused && !composing ? getChatAutocompleteToken(value, selectionStart) : undefined;
		const previousTokenKey = activeToken ? tokenKey(activeToken) : undefined;
		activeToken = token && tokenKey(token) !== dismissedToken ? token : undefined;
		if (resetSelection || previousTokenKey !== (activeToken ? tokenKey(activeToken) : undefined)) {
			selectedIndex = 0;
		}

		if (activeToken?.kind === 'file') {
			queueFileSearch(activeToken);
		} else {
			cancelFileSearch();
		}

		updateAria();
	}

	export function handleInput(value: string, selectionStart: number): void {
		const requestKey = commandRequestKey();
		if (requestKey) {
			void loadCommands(requestKey);
		}

		synchronize(value, selectionStart, { resetDismissal: true, resetSelection: true });
	}

	export function handleFocus(value: string, selectionStart: number): void {
		focused = true;
		const requestKey = commandRequestKey();
		if (requestKey) {
			void loadCommands(requestKey);
		}

		synchronize(value, selectionStart);
	}

	export function handleBlur(): void {
		focused = false;
		synchronize(draft, caret);
	}

	export function handleSelection(value: string, selectionStart: number): void {
		synchronize(value, selectionStart);
	}

	export function handleCompositionStart(): void {
		composing = true;
		synchronize(draft, caret);
	}

	export function handleCompositionEnd(value: string, selectionStart: number): void {
		composing = false;
		synchronize(value, selectionStart, { resetDismissal: true });
	}

	export function handleDraftReset(value: string, selectionStart: number): void {
		dismissedToken = undefined;
		selectedIndex = 0;
		synchronize(value, selectionStart);
	}

	export function handleKeydown(event: KeyboardEvent): boolean {
		if (event.isComposing || composing) {
			return false;
		}

		if (event.key === 'Escape' && activeToken) {
			dismissedToken = tokenKey(activeToken);
			activeToken = undefined;
			cancelFileSearch();
			updateAria();

			return true;
		}

		if (!menuOpen) {
			return false;
		}

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			selectedIndex = normalizedIndex + 1;
			updateAria();

			return true;
		}

		if (event.key === 'ArrowUp') {
			event.preventDefault();
			selectedIndex = normalizedIndex - 1;
			updateAria();

			return true;
		}

		if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
			event.preventDefault();
			if (activeSuggestion) {
				selectSuggestion(activeSuggestion);
			}

			return true;
		}

		return false;
	}

	function selectSuggestion(suggestion: AutocompleteSuggestion): void {
		const token = activeToken;
		if (!token) {
			return;
		}

		const insertion =
			suggestion.kind === 'command' && token.kind === 'command'
				? insertSlashCommand(draft, token, suggestion.command.name)
				: suggestion.kind === 'file' && token.kind === 'file'
					? insertProjectFile(draft, token, suggestion.file.path)
					: undefined;
		if (!insertion) {
			return;
		}

		selectedIndex = 0;
		draft = insertion.value;
		caret = insertion.caret;
		activeToken = undefined;
		cancelFileSearch();
		updateAria();
		onSelect(insertion);
	}
</script>

{#if menuOpen}
	<div
		id={listboxId}
		class="autocomplete-menu"
		role="listbox"
		aria-label="Autocomplete suggestions"
	>
		{#each suggestions as suggestion, index (suggestion.kind === 'command' ? suggestion.command.name : suggestion.file.path)}
			<button
				id={optionId(index)}
				type="button"
				role="option"
				tabindex={-1}
				class={['autocomplete-option', { selected: index === normalizedIndex }]}
				aria-selected={index === normalizedIndex}
				onmousedown={(event) => event.preventDefault()}
				onclick={() => selectSuggestion(suggestion)}
			>
				{#if suggestion.kind === 'command'}
					<span class="autocomplete-primary">/{suggestion.command.name}</span>
					{#if suggestion.command.description}
						<span class="autocomplete-description">{suggestion.command.description}</span>
					{/if}
				{:else}
					<span class="autocomplete-primary">@{suggestion.file.path}</span>
					<span class="autocomplete-description">Project file</span>
				{/if}
			</button>
		{/each}
	</div>
{/if}

<style>
	.autocomplete-menu {
		position: absolute;
		z-index: 3;
		bottom: calc(100% + 0.45rem);
		left: 0.2rem;
		display: grid;
		width: min(100% - 0.4rem, 34rem);
		max-height: min(15rem, 46vh);
		overflow-y: auto;
		border: 1px solid var(--border-strong);
		border-radius: 0.65rem;
		background: color-mix(in srgb, var(--surface) 96%, var(--canvas));
		padding: 0.25rem;
		box-shadow: 0 14px 30px var(--shadow);
	}

	.autocomplete-option {
		display: flex;
		align-items: baseline;
		min-width: 0;
		gap: 0.5rem;
		border: 0;
		border-radius: 0.42rem;
		background: transparent;
		color: var(--text);
		padding: 0.42rem 0.5rem;
		text-align: left;
		transition: background 120ms ease;
	}

	.autocomplete-option:hover,
	.autocomplete-option.selected {
		background: color-mix(in srgb, var(--accent) 15%, var(--surface-strong));
	}

	.autocomplete-option:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}

	.autocomplete-primary,
	.autocomplete-description {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.autocomplete-primary {
		flex: 0 1 auto;
		min-width: 0;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.78rem;
		font-weight: 600;
	}

	.autocomplete-description {
		min-width: 0;
		flex: 1 1 0;
		color: var(--text-muted);
		font-size: 0.68rem;
	}

	@media (max-width: 700px) {
		.autocomplete-menu {
			left: 0;
			width: 100%;
			max-height: min(13rem, 42vh);
		}

		.autocomplete-option {
			display: grid;
			gap: 0.1rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.autocomplete-option {
			transition: none;
		}
	}
</style>

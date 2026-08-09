import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { HistoricalSession, ModelOption, Project } from '$lib/contracts';
import type { HarnessWorkspace } from '$lib/harness/workspace.svelte';
import type { ChatTab, NewTab, WorkspaceTab } from '$lib/harness/types';
import WorkspaceCommandMenu from './WorkspaceCommandMenu.svelte';

const models: ModelOption[] = [
	{ provider: 'openai', id: 'gpt-test', name: 'GPT Test', reasoning: true },
	{ provider: 'example', id: 'plain-test', name: 'Plain Test', reasoning: false }
];

const sessions: HistoricalSession[] = [
	{
		projectId: 'project-1',
		projectName: 'Pi Project',
		sessionId: 'session-1',
		name: 'Refactor the parser',
		firstMessage: 'Please inspect the parser',
		createdAt: '2025-01-01T00:00:00.000Z',
		modifiedAt: '2025-01-01T00:00:00.000Z',
		messageCount: 2
	},
	{
		projectId: 'project-2',
		projectName: 'Other Project',
		sessionId: 'session-2',
		firstMessage: 'Review deployment settings',
		createdAt: '2025-01-02T00:00:00.000Z',
		modifiedAt: '2025-01-02T00:00:00.000Z',
		messageCount: 4
	}
];

function newTab(): NewTab {
	return {
		id: 'draft-1',
		kind: 'new',
		title: 'New chat',
		draft: {
			projectId: 'project-1',
			modelKey: 'openai::gpt-test',
			thinkingLevel: 'medium',
			prompt: ''
		},
		addingProject: false,
		projectPath: '',
		projectName: ''
	};
}

function chatTab(isStreaming = false): ChatTab {
	return {
		id: 'chat-1',
		kind: 'chat',
		title: 'Saved chat',
		projectId: 'project-1',
		sessionId: 'session-1',
		runtimeId: 'runtime-1',
		snapshot: {
			runtimeId: 'runtime-1',
			project: {} as Project,
			sessionId: 'session-1',
			model: models[0],
			thinkingLevel: 'medium',
			isStreaming,
			items: [],
			permissionRequests: []
		},
		hydrationState: 'ready',
		hydrationGeneration: 0,
		bufferedEvents: [],
		needsCheckpoint: false,
		draft: '',
		queueMode: 'followUp',
		streamText: '',
		streamRenderedText: '',
		streamThinking: '',
		streamTools: [],
		transientNotices: [],
		permissionRequests: [],
		pendingUserMessages: []
	};
}

function workspace(tabs: WorkspaceTab[] = [], overrides: Record<string, unknown> = {}) {
	return {
		models,
		sessions,
		tabs,
		hrefForTab: (tab: WorkspaceTab) =>
			tab.kind === 'new' ? `/new/${tab.id}` : `/chat/${tab.projectId}/${tab.sessionId}`,
		changeNewTabModel: vi.fn(),
		changeNewTabThinking: vi.fn(),
		changeModel: vi.fn(),
		changeThinking: vi.fn(),
		...overrides
	} as unknown as HarnessWorkspace;
}

function renderMenu(overrides: Record<string, unknown> = {}) {
	const state = workspace((overrides.tabs as WorkspaceTab[] | undefined) ?? []);

	return render(WorkspaceCommandMenu, {
		workspace: state,
		pathname: (overrides.pathname as string | undefined) ?? '/history',
		activeTab: overrides.activeTab as WorkspaceTab | undefined,
		onNew: vi.fn(),
		onClose: vi.fn(),
		onNavigate: vi.fn(),
		...overrides
	});
}

async function openMenu(): Promise<void> {
	window.dispatchEvent(
		new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true })
	);
	await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
}

describe('WorkspaceCommandMenu', () => {
	it('opens on Ctrl+Shift+P and runs the root workspace actions', async () => {
		const onNew = vi.fn();
		const onNavigate = vi.fn();
		const screen = renderMenu({ onNew, onNavigate });
		await openMenu();

		expect(document.activeElement?.getAttribute('data-command-input')).toBe('');
		await expect.element(screen.getByRole('option', { name: 'Start new chat' })).toBeVisible();
		expect(document.body.textContent).not.toContain('Close current tab');
		expect(document.body.textContent).not.toContain('Change model');

		await screen.getByRole('option', { name: 'Start new chat' }).click();
		expect(onNew).toHaveBeenCalledTimes(1);

		await openMenu();
		await screen.getByRole('option', { name: 'Go to history' }).click();
		expect(onNavigate).toHaveBeenCalledWith('/history');

		await openMenu();
		await screen.getByRole('option', { name: 'Go to settings' }).click();
		expect(onNavigate).toHaveBeenCalledWith('/settings');
	});

	it('shows contextual actions only for the active draft or saved chat', async () => {
		const tab = newTab();
		const screen = renderMenu({
			tabs: [tab],
			activeTab: tab,
			pathname: '/new/draft-1'
		});
		await openMenu();

		await expect.element(screen.getByRole('option', { name: 'Close current tab' })).toBeVisible();
		await expect.element(screen.getByRole('option', { name: 'Change model' })).toBeVisible();
		await expect
			.element(screen.getByRole('option', { name: 'Change thinking mode' }))
			.toBeVisible();
	});

	it('supports nested model and thinking pages, Back, and draft callbacks', async () => {
		const tab = newTab();
		const state = workspace([tab]);
		const onClose = vi.fn();
		const screen = render(WorkspaceCommandMenu, {
			workspace: state,
			pathname: '/new/draft-1',
			activeTab: tab,
			onNew: vi.fn(),
			onClose,
			onNavigate: vi.fn()
		});
		await openMenu();

		await expect.element(screen.getByRole('option', { name: 'Close current tab' })).toBeVisible();
		await screen.getByRole('option', { name: 'Change model' }).click();
		await expect.element(screen.getByRole('option', { name: 'Back', exact: true })).toBeVisible();
		await expect.element(screen.getByRole('option', { name: /GPT Test.*Current/ })).toBeVisible();
		await screen.getByRole('option', { name: 'Back', exact: true }).click();
		await expect.element(screen.getByRole('option', { name: 'Change model' })).toBeVisible();

		await screen.getByRole('option', { name: 'Change model' }).click();
		const input = screen.getByRole('combobox');
		await input.fill('');
		document
			.querySelector<HTMLInputElement>('[data-command-input]')
			?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
		await expect.element(screen.getByRole('option', { name: 'Start new chat' })).toBeVisible();

		await screen.getByRole('option', { name: 'Change model' }).click();
		await screen.getByRole('option', { name: /Plain Test/ }).click();
		expect(state.changeNewTabModel).toHaveBeenCalledWith(tab, 'example::plain-test');

		await openMenu();
		await screen.getByRole('option', { name: 'Change thinking mode' }).click();
		await expect.element(screen.getByRole('option', { name: /medium.*Current/ })).toBeVisible();
		await screen.getByRole('option', { name: 'high', exact: true }).click();
		expect(state.changeNewTabThinking).toHaveBeenCalledWith(tab, 'high');

		await openMenu();
		await screen.getByRole('option', { name: 'Close current tab' }).click();
		expect(onClose).toHaveBeenCalledWith(tab);
	});

	it('uses saved-chat model and thinking callbacks and marks current selections', async () => {
		const tab = chatTab();
		const state = workspace([tab]);
		const onClose = vi.fn();
		const screen = render(WorkspaceCommandMenu, {
			workspace: state,
			pathname: '/chat/project-1/session-1',
			activeTab: tab,
			onNew: vi.fn(),
			onClose,
			onNavigate: vi.fn()
		});
		await openMenu();

		await screen.getByRole('option', { name: 'Change model' }).click();
		await expect.element(screen.getByRole('option', { name: /GPT Test.*Current/ })).toBeVisible();
		await screen.getByRole('option', { name: /Plain Test/ }).click();
		expect(state.changeModel).toHaveBeenCalledWith(tab, 'example::plain-test');

		await openMenu();
		await screen.getByRole('option', { name: 'Change thinking mode' }).click();
		await expect.element(screen.getByRole('option', { name: /medium.*Current/ })).toBeVisible();
		await screen.getByRole('option', { name: 'high', exact: true }).click();
		expect(state.changeThinking).toHaveBeenCalledWith(tab, 'high');

		await openMenu();
		await screen.getByRole('option', { name: 'Close current tab' }).click();
		expect(onClose).toHaveBeenCalledWith(tab);
	});

	it('keeps root actions available while saved-chat model and thinking choices are disabled during streaming', async () => {
		const tab = chatTab(true);
		const onNavigate = vi.fn();
		const screen = renderMenu({
			tabs: [tab],
			activeTab: tab,
			pathname: '/chat/project-1/session-1',
			onNavigate
		});
		await openMenu();

		await expect.element(screen.getByRole('option', { name: 'Change model' })).toBeDisabled();
		await expect
			.element(screen.getByRole('option', { name: 'Change thinking mode' }))
			.toBeDisabled();
		await screen.getByRole('option', { name: 'Go to history' }).click();
		expect(onNavigate).toHaveBeenCalledWith('/history');
	});

	it('disables thinking mode for a selected non-reasoning model', async () => {
		const tab = newTab();
		tab.draft.modelKey = 'example::plain-test';
		const screen = renderMenu({
			tabs: [tab],
			activeTab: tab,
			pathname: '/new/draft-1'
		});
		await openMenu();

		await expect
			.element(screen.getByRole('option', { name: 'Change thinking mode' }))
			.toBeDisabled();
		await expect.element(screen.getByRole('option', { name: 'Change model' })).not.toBeDisabled();
	});

	it('searches saved sessions with @ keywords and navigates to the selected session', async () => {
		const onNavigate = vi.fn();
		const screen = renderMenu({ onNavigate });
		await openMenu();
		const input = screen.getByRole('combobox');

		await input.fill('@');
		await expect.element(screen.getByRole('option', { name: /Refactor the parser/ })).toBeVisible();
		await expect
			.element(screen.getByRole('option', { name: /Review deployment settings/ }))
			.toBeVisible();
		await input.fill('@deployment');
		await expect
			.element(screen.getByRole('option', { name: /Review deployment settings/ }))
			.toBeVisible();
		expect(document.body.textContent).not.toContain('Start new chat');

		await screen.getByRole('option', { name: /Review deployment settings/ }).click();
		expect(onNavigate).toHaveBeenCalledWith('/chat/project-2/session-2');
	});

	it('matches @ searches by session name, first message, and project name', async () => {
		const fieldSessions: HistoricalSession[] = [
			{
				...sessions[0],
				sessionId: 'name-session',
				name: 'NameOnly',
				firstMessage: 'ordinary opening',
				projectName: 'ordinary project'
			},
			{
				...sessions[0],
				sessionId: 'first-session',
				name: 'First session',
				firstMessage: 'FirstOnly',
				projectName: 'ordinary project'
			},
			{
				...sessions[0],
				sessionId: 'project-session',
				name: 'Another session',
				firstMessage: 'ordinary words',
				projectName: 'ProjectOnly'
			}
		];
		const state = workspace([], { sessions: fieldSessions });
		const screen = render(WorkspaceCommandMenu, {
			workspace: state,
			pathname: '/history',
			onNew: vi.fn(),
			onClose: vi.fn(),
			onNavigate: vi.fn()
		});
		await openMenu();
		const input = screen.getByRole('combobox');

		await input.fill('@NameOnly');
		await expect.element(screen.getByRole('option', { name: /NameOnly/ })).toBeVisible();
		await input.fill('@FirstOnly');
		await expect.element(screen.getByRole('option', { name: /First session/ })).toBeVisible();
		await input.fill('@ProjectOnly');
		await expect.element(screen.getByRole('option', { name: /Another session/ })).toBeVisible();
		expect(document.body.textContent).not.toContain('Start new chat');
	});

	it('shows an empty state when @ search has no saved-session matches', async () => {
		const state = workspace([], { sessions: [] });
		const screen = render(WorkspaceCommandMenu, {
			workspace: state,
			pathname: '/history',
			onNew: vi.fn(),
			onClose: vi.fn(),
			onNavigate: vi.fn()
		});
		await openMenu();
		await screen.getByRole('combobox').fill('@missing');

		await expect.element(screen.getByText('No saved sessions match this search.')).toBeVisible();
	});

	it('calls the close callback for a saved chat', async () => {
		const tab = chatTab();
		const onClose = vi.fn();
		const screen = renderMenu({
			tabs: [tab],
			activeTab: tab,
			pathname: '/chat/project-1/session-1',
			onClose
		});
		await openMenu();
		await screen.getByRole('option', { name: 'Close current tab' }).click();

		expect(onClose).toHaveBeenCalledWith(tab);
	});
});

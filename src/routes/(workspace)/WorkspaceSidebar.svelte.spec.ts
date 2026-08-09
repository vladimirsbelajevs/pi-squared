import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { HarnessWorkspace } from '$lib/harness/workspace.svelte';
import type { ChatTab, NewTab, WorkspaceTab } from '$lib/harness/types';
import WorkspaceSidebar from './WorkspaceSidebar.svelte';

function newTab(id: string, projectId = ''): NewTab {
	return {
		id,
		kind: 'new',
		title: 'New chat',
		draft: {
			projectId,
			modelKey: '',
			thinkingLevel: 'medium',
			prompt: ''
		},
		addingProject: false,
		projectPath: '',
		projectName: ''
	};
}

function chatTab(isStreaming: boolean, streamText = ''): ChatTab {
	return {
		id: 'chat-1',
		kind: 'chat',
		title: 'A chat with a long title that should remain truncated',
		projectId: 'project-1',
		sessionId: 'session-1',
		snapshot: { isStreaming } as ChatTab['snapshot'],
		hydrationState: 'ready',
		hydrationGeneration: 0,
		bufferedEvents: [],
		needsCheckpoint: false,
		draft: '',
		queueMode: 'followUp',
		streamText,
		streamRenderedText: '',
		streamThinking: '',
		streamTools: [],
		transientNotices: [],
		permissionRequests: [],
		pendingUserMessages: []
	};
}

function workspace(tabs: WorkspaceTab[]): HarnessWorkspace {
	return {
		tabs,
		projects: [],
		hrefForTab: (tab: WorkspaceTab) =>
			tab.kind === 'new' ? `/new/${tab.id}` : `/chat/${tab.projectId}/${tab.sessionId}`
	} as unknown as HarnessWorkspace;
}

function renderSidebar(tabs: WorkspaceTab[], pathname = '/history') {
	return render(WorkspaceSidebar, {
		workspace: workspace(tabs),
		pathname,
		open: true,
		collapsed: false,
		onNew: vi.fn(),
		onClose: vi.fn(),
		onCollapse: vi.fn(),
		onCloseDrawer: vi.fn()
	});
}

describe('WorkspaceSidebar', () => {
	it('connects the active workspace row, anchor, and split divider to the pathname', async () => {
		const screen = renderSidebar([chatTab(false)], '/chat/project-1/session-1');

		const row = screen.container.querySelector<HTMLElement>('.workspace-entry-wrap.active');
		const anchor = row?.querySelector<HTMLAnchorElement>('.workspace-entry.active');
		const divider = screen.container.querySelector('.sidebar-divider');

		expect(row).not.toBeNull();
		expect(anchor?.getAttribute('aria-current')).toBe('page');
		expect(anchor?.getAttribute('href')).toBe('/chat/project-1/session-1');
		expect(divider).not.toBeNull();
		expect(divider).toHaveClass('has-active-workspace');
		expect(divider?.querySelectorAll('.sidebar-divider-segment')).toHaveLength(2);
		expect(
			screen.container
				.querySelector<HTMLElement>('.workspace-sidebar')
				?.style.getPropertyValue('--sidebar-active-gap-top')
		).not.toBe('');
	});

	it('moves the active treatment when the pathname changes', async () => {
		const screen = renderSidebar([chatTab(false), newTab('draft')], '/chat/project-1/session-1');

		expect(screen.container.querySelectorAll('.workspace-entry-wrap.active')).toHaveLength(1);
		expect(
			screen.container
				.querySelector('.workspace-entry-wrap.active .workspace-entry')
				?.getAttribute('href')
		).toBe('/chat/project-1/session-1');

		await screen.rerender({ pathname: '/new/draft' });
		await expect.element(screen.getByRole('link', { name: 'New chat', exact: true })).toBeVisible();

		expect(screen.container.querySelectorAll('.workspace-entry-wrap.active')).toHaveLength(1);
		expect(
			screen.container
				.querySelector('.workspace-entry-wrap.active .workspace-entry')
				?.getAttribute('href')
		).toBe('/new/draft');
		expect(screen.container.querySelector('.sidebar-divider')).toHaveClass('has-active-workspace');
	});

	it('keeps an uninterrupted divider on utility routes', async () => {
		const screen = renderSidebar([chatTab(false)], '/history');
		const divider = screen.container.querySelector('.sidebar-divider');

		expect(screen.container.querySelector('.workspace-entry-wrap.active')).toBeNull();
		expect(divider).not.toHaveClass('has-active-workspace');
		const lowerSegment = divider?.querySelector<HTMLElement>('.sidebar-divider-lower');
		expect(lowerSegment).not.toBeNull();
		expect(getComputedStyle(lowerSegment!).display).toBe('none');
	});

	it('keeps the primary New chat plus while open New chat rows have no leading plus', async () => {
		const screen = renderSidebar([newTab('unassigned'), newTab('project-new', 'project-1')]);

		await expect
			.element(screen.getByRole('button', { name: 'New chat', exact: true }))
			.toBeVisible();
		expect(screen.container.querySelectorAll('.tab-plus')).toHaveLength(0);
		expect(screen.container.querySelectorAll('.workspace-entry .entry-title')).toHaveLength(2);
	});

	it('does not render an idle status icon for chat rows', async () => {
		const screen = renderSidebar([chatTab(false)]);

		await expect.element(screen.getByRole('link', { name: /A chat with/ })).toBeVisible();
		expect(screen.container.querySelector('.tab-status')).toBeNull();
	});

	it('keeps long chat titles truncated', async () => {
		const screen = renderSidebar([chatTab(false)]);

		await expect.element(screen.getByRole('link', { name: /A chat with/ })).toBeVisible();
		const title = screen.container.querySelector<HTMLElement>('.entry-title');
		expect(title).not.toBeNull();
		const styles = getComputedStyle(title!);
		expect(styles.overflow).toBe('hidden');
		expect(styles.textOverflow).toBe('ellipsis');
		expect(styles.whiteSpace).toBe('nowrap');
	});

	it('keeps the working spinner and close control in the trailing area while streaming', async () => {
		const screen = renderSidebar([chatTab(true)]);

		const spinner = screen.getByRole('img', { name: 'Working' });
		await expect.element(spinner).toBeVisible();
		const row = screen.container.querySelector('.workspace-entry-wrap')!;
		const workingIndicator = row.querySelector<HTMLElement>('.entry-working');
		expect(workingIndicator).not.toBeNull();
		expect(getComputedStyle(workingIndicator!).alignSelf).toBe('center');
		expect(row.querySelector('.entry-close')).not.toBeNull();
		expect(row.querySelector('.entry-working')?.nextElementSibling).toBe(
			row.querySelector('.entry-close')
		);
	});

	it('keeps the sidebar spinner through response streaming and removes it after the turn finishes', async () => {
		const screen = renderSidebar([chatTab(true, 'Assistant response in progress')]);
		await expect.element(screen.getByRole('img', { name: 'Working' })).toBeVisible();

		await screen.rerender({ workspace: workspace([chatTab(false)]) });
		expect(screen.container.querySelector('.pi-working-spinner')).toBeNull();
		expect(screen.container.querySelector('.entry-close')).not.toBeNull();
	});
});

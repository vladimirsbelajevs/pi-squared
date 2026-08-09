import { expect, test } from '@playwright/test';

test('opens a new tab from a fresh workspace', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/new\/[^/]+$/);

	await expect(page.locator('.tab-strip')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'New chat', exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: 'History', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Pi²' })).toBeVisible();
	await expect(page.getByRole('textbox', { name: 'Message Pi' })).toBeVisible();
	await expect(page.getByRole('button', { name: /^Model/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /^Reasoning/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /^Project/ })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Add project' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Start chat' })).toHaveCount(0);
	await expect(page.getByText('MCP: No servers configured')).toHaveCount(0);

	await page.getByRole('button', { name: 'New chat', exact: true }).click();
	await expect(page).toHaveURL(/\/new\/[^/]+$/);
	await expect(
		page.locator('#workspace-sidebar').getByRole('link', { name: 'New chat', exact: true }).last()
	).toHaveAttribute('aria-current', 'page');

	await page.getByRole('link', { name: 'History', exact: true }).click();
	await expect(page).toHaveURL(/\/history$/);
	await expect(page.getByRole('textbox', { name: 'Search historical sessions' })).toBeVisible();
	await page.getByRole('link', { name: 'Settings', exact: true }).click();
	await expect(page).toHaveURL(/\/settings$/);
	await expect(page.getByRole('heading', { name: 'Theme' })).toBeVisible();
	for (const [label, theme] of [
		['Tokyo Night', 'tokyonight-night'],
		['Tokyo Storm', 'tokyonight-storm'],
		['Tokyo Moon', 'tokyonight-moon'],
		['Tokyo Day', 'tokyonight-day']
	] as const) {
		await page.getByRole('button', { name: label }).click();
		await expect
			.poll(() => page.evaluate(() => document.documentElement.dataset.theme))
			.toBe(theme);
	}

	await page.reload();
	await expect
		.poll(() => page.evaluate(() => document.documentElement.dataset.theme))
		.toBe('tokyonight-day');
});

test('collapses and reopens the desktop sidebar', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.addInitScript(() => localStorage.clear());
	await page.goto('/new/desktop-draft');

	const main = page.locator('.harness-shell');
	const sidebar = page.locator('#workspace-sidebar');
	const collapseButton = page.getByRole('button', { name: 'Collapse sidebar', exact: true });
	const menuButton = page.getByRole('button', { name: 'Open navigation menu', exact: true });
	await expect(sidebar).toBeVisible();
	await expect(sidebar).not.toHaveAttribute('inert', '');
	await expect(collapseButton).toBeVisible();
	await expect(menuButton).toBeHidden();
	const expandedContentBox = await page.locator('.workspace-content').boundingBox();

	await collapseButton.click();
	await expect(sidebar).toBeHidden();
	await expect(sidebar).toHaveAttribute('aria-hidden', 'true');
	await expect(sidebar).toHaveAttribute('inert', '');
	await expect(main).toHaveClass(/sidebar-collapsed/);
	await expect(menuButton).toBeVisible();
	await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
	await expect
		.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.ariaLabel))
		.toBe('Open navigation menu');
	const collapsedContentBox = await page.locator('.workspace-content').boundingBox();
	expect(collapsedContentBox?.width).toBeGreaterThan(expandedContentBox?.width ?? 0);

	await menuButton.click();
	await expect(sidebar).toBeVisible();
	await expect(sidebar).not.toHaveAttribute('inert', '');
	await expect(menuButton).toBeHidden();
	await expect(collapseButton).toBeFocused();
});

test('preserves focus when crossing the responsive sidebar breakpoint', async ({ page }) => {
	await page.setViewportSize({ width: 900, height: 800 });
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.addInitScript(() => localStorage.clear());
	await page.goto('/new/responsive-focus');

	const sidebar = page.locator('#workspace-sidebar');
	const collapseButton = page.getByRole('button', { name: 'Collapse sidebar', exact: true });
	const closeButton = page.getByRole('button', { name: 'Close navigation menu', exact: true });
	const menuButton = page.getByRole('button', { name: 'Open navigation menu', exact: true });
	await expect(collapseButton).toBeVisible();
	await expect
		.poll(() =>
			page
				.locator('.harness-shell')
				.evaluate((element) => getComputedStyle(element).transitionDuration)
		)
		.toBe('0s');

	await collapseButton.focus();
	await expect(collapseButton).toBeFocused();
	await page.setViewportSize({ width: 600, height: 800 });
	await expect(menuButton).toBeVisible();
	await expect(sidebar).toHaveAttribute('inert', '');
	await expect(menuButton).toBeFocused();
	await expect
		.poll(() => sidebar.evaluate((element) => getComputedStyle(element).transitionDuration))
		.toBe('0s');

	await menuButton.click();
	await expect(closeButton).toBeFocused();
	await page.setViewportSize({ width: 900, height: 800 });
	await expect(collapseButton).toBeVisible();
	await expect(sidebar).not.toHaveAttribute('inert', '');
	await expect(collapseButton).toBeFocused();

	const messageBox = page.getByRole('textbox', { name: 'Message Pi' });
	await messageBox.focus();
	await expect(messageBox).toBeFocused();
	await page.setViewportSize({ width: 600, height: 800 });
	await expect(messageBox).toBeFocused();
	await page.setViewportSize({ width: 900, height: 800 });
	await expect(messageBox).toBeFocused();
});

test('groups open entries by project and keeps unassigned drafts first', async ({ page }) => {
	const projects = [
		{
			id: 'project-alpha',
			name: 'Alpha project',
			cwd: '/tmp/alpha',
			addedAt: '2026-01-01T00:00:00.000Z',
			lastOpenedAt: '2026-01-01T00:00:00.000Z'
		},
		{
			id: 'project-beta',
			name: 'Beta project',
			cwd: '/tmp/beta',
			addedAt: '2026-01-01T00:00:00.000Z',
			lastOpenedAt: '2026-01-01T00:00:00.000Z'
		}
	];

	await page.addInitScript(() => {
		localStorage.setItem(
			'pi-squared:workspace:v1',
			JSON.stringify({
				version: 1,
				activeTabId: 'unassigned-draft',
				tabs: [
					{
						kind: 'new',
						id: 'unassigned-draft',
						title: 'Unassigned draft',
						draft: { projectId: '', modelKey: '', thinkingLevel: 'medium', prompt: '' }
					},
					{
						kind: 'new',
						id: 'alpha-draft-one',
						title: 'Alpha draft one',
						draft: {
							projectId: 'project-alpha',
							modelKey: '',
							thinkingLevel: 'medium',
							prompt: ''
						}
					},
					{
						kind: 'new',
						id: 'unknown-draft',
						title: 'Unknown project draft',
						draft: {
							projectId: 'project-missing',
							modelKey: '',
							thinkingLevel: 'medium',
							prompt: ''
						}
					},
					{
						kind: 'new',
						id: 'alpha-draft-two',
						title: 'Alpha draft two',
						draft: {
							projectId: 'project-alpha',
							modelKey: '',
							thinkingLevel: 'medium',
							prompt: ''
						}
					},
					{
						kind: 'chat',
						id: 'beta-chat',
						title: 'Beta chat',
						projectId: 'project-beta',
						sessionId: 'beta-session',
						runtimeId: 'runtime-beta',
						draft: '',
						queueMode: 'followUp'
					}
				]
			})
		);
	});
	await page.route('**/api/projects', (route) => route.fulfill({ json: { projects } }));
	await page.route('**/api/models', (route) => route.fulfill({ json: { models: [] } }));
	await page.route('**/api/sessions', (route) => route.fulfill({ json: { sessions: [] } }));
	await page.route('**/api/runtimes/runtime-beta', (route) =>
		route.fulfill({
			json: {
				checkpoint: {
					protocolVersion: 2,
					cursor: { epoch: 'test', sequence: 1 },
					revision: 1,
					snapshot: {
						runtimeId: 'runtime-beta',
						project: projects[1],
						sessionId: 'beta-session',
						sessionName: 'Beta chat',
						model: { provider: 'test', id: 'model', name: 'Test model', reasoning: true },
						thinkingLevel: 'medium',
						isStreaming: true,
						permissionRequests: [],
						items: []
					},
					live: { text: 'Streaming now', thinking: '', tools: [] }
				}
			}
		})
	);

	await page.goto('/new/unassigned-draft');
	const sidebar = page.locator('#workspace-sidebar');
	const entries = sidebar.getByRole('navigation', { name: 'Open workspace entries' });
	await expect(sidebar.getByRole('heading', { name: 'Alpha project', exact: true })).toBeVisible();
	await expect(sidebar.getByRole('heading', { name: 'Beta project', exact: true })).toBeVisible();
	await expect(
		sidebar.getByRole('heading', { name: 'project-missing', exact: true })
	).toBeVisible();
	await expect(entries.getByRole('heading')).toHaveText([
		'Alpha project',
		'project-missing',
		'Beta project'
	]);
	await expect(sidebar.getByRole('heading', { name: 'Unassigned draft', exact: true })).toHaveCount(
		0
	);
	await expect(entries.getByRole('link')).toHaveCount(5);
	await expect(entries.getByRole('link').nth(0)).toContainText('Unassigned draft');
	const alphaEntries = sidebar
		.getByRole('heading', { name: 'Alpha project', exact: true })
		.locator('..')
		.getByRole('link');
	await expect(alphaEntries).toHaveCount(2);
	await expect(alphaEntries.nth(0)).toContainText('Alpha draft one');
	await expect(alphaEntries.nth(1)).toContainText('Alpha draft two');
	await expect(
		sidebar
			.getByRole('heading', { name: 'project-missing', exact: true })
			.locator('..')
			.getByRole('link')
	).toContainText('Unknown project draft');

	await entries.getByRole('link', { name: 'Beta chat' }).click();
	await expect(page).toHaveURL(/\/chat\/project-beta\/beta-session$/);
	await expect(entries.getByRole('link', { name: /Beta chat/ })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(entries.getByRole('img', { name: 'Streaming' })).toBeVisible();
});

test('opens and closes the responsive sidebar drawer', async ({ page }) => {
	await page.setViewportSize({ width: 600, height: 800 });
	await page.addInitScript(() => localStorage.clear());
	await page.goto('/new/mobile-draft');

	const menuButton = page.getByRole('button', { name: 'Open navigation menu', exact: true });
	const sidebar = page.locator('#workspace-sidebar');
	const backdrop = page.locator('.sidebar-backdrop');
	await expect(menuButton).toBeVisible();
	await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
	await expect(sidebar).toBeHidden();
	await expect(sidebar).toHaveAttribute('inert', '');
	await expect(backdrop).toHaveAttribute('tabindex', '-1');
	const closedContentBox = await page.locator('.workspace-content').boundingBox();

	await menuButton.click();
	await expect(sidebar).toBeVisible();
	const closeButton = page.getByRole('button', { name: 'Close navigation menu' });
	await expect(closeButton).toBeVisible();
	await expect(sidebar).not.toHaveAttribute('inert', '');
	await expect(backdrop).toHaveAttribute('tabindex', '0');
	await expect
		.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.ariaLabel))
		.toBe('Close navigation menu');
	const openContentBox = await page.locator('.workspace-content').boundingBox();
	expect(openContentBox?.width).toBe(closedContentBox?.width);

	await backdrop.click();
	await expect(sidebar).toBeHidden();
	await expect
		.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.ariaLabel))
		.toBe('Open navigation menu');
	await menuButton.click();
	await page.keyboard.press('Escape');
	await expect(sidebar).toBeHidden();
	await expect
		.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.ariaLabel))
		.toBe('Open navigation menu');
	await menuButton.click();
	await closeButton.click();
	await expect(sidebar).toBeHidden();
	await expect
		.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.ariaLabel))
		.toBe('Open navigation menu');

	await menuButton.click();
	await page.getByRole('link', { name: 'Settings', exact: true }).click();
	await expect(page).toHaveURL(/\/settings$/);
	await expect(sidebar).toBeHidden();
	await expect
		.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.ariaLabel))
		.not.toBe('Open navigation menu');

	await page.goBack();
	await expect(page).toHaveURL(/\/new\/mobile-draft$/);
	await expect(sidebar).toBeHidden();

	await menuButton.click();
	await page.getByRole('button', { name: 'New chat', exact: true }).click();
	await expect(page).toHaveURL(/\/new\/[^/]+$/);
	await expect(sidebar).toBeHidden();
});

test('restores the saved active tab from root', async ({ page }) => {
	await page.addInitScript(() => {
		localStorage.setItem(
			'pi-squared:workspace:v1',
			JSON.stringify({
				version: 1,
				activeTabId: 'saved-tab',
				tabs: [
					{
						kind: 'new',
						id: 'saved-tab',
						title: 'New chat',
						draft: {
							projectId: '',
							modelKey: '',
							thinkingLevel: 'medium',
							prompt: 'Saved draft'
						}
					}
				]
			})
		);
	});

	await page.goto('/');

	await expect(page).toHaveURL(/\/new\/saved-tab$/);
	await expect(page.getByRole('heading', { name: 'Pi²' })).toBeVisible();
});

test('falls back to history when the saved active tab is invalid', async ({ page }) => {
	await page.addInitScript(() => {
		localStorage.setItem(
			'pi-squared:workspace:v1',
			JSON.stringify({
				version: 1,
				activeTabId: 'missing-tab',
				tabs: [
					{
						kind: 'new',
						id: 'saved-tab',
						title: 'New chat',
						draft: { projectId: '', modelKey: '', thinkingLevel: 'medium', prompt: '' }
					}
				]
			})
		);
	});

	await page.goto('/');

	await expect(page).toHaveURL(/\/history$/);
});

test('persists the selected tab and restores it from root', async ({ page }) => {
	await page.goto('/history');
	await page.getByRole('button', { name: 'New chat' }).click();
	await expect(page).toHaveURL(/\/new\/.+$/);
	const href = new URL(page.url()).pathname;
	const activeTabId = href.split('/').at(-1);

	await expect
		.poll(() =>
			page.evaluate(
				() =>
					JSON.parse(localStorage.getItem('pi-squared:workspace:v1') ?? '{}').activeTabId as
						string | undefined
			)
		)
		.toBe(activeTabId);

	await page.goto('/settings');
	await expect(page).toHaveURL(/\/settings$/);
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					JSON.parse(localStorage.getItem('pi-squared:workspace:v1') ?? '{}').activeTabId as
						string | undefined
			)
		)
		.toBe(activeTabId);

	await page.goto('/');
	await expect(page).toHaveURL(new RegExp(`${href}$`));
});

test('restores a deep-linked new-chat draft route', async ({ page }) => {
	await page.goto('/new/routed-draft');

	await expect(page).toHaveURL(/\/new\/routed-draft$/);
	await expect(page.getByRole('link', { name: 'New chat' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Pi²' })).toBeVisible();
});

test('persists the model reasoning display preference', async ({ page }) => {
	await page.goto('/settings');

	const showReasoning = page.getByRole('switch', { name: 'Show model reasoning' });
	await expect(showReasoning).not.toBeChecked();
	await showReasoning.check();
	await expect(showReasoning).toBeChecked();
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('pi-squared:show-reasoning')))
		.toBe('true');

	await page.reload();
	await expect(showReasoning).toBeChecked();
});

test('persists the model-change display preference', async ({ page }) => {
	await page.goto('/settings');

	const displayModelChanges = page.getByRole('switch', {
		name: 'Display model changes in chat'
	});
	await expect(displayModelChanges).not.toBeChecked();
	await displayModelChanges.check();
	await expect(displayModelChanges).toBeChecked();
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('pi-squared:show-model-changes')))
		.toBe('true');

	await page.reload();
	await expect(displayModelChanges).toBeChecked();
});

test('opens a historical session without reselecting its tab', async ({ page }) => {
	const project = {
		id: 'project-1',
		name: 'Test project',
		cwd: '/tmp/test-project',
		addedAt: '2026-01-01T00:00:00.000Z',
		lastOpenedAt: '2026-01-01T00:00:00.000Z'
	};
	const model = { provider: 'test', id: 'model-1', name: 'Test model', reasoning: true };
	const session = {
		projectId: project.id,
		projectName: project.name,
		sessionId: 'session-1',
		name: 'Historical chat',
		firstMessage: 'Inspect this project',
		createdAt: '2026-01-01T00:00:00.000Z',
		modifiedAt: '2026-01-01T01:00:00.000Z',
		messageCount: 2
	};
	const snapshot = {
		runtimeId: 'runtime-1',
		project,
		sessionId: session.sessionId,
		sessionName: session.name,
		model,
		thinkingLevel: 'medium',
		isStreaming: false,
		permissionRequests: [],
		items: [
			{ id: 'user-1', kind: 'message', role: 'user', text: session.firstMessage },
			{
				id: 'assistant-1',
				kind: 'message',
				role: 'assistant',
				text: 'Project summary',
				thinking: 'I inspected the project history.'
			}
		]
	};

	await page.addInitScript(() => localStorage.clear());
	await page.route('**/api/projects', (route) => route.fulfill({ json: { projects: [project] } }));
	await page.route('**/api/models', (route) => route.fulfill({ json: { models: [model] } }));
	await page.route('**/api/sessions', (route) => route.fulfill({ json: { sessions: [session] } }));
	await page.route('**/api/runtimes', async (route) => {
		if (route.request().method() !== 'POST') {
			return route.fallback();
		}

		await route.fulfill({
			json: {
				checkpoint: {
					protocolVersion: 2,
					cursor: { epoch: 'test', sequence: 0 },
					revision: 0,
					snapshot,
					live: { text: '', thinking: '', tools: [] }
				}
			}
		});
	});

	await page.goto('/history');
	await page.getByRole('link', { name: /Historical chat/ }).click();

	await expect(page).toHaveURL(/\/chat\/project-1\/session-1$/);
	await expect(page.getByText('Project summary')).toBeVisible();
	await expect(page.getByText('I inspected the project history.')).toHaveCount(0);
	await expect(page.getByText('Opening session…')).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Historical chat' })).toHaveAttribute(
		'aria-current',
		'page'
	);

	await page.getByRole('link', { name: 'History', exact: true }).click();
	await page.getByRole('link', { name: 'Settings', exact: true }).click();
	await page.getByRole('switch', { name: 'Show model reasoning' }).check();
	await page.getByRole('link', { name: 'Historical chat' }).click();
	await page
		.getByRole('group', { name: 'assistant message' })
		.getByText('Reasoning', { exact: true })
		.click();
	await expect(page.getByText('I inspected the project history.')).toBeVisible();
});

test('closes inactive entries and falls back to the next active entry', async ({ page }) => {
	await page.addInitScript(() => {
		localStorage.setItem(
			'pi-squared:workspace:v1',
			JSON.stringify({
				version: 1,
				activeTabId: 'active-tab',
				tabs: [
					{
						kind: 'new',
						id: 'active-tab',
						title: 'Active draft',
						draft: { projectId: '', modelKey: '', thinkingLevel: 'medium', prompt: '' }
					},
					{
						kind: 'new',
						id: 'inactive-tab',
						title: 'Inactive draft',
						draft: { projectId: '', modelKey: '', thinkingLevel: 'medium', prompt: '' }
					},
					{
						kind: 'new',
						id: 'fallback-tab',
						title: 'Fallback draft',
						draft: { projectId: '', modelKey: '', thinkingLevel: 'medium', prompt: '' }
					}
				]
			})
		);
	});

	await page.goto('/new/active-tab');
	const sidebar = page.locator('#workspace-sidebar');
	await expect(sidebar.getByRole('link', { name: 'Active draft', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await sidebar.getByRole('button', { name: 'Close Inactive draft', exact: true }).click();
	await expect(sidebar.getByRole('link', { name: 'Inactive draft', exact: true })).toHaveCount(0);
	await expect(page).toHaveURL(/\/new\/active-tab$/);
	await expect(sidebar.getByRole('link', { name: 'Fallback draft', exact: true })).toBeVisible();

	await sidebar.getByRole('button', { name: 'Close Active draft', exact: true }).click();
	await expect(page).toHaveURL(/\/new\/fallback-tab$/);
	await expect(sidebar.getByRole('link', { name: 'Active draft', exact: true })).toHaveCount(0);
	await expect(sidebar.getByRole('link', { name: 'Fallback draft', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
});

test('closes an active tab without reopening it', async ({ page }) => {
	await page.goto('/history');
	await page.getByRole('button', { name: 'New chat' }).click();

	const closeButton = page.getByRole('button', { name: 'Close New chat' });
	await closeButton.click();

	await expect(page).toHaveURL(/\/history$/);
	await expect(closeButton).toHaveCount(0);
});

test('starting a chat does not recreate its draft tab', async ({ page }) => {
	const project = {
		id: 'project-1',
		name: 'Test project',
		cwd: '/tmp/test-project',
		addedAt: '2026-01-01T00:00:00.000Z',
		lastOpenedAt: '2026-01-01T00:00:00.000Z'
	};
	const model = { provider: 'test', id: 'model-1', name: 'Test model', reasoning: true };
	const snapshot = {
		runtimeId: 'runtime-1',
		project,
		sessionId: 'session-1',
		model,
		thinkingLevel: 'medium',
		isStreaming: false,
		permissionRequests: [],
		items: []
	};

	await page.addInitScript(() => localStorage.clear());
	await page.route('**/api/projects', async (route) => {
		if (route.request().method() !== 'GET') {
			return route.fallback();
		}

		await route.fulfill({ json: { projects: [project] } });
	});
	await page.route('**/api/models', (route) => route.fulfill({ json: { models: [model] } }));
	await page.route('**/api/sessions', (route) => route.fulfill({ json: { sessions: [] } }));
	await page.route('**/api/runtimes', async (route) => {
		if (route.request().method() !== 'POST') {
			return route.fallback();
		}

		await route.fulfill({
			json: {
				checkpoint: {
					protocolVersion: 2,
					cursor: { epoch: 'test', sequence: 0 },
					revision: 0,
					snapshot,
					live: { text: '', thinking: '', tools: [] }
				}
			}
		});
	});
	await page.route('**/api/runtimes/runtime-1/prompt', (route) =>
		route.fulfill({ json: { queued: true, userMessageText: 'Start this chat' } })
	);

	await page.goto('/new/draft-tab');
	const message = page.getByRole('textbox', { name: 'Message Pi' });
	await message.fill('Start this chat');
	await message.press('Enter');

	await expect(page).toHaveURL(/\/chat\/project-1\/session-1$/);
	await expect(page.getByText('Start this chat')).toBeVisible();
	await expect(page.getByText('MCP: No servers configured')).toBeVisible();
	await expect(page.getByRole('link', { name: 'New chat' })).toHaveCount(1);
});

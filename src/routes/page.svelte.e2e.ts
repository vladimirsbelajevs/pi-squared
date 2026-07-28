import { expect, test } from '@playwright/test';

test('renders the tab-first harness shell', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/history$/);

	await expect(
		page.getByRole('tab', { name: 'Historical sessions and harness settings' })
	).toBeVisible();
	await expect(page.getByRole('textbox', { name: 'Search historical sessions' })).toBeVisible();
	await page.getByRole('button', { name: 'New chat tab' }).click();
	await expect(page).toHaveURL(/\/new\/.+$/);
	await expect(page.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible();
	await expect(page.getByRole('textbox', { name: 'Message Pi' })).toBeVisible();
	await expect(page.getByRole('combobox', { name: 'Model' })).toBeVisible();
	await expect(page.getByRole('combobox', { name: 'Reasoning' })).toBeVisible();
	await expect(page.getByRole('combobox', { name: 'Project' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Add project' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Start chat' })).toHaveCount(0);

	await page.getByRole('tab', { name: 'Historical sessions and harness settings' }).click();
	await expect(page).toHaveURL(/\/history$/);
	await page.getByRole('link', { name: 'Settings' }).click();
	await expect(page).toHaveURL(/\/settings$/);
	await expect(page.getByRole('heading', { name: 'Theme' })).toBeVisible();
});

test('restores a deep-linked new-chat draft route', async ({ page }) => {
	await page.goto('/new/routed-draft');

	await expect(page).toHaveURL(/\/new\/routed-draft$/);
	await expect(page.getByRole('tab', { name: 'New chat' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible();
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
		items: [
			{ id: 'user-1', kind: 'message', role: 'user', text: session.firstMessage },
			{ id: 'assistant-1', kind: 'message', role: 'assistant', text: 'Project summary' }
		]
	};

	await page.addInitScript(() => localStorage.clear());
	await page.route('**/api/projects', (route) => route.fulfill({ json: { projects: [project] } }));
	await page.route('**/api/models', (route) => route.fulfill({ json: { models: [model] } }));
	await page.route('**/api/sessions', (route) => route.fulfill({ json: { sessions: [session] } }));
	await page.route('**/api/runtimes', async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		await route.fulfill({ json: { snapshot } });
	});

	await page.goto('/history');
	await page.getByRole('link', { name: /Historical chat/ }).click();

	await expect(page).toHaveURL(/\/chat\/project-1\/session-1$/);
	await expect(page.getByText('Project summary')).toBeVisible();
	await expect(page.getByText('Opening session…')).toHaveCount(0);
	await expect(page.getByRole('tab', { name: 'Historical chat' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
});

test('closes an active tab without reopening it', async ({ page }) => {
	await page.goto('/history');
	await page.getByRole('button', { name: 'New chat tab' }).click();

	const closeButton = page.getByRole('button', { name: 'Close New chat' });
	await closeButton.click();

	await expect(page).toHaveURL(/\/history$/);
	await expect(closeButton).toHaveCount(0);
});

test('restores each tab scroll position without animating to the bottom', async ({ page }) => {
	await page.goto('/new/scroll-position');
	await expect(page.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible();

	await page.evaluate(() => {
		const container = document.getElementById('workspace-content');
		if (!container) throw new Error('Workspace scroll container is missing.');
		container.style.paddingBottom = '1200px';
		container.scrollTop = 180;
		container.dispatchEvent(new Event('scroll'));
	});

	await page.getByRole('tab', { name: 'Historical sessions and harness settings' }).click();
	await expect(page).toHaveURL(/\/history$/);
	await page.getByRole('tab', { name: 'New chat' }).click();
	await expect(page).toHaveURL(/\/new\/scroll-position$/);
	await expect
		.poll(() => page.evaluate(() => document.getElementById('workspace-content')?.scrollTop))
		.toBe(180);
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
		items: []
	};

	await page.addInitScript(() => localStorage.clear());
	await page.route('**/api/projects', async (route) => {
		if (route.request().method() !== 'GET') return route.fallback();
		await route.fulfill({ json: { projects: [project] } });
	});
	await page.route('**/api/models', (route) => route.fulfill({ json: { models: [model] } }));
	await page.route('**/api/sessions', (route) => route.fulfill({ json: { sessions: [] } }));
	await page.route('**/api/runtimes', async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		await route.fulfill({ json: { snapshot } });
	});
	await page.route('**/api/runtimes/runtime-1/prompt', (route) =>
		route.fulfill({ json: { queued: true } })
	);

	await page.goto('/new/draft-tab');
	const message = page.getByRole('textbox', { name: 'Message Pi' });
	await message.fill('Start this chat');
	await message.press('Enter');

	await expect(page).toHaveURL(/\/chat\/project-1\/session-1$/);
	await expect(page.getByRole('tab', { name: 'New chat' })).toHaveCount(1);
});

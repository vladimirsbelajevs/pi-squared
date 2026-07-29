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
	await expect(page.getByRole('heading', { name: 'Pi²' })).toBeVisible();
	await expect(page.getByRole('textbox', { name: 'Message Pi' })).toBeVisible();
	await expect(page.getByRole('combobox', { name: 'Model' })).toBeVisible();
	await expect(page.getByRole('combobox', { name: 'Reasoning' })).toBeVisible();
	await expect(page.getByRole('combobox', { name: 'Project' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Add project' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Start chat' })).toHaveCount(0);
	await expect(page.getByText('MCP: No servers configured')).toHaveCount(0);

	await page.getByRole('tab', { name: 'Historical sessions and harness settings' }).click();
	await expect(page).toHaveURL(/\/history$/);
	await page.getByRole('link', { name: 'Settings' }).click();
	await expect(page).toHaveURL(/\/settings$/);
	await expect(page.getByRole('heading', { name: 'Theme' })).toBeVisible();
	await page.getByRole('button', { name: 'Everforest Dark Medium' }).click();
	await expect
		.poll(() => page.evaluate(() => document.documentElement.dataset.theme))
		.toBe('everforest-dark-medium');
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
	await page.getByRole('button', { name: 'New chat tab' }).click();
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
	await expect(page.getByRole('tab', { name: 'New chat' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Pi²' })).toBeVisible();
});

test('persists the model reasoning display preference', async ({ page }) => {
	await page.goto('/settings');

	const showReasoning = page.getByRole('checkbox', { name: 'Show model reasoning' });
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

	const displayModelChanges = page.getByRole('checkbox', {
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
		if (route.request().method() !== 'POST') return route.fallback();
		await route.fulfill({ json: { snapshot } });
	});

	await page.goto('/history');
	await page.getByRole('link', { name: /Historical chat/ }).click();

	await expect(page).toHaveURL(/\/chat\/project-1\/session-1$/);
	await expect(page.getByText('Project summary')).toBeVisible();
	await expect(page.getByText('I inspected the project history.')).toHaveCount(0);
	await expect(page.getByText('Opening session…')).toHaveCount(0);
	await expect(page.getByRole('tab', { name: 'Historical chat' })).toHaveAttribute(
		'aria-selected',
		'true'
	);

	await page.getByRole('tab', { name: 'Historical sessions and harness settings' }).click();
	await page.getByRole('link', { name: 'Settings' }).click();
	await page.getByRole('checkbox', { name: 'Show model reasoning' }).check();
	await page.getByRole('tab', { name: 'Historical chat' }).click();
	await page
		.getByRole('group', { name: 'assistant message' })
		.getByText('Reasoning', { exact: true })
		.click();
	await expect(page.getByText('I inspected the project history.')).toBeVisible();
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
	await expect(page.getByRole('heading', { name: 'Pi²' })).toBeVisible();

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

test('keeps a bottom-pinned chat stable while response content streams', async ({ page }) => {
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
		isStreaming: true,
		items: []
	};

	await page.addInitScript(() => {
		class MockEventSource {
			onmessage: ((event: MessageEvent<string>) => void) | null = null;

			constructor() {
				(window as typeof window & { activeEventSource?: MockEventSource }).activeEventSource =
					this;
			}

			close(): void {}
		}

		Object.defineProperty(window, 'EventSource', { configurable: true, value: MockEventSource });
	});
	await page.addInitScript(() => localStorage.clear());
	await page.route('**/api/projects', (route) => route.fulfill({ json: { projects: [project] } }));
	await page.route('**/api/models', (route) => route.fulfill({ json: { models: [model] } }));
	await page.route('**/api/sessions', (route) => route.fulfill({ json: { sessions: [] } }));
	await page.route('**/api/runtimes', async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		await route.fulfill({ json: { snapshot } });
	});

	await page.goto('/chat/project-1/session-1');
	await expect(page.getByRole('textbox', { name: 'Message Pi' })).toBeVisible();
	await page.evaluate(() => {
		const container = document.getElementById('workspace-content');
		if (!container) throw new Error('Workspace scroll container is missing.');
		container.style.paddingBottom = '1200px';
		container.scrollTop = container.scrollHeight;
	});

	async function emit(event: unknown): Promise<void> {
		await page.evaluate((event) => {
			const source = (
				window as typeof window & {
					activeEventSource?: { onmessage: ((event: MessageEvent<string>) => void) | null };
				}
			).activeEventSource;
			source?.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event) }));
		}, event);
	}

	async function expectPinnedToBottom(): Promise<void> {
		await expect
			.poll(() =>
				page.evaluate(() => {
					const container = document.getElementById('workspace-content');
					return (
						!!container &&
						container.scrollHeight - container.scrollTop - container.clientHeight <= 1
					);
				})
			)
			.toBe(true);
	}

	await emit({
		id: 1,
		runtimeId: 'runtime-1',
		event: {
			type: 'assistant_delta',
			text: Array.from({ length: 40 }, (_, index) => `Streaming line ${index + 1}.`).join('\n\n')
		}
	});
	await expect(page.getByText('Streaming line 1.')).toBeVisible();
	await expectPinnedToBottom();

	await emit({
		id: 2,
		runtimeId: 'runtime-1',
		event: {
			type: 'tool_update',
			toolCallId: 'tool-1',
			toolName: 'read',
			text: 'Reading README.md'
		}
	});
	await expect(page.getByText('1 tool called')).toBeVisible();
	await expectPinnedToBottom();
	const scrollHeightBeforeApproval = await page.evaluate(
		() => document.getElementById('workspace-content')?.scrollHeight
	);
	await emit({
		id: 3,
		runtimeId: 'runtime-1',
		event: {
			type: 'permission_request',
			request: { id: 'permission-1', method: 'confirm', title: 'Approve the file change?' }
		}
	});
	const approval = page.getByRole('alert');
	await expect(approval).toBeVisible();
	await expect(approval).toContainText('Approve the file change?');
	expect(
		await approval.evaluate((node) => getComputedStyle(node.parentElement as HTMLElement).position)
	).toBe('absolute');
	await expect
		.poll(() => page.evaluate(() => document.getElementById('workspace-content')?.scrollHeight))
		.toBe(scrollHeightBeforeApproval);

	await page.evaluate(() => {
		const container = document.getElementById('workspace-content');
		if (!container) throw new Error('Workspace scroll container is missing.');
		container.scrollTop = 0;
	});
	await emit({
		id: 4,
		runtimeId: 'runtime-1',
		event: {
			type: 'assistant_delta',
			text: Array.from({ length: 40 }, (_, index) => `Additional line ${index + 1}.`).join('\n\n')
		}
	});
	await expect(page.getByText('Additional line 1.')).toBeVisible();
	await expect
		.poll(() => page.evaluate(() => document.getElementById('workspace-content')?.scrollTop))
		.toBe(0);
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
		route.fulfill({ json: { queued: true, userMessageText: 'Start this chat' } })
	);

	await page.goto('/new/draft-tab');
	const message = page.getByRole('textbox', { name: 'Message Pi' });
	await message.fill('Start this chat');
	await message.press('Enter');

	await expect(page).toHaveURL(/\/chat\/project-1\/session-1$/);
	await expect(page.getByText('Start this chat')).toBeVisible();
	await expect(page.getByText('MCP: No servers configured')).toBeVisible();
	await expect(page.getByRole('tab', { name: 'New chat' })).toHaveCount(1);
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { ContextUsageSnapshot, McpStatusSnapshot, SessionTokenUsage } from '$lib/contracts';
import ChatComposer from './ChatComposer.svelte';

const autocompleteApi = vi.hoisted(() => ({
	listProjectSlashCommands: vi.fn(),
	listRuntimeSlashCommands: vi.fn(),
	searchProjectFiles: vi.fn()
}));

const errorNotices = vi.hoisted(() => ({ show: vi.fn() }));

vi.mock('$lib/harness/api', () => autocompleteApi);
vi.mock('$lib/error-notices', () => ({ errorNotices }));

const models = [
	{ provider: 'openai', id: 'gpt-test', name: 'GPT Test', reasoning: true },
	{ provider: 'example', id: 'plain-test', name: 'Plain Test', reasoning: false }
];

const mcpStatus: McpStatusSnapshot = {
	servers: [
		{
			name: 'Filesystem',
			state: 'connected',
			toolCount: 3,
			disabled: false
		}
	],
	totalTools: 3,
	totalResources: 0,
	connectedCount: 1,
	disabledCount: 0
};

const contextUsage: ContextUsageSnapshot = {
	tokens: 150_800,
	contextWindow: 200_000,
	percent: 75.4
};

const sessionTokens: SessionTokenUsage = {
	input: 1_200,
	output: 200_000,
	cacheRead: 0,
	cacheWrite: 1_000_000,
	total: 1_201_200
};

function props(overrides: Record<string, unknown> = {}) {
	return {
		models,
		modelKey: 'openai::gpt-test',
		thinkingLevel: 'medium' as const,
		onSend: vi.fn().mockResolvedValue(true),
		onModelChange: vi.fn(),
		onThinkingChange: vi.fn(),
		...overrides
	};
}

describe('ChatComposer', () => {
	beforeEach(() => {
		errorNotices.show.mockClear();
	});

	it('renders an empty composer with inline model and reasoning controls', async () => {
		const screen = render(ChatComposer, props());

		await expect.element(screen.getByRole('textbox', { name: 'Message Pi' })).toHaveValue('');
		await expect.element(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
		await expect
			.element(screen.getByRole('combobox', { name: 'Model' }))
			.toHaveTextContent('GPT Test');
		await expect
			.element(screen.getByRole('combobox', { name: 'Reasoning' }))
			.toHaveTextContent('medium');
		expect(screen.container.textContent).not.toContain('openai');
	});

	it('uses custom model and reasoning selectors', async () => {
		const onModelChange = vi.fn();
		const onThinkingChange = vi.fn();
		const screen = render(ChatComposer, props({ onModelChange, onThinkingChange }));

		await screen.getByRole('combobox', { name: 'Model' }).click();
		await screen.getByRole('option', { name: 'Plain Test' }).click();
		expect(onModelChange).toHaveBeenCalledWith('example::plain-test');

		await screen.getByRole('combobox', { name: 'Reasoning' }).click();
		await screen.getByRole('option', { name: 'high', exact: true }).click();
		expect(onThinkingChange).toHaveBeenCalledWith('high');
	});

	it('trims and sends with Enter while Shift Enter remains a newline', async () => {
		const onSend = vi.fn().mockResolvedValue(true);
		const screen = render(ChatComposer, props({ onSend }));
		const textbox = screen.getByRole('textbox', { name: 'Message Pi' });

		await textbox.fill('  Inspect this route  ');
		await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
		expect(onSend).not.toHaveBeenCalled();

		await userEvent.keyboard('{Enter}');
		await vi.waitFor(() =>
			expect(onSend).toHaveBeenCalledWith({ text: 'Inspect this route', attachments: [] })
		);
	});

	it('restores a rejected message', async () => {
		const screen = render(ChatComposer, props({ onSend: vi.fn().mockResolvedValue(false) }));
		const textbox = screen.getByRole('textbox', { name: 'Message Pi' });

		await textbox.fill('Keep this draft');
		await screen.getByRole('button', { name: 'Send message' }).click();

		await expect.element(textbox).toHaveValue('Keep this draft');
		expect(errorNotices.show).toHaveBeenCalledWith('Message was not accepted. Please try again.');
	});

	it('previews and sends an attachment-only image submission', async () => {
		const onSend = vi.fn().mockResolvedValue(true);
		const screen = render(ChatComposer, props({ onSend }));
		const input = screen.container.querySelector<HTMLInputElement>('input[type="file"]')!;
		const image = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'diagram.png', {
			type: 'image/png'
		});

		await userEvent.upload(input, image);

		await expect.element(screen.getByText('diagram.png')).toBeVisible();
		const preview = screen.container.querySelector<HTMLImageElement>(
			'.attachment-preview-thumbnail'
		);
		expect(preview?.src).toMatch(/^data:image\/png;base64,/);
		await expect.element(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();

		await screen.getByRole('button', { name: 'Send message' }).click();
		await vi.waitFor(() =>
			expect(onSend).toHaveBeenCalledWith({
				text: '',
				attachments: [
					expect.objectContaining({
						id: expect.any(String),
						kind: 'image',
						name: 'diagram.png',
						mimeType: 'image/png',
						size: image.size,
						data: expect.any(String)
					})
				]
			})
		);
		expect(screen.container.querySelector('.attachment-draft-list')).toBeNull();
	});

	it('opens and closes draft image attachment previews', async () => {
		const screen = render(ChatComposer, props());
		const input = screen.container.querySelector<HTMLInputElement>('input[type="file"]')!;
		const image = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'diagram.png', {
			type: 'image/png'
		});

		await userEvent.upload(input, image);

		const thumbnail = screen.getByRole('button', { name: 'Open preview of diagram.png' });
		await thumbnail.click();
		await expect
			.element(screen.getByRole('dialog', { name: 'Image preview: diagram.png' }))
			.toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Close image preview' })).toBeVisible();

		await screen.getByRole('button', { name: 'Close image preview' }).click();
		await vi.waitFor(() => expect(screen.container.querySelector('[role="dialog"]')).toBeNull());

		await thumbnail.click();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		await vi.waitFor(() => expect(screen.container.querySelector('[role="dialog"]')).toBeNull());
	});

	it('removes only the selected draft attachment', async () => {
		const onSend = vi.fn().mockResolvedValue(true);
		const screen = render(ChatComposer, props({ onSend }));
		const input = screen.container.querySelector<HTMLInputElement>('input[type="file"]')!;
		const first = new File(['first attachment'], 'first.txt', { type: 'text/plain' });
		const second = new File(['second attachment'], 'second.txt', { type: 'text/plain' });

		await userEvent.upload(input, [first, second]);
		await expect.element(screen.getByText('first.txt')).toBeVisible();
		await expect.element(screen.getByText('second.txt')).toBeVisible();

		await screen.getByRole('button', { name: 'Remove second.txt attachment 2' }).click();
		await vi.waitFor(() => expect(screen.container.textContent).not.toContain('second.txt'));
		await expect.element(screen.getByText('first.txt')).toBeVisible();

		await screen.getByRole('button', { name: 'Send message' }).click();
		await vi.waitFor(() =>
			expect(onSend).toHaveBeenCalledWith({
				text: '',
				attachments: [expect.objectContaining({ name: 'first.txt', data: expect.any(String) })]
			})
		);
	});

	it('reports draft changes from typing and sending', async () => {
		const onDraftChange = vi.fn();
		const screen = render(ChatComposer, props({ onDraftChange }));
		const textbox = screen.getByRole('textbox', { name: 'Message Pi' });

		await textbox.fill('Persist this draft');
		expect(onDraftChange).toHaveBeenLastCalledWith('Persist this draft');
		await screen.getByRole('button', { name: 'Send message' }).click();
		expect(onDraftChange).toHaveBeenLastCalledWith('');
	});

	it('renders the MCP status row by default and enables controls when status is available', async () => {
		const withoutStatus = render(ChatComposer, props());
		await expect.element(withoutStatus.getByText('MCP: No servers configured')).toBeVisible();
		expect(withoutStatus.container.querySelector('.mcp-summary')).toBeNull();

		const onMcpToggle = vi.fn().mockResolvedValue(undefined);
		const withStatus = render(
			ChatComposer,
			props({
				mcpStatus,
				onMcpToggle,
				projectName: 'Pi Squared',
				projectCwd: '/workspace/pi-squared'
			})
		);
		await expect
			.element(withStatus.getByRole('button', { name: 'MCP: 1 server enabled' }))
			.toBeVisible();
		const project = withStatus.container.querySelector('.thread-project');
		expect(project?.getAttribute('title')).toBe('/workspace/pi-squared');
		expect(project?.textContent).toContain('Pi Squared');
		const statusContainer = withStatus.container.querySelector('.composer-stack > .mcp-status');
		const composerShell = withStatus.container.querySelector('.composer-shell');
		expect(statusContainer).not.toBeNull();
		expect(getComputedStyle(statusContainer as HTMLElement).marginBottom).toBe('-32px');
		expect(getComputedStyle(composerShell as HTMLElement).position).toBe('relative');
		expect(getComputedStyle(composerShell as HTMLElement).zIndex).toBe('1');
	});

	it('passes session and context usage to the status indicator', async () => {
		const screen = render(ChatComposer, props({ contextUsage, sessionTokens }));
		const indicator = screen.container.querySelector('.usage-indicator');

		expect(indicator?.textContent).toContain('Session token usage: 1,200 input tokens');
		await expect.element(screen.getByText('75.4%/200k')).toBeVisible();
	});

	it('does not render the MCP status row when showStatusPanel is false', () => {
		const screen = render(ChatComposer, props({ showStatusPanel: false, mcpStatus }));

		expect(screen.container.querySelector('.mcp-status')).toBeNull();
	});

	it('shows only a stop action while streaming and queues with Enter', async () => {
		const onStop = vi.fn();
		const onSend = vi.fn().mockResolvedValue(true);
		const onQueueModeChange = vi.fn();
		const screen = render(
			ChatComposer,
			props({ isStreaming: true, onStop, onSend, onQueueModeChange, queueMode: 'followUp' })
		);

		await expect.element(screen.getByRole('button', { name: 'Stop response' })).toBeVisible();
		await expect
			.element(screen.getByRole('combobox', { name: 'Queue' }))
			.toHaveTextContent('follow-up');
		expect(screen.container.querySelectorAll('.composer-actions button')).toHaveLength(1);
		await expect.element(screen.getByRole('button', { name: 'Attach files' })).toBeVisible();
		expect(screen.container.querySelector('.send-action')).toBeNull();
		await screen.getByRole('button', { name: 'Stop response' }).click();
		expect(onStop).toHaveBeenCalledOnce();

		const textbox = screen.getByRole('textbox', { name: 'Message Pi' });
		await textbox.fill('Queue this follow-up');
		await userEvent.keyboard('{Enter}');
		await vi.waitFor(() =>
			expect(onSend).toHaveBeenCalledWith({ text: 'Queue this follow-up', attachments: [] })
		);
	});

	it('inserts a slash command with Enter instead of submitting', async () => {
		autocompleteApi.listProjectSlashCommands.mockResolvedValue({
			commands: [
				{ name: 'review', description: 'Review current changes', source: 'prompt' },
				{ name: 'refactor', description: 'Refactor selected code', source: 'skill' }
			]
		});
		const onSend = vi.fn().mockResolvedValue(true);
		const screen = render(ChatComposer, props({ projectId: 'project-1', onSend }));
		const textbox = screen.getByRole('textbox', { name: 'Message Pi' });

		await userEvent.click(textbox);
		await vi.waitFor(() => expect(autocompleteApi.listProjectSlashCommands).toHaveBeenCalledOnce());
		await textbox.fill('/rev');
		await expect.element(screen.getByRole('listbox')).toBeVisible();
		await userEvent.keyboard('{Enter}');

		await expect.element(textbox).toHaveValue('/review ');
		expect(onSend).not.toHaveBeenCalled();
	});

	it('clears autocomplete and textarea ARIA state when sending resets the draft', async () => {
		autocompleteApi.listProjectSlashCommands.mockResolvedValue({
			commands: [{ name: 'review', description: 'Review current changes', source: 'prompt' }]
		});
		const onSend = vi.fn().mockResolvedValue(true);
		const screen = render(ChatComposer, props({ projectId: 'project-1', onSend }));
		const textbox = screen.getByRole('textbox', { name: 'Message Pi' });

		await userEvent.click(textbox);
		await textbox.fill('/rev');
		await expect.element(screen.getByRole('listbox')).toBeVisible();
		expect(textbox.element().getAttribute('aria-controls')).toMatch(/-autocomplete$/);
		expect(textbox.element().getAttribute('aria-activedescendant')).toMatch(/-option-0$/);

		await screen.getByRole('button', { name: 'Send message' }).click();

		await expect.element(textbox).toHaveValue('');
		expect(screen.container.querySelector('[role="listbox"]')).toBeNull();
		expect(textbox.element().hasAttribute('aria-controls')).toBe(false);
		expect(textbox.element().hasAttribute('aria-activedescendant')).toBe(false);
		expect(onSend).toHaveBeenCalledWith({ text: '/rev', attachments: [] });
	});

	it('keeps textarea ARIA selection in sync and clears it with Escape', async () => {
		autocompleteApi.listProjectSlashCommands.mockResolvedValue({
			commands: [
				{ name: 'review', description: 'Review current changes', source: 'prompt' },
				{ name: 'refactor', description: 'Refactor selected code', source: 'skill' }
			]
		});
		const screen = render(ChatComposer, props({ projectId: 'project-1' }));
		const textbox = screen.getByRole('textbox', { name: 'Message Pi' });

		await userEvent.click(textbox);
		await textbox.fill('/');
		await expect.element(screen.getByRole('listbox')).toBeVisible();
		expect(textbox.element().getAttribute('aria-activedescendant')).toMatch(/-option-0$/);

		await userEvent.keyboard('{ArrowDown}');
		expect(textbox.element().getAttribute('aria-activedescendant')).toMatch(/-option-1$/);

		await userEvent.keyboard('{Escape}');
		expect(screen.container.querySelector('[role="listbox"]')).toBeNull();
		expect(textbox.element().hasAttribute('aria-controls')).toBe(false);
		expect(textbox.element().hasAttribute('aria-activedescendant')).toBe(false);
	});

	it('inserts an @ file path with Tab', async () => {
		autocompleteApi.searchProjectFiles.mockResolvedValue({ files: [{ path: 'src/lib/chat.ts' }] });
		const screen = render(ChatComposer, props({ projectId: 'project-1' }));
		const textbox = screen.getByRole('textbox', { name: 'Message Pi' });

		await userEvent.click(textbox);
		await textbox.fill('Inspect @cha');
		await vi.waitFor(
			() =>
				expect(autocompleteApi.searchProjectFiles).toHaveBeenCalledWith(
					'project-1',
					'cha',
					expect.any(AbortSignal)
				),
			{ timeout: 1000 }
		);
		await expect.element(screen.getByRole('listbox')).toBeVisible();
		await userEvent.keyboard('{Tab}');

		await expect.element(textbox).toHaveValue('Inspect @src/lib/chat.ts ');
	});

	it('keeps file suggestions mounted while a refined search is debounced', async () => {
		autocompleteApi.searchProjectFiles.mockReset();
		autocompleteApi.searchProjectFiles.mockResolvedValue({ files: [{ path: 'src/lib/chat.ts' }] });
		const screen = render(ChatComposer, props({ projectId: 'project-1' }));
		const textbox = screen.getByRole('textbox', { name: 'Message Pi' });

		await userEvent.click(textbox);
		await textbox.fill('Inspect @cha');
		await vi.waitFor(() =>
			expect(autocompleteApi.searchProjectFiles).toHaveBeenCalledWith(
				'project-1',
				'cha',
				expect.any(AbortSignal)
			)
		);
		await expect.element(screen.getByRole('listbox')).toBeVisible();
		const listbox = screen.container.querySelector('[role="listbox"]');
		expect(listbox).not.toBeNull();

		await userEvent.keyboard('t');

		await expect.element(screen.getByRole('listbox')).toBeVisible();
		expect(screen.container.querySelector('[role="listbox"]')).toBe(listbox);
		expect(autocompleteApi.searchProjectFiles).toHaveBeenCalledOnce();
	});
});

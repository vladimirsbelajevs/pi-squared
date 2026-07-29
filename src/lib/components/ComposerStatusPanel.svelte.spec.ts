import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { ContextUsageSnapshot, McpStatusSnapshot, SessionTokenUsage } from '$lib/contracts';
import ComposerStatusPanel from './ComposerStatusPanel.svelte';

const status: McpStatusSnapshot = {
	servers: [
		{
			name: 'Filesystem',
			state: 'connected',
			toolCount: 4,
			resourceCount: 2,
			disabled: false
		},
		{
			name: 'GitHub',
			state: 'needs-auth',
			toolCount: 2,
			disabled: false
		},
		{
			name: 'Archive',
			state: 'disabled',
			toolCount: 0,
			disabled: true
		}
	],
	totalTools: 6,
	totalResources: 2,
	connectedCount: 1,
	disabledCount: 1
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

describe('ComposerStatusPanel', () => {
	it('renders Pi-style cumulative usage and context in the right-side project cluster', async () => {
		const screen = render(ComposerStatusPanel, {
			contextUsage,
			sessionTokens,
			projectName: 'Pi Squared'
		});
		const row = screen.container.querySelector('.mcp-status-row');
		const indicator = screen.container.querySelector('.usage-indicator');
		const projectCluster = screen.container.querySelector('.thread-project-cluster');

		await expect.element(screen.getByText('↑1.2k')).toBeVisible();
		await expect.element(screen.getByText('↓200k')).toBeVisible();
		await expect.element(screen.getByText('W1.0m')).toBeVisible();
		expect(indicator?.textContent).not.toContain('R0');
		expect(indicator?.textContent).toContain(
			'Session token usage: 1,200 input tokens, 200,000 output tokens, 1,000,000 cached tokens written. Context usage: 150,800 of 200,000 tokens (75.4 percent).'
		);
		await expect.element(screen.getByText('75.4%/200k')).toBeVisible();
		expect(row?.lastElementChild).toBe(projectCluster);
		expect(projectCluster?.textContent).toContain('Pi Squared');
		expect(projectCluster?.querySelector('.usage-indicator')).toBe(indicator);
		expect(getComputedStyle(projectCluster as HTMLElement).marginLeft).toBe('auto');
		expect(row?.classList.contains('tone-muted')).toBe(true);
	});

	it('renders unknown context without a percentage when tokens or percent are unavailable', async () => {
		const screen = render(ComposerStatusPanel, {
			contextUsage: { tokens: null, contextWindow: 200_000, percent: null }
		});

		await expect.element(screen.getByText('?/200k')).toBeVisible();
		expect(screen.container.querySelector('.usage-indicator')?.textContent).toContain(
			'Context usage: unknown of 200,000 tokens.'
		);
	});

	it('uses warning and danger tones above the context thresholds', async () => {
		const screen = render(ComposerStatusPanel, {
			contextUsage: { tokens: 140_200, contextWindow: 200_000, percent: 70.1 }
		});

		expect(
			screen.container.querySelector('.context-usage')?.classList.contains('context-warning')
		).toBe(true);
		await screen.rerender({
			contextUsage: { tokens: 180_200, contextWindow: 200_000, percent: 90.1 }
		});
		expect(
			screen.container.querySelector('.context-usage')?.classList.contains('context-danger')
		).toBe(true);
		await expect.element(screen.getByText('90.1%/200k')).toBeVisible();
	});

	it('renders a noninteractive empty state when status is missing or has no servers', async () => {
		const screen = render(ComposerStatusPanel, {
			projectName: 'Pi Squared',
			projectCwd: '/workspace/pi-squared'
		});

		await expect.element(screen.getByText('MCP: No servers configured')).toBeVisible();
		expect(screen.container.querySelector('.mcp-summary')).toBeNull();
		expect(screen.container.querySelector('button')).toBeNull();
		const project = screen.container.querySelector('.thread-project');
		expect(project?.getAttribute('title')).toBe('/workspace/pi-squared');
		expect(project?.textContent).toContain('Pi Squared');
		expect(project?.parentElement?.lastElementChild).toBe(project);

		await screen.rerender({ status: { ...status, servers: [] } });
		await expect.element(screen.getByText('MCP: No servers configured')).toBeVisible();
		expect(screen.container.querySelector('.mcp-summary')).toBeNull();
	});

	it('pluralizes enabled servers and expands to show every server status and tool count', async () => {
		const screen = render(ComposerStatusPanel, {
			status,
			projectName: 'Pi Squared',
			onToggle: vi.fn().mockResolvedValue(undefined)
		});
		const summary = screen.getByRole('button', { name: 'MCP: 2 servers enabled' });
		const row = screen.container.querySelector('.mcp-status-row');
		const summaryElement = screen.container.querySelector('.mcp-summary');

		expect(row?.classList.contains('tone-connected')).toBe(true);
		expect(row?.querySelector('.thread-project')?.textContent).toContain('Pi Squared');
		expect(getComputedStyle(row as HTMLElement).borderBottomLeftRadius).toBe('0px');
		expect(getComputedStyle(row as HTMLElement).borderBottomRightRadius).toBe('0px');
		expect(summaryElement?.tagName).toBe('BUTTON');
		expect(getComputedStyle(summaryElement as HTMLElement).borderTopWidth).toBe('0px');
		expect(getComputedStyle(summaryElement as HTMLElement).paddingTop).toBe('0px');

		await expect.element(summary).toHaveAttribute('aria-expanded', 'false');
		await summary.click();
		await expect.element(summary).toHaveAttribute('aria-expanded', 'true');
		const panel = screen.getByRole('region', { name: 'MCP servers' });
		await expect.element(panel).toBeVisible();
		expect(getComputedStyle(panel.element()).position).toBe('absolute');
		await expect.element(screen.getByText('Filesystem')).toBeVisible();
		await expect.element(screen.getByText('Connected')).toBeVisible();
		await expect.element(screen.getByText('4 tools')).toBeVisible();
		await expect.element(screen.getByText('GitHub')).toBeVisible();
		await expect.element(screen.getByText('Needs authentication')).toBeVisible();
		await expect.element(screen.getByText('2 tools')).toBeVisible();
		await expect.element(screen.getByText('Archive')).toBeVisible();
		await expect.element(screen.getByText('Disabled')).toBeVisible();
		await expect.element(screen.getByText('0 tools')).toBeVisible();

		await screen.rerender({
			status: { ...status, servers: [status.servers[0], status.servers[2]] },
			onToggle: vi.fn().mockResolvedValue(undefined)
		});
		await expect
			.element(screen.getByRole('button', { name: 'MCP: 1 server enabled' }))
			.toBeVisible();
	});

	it('closes the expanded panel with Escape', async () => {
		const screen = render(ComposerStatusPanel, {
			status,
			onToggle: vi.fn().mockResolvedValue(undefined)
		});
		await screen.getByRole('button', { name: 'MCP: 2 servers enabled' }).click();
		await userEvent.keyboard('{Escape}');

		await expect
			.element(screen.getByRole('region', { name: 'MCP servers' }))
			.not.toBeInTheDocument();
	});

	it('requests the inverse enabled state when a switch is clicked', async () => {
		const onToggle = vi.fn().mockResolvedValue(undefined);
		const screen = render(ComposerStatusPanel, { status, onToggle });
		screen.container.style.marginTop = '24rem';
		await screen.getByRole('button', { name: 'MCP: 2 servers enabled' }).click();
		await screen.getByRole('switch', { name: 'Disable GitHub' }).click();

		await vi.waitFor(() => expect(onToggle).toHaveBeenCalledWith('GitHub', false));
	});

	it('disables only the switch whose update is pending', async () => {
		let resolveToggle: (() => void) | undefined;
		const onToggle = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveToggle = resolve;
				})
		);
		const screen = render(ComposerStatusPanel, { status, onToggle });
		screen.container.style.marginTop = '24rem';
		await screen.getByRole('button', { name: 'MCP: 2 servers enabled' }).click();
		const githubSwitch = screen.getByRole('switch', { name: 'Disable GitHub' });
		const filesystemSwitch = screen.getByRole('switch', { name: 'Disable Filesystem' });

		await githubSwitch.click();
		await expect.element(githubSwitch).toBeDisabled();
		await expect.element(filesystemSwitch).not.toBeDisabled();

		resolveToggle?.();
		await expect.element(githubSwitch).not.toBeDisabled();
	});

	it('shows callback failures', async () => {
		const screen = render(ComposerStatusPanel, {
			status,
			onToggle: vi.fn().mockRejectedValue(new Error('Connection refused'))
		});
		screen.container.style.marginTop = '24rem';
		await screen.getByRole('button', { name: 'MCP: 2 servers enabled' }).click();
		await screen.getByRole('switch', { name: 'Disable GitHub' }).click();

		await expect.element(screen.getByRole('alert')).toHaveTextContent('Connection refused');
	});
});

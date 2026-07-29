import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { McpStatusSnapshot } from '$lib/contracts';
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

describe('ComposerStatusPanel', () => {
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
			onToggle: vi.fn().mockResolvedValue(undefined)
		});
		const summary = screen.getByRole('button', { name: 'MCP: 2 servers enabled' });

		await expect.element(summary).toHaveAttribute('aria-expanded', 'false');
		await summary.click();
		await expect.element(summary).toHaveAttribute('aria-expanded', 'true');
		await expect.element(screen.getByRole('region', { name: 'MCP servers' })).toBeVisible();
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
		await screen.getByRole('button', { name: 'MCP: 2 servers enabled' }).click();
		await screen.getByRole('switch', { name: 'Disable GitHub' }).click();

		await expect.element(screen.getByRole('alert')).toHaveTextContent('Connection refused');
	});
});

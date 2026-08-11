import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { applicationUpdateState, requestApplicationUpdate } from '$lib/application-updater.svelte';
import ApplicationUpdater from './ApplicationUpdater.svelte';

function ndjsonResponse(records: object[]): Response {
	const encoder = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const record of records) {
				controller.enqueue(encoder.encode(`${JSON.stringify(record)}\n`));
			}

			controller.close();
		}
	});

	return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } });
}

afterEach(() => {
	delete window.piSquaredDesktop;
	applicationUpdateState.busy = false;
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('ApplicationUpdater source-web mode', () => {
	it('renders streamed output and a retry action after failure', async () => {
		const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === 'POST') {
				return Promise.resolve(
					ndjsonResponse([
						{ type: 'output', stream: 'stdout', text: 'first chunk\n' },
						{ type: 'output', stream: 'stderr', text: 'warning\n' },
						{ type: 'complete', code: 1, signal: null }
					])
				);
			}

			return Promise.resolve(
				new Response(JSON.stringify({ serverTime: '', lastCheckedAt: null, due: false }))
			);
		});
		vi.stubGlobal('fetch', fetchMock);
		const screen = render(ApplicationUpdater);

		expect(requestApplicationUpdate()).toBe(true);
		await expect
			.element(screen.getByRole('textbox', { name: 'Application update output' }))
			.toHaveTextContent('[stdout] first chunk');
		await expect
			.element(screen.getByRole('textbox', { name: 'Application update output' }))
			.toHaveTextContent('[stderr] warning');
		await expect.element(screen.getByRole('alert')).toHaveTextContent('code 1');
		await expect.element(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
		await screen.getByRole('button', { name: 'Close' }).click();
		await expect
			.element(screen.getByRole('dialog', { name: 'Application update' }))
			.not.toBeInTheDocument();
		await screen.unmount();
	});

	it('explains that a successful source build needs a manual foreground restart', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn((_: RequestInfo | URL, init?: RequestInit) =>
				Promise.resolve(
					init?.method === 'POST'
						? ndjsonResponse([{ type: 'complete', code: 0, signal: null }])
						: new Response(JSON.stringify({ serverTime: '', lastCheckedAt: null, due: false }))
				)
			)
		);
		const screen = render(ApplicationUpdater);

		expect(requestApplicationUpdate()).toBe(true);
		await expect
			.element(screen.getByText(/Stop and rerun the manually started server/))
			.toBeVisible();
		await expect
			.element(screen.getByRole('button', { name: 'Restart and install' }))
			.not.toBeInTheDocument();
		await screen.unmount();
	});
});

describe('ApplicationUpdater electron mode', () => {
	it('checks, downloads, and offers Restart and install only after download', async () => {
		const api = {
			mode: 'electron' as const,
			getBootstrapStatus: vi.fn(),
			startBootstrap: vi.fn(),
			onBootstrapProgress: vi.fn(() => () => undefined),
			startPiUpdate: vi.fn(),
			onPiUpdateProgress: vi.fn(() => () => undefined),
			getUpdateStatus: vi.fn(async () => ({ phase: 'idle' as const })),
			checkForUpdates: vi.fn(async () => ({ phase: 'available' as const, version: '1.1.0' })),
			onUpdateStatus: vi.fn(() => () => undefined),
			downloadUpdate: vi.fn(async () => ({ phase: 'downloaded' as const, version: '1.1.0' })),
			restartAndInstall: vi.fn(async () => undefined),
			quit: vi.fn(async () => undefined),
			getVersion: vi.fn(async () => '1.0.0')
		};
		window.piSquaredDesktop = api;

		const screen = render(ApplicationUpdater);

		expect(requestApplicationUpdate()).toBe(true);
		await expect.element(screen.getByText('Version 1.1.0 is available.').nth(0)).toBeVisible();
		await screen.getByRole('button', { name: 'Download update' }).click();
		await expect.element(screen.getByRole('button', { name: 'Restart and install' })).toBeVisible();
		await screen.getByRole('button', { name: 'Restart and install' }).click();
		expect(api.downloadUpdate).toHaveBeenCalledOnce();
		expect(api.restartAndInstall).toHaveBeenCalledOnce();
		await screen.unmount();
	});
});

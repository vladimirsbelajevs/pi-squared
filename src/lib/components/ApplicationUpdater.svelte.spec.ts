import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import {
	applicationUpdateEnvironment,
	requestApplicationUpdate
} from '$lib/application-updater.svelte';
import ApplicationUpdater from './ApplicationUpdater.svelte';

const reminderKey = 'pi-squared.application-update-next-reminder';

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

	return new Response(body, {
		headers: { 'Content-Type': 'application/x-ndjson' }
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	localStorage.removeItem(reminderKey);
});

describe('ApplicationUpdater', () => {
	it('opens immediately and renders streamed output and failure actions', async () => {
		localStorage.setItem(reminderKey, String(Date.now() + 60_000));
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
				new Response(
					JSON.stringify({
						supported: true,
						nativeRegistration: false,
						running: false,
						platform: 'linux',
						instanceId: 'current-process'
					})
				)
			);
		});
		vi.stubGlobal('fetch', fetchMock);
		const screen = render(ApplicationUpdater);

		expect(requestApplicationUpdate()).toBe(true);
		await expect.element(screen.getByRole('dialog', { name: 'Application update' })).toBeVisible();
		await expect
			.element(screen.getByRole('textbox', { name: 'Application update output' }))
			.toHaveTextContent('[stdout] first chunk');
		await expect
			.element(screen.getByRole('textbox', { name: 'Application update output' }))
			.toHaveTextContent('[stderr] warning');
		await expect.element(screen.getByRole('alert')).toHaveTextContent('code 1');
		await expect.element(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
		await expect
			.element(screen.getByRole('button', { name: 'Restart app' }))
			.not.toBeInTheDocument();
		await screen.getByRole('button', { name: 'Close' }).click();
		await expect
			.element(screen.getByRole('dialog', { name: 'Application update' }))
			.not.toBeInTheDocument();
		await screen.unmount();
	});

	it('offers Restart app after a successful update with native registration', async () => {
		localStorage.setItem(reminderKey, String(Date.now() + 60_000));
		const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === 'POST') {
				return Promise.resolve(ndjsonResponse([{ type: 'complete', code: 0, signal: null }]));
			}

			return Promise.resolve(
				new Response(
					JSON.stringify({
						supported: true,
						nativeRegistration: true,
						running: false,
						platform: 'linux',
						instanceId: 'current-process'
					})
				)
			);
		});
		vi.stubGlobal('fetch', fetchMock);
		const screen = render(ApplicationUpdater);

		expect(requestApplicationUpdate()).toBe(true);
		await expect.element(screen.getByRole('button', { name: 'Restart app' })).toBeEnabled();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await screen.unmount();
	});

	it('shows a due reminder and snoozes No for seven days', async () => {
		localStorage.clear();
		const screen = render(ApplicationUpdater);
		await expect.element(screen.getByText('Update application?')).toBeVisible();
		await screen.getByRole('button', { name: 'No' }).click();
		const nextReminder = Number(localStorage.getItem(reminderKey));
		expect(nextReminder).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
		expect(nextReminder).toBeLessThan(Date.now() + 8 * 24 * 60 * 60 * 1000);
		await screen.unmount();
	});

	it('records Yes and starts an update from the reminder', async () => {
		localStorage.clear();
		const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === 'POST') {
				return Promise.resolve(ndjsonResponse([{ type: 'complete', code: 0, signal: null }]));
			}

			return Promise.resolve(
				new Response(
					JSON.stringify({
						supported: true,
						nativeRegistration: false,
						running: false,
						platform: 'linux',
						instanceId: 'current-process'
					})
				)
			);
		});
		vi.stubGlobal('fetch', fetchMock);
		const screen = render(ApplicationUpdater);
		await expect.element(screen.getByText('Update application?')).toBeVisible();
		await screen.getByRole('button', { name: 'Yes' }).click();
		await expect.element(screen.getByRole('dialog', { name: 'Application update' })).toBeVisible();
		expect(Number(localStorage.getItem(reminderKey))).toBeGreaterThan(Date.now());
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/application/update',
			expect.objectContaining({ method: 'POST' })
		);
		await screen.getByRole('button', { name: 'Close' }).click();
		await screen.unmount();
	});

	it('renders incrementally streamed chunks and keeps the terminal tail bounded', async () => {
		localStorage.setItem(reminderKey, String(Date.now() + 60_000));
		let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
		const encoder = new TextEncoder();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				streamController = controller;
			}
		});
		const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === 'POST') {
				return Promise.resolve(new Response(body));
			}

			return Promise.resolve(
				new Response(
					JSON.stringify({
						supported: true,
						nativeRegistration: false,
						running: false,
						platform: 'linux',
						instanceId: 'current-process'
					})
				)
			);
		});
		vi.stubGlobal('fetch', fetchMock);
		const screen = render(ApplicationUpdater);
		expect(requestApplicationUpdate()).toBe(true);
		await expect
			.element(screen.getByRole('textbox', { name: 'Application update output' }))
			.toBeVisible();
		streamController?.enqueue(
			encoder.encode(
				JSON.stringify({ type: 'output', stream: 'stdout', text: 'first chunk' }) + '\n'
			)
		);
		await expect
			.element(screen.getByRole('textbox', { name: 'Application update output' }))
			.toHaveTextContent('first chunk');
		streamController?.enqueue(
			encoder.encode(
				JSON.stringify({ type: 'output', stream: 'stderr', text: 'second chunk' }) + '\n'
			)
		);
		await expect
			.element(screen.getByRole('textbox', { name: 'Application update output' }))
			.toHaveTextContent('second chunk');
		streamController?.enqueue(
			encoder.encode(
				JSON.stringify({
					type: 'output',
					stream: 'stdout',
					text: 'old-marker ' + 'x'.repeat(300_000)
				}) + '\n'
			)
		);
		streamController?.enqueue(encoder.encode(JSON.stringify({ type: 'complete', code: 0 }) + '\n'));
		streamController?.close();
		await expect.element(screen.getByRole('button', { name: 'Restart app' })).toBeDisabled();
		const renderedOutput =
			screen.getByRole('textbox', { name: 'Application update output' }).element().textContent ??
			'';
		expect(new TextEncoder().encode(renderedOutput).byteLength).toBeLessThanOrEqual(
			256 * 1024 + 128
		);
		expect(renderedOutput).not.toContain('old-marker');
		await screen.getByRole('button', { name: 'Close' }).click();
		await screen.unmount();
	});

	it('keeps the running dialog open on Escape and renders missing-registration guidance', async () => {
		localStorage.setItem(reminderKey, String(Date.now() + 60_000));
		let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				streamController = controller;
			}
		});
		const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === 'POST') {
				return Promise.resolve(new Response(body));
			}

			return Promise.resolve(
				new Response(
					JSON.stringify({
						supported: true,
						nativeRegistration: false,
						running: false,
						platform: 'linux',
						instanceId: 'current-process'
					})
				)
			);
		});
		vi.stubGlobal('fetch', fetchMock);
		const screen = render(ApplicationUpdater);
		expect(requestApplicationUpdate()).toBe(true);
		await expect.element(screen.getByRole('dialog', { name: 'Application update' })).toBeVisible();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		const overlay = document.querySelector<HTMLElement>(
			'[data-application-updater].application-update-overlay'
		);
		overlay?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		overlay?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
		await expect.element(screen.getByRole('dialog', { name: 'Application update' })).toBeVisible();
		streamController?.enqueue(
			new TextEncoder().encode(JSON.stringify({ type: 'complete', code: 0 }) + '\n')
		);
		streamController?.close();
		await expect.element(screen.getByRole('button', { name: 'Restart app' })).toBeDisabled();
		await expect.element(screen.getByText(/no native background registration/i)).toBeVisible();
		await screen.getByRole('button', { name: 'Close' }).click();
		await screen.unmount();
	});

	it('reloads after a fast restart when the server instance changes', async () => {
		localStorage.setItem(reminderKey, String(Date.now() + 60_000));
		let statusCalls = 0;
		const reload = vi
			.spyOn(applicationUpdateEnvironment, 'reload')
			.mockImplementation(() => undefined);
		const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
			const path = String(input);
			if (init?.method === 'POST' && path.endsWith('/update')) {
				return Promise.resolve(ndjsonResponse([{ type: 'complete', code: 0, signal: null }]));
			}

			if (init?.method === 'POST' && path.endsWith('/restart')) {
				return Promise.resolve(new Response(JSON.stringify({ accepted: true })));
			}

			statusCalls += 1;

			return Promise.resolve(
				new Response(
					JSON.stringify({
						supported: true,
						nativeRegistration: true,
						running: false,
						platform: 'linux',
						instanceId: statusCalls === 1 ? 'old-process' : 'new-process'
					})
				)
			);
		});
		vi.stubGlobal('fetch', fetchMock);
		const screen = render(ApplicationUpdater);
		expect(requestApplicationUpdate()).toBe(true);
		await expect.element(screen.getByRole('button', { name: 'Restart app' })).toBeEnabled();
		await screen.getByRole('button', { name: 'Restart app' }).click();
		await expect.poll(() => reload.mock.calls.length).toBe(1);
		await screen.unmount();
	});

	it('reports a bounded reconnect timeout when the server never returns', async () => {
		vi.useFakeTimers();
		try {
			localStorage.setItem(reminderKey, String(Date.now() + 60_000));
			let statusCalls = 0;
			const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
				const path = String(input);
				if (init?.method === 'POST' && path.endsWith('/update')) {
					return Promise.resolve(ndjsonResponse([{ type: 'complete', code: 0, signal: null }]));
				}

				if (init?.method === 'POST' && path.endsWith('/restart')) {
					return Promise.resolve(new Response(JSON.stringify({ accepted: true })));
				}

				statusCalls += 1;
				if (statusCalls === 1) {
					return Promise.resolve(
						new Response(
							JSON.stringify({
								supported: true,
								nativeRegistration: true,
								running: false,
								platform: 'linux'
							})
						)
					);
				}

				return Promise.reject(new TypeError('server unavailable'));
			});
			vi.stubGlobal('fetch', fetchMock);
			const screen = render(ApplicationUpdater);
			expect(requestApplicationUpdate()).toBe(true);
			await expect.element(screen.getByRole('button', { name: 'Restart app' })).toBeEnabled();
			await screen.getByRole('button', { name: 'Restart app' }).click();
			await vi.advanceTimersByTimeAsync(31_000);
			await expect
				.element(screen.getByRole('alert'))
				.toHaveTextContent('did not return within 30 seconds');
			await screen.getByRole('button', { name: 'Close' }).click();
			await screen.unmount();
		} finally {
			vi.useRealTimers();
		}
	});
});

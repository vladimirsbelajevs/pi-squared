import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import {
	applicationUpdateEnvironment,
	applicationUpdateState,
	requestApplicationUpdate
} from '$lib/application-updater.svelte';
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

	return new Response(body, {
		headers: { 'Content-Type': 'application/x-ndjson' }
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('ApplicationUpdater', () => {
	it('opens immediately and renders streamed output and failure actions', async () => {
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

	it('does not show a snackbar when the server timestamp is fresh', async () => {
		const fetchMock = vi.fn(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						serverTime: '2026-01-10T12:00:00.000Z',
						lastCheckedAt: '2026-01-09T12:00:00.000Z',
						due: false
					})
				)
			)
		);
		vi.stubGlobal('fetch', fetchMock);
		const screen = render(ApplicationUpdater);
		await new Promise((resolve) => setTimeout(resolve, 50));
		await expect.element(screen.getByText('Update application?')).not.toBeInTheDocument();
		await screen.unmount();
	});

	it('rechecks a mounted fresh reminder when the server expiry arrives', async () => {
		vi.useFakeTimers();
		try {
			const fiveDays = 5 * 24 * 60 * 60 * 1000;
			let reminderCalls = 0;
			const fetchMock = vi.fn((input: RequestInfo | URL) => {
				if (String(input).endsWith('/api/application/reminder')) {
					reminderCalls += 1;
					const due = reminderCalls > 1;

					return Promise.resolve(
						new Response(
							JSON.stringify({
								serverTime: '2026-01-10T12:00:00.000Z',
								lastCheckedAt: '2026-01-05T12:00:00.000Z',
								due
							})
						)
					);
				}

				return Promise.reject(new Error(`Unexpected request: ${String(input)}`));
			});
			vi.stubGlobal('fetch', fetchMock);
			const screen = render(ApplicationUpdater);
			await vi.advanceTimersByTimeAsync(0);
			expect(reminderCalls).toBe(1);

			await vi.advanceTimersByTimeAsync(fiveDays);
			await vi.advanceTimersByTimeAsync(1500);
			await expect.element(screen.getByText('Update application?')).toBeVisible();
			expect(reminderCalls).toBe(3);
			await screen.unmount();
		} finally {
			vi.useRealTimers();
		}
	});

	it('revalidates a due reminder before showing it when another tab records it', async () => {
		vi.useFakeTimers();
		try {
			let reminderCalls = 0;
			const fetchMock = vi.fn((input: RequestInfo | URL) => {
				if (String(input).endsWith('/api/application/reminder')) {
					reminderCalls += 1;
					const due = reminderCalls === 1;

					return Promise.resolve(
						new Response(
							JSON.stringify({
								serverTime: '2026-01-10T12:00:00.000Z',
								lastCheckedAt: due ? '2026-01-01T12:00:00.000Z' : '2026-01-10T12:00:00.000Z',
								due
							})
						)
					);
				}

				return Promise.reject(new Error(`Unexpected request: ${String(input)}`));
			});
			vi.stubGlobal('fetch', fetchMock);
			const screen = render(ApplicationUpdater);
			await vi.advanceTimersByTimeAsync(1500);
			await expect.element(screen.getByText('Update application?')).not.toBeInTheDocument();
			expect(reminderCalls).toBe(2);
			await screen.unmount();
		} finally {
			vi.useRealTimers();
		}
	});

	it('retries a due reminder after a busy update instead of dropping it', async () => {
		vi.useFakeTimers();
		try {
			let reminderCalls = 0;
			const fetchMock = vi.fn((input: RequestInfo | URL) => {
				if (String(input).endsWith('/api/application/reminder')) {
					reminderCalls += 1;

					return Promise.resolve(
						new Response(
							JSON.stringify({
								serverTime: '2026-01-10T12:00:00.000Z',
								lastCheckedAt: '2026-01-01T12:00:00.000Z',
								due: true
							})
						)
					);
				}

				return Promise.reject(new Error(`Unexpected request: ${String(input)}`));
			});
			vi.stubGlobal('fetch', fetchMock);
			const screen = render(ApplicationUpdater);
			await vi.advanceTimersByTimeAsync(0);
			applicationUpdateState.busy = true;
			await vi.advanceTimersByTimeAsync(1500);
			await expect.element(screen.getByText('Update application?')).not.toBeInTheDocument();

			applicationUpdateState.busy = false;
			await vi.advanceTimersByTimeAsync(30_000);
			await vi.advanceTimersByTimeAsync(1500);
			await expect.element(screen.getByText('Update application?')).toBeVisible();
			expect(reminderCalls).toBe(4);
			await screen.unmount();
		} finally {
			applicationUpdateState.busy = false;
			vi.useRealTimers();
		}
	});

	it('shows a due reminder and records No on the server', async () => {
		const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input).endsWith('/api/application/reminder') && init?.method === 'POST') {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							serverTime: '2026-01-01T00:00:00.000Z',
							lastCheckedAt: '2026-01-01T00:00:00.000Z',
							due: false
						})
					)
				);
			}

			return Promise.resolve(
				new Response(
					JSON.stringify({
						serverTime: '2026-01-01T00:00:00.000Z',
						lastCheckedAt: null,
						due: true
					})
				)
			);
		});
		vi.stubGlobal('fetch', fetchMock);
		const screen = render(ApplicationUpdater);
		await expect.element(screen.getByText('Update application?')).toBeVisible();
		await screen.getByRole('button', { name: 'No' }).click();
		await expect
			.poll(() =>
				fetchMock.mock.calls.some(
					([input, init]) =>
						String(input).endsWith('/api/application/reminder') && init?.method === 'POST'
				)
			)
			.toBe(true);
		await screen.unmount();
	});

	it('records Yes and starts an update from the reminder', async () => {
		const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
			const path = String(input);
			if (path.endsWith('/api/application/update') && init?.method === 'POST') {
				return Promise.resolve(ndjsonResponse([{ type: 'complete', code: 0, signal: null }]));
			}

			if (path.endsWith('/api/application/reminder') && init?.method === 'POST') {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							serverTime: '2026-01-01T00:00:00.000Z',
							lastCheckedAt: '2026-01-01T00:00:00.000Z',
							due: false
						})
					)
				);
			}

			if (path.endsWith('/api/application/reminder')) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							serverTime: '2026-01-01T00:00:00.000Z',
							lastCheckedAt: null,
							due: true
						})
					)
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
		await expect.element(screen.getByText('Update application?')).toBeVisible();
		await screen.getByRole('button', { name: 'Yes' }).click();
		await expect.element(screen.getByRole('dialog', { name: 'Application update' })).toBeVisible();
		await expect
			.poll(() =>
				fetchMock.mock.calls.some(
					([input, init]) =>
						String(input).endsWith('/api/application/reminder') && init?.method === 'POST'
				)
			)
			.toBe(true);
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/application/update',
			expect.objectContaining({ method: 'POST' })
		);
		await screen.getByRole('button', { name: 'Close' }).click();
		await screen.unmount();
	});

	it('renders incrementally streamed chunks and keeps the terminal tail bounded', async () => {
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
		let statusCalls = 0;
		const reload = vi
			.spyOn(applicationUpdateEnvironment, 'reload')
			.mockImplementation(() => undefined);
		const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
			const path = String(input);
			if (path.endsWith('/api/application/reminder')) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							serverTime: '2026-01-01T00:00:00.000Z',
							lastCheckedAt: '2026-01-01T00:00:00.000Z',
							due: false
						})
					)
				);
			}

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
			let statusCalls = 0;
			const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
				const path = String(input);
				if (path.endsWith('/api/application/reminder')) {
					return Promise.resolve(
						new Response(
							JSON.stringify({
								serverTime: '2026-01-01T00:00:00.000Z',
								lastCheckedAt: '2026-01-01T00:00:00.000Z',
								due: false
							})
						)
					);
				}

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

import { describe, expect, it, vi } from 'vitest';
import { isSameOriginRequest, readObject } from './http';

describe('application-management request origin checks', () => {
	it('accepts same-origin browser requests and rejects cross-origin or missing origins', () => {
		const sameOrigin = new Request('http://localhost/api/application/update', {
			method: 'POST',
			headers: { Origin: 'http://localhost', 'Sec-Fetch-Site': 'same-origin' }
		});
		expect(isSameOriginRequest(sameOrigin, 'http://localhost')).toBe(true);

		const crossOrigin = new Request('http://localhost/api/application/update', {
			method: 'POST',
			headers: { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' }
		});
		expect(isSameOriginRequest(crossOrigin, 'http://localhost')).toBe(false);
		expect(
			isSameOriginRequest(
				new Request('http://localhost/api/application/update', { method: 'POST' }),
				'http://localhost'
			)
		).toBe(false);
	});

	it('rejects same-site requests that are not same-origin', () => {
		const request = new Request('http://localhost/api/application/update', {
			method: 'POST',
			headers: { Origin: 'http://localhost', 'Sec-Fetch-Site': 'same-site' }
		});

		expect(isSameOriginRequest(request, 'http://localhost')).toBe(false);
	});
});

describe('bounded JSON request parsing', () => {
	it('preserves request.json behavior when no byte limit is provided', async () => {
		const json = vi.fn().mockResolvedValue({ text: 'hello' });

		expect(await readObject({ json } as unknown as Request)).toEqual({ text: 'hello' });
		expect(json).toHaveBeenCalledOnce();
	});

	it('rejects streamed bytes beyond the limit without relying on Content-Length', async () => {
		const encoder = new TextEncoder();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode('{"text":"'));
				controller.enqueue(encoder.encode('too large"}'));
				controller.close();
			}
		});
		const request = new Request('http://localhost', {
			method: 'POST',
			body,
			// Node requires this opt-in for a streaming request body.
			duplex: 'half'
		} as RequestInit);

		expect(request.headers.has('content-length')).toBe(false);
		await expect(readObject(request, 8)).rejects.toThrow('Request body is too large.');
	});
});

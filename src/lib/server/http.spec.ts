import { describe, expect, it, vi } from 'vitest';
import { readObject } from './http';

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

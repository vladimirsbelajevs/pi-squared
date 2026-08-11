import { describe, expect, it, afterEach } from 'vitest';
import { POST as restartPost } from './restart/+server';
import { POST as shutdownPost } from './shutdown/+server';
import { POST as updatePost } from './update/+server';
import {
	claimApplicationUpdate,
	isApplicationUpdateRunning,
	releaseApplicationUpdate
} from '$lib/server/application-update';

const url = new URL('http://localhost/api/application/update');

function sameOriginRequest(path: string): Request {
	return new Request(`http://localhost${path}`, {
		method: 'POST',
		headers: { Origin: 'http://localhost', 'Sec-Fetch-Site': 'same-origin' }
	});
}

afterEach(() => {
	releaseApplicationUpdate();
	delete process.env.PI_SQUARED_DESKTOP;
	delete process.env.PI_SQUARED_SHUTDOWN_TOKEN;
});

describe('application update route guards', () => {
	it('rejects mutating requests without an exact local origin', async () => {
		const updateResponse = await updatePost({
			request: new Request(url, { method: 'POST' }),
			url
		} as never);
		const restartResponse = await restartPost({
			request: new Request(new URL('http://localhost/api/application/restart'), { method: 'POST' }),
			url: new URL('http://localhost/api/application/restart')
		} as never);

		expect(updateResponse.status).toBe(403);
		expect(restartResponse.status).toBe(403);
	});

	it('rejects a concurrent source update and disables automatic restart', async () => {
		expect(claimApplicationUpdate()).toBe(true);
		expect(isApplicationUpdateRunning()).toBe(true);

		const updateResponse = await updatePost({
			request: sameOriginRequest('/api/application/update'),
			url
		} as never);
		const restartResponse = await restartPost({
			request: sameOriginRequest('/api/application/restart'),
			url: new URL('http://localhost/api/application/restart')
		} as never);

		expect(updateResponse.status).toBe(409);
		expect(restartResponse.status).toBe(501);
	});

	it('disables repository update scripts in packaged desktop mode', async () => {
		process.env.PI_SQUARED_DESKTOP = '1';
		const response = await updatePost({
			request: sameOriginRequest('/api/application/update'),
			url
		} as never);

		expect(response.status).toBe(501);
		expect(await response.json()).toEqual({
			error: 'Desktop updates are managed by the Electron updater.'
		});
	});

	it('requires the private desktop token before disposing active runtimes', async () => {
		process.env.PI_SQUARED_DESKTOP = '1';
		process.env.PI_SQUARED_SHUTDOWN_TOKEN = 'secret';
		const endpoint = new URL('http://localhost/api/application/shutdown');
		const request = (token: string) =>
			new Request(endpoint, {
				method: 'POST',
				headers: {
					Origin: endpoint.origin,
					'Sec-Fetch-Site': 'same-origin',
					'x-pi-squared-shutdown-token': token
				}
			});

		expect((await shutdownPost({ request: request('wrong'), url: endpoint } as never)).status).toBe(
			403
		);
		expect(
			(await shutdownPost({ request: request('secret'), url: endpoint } as never)).status
		).toBe(200);
	});
});

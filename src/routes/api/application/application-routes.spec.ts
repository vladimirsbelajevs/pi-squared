import { describe, expect, it, afterEach } from 'vitest';
import { POST as restartPost } from './restart/+server';
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

	it('rejects update and restart while an update slot is claimed', async () => {
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
		expect(restartResponse.status).toBe(409);
	});
});

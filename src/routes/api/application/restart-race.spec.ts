import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const applicationManagement = vi.hoisted(() => {
	let locked = false;
	let resolveQuery: ((registered: boolean) => void) | undefined;
	const queryNativeRegistration = vi.fn(
		() =>
			new Promise<boolean>((resolve) => {
				resolveQuery = resolve;
			})
	);
	const claim = (): boolean => {
		if (locked) {
			return false;
		}

		locked = true;

		return true;
	};

	const release = (): void => {
		locked = false;
	};

	return {
		claimApplicationRestart: vi.fn(claim),
		claimApplicationUpdate: vi.fn(claim),
		createApplicationUpdateStream: vi.fn(() => new ReadableStream<Uint8Array>()),
		getApplicationUpdateStatus: vi.fn(),
		getSupportedApplicationPlatform: vi.fn(() => 'linux'),
		invokeApplicationRestart: vi.fn(async () => undefined),
		isApplicationUpdateRunning: vi.fn(() => locked),
		queryNativeRegistration,
		releaseApplicationUpdate: vi.fn(release),
		scheduleApplicationManagementRelease: vi.fn(),
		reset(): void {
			locked = false;
			resolveQuery = undefined;
			queryNativeRegistration.mockClear();
			queryNativeRegistration.mockImplementation(
				() =>
					new Promise<boolean>((resolve) => {
						resolveQuery = resolve;
					})
			);
			applicationManagement.invokeApplicationRestart.mockReset();
			applicationManagement.invokeApplicationRestart.mockResolvedValue(undefined);
			applicationManagement.releaseApplicationUpdate.mockClear();
			applicationManagement.scheduleApplicationManagementRelease.mockClear();
		},
		resolveQuery(registered = true): void {
			resolveQuery?.(registered);
		}
	};
});

vi.mock('$lib/server/application-update', () => applicationManagement);

import { POST as restartPost } from './restart/+server';
import { POST as updatePost } from './update/+server';

const restartUrl = new URL('http://localhost/api/application/restart');
const updateUrl = new URL('http://localhost/api/application/update');

function sameOriginRequest(url: URL): Request {
	return new Request(url, {
		method: 'POST',
		headers: { Origin: url.origin, 'Sec-Fetch-Site': 'same-origin' }
	});
}

afterEach(() => {
	applicationManagement.releaseApplicationUpdate();
});

beforeEach(() => {
	applicationManagement.reset();
});

describe('application restart management reservation', () => {
	it('blocks an update while restart registration is being queried', async () => {
		const restart = restartPost({
			request: sameOriginRequest(restartUrl),
			url: restartUrl
		} as never);
		await Promise.resolve();

		const update = await updatePost({
			request: sameOriginRequest(updateUrl),
			url: updateUrl
		} as never);
		expect(update.status).toBe(409);
		expect(applicationManagement.queryNativeRegistration).toHaveBeenCalledOnce();

		applicationManagement.resolveQuery();
		expect((await restart).status).toBe(200);
		expect(applicationManagement.scheduleApplicationManagementRelease).toHaveBeenCalledOnce();
	});

	it('blocks a concurrent restart while the first restart is pending', async () => {
		const firstRestart = restartPost({
			request: sameOriginRequest(restartUrl),
			url: restartUrl
		} as never);
		await Promise.resolve();

		const secondRestart = await restartPost({
			request: sameOriginRequest(restartUrl),
			url: restartUrl
		} as never);
		expect(secondRestart.status).toBe(409);

		applicationManagement.resolveQuery();
		expect((await firstRestart).status).toBe(200);
		expect(applicationManagement.invokeApplicationRestart).toHaveBeenCalledOnce();
	});

	it('releases the reservation when registration is absent or restart dispatch fails', async () => {
		applicationManagement.queryNativeRegistration.mockResolvedValueOnce(false);
		const absent = await restartPost({
			request: sameOriginRequest(restartUrl),
			url: restartUrl
		} as never);
		expect(absent.status).toBe(409);
		expect(applicationManagement.claimApplicationUpdate()).toBe(true);
		applicationManagement.releaseApplicationUpdate();

		applicationManagement.queryNativeRegistration.mockRejectedValueOnce(new Error('query failed'));
		const queryFailure = await restartPost({
			request: sameOriginRequest(restartUrl),
			url: restartUrl
		} as never);
		expect(queryFailure.status).toBe(500);
		expect(applicationManagement.claimApplicationUpdate()).toBe(true);
		applicationManagement.releaseApplicationUpdate();

		applicationManagement.queryNativeRegistration.mockResolvedValueOnce(true);
		applicationManagement.invokeApplicationRestart.mockRejectedValueOnce(new Error('spawn failed'));
		const failed = await restartPost({
			request: sameOriginRequest(restartUrl),
			url: restartUrl
		} as never);
		expect(failed.status).toBe(500);
		expect(applicationManagement.claimApplicationUpdate()).toBe(true);
	});
});

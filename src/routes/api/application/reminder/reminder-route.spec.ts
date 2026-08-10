import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';
import { getApplicationUpdateReminderPath } from '$lib/server/application-update-reminder';

const dataDirectories: string[] = [];

async function configureDataDirectory(): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), 'pi-squared-reminder-route-'));
	dataDirectories.push(directory);
	process.env.PI_SQUARED_DATA_DIR = directory;
}

afterEach(async () => {
	delete process.env.PI_SQUARED_DATA_DIR;
	await Promise.all(
		dataDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

function event(request: Request, origin = new URL(request.url)): Parameters<typeof POST>[0] {
	return { request, url: origin } as Parameters<typeof POST>[0];
}

describe('application update reminder route', () => {
	it('returns reminder status from the installation data directory', async () => {
		await configureDataDirectory();
		const response = await GET({} as Parameters<typeof GET>[0]);
		const body = (await response.json()) as {
			serverTime: string;
			lastCheckedAt: string | null;
			due: boolean;
		};

		expect(response.status).toBe(200);
		expect(body.lastCheckedAt).toBeNull();
		expect(body.due).toBe(true);
		expect(Number.isNaN(Date.parse(body.serverTime))).toBe(false);
	});

	it('rejects reminder writes without same-origin protection', async () => {
		await configureDataDirectory();
		const response = await POST(
			event(new Request('http://localhost/api/application/reminder', { method: 'POST' }))
		);

		expect(response.status).toBe(403);
	});

	it('records a same-origin reminder timestamp on the server', async () => {
		await configureDataDirectory();
		const request = new Request('http://localhost/api/application/reminder', {
			method: 'POST',
			headers: { Origin: 'http://localhost', 'Sec-Fetch-Site': 'same-origin' }
		});
		const response = await POST(event(request));
		const body = (await response.json()) as { lastCheckedAt: string | null; due: boolean };

		expect(response.status).toBe(200);
		expect(body.due).toBe(false);
		expect(body.lastCheckedAt).toBeTruthy();
		expect(JSON.parse(await readFile(getApplicationUpdateReminderPath(), 'utf8')).version).toBe(1);
	});
});

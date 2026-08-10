import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	APPLICATION_UPDATE_REMINDER_INTERVAL_MS,
	getApplicationUpdateReminder,
	getApplicationUpdateReminderPath,
	recordApplicationUpdateReminder
} from './application-update-reminder.js';

const dataDirectories: string[] = [];
const now = new Date('2026-01-10T12:00:00.000Z');

async function configureDataDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'pi-squared-reminder-'));
	dataDirectories.push(directory);
	process.env.PI_SQUARED_DATA_DIR = directory;

	return directory;
}

afterEach(async () => {
	delete process.env.PI_SQUARED_DATA_DIR;
	await Promise.all(
		dataDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

describe('application update reminder persistence', () => {
	it('treats a missing document as due and uses server time', async () => {
		await configureDataDirectory();

		expect(await getApplicationUpdateReminder(now)).toEqual({
			serverTime: now.toISOString(),
			lastCheckedAt: null,
			due: true
		});
	});

	it('distinguishes fresh and expired timestamps using the server clock', async () => {
		const directory = await configureDataDirectory();
		const path = join(directory, 'application-update-reminder.json');
		await writeFile(
			path,
			JSON.stringify({ version: 1, lastCheckedAt: new Date(now.getTime() - 1).toISOString() })
		);
		expect((await getApplicationUpdateReminder(now)).due).toBe(false);

		await writeFile(
			path,
			JSON.stringify({
				version: 1,
				lastCheckedAt: new Date(
					now.getTime() - APPLICATION_UPDATE_REMINDER_INTERVAL_MS - 1
				).toISOString()
			})
		);
		expect((await getApplicationUpdateReminder(now)).due).toBe(true);
	});

	it('treats malformed and unsupported documents as due', async () => {
		await configureDataDirectory();
		const path = getApplicationUpdateReminderPath();
		await mkdir(process.env.PI_SQUARED_DATA_DIR!, { recursive: true });

		await writeFile(path, '{not json');
		expect((await getApplicationUpdateReminder(now)).due).toBe(true);
		await writeFile(path, JSON.stringify({ version: 99, lastCheckedAt: now.toISOString() }));
		expect((await getApplicationUpdateReminder(now)).due).toBe(true);
	});

	it('records a server timestamp atomically with restrictive permissions', async () => {
		await configureDataDirectory();
		const recorded = await recordApplicationUpdateReminder(now);
		const contents = JSON.parse(await readFile(getApplicationUpdateReminderPath(), 'utf8')) as {
			version: number;
			lastCheckedAt: string;
		};

		expect(recorded).toEqual({
			serverTime: now.toISOString(),
			lastCheckedAt: now.toISOString(),
			due: false
		});
		expect(contents).toEqual({ version: 1, lastCheckedAt: now.toISOString() });
		if (process.platform !== 'win32') {
			const details = await stat(getApplicationUpdateReminderPath());
			expect(details.mode & 0o777).toBe(0o600);
		}
	});
});

import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getDataFilePath } from './data-directory.js';

export const APPLICATION_UPDATE_REMINDER_FILE = 'application-update-reminder.json';
export const APPLICATION_UPDATE_REMINDER_VERSION = 1;
export const APPLICATION_UPDATE_REMINDER_INTERVAL_MS = 5 * 24 * 60 * 60 * 1000;

interface ApplicationUpdateReminderDocument {
	version: typeof APPLICATION_UPDATE_REMINDER_VERSION;
	lastCheckedAt: string;
}

export interface ApplicationUpdateReminderStatus {
	serverTime: string;
	lastCheckedAt: string | null;
	due: boolean;
}

let writes = Promise.resolve();

export function getApplicationUpdateReminderPath(): string {
	return getDataFilePath(APPLICATION_UPDATE_REMINDER_FILE);
}

function isReminderDocument(value: unknown): value is ApplicationUpdateReminderDocument {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const document = value as Record<string, unknown>;

	return (
		document.version === APPLICATION_UPDATE_REMINDER_VERSION &&
		typeof document.lastCheckedAt === 'string' &&
		Number.isFinite(Date.parse(document.lastCheckedAt))
	);
}

async function readLastCheckedAt(): Promise<string | null> {
	try {
		const contents = await readFile(getApplicationUpdateReminderPath(), 'utf8');
		const parsed: unknown = JSON.parse(contents);

		return isReminderDocument(parsed) ? parsed.lastCheckedAt : null;
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			return null;
		}

		if (error instanceof SyntaxError) {
			return null;
		}

		throw error;
	}
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
	const result = writes.then(operation, operation);
	writes = result.then(
		() => undefined,
		() => undefined
	);

	return result;
}

export async function getApplicationUpdateReminder(
	now = new Date()
): Promise<ApplicationUpdateReminderStatus> {
	const serverTime = now.toISOString();
	const lastCheckedAt = await readLastCheckedAt();
	const due =
		lastCheckedAt === null ||
		now.getTime() - Date.parse(lastCheckedAt) >= APPLICATION_UPDATE_REMINDER_INTERVAL_MS;

	return { serverTime, lastCheckedAt, due };
}

export function recordApplicationUpdateReminder(
	now = new Date()
): Promise<ApplicationUpdateReminderStatus> {
	return serialize(async () => {
		const lastCheckedAt = now.toISOString();
		const target = getApplicationUpdateReminderPath();
		const temporary = `${target}.${randomUUID()}.tmp`;
		const document: ApplicationUpdateReminderDocument = {
			version: APPLICATION_UPDATE_REMINDER_VERSION,
			lastCheckedAt
		};

		await mkdir(dirname(target), {
			recursive: true
		});
		try {
			await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
				encoding: 'utf8',
				mode: 0o600
			});
			await chmod(temporary, 0o600);
			await rename(temporary, target);
		} finally {
			await rm(temporary, { force: true });
		}

		return { serverTime: lastCheckedAt, lastCheckedAt, due: false };
	});
}

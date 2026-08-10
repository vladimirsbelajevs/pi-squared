import { randomUUID } from 'node:crypto';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const reminderFile = 'application-update-reminder.json';
const dataDirectory = process.env.PI_SQUARED_DATA_DIR
	? resolve(process.env.PI_SQUARED_DATA_DIR)
	: platform() === 'win32'
		? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'pi-squared')
		: platform() === 'darwin'
			? join(homedir(), 'Library', 'Application Support', 'pi-squared')
			: join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'pi-squared');
if (process.argv.includes('--print-path')) {
	console.log(dataDirectory);
	process.exit(0);
}

const target = join(dataDirectory, reminderFile);
const temporary = `${target}.${randomUUID()}.tmp`;
const document = {
	version: 1,
	lastCheckedAt: new Date().toISOString()
};

await mkdir(dirname(target), { recursive: true });
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

console.log(`Initialized application update reminder at ${target}.`);

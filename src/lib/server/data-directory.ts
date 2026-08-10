import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';

export function getDataDirectory(): string {
	if (process.env.PI_SQUARED_DATA_DIR) {
		return resolve(process.env.PI_SQUARED_DATA_DIR);
	}

	if (platform() === 'win32') {
		return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'pi-squared');
	}

	if (platform() === 'darwin') {
		return join(homedir(), 'Library', 'Application Support', 'pi-squared');
	}

	return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'pi-squared');
}

export function getDataFilePath(filename: string): string {
	return join(getDataDirectory(), filename);
}

import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addProject, listProjects, removeProject } from './projects.js';

const dataDirectories: string[] = [];

afterEach(async () => {
	delete process.env.PI_SQUARED_DATA_DIR;
	await Promise.all(
		dataDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

async function configureRepository(): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), 'pi-squared-projects-'));
	dataDirectories.push(directory);
	process.env.PI_SQUARED_DATA_DIR = directory;
}

describe('project repository', () => {
	it('stores a canonical project path per installation', async () => {
		await configureRepository();
		const project = await addProject({ cwd: process.cwd(), name: 'Harness' });

		expect(project.name).toBe('Harness');
		expect(project.cwd).toBe(await realpath(process.cwd()));
		expect(await listProjects()).toEqual([project]);
	});

	it('rejects duplicate canonical directories and keeps history when a project is removed', async () => {
		await configureRepository();
		const project = await addProject({ cwd: process.cwd() });

		await expect(addProject({ cwd: process.cwd() })).rejects.toThrow('already an added project');
		await removeProject(project.id);
		expect(await listProjects()).toEqual([]);
	});
});

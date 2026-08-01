import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addProject } from './projects.js';
import { searchProjectFiles } from './project-files.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	delete process.env.PI_SQUARED_DATA_DIR;
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

async function makeTemporaryDirectory(label: string): Promise<string> {
	const { mkdtemp } = await import('node:fs/promises');
	const directory = await mkdtemp(join(tmpdir(), `pi-squared-${label}-`));
	temporaryDirectories.push(directory);

	return directory;
}

describe('project file autocomplete', () => {
	it('returns project-relative files while honoring ignores and excluding symlinked paths', async () => {
		const dataDirectory = await makeTemporaryDirectory('project-files-data');
		const projectDirectory = await makeTemporaryDirectory('project-files-project');
		const outsideDirectory = await makeTemporaryDirectory('project-files-outside');
		process.env.PI_SQUARED_DATA_DIR = dataDirectory;

		await Promise.all([
			mkdir(join(projectDirectory, '.git'), { recursive: true }),
			mkdir(join(projectDirectory, 'node_modules'), { recursive: true }),
			mkdir(join(projectDirectory, 'dist'), { recursive: true }),
			mkdir(join(projectDirectory, 'src', 'nested'), { recursive: true })
		]);
		await Promise.all([
			writeFile(join(projectDirectory, '.gitignore'), 'ignored.ts\ndist/\n*.local\n'),
			writeFile(join(projectDirectory, 'visible.ts'), ''),
			writeFile(join(projectDirectory, 'ignored.ts'), ''),
			writeFile(join(projectDirectory, 'private.local'), ''),
			writeFile(join(projectDirectory, '.git', 'hidden.ts'), ''),
			writeFile(join(projectDirectory, 'node_modules', 'dependency.ts'), ''),
			writeFile(join(projectDirectory, 'dist', 'output.ts'), ''),
			writeFile(
				join(projectDirectory, 'src', 'nested', '.gitignore'),
				'*.secret\n!allowed.secret\n'
			),
			writeFile(join(projectDirectory, 'src', 'nested', 'allowed.secret'), ''),
			writeFile(join(projectDirectory, 'src', 'nested', 'hidden.secret'), ''),
			writeFile(join(outsideDirectory, 'outside.ts'), '')
		]);
		await symlink(join(outsideDirectory, 'outside.ts'), join(projectDirectory, 'outside-link.ts'));

		const project = await addProject({ cwd: projectDirectory });
		const files = await searchProjectFiles(project.id, '');
		const paths = files.map((file) => file.path);

		expect(paths).toContain('visible.ts');
		expect(paths).toContain('src/nested/allowed.secret');
		expect(paths).not.toContain('ignored.ts');
		expect(paths).not.toContain('private.local');
		expect(paths).not.toContain('.git/hidden.ts');
		expect(paths).not.toContain('node_modules/dependency.ts');
		expect(paths).not.toContain('dist/output.ts');
		expect(paths).not.toContain('src/nested/hidden.secret');
		expect(paths).not.toContain('outside-link.ts');
	});

	it('rejects unknown projects and bounds query input', async () => {
		await expect(searchProjectFiles('missing-project', '')).rejects.toThrow('Project not found.');

		const dataDirectory = await makeTemporaryDirectory('project-files-data');
		const projectDirectory = await makeTemporaryDirectory('project-files-project');
		process.env.PI_SQUARED_DATA_DIR = dataDirectory;
		const project = await addProject({ cwd: projectDirectory });

		await expect(searchProjectFiles(project.id, 'a'.repeat(241))).rejects.toThrow(
			'File query is too long.'
		);
	});
});

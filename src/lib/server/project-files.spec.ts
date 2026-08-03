import { execFileSync } from 'node:child_process';
import { chmod, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addProject, removeProject } from './projects.js';
import {
	clearProjectFileCache,
	getProjectFileCacheStats,
	PROJECT_FILE_INDEX_MAX_CACHE_ENTRIES,
	PROJECT_FILE_INDEX_TTL_MS,
	searchProjectFiles,
	validateProjectFileCandidate
} from './project-files.js';

const temporaryDirectories: string[] = [];
const gitAvailable = (() => {
	try {
		execFileSync('git', ['--version'], { stdio: 'ignore' });

		return true;
	} catch {
		return false;
	}
})();

afterEach(async () => {
	vi.useRealTimers();
	clearProjectFileCache();
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

async function configureProject(label = 'project-files'): Promise<{
	dataDirectory: string;
	projectDirectory: string;
	project: Awaited<ReturnType<typeof addProject>>;
}> {
	const dataDirectory = await makeTemporaryDirectory(`${label}-data`);
	const projectDirectory = await makeTemporaryDirectory(`${label}-project`);
	process.env.PI_SQUARED_DATA_DIR = dataDirectory;
	const project = await addProject({ cwd: projectDirectory });

	return { dataDirectory, projectDirectory, project };
}

async function runGit(projectDirectory: string, args: string[]): Promise<void> {
	execFileSync('git', args, { cwd: projectDirectory, stdio: 'ignore' });
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

	it.skipIf(!gitAvailable)(
		'uses Git tracked-file semantics and validates its candidates',
		async () => {
			const { projectDirectory, project } = await configureProject('git-project-files');
			await runGit(projectDirectory, ['init', '-q']);
			await writeFile(join(projectDirectory, 'tracked.ts'), 'tracked');
			await writeFile(join(projectDirectory, 'ignored.ts'), 'ignored');
			await writeFile(join(projectDirectory, 'tracked-link.ts'), 'link target');
			await writeFile(join(projectDirectory, 'deleted.ts'), 'deleted');
			await runGit(projectDirectory, ['add', 'tracked.ts', 'tracked-link.ts', 'deleted.ts']);
			await rm(join(projectDirectory, 'tracked-link.ts'));
			await symlink(
				join(projectDirectory, 'tracked.ts'),
				join(projectDirectory, 'tracked-link.ts')
			);
			await writeFile(
				join(projectDirectory, '.gitignore'),
				'tracked.ts\nignored.ts\ntracked-link.ts\n'
			);
			await runGit(projectDirectory, ['add', '.gitignore']);
			await rm(join(projectDirectory, 'deleted.ts'));

			const paths = (await searchProjectFiles(project.id, '')).map((file) => file.path);

			// Git reports tracked files despite a later ignore rule, but deleted tracked
			// files and tracked symlinks are rejected before they reach autocomplete.
			expect(paths).toContain('tracked.ts');
			expect(paths).not.toContain('deleted.ts');
			expect(paths).not.toContain('tracked-link.ts');
			expect(paths).not.toContain('ignored.ts');
			expect(paths).toContain('.gitignore');
		}
	);

	it.skipIf(!gitAvailable)(
		'streams large Git listings without falling back to traversal',
		async () => {
			const { projectDirectory, project } = await configureProject('git-stream-project-files');
			const fakeGitDirectory = await makeTemporaryDirectory('git-stream-project-files-bin');
			const fakeGitPath = join(fakeGitDirectory, 'git');
			await writeFile(
				fakeGitPath,
				`#!/usr/bin/env node
const fs = require('node:fs');
let index = 0;
process.stdout.on('error', () => process.exit(0));
function emit() {
  let output = '';
  for (let count = 0; count < 100 && index <= 20000; count += 1, index += 1) {
    const path = index === 0 ? 'tracked.ts' : 'missing-' + index + '-' + 'x'.repeat(500) + '.ts';
    output += path + '\\0';
  }
  if (output) {
    process.stdout.write(output, emit);
  }
}
emit();
`,
				'utf8'
			);
			await chmod(fakeGitPath, 0o755);
			await writeFile(join(projectDirectory, 'tracked.ts'), 'tracked');
			await writeFile(join(projectDirectory, '.gitignore'), 'tracked.ts\n');
			const previousPath = process.env.PATH;
			process.env.PATH = `${fakeGitDirectory}${delimiter}${previousPath ?? ''}`;

			try {
				expect((await searchProjectFiles(project.id, 'tracked')).map((file) => file.path)).toEqual([
					'tracked.ts'
				]);
			} finally {
				if (previousPath === undefined) {
					delete process.env.PATH;
				} else {
					process.env.PATH = previousPath;
				}
			}
		}
	);

	it('rejects absolute, escaping, missing, and symlinked index candidates', async () => {
		const { projectDirectory } = await configureProject('candidate-project-files');
		const outsideDirectory = await makeTemporaryDirectory('candidate-project-files-outside');
		await writeFile(join(outsideDirectory, 'outside.ts'), '');
		await writeFile(join(projectDirectory, 'visible.ts'), '');
		await mkdir(join(projectDirectory, 'directory'), { recursive: true });
		await symlink(join(outsideDirectory, 'outside.ts'), join(projectDirectory, 'link.ts'));
		await symlink(outsideDirectory, join(projectDirectory, 'link-directory'));
		const signal = new AbortController().signal;

		expect(
			await validateProjectFileCandidate(projectDirectory, '../outside.ts', signal)
		).toBeUndefined();
		expect(
			await validateProjectFileCandidate(
				projectDirectory,
				join(projectDirectory, 'visible.ts'),
				signal
			)
		).toBeUndefined();
		expect(
			await validateProjectFileCandidate(projectDirectory, 'missing.ts', signal)
		).toBeUndefined();
		expect(
			await validateProjectFileCandidate(projectDirectory, 'directory', signal)
		).toBeUndefined();
		expect(await validateProjectFileCandidate(projectDirectory, 'link.ts', signal)).toBeUndefined();
		expect(
			await validateProjectFileCandidate(projectDirectory, 'link-directory/outside.ts', signal)
		).toBeUndefined();
		expect(await validateProjectFileCandidate(projectDirectory, 'visible.ts', signal)).toBe(
			'visible.ts'
		);
	});

	it('reuses a fresh per-project index and exposes new files after the TTL', async () => {
		const { projectDirectory, project } = await configureProject('cache-project-files');
		await writeFile(join(projectDirectory, 'initial.ts'), '');

		expect((await searchProjectFiles(project.id, 'initial')).map((file) => file.path)).toEqual([
			'initial.ts'
		]);
		await writeFile(join(projectDirectory, 'new.ts'), '');
		expect((await searchProjectFiles(project.id, 'new')).map((file) => file.path)).toEqual([]);
		expect(getProjectFileCacheStats().buildCount).toBe(1);

		vi.useFakeTimers();
		vi.setSystemTime(Date.now() + PROJECT_FILE_INDEX_TTL_MS + 1);
		expect((await searchProjectFiles(project.id, 'new')).map((file) => file.path)).toEqual([
			'new.ts'
		]);
		expect(getProjectFileCacheStats().buildCount).toBe(2);
	});

	it('revalidates cached candidates before exposing changed filesystem entries', async () => {
		const { projectDirectory, project } = await configureProject('revalidate-project-files');
		const outsideDirectory = await makeTemporaryDirectory('revalidate-project-files-outside');
		const cachedPath = join(projectDirectory, 'cached.ts');
		await writeFile(cachedPath, 'cached');
		expect((await searchProjectFiles(project.id, 'cached')).map((file) => file.path)).toEqual([
			'cached.ts'
		]);

		await rm(cachedPath);
		expect(await searchProjectFiles(project.id, 'cached')).toEqual([]);
		await symlink(join(outsideDirectory, 'outside.ts'), cachedPath);
		await writeFile(join(outsideDirectory, 'outside.ts'), 'outside');
		expect(await searchProjectFiles(project.id, 'cached')).toEqual([]);
	});

	it('shares one first index build and only aborts it after its last waiter leaves', async () => {
		const { projectDirectory, project } = await configureProject('waiter-project-files');
		await Promise.all(
			Array.from({ length: 5_000 }, (_, index) =>
				writeFile(join(projectDirectory, `file-${index}.ts`), '')
			)
		);
		const firstController = new AbortController();
		const first = searchProjectFiles(project.id, 'file', firstController.signal);
		const second = searchProjectFiles(project.id, 'file');
		await vi.waitFor(
			() => {
				expect(getProjectFileCacheStats().inFlightBuilds).toBe(1);
				expect(getProjectFileCacheStats().inFlightWaiters).toBe(2);
			},
			{ timeout: 2_000, interval: 1 }
		);
		firstController.abort();

		await expect(first).rejects.toMatchObject({ name: 'AbortError' });
		expect((await second).length).toBeGreaterThan(0);
		expect(getProjectFileCacheStats().buildCount).toBe(1);
	});

	it('cancels a traversal when its sole waiter aborts without caching or leaking rejection', async () => {
		const { projectDirectory, project } = await configureProject('sole-waiter-project-files');
		await Promise.all(
			Array.from({ length: 5_000 }, (_, index) =>
				writeFile(join(projectDirectory, `file-${index}.ts`), '')
			)
		);
		const controller = new AbortController();
		const pending = searchProjectFiles(project.id, 'file', controller.signal);
		await vi.waitFor(
			() => {
				expect(getProjectFileCacheStats().inFlightBuilds).toBe(1);
				expect(getProjectFileCacheStats().inFlightWaiters).toBe(1);
			},
			{ timeout: 2_000, interval: 1 }
		);
		controller.abort();

		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		await vi.waitFor(() => expect(getProjectFileCacheStats().inFlightBuilds).toBe(0));
		expect(getProjectFileCacheStats().cacheEntries).toBe(0);
	});

	it('bounds the indexed entries and reports a representative large-project measurement', async () => {
		const { projectDirectory, project } = await configureProject('measurement-project-files');
		const fixtureSize = 20_000;
		for (let offset = 0; offset < fixtureSize; offset += 1_000) {
			await Promise.all(
				Array.from({ length: 1_000 }, (_, index) =>
					writeFile(join(projectDirectory, `measurement-${offset + index}.ts`), '')
				)
			);
		}

		const buildStartedAt = performance.now();
		const results = await searchProjectFiles(project.id, 'measurement-199');
		const buildElapsedMs = performance.now() - buildStartedAt;
		const cachedQueryStartedAt = performance.now();
		const cachedResults = await searchProjectFiles(project.id, 'measurement-199');
		const cachedQueryElapsedMs = performance.now() - cachedQueryStartedAt;
		console.info(
			`project-file-index measurement: fixture=${fixtureSize} files, indexed=${getProjectFileCacheStats().cachedFiles}, build-ms=${buildElapsedMs.toFixed(2)}, cached-query-ms=${cachedQueryElapsedMs.toFixed(2)}, results=${cachedResults.length}`
		);

		expect(results.length).toBeGreaterThan(0);
		expect(cachedResults).toEqual(results);
		expect(getProjectFileCacheStats().cachedFiles).toBe(fixtureSize);
	});

	it('invalidates an index when the registered canonical root changes', async () => {
		const { dataDirectory, projectDirectory, project } = await configureProject(
			'root-change-project-files'
		);
		const replacementDirectory = await makeTemporaryDirectory(
			'root-change-project-files-replacement'
		);
		await writeFile(join(projectDirectory, 'old.ts'), '');
		await writeFile(join(replacementDirectory, 'new.ts'), '');
		await searchProjectFiles(project.id, '');
		await writeFile(
			join(dataDirectory, 'projects.json'),
			`${JSON.stringify({ version: 1, projects: [{ ...project, cwd: replacementDirectory }] })}\n`
		);

		expect((await searchProjectFiles(project.id, '')).map((file) => file.path)).toContain('new.ts');
		expect((await searchProjectFiles(project.id, '')).map((file) => file.path)).not.toContain(
			'old.ts'
		);
		expect(getProjectFileCacheStats().cacheEntries).toBe(1);
	});

	it('bounds the number of cached project indexes', async () => {
		const { dataDirectory } = await configureProject('cache-bound-project-files');
		for (let index = 0; index < PROJECT_FILE_INDEX_MAX_CACHE_ENTRIES + 1; index += 1) {
			const projectDirectory = await makeTemporaryDirectory(`cache-bound-${index}`);
			process.env.PI_SQUARED_DATA_DIR = dataDirectory;
			const project = await addProject({ cwd: projectDirectory });
			await writeFile(join(projectDirectory, `file-${index}.ts`), '');
			await searchProjectFiles(project.id, '');
		}

		expect(getProjectFileCacheStats().cacheEntries).toBe(PROJECT_FILE_INDEX_MAX_CACHE_ENTRIES);
	});

	it('evicts indexes when a project is removed', async () => {
		const { projectDirectory, project } = await configureProject('remove-project-files');
		await writeFile(join(projectDirectory, 'visible.ts'), '');
		await searchProjectFiles(project.id, '');
		expect(getProjectFileCacheStats().cacheEntries).toBe(1);

		await removeProject(project.id);
		expect(getProjectFileCacheStats().cacheEntries).toBe(0);
		await expect(searchProjectFiles(project.id, '')).rejects.toThrow('Project not found.');
	});

	it('rejects unknown projects and bounds query input', async () => {
		await expect(searchProjectFiles('missing-project', '')).rejects.toThrow('Project not found.');

		const { project } = await configureProject('query-project-files');
		await expect(searchProjectFiles(project.id, 'a'.repeat(241))).rejects.toThrow(
			'File query is too long.'
		);
	});
});

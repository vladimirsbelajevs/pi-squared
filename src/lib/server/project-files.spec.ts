import { execFileSync } from 'node:child_process';
import { chmod, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addProject, removeProject } from './projects.js';
import { GET as getProjectFiles } from '../../routes/api/projects/[projectId]/files/+server.js';
import {
	clearProjectFileCache,
	getProjectFileCacheStats,
	invalidateProjectFileCache,
	setProjectFileTestHooks,
	PROJECT_FILE_INDEX_MAX_ACTIVE_BUILDS,
	PROJECT_FILE_INDEX_MAX_CACHE_ENTRIES,
	PROJECT_FILE_INDEX_MAX_QUEUED_BUILDS,
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
	delete process.env.PI_SQUARED_GIT_START_LOG;
	delete process.env.PI_SQUARED_GIT_RELEASE_FILE;
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

async function installFakeGit(body: string): Promise<{ directory: string; restore: () => void }> {
	const directory = await makeTemporaryDirectory('fake-git');
	const path = join(directory, 'git');
	await writeFile(path, `#!/usr/bin/env node\n${body}\n`, 'utf8');
	await chmod(path, 0o755);
	const previousPath = process.env.PATH;
	process.env.PATH = `${directory}${delimiter}${previousPath ?? ''}`;

	return {
		directory,
		restore: () => {
			if (previousPath === undefined) {
				delete process.env.PATH;
			} else {
				process.env.PATH = previousPath;
			}
		}
	};
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise;
	});

	return { promise, resolve };
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
		const paths = files.files.map((file) => file.path);

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

			const paths = (await searchProjectFiles(project.id, '')).files.map((file) => file.path);

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
		'treats a missing Git executable in a repository as an error',
		async () => {
			const { projectDirectory, project } = await configureProject('git-missing-project-files');
			await runGit(projectDirectory, ['init', '-q']);
			await writeFile(join(projectDirectory, 'excluded.ts'), 'excluded');
			const pathWithoutGit = await makeTemporaryDirectory('path-without-git');
			const previousPath = process.env.PATH;
			process.env.PATH = pathWithoutGit;

			try {
				await expect(searchProjectFiles(project.id, 'excluded')).rejects.toThrow(
					'Project file autocomplete is unavailable.'
				);
			} finally {
				if (previousPath === undefined) {
					delete process.env.PATH;
				} else {
					process.env.PATH = previousPath;
				}
			}
		}
	);

	it.skipIf(!gitAvailable)(
		'rejects a Git listing failure instead of weakening ignore semantics',
		async () => {
			const { projectDirectory, project } = await configureProject('git-failure-project-files');
			await runGit(projectDirectory, ['init', '-q']);
			await writeFile(join(projectDirectory, 'excluded.ts'), 'excluded');
			await writeFile(join(projectDirectory, '.git', 'info', 'exclude'), 'excluded.ts\n');
			const fakeGit = await installFakeGit(
				"if (process.argv.includes('rev-parse')) { process.stdout.write('true\\n'); } else { process.stderr.write('listing failed\\n'); process.exit(17); }"
			);
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

			try {
				await expect(searchProjectFiles(project.id, 'excluded')).rejects.toThrow(
					'Project file autocomplete is unavailable.'
				);
				expect(errorSpy).toHaveBeenCalledOnce();
				expect(errorSpy.mock.calls[0]?.[1]).toMatchObject({ operation: 'listing' });
			} finally {
				errorSpy.mockRestore();
				fakeGit.restore();
			}
		}
	);

	it.skipIf(!gitAvailable)(
		'rejects malformed unterminated Git listing output without falling back to traversal',
		async () => {
			const { projectDirectory, project } = await configureProject(
				'git-malformed-listing-project-files'
			);
			await runGit(projectDirectory, ['init', '-q']);
			await writeFile(join(projectDirectory, 'malformed.ts'), 'malformed');
			const fakeGit = await installFakeGit(
				"if (process.argv.includes('rev-parse')) { process.stdout.write('true\\n'); } else { process.stdout.write('malformed.ts'); process.exit(0); }"
			);
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

			try {
				await expect(searchProjectFiles(project.id, 'malformed')).rejects.toThrow(
					'Project file autocomplete is unavailable.'
				);
				expect(errorSpy).toHaveBeenCalledOnce();
				expect(errorSpy.mock.calls[0]?.[1]).toMatchObject({ operation: 'listing' });
			} finally {
				errorSpy.mockRestore();
				fakeGit.restore();
			}
		}
	);

	it.skipIf(!gitAvailable)('supports a project inside a parent Git repository', async () => {
		const dataDirectory = await makeTemporaryDirectory('parent-git-data');
		const parentDirectory = await makeTemporaryDirectory('parent-git-root');
		const projectDirectory = join(parentDirectory, 'nested');
		process.env.PI_SQUARED_DATA_DIR = dataDirectory;
		await mkdir(projectDirectory, { recursive: true });
		await writeFile(join(projectDirectory, 'nested.ts'), 'nested');
		await runGit(parentDirectory, ['init', '-q']);
		await runGit(parentDirectory, ['add', 'nested/nested.ts']);
		const project = await addProject({ cwd: projectDirectory });

		expect((await searchProjectFiles(project.id, 'nested')).files.map((file) => file.path)).toEqual(
			['nested.ts']
		);
	});

	it.skipIf(!gitAvailable)('supports Git worktrees with a .git file', async () => {
		const dataDirectory = await makeTemporaryDirectory('worktree-git-data');
		const sourceDirectory = await makeTemporaryDirectory('worktree-git-source');
		const worktreeDirectory = join(await makeTemporaryDirectory('worktree-git-parent'), 'checkout');
		process.env.PI_SQUARED_DATA_DIR = dataDirectory;
		await runGit(sourceDirectory, ['init', '-q']);
		await runGit(sourceDirectory, ['config', 'user.email', 'tests@example.com']);
		await runGit(sourceDirectory, ['config', 'user.name', 'Tests']);
		await writeFile(join(sourceDirectory, 'source.ts'), 'source');
		await runGit(sourceDirectory, ['add', 'source.ts']);
		await runGit(sourceDirectory, ['commit', '-qm', 'initial']);
		await runGit(sourceDirectory, ['worktree', 'add', '-q', worktreeDirectory]);
		await writeFile(join(worktreeDirectory, 'worktree.ts'), 'worktree');
		const project = await addProject({ cwd: worktreeDirectory });

		expect(
			(await searchProjectFiles(project.id, 'worktree')).files.map((file) => file.path)
		).toEqual(['worktree.ts']);
	});

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
if (process.argv.includes('rev-parse')) {
  process.stdout.write('true\\n');
  process.exit(0);
}
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
				expect(
					(await searchProjectFiles(project.id, 'tracked')).files.map((file) => file.path)
				).toEqual(['tracked.ts']);
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

		expect(
			(await searchProjectFiles(project.id, 'initial')).files.map((file) => file.path)
		).toEqual(['initial.ts']);
		await writeFile(join(projectDirectory, 'new.ts'), '');
		expect((await searchProjectFiles(project.id, 'new')).files.map((file) => file.path)).toEqual(
			[]
		);
		expect(getProjectFileCacheStats().buildCount).toBe(1);

		vi.useFakeTimers();
		vi.setSystemTime(Date.now() + PROJECT_FILE_INDEX_TTL_MS + 1);
		expect((await searchProjectFiles(project.id, 'new')).files.map((file) => file.path)).toEqual([
			'new.ts'
		]);
		expect(getProjectFileCacheStats().buildCount).toBe(2);
	});

	it('reports only the remaining server index freshness near TTL expiry', async () => {
		const { projectDirectory, project } = await configureProject('freshness-project-files');
		await writeFile(join(projectDirectory, 'fresh.ts'), '');
		vi.useFakeTimers();
		const builtAt = Date.now();
		await searchProjectFiles(project.id, 'fresh');
		vi.setSystemTime(builtAt + PROJECT_FILE_INDEX_TTL_MS - 250);

		const result = await searchProjectFiles(project.id, 'fresh');

		expect(result.files.map((file) => file.path)).toEqual(['fresh.ts']);
		expect(result.freshForMs).toBeGreaterThan(0);
		expect(result.freshForMs).toBeLessThanOrEqual(250);
	});

	it('propagates freshness through the files endpoint before discovering a new file', async () => {
		const { projectDirectory, project } = await configureProject(
			'endpoint-freshness-project-files'
		);
		await writeFile(join(projectDirectory, 'initial.ts'), '');
		vi.useFakeTimers();
		const startedAt = Date.now();
		const firstResponse = await getProjectFiles({
			params: { projectId: project.id },
			request: new Request(`http://localhost/api/projects/${project.id}/files?q=initial`),
			url: new URL(`http://localhost/api/projects/${project.id}/files?q=initial`)
		} as Parameters<typeof getProjectFiles>[0]);
		const firstBody = (await firstResponse.json()) as {
			files: Array<{ path: string }>;
			freshForMs: number;
		};
		expect(firstResponse.ok).toBe(true);
		expect(firstBody.freshForMs).toBeGreaterThan(0);
		expect(firstBody.files.map((file) => file.path)).toEqual(['initial.ts']);

		await writeFile(join(projectDirectory, 'new.ts'), '');
		vi.setSystemTime(startedAt + firstBody.freshForMs + 1);
		const secondResponse = await getProjectFiles({
			params: { projectId: project.id },
			request: new Request(`http://localhost/api/projects/${project.id}/files?q=new`),
			url: new URL(`http://localhost/api/projects/${project.id}/files?q=new`)
		} as Parameters<typeof getProjectFiles>[0]);
		const secondBody = (await secondResponse.json()) as {
			files: Array<{ path: string }>;
			freshForMs: number;
		};

		expect(secondResponse.ok).toBe(true);
		expect(secondBody.files.map((file) => file.path)).toEqual(['new.ts']);
	});

	it('revalidates cached candidates before exposing changed filesystem entries', async () => {
		const { projectDirectory, project } = await configureProject('revalidate-project-files');
		const outsideDirectory = await makeTemporaryDirectory('revalidate-project-files-outside');
		const cachedPath = join(projectDirectory, 'cached.ts');
		await writeFile(cachedPath, 'cached');
		expect((await searchProjectFiles(project.id, 'cached')).files.map((file) => file.path)).toEqual(
			['cached.ts']
		);

		await rm(cachedPath);
		expect((await searchProjectFiles(project.id, 'cached')).files).toEqual([]);
		await symlink(join(outsideDirectory, 'outside.ts'), cachedPath);
		await writeFile(join(outsideDirectory, 'outside.ts'), 'outside');
		expect((await searchProjectFiles(project.id, 'cached')).files).toEqual([]);
	});

	it('revokes a paused cached query when its project is removed', async () => {
		const { projectDirectory, project } = await configureProject('remove-race-project-files');
		await writeFile(join(projectDirectory, 'old.ts'), '');
		await searchProjectFiles(project.id, 'old');
		const gate = deferred();
		const started = deferred();
		setProjectFileTestHooks({
			beforeCandidateRevalidation: async (root, path) => {
				if (root === projectDirectory && path === 'old.ts') {
					started.resolve();
					await gate.promise;
				}
			}
		});
		const pending = searchProjectFiles(project.id, 'old');
		await started.promise;
		await removeProject(project.id);
		gate.resolve();

		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		expect(getProjectFileCacheStats().invalidationStates).toBe(0);
	});

	it('rejects an old-root query while replacement-root search proceeds', async () => {
		const { dataDirectory, projectDirectory, project } =
			await configureProject('root-race-project-files');
		const replacementDirectory = await makeTemporaryDirectory('root-race-replacement');
		await writeFile(join(projectDirectory, 'old.ts'), '');
		await writeFile(join(replacementDirectory, 'new.ts'), '');
		await searchProjectFiles(project.id, 'old');
		const gate = deferred();
		const started = deferred();
		setProjectFileTestHooks({
			beforeCandidateRevalidation: async (root, path) => {
				if (root === projectDirectory && path === 'old.ts') {
					started.resolve();
					await gate.promise;
				}
			}
		});
		const oldSearch = searchProjectFiles(project.id, 'old');
		await started.promise;
		await writeFile(
			join(dataDirectory, 'projects.json'),
			`${JSON.stringify({ version: 1, projects: [{ ...project, cwd: replacementDirectory }] })}\n`
		);

		const replacement = await searchProjectFiles(project.id, 'new');
		gate.resolve();

		await expect(oldSearch).rejects.toMatchObject({ name: 'AbortError' });
		expect(replacement.files.map((file) => file.path)).toEqual(['new.ts']);
	});

	it('does not revoke an authorized query on LRU eviction but does on explicit invalidation', async () => {
		const { dataDirectory, projectDirectory, project } =
			await configureProject('lru-race-project-files');
		await writeFile(join(projectDirectory, 'old.ts'), '');
		vi.useFakeTimers();
		await searchProjectFiles(project.id, 'old');
		const lruGate = deferred();
		const lruStarted = deferred();
		setProjectFileTestHooks({
			beforeCandidateRevalidation: async (root, path) => {
				if (root === projectDirectory && path === 'old.ts') {
					lruStarted.resolve();
					await lruGate.promise;
				}
			}
		});
		const lruSearch = searchProjectFiles(project.id, 'old');
		await lruStarted.promise;
		for (let index = 0; index < PROJECT_FILE_INDEX_MAX_CACHE_ENTRIES + 1; index += 1) {
			vi.setSystemTime(Date.now() + 1);
			const extraDirectory = await makeTemporaryDirectory(`lru-extra-${index}`);
			await writeFile(join(extraDirectory, `extra-${index}.ts`), '');
			process.env.PI_SQUARED_DATA_DIR = dataDirectory;
			const extraProject = await addProject({ cwd: extraDirectory });
			await searchProjectFiles(extraProject.id, '');
		}

		lruGate.resolve();
		await expect(lruSearch).resolves.toMatchObject({ files: [{ path: 'old.ts' }] });

		const explicitDirectory = await makeTemporaryDirectory('explicit-invalidation-project');
		await writeFile(join(explicitDirectory, 'explicit.ts'), '');
		process.env.PI_SQUARED_DATA_DIR = dataDirectory;
		const explicitProject = await addProject({ cwd: explicitDirectory });
		await searchProjectFiles(explicitProject.id, 'explicit');
		const explicitGate = deferred();
		const explicitStarted = deferred();
		setProjectFileTestHooks({
			beforeCandidateRevalidation: async (root, path) => {
				if (root === explicitDirectory && path === 'explicit.ts') {
					explicitStarted.resolve();
					await explicitGate.promise;
				}
			}
		});
		const explicitSearch = searchProjectFiles(explicitProject.id, 'explicit');
		await explicitStarted.promise;
		const beforeInvalidate = getProjectFileCacheStats().cacheEntries;
		invalidateProjectFileCache(explicitProject.id);
		expect(getProjectFileCacheStats().cacheEntries).toBe(beforeInvalidate - 1);
		explicitGate.resolve();

		await expect(explicitSearch).rejects.toMatchObject({ name: 'AbortError' });
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
		expect((await second).files.length).toBeGreaterThan(0);
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

	it('cancels a shared Git build while probing when its sole waiter aborts', async () => {
		const { projectDirectory, project } = await configureProject(
			'probe-cancellation-project-files'
		);
		await writeFile(join(projectDirectory, 'file.ts'), '');
		const fakeGit = await installFakeGit(
			"if (process.argv.includes('rev-parse')) { setTimeout(() => process.stdout.write('true\\n'), 5000); } else { setTimeout(() => process.stdout.write('file.ts\\0'), 5000); }"
		);
		const controller = new AbortController();
		try {
			const pending = searchProjectFiles(project.id, 'file', controller.signal);
			await vi.waitFor(() => expect(getProjectFileCacheStats().activeBuilds).toBe(1));
			controller.abort();
			await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		} finally {
			fakeGit.restore();
		}
	});

	it('cancels a shared Git build while listing when its sole waiter aborts', async () => {
		const { projectDirectory, project } = await configureProject(
			'listing-cancellation-project-files'
		);
		await writeFile(join(projectDirectory, 'file.ts'), '');
		const fakeGit = await installFakeGit(
			"if (process.argv.includes('rev-parse')) { process.stdout.write('true\\n'); } else { setTimeout(() => process.stdout.write('file.ts\\0'), 5000); }"
		);
		const controller = new AbortController();
		try {
			const pending = searchProjectFiles(project.id, 'file', controller.signal);
			await vi.waitFor(() => expect(getProjectFileCacheStats().activeBuilds).toBe(1));
			await new Promise((resolve) => setImmediate(resolve));
			controller.abort();
			await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		} finally {
			fakeGit.restore();
		}
	});

	it('shares queued same-key waiters and cancels only after the final waiter leaves', async () => {
		const { dataDirectory } = await configureProject('queued-waiter-project-files');
		const startLogDirectory = await makeTemporaryDirectory('queued-waiter-start-log');
		const startLog = join(startLogDirectory, 'starts.log');
		process.env.PI_SQUARED_GIT_START_LOG = startLog;
		const fakeGit = await installFakeGit(
			"const fs = require('node:fs'); const path = require('node:path'); if (process.argv.includes('rev-parse')) { process.stdout.write('true\\n'); } else { fs.appendFileSync(process.env.PI_SQUARED_GIT_START_LOG, path.basename(process.cwd()) + '\\n'); setTimeout(() => process.stdout.write('file.ts\\0'), 5000); }"
		);
		const activeControllers: AbortController[] = [];
		const activeSearches: Array<Promise<unknown>> = [];
		try {
			for (let index = 0; index < PROJECT_FILE_INDEX_MAX_ACTIVE_BUILDS; index += 1) {
				const directory = await makeTemporaryDirectory(`queued-active-${index}`);
				await writeFile(join(directory, 'file.ts'), '');
				process.env.PI_SQUARED_DATA_DIR = dataDirectory;
				const project = await addProject({ cwd: directory });
				const controller = new AbortController();
				activeControllers.push(controller);
				activeSearches.push(searchProjectFiles(project.id, 'file', controller.signal));
				await vi.waitFor(() => expect(getProjectFileCacheStats().activeBuilds).toBe(index + 1));
			}

			const queuedDirectory = await makeTemporaryDirectory('queued-final-waiter');
			await writeFile(join(queuedDirectory, 'file.ts'), '');
			process.env.PI_SQUARED_DATA_DIR = dataDirectory;
			const queuedProject = await addProject({ cwd: queuedDirectory });
			const firstController = new AbortController();
			const secondController = new AbortController();
			const first = searchProjectFiles(queuedProject.id, 'file', firstController.signal);
			await vi.waitFor(() => {
				expect(getProjectFileCacheStats().queuedBuilds).toBe(1);
				expect(getProjectFileCacheStats().inFlightWaiters).toBe(
					PROJECT_FILE_INDEX_MAX_ACTIVE_BUILDS + 1
				);
			});
			const second = searchProjectFiles(queuedProject.id, 'file', secondController.signal);
			await vi.waitFor(() =>
				expect(getProjectFileCacheStats().inFlightWaiters).toBe(
					PROJECT_FILE_INDEX_MAX_ACTIVE_BUILDS + 2
				)
			);

			firstController.abort();
			await expect(first).rejects.toMatchObject({ name: 'AbortError' });
			expect(getProjectFileCacheStats().queuedBuilds).toBe(1);
			expect(getProjectFileCacheStats().inFlightWaiters).toBe(
				PROJECT_FILE_INDEX_MAX_ACTIVE_BUILDS + 1
			);
			expect(await readFile(startLog, 'utf8')).not.toContain(queuedDirectory.split(sep).at(-1));

			secondController.abort();
			await expect(second).rejects.toMatchObject({ name: 'AbortError' });
			await vi.waitFor(() => expect(getProjectFileCacheStats().queuedBuilds).toBe(0));
			expect(getProjectFileCacheStats().buildCount).toBe(PROJECT_FILE_INDEX_MAX_ACTIVE_BUILDS);
			expect(await readFile(startLog, 'utf8')).not.toContain(queuedDirectory.split(sep).at(-1));
		} finally {
			for (const controller of activeControllers) {
				controller.abort();
			}

			await Promise.allSettled(activeSearches);
			fakeGit.restore();
		}
	});

	it('limits concurrent distinct project builds and starts queued work FIFO', async () => {
		const { dataDirectory } = await configureProject('scheduler-project-files');
		const startLogDirectory = await makeTemporaryDirectory('scheduler-start-log');
		const startLog = join(startLogDirectory, 'starts.log');
		const releaseFile = join(startLogDirectory, 'release');
		process.env.PI_SQUARED_GIT_START_LOG = startLog;
		process.env.PI_SQUARED_GIT_RELEASE_FILE = releaseFile;
		const fakeGit = await installFakeGit(
			"const fs = require('node:fs'); const path = require('node:path'); if (process.argv.includes('rev-parse')) { process.stdout.write('true\\n'); } else { fs.appendFileSync(process.env.PI_SQUARED_GIT_START_LOG, path.basename(process.cwd()) + '\\n'); const poll = setInterval(() => { if (fs.existsSync(process.env.PI_SQUARED_GIT_RELEASE_FILE)) { clearInterval(poll); process.stdout.write('file.ts\\0'); } }, 5); }"
		);
		const projects: Array<{ id: string; directory: string }> = [];
		const controllers: AbortController[] = [];
		const searches: Array<Promise<unknown>> = [];
		const enqueuedRoots: string[] = [];
		const startedRoots: string[] = [];
		setProjectFileTestHooks({
			onIndexBuildEnqueued: (root) => enqueuedRoots.push(root),
			onIndexBuildStarted: (root) => startedRoots.push(root)
		});
		try {
			for (let index = 0; index < PROJECT_FILE_INDEX_MAX_ACTIVE_BUILDS + 2; index += 1) {
				const directory = await makeTemporaryDirectory(`scheduler-project-${index}`);
				await writeFile(join(directory, 'file.ts'), '');
				process.env.PI_SQUARED_DATA_DIR = dataDirectory;
				const project = await addProject({ cwd: directory });
				projects.push({ id: project.id, directory });
			}

			for (let index = 0; index < PROJECT_FILE_INDEX_MAX_ACTIVE_BUILDS; index += 1) {
				const { id } = projects[index];
				const controller = new AbortController();
				controllers.push(controller);
				searches.push(searchProjectFiles(id, 'file', controller.signal));
				await vi.waitFor(() => expect(getProjectFileCacheStats().activeBuilds).toBe(index + 1));
			}

			for (let index = PROJECT_FILE_INDEX_MAX_ACTIVE_BUILDS; index < projects.length; index += 1) {
				const { id } = projects[index];
				const controller = new AbortController();
				controllers.push(controller);
				searches.push(searchProjectFiles(id, 'file', controller.signal));
				await vi.waitFor(() =>
					expect(getProjectFileCacheStats().queuedBuilds).toBe(
						index - PROJECT_FILE_INDEX_MAX_ACTIVE_BUILDS + 1
					)
				);
			}

			const started = (await readFile(startLog, 'utf8')).trim().split(/\r?\n/);
			expect(enqueuedRoots).toHaveLength(projects.length);
			expect(new Set(enqueuedRoots)).toEqual(new Set(projects.map(({ directory }) => directory)));
			expect(started).toEqual(
				enqueuedRoots
					.slice(0, PROJECT_FILE_INDEX_MAX_ACTIVE_BUILDS)
					.map((root) => root.split(sep).at(-1))
			);
			await writeFile(releaseFile, 'release');
			await Promise.all(searches);
			const allStarted = (await readFile(startLog, 'utf8')).trim().split(/\r?\n/);
			expect(startedRoots).toEqual(enqueuedRoots);
			expect(new Set(allStarted)).toEqual(
				new Set(enqueuedRoots.map((root) => root.split(sep).at(-1)))
			);
			expect(getProjectFileCacheStats().activeBuilds).toBe(0);
			expect(getProjectFileCacheStats().queuedBuilds).toBe(0);
		} finally {
			for (const controller of controllers) {
				controller.abort();
			}

			await Promise.allSettled(searches);
			fakeGit.restore();
		}
	});

	it('rejects a distinct build when the pending queue is full without changing limits', async () => {
		const { dataDirectory } = await configureProject('queue-limit-project-files');
		const fakeGit = await installFakeGit(
			"if (process.argv.includes('rev-parse')) { process.stdout.write('true\\n'); } else { setTimeout(() => process.stdout.write('file.ts\\0'), 5000); }"
		);
		const searches: Array<Promise<unknown>> = [];
		const controllers: AbortController[] = [];
		try {
			for (let index = 0; index < PROJECT_FILE_INDEX_MAX_ACTIVE_BUILDS; index += 1) {
				const directory = await makeTemporaryDirectory(`queue-limit-active-${index}`);
				await writeFile(join(directory, 'file.ts'), '');
				process.env.PI_SQUARED_DATA_DIR = dataDirectory;
				const project = await addProject({ cwd: directory });
				const controller = new AbortController();
				controllers.push(controller);
				searches.push(searchProjectFiles(project.id, 'file', controller.signal));
				await vi.waitFor(() => expect(getProjectFileCacheStats().activeBuilds).toBe(index + 1));
			}

			for (let index = 0; index < PROJECT_FILE_INDEX_MAX_QUEUED_BUILDS; index += 1) {
				const directory = await makeTemporaryDirectory(`queue-limit-queued-${index}`);
				await writeFile(join(directory, 'file.ts'), '');
				process.env.PI_SQUARED_DATA_DIR = dataDirectory;
				const project = await addProject({ cwd: directory });
				const controller = new AbortController();
				controllers.push(controller);
				searches.push(searchProjectFiles(project.id, 'file', controller.signal));
				await vi.waitFor(() => expect(getProjectFileCacheStats().queuedBuilds).toBe(index + 1));
			}

			const extraDirectory = await makeTemporaryDirectory('queue-limit-extra');
			await writeFile(join(extraDirectory, 'file.ts'), '');
			process.env.PI_SQUARED_DATA_DIR = dataDirectory;
			const extraProject = await addProject({ cwd: extraDirectory });
			const before = getProjectFileCacheStats();
			const rejected = searchProjectFiles(extraProject.id, 'file');
			await expect(rejected).rejects.toThrow('Project file autocomplete is busy.');
			const after = getProjectFileCacheStats();
			expect(after.activeBuilds).toBe(before.activeBuilds);
			expect(after.queuedBuilds).toBe(before.queuedBuilds);
			expect(after.inFlightBuilds).toBe(before.inFlightBuilds);
		} finally {
			for (const controller of controllers) {
				controller.abort();
			}

			await Promise.allSettled(searches);
			fakeGit.restore();
		}
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
			`project-file-index measurement: fixture=${fixtureSize} files, indexed=${getProjectFileCacheStats().cachedFiles}, build-ms=${buildElapsedMs.toFixed(2)}, cached-query-ms=${cachedQueryElapsedMs.toFixed(2)}, results=${cachedResults.files.length}`
		);

		expect(results.files.length).toBeGreaterThan(0);
		expect(cachedResults.files).toEqual(results.files);
		expect(cachedResults.freshForMs).toBeGreaterThan(0);
		expect(getProjectFileCacheStats().cachedFiles).toBe(fixtureSize);
	});

	it('revokes completed indexes and generation state on explicit invalidation', async () => {
		const { projectDirectory, project } = await configureProject('invalidation-race-project-files');
		await writeFile(join(projectDirectory, 'old.ts'), '');
		await searchProjectFiles(project.id, 'old');
		expect(getProjectFileCacheStats().cacheEntries).toBe(1);

		invalidateProjectFileCache(project.id);
		expect(getProjectFileCacheStats().cacheEntries).toBe(0);
		expect(getProjectFileCacheStats().invalidationStates).toBe(0);

		await writeFile(join(projectDirectory, 'new.ts'), '');
		const replacement = await searchProjectFiles(project.id, 'new');
		expect(replacement.files.map((file) => file.path)).toEqual(['new.ts']);
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

		expect((await searchProjectFiles(project.id, '')).files.map((file) => file.path)).toContain(
			'new.ts'
		);
		expect((await searchProjectFiles(project.id, '')).files.map((file) => file.path)).not.toContain(
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

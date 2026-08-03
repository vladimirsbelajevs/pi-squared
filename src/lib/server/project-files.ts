import { spawn } from 'node:child_process';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import ignore from 'ignore';
import type { ProjectFileSuggestion } from '$lib/contracts';
import { resolveProject } from '$lib/server/projects';

const MAX_QUERY_LENGTH = 240;
const MAX_SCANNED_ENTRIES = 20_000;
const MAX_INDEXED_FILES = 20_000;
const MAX_RESULTS = 30;
export const PROJECT_FILE_INDEX_MAX_CACHE_ENTRIES = 32;

/**
 * A project file index is retained for 30 seconds. This keeps normal autocomplete
 * queries in memory while allowing newly created files to appear without an explicit
 * invalidation signal from the editor.
 */
export const PROJECT_FILE_INDEX_TTL_MS = 30_000;
const MAX_GIT_CANDIDATES = 20_000;
const MAX_GIT_PATH_BYTES = 1 * 1024 * 1024;
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules']);

type FileIndex = {
	paths: string[];
	builtAt: number;
	lastAccessedAt: number;
};

type IndexBuild = {
	controller: AbortController;
	waiters: number;
	finished: boolean;
	promise: Promise<FileIndex>;
};

interface DirectoryToScan {
	absolutePath: string;
	relativePath: string;
}

interface ScoredPath {
	path: string;
	score: number;
}

const indexes = new Map<string, FileIndex>();
const builds = new Map<string, IndexBuild>();
let buildCount = 0;

function createAbortError(): Error {
	const error = new Error('File search was aborted.');
	error.name = 'AbortError';

	return error;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw createAbortError();
	}
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
	return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError');
}

function toProjectPath(path: string): string {
	return path.split(sep).join('/');
}

function normalizeQuery(query: string): string {
	if (query.length > MAX_QUERY_LENGTH) {
		throw new Error('File query is too long.');
	}

	return query.trim().replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase();
}

function prefixIgnorePattern(pattern: string, directory: string): string | undefined {
	const trimmed = pattern.trim();
	if (!trimmed || trimmed.startsWith('#')) {
		return undefined;
	}

	const negated = trimmed.startsWith('!');
	const body = (negated ? trimmed.slice(1) : trimmed).replace(/^\//, '');
	if (!body) {
		return undefined;
	}

	if (!directory) {
		return `${negated ? '!' : ''}${body}`;
	}

	const scoped = body.includes('/') ? body : `**/${body}`;

	return `${negated ? '!' : ''}${directory}/${scoped}`;
}

async function addIgnoreFile(
	ignored: ReturnType<typeof ignore>,
	directory: DirectoryToScan,
	signal: AbortSignal
): Promise<void> {
	throwIfAborted(signal);
	try {
		const contents = await readFile(join(directory.absolutePath, '.gitignore'), 'utf8');
		const patterns = contents
			.split(/\r?\n/)
			.map((line) => prefixIgnorePattern(line, directory.relativePath))
			.filter((pattern): pattern is string => pattern !== undefined);
		if (patterns.length) {
			ignored.add(patterns);
		}
	} catch (error) {
		if (isAbortError(error, signal)) {
			throw createAbortError();
		}

		if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
			return;
		}
	}
}

function scorePath(path: string, query: string): number | undefined {
	if (!query) {
		return 7;
	}

	const name = basename(path).toLowerCase();
	if (path === query) {
		return 0;
	}

	if (path.startsWith(query)) {
		return 1;
	}

	if (name.startsWith(query)) {
		return 2;
	}

	if (path.includes(`/${query}`)) {
		return 3;
	}

	if (name.includes(query)) {
		return 4;
	}

	if (path.includes(query)) {
		return 5;
	}

	return undefined;
}

function isIgnored(ignored: ReturnType<typeof ignore>, path: string): boolean {
	try {
		return ignored.ignores(path);
	} catch {
		return false;
	}
}

function cacheKey(projectId: string, root: string): string {
	return `${projectId}\u0000${root}`;
}

function projectIdFromCacheKey(key: string): string {
	return key.slice(0, key.indexOf('\u0000'));
}

function isInsideRoot(root: string, candidate: string): boolean {
	const resolved = relative(root, candidate);

	return (
		resolved !== '' &&
		resolved !== '..' &&
		!resolved.startsWith(`..${sep}`) &&
		!isAbsolute(resolved)
	);
}

/**
 * Validate a candidate returned by Git or the fallback traversal before putting it
 * into the index. Git can report deleted tracked files and tracked symlinks, while a
 * concurrent filesystem change can make a fallback entry disappear.
 */
export async function validateProjectFileCandidate(
	root: string,
	candidate: string,
	signal?: AbortSignal
): Promise<string | undefined> {
	throwIfAborted(signal);
	if (!candidate || candidate.includes('\0')) {
		return undefined;
	}

	const candidatePath = candidate.split('/').join(sep);
	if (candidatePath.split(sep).some((segment) => segment === '..')) {
		return undefined;
	}

	if (isAbsolute(candidatePath)) {
		return undefined;
	}

	const absolutePath = join(root, candidatePath);
	if (!isInsideRoot(root, absolutePath)) {
		return undefined;
	}

	try {
		const relativePath = relative(root, absolutePath);
		const segments = relativePath.split(sep);
		let currentPath = root;
		for (const [index, segment] of segments.entries()) {
			currentPath = join(currentPath, segment);
			const details = await lstat(currentPath);
			if (details.isSymbolicLink()) {
				return undefined;
			}

			if (index === segments.length - 1 ? !details.isFile() : !details.isDirectory()) {
				return undefined;
			}
		}

		const canonicalPath = await realpath(absolutePath);
		if (!isInsideRoot(root, canonicalPath)) {
			return undefined;
		}

		return toProjectPath(relative(root, absolutePath));
	} catch (error) {
		if (isAbortError(error, signal)) {
			throw createAbortError();
		}

		return undefined;
	}
}

function stopGitChild(child: ReturnType<typeof spawn>): void {
	if (child.exitCode === null && child.signalCode === null) {
		child.kill();
	}
}

/**
 * Read Git's NUL-delimited output incrementally. The child is deliberately stopped
 * after the candidate bound, rather than buffering an unbounded listing or allowing
 * execFile's maxBuffer failure to silently change Git ignore semantics.
 */
async function runGit(root: string, signal: AbortSignal): Promise<string[]> {
	throwIfAborted(signal);
	const child = spawn('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
		cwd: root,
		shell: false,
		stdio: ['ignore', 'pipe', 'pipe'],
		signal
	});
	if (!child.stdout || !child.stderr) {
		throw new Error('Git file listing did not provide output streams.');
	}

	const paths: string[] = [];
	const seen = new Set<string>();
	let buffered = Buffer.alloc(0);
	let candidateCount = 0;
	let deliberatelyStopped = false;
	let stderr = '';
	let childError: Error | undefined;
	child.on('error', (error) => {
		childError = error;
	});
	child.stderr.on('data', (chunk: Buffer | string) => {
		if (stderr.length < 4096) {
			stderr += chunk.toString().slice(0, 4096 - stderr.length);
		}
	});

	try {
		for await (const chunk of child.stdout) {
			throwIfAborted(signal);
			buffered = Buffer.concat([buffered, Buffer.from(chunk)]);
			if (buffered.length > MAX_GIT_PATH_BYTES) {
				throw new Error('Git returned an excessively long file path.');
			}

			while (true) {
				const separator = buffered.indexOf(0);
				if (separator === -1) {
					break;
				}

				const candidate = buffered.subarray(0, separator).toString('utf8');
				buffered = buffered.subarray(separator + 1);
				candidateCount += 1;
				const path = await validateProjectFileCandidate(root, candidate, signal);
				if (path && !seen.has(path)) {
					seen.add(path);
					paths.push(path);
				}

				if (candidateCount >= MAX_GIT_CANDIDATES) {
					deliberatelyStopped = true;
					stopGitChild(child);
					break;
				}
			}

			if (deliberatelyStopped) {
				break;
			}
		}

		if (!deliberatelyStopped && buffered.length) {
			candidateCount += 1;
			if (candidateCount <= MAX_GIT_CANDIDATES) {
				const path = await validateProjectFileCandidate(root, buffered.toString('utf8'), signal);
				if (path && !seen.has(path)) {
					seen.add(path);
					paths.push(path);
				}
			}
		}

		if (deliberatelyStopped) {
			return paths.sort((a, b) => a.localeCompare(b));
		}

		if (childError) {
			throw childError;
		}

		if (child.exitCode !== 0) {
			throw new Error(`Git file listing failed${stderr ? `: ${stderr.trim()}` : '.'}`);
		}

		return paths.sort((a, b) => a.localeCompare(b));
	} catch (error) {
		if (isAbortError(error, signal)) {
			throw createAbortError();
		}

		throw error;
	} finally {
		if (!deliberatelyStopped) {
			stopGitChild(child);
		}
	}
}

/**
 * Git includes tracked files even when an ignore rule matches them. `--exclude-standard`
 * applies to untracked files only, so this intentionally differs from the fallback's
 * ignore-aware traversal, which has no Git index to distinguish tracked files.
 */
async function buildGitIndex(root: string, signal: AbortSignal): Promise<string[] | undefined> {
	try {
		return await runGit(root, signal);
	} catch (error) {
		if (isAbortError(error, signal)) {
			throw createAbortError();
		}

		return undefined;
	}
}

async function buildFallbackIndex(root: string, signal: AbortSignal): Promise<string[]> {
	const ignored = ignore();
	const directories: DirectoryToScan[] = [{ absolutePath: root, relativePath: '' }];
	const paths: string[] = [];
	let scannedEntries = 0;

	while (
		directories.length &&
		scannedEntries < MAX_SCANNED_ENTRIES &&
		paths.length < MAX_INDEXED_FILES
	) {
		throwIfAborted(signal);
		const directory = directories.pop();
		if (!directory) {
			break;
		}

		await addIgnoreFile(ignored, directory, signal);

		let entries;
		try {
			entries = await readdir(directory.absolutePath, { withFileTypes: true });
		} catch (error) {
			if (isAbortError(error, signal)) {
				throw createAbortError();
			}

			continue;
		}

		entries.sort((a, b) => a.name.localeCompare(b.name));
		for (const entry of entries) {
			if (scannedEntries++ >= MAX_SCANNED_ENTRIES || paths.length >= MAX_INDEXED_FILES) {
				break;
			}

			const relativePath = directory.relativePath
				? `${directory.relativePath}/${entry.name}`
				: entry.name;
			const absolutePath = join(directory.absolutePath, entry.name);

			if (entry.isSymbolicLink()) {
				continue;
			}

			if (entry.isDirectory()) {
				if (!SKIPPED_DIRECTORIES.has(entry.name)) {
					directories.push({ absolutePath, relativePath });
				}

				continue;
			}

			if (!entry.isFile() || isIgnored(ignored, relativePath)) {
				continue;
			}

			const path = await validateProjectFileCandidate(root, relativePath, signal);
			if (path) {
				paths.push(path);
			}
		}
	}

	return paths.sort((a, b) => a.localeCompare(b));
}

async function buildIndex(root: string, signal: AbortSignal): Promise<FileIndex> {
	const paths = (await buildGitIndex(root, signal)) ?? (await buildFallbackIndex(root, signal));
	const now = Date.now();

	return { paths, builtAt: now, lastAccessedAt: now };
}

function storeIndex(key: string, index: FileIndex): void {
	indexes.set(key, index);
	while (indexes.size > PROJECT_FILE_INDEX_MAX_CACHE_ENTRIES) {
		const oldest = [...indexes.entries()].sort(
			([, left], [, right]) => left.lastAccessedAt - right.lastAccessedAt
		)[0];
		if (!oldest) {
			break;
		}

		indexes.delete(oldest[0]);
	}
}

function releaseBuildWaiter(build: IndexBuild): void {
	build.waiters -= 1;
	if (build.waiters === 0 && !build.finished) {
		build.controller.abort();
	}
}

function waitForBuild(build: IndexBuild, signal?: AbortSignal): Promise<FileIndex> {
	throwIfAborted(signal);
	build.waiters += 1;

	return new Promise<FileIndex>((resolvePromise, rejectPromise) => {
		let settled = false;
		const settle = (settler: () => void) => {
			if (settled) {
				return;
			}

			settled = true;
			signal?.removeEventListener('abort', onAbort);
			releaseBuildWaiter(build);
			settler();
		};

		const onAbort = () => settle(() => rejectPromise(createAbortError()));

		signal?.addEventListener('abort', onAbort, { once: true });
		build.promise.then(
			(index) => settle(() => resolvePromise(index)),
			(error) => settle(() => rejectPromise(error))
		);
	});
}

async function getIndex(projectId: string, root: string, signal?: AbortSignal): Promise<FileIndex> {
	throwIfAborted(signal);
	const key = cacheKey(projectId, root);
	const cached = indexes.get(key);
	if (cached && Date.now() - cached.builtAt < PROJECT_FILE_INDEX_TTL_MS) {
		cached.lastAccessedAt = Date.now();

		return cached;
	}

	if (cached) {
		indexes.delete(key);
	}

	const existing = builds.get(key);
	if (existing) {
		return waitForBuild(existing, signal);
	}

	const controller = new AbortController();
	const build: IndexBuild = {
		controller,
		waiters: 0,
		finished: false,
		promise: Promise.resolve(undefined as never)
	};
	buildCount += 1;
	build.promise = buildIndex(root, controller.signal)
		.then((index) => {
			if (!controller.signal.aborted) {
				storeIndex(key, index);
			}

			return index;
		})
		.finally(() => {
			build.finished = true;
			if (builds.get(key) === build) {
				builds.delete(key);
			}
		});
	// The shared promise can reject after every waiter has aborted. Keep that
	// cancellation from becoming an unhandled rejection while waiters still receive it.
	void build.promise.catch(() => undefined);
	builds.set(key, build);

	return waitForBuild(build, signal);
}

/** Evict all cached and in-flight indexes belonging to a removed or moved project. */
export function invalidateProjectFileCache(projectId: string): void {
	for (const [key] of indexes) {
		if (projectIdFromCacheKey(key) === projectId) {
			indexes.delete(key);
		}
	}

	for (const [key, build] of builds) {
		if (projectIdFromCacheKey(key) === projectId) {
			build.controller.abort();
		}
	}
}

/** Test/diagnostic helper; production callers normally rely on TTL and LRU eviction. */
export function clearProjectFileCache(): void {
	for (const build of builds.values()) {
		build.controller.abort();
	}

	indexes.clear();
	builds.clear();
	buildCount = 0;
}

export function getProjectFileCacheStats(): {
	cacheEntries: number;
	cachedFiles: number;
	inFlightBuilds: number;
	inFlightWaiters: number;
	buildCount: number;
} {
	return {
		cacheEntries: indexes.size,
		cachedFiles: [...indexes.values()].reduce((total, index) => total + index.paths.length, 0),
		inFlightBuilds: builds.size,
		inFlightWaiters: [...builds.values()].reduce((total, build) => total + build.waiters, 0),
		buildCount
	};
}

/**
 * Lists project-relative files for @ completion. The filesystem is indexed once per
 * project/root and queries are ranked in memory until the short index TTL expires.
 */
export async function searchProjectFiles(
	projectId: string,
	query: string,
	signal?: AbortSignal
): Promise<ProjectFileSuggestion[]> {
	throwIfAborted(signal);
	const normalizedQuery = normalizeQuery(query);
	let project;
	try {
		project = await resolveProject(projectId);
	} catch (error) {
		invalidateProjectFileCache(projectId);
		throw error;
	}

	const key = cacheKey(project.id, project.cwd);
	// A registry edit can move a project without changing its ID. Do not retain the
	// old root's index after the canonical root observed by this request changes.
	for (const [existingKey] of indexes) {
		if (projectIdFromCacheKey(existingKey) === projectId && existingKey !== key) {
			indexes.delete(existingKey);
		}
	}

	for (const [existingKey, build] of builds) {
		if (projectIdFromCacheKey(existingKey) === projectId && existingKey !== key) {
			build.controller.abort();
		}
	}

	const index = await getIndex(project.id, project.cwd, signal);
	throwIfAborted(signal);
	const matches: ScoredPath[] = [];
	for (const path of index.paths) {
		const score = scorePath(path.toLowerCase(), normalizedQuery);
		if (score !== undefined) {
			matches.push({ path, score });
		}
	}

	index.lastAccessedAt = Date.now();
	const rankedMatches = matches.sort(
		(a, b) => a.score - b.score || a.path.length - b.path.length || a.path.localeCompare(b.path)
	);
	const validMatches: ProjectFileSuggestion[] = [];
	for (const { path } of rankedMatches) {
		if (validMatches.length >= MAX_RESULTS) {
			break;
		}

		const validPath = await validateProjectFileCandidate(project.cwd, path, signal);
		if (validPath) {
			validMatches.push({ path: validPath });
		}
	}

	return validMatches;
}
